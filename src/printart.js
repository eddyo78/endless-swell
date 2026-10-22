import * as THREE from "three";
import { mulberry32 } from "./competition.js";

// The prints on outfits and boards, drawn at runtime on a 2D canvas and kept as masks.
//
// A print is a MASK: one 8-bit channel, 0 where the item shows its first colour and 255 where it shows its second, with
// anti-aliased edges. The two colours are not in the texture. The materials (src/printmat.js) mix them per pixel, because the
// cloth gains fitted in scripts/cloth-calibrate.mjs are per colour and above 1, which a texture cannot hold. One mask therefore
// serves every colour pair, and the cache below is keyed by what the picture is (pattern, and for boards the shape), not by
// the item: equipping a second item with the same pattern draws nothing.
//
//   garments  tile masks (RepeatWrapping). A tile is a motif that repeats; src/printuv.js repeats it a whole number of times round
//             each part of the shell, so the wrap is invisible. 2048 pixels per metre: the stripe tile is 192 px for 9.4 cm, the
//             palm and tiger tiles 256 x 512 px for 12.5 x 25 cm. That is about 8 texels per screen pixel at the close camera, so the edges
//             stay sharp under the mip-mapping and 1.4 MB of masks covers every garment pattern.
//   boards    one mask per (pattern, shape) over the plan view of the board, 900 pixels per metre (BOARD_PRINT_PPM), 1584 x 472
//             for the shortboard. Boards are never tiled, so the sunburst has its centre and the stripes their count.
//
// Drawing is in metres: the 2D context is scaled so a unit is a metre, and every motif is written the way it is built in
// life (a stripe 4.7 cm wide, a frond 18 cm long).

export const PRINT_PATTERNS = ["solid", "stripes", "chevron", "sunburst", "palm", "tiger", "panels"];
const PPM = 2048;
const TAU = Math.PI * 2;

export const printStats = { draws: 0, hits: 0, bytes: 0, evicted: 0 };

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    return canvas;
  }
  throw new Error("print textures need a canvas (OffscreenCanvas or a document); this is not a browser");
}

/** Draw into a w x h canvas (black background, white ink) and return the red channel as a w x h byte array. */
function raster(w, h, paint) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("could not get a 2D drawing context for a print texture");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  ctx.lineJoin = "miter";
  ctx.miterLimit = 8;
  paint(ctx);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4];
  printStats.draws++;
  return out;
}

const repeat9 = (ctx, W, H, fn) => {
  for (const dx of [-W, 0, W]) {
    for (const dy of [-H, 0, H]) {
      ctx.save();
      ctx.translate(dx, dy);
      fn(ctx);
      ctx.restore();
    }
  }
};

// ---- motifs -------------------------------------------------------------------------------------------------------------

function disc(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

// A sun: a disc and `rays` pointed rays round it.
function sun(ctx, cx, cy, r0, r1, r2, rays) {
  disc(ctx, cx, cy, r0);
  ctx.beginPath();
  for (let k = 0; k < rays; k++) {
    const a = (k / rays) * TAU;
    const half = (TAU / rays) * 0.3;
    ctx.moveTo(cx + Math.cos(a - half) * r1, cy + Math.sin(a - half) * r1);
    ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
    ctx.lineTo(cx + Math.cos(a + half) * r1, cy + Math.sin(a + half) * r1);
    ctx.closePath();
  }
  ctx.fill();
}

// A palm frond from (x, y) pointing at angle `ang`: a curved midrib with pointed leaflets down both sides, longest about a
// third of the way out and shortening to the tip. `len` is the midrib length in metres.
function frond(ctx, x, y, ang, len) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  const curve = 0.16;
  const at = (t) => [2 * (1 - t) * t * len * 0.5 + t * t * len, 2 * (1 - t) * t * -curve * len];
  const tangent = (t) => Math.atan2(2 * -curve * len * (1 - 2 * t), len);
  ctx.lineWidth = len * 0.03;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.5, -curve * len, len, 0);
  ctx.stroke();
  const pairs = 11;
  for (let i = 0; i < pairs; i++) {
    const t = 0.1 + (0.86 * i) / (pairs - 1);
    const [bx, by] = at(t);
    const leaf = len * 0.36 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.88)), 0.85);
    const lean = ((68 - 34 * t) * Math.PI) / 180;
    for (const side of [-1, 1]) {
      const dir = tangent(t) + side * lean;
      const dx = Math.cos(dir);
      const dy = Math.sin(dir);
      const px = -dy * side;
      const py = dx * side;
      const w = leaf * 0.2;
      const tipX = bx + dx * leaf + px * leaf * 0.06;
      const tipY = by + dy * leaf + py * leaf * 0.06;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx + dx * leaf * 0.5 + px * w * 1.6, by + dy * leaf * 0.5 + py * w * 1.6, tipX, tipY);
      ctx.quadraticCurveTo(bx + dx * leaf * 0.5 - px * w * 0.4, by + dy * leaf * 0.5 - py * w * 0.4, bx, by);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

