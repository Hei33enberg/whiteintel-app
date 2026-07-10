// Local RAG: ingest PDF/TXT/MD → chunk → embed locally → store in sqlite-vec.
// Retrieve top-k by cosine, ground a streaming chat answer with explicit [n]
// citations. Document bytes NEVER leave the machine — there's no network egress
// on the RAG path; the embedding and chat models are bundled local GGUFs.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { dialog, BrowserWindow } from "electron";
// pdf-parse: tiny, stable, no native deps beyond what node ships.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (b: Buffer) => Promise<{ text: string; numpages: number }>;
import { db } from "./store.js";
import { embed, chatStream } from "./llm.js";

const newId = () => crypto.randomUUID();

export async function pickFile(): Promise<string[]> {
  const r = await dialog.showOpenDialog({
    title: "Add documents to this case",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Documents", extensions: ["pdf", "txt", "md"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  return r.canceled ? [] : r.filePaths;
}

function chunkText(text: string, size = 1000, overlap = 200): string[] {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return [];
  const out: string[] = [];
  let i = 0;
  while (i < t.length) {
    out.push(t.slice(i, i + size));
    i += Math.max(1, size - overlap);
  }
  return out;
}

export async function ingest(caseId: string, filePath: string) {
  const buf = await fs.readFile(filePath);
  const lower = filePath.toLowerCase();
  let text = "";
  let pages = 0;
  if (lower.endsWith(".pdf")) {
    const r = await pdfParse(buf);
    text = r.text;
    pages = r.numpages;
  } else {
    text = buf.toString("utf8");
  }
  const pieces = chunkText(text);
  if (!pieces.length) throw new Error(`No extractable text in ${path.basename(filePath)}`);

  const docId = newId();
  const conn = db();
  const name = path.basename(filePath);
  conn.prepare("insert into docs(id, case_id, path, name, pages) values(?,?,?,?,?)")
    .run(docId, caseId, filePath, name, pages || null);

  const insChunk = conn.prepare("insert into chunks(doc_id, ordinal, text) values(?,?,?)");
  const insVec = conn.prepare("insert into vec_chunks(chunk_id, embedding) values(?,?)");
  // Sequential — node-llama-cpp serializes embedding calls and this keeps RAM
  // flat for big PDFs (hundreds of chunks).
  for (let i = 0; i < pieces.length; i++) {
    const vec = await embed(pieces[i]);
    const res = insChunk.run(docId, i, pieces[i]);
    const chunkId = Number(res.lastInsertRowid);
    insVec.run(chunkId, Buffer.from(new Float32Array(vec).buffer));
  }
  return { docId, name, chunks: pieces.length, pages };
}

export type Hit = { id: number; text: string; doc_name: string; distance: number };

export async function retrieve(caseId: string, q: string, k = 6): Promise<Hit[]> {
  const qe = new Float32Array(await embed(q));
  return db().prepare(
    `select c.id as id, c.text as text, d.name as doc_name, v.distance as distance
     from vec_chunks v
     join chunks c on c.id = v.chunk_id
     join docs d on d.id = c.doc_id
     where d.case_id = ? and v.embedding match ? and k = ?
     order by v.distance`,
  ).all(caseId, Buffer.from(qe.buffer), k) as Hit[];
}

function broadcastToken(t: string) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("wi:chat.token", t);
  }
}
function broadcastDone(answer: string, hits: Hit[]) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("wi:chat.done", { answer, hits });
  }
}

/** Streaming grounded ask. Returns the full answer + hits when finished; tokens
 *  are also pushed mid-stream on `wi:chat.token` (the renderer renders them as
 *  they arrive). One in-flight ask at a time — the renderer enforces this. */
export async function askStreaming(caseId: string, q: string) {
  const hits = await retrieve(caseId, q);
  if (!hits.length) {
    const msg = "No relevant chunks in this case. Add a document (PDF / TXT / MD) and try again.";
    broadcastDone(msg, []);
    return { answer: msg, hits: [] as Hit[] };
  }
  const ctx = hits.map((h, i) => `[${i + 1}] ${h.doc_name}\n${h.text}`).join("\n\n---\n\n");
  const prompt = `CHUNKS:\n${ctx}\n\nQUESTION: ${q}\n\nANSWER:`;
  const answer = await chatStream(prompt, broadcastToken);
  broadcastDone(answer.trim(), hits);
  return { answer: answer.trim(), hits };
}
