// Mesh helpers for scripts/build-surfers.mjs.
//
// A Surface is an "expanded" triangle mesh: one entry per (base vertex, uv) pair, so a texture seam becomes two
// vertices. Fields:
//   n       vertex count
//   P       Float64Array(3n)  positions (meters)
//   UV      Float64Array(2n)  obj-convention uvs (origin bottom left); zeros where a part has no texture
//   INF     Array(n) of [[boneName, weight], ...] (at most 4, weights sum to 1)
//   A       { name: { dim, data: Float64Array(dim*n) } } extra per-vertex attributes carried through cuts
//           (smoothed position `PS`, garment `TRIM`, ...)
//   T       Array of vertex indices, three per triangle
// Everything that creates vertices (clip) interpolates P, UV, INF and every attribute in A.

export function makeSurface(n) {
  return { n, P: new Float64Array(n * 3), UV: new Float64Array(n * 2), INF: new Array(n), A: {}, T: [] };
}

export function addAttr(s, name, dim, fill = 0) {
  s.A[name] = { dim, data: new Float64Array(dim * s.n).fill(fill) };
  return s.A[name].data;
}

// Surface from a base-mesh group. positions: Float64Array of the (morphed) base mesh in meters, uvs: Float64Array
// of obj vt pairs, infl: per base vertex influence lists, tv/tt: triangulated vertex / uv index lists.
export function surfaceFromBase(positions, uvs, infl, tv, tt) {
  const key = new Map();
  const src = [];
  const tris = [];
  for (let i = 0; i < tv.length; i++) {
    const k = tv[i] * 65536 * 4 + (tt[i] + 1);
    let id = key.get(k);
    if (id === undefined) {
      id = src.length;
      key.set(k, id);
      src.push([tv[i], tt[i]]);
    }
    tris.push(id);
  }
  const s = makeSurface(src.length);
  src.forEach(([v, t], i) => {
    s.P[i * 3] = positions[v * 3];
    s.P[i * 3 + 1] = positions[v * 3 + 1];
    s.P[i * 3 + 2] = positions[v * 3 + 2];
    if (t >= 0) {
      s.UV[i * 2] = uvs[t * 2];
      s.UV[i * 2 + 1] = uvs[t * 2 + 1];
    }
    s.INF[i] = infl ? infl[v] : [["root", 1]];
  });
  s.T = tris;
  return s;
}

// Smooth normals. Vertices at the same position (a uv seam) share one normal, so lighting has no seam.
export function weldKeys(s) {
  const map = new Map();
  const id = new Int32Array(s.n);
  for (let i = 0; i < s.n; i++) {
    const k = `${Math.round(s.P[i * 3] * 1e4)},${Math.round(s.P[i * 3 + 1] * 1e4)},${Math.round(s.P[i * 3 + 2] * 1e4)}`;
    let w = map.get(k);
    if (w === undefined) {
      w = map.size;
      map.set(k, w);
    }
    id[i] = w;
  }
  return { id, count: map.size };
}

