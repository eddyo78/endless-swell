// Checks for the prints on outfits and boards (milestone 5).
//
//   node scripts/check-prints.mjs               the Node part, then the browser part (needs `npm run build` and a local Chrome)
//   node scripts/check-prints.mjs --no-browser  the Node part only: what `npm run check` runs. The browser part is NOT run and
//                                               the script says so; `npm run check:prints` runs both.
//
// Node part (no canvas needed):
//   - every garment shell of both bodies has print UVs: finite, in range, no triangle that interpolates across a UV wrap or across
//     two different regions, and a measured stretch (3D length per UV metre) that stays near 1 so a motif keeps its size;
//   - the body atlas UVs the shells were cut with are measured too, and the check fails if they would have been usable;
//   - every board shape has planform UVs that agree with the geometry, a rail distance that is 0 on the rails, and a mask layout
//     that covers the hull;
//   - every pattern the catalog and the earned-gear tables use has a garment tile and a board drawing, and every tile repeats a
//     whole number of times round every region of every shell by a small scale (so the wrap is invisible).
// Browser part (the built game in headless Chrome):
//   - every garment pattern and every (board shape, board pattern) is drawn, is a sane mask (coverage, anti-aliased edges, tiles
//     that wrap), is uploaded to the GPU with no GL error, and is cached (a second request draws nothing, the cache is bounded);
//   - every catalog item and every generated piece (every pattern, slot and body) is worn and rendered with no page or GL error;
//   - a striped garment renders the same colours as the same two colours worn solid (so the calibrated cloth colours still hold).
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { femaleB64, maleB64 } from "../src/assets/surfers.data.js";
import { BOARD_SHAPES, RINGS, SEGS, createBoardParts } from "../src/board.js";
import { catalog } from "../src/save.js";
import { GARMENTS, createSurfer } from "../src/surfer.js";
import { gearTables } from "../src/gear.js";
import { BOARD_PATTERNS, GARMENT_PATTERNS, PRINT_PATTERNS, printSpec } from "../src/printart.js";
import { RAIL_HALF_WIDTH } from "../src/printmat.js";
import { REGIONS, regionTransforms } from "../src/printuv.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const noBrowser = process.argv.includes("--no-browser");
const failures = [];
let groups = 0;
const fail = (msg) => failures.push(msg);
async function group(name, fn) {
  const before = failures.length;
  await fn();
  groups++;
  console.log(`${failures.length === before ? "ok  " : "FAIL"} ${name}`);
}
const quantile = (arr, p) => {
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))];
};

// Limits, set from the measurements this script prints (the numbers are in _reports/m5-prints.md).
const LIMITS = {
  circ: [0.2, 1.4], // metres round a region
  vRange: [-0.1, 1.3], // metres from the hem (a vertex on a region border can sit a little past the neighbour's hem)
  edgeMedian: [0.9, 1.15], // 3D length per UV metre, median over edges: a motif keeps its physical size
  edgeP1: 0.25, // ... and 99% of edges are no more than about 4x squeezed or stretched (measured worst 3.97)
  edgeP99: 4.5,
  borderShare: 0.2, // share of triangles on a region border
  scaleRange: [0.8, 1.25], // tile scale needed to close a whole number of repeats round a region
  atlasSeamPairs: 50, // the body atlas must be as broken as measured, or the decision to project is out of date
};

// ---- garment shells -----------------------------------------------------------------------------------------------------
const surfer = await createSurfer({ textures: false });
const meshesOf = (rig) => GARMENTS[rig.kind].map((name) => [name, rig.meshes[name]]);

