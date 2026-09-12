import path from "node:path";
import { app, BrowserWindow, shell } from "electron";
import { startStudioServer, type StudioServer } from "./server";
import { defaultWorkspaceDir, resolveWorkspace, seedWorkspace } from "../vite-plugins/workspace";

/**
 * Packaged entry point.
 *
 * The app carries its own Node runtime, so the designer no longer needs one
 * installed. Read-only bundle contents are seeded into a per-user workspace on
 * every launch (agent assets refreshed, existing scenes never touched), and the
 * studio server is started against that workspace before the window opens.
 */

/**
 * Files the workspace is seeded from. Packaged, they ship unpacked under
 * `resources/seed`; unpackaged (`electron .`), `getAppPath()` is the repo itself.
 */
function seedRoot(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "seed") : app.getAppPath();
}

/** The built frontend: `resources/dist` when packaged, `<repo>/dist` otherwise. */
function distRoot(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "dist") : path.join(app.getAppPath(), "dist");
}

let studio: StudioServer | null = null;
let mainWindow: BrowserWindow | null = null;

function createWindow(url: string): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    title: "Lottie Studio",
    backgroundColor: "#0b0b0c",
    show: false,
    webPreferences: {
      // The page is our own bundle served from localhost; it needs no Node access.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => (mainWindow = null));

  // Anything aimed at another site opens in the real browser, not in the app.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: "deny" };
  });

  void mainWindow.loadURL(url);
}

async function boot(): Promise<void> {
  const workspaceRoot = process.env.LOTTIE_STUDIO_WORKSPACE?.trim() || defaultWorkspaceDir();
  const workspace = resolveWorkspace(workspaceRoot);

  seedWorkspace(seedRoot(), workspace);

  studio = await startStudioServer({
    distDir: distRoot(),
    workspaceRoot: workspace.root,
  });

  createWindow(studio.url);
}

// A second launch focuses the window that already exists rather than starting
// a second server against the same workspace.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(boot).catch((err) => {
    console.error("[lottie-studio] failed to start:", err);
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && studio) createWindow(studio.url);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    void studio?.close();
    studio = null;
  });
}
