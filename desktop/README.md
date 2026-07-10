# WhiteIntel Desktop

Private local-RAG companion to whiteintel.dev. Drop confidential PDFs / TXT / MD into a "case" — they're chunked, embedded by a **bundled local model**, stored in SQLite + `sqlite-vec` on this machine only. Ask grounded questions; the answer streams in with citations to the chunks it used. **Document bytes never leave the computer.**

No Ollama. No terminal. No external AI service.

## How the analyst experiences it

1. Double-click the installer (Windows .exe / macOS .dmg / Linux .AppImage).
2. On first launch the app shows _"Setting up the local AI engine — one-time ~2.2 GB download"_ with a progress bar. It streams the bundled chat + embedding GGUF models from Hugging Face's CDN directly into the app's data dir. Resume on reconnect is automatic.
3. After ~5–10 min on a typical home connection the engine is ready. Every subsequent launch is offline + instant.
4. Create a case, drop documents, ask questions — answers stream token-by-token with `[1] [2]` citations into the source chunks.

The "Cloud (whiteintel.dev)" link in the top bar opens the public 18M-entity corpus in the default browser — cleanly separated so cloud auth doesn't mix with the offline workspace.

## Architecture

- **Electron 32**, hardened: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. Preload exposes only an enumerated `window.whiteintelDesktop` API via `contextBridge`. Strict renderer CSP (`connect-src 'none'`) — the renderer cannot reach the network; only IPC into main.
- **node-llama-cpp** v3 — llama.cpp as a native node module with prebuilt binaries for win-x64, mac-arm64/x64, linux-x64. No daemon, no separate install. GPU acceleration auto-detected (Vulkan on Windows/Linux, Metal on macOS, CUDA where available).
- **Bundled models** (downloaded once on first run into `<userData>/models/`):
  - Chat — `Qwen2.5-3B-Instruct` Q4_K_M (~1.93 GB). Multilingual incl. Polish, Apache-2.0, runs on CPU + GPU.
  - Embeddings — `nomic-embed-text-v1.5` GGUF Q5_K_M (~250 MB, 768 dims — matches our sqlite-vec schema).
- **better-sqlite3 + sqlite-vec** — local DB at Electron's `userData` dir (survives reinstalls).
- **pdf-parse** for PDF text; .txt/.md native.

```
desktop/
├─ src/
│  ├─ main.ts            # BrowserWindow + IPC registration + menu
│  ├─ preload.ts         # contextBridge → window.whiteintelDesktop (+ event subs)
│  ├─ local/
│  │  ├─ models.ts       # bundled-model registry (URLs, sizes, paths, readiness)
│  │  ├─ downloader.ts   # streaming HF download with HTTP Range resume
│  │  ├─ llm.ts          # node-llama-cpp wrapper (singletons, embed, chatStream)
│  │  ├─ store.ts        # sqlite + sqlite-vec schema (cases/docs/chunks/vec)
│  │  ├─ rag.ts          # chunk → embed → store; retrieve; streaming ask
│  │  └─ handlers.ts     # ipcMain handler registry
│  └─ renderer/
│     ├─ index.html      # incl. first-run setup overlay
│     ├─ styles.css      # progress bar + streaming caret
│     └─ app.js          # first-run UI, streaming chat, cases CRUD
├─ scripts/copy-renderer.mjs
├─ electron-builder.yml  # NSIS / DMG / AppImage targets, native asarUnpack
├─ tsconfig.json
└─ package.json
```

## Dev

```bash
cd desktop
npm install          # also runs electron-builder install-app-deps (native rebuild)
npm run dev          # builds + opens the Electron window
```

First run will trigger the model download UI — same as production.

## Build installers

```bash
npm run dist:win        # NSIS installer in release/   (≈200 MB, models download on first run)
npm run dist:mac        # signed .dmg
npm run dist:linux      # AppImage
```

The default produces a **small installer** (~200 MB) + first-run download.
To ship a **fully self-contained, no-download installer** (~3 GB), place the
two GGUF files in `desktop/models/` before building and add them to
electron-builder `extraResources` so they land in `<userData>/models/`; the
readiness check then skips the download entirely.

## Security model

- The renderer has **no network access** — `connect-src 'none'` in the CSP. Paths to the outside world: (a) the model downloader in main fetches from huggingface.co, (b) whitelisted `shell.openExternal` for whiteintel.dev / huggingface.co.
- After the first-run download, the local AI engine has **zero network egress** — Qwen runs in-process via node-llama-cpp, no upstream calls.
- IPC handlers validate argument types.
- External-link opener whitelists `whiteintel.dev` and `huggingface.co` hosts only.
- Native modules (`better-sqlite3`, `sqlite-vec`, `node-llama-cpp`) are `asarUnpack`-ed because their `.node` / `.dll` binaries can't load from inside the asar archive.

## Roadmap

- v0.2 ✅ Streaming chat (token-by-token IPC events) — done.
- v0.3 ✅ Bundled local models (no Ollama) — done.
- v0.4 OCR for scanned PDFs (tesseract via WASM).
- v0.5 Auto-update via electron-updater + signed installers (Windows EV, macOS notarization).
- v0.6 Model picker UI (swap to larger/smaller chat models in-app).
- v0.7 Pull a dossier from `whiteintel.dev` corpus into a case as a starting point.
- v1.0 Capacitor build for Android (APK) + iOS, sharing the same local-RAG engine via SQLite/WASM and llama.cpp WASM/native.