await group("every garment shell of both bodies has finite, in-range print UVs and no triangle that crosses a wrap or a region", () => {
  for (const rig of [surfer.male, surfer.female]) {
    for (const [name, mesh] of meshesOf(rig)) {
      const tag = `${rig.kind} ${name}`;
      const g = mesh.geometry;
      const a = g.attributes;
      for (const attr of ["position", "normal", "skinIndex", "skinWeight", "uv", "printUvB", "printRegion", "printPhi", "printTrim"]) {
        if (!a[attr]) fail(`${tag}: no ${attr} attribute`);
      }
      if (failures.length && !a.printUvB) continue;
      const n = a.position.count;
      for (const attr of ["uv", "printUvB", "printRegion", "printPhi", "printTrim", "position"]) {
        if (a[attr].count !== n) fail(`${tag}: ${attr} has ${a[attr].count} entries for ${n} vertices`);
        for (let i = 0; i < a[attr].array.length; i++) {
          if (!Number.isFinite(a[attr].array[i])) {
            fail(`${tag}: ${attr}[${i}] is ${a[attr].array[i]}`);
            break;
          }
        }
      }
      let trimOnes = 0;
      for (let i = 0; i < n; i++) {
        const t = a.printTrim.getX(i);
        if (t !== 0 && t !== 1) fail(`${tag}: printTrim ${t} is not 0 or 1`);
        trimOnes += t;
        for (const set of [a.uv, a.printUvB]) {
          if (set.getX(i) < -1e-6 || set.getX(i) >= 2) fail(`${tag}: u ${set.getX(i)} outside [0, 2)`);
          if (set.getY(i) < LIMITS.vRange[0] || set.getY(i) > LIMITS.vRange[1]) fail(`${tag}: v ${set.getY(i)} outside ${LIMITS.vRange} m`);
        }
        const phi = a.printPhi.getX(i);
        if (phi < -1.0001 || phi > 1.0001) fail(`${tag}: printPhi ${phi} outside [-1, 1]`);
      }
      if (trimOnes === 0) fail(`${tag}: no vertex is on a trim band`);
      const info = g.userData.print;
      info.circ.forEach((c, r) => {
        if (c !== 0 && (c < LIMITS.circ[0] || c > LIMITS.circ[1])) fail(`${tag}: region ${REGIONS[r]} is ${c.toFixed(2)} m round, outside ${LIMITS.circ}`);
      });
      const idx = g.index.array;
      let border = 0;
      const edgeRatio = [];
      for (let t = 0; t < idx.length; t += 3) {
        const v = [idx[t], idx[t + 1], idx[t + 2]];
        const codes = v.map((i) => a.printRegion.getX(i));
        if (codes[0] !== codes[1] || codes[1] !== codes[2]) fail(`${tag}: triangle ${t / 3} has vertices in different region pairs`);
        const ra = codes[0] % 8;
        const rb = Math.floor(codes[0] / 8);
        for (const r of [ra, rb]) if (!(info.circ[r] > 0)) fail(`${tag}: triangle ${t / 3} uses region ${r}, which has no frame`);
        if (ra !== rb) border++;
        for (const set of [a.uv, a.printUvB]) {
          const us = v.map((i) => set.getX(i));
          if (Math.max(...us) - Math.min(...us) > 0.5) fail(`${tag}: triangle ${t / 3} interpolates u across a wrap (${us.map((x) => x.toFixed(2))})`);
        }
        for (let k = 0; k < 3; k++) {
          const i = v[k];
          const j = v[(k + 1) % 3];
          const d3 = Math.hypot(a.position.getX(j) - a.position.getX(i), a.position.getY(j) - a.position.getY(i), a.position.getZ(j) - a.position.getZ(i));
          const c = info.circ[ra];
          const d2 = Math.hypot((a.uv.getX(j) - a.uv.getX(i)) * c, a.uv.getY(j) - a.uv.getY(i));
          if (d2 > 1e-5 && d3 > 1e-5) edgeRatio.push(d3 / d2);
        }
      }
      const med = quantile(edgeRatio, 0.5);
      const p1 = quantile(edgeRatio, 0.01);
      const p99 = quantile(edgeRatio, 0.99);
      if (med < LIMITS.edgeMedian[0] || med > LIMITS.edgeMedian[1]) fail(`${tag}: median 3D/UV edge ratio ${med.toFixed(2)} outside ${LIMITS.edgeMedian}`);
      if (p1 < LIMITS.edgeP1) fail(`${tag}: 1st percentile edge ratio ${p1.toFixed(2)} < ${LIMITS.edgeP1}`);
      if (p99 > LIMITS.edgeP99) fail(`${tag}: 99th percentile edge ratio ${p99.toFixed(2)} > ${LIMITS.edgeP99}`);
      const share = border / (idx.length / 3);
      if (share > LIMITS.borderShare) fail(`${tag}: ${(share * 100).toFixed(0)}% of triangles are on a region border`);
      console.log(
        `     ${tag.padEnd(20)} ${String(n).padStart(5)} verts, ${info.seamVertices} wrap copies, ${border} border tris (${(share * 100).toFixed(1)}%), ` +
          `regions ${info.circ.map((c, r) => (c ? `${REGIONS[r]} ${c.toFixed(2)} m` : null)).filter(Boolean).join(", ")}; edge 3D/UV p1 ${p1.toFixed(2)} p50 ${med.toFixed(2)} p99 ${p99.toFixed(2)}`,
      );
    }
  }
});

