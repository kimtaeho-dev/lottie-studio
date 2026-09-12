// Renders public/mark.svg into build/icon.icns.
//
// Run with Electron (`npx electron scripts/make-icon.cjs`) so the SVG goes
// through the same renderer the app ships with — no image library needed.
const { app, BrowserWindow } = require("electron");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const svg = fs.readFileSync(path.join(repoRoot, "public/mark.svg"), "utf8");
const iconset = path.join(repoRoot, "build/icon.iconset");
const SIZE = 1024;

const page = `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:${SIZE}px;height:${SIZE}px">${svg.replace(/width="\d+"/, `width="${SIZE}"`).replace(/height="\d+"/, `height="${SIZE}"`)}</div>
</body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, transparent: true, frame: false });
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(page));
  await new Promise((r) => setTimeout(r, 400));
  const png = (await win.webContents.capturePage()).toPNG();

  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });
  const master = path.join(iconset, "icon_512x512@2x.png");
  fs.writeFileSync(master, png);

  // macOS expects this exact set of names inside a .iconset directory.
  for (const [size, name] of [
    [16, "icon_16x16.png"], [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"], [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"], [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"], [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
  ]) {
    execFileSync("sips", ["-z", String(size), String(size), master, "--out", path.join(iconset, name)], {
      stdio: "ignore",
    });
  }

  execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(repoRoot, "build/icon.icns")]);
  fs.rmSync(iconset, { recursive: true, force: true });
  console.log("build/icon.icns 생성 완료");
  app.quit();
});
