// Frame cost of the game scene as drawn: starts a ride, advances a second, then calls window.__surf.frameStats (GPU-synced
// frames through the whole composer; draw calls and triangles summed over every pass).
//
//   node scripts/perf.mjs [--skip-build] [--frames 120] [--runs 3] [--body male|female] [--pattern <name>] [--dist <folder>]
//
// --pattern dresses the surfer in an outfit (board shorts for the male, the rashguard set for the female) and a board printed with that pattern (earned-gear recipes through
// window.__surf.addGear) instead of the plain trunks / bikini and blue board, to measure the printed path.
//
// Needs a local Chrome (same candidates as shots.mjs). Serves dist/ on a random local port; the server and the browser
// are closed in a finally block. This measures THIS machine's GPU (headless Chrome, Metal on a Mac), not an integrated GPU.
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const dist = opt("dist", join(root, "dist"));
const frames = Number(opt("frames", "120"));
const runs = Number(opt("runs", "3"));
const body = opt("body", "male");
const pattern = opt("pattern", "");
const CHROME = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((p) => existsSync(p));
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };

if (!flag("skip-build")) {
  const r = spawnSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`npm run build exited ${r.status}`);
}
if (!CHROME) throw new Error("no Chrome found");
const server = await new Promise((resolve, reject) => {
  const s = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const file = join(dist, rel);
    if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  s.once("error", reject);
  s.listen(0, "127.0.0.1", () => resolve(s));
});
let browser = null;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--ignore-gpu-blocklist", "--enable-webgl", "--use-angle=metal", "--window-size=1280,720"],
    defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__surf && window.__surf.ready, { timeout: 120000 });
  await page.evaluate((body, pattern) => {
    const S = window.__surf;
    S.pause = true;
    const loadout = { body, skin: "#c68642", bottom: body === "male" ? "trunks-red" : "bikini-teal", board: "board-blue" };
    if (pattern) {
      const make = (slot, colours) => S.addGear({ slot, body: slot === "board" ? null : body, pattern, color: colours[0], color2: colours[1], tier: "epic", name: "Perf" }).id;
      loadout.bottom = make(body === "male" ? "bottom" : "set", ["#c41622", "#f3f6f8"]);
      loadout.board = make("board", ["#e23b2f", "#f4f1ea"]);
    }
    S.setLoadout(loadout);
    S.startFree();
    S.setAutopilot(true);
    S.advance(1.4);
  }, body, pattern);
  for (let i = 0; i < runs; i++) {
    const r = await page.evaluate((n) => window.__surf.frameStats(n), frames);
    console.log(`run ${i + 1}: ${r.ms.toFixed(2)} ms/frame, ${r.calls.toFixed(0)} draw calls, ${r.triangles.toFixed(0)} triangles, ${r.width}x${r.height}, quality ${await page.evaluate(() => window.__surf.quality())}`);
  }
  for (const e of errors) console.log(e);
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