const GRID_GARMENTS = ["bikiniBottom", "bikiniTop"];
await group("the body atlas UVs the shells were cut with are not usable for prints (the reason each shell gets its own projection)", () => {
  const parse = (b64) => {
    const raw = atob(b64);
    const buf = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
    return new Promise((resolve, reject) => new GLTFLoader().parse(buf.buffer, "", resolve, reject));
  };
  return Promise.all([parse(maleB64), parse(femaleB64)]).then(([male, female]) => {
    for (const [kind, gltf] of [["male", male], ["female", female]]) {
      gltf.scene.traverse((obj) => {
        if (!obj.isMesh || !GARMENTS[kind].includes(obj.name)) return;
        const g = obj.geometry;
        const P = g.attributes.position;
        const I = g.index.array;
        if (!g.attributes.uv) return fail(`${kind} ${obj.name}: the source shell has no TEXCOORD_0`);
        const key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
        const count = new Map();
        for (let t = 0; t < I.length; t += 3) {
          for (const [a, b] of [[I[t], I[t + 1]], [I[t + 1], I[t + 2]], [I[t + 2], I[t]]]) count.set(key(a, b), (count.get(key(a, b)) || 0) + 1);
        }
        const pk = (i) => [P.getX(i), P.getY(i), P.getZ(i)].map((v) => Math.round(v * 1e5)).join(",");
        const boundary = new Map();
        for (const [k, c] of count) {
          if (c !== 1) continue;
          const [a, b] = k.split("_").map(Number);
          const kk = [pk(a), pk(b)].sort().join("|");
          boundary.set(kk, (boundary.get(kk) || 0) + 1);
        }
        let seamPairs = 0;
        for (const c of boundary.values()) if (c >= 2) seamPairs++;
        const dens = [];
        const UV = g.attributes.uv;
        for (let t = 0; t < I.length; t += 3) {
          const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
          const e1 = [P.getX(b) - P.getX(a), P.getY(b) - P.getY(a), P.getZ(b) - P.getZ(a)];
          const e2 = [P.getX(c) - P.getX(a), P.getY(c) - P.getY(a), P.getZ(c) - P.getZ(a)];
          const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
          const A3 = 0.5 * Math.hypot(...cr);
          const A2 = 0.5 * Math.abs((UV.getX(b) - UV.getX(a)) * (UV.getY(c) - UV.getY(a)) - (UV.getX(c) - UV.getX(a)) * (UV.getY(b) - UV.getY(a)));
          if (A3 > 1e-9) dens.push(Math.sqrt(A2 / A3));
        }
        const flat = dens.filter((d) => d > 0).length / dens.length;
        console.log(
          `     ${`${kind} ${obj.name}`.padEnd(20)} atlas: ${seamPairs} seam-edge pairs, texel density p5 ${quantile(dens, 0.05).toFixed(2)} p50 ${quantile(dens, 0.5).toFixed(2)} p95 ${quantile(dens, 0.95).toFixed(2)}, ${((1 - flat) * 100).toFixed(0)}% of triangles have no UV area`,
        );
        // a garment built as its own grid (scripts/lib/garments.mjs bikiniBottom) has no body atlas: its UVs are the grid's, so there are no
        // atlas seams to count; it still gets its own projection for prints (src/printuv.js)
        if (GRID_GARMENTS.includes(obj.name)) {
          if (seamPairs !== 0 && seamPairs < LIMITS.atlasSeamPairs) fail(`${kind} ${obj.name}: a grid garment should have no atlas seams, found ${seamPairs}`);
          return;
        }
        if (seamPairs < LIMITS.atlasSeamPairs) fail(`${kind} ${obj.name}: only ${seamPairs} atlas seam pairs; the atlas may now be printable, so revisit src/printuv.js`);
      });
    }
  });
});

