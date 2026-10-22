// Skin baking for scripts/build-surfers.mjs.
//
// MakeHuman's CC0 skins ship a diffuse map only (the .mhmat files name no normal, bump or occlusion map, and the hair
// .mhmat names no scalp mask), so two things are made here:
//   cavityColors  per-vertex shading from the body's own shape. A vertex that sits in a hollow (eye socket, side of
//                 the nose, under the brow and lip, collarbones, armpits) is darker than its smoothed neighbourhood.
//                 It is written as COLOR_0 and multiplies the skin colour; the game also uses it to make hollows rougher.
//   scalpMask     where the hair covers the skin. Each skin texel's outward normal ray is cast at the fitted hair mesh;
//                 where it hits an opaque part of the hair texture the texel is darkened to hair-root colour, so the
//                 gaps and the cut-out edge of the hair show a dark scalp, not a pale one, on every skin tone.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// body.A must hold PS (Taubin-smoothed, 24 iterations), PSL (Laplacian-smoothed, 30 iterations) and BN (body normals).
export function cavityColors(body) {
  const PS = body.A.PS.data;
  const PSL = body.A.PSL.data;
  const BN = body.A.BN.data;
  const out = new Float32Array(body.n * 3);
  const depth = (S, i) =>
    (S[i * 3] - body.P[i * 3]) * BN[i * 3] + (S[i * 3 + 1] - body.P[i * 3 + 1]) * BN[i * 3 + 1] + (S[i * 3 + 2] - body.P[i * 3 + 2]) * BN[i * 3 + 2];
  for (let i = 0; i < body.n; i++) {
    // positive depth = the smoothed surface lies outside the real one = a hollow
    // the Taubin pass leaves a +0.4 to +1 mm outward bias on open skin; only depth beyond that counts as a hollow
    const fine = clamp((depth(PS, i) - 0.0018) / 0.003, 0, 1);
    const wide = clamp((depth(PSL, i) - 0.002) / 0.01, 0, 1);
    const ao = clamp(1 - 0.48 * fine - 0.5 * wide, 0.36, 1);
    out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = ao;
  }
  // Normalise so the open skin (everything above the 20th percentile) is 1, separately for the head and neck and for the rest of
  // the body: the shading only redistributes light into the hollows, it does not make the skin darker, so the skin
  // calibration (which measures lit skin over the whole body) is unaffected.
  const NOT_HEAD = /^(root|pelvis|spine|breast|clavicle|shoulder|upperarm|lowerarm|wrist|metacarpal|finger|upperleg|lowerleg|foot|toe)/;
  const isHeadVertex = (i) => {
    let w = 0;
    for (const [b, x] of body.INF[i]) if (!NOT_HEAD.test(b)) w += x;
    return w > 0.5;
  };
  for (const head of [true, false]) {
    const ids = [];
    for (let i = 0; i < body.n; i++) if (isHeadVertex(i) === head) ids.push(i);
    const sorted = Float32Array.from(ids.map((i) => out[i * 3])).sort();
    const ref = sorted[Math.floor(sorted.length * 0.1)];
    for (const i of ids) for (let k = 0; k < 3; k++) out[i * 3 + k] = Math.min(1, out[i * 3 + k] / ref); // never brighter than the plain skin
  }
  return out;
}

