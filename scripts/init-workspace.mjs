// Creates (or refreshes) the per-user workspace the packaged app runs against.
//
//   node scripts/init-workspace.mjs [target-dir]
//
// Without an argument it uses the platform default (on macOS,
// ~/Library/Application Support/Lottie Studio/workspace). Agent assets are
// refreshed every run; public/projects/ is only seeded when empty, so the
// designer's own scenes are never overwritten.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultWorkspaceDir, resolveWorkspace, seedWorkspace } from "../vite-plugins/workspace.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] ? resolve(process.argv[2]) : defaultWorkspaceDir();

const ws = resolveWorkspace(repoRoot);
const workspace = { ...ws, root: target, projectsDir: resolve(target, "public/projects"), mailboxDir: resolve(target, ".mailbox"), relocated: true };

seedWorkspace(repoRoot, workspace);
console.log(`Workspace ready -> ${workspace.root}`);
