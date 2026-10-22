// Skin and cloth colour calibration in the Locker's neutral studio light, measured in the real renderer (headless Chrome, dist/
// already built). The wave scene's gains (src/surfer.js SKIN_COMP, CLOTH_FIT) cancel its cool blue light, so under a neutral light
// they overshoot into orange; the Locker switches the surfer to the studio gains (surfer.studio) and this script fits and checks them.
//
//   node scripts/studio-calibrate.mjs fit     skin: per catalog tone, the albedo gain that renders as its swatch in the studio;
//                                             cloth: per catalog and gear-table colour, the same. Prints the rows for
//                                             STUDIO_SKIN_COMP and STUDIO_CLOTH_FIT in src/surfer.js.
//   node scripts/studio-calibrate.mjs check   render every skin tone and every cloth colour in the studio with what is in
//                                             src/surfer.js; exit 1 if any is out of tolerance. Skin: hue +-8 deg, sat +-0.12, value
//                                             +-0.10, or every channel within 10/255 (as skin-calibrate). Cloth: hue +-8 deg when
//                                             sat >= 0.2, sat +-0.15, value +-0.10, or every channel within 12/255 (as cloth-calibrate).
//   --colours #aabbcc,...  only these cloth colours
//
// Method (as skin-calibrate and cloth-calibrate): the same view is rendered twice, once normally and once with the material forced to
// magenta; the magenta pixels are the mask; the 55th-85th (skin) or 45th-80th (cloth) luminance percentile of the mask is the lit
// colour. The view is the Locker's own preview, turned to a fixed angle. Run `npm run build` first.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const mode = process.argv[2] === "fit" ? "fit" : "check";
const catalog = JSON.parse(readFileSync(join(root, "src", "data", "catalog.json"), "utf8"));
const tour = JSON.parse(readFileSync(join(root, "src", "data", "tour.json"), "utf8"));
const tones = catalog.skinTones.map((t) => t.color.toLowerCase());
const gearColours = Object.values(tour.gear.tiers).flatMap((t) => t.palettes.flatMap((p) => [p.c1, p.c2]));
const onlyArg = process.argv.indexOf("--colours");
const only = onlyArg >= 0 ? process.argv[onlyArg + 1].toLowerCase().split(",") : null;
const colours = [...new Set([...catalog.outfits.flatMap((o) => [o.color, o.color2]), ...gearColours].filter(Boolean).map((c) => c.toLowerCase()).filter((c) => !only || only.includes(c)))];
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

// Runs in the page with the Locker open: fn(measureHelpers) -> result.
const SESSION = async (kind, items, fitMode) => {
  const S = window.__surf;
  const sf = S.surfer();
  const view = S.locker();
  const decode = (url) =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        c.getContext("2d").drawImage(img, 0, 0);
        resolve(c.getContext("2d").getImageData(0, 0, c.width, c.height));
      };
      img.src = url;
    });
  const grab = async () => {
    view.turn(0.6);
    S.render();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return decode(document.getElementById("c").toDataURL("image/png"));
  };
  const lin = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = (p) => p[0] * 0.3 + p[1] * 0.59 + p[2] * 0.11;

  async function measure(set, lo, hi) {
    const real = await grab();
    const restore = set(true);
    const mask = await grab();
    restore();
    const px = [];
    for (let i = 0; i < real.data.length; i += 4) {
      if (mask.data[i] - mask.data[i + 1] > 60 && mask.data[i + 2] - mask.data[i + 1] > 60) px.push([real.data[i], real.data[i + 1], real.data[i + 2]]);
    }
    px.sort((a, b) => lum(a) - lum(b));
    const band = px.slice(Math.floor(px.length * lo), Math.floor(px.length * hi));
    return { n: px.length, rgb: band.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((v) => v / Math.max(1, band.length)) };
  }
  const skinMask = (on) => {
    const sk = sf.materials.skin;
    const keep = { color: sk.color.clone(), emissive: sk.emissive.clone(), sheen: sk.sheen, clearcoat: sk.clearcoat };
    sk.color.set("#000000");
    sk.emissive.set("#ff00ff");
    sk.sheen = 0;
    sk.clearcoat = 0;
    return () => {
      sk.color.copy(keep.color);
      sk.emissive.copy(keep.emissive);
      sk.sheen = keep.sheen;
      sk.clearcoat = keep.clearcoat;
    };
  };
  const clothMask = (on) => {
    const mat = sf.materials.rash;
    const keep = { vc: mat.vertexColors, color: mat.color.clone(), emissive: mat.emissive.clone(), spec: mat.specularIntensity };
    mat.vertexColors = false;
    mat.color.set("#000000");
    mat.emissive.set("#ff00ff");
    mat.specularIntensity = 0;
    mat.needsUpdate = true;
    return () => {
      mat.vertexColors = keep.vc;
      mat.color.copy(keep.color);
      mat.emissive.copy(keep.emissive);
      mat.specularIntensity = keep.spec;
      mat.needsUpdate = true;
    };
  };

  const out = [];
  if (kind === "skin") {
    for (const tone of items) {
      const t = rgbOf(tone);
      S.setSkin(tone);
      if (fitMode) {
        const comp = [0.8, 0.8, 0.8];
        let m = null;
        for (let it = 0; it < 9; it++) {
          sf.tune.skin = sf.tune.cloth.clone().setRGB(...comp);
          S.setSkin(tone);
          m = await measure(skinMask, 0.55, 0.85);
          for (let c = 0; c < 3; c++) comp[c] *= (Math.max(lin(t[c]), 1e-4) / Math.max(lin(m.rgb[c]), 1e-4)) ** 0.85;
        }
        sf.tune.skin = null;
        out.push({ key: tone, comp: comp.map((v) => +v.toFixed(3)), measured: m.rgb.map(Math.round), target: t });
      } else {
        sf.tune.skin = null;
        S.setSkin(tone);
        const m = await measure(skinMask, 0.55, 0.85);
        out.push({ key: tone, target: t, measured: m.rgb.map(Math.round), n: m.n });
      }
    }
  } else {
    sf.active.meshes.bikiniBottom.visible = false; // only the rashguard is measured
    const paint = (hex) => sf.paintSolid("rash", hex);
    if (fitMode) {
      // per colour, as cloth-calibrate: the gain that was measured closest to the hex is kept
      for (const hex of items) {
        const t = rgbOf(hex);
        const comp = [0.9, 0.8, 0.7];
        let best = null;
        for (let it = 0; it < 10; it++) {
          sf.tune.clothOverride = sf.tune.cloth.clone().setRGB(...comp);
          paint(hex);
          const m = await measure(clothMask, 0.45, 0.8);
          const err = Math.max(...m.rgb.map((v, c) => Math.abs(v - t[c])));
          if (!best || err < best.err) best = { err, comp: [...comp], rgb: m.rgb };
          for (let c = 0; c < 3; c++) comp[c] = Math.min(8, Math.max(0.05, comp[c] * (Math.max(lin(t[c]), 1e-4) / Math.max(lin(m.rgb[c]), 1e-4)) ** 0.85));
        }
        sf.tune.clothOverride = null;
        out.push({ key: hex, comp: best.comp.map((v) => +v.toFixed(3)), measured: best.rgb.map(Math.round), target: t });
      }
    } else {
      sf.tune.clothOverride = null;
      for (const hex of items) {
        paint(hex);
        const m = await measure(clothMask, 0.45, 0.8);
        out.push({ key: hex, target: rgbOf(hex), measured: m.rgb.map(Math.round), n: m.n });
      }
    }
  }
  return out;
};

