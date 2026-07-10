// IPC handler registry — every channel `wi:<name>` is wired here. The preload's
// contextBridge exposes ONLY these channels to the renderer. Mid-stream events
// (download progress, chat tokens) are sent via webContents.send and forwarded
// to the renderer by preload subscriptions.
import { shell } from "electron";
import crypto from "node:crypto";
import { db } from "./store.js";
import { status as modelStatus } from "./models.js";
import { ensureAll as downloadAll, cancel as cancelDownload } from "./downloader.js";
import { ready as llmReady, warm as warmLLM } from "./llm.js";
import { ingest, askStreaming, pickFile } from "./rag.js";

export const handlers = {
  // ── Bundled-AI engine status / first-run download ────────────────────────
  "models.status": () => modelStatus(),
  "models.download": async () => {
    await downloadAll();
    // Warm the models so the first question doesn't pay load latency.
    await warmLLM();
    return llmReady();
  },
  "models.cancelDownload": () => {
    cancelDownload();
    return { ok: true };
  },

  // ── Cases CRUD ───────────────────────────────────────────────────────────
  "cases.list": () =>
    db()
      .prepare(
        `select c.id, c.name, c.created_at,
                (select count(*) from docs where case_id = c.id) as doc_count
         from cases c order by c.created_at desc`,
      )
      .all(),
  "cases.create": (name: unknown) => {
    if (typeof name !== "string" || !name.trim()) throw new Error("name is required");
    const id = crypto.randomUUID();
    db().prepare("insert into cases(id, name) values(?,?)").run(id, name.trim());
    return { id, name: name.trim() };
  },
  "cases.remove": (id: unknown) => {
    if (typeof id !== "string") throw new Error("id is required");
    const r = db().prepare("delete from cases where id = ?").run(id);
    return { changes: r.changes };
  },

  // ── Documents ────────────────────────────────────────────────────────────
  "docs.list": (caseId: unknown) => {
    if (typeof caseId !== "string") throw new Error("caseId is required");
    return db()
      .prepare(
        `select id, name, pages, created_at,
                (select count(*) from chunks where doc_id = docs.id) as chunk_count
         from docs where case_id = ? order by created_at desc`,
      )
      .all(caseId);
  },
  "docs.ingest": (caseId: unknown, filePath: unknown) => {
    if (typeof caseId !== "string" || typeof filePath !== "string")
      throw new Error("caseId and filePath are required");
    return ingest(caseId, filePath);
  },
  "docs.remove": (id: unknown) => {
    if (typeof id !== "string") throw new Error("id is required");
    const r = db().prepare("delete from docs where id = ?").run(id);
    return { changes: r.changes };
  },

  // ── Streaming Q&A grounded in case docs ─────────────────────────────────
  // Returns the final {answer, hits}; mid-stream tokens fire on `wi:chat.token`.
  "chat.ask": (caseId: unknown, q: unknown) => {
    if (typeof caseId !== "string" || typeof q !== "string") throw new Error("caseId and q required");
    return askStreaming(caseId, q);
  },

  // ── Misc ────────────────────────────────────────────────────────────────
  "files.pick": () => pickFile(),
  "shell.openExternal": (url: unknown) => {
    if (typeof url !== "string") throw new Error("url required");
    const u = new URL(url);
    if (!/^(whiteintel\.dev|.*\.whiteintel\.dev|huggingface\.co)$/.test(u.host))
      throw new Error("blocked external host");
    return shell.openExternal(url);
  },
} as const;