// ---- boards -------------------------------------------------------------------------------------------------------------
await group("every board shape has planform UVs that match the geometry, a rail distance, and a mask layout that covers the hull", () => {
  for (const shape of BOARD_SHAPES) {
    const hull = createBoardParts(shape).hull;
    const a = hull.attributes;
    const L = hull.userData.print;
    if (!L) return fail(`${shape}: no print layout on the hull`);
    for (const attr of ["uv", "railArc", "deckSide"]) if (!a[attr] || a[attr].count !== a.position.count) fail(`${shape}: ${attr} missing or the wrong length`);
    for (const attr of ["uv", "railArc", "position"]) {
      for (let i = 0; i < a[attr].array.length; i++) if (!Number.isFinite(a[attr].array[i])) return fail(`${shape}: ${attr}[${i}] is not finite`);
    }
    for (let i = 0; i < a.position.count; i++) {
      const u = a.uv.getX(i);
      const v = a.uv.getY(i);
      if (u < -1e-6 || u > 1 + 1e-6 || v < -1e-6 || v > 1 + 1e-6) fail(`${shape}: uv ${u},${v} outside the unit square`);
      if (Math.abs(u - (a.position.getX(i) + L.xMax) / (2 * L.xMax)) > 1e-5) fail(`${shape}: u does not follow x at vertex ${i}`);
      if (Math.abs(v - (a.position.getZ(i) - L.zMin) / (L.zMax - L.zMin)) > 1e-5) fail(`${shape}: v does not follow z at vertex ${i}`);
      if (a.railArc.getX(i) < 0) fail(`${shape}: negative railArc at vertex ${i}`);
    }
    for (let ring = 2; ring <= RINGS - 2; ring++) {
      const apexA = a.railArc.getX(ring * SEGS);
      const apexB = a.railArc.getX(ring * SEGS + SEGS / 2);
      if (apexA > 1e-6 || apexB > 1e-6) fail(`${shape}: ring ${ring} rail apex has railArc ${apexA}, ${apexB}; it should be 0`);
    }
    for (let ring = RINGS / 4; ring <= (3 * RINGS) / 4; ring++) {
      const centre = a.railArc.getX(ring * SEGS + SEGS / 4);
      if (centre < 3 * RAIL_HALF_WIDTH) fail(`${shape}: ring ${ring} deck centre is only ${centre.toFixed(3)} m from a rail; the band would meet itself`);
    }
    if (L.width % 4 || L.height % 4 || L.width > 2048 || L.height > 2048 || L.width < 64) fail(`${shape}: mask ${L.width}x${L.height} is not a sane size (multiple of 4, at most 2048)`);
    if (L.width / L.ppm < 2 * L.xMax - 1e-6 || L.height / L.ppm < L.zMax - L.zMin - 1e-6) fail(`${shape}: the mask is smaller than the hull plan`);
    console.log(`     ${shape.padEnd(6)} hull ${a.position.count} verts, mask ${L.width} x ${L.height} px at ${L.ppm} px/m (${((L.width * L.height) / 1e6).toFixed(2)} MB as 8-bit)`);
  }
});

// ---- the pattern tables -------------------------------------------------------------------------------------------------
await group("every pattern the catalog and the earned-gear tables use can be printed on every garment and every board", () => {
  const used = new Set(["solid"]);
  for (const item of [...catalog.outfits, ...catalog.boards]) used.add(item.pattern);
  for (const p of Object.keys(gearTables.patternNames)) used.add(p);
  for (const tier of Object.values(gearTables.tiers)) for (const p of tier.patterns) used.add(p);
  for (const p of used) {
    if (!PRINT_PATTERNS.includes(p)) fail(`pattern "${p}" is used by the catalog or the gear tables but is not in PRINT_PATTERNS`);
    if (p !== "solid" && !GARMENT_PATTERNS.includes(p)) fail(`pattern "${p}" has no garment tile`);
    if (p !== "solid" && !BOARD_PATTERNS.includes(p)) fail(`pattern "${p}" has no board drawing`);
  }
  for (const p of PRINT_PATTERNS) if (p !== "solid" && !used.has(p)) fail(`pattern "${p}" is drawn but nothing uses it`);
  const styles = ["trunks", "bikini", "rash", "fullsuit", "springsuit"];
  for (const p of GARMENT_PATTERNS) {
    for (const style of styles) {
      const spec = printSpec(p, style);
      if (spec.tile.w > 1024 || spec.tile.h > 1024) fail(`${p}: tile ${spec.tile.w}x${spec.tile.h} is larger than 1024`);
      for (const rig of [surfer.male, surfer.female]) {
        for (const [name, mesh] of meshesOf(rig)) {
          const circ = mesh.geometry.userData.print.circ;
          const { repeats } = regionTransforms(circ, spec.tile, spec);
          circ.forEach((c, r) => {
            if (!(c > 0)) return;
            if (!Number.isInteger(repeats[r]) || repeats[r] < 1) fail(`${p} on ${rig.kind} ${name}/${REGIONS[r]}: ${repeats[r]} repeats round is not a whole number`);
            const roundLen = spec.swap ? spec.tile.th : spec.tile.tw;
            const scale = c / (repeats[r] * roundLen);
            if (!spec.around && (scale < LIMITS.scaleRange[0] || scale > LIMITS.scaleRange[1])) {
              fail(`${p} on ${rig.kind} ${name}/${REGIONS[r]}: tile scaled by ${scale.toFixed(2)} to close ${repeats[r]} repeats round (${c.toFixed(2)} m)`);
            }
          });
        }
      }
    }
  }
  console.log(`     patterns in use: ${[...used].join(", ")}; tiles: ${GARMENT_PATTERNS.map((p) => `${p} ${printSpec(p, "rash").tile.w}x${printSpec(p, "rash").tile.h}`).join(", ")}`);
});

