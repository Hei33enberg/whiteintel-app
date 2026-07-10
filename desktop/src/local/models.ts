// Bundled-AI model registry. Models live in Electron's userData dir (NEVER in
// the asar — they're hundreds of MB and we'd repack on every release). On first
// run the app downloads them with progress; subsequent runs are instant + offline.
//
// To ship a no-download installer instead, place the same files under
// `<userData>/models/` via electron-builder `extraResources` and the readiness
// check will skip the download path entirely.
import { app } from "electron";
import path from "node:path";
import fs from "node:fs";

export type ModelId = "chat" | "embed";

export const MODELS: Record<ModelId, {
  name: string;
  file: string;
  url: string;
  /** Minimum bytes for a completed file — partial downloads will redo. */
  minBytes: number;
  notes: string;
}> = {
  chat: {
    name: "Qwen2.5-3B-Instruct (Q4_K_M)",
    file: "qwen2.5-3b-instruct-q4_k_m.gguf",
    url: "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf",
    minBytes: 1_800_000_000, // ~1.93 GB
    notes: "Multilingual incl. Polish, Apache-2.0, runs on CPU + Vulkan/Metal/CUDA via prebuilts.",
  },
  embed: {
    name: "nomic-embed-text-v1.5 (Q5_K_M, 768d)",
    file: "nomic-embed-text-v1.5.Q5_K_M.gguf",
    url: "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q5_K_M.gguf",
    minBytes: 100_000_000, // ~225 MB
    notes: "768-dim embeddings (matches our sqlite-vec schema).",
  },
};

export function modelsDir(): string {
  const p = path.join(app.getPath("userData"), "models");
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function modelPath(id: ModelId): string {
  return path.join(modelsDir(), MODELS[id].file);
}

export function isReady(id: ModelId): boolean {
  const p = modelPath(id);
  if (!fs.existsSync(p)) return false;
  return fs.statSync(p).size >= MODELS[id].minBytes;
}

export function status() {
  const out: { id: ModelId; name: string; file: string; ready: boolean; size: number; minBytes: number; url: string }[] = [];
  for (const id of ["chat", "embed"] as ModelId[]) {
    const p = modelPath(id);
    const size = fs.existsSync(p) ? fs.statSync(p).size : 0;
    out.push({
      id,
      name: MODELS[id].name,
      file: MODELS[id].file,
      ready: isReady(id),
      size,
      minBytes: MODELS[id].minBytes,
      url: MODELS[id].url,
    });
  }
  return { allReady: out.every((m) => m.ready), models: out };
}