let browser = null;
let exitCode = 0;
const rows = { skin: [], cloth: [] };
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--ignore-gpu-blocklist", "--use-angle=metal", "--window-size=1280,720"],
    defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  });
  for (const [kind, body] of [["skin", "male"], ["cloth", "female"]]) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log("pageerror:", e.message));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__surf && window.__surf.ready, { timeout: 120000 });
    await page.evaluate((b) => {
      const S = window.__surf;
      S.pause = true;
      S.setLoadout(b === "male" ? { body: "male", skin: "#c68642", bottom: "trunks-red", board: "board-blue" } : { body: "female", skin: "#c68642", bottom: "rash-white-f", board: "board-blue" });
      S.menu();
    }, body);
    await page.click("#open-locker");
    await page.waitForFunction(() => { const v = window.__surf.locker(); return v && v.ready && v.pending === 0 && v.stats.stageFrames > 3; }, { timeout: 120000 });
    // the cloth is measured on the white rashguard set, which this loadout shows; a skin change would re-dress, so nothing else runs
    const items = kind === "skin" ? tones : colours;
    rows[kind] = await page.evaluate(SESSION, kind, items, mode === "fit");
    await context.close();
  }

  const hsv = ([r, g, b]) => {
    r /= 255; g /= 255; b /= 255;
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
    console.log("STUDIO_SKIN_COMP rows:");
    for (const r of rows.skin) console.log(`  ["${r.key}", [${r.comp.join(", ")}]],   // target ${r.target.join(",")} measured ${r.measured.join(",")}`);
    console.log("STUDIO_CLOTH_FIT rows:");
    for (const r of rows.cloth) console.log(`  ["${r.key}", [${r.comp.join(", ")}]],   // target ${r.target.join(",")} measured ${r.measured.join(",")}`);
  } else {
    const dh = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    for (const kind of ["skin", "cloth"]) {
      let bad = 0;
      for (const r of rows[kind]) {
        const ht = hsv(r.target);
        const hm = hsv(r.measured);
        const dHue = dh(ht[0], hm[0]);
        const dSat = hm[1] - ht[1];
        const dVal = hm[2] - ht[2];
        const maxErr = Math.max(...r.measured.map((v, i) => Math.abs(v - r.target[i])));
        const ok = kind === "skin"
          ? (dHue <= 8 && Math.abs(dSat) <= 0.12 && Math.abs(dVal) <= 0.1) || maxErr <= 10
          : ((ht[1] < 0.2 || dHue <= 8) && Math.abs(dSat) <= 0.15 && Math.abs(dVal) <= 0.1) || maxErr <= 12;
        if (!ok) bad++;
        console.log(`${kind.padEnd(5)} ${r.key} target ${r.target.join(",").padEnd(11)} measured ${r.measured.join(",").padEnd(11)} hue ${ht[0].toFixed(0)}->${hm[0].toFixed(0)}  sat ${ht[1].toFixed(2)}->${hm[1].toFixed(2)}  val ${ht[2].toFixed(2)}->${hm[2].toFixed(2)}  ${ok ? "ok" : "OUT"}`);
      }
      if (bad) exitCode = 1;
      console.log(`${kind}: ${rows[kind].length - bad}/${rows[kind].length} within tolerance in the Locker studio`);
    }
  }
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
process.exit(exitCode);