// A tiger stripe: a blade that runs from (cx, y0) down `len` metres, widest in the middle (`wmax` metres), tapering to a point at
// both ends, wandering a little (`amp` metres) and leaning (`lean` metres over its length).
function blade(ctx, cx, y0, len, wmax, amp, phase, lean) {
  const n = 40;
  const left = [];
  const right = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const x = cx + amp * Math.sin(TAU * 1.25 * s + phase) + lean * (s - 0.5);
    const hw = 0.5 * wmax * Math.pow(Math.sin(Math.PI * s), 0.7);
    left.push([x - hw, y0 + len * s]);
    right.push([x + hw, y0 + len * s]);
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (const [x, y] of left) ctx.lineTo(x, y);
  for (let i = n; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fill();
}

// Columns of blades over a W x H area, staggered, none touching the next along its column; deterministic.
function tigerMotif(ctx, W, H) {
  const rand = mulberry32(7141);
  const cols = Math.max(2, Math.round(W / 0.055));
  for (let c = 0; c < cols; c++) {
    const cx = ((c + 0.5) / cols) * W;
    const start = rand() * H;
    let cursor = start;
    for (let guard = 0; guard < 8; guard++) {
      const gap = 0.022 + rand() * 0.02;
      let len = 0.085 + rand() * 0.1;
      const room = start + H - cursor - gap;
      if (room < 0.06) break;
      len = Math.min(len, room);
      blade(ctx, cx, cursor, len, 0.017 + rand() * 0.012, 0.004 + rand() * 0.006, rand() * TAU, (rand() - 0.5) * 0.03);
      cursor += len + gap;
    }
  }
}

function palmMotif(ctx, W, H) {
  // two fronds head to tail down the tile (the tile is a third as wide as it is tall), the second shifted across
  frond(ctx, 0.3 * W, 0.97 * H, (-85 * Math.PI) / 180, 0.51 * H);
  frond(ctx, 0.78 * W, 0.0 * H, (95 * Math.PI) / 180, 0.51 * H);
}

function chevronMotif(ctx, W, H) {
  const y0 = 0.2 * H;
  const drop = 0.55 * H;
  const thick = 0.46 * H;
  ctx.beginPath();
  ctx.moveTo(0, y0);
  ctx.lineTo(W / 2, y0 + drop);
  ctx.lineTo(W, y0);
  ctx.lineTo(W, y0 + thick);
  ctx.lineTo(W / 2, y0 + drop + thick);
  ctx.lineTo(0, y0 + thick);
  ctx.closePath();
  ctx.fill();
}

function sunburstMotif(ctx, W, H) {
  // two suns in a half-drop, 12 rays each (disc 1.1 cm, rays from 1.7 cm to 5 cm at the 12.5 cm tile width)
  const k = W / 0.125;
  sun(ctx, 0.25 * W, 0.25 * H, 0.011 * k, 0.017 * k, 0.05 * k, 12);
  sun(ctx, 0.75 * W, 0.75 * H, 0.011 * k, 0.017 * k, 0.05 * k, 12);
}

// Side panels, one each side of the body (a quarter turn either side of the front), each a solid strip with a thin gap and a thin
// line beside it; a double pin line down the middle of the back; and a fine seam line down the front where the tile wraps.
// W is one full turn round the part.
function panelsMotif(ctx, W, H) {
  for (const c of [0.25, 0.75]) {
    ctx.fillRect((c - 0.032) * W, 0, 0.064 * W, H);
    ctx.fillRect((c - 0.052) * W, 0, 0.008 * W, H);
    ctx.fillRect((c + 0.044) * W, 0, 0.008 * W, H);
  }
  for (const s of [-1, 1]) ctx.fillRect((0.5 + s * 0.018 - 0.004) * W, 0, 0.008 * W, H);
  ctx.fillRect(-0.006 * W, 0, 0.012 * W, H);
}

// size is the tile in metres (width round the part, height along it); px is the mask size. swap lists the garment styles whose
// stripes run the other way. around forces the repeat count round the part (a panel tile is one whole turn).
const TILES = {
  stripes: { px: [192, 192], motif: (c, W, H) => c.fillRect(0, 0.25 * H, W, 0.5 * H), swap: ["trunks"] },
  chevron: { px: [256, 192], motif: chevronMotif },
  sunburst: { px: [256, 512], motif: sunburstMotif },
  palm: { px: [256, 512], motif: palmMotif },
  tiger: { px: [256, 512], motif: tigerMotif },
  panels: { px: [1024, 64], size: [1, 1], around: 1, motif: panelsMotif },
};

function tileSize(tile) {
  return tile.size || [tile.px[0] / PPM, tile.px[1] / PPM];
}

/** How a garment print repeats: the tile in metres, whether it runs the other way on this style, and a forced repeat count. null for solid. */
export function printSpec(pattern, style) {
  if (pattern === "solid") return null;
  const tile = TILES[pattern];
  if (!tile) throw new Error(`unknown print pattern "${pattern}"; known: ${PRINT_PATTERNS.join(", ")}`);
  const [tw, th] = tileSize(tile);
  return { tile: { tw, th, w: tile.px[0], h: tile.px[1] }, swap: !!tile.swap?.includes(style), around: tile.around ?? null };
}

/** The mask of one garment tile: { data (bytes, row 0 = v 0), w, h }. */
export function drawGarmentMask(pattern) {
  const tile = TILES[pattern];
  if (!tile) throw new Error(`unknown garment print pattern "${pattern}"; known: ${Object.keys(TILES).join(", ")}`);
  const [w, h] = tile.px;
  const [W, H] = tileSize(tile);
  const data = raster(w, h, (ctx) => {
    ctx.setTransform(w / W, 0, 0, h / H, 0, 0);
    repeat9(ctx, W, H, (c) => tile.motif(c, W, H));
  });
  return { data, w, h };
}

// ---- board prints -------------------------------------------------------------------------------------------------------
// Drawn in board space: x across (right is +), z along (the nose at -z). `box` is the print layout from board.js.

const BOARD = {
  stripes(ctx, { xMax, zMin, zMax }) {
    const length = zMax - zMin;
    const n = Math.max(4, Math.round(length / 0.3));
    const p = length / n;
    for (let k = 0; k < n; k++) ctx.fillRect(-xMax - 0.02, zMin + (k + 0.27) * p, 2 * xMax + 0.04, 0.46 * p);
  },
  chevron(ctx, { xMax, zMin, zMax }) {
    // V bands pointing at the nose: z = apex + 0.9 |x|
    const length = zMax - zMin;
    const n = Math.max(4, Math.round(length / 0.36));
    const p = length / n;
    const X = xMax + 0.03;
    const slope = 0.9;
    for (let k = -2; k < n + 1; k++) {
      const apex = zMin + (k + 0.1) * p;
      ctx.beginPath();
      ctx.moveTo(-X, apex + slope * X);
      ctx.lineTo(0, apex);
      ctx.lineTo(X, apex + slope * X);
      ctx.lineTo(X, apex + slope * X + 0.46 * p);
      ctx.lineTo(0, apex + 0.46 * p);
      ctx.lineTo(-X, apex + slope * X + 0.46 * p);
      ctx.closePath();
      ctx.fill();
    }
  },
  sunburst(ctx, { zMin, zMax }) {
    // A setting sun, not a rising-sun flag: a half disc sitting on a horizon line near the nose (dome toward the nose, cut by two
    // thin horizontal gaps), a short fan of seven thin rays of different lengths, widths and spacing that thin out and stop
    // well short of the rails, and six shortening bars of sea below the horizon, running toward the tail. No full circle, no
    // evenly spaced wedges, no rays running off the board.
    const horizon = zMin + 0.34 * (zMax - zMin);
    const r = 0.12;
    ctx.beginPath();
    ctx.arc(0, horizon, r, Math.PI, 2 * Math.PI); // the half of the circle on the nose side of the horizon
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#000";
    for (const [cut, thick] of [[0.04, 0.009], [0.075, 0.011]]) ctx.fillRect(-r - 0.01, horizon - cut - thick, 2 * r + 0.02, thick);
    ctx.fillStyle = "#fff";
    // rays: [angle from the nose direction in degrees, length beyond the disc in metres, half width of the base in degrees]
    const fan = [[-71, 0.07, 2.6], [-47, 0.15, 3.4], [-26, 0.1, 2.4], [-5, 0.22, 3.8], [17, 0.12, 2.6], [40, 0.17, 3.2], [66, 0.08, 2.2]];
    for (const [deg, len, half] of fan) {
      const a = (deg * Math.PI) / 180;
      const start = r + 0.03;
      const point = (rad, da) => [Math.sin(a + da) * rad, horizon - Math.cos(a + da) * rad];
      const da = (half * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(...point(start, -da));
      ctx.lineTo(...point(start + len, 0));
      ctx.lineTo(...point(start, da));
      ctx.closePath();
      ctx.fill();
    }
    // the sea: bars centred under the sun, each shorter than the last, running back toward the tail and thinning out
    [[0.05, 0.34], [0.14, 0.29], [0.25, 0.23], [0.38, 0.18], [0.53, 0.12], [0.7, 0.07]].forEach(([drop, width], k) =>
      ctx.fillRect(-width / 2, horizon + drop, width, 0.016 - 0.002 * k),
    );
  },
  palm(ctx, box) {
    tiled(ctx, box, 2, "palm");
  },
  tiger(ctx, box) {
    tiled(ctx, box, 2, "tiger");
  },
  panels(ctx, { zMin, zMax }) {
    // Lengthwise panels: a centre panel with a gap and a fine line each side, and a second fine line out toward each rail.
    const z0 = zMin - 0.05;
    const h = zMax - zMin + 0.1;
    ctx.fillRect(-0.05, z0, 0.1, h);
    for (const s of [-1, 1]) {
      ctx.fillRect(s > 0 ? 0.064 : -0.064 - 0.009, z0, 0.009, h);
      ctx.fillRect(s > 0 ? 0.168 : -0.168 - 0.009, z0, 0.009, h);
    }
  },
};

// A garment tile motif drawn k times larger on a grid over the whole board plan, the grid centred across the board. Motifs spill
// over their cell edges just as they wrap on a garment, so neighbours join up.
function tiled(ctx, { xMax, zMin, zMax }, k, name) {
  const tile = TILES[name];
  const [tw, th] = tileSize(tile);
  const cols = Math.ceil((2 * xMax) / (tw * k)) + 2;
  const rows = Math.ceil((zMax - zMin) / (th * k)) + 2;
  const x0 = -(cols * tw * k) / 2;
  for (let r = -1; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.save();
      ctx.translate(x0 + c * tw * k, zMin + r * th * k);
      ctx.scale(k, k);
      tile.motif(ctx, tw, th);
      ctx.restore();
    }
  }
}

/** The mask of one board print over the plan view described by `layout` (geometry.userData.print from board.js): { data, w, h }. */
export function drawBoardMask(pattern, layout) {
  const draw = BOARD[pattern];
  if (!draw) throw new Error(`unknown board print pattern "${pattern}"; known: ${Object.keys(BOARD).join(", ")}`);
  const { xMax, zMin, ppm, width, height } = layout;
  const data = raster(width, height, (ctx) => {
    ctx.setTransform(ppm, 0, 0, ppm, xMax * ppm, -zMin * ppm);
    draw(ctx, layout);
  });
  return { data, w: width, h: height };
}

/** The patterns each kind of item can print (solid is the absence of a print). */
export const GARMENT_PATTERNS = Object.keys(TILES);
export const BOARD_PATTERNS = Object.keys(BOARD);

// ---- textures and their cache -------------------------------------------------------------------------------------------

const cache = new Map(); // key -> { texture, bytes }
const MAX_BOARD_TEXTURES = 6;

function maskTexture({ data, w, h }, repeat) {
  const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  tex.unpackAlignment = 1;
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function cached(key, make) {
  const hit = cache.get(key);
  if (hit) {
    printStats.hits++;
    cache.delete(key); // re-insert: the Map's order is the least-recently-used order
    cache.set(key, hit);
    return hit.texture;
  }
  const mask = make();
  const texture = maskTexture(mask.mask, mask.repeat);
  const bytes = Math.round(mask.mask.w * mask.mask.h * 1.34);
  texture.userData.printKey = key;
  cache.set(key, { texture, bytes });
  printStats.bytes += bytes;
  return texture;
}

/** The (cached) tile texture of a garment pattern. */
export function garmentTexture(pattern) {
  return cached(`garment:${pattern}`, () => ({ mask: drawGarmentMask(pattern), repeat: true }));
}

/** The (cached) mask texture of a board pattern on this board shape; layout is the hull's geometry.userData.print. */
export function boardTexture(pattern, shape, layout) {
  return cached(`board:${shape}:${pattern}`, () => ({ mask: drawBoardMask(pattern, layout), repeat: false }));
}

let zero = null;
/** A 1 x 1 mask of zeros: what a solid item samples. */
export function zeroTexture() {
  if (!zero) {
    zero = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
    zero.unpackAlignment = 1;
    zero.colorSpace = THREE.NoColorSpace;
    zero.wrapS = zero.wrapT = THREE.RepeatWrapping;
    zero.needsUpdate = true;
  }
  return zero;
}

/** Drop the least recently used board masks beyond MAX_BOARD_TEXTURES, never one in `inUse` (a Set of the textures on show). */
export function trimPrints(inUse) {
  const boards = [...cache].filter(([key]) => key.startsWith("board:"));
  let over = boards.length - MAX_BOARD_TEXTURES;
  for (const [key, entry] of boards) {
    if (over <= 0) break;
    if (inUse.has(entry.texture)) continue;
    entry.texture.dispose();
    printStats.bytes -= entry.bytes;
    printStats.evicted++;
    cache.delete(key);
    over--;
  }
}

/** What the cache holds, for the checks and the report: [{ key, w, h }]. */
export function printCacheEntries() {
  return [...cache].map(([key, e]) => ({ key, w: e.texture.image.width, h: e.texture.image.height, bytes: e.bytes }));
}

/** The keys the cache holds now (the Locker records them on opening, so it can drop what its thumbnails added on closing). */
export function printCacheKeys() {
  return new Set(cache.keys());
}

/** Dispose every cached mask whose key is not in `keep` and whose texture is not in `inUse` (a Set of textures on show). */
export function dropPrintsExcept(keep, inUse) {
  for (const [key, entry] of [...cache]) {
    if (keep.has(key) || inUse.has(entry.texture)) continue;
    entry.texture.dispose();
    printStats.bytes -= entry.bytes;
    printStats.evicted++;
    cache.delete(key);
  }
}
