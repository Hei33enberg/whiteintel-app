// Copy the vanilla renderer (HTML/CSS/JS) into dist/renderer. No bundler needed
// for v1 — the renderer is a single page that talks to the main process over
// the contextBridge-exposed `window.whiteintelDesktop` API.
import { mkdir, cp } from "node:fs/promises";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const src = path.resolve(here, "..", "src", "renderer");
const out = path.resolve(here, "..", "dist", "renderer");

await mkdir(out, { recursive: true });
await cp(src, out, { recursive: true });
console.log(`copied renderer → ${out}`);
