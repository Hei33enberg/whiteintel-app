// WhiteIntel Desktop — main process. Secure defaults (contextIsolation, sandbox,
// no nodeIntegration); all node access lives behind ipcMain.handle channels that
// the preload exposes via contextBridge as `window.whiteintelDesktop`.
import { app, BrowserWindow, ipcMain, shell, Menu } from "electron";
import path from "node:path";
import electronUpdater from "electron-updater";
import { handlers } from "./local/handlers.js";

const isDev = !app.isPackaged;

// In-app auto-update. electron-updater reads app-update.yml (baked from electron-builder.yml's
// github publish block: Hei33enberg/whiteintel-app) and checks that release feed. Only runs in a
// packaged build — never in dev — and is best-effort: a failed/absent check must never block the
// app. `checkForUpdatesAndNotify` downloads a newer version in the background and prompts the user
// to restart into it, so installed users actually receive future releases instead of re-downloading.
function initAutoUpdate() {
  if (isDev) return;
  try {
    const { autoUpdater } = electronUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.on("error", (err) => console.error("[autoUpdate]", err?.message ?? err));
    void autoUpdater.checkForUpdatesAndNotify();
  } catch (err) {
    console.error("[autoUpdate] init failed", err);
  }
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: "WhiteIntel — Private Cases",
    backgroundColor: "#f4ede1",
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Renderer never talks to the network directly — only IPC to main.
      webSecurity: true,
    },
  });

  // External links open in the default browser, not a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await win.loadFile(path.join(__dirname, "renderer", "index.html"));
  if (isDev) win.webContents.openDevTools({ mode: "detach" });
}

function registerHandlers() {
  for (const [name, fn] of Object.entries(handlers)) {
    ipcMain.handle(`wi:${name}`, async (_ev, ...args) => {
      try {
        const data = await (fn as (...a: unknown[]) => unknown)(...args);
        return { ok: true, data };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown error";
        return { ok: false, error: msg };
      }
    });
  }
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{ label: app.name, submenu: [{ role: "about" as const }, { type: "separator" as const }, { role: "quit" as const }] }]
      : []),
    {
      label: "File",
      submenu: [isMac ? { role: "close" } : { role: "quit" }],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Open whiteintel.dev (cloud corpus)",
          click: () => shell.openExternal("https://whiteintel.dev"),
        },
        {
          label: "Install Ollama (required for local AI)",
          click: () => shell.openExternal("https://ollama.com/download"),
        },
        { type: "separator" },
        {
          label: "About WhiteIntel Desktop",
          click: () =>
            shell.openExternal(
              "https://whiteintel.dev/developers",
            ),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  registerHandlers();
  buildMenu();
  initAutoUpdate();
  void createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