await group("every pattern is worn by both bodies in Node (the item is recorded; no canvas needed)", () => {
  const byId = Object.fromEntries([...catalog.bodies, ...catalog.outfits, ...catalog.boards].map((i) => [i.id, i]));
  const meshOf = { trunks: "trunks", bikini: "bikiniBottom", rashset: "rash", fullsuit: "fullsuit", springsuit: "springsuit" };
  for (const o of catalog.outfits) {
    surfer.apply({ body: o.body, skin: "#c68642", bottom: o.id, board: "board-blue" }, byId);
    const worn = surfer.active.meshes[meshOf[o.style]].userData.print;
    if (worn.pattern !== o.pattern) fail(`${o.id}: the mesh recorded pattern ${worn.pattern}, the item is ${o.pattern}`);
  }
  for (const b of catalog.boards) {
    surfer.apply({ body: "male", skin: "#c68642", bottom: "trunks-red", board: b.id }, byId);
    if (surfer.board.children[0].userData.print.pattern !== b.pattern) fail(`${b.id}: the hull recorded the wrong pattern`);
  }
});

// ---- the browser part ---------------------------------------------------------------------------------------------------
async function browserPart() {
  const { default: puppeteer } = await import("puppeteer-core");
  const dist = join(root, "dist");
  if (!existsSync(join(dist, "index.html"))) throw new Error("dist/index.html is missing: run `npm run build` first");
  const CHROME = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((p) => existsSync(p));
  if (!CHROME) throw new Error("no Chrome found (set CHROME_PATH)");
  const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
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
  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      args: ["--no-sandbox", "--ignore-gpu-blocklist", "--enable-webgl", "--use-angle=metal", "--window-size=1280,720"],
      defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") pageErrors.push(`console.error: ${m.text()}`);
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__surf && window.__surf.ready, { timeout: 120000 });

    const report = await page.evaluate(async () => {
      const S = window.__surf;
      S.pause = true;
      const P = S.prints();
      const gl = P.renderer.getContext();
      const out = { problems: [], rows: [], cache: {}, worn: {}, colour: {} };
      const bad = (m) => out.problems.push(m);
      const glErrors = (what) => {
        const e = gl.getError();
        if (e !== gl.NO_ERROR) bad(`${what}: GL error ${e}`);
      };
      const stats = (mask, tile) => {
        const { data, w, h } = mask;
        let sum = 0;
        let mid = 0;
        for (let i = 0; i < data.length; i++) {
          sum += data[i];
          if (data[i] > 0 && data[i] < 255) mid++;
        }
        let interior = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w - 1; x++) interior += Math.abs(data[y * w + x] - data[y * w + x + 1]);
        interior /= 255 * h * (w - 1);
        let wrapX = 0;
        for (let y = 0; y < h; y++) wrapX += Math.abs(data[y * w] - data[y * w + w - 1]);
        wrapX /= 255 * h;
        let interiorY = 0;
        for (let y = 0; y < h - 1; y++) for (let x = 0; x < w; x++) interiorY += Math.abs(data[y * w + x] - data[(y + 1) * w + x]);
        interiorY /= 255 * w * (h - 1);
        let wrapY = 0;
        for (let x = 0; x < w; x++) wrapY += Math.abs(data[x] - data[(h - 1) * w + x]);
        wrapY /= 255 * w;
        return { coverage: sum / 255 / data.length, edge: mid / data.length, interior, wrapX, interiorY, wrapY, tile };
      };
      const upload = (tex, what) => {
        glErrors(`before ${what}`);
        P.renderer.initTexture(tex);
        glErrors(`uploading ${what}`);
      };
      // 1. garment tiles
      for (const p of P.GARMENT_PATTERNS) {
        const t0 = performance.now();
        const mask = P.drawGarmentMask(p);
        const ms = performance.now() - t0;
        const s = stats(mask, true);
        out.rows.push({ what: `garment ${p}`, w: mask.w, h: mask.h, ms, ...s });
        if (s.coverage < 0.08 || s.coverage > 0.65) bad(`garment ${p}: coverage ${s.coverage.toFixed(2)} outside 0.08..0.65`);
        // stripes are axis-aligned at whole pixels: their edges are exact and have no partial pixels to anti-alias
        const axisAligned = p === "stripes";
        if (s.edge > 0.3 || (!axisAligned && s.edge < 0.001)) bad(`garment ${p}: ${(s.edge * 100).toFixed(2)}% of pixels are anti-aliased edge, outside 0.1..30%`);
        if (axisAligned && s.edge !== 0) bad(`garment ${p}: expected exact pixel edges, found ${(s.edge * 100).toFixed(2)}% partial pixels`);
        if (s.wrapX > 1.5 * s.interior + 0.002) bad(`garment ${p}: the tile does not wrap across (wrap ${s.wrapX.toFixed(4)} vs interior ${s.interior.toFixed(4)})`);
        if (s.wrapY > 1.5 * s.interiorY + 0.002) bad(`garment ${p}: the tile does not wrap down (wrap ${s.wrapY.toFixed(4)} vs interior ${s.interiorY.toFixed(4)})`);
        const tex = P.garmentTexture(p);
        upload(tex, `garment ${p}`);
      }
      // 2. board masks
      for (const shape of P.BOARD_SHAPES) {
        const layout = P.createBoardParts(shape).hull.userData.print;
        for (const p of P.BOARD_PATTERNS) {
          const t0 = performance.now();
          const mask = P.drawBoardMask(p, layout);
          const ms = performance.now() - t0;
          const s = stats(mask, false);
          out.rows.push({ what: `board ${shape} ${p}`, w: mask.w, h: mask.h, ms, ...s });
          if (s.coverage < 0.03 || s.coverage > 0.7) bad(`board ${shape} ${p}: coverage ${s.coverage.toFixed(2)} outside 0.03..0.7`);
          if (s.edge < 0.001 || s.edge > 0.3) bad(`board ${shape} ${p}: ${(s.edge * 100).toFixed(2)}% anti-aliased edge, outside 0.1..30%`);
          // the print must reach both halves of the plan (nose half and tail half), not only one end
          const half = Math.floor(mask.h / 2);
          let noseHalf = 0;
          let tailHalf = 0;
          for (let y = 0; y < mask.h; y++) for (let x = 0; x < mask.w; x++) {
            if (y < half) noseHalf += mask.data[y * mask.w + x];
            else tailHalf += mask.data[y * mask.w + x];
          }
          if (noseHalf === 0 || tailHalf === 0) bad(`board ${shape} ${p}: the nose half or the tail half of the mask is empty`);
          upload(P.boardTexture(p, shape, layout), `board ${shape} ${p}`);
        }
      }
      // 3. cache: a second request draws nothing, and the board cache is bounded
      const before = { ...P.printStats };
      const again = P.garmentTexture("tiger");
      out.cache.sameGarment = again === P.garmentTexture("tiger");
      out.cache.drawsAfterRepeat = P.printStats.draws - before.draws;
      out.cache.hitsAfterRepeat = P.printStats.hits - before.hits;
      const boardKeys = () => P.printCacheEntries().filter((e) => e.key.startsWith("board:"));
      out.cache.boardsBeforeTrim = boardKeys().length;
      const keep = P.boardTexture("stripes", "short", P.createBoardParts("short").hull.userData.print);
      P.trimPrints(new Set([keep]));
      out.cache.boardsAfterTrim = boardKeys().length;
      out.cache.keptInUse = boardKeys().some((e) => e.key === "board:short:stripes");
      // 4. every catalog item and every generated piece, worn and rendered
      const byId = {};
      const wear = (loadout, what) => {
        S.setLoadout(loadout);
        S.render();
        glErrors(`rendering ${what}`);
      };
      S.startFree();
      S.setAutopilot(true);
      S.advance(1.2);
      let worn = 0;
      for (const o of S.catalogItems().outfits) {
        wear({ body: o.body, skin: "#c68642", bottom: o.id, board: "board-blue" }, o.id);
        worn++;
      }
      for (const b of S.catalogItems().boards) {
        wear({ body: "male", skin: "#c68642", bottom: "trunks-red", board: b.id }, b.id);
        worn++;
      }
      for (const body of ["male", "female"]) {
        for (const pattern of P.GARMENT_PATTERNS) {
          const mk = (slot) => S.addGear({ slot, body: slot === "board" ? null : body, pattern, color: "#0f8f8a", color2: "#fff1e6", tier: "epic", name: "Check" }).id;
          // men: board shorts with the matching board (a kit); women: the bikini set, the rashguard set, the fullsuit
          const slots = body === "male" ? ["bottom"] : ["bottom", "set", "suit"];
          for (const slot of slots) {
            wear({ body, skin: "#c68642", bottom: mk(slot), board: mk("board") }, `${body} ${pattern} ${slot}`);
            worn++;
          }
        }
      }
      out.worn.count = worn;
      // 5. wearing the same item again draws nothing
      const draws0 = P.printStats.draws;
      const again2 = S.save().loadout;
      S.setLoadout(again2);
      S.setLoadout(again2);
      out.worn.drawsOnReequip = P.printStats.draws - draws0;
      // 6. a striped rashguard shows the same colours as the same two colours worn solid
      const sf = S.surfer();
      const decode = (url) => new Promise((resolve) => {
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
        S.backCamera(1.6);
        S.render();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return decode(document.getElementById("c").toDataURL("image/png"));
      };
      const A = "#c41622";
      const B = "#f3f6f8";
      // The bloom pass spreads a bright garment's glow over the pixels round it, so a garment of two colours glows differently
      // from the same garment in one colour; the grade pass shifts the colour channels apart at edges (chromatic aberration).
      // Both are switched off for the comparison (and back on after).
      const world = S.world();
      const bloomWas = world.bloom.enabled;
      const chromaWas = world.gradePass.uniforms.uChroma.value;
      world.bloom.enabled = false;
      world.gradePass.uniforms.uChroma.value = 0;
      for (const cameraPose of ["settled"]) {
        S.setLoadout({ body: "female", skin: "#c68642", bottom: "rash-white-f", board: "board-blue" });
        S.startFree();
        S.setInput(0, 0);
        S.advance(0.6);
        S.setAutopilot(true);
        S.advance(1.1);
        S.setInput(0, 0);
        S.advance(0.3);
        const stripes = S.addGear({ slot: "set", body: "female", pattern: "stripes", color: A, color2: B, tier: "epic", name: "Check" }).id;
        S.setLoadout({ bottom: stripes });
        const printed = await grab();
        sf.paintSolid("rash", A);
        const solidA = await grab();
        sf.paintSolid("rash", B);
        const solidB = await grab();
        const mat = sf.materials.rash;
        const keep = { color: mat.color.clone(), emissive: mat.emissive.clone(), spec: mat.specularIntensity };
        mat.color.set("#000000");
        mat.emissive.set("#ff00ff");
        mat.specularIntensity = 0;
        mat.needsUpdate = true;
        const mask = await grab();
        mat.color.copy(keep.color);
        mat.emissive.copy(keep.emissive);
        mat.specularIntensity = keep.spec;
        mat.needsUpdate = true;
        const W = mask.width;
        const H = mask.height;
        const near = (x, y, i) => Math.max(Math.abs(x.data[i] - y.data[i]), Math.abs(x.data[i + 1] - y.data[i + 1]), Math.abs(x.data[i + 2] - y.data[i + 2])) <= 4;
        const isGarment = (i) => mask.data[i] - mask.data[i + 1] > 60 && mask.data[i + 2] - mask.data[i + 1] > 60;
        let n = 0;
        let match = 0;
        let atEdge = 0;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            if (!isGarment(i)) continue;
            n++;
            if (near(printed, solidA, i) || near(printed, solidB, i)) {
              match++;
              continue;
            }
            // a pixel that matches neither colour is acceptable only on a stripe edge: within 2 pixels of a pixel showing
            // the first colour and of one showing the second
            let sawA = false;
            let sawB = false;
            for (let dy = -2; dy <= 2; dy++) {
              for (let dx = -2; dx <= 2; dx++) {
                const xx = x + dx;
                const yy = y + dy;
                if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
                const j = (yy * W + xx) * 4;
                if (near(printed, solidA, j) && !near(solidA, solidB, j)) sawA = true;
                if (near(printed, solidB, j) && !near(solidA, solidB, j)) sawB = true;
              }
            }
            if (sawA && sawB) atEdge++;
          }
        }
        out.colour = { cameraPose, garmentPixels: n, matching: match, atEdge, share: match / Math.max(1, n), explained: (match + atEdge) / Math.max(1, n) };
      }
      world.bloom.enabled = bloomWas;
      world.gradePass.uniforms.uChroma.value = chromaWas;
      // 7. white cloth reads as white fabric, not glow: the cloth light ceiling is under the bloom threshold, and a white rashguard
      //    set in full sun does not brighten the pixels round it (bloom on against bloom off) or clip to white
      out.bloom = { ceiling: P.clothCeiling, threshold: P.bloomThreshold };
      S.setLoadout({ body: "female", skin: "#c68642", bottom: "rash-white-f", board: "board-blue" });
      S.startFree();
      S.setInput(0, 0);
      S.advance(0.6);
      S.setAutopilot(true);
      S.advance(1.1);
      S.setInput(0, 0);
      S.advance(0.3);
      const rash = sf.active.meshes.rash.material;
      const was = { color: rash.color.clone(), emissive: rash.emissive.clone(), spec: rash.specularIntensity };
      rash.color.set("#000000");
      rash.emissive.set("#ff00ff");
      rash.specularIntensity = 0;
      rash.needsUpdate = true;
      const whiteMask = await grab();
      rash.color.copy(was.color);
      rash.emissive.copy(was.emissive);
      rash.specularIntensity = was.spec;
      rash.needsUpdate = true;
      const WW = whiteMask.width;
      const HH = whiteMask.height;
      const inG = new Uint8Array(WW * HH);
      for (let i = 0; i < WW * HH; i++) inG[i] = whiteMask.data[i * 4] - whiteMask.data[i * 4 + 1] > 60 && whiteMask.data[i * 4 + 2] - whiteMask.data[i * 4 + 1] > 60 ? 1 : 0;
      const near = (x, y) => {
        for (let d = 1; d <= 10; d += 3) for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) if (inG[(y + dy) * WW + x + dx]) return true;
        return false;
      };
      const ringOf = [];
      for (let y = 10; y < HH - 10; y++) for (let x = 10; x < WW - 10; x++) if (!inG[y * WW + x] && near(x, y)) ringOf.push(y * WW + x);
      const lum = (img, i) => (img.data[i * 4] + img.data[i * 4 + 1] + img.data[i * 4 + 2]) / 3;
      const withBloom = await grab();
      world.bloom.enabled = false;
      const noBloom = await grab();
      world.bloom.enabled = bloomWas;
      let ringOn = 0;
      let ringOff = 0;
      for (const i of ringOf) {
        ringOn += lum(withBloom, i);
        ringOff += lum(noBloom, i);
      }
      let clipped = 0;
      let nG = 0;
      for (let i = 0; i < WW * HH; i++) if (inG[i]) {
        nG++;
        if (lum(withBloom, i) > 250) clipped++;
      }
      out.bloom.garmentPixels = nG;
      out.bloom.ringGlow = (ringOn - ringOff) / Math.max(1, ringOf.length);
      out.bloom.clippedShare = clipped / Math.max(1, nG);
      return out;
    });

    await group("browser: every pattern is drawn, uploaded to the GPU and cached; every item is worn and rendered", () => {
      for (const p of report.problems) fail(p);
      for (const e of pageErrors) fail(e);
      for (const r of report.rows) {
        console.log(`     ${r.what.padEnd(22)} ${String(r.w).padStart(4)} x ${String(r.h).padEnd(4)} drawn in ${r.ms.toFixed(1).padStart(5)} ms, coverage ${(r.coverage * 100).toFixed(0)}%, edge pixels ${(r.edge * 100).toFixed(1)}%`);
      }
      const c = report.cache;
      if (!c.sameGarment) fail("a second request for the same garment texture returned a different texture");
      if (c.drawsAfterRepeat !== 0) fail(`a repeated garment request drew ${c.drawsAfterRepeat} more masks`);
      if (c.hitsAfterRepeat < 1) fail("a repeated garment request was not counted as a cache hit");
      if (c.boardsAfterTrim > 6) fail(`the board cache holds ${c.boardsAfterTrim} masks after trimming (limit 6)`);
      if (!c.keptInUse) fail("trimming the cache evicted a texture that was in use");
      if (report.worn.drawsOnReequip !== 0) fail(`equipping the same loadout again drew ${report.worn.drawsOnReequip} masks`);
      console.log(`     cache: ${c.boardsBeforeTrim} board masks before trim, ${c.boardsAfterTrim} after; re-equip drew ${report.worn.drawsOnReequip}; ${report.worn.count} loadouts worn and rendered`);
      const bl = report.bloom;
      if (!(bl.ceiling < bl.threshold)) fail(`the cloth light ceiling ${bl.ceiling} is not under the bloom threshold ${bl.threshold}`);
      if (bl.garmentPixels < 2000) fail(`bloom test saw only ${bl.garmentPixels} garment pixels`);
      if (bl.ringGlow > 6) fail(`a white rashguard set brightens the pixels round it by ${bl.ringGlow.toFixed(1)} levels through bloom (limit 6)`);
      if (bl.clippedShare > 0.02) fail(`${(bl.clippedShare * 100).toFixed(1)}% of a white rashguard set is clipped to 250+ (limit 2%)`);
      console.log(`     white cloth: ceiling ${bl.ceiling} under bloom threshold ${bl.threshold}; glow on the pixels round a white rashguard set ${bl.ringGlow.toFixed(1)} levels (it was about 50 before the ceiling); ${(bl.clippedShare * 100).toFixed(2)}% of its pixels clipped (it was 13%)`);
      const col = report.colour;
      if (col.garmentPixels < 2000) fail(`colour test saw only ${col.garmentPixels} garment pixels`);
      if (col.share < 0.8) fail(`only ${(col.share * 100).toFixed(0)}% of striped garment pixels match the solid render of either colour (need 80%)`);
      if (col.explained < 0.99) fail(`${((1 - col.explained) * 100).toFixed(1)}% of striped garment pixels match neither colour and are not on a stripe edge (need under 1%)`);
      console.log(
        `     colour: ${(col.share * 100).toFixed(1)}% of ${col.garmentPixels} garment pixels equal the solid render of one of the two colours, ` +
          `${(((col.explained - col.share) * 100)).toFixed(1)}% more sit on a stripe edge (within 2 px of both colours); ${((1 - col.explained) * 100).toFixed(2)}% unexplained`,
      );
    });
  } finally {
    if (browser) await browser.close();
    await new Promise((r) => server.close(r));
  }
}

if (noBrowser) {
  console.log("NOTE: --no-browser: the render checks (drawing, GPU upload, cache, wearing every item, colour match) were NOT run; `npm run check:prints` runs them");
} else {
  await browserPart();
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`${failures.length} print check(s) failed`);
  process.exit(1);
}
console.log(`print checks passed (${groups} groups${noBrowser ? ", Node part only" : ""})`);
