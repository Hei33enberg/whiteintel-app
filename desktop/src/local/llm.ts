// Local LLM: node-llama-cpp loads GGUF chat + embedding models. No daemon,
// no terminal, no Ollama — the prebuilt llama.cpp binaries that ship with the
// npm package handle CPU + Vulkan/Metal/CUDA acceleration where available.
//
// Singletons hold the loaded models so we pay the load cost once per session.
// Embedding context can run concurrently with chat (separate context).
import { modelPath, isReady, status as modelStatus } from "./models.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Llama = any;
type Model = any;
type Context = any;
type EmbedContext = any;

let _llama: Llama | null = null;
let _chatModel: Model | null = null;
let _chatCtx: Context | null = null;
let _embedModel: Model | null = null;
let _embedCtx: EmbedContext | null = null;

// node-llama-cpp is ESM-only in v3. Since this TS project outputs CommonJS,
// a bare import() gets transpiled to require(). We use the Function constructor
// to force node to evaluate a native dynamic import at runtime.
async function nlc() {
  return await new Function('return import("node-llama-cpp")')();
}

async function llama(): Promise<Llama> {
  if (_llama) return _llama;
  const m = await nlc();
  _llama = await m.getLlama();
  return _llama;
}

export async function ready() {
  return modelStatus();
}

async function chatModel(): Promise<Model> {
  if (_chatModel) return _chatModel;
  if (!isReady("chat")) throw new Error("Chat model not ready — finish the first-run download.");
  const l = await llama();
  _chatModel = await l.loadModel({ modelPath: modelPath("chat") });
  return _chatModel;
}

async function chatContext(): Promise<Context> {
  if (_chatCtx) return _chatCtx;
  const mdl = await chatModel();
  _chatCtx = await mdl.createContext({ contextSize: 4096 });
  return _chatCtx;
}

async function embedModel(): Promise<Model> {
  if (_embedModel) return _embedModel;
  if (!isReady("embed")) throw new Error("Embedding model not ready — finish the first-run download.");
  const l = await llama();
  _embedModel = await l.loadModel({ modelPath: modelPath("embed"), useMmap: true });
  return _embedModel;
}

async function embedContext(): Promise<EmbedContext> {
  if (_embedCtx) return _embedCtx;
  const mdl = await embedModel();
  _embedCtx = await mdl.createEmbeddingContext();
  return _embedCtx;
}

/** Embed text → 768-dim vector (nomic-embed-text-v1.5). */
export async function embed(text: string): Promise<number[]> {
  const ctx = await embedContext();
  const out = await ctx.getEmbeddingFor(text);
  // node-llama-cpp returns either { vector } or a typed array depending on version
  const v: ArrayLike<number> = out?.vector ?? out;
  return Array.from(v);
}

const SYSTEM_PROMPT =
  "You are a corporate-intelligence analyst. Answer the QUESTION grounded STRICTLY in the numbered CHUNKS provided. " +
  "Cite chunks inline as [1], [2], etc. If the chunks do not contain the answer, say so explicitly — do not invent facts.";

/** Run a single grounded chat turn with streaming. Calls onToken with each text
 *  chunk; resolves with the final answer string. Fresh session every call so
 *  there's no cross-talk between investigations. */
export async function chatStream(prompt: string, onToken: (t: string) => void): Promise<string> {
  const ctx = await chatContext();
  const m = await nlc();
  const session = new m.LlamaChatSession({
    contextSequence: ctx.getSequence(),
    systemPrompt: SYSTEM_PROMPT,
  });
  try {
    const ans = await session.prompt(prompt, {
      onTextChunk: (t: string) => {
        try { onToken(t); } catch { /* renderer disconnected — ignore */ }
      },
      maxTokens: 1024,
      temperature: 0.2,
    });
    return ans;
  } finally {
    try { session.dispose?.(); } catch { /* ignore */ }
  }
}

/** Eagerly warm both models — called after the first-run download finishes so
 *  the first user question doesn't pay the load latency. */
export async function warm(): Promise<void> {
  if (isReady("embed")) await embedContext();
  if (isReady("chat")) await chatContext();
}

/** Free resources (e.g., before quit). */
export async function dispose(): Promise<void> {
  try { await _chatCtx?.dispose?.(); } catch { /* ignore */ }
  try { await _chatModel?.dispose?.(); } catch { /* ignore */ }
  try { await _embedCtx?.dispose?.(); } catch { /* ignore */ }
  try { await _embedModel?.dispose?.(); } catch { /* ignore */ }
  _chatCtx = _chatModel = _embedCtx = _embedModel = null;
}