export function computeNormals(s, welded = weldKeys(s)) {
  const acc = new Float64Array(welded.count * 3);
  const P = s.P;
  for (let i = 0; i < s.T.length; i += 3) {
    const a = s.T[i] * 3;
    const b = s.T[i + 1] * 3;
    const c = s.T[i + 2] * 3;
    const ax = P[b] - P[a];
    const ay = P[b + 1] - P[a + 1];
    const az = P[b + 2] - P[a + 2];
    const bx = P[c] - P[a];
    const by = P[c + 1] - P[a + 1];
    const bz = P[c + 2] - P[a + 2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    for (let k = 0; k < 3; k++) {
      const w = welded.id[s.T[i + k]] * 3;
      acc[w] += nx;
      acc[w + 1] += ny;
      acc[w + 2] += nz;
    }
  }
  const N = new Float64Array(s.n * 3);
  for (let i = 0; i < s.n; i++) {
    const w = welded.id[i] * 3;
    const len = Math.hypot(acc[w], acc[w + 1], acc[w + 2]) || 1;
    N[i * 3] = acc[w] / len;
    N[i * 3 + 1] = acc[w + 1] / len;
    N[i * 3 + 2] = acc[w + 2] / len;
  }
  return N;
}

// True when the triangles' normals point away from the surface's centroid on average (outward winding).
export function windsOutward(s) {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < s.n; i++) {
    cx += s.P[i * 3];
    cy += s.P[i * 3 + 1];
    cz += s.P[i * 3 + 2];
  }
  cx /= s.n;
  cy /= s.n;
  cz /= s.n;
  let dot = 0;
  const P = s.P;
  for (let i = 0; i < s.T.length; i += 3) {
    const a = s.T[i] * 3;
    const b = s.T[i + 1] * 3;
    const c = s.T[i + 2] * 3;
    const ax = P[b] - P[a];
    const ay = P[b + 1] - P[a + 1];
    const az = P[b + 2] - P[a + 2];
    const bx = P[c] - P[a];
    const by = P[c + 1] - P[a + 1];
    const bz = P[c + 2] - P[a + 2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    dot += nx * (P[a] - cx) + ny * (P[a + 1] - cy) + nz * (P[a + 2] - cz);
  }
  return dot >= 0;
}

export function flipWinding(s) {
  for (let i = 0; i < s.T.length; i += 3) {
    const t = s.T[i + 1];
    s.T[i + 1] = s.T[i + 2];
    s.T[i + 2] = t;
  }
}

// Taubin smoothing (a shrink step then an inflate step, so volume is roughly kept) over welded adjacency.
// Returns smoothed positions for every vertex of s.
export function taubinSmooth(s, iterations, lambda = 0.5, mu = -0.53) {
  const welded = weldKeys(s);
  const nbr = Array.from({ length: welded.count }, () => new Set());
  for (let i = 0; i < s.T.length; i += 3) {
    const ids = [welded.id[s.T[i]], welded.id[s.T[i + 1]], welded.id[s.T[i + 2]]];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (a !== b && ids[a] !== ids[b]) nbr[ids[a]].add(ids[b]);
  }
  const pos = new Float64Array(welded.count * 3);
  for (let i = 0; i < s.n; i++) {
    const w = welded.id[i] * 3;
    pos[w] = s.P[i * 3];
    pos[w + 1] = s.P[i * 3 + 1];
    pos[w + 2] = s.P[i * 3 + 2];
  }
  let cur = pos;
  const step = (src, k) => {
    const out = new Float64Array(src.length);
    for (let w = 0; w < welded.count; w++) {
      const list = nbr[w];
      if (!list.size) {
        out[w * 3] = src[w * 3];
        out[w * 3 + 1] = src[w * 3 + 1];
        out[w * 3 + 2] = src[w * 3 + 2];
        continue;
      }
      let mx = 0;
      let my = 0;
      let mz = 0;
      for (const n of list) {
        mx += src[n * 3];
        my += src[n * 3 + 1];
        mz += src[n * 3 + 2];
      }
      mx /= list.size;
      my /= list.size;
      mz /= list.size;
      out[w * 3] = src[w * 3] + k * (mx - src[w * 3]);
      out[w * 3 + 1] = src[w * 3 + 1] + k * (my - src[w * 3 + 1]);
      out[w * 3 + 2] = src[w * 3 + 2] + k * (mz - src[w * 3 + 2]);
    }
    return out;
  };
  for (let it = 0; it < iterations; it++) {
    cur = step(cur, lambda);
    cur = step(cur, mu);
  }
  const out = new Float64Array(s.n * 3);
  for (let i = 0; i < s.n; i++) {
    const w = welded.id[i] * 3;
    out[i * 3] = cur[w];
    out[i * 3 + 1] = cur[w + 1];
    out[i * 3 + 2] = cur[w + 2];
  }
  return out;
}

function mergeInfluence(a, b, t) {
  const m = new Map();
  for (const [bone, w] of a) m.set(bone, (m.get(bone) || 0) + w * (1 - t));
  for (const [bone, w] of b) m.set(bone, (m.get(bone) || 0) + w * t);
  const list = [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
  let sum = 0;
  for (const e of list) sum += e[1];
  return list.map(([bone, w]) => [bone, w / sum]);
}

// Keep the part of s where field(i) >= 0, cutting triangles exactly along the zero line (edge intersections are
// linear in the field). Returns a new Surface; if keepBoth is true returns [kept, dropped] with duplicated
// vertices on the cut so each side can be styled separately.
//
// exact (optional): a function (x, y, z) -> value giving the same field at any position. With it the cut points are not the linear
// interpolation of the vertex values along each edge (which misplaces the line wherever the field is not linear across the edge:
// the outline then wobbles from edge to edge) but the true zero of the field along the edge, found by bisection, so the border
// is the smooth curve the field describes, to the length of a triangle edge.
export function clip(s, field, keepBoth = false, exact = null) {
  const f = new Float64Array(s.n);
  for (let i = 0; i < s.n; i++) f[i] = exact ? exact(s.P[i * 3], s.P[i * 3 + 1], s.P[i * 3 + 2]) : field(i);
  const names = Object.keys(s.A);
  const sides = [makeBuilder(s, names), keepBoth ? makeBuilder(s, names) : null];
  const edgeCache = [new Map(), new Map()];
  const cut = (side, a, b) => {
    const k = a < b ? a * s.n + b : b * s.n + a;
    let id = edgeCache[side].get(k);
    if (id === undefined) {
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      let t = f[lo] / (f[lo] - f[hi]);
      if (exact) {
        let a0 = 0;
        let a1 = 1;
        const at = (u) => exact(
          s.P[lo * 3] + (s.P[hi * 3] - s.P[lo * 3]) * u,
          s.P[lo * 3 + 1] + (s.P[hi * 3 + 1] - s.P[lo * 3 + 1]) * u,
          s.P[lo * 3 + 2] + (s.P[hi * 3 + 2] - s.P[lo * 3 + 2]) * u,
        );
        const sign0 = f[lo] >= 0;
        for (let it = 0; it < 40; it++) {
          const mid = (a0 + a1) / 2;
          if (at(mid) >= 0 === sign0) a0 = mid;
          else a1 = mid;
        }
        t = (a0 + a1) / 2;
      }
      id = sides[side].lerp(lo, hi, t);
      edgeCache[side].set(k, id);
    }
    return id;
  };
  for (let i = 0; i < s.T.length; i += 3) {
    const v = [s.T[i], s.T[i + 1], s.T[i + 2]];
    for (let side = 0; side < (keepBoth ? 2 : 1); side++) {
      const sign = side === 0 ? 1 : -1;
      const inside = v.map((id) => (f[id] * sign >= 0 && !(f[id] === 0 && sign < 0) ? 1 : 0));
      const count = inside[0] + inside[1] + inside[2];
      if (count === 0) continue;
      const b = sides[side];
      if (count === 3) {
        b.tri(b.vert(v[0]), b.vert(v[1]), b.vert(v[2]));
        continue;
      }
      if (count === 1) {
        const k = inside.indexOf(1);
        const a = v[k];
        const o1 = v[(k + 1) % 3];
        const o2 = v[(k + 2) % 3];
        b.tri(b.vert(a), cut(side, a, o1), cut(side, a, o2));
      } else {
        const k = inside.indexOf(0);
        const o = v[k];
        const i1 = v[(k + 1) % 3];
        const i2 = v[(k + 2) % 3];
        const c1 = cut(side, i1, o);
        const c2 = cut(side, i2, o);
        b.tri(b.vert(i1), b.vert(i2), c2);
        b.tri(b.vert(i1), c2, c1);
      }
    }
  }
  const out = sides.map((b) => (b ? b.finish() : null));
  return keepBoth ? out : out[0];
}

function makeBuilder(s, names) {
  const map = new Map();
  const P = [];
  const UV = [];
  const INF = [];
  const A = Object.fromEntries(names.map((n) => [n, []]));
  const T = [];
  const push = (get) => {
    P.push(...get.P);
    UV.push(...get.UV);
    INF.push(get.INF);
    for (const n of names) A[n].push(...get.A[n]);
    return INF.length - 1;
  };
  const read = (i) => ({
    P: [s.P[i * 3], s.P[i * 3 + 1], s.P[i * 3 + 2]],
    UV: [s.UV[i * 2], s.UV[i * 2 + 1]],
    INF: s.INF[i],
    A: Object.fromEntries(names.map((n) => [n, Array.from(s.A[n].data.subarray(i * s.A[n].dim, (i + 1) * s.A[n].dim))])),
  });
  return {
    vert(i) {
      let id = map.get(i);
      if (id === undefined) {
        id = push(read(i));
        map.set(i, id);
      }
      return id;
    },
    lerp(a, b, t) {
      const ra = read(a);
      const rb = read(b);
      const mix = (x, y) => x.map((v, k) => v + (y[k] - v) * t);
      return push({
        P: mix(ra.P, rb.P),
        UV: mix(ra.UV, rb.UV),
        INF: mergeInfluence(ra.INF, rb.INF, t),
        A: Object.fromEntries(names.map((n) => [n, mix(ra.A[n], rb.A[n])])),
      });
    },
    tri(a, b, c) {
      T.push(a, b, c);
    },
    finish() {
      const out = makeSurface(INF.length);
      out.P.set(P);
      out.UV.set(UV);
      out.INF = INF;
      for (const n of names) out.A[n] = { dim: s.A[n].dim, data: Float64Array.from(A[n]) };
      out.T = T;
      return out;
    },
  };
}

// Split every triangle into four at its edge midpoints (positions, uvs, influences and attributes are interpolated). The surface
// does not change; there are four times as many, half as long triangles, so a cut along a curve can follow it more closely.
export function subdivide(s) {
  const names = Object.keys(s.A);
  const b = makeBuilder(s, names);
  const mids = new Map();
  const mid = (x, y) => {
    const lo = Math.min(x, y);
    const hi = Math.max(x, y);
    const key = lo * s.n + hi;
    let id = mids.get(key);
    if (id === undefined) {
      id = b.lerp(lo, hi, 0.5);
      mids.set(key, id);
    }
    return id;
  };
  for (let i = 0; i < s.T.length; i += 3) {
    const [x, y, z] = [s.T[i], s.T[i + 1], s.T[i + 2]];
    const mxy = mid(x, y);
    const myz = mid(y, z);
    const mzx = mid(z, x);
    const vx = b.vert(x);
    const vy = b.vert(y);
    const vz = b.vert(z);
    b.tri(vx, mxy, mzx);
    b.tri(mxy, vy, myz);
    b.tri(mzx, myz, vz);
    b.tri(mxy, myz, mzx);
  }
  return b.finish();
}

// The border loops of a surface as arrays of [x, y, z], and the turning angle (degrees, between the directions of the two
// segments meeting at each point) along each loop: how sharp a corner the outline has. Segments under 1 mm are skipped.
export function hemReport(s, { tolerance = 1e-6, step = 0.003, window = 0.015 } = {}) {
  // vertices closer than `tolerance` metres are one point (a cut can land within a fraction of a millimetre of an existing vertex,
  // and the two copies of a vertex on a seam are at the same place)
  const cell = tolerance * 2;
  const grid = new Map();
  const id = new Int32Array(s.n).fill(-1);
  const pos = new Map();
  for (let i = 0; i < s.n; i++) {
    const x = s.P[i * 3];
    const y = s.P[i * 3 + 1];
    const z = s.P[i * 3 + 2];
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const cz = Math.floor(z / cell);
    let found = -1;
    for (let dx = -1; dx <= 1 && found < 0; dx++) {
      for (let dy = -1; dy <= 1 && found < 0; dy++) {
        for (let dz = -1; dz <= 1 && found < 0; dz++) {
          for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) || []) {
            const p = pos.get(j);
            if (Math.hypot(p[0] - x, p[1] - y, p[2] - z) <= tolerance) {
              found = j;
              break;
            }
          }
        }
      }
    }
    if (found < 0) {
      found = pos.size;
      pos.set(found, [x, y, z]);
      const key = `${cx},${cy},${cz}`;
      grid.set(key, [...(grid.get(key) || []), found]);
    }
    id[i] = found;
  }
  const welded = { id };
  const count = new Map();
  for (let i = 0; i < s.T.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = welded.id[s.T[i + k]];
      const b = welded.id[s.T[i + ((k + 1) % 3)]];
      if (a === b) continue;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      count.set(key, (count.get(key) || 0) + 1);
    }
  }
  const next = new Map();
  const degree = {};
  const deg = new Map();
  for (const [key, c] of count) {
    if (c !== 1) continue;
    for (const v of key.split("_")) deg.set(v, (deg.get(v) || 0) + 1);
  }
  for (const d of deg.values()) degree[d] = (degree[d] || 0) + 1;
  for (const [key, c] of count) {
    if (c !== 1) continue;
    const [a, b] = key.split("_").map(Number);
    for (const [u, v] of [[a, b], [b, a]]) next.set(u, [...(next.get(u) || []), v]);
  }
  const seen = new Set();
  const loops = [];
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [start];
    seen.add(start);
    let prev = -1;
    let cur = start;
    for (;;) {
      const opts = (next.get(cur) || []).filter((v) => v !== prev && !(seen.has(v) && v !== start));
      if (!opts.length) break;
      prev = cur;
      cur = opts[0];
      if (cur === start) break;
      seen.add(cur);
      loop.push(cur);
    }
    if (loop.length > 8) loops.push(loop.map((id) => pos.get(id)));
  }
  // Resample each loop every `step` metres along its length and measure the angle between the direction over the last `window` and
  // the direction over the next `window` at every sample: a smooth curve of radius r gives about window / r radians; a corner or a
  // stair-step gives tens of degrees more. (Measuring at the mesh's own vertices would count sub-millimetre jitter.)
  const hot = [];
  const turns = loops.map((loop) => {
    const lengths = [0];
    for (let i = 1; i < loop.length; i++) lengths.push(lengths[i - 1] + Math.hypot(loop[i][0] - loop[i - 1][0], loop[i][1] - loop[i - 1][1], loop[i][2] - loop[i - 1][2]));
    const closed = Math.hypot(loop[0][0] - loop[loop.length - 1][0], loop[0][1] - loop[loop.length - 1][1], loop[0][2] - loop[loop.length - 1][2]) < 0.02;
    const total = lengths[loop.length - 1] + (closed ? Math.hypot(loop[0][0] - loop[loop.length - 1][0], loop[0][1] - loop[loop.length - 1][1], loop[0][2] - loop[loop.length - 1][2]) : 0);
    const pts = [];
    for (let d = 0, seg = 0; d < total; d += step) {
      while (seg < loop.length - 1 && lengths[seg + 1] < d) seg++;
      const a = loop[seg];
      const b = loop[(seg + 1) % loop.length];
      const span = (seg + 1 < loop.length ? lengths[seg + 1] : total) - lengths[seg] || 1;
      const t = Math.min(1, (d - lengths[seg]) / span);
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
    const w = Math.max(2, Math.round(window / step));
    const angles = [];
    for (let i = 0; i < pts.length; i++) {
      if (!closed && (i < w || i >= pts.length - w)) continue;
      const a = pts[(i - w + pts.length) % pts.length];
      const b = pts[i];
      const c = pts[(i + w) % pts.length];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
      const d = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v) || 1);
      const deg = (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
      angles.push(deg);
      if (deg > 45) hot.push({ deg, at: b });
    }
    return angles;
  });
  return { loops, turns, degree, hot };
}