// Rasterise the skin triangles accepted by isHead into a size x size mask (1 = covered by opaque hair).
// body: Surface; normals: Float64Array(3n) outward body normals; hair: Surface (P, UV, T); alpha: { w, h, data (RGBA) }.
export function scalpMask({ body, normals, hair, alpha, size, isHead }) {
  // grid of hair triangles
  const CELL = 0.02;
  const key = (x, y, z) => `${x},${y},${z}`;
  const grid = new Map();
  const ht = hair.T;
  for (let t = 0; t < ht.length / 3; t++) {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 3; k++) {
      for (let c = 0; c < 3; c++) {
        const v = hair.P[ht[t * 3 + k] * 3 + c];
        lo[c] = Math.min(lo[c], v);
        hi[c] = Math.max(hi[c], v);
      }
    }
    for (let x = Math.floor(lo[0] / CELL); x <= Math.floor(hi[0] / CELL); x++) {
      for (let y = Math.floor(lo[1] / CELL); y <= Math.floor(hi[1] / CELL); y++) {
        for (let z = Math.floor(lo[2] / CELL); z <= Math.floor(hi[2] / CELL); z++) {
          const k = key(x, y, z);
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(t);
        }
      }
    }
  }
  const alphaAt = (u, v) => {
    const x = clamp(Math.floor(u * alpha.w), 0, alpha.w - 1);
    const y = clamp(Math.floor((1 - v) * alpha.h), 0, alpha.h - 1);
    return alpha.data[(y * alpha.w + x) * 4 + 3] / 255;
  };
  const REACH = 0.05;
  const seen = new Set();
  const cast = (px, py, pz, nx, ny, nz) => {
    seen.clear();
    let best = 0;
    for (let s = 0; s <= REACH; s += CELL * 0.5) {
      const k = key(Math.floor((px + nx * s) / CELL), Math.floor((py + ny * s) / CELL), Math.floor((pz + nz * s) / CELL));
      const list = grid.get(k);
      if (!list) continue;
      for (const t of list) {
        if (seen.has(t)) continue;
        seen.add(t);
        const a = ht[t * 3] * 3;
        const b = ht[t * 3 + 1] * 3;
        const c = ht[t * 3 + 2] * 3;
        const e1x = hair.P[b] - hair.P[a];
        const e1y = hair.P[b + 1] - hair.P[a + 1];
        const e1z = hair.P[b + 2] - hair.P[a + 2];
        const e2x = hair.P[c] - hair.P[a];
        const e2y = hair.P[c + 1] - hair.P[a + 1];
        const e2z = hair.P[c + 2] - hair.P[a + 2];
        // Moller-Trumbore, double sided
        const hx = ny * e2z - nz * e2y;
        const hy = nz * e2x - nx * e2z;
        const hz = nx * e2y - ny * e2x;
        const det = e1x * hx + e1y * hy + e1z * hz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        const sx = px - hair.P[a];
        const sy = py - hair.P[a + 1];
        const sz = pz - hair.P[a + 2];
        const u = (sx * hx + sy * hy + sz * hz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y;
        const qy = sz * e1x - sx * e1z;
        const qz = sx * e1y - sy * e1x;
        const v = (nx * qx + ny * qy + nz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (dist < 0 || dist > REACH) continue;
        const w = 1 - u - v;
        const ia = ht[t * 3];
        const ib = ht[t * 3 + 1];
        const ic = ht[t * 3 + 2];
        const tu = w * hair.UV[ia * 2] + u * hair.UV[ib * 2] + v * hair.UV[ic * 2];
        const tv = w * hair.UV[ia * 2 + 1] + u * hair.UV[ib * 2 + 1] + v * hair.UV[ic * 2 + 1];
        best = Math.max(best, alphaAt(tu, tv));
      }
    }
    return best;
  };

  const mask = new Float32Array(size * size);
  for (let t = 0; t < body.T.length / 3; t++) {
    if (!isHead(t)) continue;
    const ids = [body.T[t * 3], body.T[t * 3 + 1], body.T[t * 3 + 2]];
    const uv = ids.map((i) => [body.UV[i * 2] * size, (1 - body.UV[i * 2 + 1]) * size]);
    const minX = Math.max(0, Math.floor(Math.min(...uv.map((p) => p[0]))));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(...uv.map((p) => p[0]))));
    const minY = Math.max(0, Math.floor(Math.min(...uv.map((p) => p[1]))));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(...uv.map((p) => p[1]))));
    const [a, b, c] = uv;
    const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(den) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const l0 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / den;
        const l1 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / den;
        const l2 = 1 - l0 - l1;
        if (l0 < -0.02 || l1 < -0.02 || l2 < -0.02) continue;
        const P = [0, 1, 2].map((k) => l0 * body.P[ids[0] * 3 + k] + l1 * body.P[ids[1] * 3 + k] + l2 * body.P[ids[2] * 3 + k]);
        const N = [0, 1, 2].map((k) => l0 * normals[ids[0] * 3 + k] + l1 * normals[ids[1] * 3 + k] + l2 * normals[ids[2] * 3 + k]);
        const nl = Math.hypot(...N) || 1;
        const v = cast(P[0], P[1], P[2], N[0] / nl, N[1] / nl, N[2] / nl);
        if (v > mask[y * size + x]) mask[y * size + x] = v;
      }
    }
  }
  // widen by a few texels and soften (about 2 to 3 mm), so strand gaps and the cut-out edge sit on a dark ground that
  // fades into the forehead like hair roots instead of ending on a hard line
  return blur(dilate(mask, size, 5), size, 6);
}

function dilate(m, size, r) {
  const tmp = new Float32Array(m.length);
  const out = new Float32Array(m.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (let k = -r; k <= r; k++) v = Math.max(v, m[y * size + clamp(x + k, 0, size - 1)]);
      tmp[y * size + x] = v;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (let k = -r; k <= r; k++) v = Math.max(v, tmp[clamp(y + k, 0, size - 1) * size + x]);
      out[y * size + x] = v;
    }
  }
  return out;
}

function blur(m, size, r) {
  const tmp = new Float32Array(m.length);
  const out = new Float32Array(m.length);
  const n = 2 * r + 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (let k = -r; k <= r; k++) v += m[y * size + clamp(x + k, 0, size - 1)];
      tmp[y * size + x] = v / n;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (let k = -r; k <= r; k++) v += tmp[clamp(y + k, 0, size - 1) * size + x];
      out[y * size + x] = v / n;
    }
  }
  return out;
}

// Darken a detail map (RGBA, 8 bit) where the scalp mask is set: down to `floor` of its value under full hair.
export function darkenScalp(img, mask, floor) {
  for (let i = 0; i < mask.length; i++) {
    const f = 1 - (1 - floor) * smoothstep(0.12, 0.65, mask[i]);
    img.data[i * 4] *= f;
    img.data[i * 4 + 1] *= f;
    img.data[i * 4 + 2] *= f;
  }
  return img;
}
