// Preload — the ONLY bridge between renderer and node. contextIsolation is on,
// so the renderer never gets ipcRenderer; it sees only `window.whiteintelDesktop`
// with the channels enumerated below.
import { contextBridge, ipcRenderer } from "electron";

type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

const call = <T>(name: string, ...args: unknown[]): Promise<Reply<T>> =>
  ipcRenderer.invoke(`wi:${name}`, ...args);

// Mid-stream event subscriptions — guarded by single-handler-per-channel so
// the renderer can't accidentally accumulate listeners.
const subscribers: Record<string, (...args: unknown[]) => void> = {};
function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  subscribers[channel] = cb as (...args: unknown[]) => void;
  return () => {
    if (subscribers[channel] === cb) delete subscribers[channel];
  };
}
ipcRenderer.on("wi:download.progress", (_e, payload) => subscribers["download.progress"]?.(payload));
ipcRenderer.on("wi:chat.token", (_e, payload) => subscribers["chat.token"]?.(payload));
ipcRenderer.on("wi:chat.done", (_e, payload) => subscribers["chat.done"]?.(payload));

contextBridge.exposeInMainWorld("whiteintelDesktop", {
  versions: { ...process.versions },

  models: {
    status: () => call<{ allReady: boolean; models: Array<{ id: string; name: string; ready: boolean; size: number; minBytes: number; url: string }> }>("models.status"),
    download: () => call<{ allReady: boolean }>("models.download"),
    cancelDownload: () => call<{ ok: boolean }>("models.cancelDownload"),
    onProgress: (cb: (p: { id: string; name: string; received: number; total: number; pct: number; mbps: number; done?: boolean; error?: string }) => void) =>
      subscribe("download.progress", cb),
  },

  cases: {
    list: () => call<Array<{ id: string; name: string; created_at: string; doc_count: number }>>("cases.list"),
    create: (name: string) => call<{ id: string; name: string }>("cases.create", name),
    remove: (id: string) => call<{ changes: number }>("cases.remove", id),
  },

  docs: {
    list: (caseId: string) =>
      call<Array<{ id: string; name: string; pages: number | null; created_at: string; chunk_count: number }>>("docs.list", caseId),
    ingest: (caseId: string, filePath: string) =>
      call<{ docId: string; name: string; chunks: number; pages: number }>("docs.ingest", caseId, filePath),
    remove: (id: string) => call<{ changes: number }>("docs.remove", id),
  },

  chat: {
    ask: (caseId: string, q: string) =>
      call<{ answer: string; hits: Array<{ id: number; text: string; doc_name: string; distance: number }> }>("chat.ask", caseId, q),
    onToken: (cb: (t: string) => void) => subscribe("chat.token", cb),
    onDone: (cb: (r: { answer: string; hits: Array<{ id: number; text: string; doc_name: string; distance: number }> }) => void) =>
      subscribe("chat.done", cb),
  },

  files: { pick: () => call<string[]>("files.pick") },
  shell: { openExternal: (url: string) => call<void>("shell.openExternal", url) },
});
