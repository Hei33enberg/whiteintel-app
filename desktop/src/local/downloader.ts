// First-run model downloader. Streams directly from Hugging Face CDN to disk in
// the user's data dir, with HTTP Range resume on reconnect. Broadcasts progress
// events to every BrowserWindow so the renderer can show a progress bar.
import fs from "node:fs";
import path from "node:path";
import { BrowserWindow } from "electron";
import { MODELS, modelPath, isReady, type ModelId } from "./models.js";

export type Progress = {
  id: ModelId;
  name: string;
  received: number;
  total: number;
  pct: number;
  mbps: number;
  done?: boolean;
  error?: string;
};

function broadcast(e: Progress) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("wi:download.progress", e);
  }
}

async function fetchOne(id: ModelId, signal?: AbortSignal): Promise<void> {
  if (isReady(id)) return;
  const m = MODELS[id];
  const dest = modelPath(id);
  const tmp = dest + ".partial";
  const startBytes = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;

  const headers: Record<string, string> = {};
  if (startBytes > 0) headers["Range"] = `bytes=${startBytes}-`;

  const r = await fetch(m.url, { headers, signal, redirect: "follow" });
  if (!r.ok && r.status !== 206) {
    if (startBytes > 0 && r.status === 416) {
      // Range not satisfiable — partial was already complete; finalize.
      fs.renameSync(tmp, dest);
      broadcast({ id, name: m.name, received: startBytes, total: startBytes, pct: 100, mbps: 0, done: true });
      return;
    }
    throw new Error(`download failed: HTTP ${r.status} ${r.statusText}`);
  }
  if (!r.body) throw new Error("no response body");

  // Total bytes: prefer Content-Range total (resumed), else Content-Length + start.
  const cr = r.headers.get("content-range");
  let total = startBytes + Number(r.headers.get("content-length") || 0);
  if (cr) {
    const m2 = /\/(\d+)\s*$/.exec(cr);
    if (m2) total = Number(m2[1]);
  }

  const out = fs.createWriteStream(tmp, { flags: startBytes > 0 ? "a" : "w" });
  let received = startBytes;
  const t0 = Date.now();
  let lastEmit = 0;
  const reader = r.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      out.write(Buffer.from(value));
      received += value.byteLength;
      const now = Date.now();
      if (now - lastEmit > 250) {
        lastEmit = now;
        const dt = (now - t0) / 1000;
        const mbps = (received - startBytes) / 1024 / 1024 / Math.max(dt, 0.001);
        const pct = total > 0 ? (received / total) * 100 : 0;
        broadcast({ id, name: m.name, received, total, pct, mbps });
      }
    }
    out.end();
    await new Promise<void>((res, rej) => {
      out.on("close", () => res());
      out.on("error", rej);
    });
    fs.renameSync(tmp, dest);
    broadcast({ id, name: m.name, received, total, pct: 100, mbps: 0, done: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    broadcast({ id, name: m.name, received, total, pct: 0, mbps: 0, error: msg });
    throw e;
  }
}

let _inflight: Promise<void> | null = null;
let _abort: AbortController | null = null;

export function ensureAll(): Promise<void> {
  if (_inflight) return _inflight;
  _abort = new AbortController();
  _inflight = (async () => {
    try {
      // embed first (small, fast feedback), then chat
      await fetchOne("embed", _abort!.signal);
      await fetchOne("chat", _abort!.signal);
    } finally {
      _inflight = null;
      _abort = null;
    }
  })();
  return _inflight;
}

export function cancel(): void {
  _abort?.abort();
}
