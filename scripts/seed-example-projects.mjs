// Seeds public/projects/ from examples/ on a fresh checkout. Runs on
// postinstall; safe to run manually: `node scripts/seed-example-projects.mjs`.
//
// public/projects/ is gitignored (it's the designer's live workspace, not
// shipped content — see .gitignore), so a fresh clone/zip has none. This only
// copies in when public/projects/ is missing or empty, so it never overwrites
// real work already sitting there.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(__dirname, "../examples");
const projectsDir = resolve(__dirname, "../public/projects");

mkdirSync(projectsDir, { recursive: true });

if (readdirSync(projectsDir).length > 0) {
  console.log("public/projects/ already has content — skipping example seed.");
} else {
  cpSync(examplesDir, projectsDir, { recursive: true });
  console.log(`Seeded example projects -> ${projectsDir}`);
}
