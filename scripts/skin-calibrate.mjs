// Skin colour calibration, measured in the real renderer (headless Chrome, dist/ already built).
//
//   node scripts/skin-calibrate.mjs fit                 per catalog tone, find the albedo factor that renders as its hex
//   node scripts/skin-calibrate.mjs check [--looks day,golden,storm,night]
//                                                       render every catalog tone with what is in src/surfer.js and
//                                                       compare to its hex; exit 1 if the day look is out of tolerance (hue +-8 deg, sat +-0.12, value +-0.10, or every channel within 10/255)
//
// How it measures: the same pose and camera are rendered twice, once normally and once with the skin forced to pure
// magenta. The magenta pixels are the skin mask. Pixels in the 55th-85th luminance percentile of the mask are the
// "sunlit skin"; their mean colour is compared to the catalog hex. Run `npm run build` first.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const mode = process.argv[2] === "fit" ? "fit" : "check";
const looksArg = process.argv.indexOf("--looks");
const looks = looksArg >= 0 ? process.argv[looksArg + 1].split(",") : ["day"];
const catalog = JSON.parse(readFileSync(join(root, "src", "data", "catalog.json"), "utf8"));
const tones = catalog.skinTones.map((t) => t.color);
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let rel = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, "");
  if (!rel || rel.endsWith("/")) rel += "index.html";
  const file = join(dist, rel);
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
let browser = null;
let exitCode = 0;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--ignore-gpu-blocklist", "--use-angle=metal", "--window-size=1280,720"],
    defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__surf && window.__surf.ready, { timeout: 120000 });

  const rows = await page.evaluate(
    async (tones, mode, looks) => {
      const S = window.__surf;
      S.pause = true;
      const save = S.save();
      const sf = S.surfer();
      const decode = (url) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const c = document.createElement("canvas");
            c.width = img.width;
            c.height = img.height;
            const g = c.getContext("2d");
            g.drawImage(img, 0, 0);
            resolve(g.getImageData(0, 0, c.width, c.height));
          };
          img.src = url;
        });
      const grab = async () => {
        S.render();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return decode(document.getElementById("c").toDataURL("image/png"));
      };
      const lin = (v) => {
        v /= 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      Object.assign(save.loadout, { body: "male", bottom: "trunks-red", top: null, board: "board-blue" });
      S.setBody("male");
      S.startFree();
      S.setInput(0, 0);
      S.advance(0.6);
      S.setAutopilot(true);
      S.advance(1.1);
      S.setInput(0, 0);
      S.advance(0.3);

      async function measure(tone) {
        save.loadout.skin = tone;
        S.setBody("male");
        S.closeCamera(1.5);
        const real = await grab();
        const sk = sf.materials.skin;
        const keep = { color: sk.color.clone(), emissive: sk.emissive.clone(), sheen: sk.sheen, clearcoat: sk.clearcoat };
        sk.color.set("#000000");
        sk.emissive.set("#ff00ff");
        sk.sheen = 0;
        sk.clearcoat = 0;
        const mask = await grab();
        sk.color.copy(keep.color);
        sk.emissive.copy(keep.emissive);
        sk.sheen = keep.sheen;
        sk.clearcoat = keep.clearcoat;
        const px = [];
        for (let i = 0; i < real.data.length; i += 4) {
          const r = mask.data[i];
          const g = mask.data[i + 1];
          const b = mask.data[i + 2];
          if (r - g > 60 && b - g > 60) px.push([real.data[i], real.data[i + 1], real.data[i + 2]]);
        }
        px.sort((a, b) => a[0] * 0.3 + a[1] * 0.59 + a[2] * 0.11 - (b[0] * 0.3 + b[1] * 0.59 + b[2] * 0.11));
        const band = px.slice(Math.floor(px.length * 0.55), Math.floor(px.length * 0.85));
        return { n: px.length, rgb: band.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((v) => v / Math.max(1, band.length)) };
      }

      const out = [];
      for (const look of looks) {
        S.world().applyLook(look);
        S.render();
        for (const tone of tones) {
          const t = rgbOf(tone);
          if (mode === "fit") {
            const comp = [0.55, 0.45, 0.35];
            let m = null;
            for (let it = 0; it < 9; it++) {
              sf.tune.skin = sf.tune.cloth.clone().setRGB(...comp);
              m = await measure(tone);
              for (let c = 0; c < 3; c++) comp[c] *= (Math.max(lin(t[c]), 1e-4) / Math.max(lin(m.rgb[c]), 1e-4)) ** 0.85;
            }
            sf.tune.skin = null;
            out.push({ look, tone, comp: comp.map((v) => +v.toFixed(3)), measured: m.rgb.map(Math.round) });
          } else {
            const m = await measure(tone);
            out.push({ look, tone, target: t, measured: m.rgb.map(Math.round), n: m.n });
          }
        }
      }
      S.world().applyLook("day");
      return out;
    },
    tones,
    mode,
    looks,
  );

  const hsv = ([r, g, b]) => {
    r /= 255;
    g /= 255;
    b /= 255;
    const mx = Math.max(r, g, b);
    const d = mx - Math.min(r, g, b);
    let h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, mx ? d / mx : 0, mx];
  };
  if (mode === "fit") {
    for (const r of rows) console.log(`  ["${r.tone}", [${r.comp.join(", ")}]],   // measured ${r.measured.join(",")} in the ${r.look} look`);
  } else {
    const dh = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    for (const r of rows) {
      const ht = hsv(r.target);
      const hm = hsv(r.measured);
      const dHue = dh(ht[0], hm[0]);
      const dSat = hm[1] - ht[1];
      const dVal = hm[2] - ht[2];
      const maxErr = Math.max(...r.measured.map((v, i) => Math.abs(v - r.target[i])));
      // hue is meaningless for near-black browns, so a colour within 10/255 on every channel also passes
      const ok = (dHue <= 8 && Math.abs(dSat) <= 0.12 && Math.abs(dVal) <= 0.1) || maxErr <= 10;
      if (r.look === "day" && !ok) exitCode = 1;
      console.log(
        `${r.look.padEnd(6)} ${r.tone} target ${r.target.join(",").padEnd(11)} measured ${r.measured.join(",").padEnd(11)} ` +
          `hue ${ht[0].toFixed(0)}->${hm[0].toFixed(0)} (d ${dHue.toFixed(0)})  sat ${ht[1].toFixed(2)}->${hm[1].toFixed(2)}  val ${ht[2].toFixed(2)}->${hm[2].toFixed(2)}  ${ok ? "ok" : "OUT"}`,
      );
    }
    console.log(exitCode ? "skin check FAILED in the day look (hue +-8 deg, sat +-0.12, value +-0.10, or every channel within 10/255)" : "skin check passed in the day look (hue +-8 deg, sat +-0.12, value +-0.10, or every channel within 10/255)");
  }
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
process.exit(exitCode);