// Vertices that lie on a boundary edge (an edge used by exactly one triangle), by welded position.
export function boundaryVertices(s) {
  const welded = weldKeys(s);
  const edges = new Map();
  for (let i = 0; i < s.T.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = welded.id[s.T[i + k]];
      const b = welded.id[s.T[i + ((k + 1) % 3)]];
      const key = a < b ? a * welded.count + b : b * welded.count + a;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  const onBorder = new Set();
  for (const [key, count] of edges) {
    if (count !== 1) continue;
    onBorder.add(Math.floor(key / welded.count));
    onBorder.add(key % welded.count);
  }
  const flags = new Uint8Array(s.n);
  for (let i = 0; i < s.n; i++) if (onBorder.has(welded.id[i])) flags[i] = 1;
  return flags;
}

export function concat(list) {
  const names = Object.keys(list[0].A);
  const n = list.reduce((a, s) => a + s.n, 0);
  const out = makeSurface(n);
  for (const nm of names) out.A[nm] = { dim: list[0].A[nm].dim, data: new Float64Array(n * list[0].A[nm].dim) };
  let off = 0;
  for (const s of list) {
    out.P.set(s.P, off * 3);
    out.UV.set(s.UV, off * 2);
    for (let i = 0; i < s.n; i++) out.INF[off + i] = s.INF[i];
    for (const nm of names) out.A[nm].data.set(s.A[nm].data, off * s.A[nm].dim);
    for (const t of s.T) out.T.push(t + off);
    off += s.n;
  }
  return out;
}

export function triCount(s) {
  return s.T.length / 3;
}

// New surface with only the triangles for which keep(triIndex) is true; unused vertices are dropped.
export function subsetTriangles(s, keep) {
  const map = new Int32Array(s.n).fill(-1);
  const order = [];
  const T = [];
  for (let t = 0; t < s.T.length / 3; t++) {
    if (!keep(t)) continue;
    for (let k = 0; k < 3; k++) {
      const v = s.T[t * 3 + k];
      if (map[v] < 0) {
        map[v] = order.length;
        order.push(v);
      }
      T.push(map[v]);
    }
  }
  const out = makeSurface(order.length);
  order.forEach((v, i) => {
    out.P.set(s.P.subarray(v * 3, v * 3 + 3), i * 3);
    out.UV.set(s.UV.subarray(v * 2, v * 2 + 2), i * 2);
    out.INF[i] = s.INF[v];
  });
  for (const [name, a] of Object.entries(s.A)) {
    const data = new Float64Array(order.length * a.dim);
    order.forEach((v, i) => data.set(a.data.subarray(v * a.dim, (v + 1) * a.dim), i * a.dim));
    out.A[name] = { dim: a.dim, data };
  }
  out.T = T;
  return out;
}

// Keep only the connected piece (by welded position) with the largest surface area (not the most triangles: hands are
// dense). Cut-off hands, stray arm pieces and similar leftovers are dropped this way.
export function largestComponent(s) {
  const welded = weldKeys(s);
  const parent = Int32Array.from({ length: welded.count }, (_, i) => i);
  const find = (a) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  for (let i = 0; i < s.T.length; i += 3) {
    const a = find(welded.id[s.T[i]]);
    for (let k = 1; k < 3; k++) {
      const b = find(welded.id[s.T[i + k]]);
      if (a !== b) parent[b] = a;
    }
  }
  const count = new Map();
  for (let i = 0; i < s.T.length; i += 3) {
    const r = find(welded.id[s.T[i]]);
    const a = s.T[i] * 3;
    const b = s.T[i + 1] * 3;
    const c = s.T[i + 2] * 3;
    const ux = s.P[b] - s.P[a];
    const uy = s.P[b + 1] - s.P[a + 1];
    const uz = s.P[b + 2] - s.P[a + 2];
    const vx = s.P[c] - s.P[a];
    const vy = s.P[c + 1] - s.P[a + 1];
    const vz = s.P[c + 2] - s.P[a + 2];
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    count.set(r, (count.get(r) || 0) + area);
  }
  let best = -1;
  let bestN = -1;
  for (const [r, n] of count) {
    if (n > bestN) {
      best = r;
      bestN = n;
    }
  }
  return subsetTriangles(s, (t) => find(welded.id[s.T[t * 3]]) === best);
}

// Average a per-vertex vector field (dim values per vertex) with its welded neighbours, `iterations` times. Used to
// keep a garment's displacement from the body smooth, so cut lines and hems stay clean curves.
export function smoothVectors(s, data, dim, iterations, strength = 0.5) {
  const welded = weldKeys(s);
  const nbr = Array.from({ length: welded.count }, () => new Set());
  for (let i = 0; i < s.T.length; i += 3) {
    const ids = [welded.id[s.T[i]], welded.id[s.T[i + 1]], welded.id[s.T[i + 2]]];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (a !== b && ids[a] !== ids[b]) nbr[ids[a]].add(ids[b]);
  }
  let cur = new Float64Array(welded.count * dim);
  const cnt = new Float64Array(welded.count);
  for (let i = 0; i < s.n; i++) {
    const w = welded.id[i];
    for (let k = 0; k < dim; k++) cur[w * dim + k] += data[i * dim + k];
    cnt[w]++;
  }
  for (let w = 0; w < welded.count; w++) for (let k = 0; k < dim; k++) cur[w * dim + k] /= cnt[w] || 1;
  for (let it = 0; it < iterations; it++) {
    const next = new Float64Array(cur.length);
    for (let w = 0; w < welded.count; w++) {
      const list = nbr[w];
      for (let k = 0; k < dim; k++) {
        if (!list.size) {
          next[w * dim + k] = cur[w * dim + k];
          continue;
        }
        let m = 0;
        for (const n of list) m += cur[n * dim + k];
        m /= list.size;
        next[w * dim + k] = cur[w * dim + k] + strength * (m - cur[w * dim + k]);
      }
    }
    cur = next;
  }
  const out = new Float64Array(s.n * dim);
  for (let i = 0; i < s.n; i++) for (let k = 0; k < dim; k++) out[i * dim + k] = cur[welded.id[i] * dim + k];
  return out;
}

// Spread skin weights over the surface (in place): every vertex takes `strength` of its neighbours' average weights,
// `iterations` times, then keeps its four strongest bones. Loose cloth hangs away from the body, so a weight change
// that is invisible on the skin (the groin crease, where belly weights meet thigh weights) would stretch the cloth into
// a spike when the hip bends; spreading the weights lets the cloth fold instead.
export function smoothInfluences(s, iterations, strength = 0.6) {
  const welded = weldKeys(s);
  const nbr = Array.from({ length: welded.count }, () => new Set());
  for (let i = 0; i < s.T.length; i += 3) {
    const ids = [welded.id[s.T[i]], welded.id[s.T[i + 1]], welded.id[s.T[i + 2]]];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (a !== b && ids[a] !== ids[b]) nbr[ids[a]].add(ids[b]);
  }
  let cur = Array.from({ length: welded.count }, () => new Map());
  for (let i = 0; i < s.n; i++) {
    const m = cur[welded.id[i]];
    if (m.size) continue;
    for (const [bone, w] of s.INF[i]) m.set(bone, w);
  }
  for (let it = 0; it < iterations; it++) {
    const next = cur.map((own, w) => {
      const list = nbr[w];
      if (!list.size) return own;
      const out = new Map();
      for (const [bone, x] of own) out.set(bone, x * (1 - strength));
      for (const n of list) for (const [bone, x] of cur[n]) out.set(bone, (out.get(bone) || 0) + (x * strength) / list.size);
      return out;
    });
    cur = next;
  }
  const final = cur.map((m) => {
    const list = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    let sum = 0;
    for (const e of list) sum += e[1];
    return list.map(([bone, w]) => [bone, w / sum]);
  });
  for (let i = 0; i < s.n; i++) s.INF[i] = final[welded.id[i]];
}
