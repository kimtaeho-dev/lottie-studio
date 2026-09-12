import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where the designer's live content and the agent's working tree live.
 *
 * In the repo (`npm run dev`) these all sit inside the checkout, exactly as
 * before. In a packaged app the bundle is read-only, so the workspace is
 * relocated to a per-user directory and pointed at via `LOTTIE_STUDIO_WORKSPACE`.
 * Everything downstream reads these fields instead of deriving paths from the
 * Vite root, so neither plugin has to know which mode it is running in.
 */
export interface Workspace {
  /** Agent cwd. Holds CLAUDE.md, skills/, scripts/, and the projects tree. */
  root: string;
  /** Scene tree: `<root>/public/projects`. */
  projectsDir: string;
  /** Per-project chat threads: `<root>/.mailbox`. */
  mailboxDir: string;
  /** True when the workspace sits outside the Vite root (packaged app). */
  relocated: boolean;
}

export const WORKSPACE_ENV = "LOTTIE_STUDIO_WORKSPACE";

/** Per-user workspace location used by the packaged app. */
export function defaultWorkspaceDir(): string {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Lottie Studio", "workspace");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return path.join(appData, "Lottie Studio", "workspace");
  }
  const base = process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share");
  return path.join(base, "lottie-studio", "workspace");
}

/**
 * `repoRoot` is the Vite root. Without the env override the workspace *is* the
 * repo, which keeps `npm run dev` byte-for-byte identical to before.
 */
export function resolveWorkspace(repoRoot: string): Workspace {
  const override = process.env[WORKSPACE_ENV]?.trim();
  const root = override ? path.resolve(override) : path.resolve(repoRoot);
  return {
    root,
    projectsDir: path.join(root, "public", "projects"),
    mailboxDir: path.join(root, ".mailbox"),
    relocated: root !== path.resolve(repoRoot),
  };
}

/**
 * Files the agent needs on disk to do its job: the house rules, the skill it
 * routes through, and the two validation scripts (both are dependency-free, so
 * a workspace needs no node_modules of its own).
 */
const AGENT_ASSETS = ["CLAUDE.md", "README.md", "skills", "docs"] as const;

/**
 * Only the dependency-free validators are copied. The rest of `scripts/` is
 * build tooling that reaches back into the repo and would be broken here.
 */
const AGENT_SCRIPTS = [
  "check-lottie-web-compat.mjs",
  "check-motion-smoothness.mjs",
  "text-slot-unicode.test.mjs",
] as const;

/** Minimal package.json so `npm run check:*` works inside a relocated workspace. */
function workspaceManifest(): string {
  return `${JSON.stringify(
    {
      name: "lottie-studio-workspace",
      private: true,
      type: "module",
      scripts: {
        "check:lottie": "node scripts/check-lottie-web-compat.mjs public/projects/*/*/lottie.json",
        "check:motion": "node scripts/check-motion-smoothness.mjs public/projects/*/*/lottie.json",
        "check:text-slots": "node --experimental-strip-types --test scripts/text-slot-unicode.test.mjs",
      },
    },
    null,
    2,
  )}\n`;
}

/**
 * Marker recording that the example scenes have already been planted once.
 *
 * Seeding cannot key off "the projects folder is empty": that is also true when
 * the designer has deliberately deleted every project, and re-seeding on the
 * next launch would resurrect what they just threw away.
 */
const SEED_MARKER = ".examples-seeded";

/**
 * Populate a relocated workspace from the app bundle. Agent assets are refreshed
 * on every run so an app update ships new skill references; the example scenes
 * are planted only on the very first run, and never again.
 */
export function seedWorkspace(sourceRoot: string, ws: Workspace): void {
  fs.mkdirSync(ws.projectsDir, { recursive: true });
  fs.mkdirSync(ws.mailboxDir, { recursive: true });

  for (const asset of AGENT_ASSETS) {
    const from = path.join(sourceRoot, asset);
    if (!fs.existsSync(from)) continue;
    fs.cpSync(from, path.join(ws.root, asset), { recursive: true, force: true });
  }

  const scriptsDir = path.join(ws.root, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const script of AGENT_SCRIPTS) {
    const from = path.join(sourceRoot, "scripts", script);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(scriptsDir, script));
  }

  fs.writeFileSync(path.join(ws.root, "package.json"), workspaceManifest());

  const marker = path.join(ws.root, SEED_MARKER);
  if (!fs.existsSync(marker)) {
    // A workspace that already holds projects predates this marker; record that
    // it is seeded rather than adding examples on top of existing work.
    if (fs.readdirSync(ws.projectsDir).length === 0) {
      const examples = path.join(sourceRoot, "examples");
      if (fs.existsSync(examples)) fs.cpSync(examples, ws.projectsDir, { recursive: true });
    }
    fs.writeFileSync(marker, `${new Date().toISOString()}\n`);
  }
}
