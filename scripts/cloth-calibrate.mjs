// Cloth colour calibration, measured in the real renderer (headless Chrome, dist/ already built). Same method as
// scripts/skin-calibrate.mjs, for every cloth colour in the catalog (both colours of every outfit) and every colour in the
// earned-gear palette tables (src/data/tour.json). Generated palettes beyond the tables are not fitted; they take the blend
// of the nearest fitted colours (src/surfer.js clothComp).
//
//   node scripts/cloth-calibrate.mjs fit                 per catalog cloth colour, find the per-channel gain that makes it
//                                                        render as its hex in the day look; prints the CLOTH_FIT rows for src/surfer.js
//   (either mode) --colours #7a0610,#14b8b0   only these colours;  --trace   print every fit iteration
//   node scripts/cloth-calibrate.mjs check [--looks day,golden,storm,night]
//                                                        render every colour with what is in src/surfer.js and compare to its hex;
//                                                        exit 1 if the day look is out of tolerance: hue +-8 deg (not judged when the
//                                                        swatch's saturation is under 0.2), sat +-0.15, value +-0.10, or every channel
//                                                        within 12/255. LIMITED colours are reported, not failed (see below)
//
// How it measures: the women's rashguard (men have no top) is painted one solid colour and rendered from behind twice, once normally and once
// with the garment forced to pure magenta (the mask). The 45th-80th luminance percentile of the mask pixels is the lit cloth;
// its mean colour is compared to the catalog hex. Run `npm run build` first.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const mode = process.argv[2] === "fit" ? "fit" : "check";
const trace = process.argv.includes("--trace");
const looksArg = process.argv.indexOf("--looks");
const looks = looksArg >= 0 ? process.argv[looksArg + 1].split(",") : ["day"];
const catalog = JSON.parse(readFileSync(join(root, "src", "data", "catalog.json"), "utf8"));
const tour = JSON.parse(readFileSync(join(root, "src", "data", "tour.json"), "utf8"));
// every catalog cloth colour, plus every colour of the earned-gear generator's palette tables (src/data/tour.json, "gear")
const gearColours = Object.values(tour.gear.tiers).flatMap((t) => t.palettes.flatMap((p) => [p.c1, p.c2]));
const onlyArg = process.argv.indexOf("--colours");
const only = onlyArg >= 0 ? process.argv[onlyArg + 1].toLowerCase().split(",") : null;
const colours = [...new Set([...catalog.outfits.flatMap((o) => [o.color, o.color2]), ...gearColours].filter(Boolean).map((c) => c.toLowerCase()).filter((c) => !only || only.includes(c)))];
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// Colours the renderer cannot reach: the scene's ACES tone mapping leaks a bright saturated green into the red channel
// (measured on #3ddc97 with a red gain at its floor: red 126; with tone mapping switched off, red 14). They are printed
// as "limited" and do not fail the check.
const LIMITED = new Set(["#3ddc97"]);
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
  page.on("console", (m) => {
    if (m.text().startsWith("trace ")) console.log(m.text());
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__surf && window.__surf.ready, { timeout: 120000 });

  const rows = await page.evaluate(
    async (colours, mode, looks, trace) => {
      const S = window.__surf;
      S.pause = true;
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
      S.setLoadout({ body: "female", skin: "#c68642", bottom: "rash-white-f", board: "board-blue" });
      S.startFree();
      S.setInput(0, 0);
      S.advance(0.6);
      S.setAutopilot(true);
      S.advance(1.1);
      S.setInput(0, 0);
      S.advance(0.3);
      sf.active.meshes.bikiniBottom.visible = false; // only the rashguard is measured: a white bottom beside it would add its own glow

      async function measure(hex) {
        sf.paintSolid("rash", hex);
        S.backCamera(1.6);
        const real = await grab();
        const mat = sf.materials.rash;
        const keep = { vc: mat.vertexColors, color: mat.color.clone(), emissive: mat.emissive.clone(), spec: mat.specularIntensity };
        mat.vertexColors = false;
        mat.color.set("#000000");
        mat.emissive.set("#ff00ff");
        mat.specularIntensity = 0;
        mat.needsUpdate = true;
        S.backCamera(1.6);
        const mask = await grab();
        mat.vertexColors = keep.vc;
        mat.color.copy(keep.color);
        mat.emissive.copy(keep.emissive);
        mat.specularIntensity = keep.spec;
        mat.needsUpdate = true;
        const px = [];
        for (let i = 0; i < real.data.length; i += 4) {
          if (mask.data[i] - mask.data[i + 1] > 60 && mask.data[i + 2] - mask.data[i + 1] > 60) px.push([real.data[i], real.data[i + 1], real.data[i + 2]]);
        }
        px.sort((a, b) => a[0] * 0.3 + a[1] * 0.59 + a[2] * 0.11 - (b[0] * 0.3 + b[1] * 0.59 + b[2] * 0.11));
        const band = px.slice(Math.floor(px.length * 0.45), Math.floor(px.length * 0.8));
        return { n: px.length, rgb: band.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((v) => v / Math.max(1, band.length)) };
      }

      const out = [];
      for (const look of looks) {
        S.world().applyLook(look);
        S.render();
        for (const hex of colours) {
          const t = rgbOf(hex);
          if (mode === "fit") {
            const comp = [0.85, 0.65, 0.55];
            let m = null;
            // The loop can circle a colour whose dark channel is a few levels (the measurement there is steeper than the step
            // assumes), so the gain that was measured closest to the hex is the one kept, not the last one tried.
            let best = null;
            for (let it = 0; it < 10; it++) {
              sf.tune.clothOverride = sf.tune.cloth.clone().setRGB(...comp);
              m = await measure(hex);
              const err = Math.max(...m.rgb.map((v, c) => Math.abs(v - t[c])));
              if (!best || err < best.err) best = { err, comp: [...comp], rgb: m.rgb };
              if (trace) console.log(`trace ${hex} it ${it} gain ${comp.map((v) => v.toFixed(3))} measured ${m.rgb.map(Math.round)} err ${err.toFixed(1)}`);
              for (let c = 0; c < 3; c++) comp[c] = Math.min(8, Math.max(0.05, comp[c] * (Math.max(lin(t[c]), 1e-4) / Math.max(lin(m.rgb[c]), 1e-4)) ** 0.85));
            }
            sf.tune.clothOverride = null;
            out.push({ look, hex, comp: best.comp.map((v) => +v.toFixed(3)), measured: best.rgb.map(Math.round), target: t });
          } else {
            sf.tune.clothOverride = null;
            const m = await measure(hex);
            out.push({ look, hex, target: t, measured: m.rgb.map(Math.round), n: m.n });
          }
        }
      }
      S.world().applyLook("day");
      return out;
    },
    colours,
    mode,
    looks,
    trace,
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
    for (const r of rows) console.log(`  ["${r.hex}", [${r.comp.join(", ")}]],   // target ${r.target.join(",")} measured ${r.measured.join(",")} in the ${r.look} look`);
  } else {
    const dh = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    for (const r of rows) {
      const ht = hsv(r.target);
      const hm = hsv(r.measured);
      const dHue = dh(ht[0], hm[0]);
      const dSat = hm[1] - ht[1];
      const dVal = hm[2] - ht[2];
      const maxErr = Math.max(...r.measured.map((v, i) => Math.abs(v - r.target[i])));
      // hue is meaningless for near-neutral colours, so a colour within 12/255 on every channel also passes
      const hueOk = ht[1] < 0.2 || dHue <= 8;
      const ok = (hueOk && Math.abs(dSat) <= 0.15 && Math.abs(dVal) <= 0.1) || maxErr <= 12;
      const limited = !ok && LIMITED.has(r.hex);
      if (r.look === "day" && !ok && !limited) exitCode = 1;
      console.log(
        `${r.look.padEnd(6)} ${r.hex} target ${r.target.join(",").padEnd(11)} measured ${r.measured.join(",").padEnd(11)} ` +
          `hue ${ht[0].toFixed(0)}->${hm[0].toFixed(0)} (d ${dHue.toFixed(0)})  sat ${ht[1].toFixed(2)}->${hm[1].toFixed(2)}  val ${ht[2].toFixed(2)}->${hm[2].toFixed(2)}  ${ok ? "ok" : limited ? "limited (ACES)" : "OUT"}`,
      );
    }
    const rule = "hue +-8 deg when sat >= 0.2, sat +-0.15, value +-0.10, or every channel within 12/255";
    console.log(exitCode ? `cloth check FAILED in the day look (${rule})` : `cloth check passed in the day look (${rule}; limited colours reported above)`);
  }
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
process.exit(exitCode);
