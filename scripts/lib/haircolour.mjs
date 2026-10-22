// Re-colours a hair diffuse map (RGBA, 8 bit) so the hair has the colour and the sun-bleached streaks a surfer's hair
// would have. The CC0 maps are one fixed colour each (short04 is near black, ponytail01 brown with orange tips); the game
// can only multiply a map by one tint, which cannot turn black into blond, so the colour is set here.
//
// For every texel the source luminance l (0..1, the strand detail: dark between strands, light on them) is stretched over
// the map's own range and used to blend from `shade` (hair in shadow, roots) to `light` (hair in light). A second term
// adds sun streaks: low-frequency value noise stretched along v (strands run mostly along v in these maps) pushes some
// strand bundles toward `bleach`. All colours are sRGB 0..255. Alpha is not touched.
function hash(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, seed);
  const b = hash(x0 + 1, y0, seed);
  const c = hash(x0, y0 + 1, seed);
  const d = hash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function tintHair(img, { shade, light, bleach, streakAmount, streakScale, seed = 7 }) {
  const { w, h, data } = img;
  const lum = new Float32Array(w * h);
  const hist = [];
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] < 128) continue;
    lum[i] = (data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11) / 255;
    hist.push(lum[i]);
  }
  hist.sort((p, q) => p - q);
  const lo = hist[Math.floor(hist.length * 0.03)];
  const hi = hist[Math.floor(hist.length * 0.97)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      let t = Math.max(0, Math.min(1, (lum[i] - lo) / (hi - lo || 1)));
      t = t * t * (3 - 2 * t);
      // sun streaks: narrow in u, long in v
      const n = valueNoise((x / w) * streakScale, (y / h) * streakScale * 0.12, seed);
      const s = Math.max(0, Math.min(1, (n - 0.5) * 3 + 0.5)) * streakAmount;
      for (let c = 0; c < 3; c++) {
        const base = shade[c] + (light[c] - shade[c]) * t;
        data[o + c] = base + (bleach[c] - base) * s * (0.35 + 0.65 * t);
      }
    }
  }
  return img;
}
