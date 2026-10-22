// Garment shells cut from the body surface. Each garment is the part of the (morphed, skinned) body surface that the
// garment covers, cut exactly along smooth fields (iso-lines of a scalar, see mesh.mjs clip), then pushed out from the
// body: a blend toward a smoothed copy of the body (loose cloth bridges hollows such as the gluteal cleft instead of
// following them), plus an offset along the body normal, never less than a minimum clearance. Hems get a small flare
// and a trim band (waistband, cuffs, neck, leg openings) carried in the per-vertex TRIM attribute, which the game
// paints in the item's second colour. Garments share the body's skin weights (interpolated on cut edges).
//
// All numbers are metres in the MakeHuman rig frame (+y up, +z chest, +x the character's left).
import {
  addAttr,
  boundaryVertices,
  clip,
  computeNormals,
  concat,
  flipWinding,
  largestComponent,
  makeSurface,
  smoothInfluences,
  smoothVectors,
  subdivide,
  subsetTriangles,
  taubinSmooth,
  weldKeys,
} from "./mesh.mjs";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

const NOT_NECK_HEAD = /^(root|pelvis|spine|breast|clavicle|shoulder|upperarm|lowerarm|wrist|metacarpal|finger|upperleg|lowerleg|foot|toe)/;
const ARM = /^(clavicle|shoulder|upperarm|lowerarm|wrist|metacarpal|finger)/;

function weightOn(s, i, test) {
  let w = 0;
  for (const [bone, x] of s.INF[i]) if (test(bone)) w += x;
  return w;
}
const neckHeadW = (s, i) => weightOn(s, i, (b) => !NOT_NECK_HEAD.test(b));
const armW = (s, i) => weightOn(s, i, (b) => ARM.test(b));

// Adds PS (smoothed position) and BN (body normal) to the body surface, which every cut carries along.
export function prepareBody(body) {
  const ps = addAttr(body, "PS", 3);
  ps.set(taubinSmooth(body, 24));
  // PSH: smoothed hard enough that the gluteal cleft and the creases of the groin fill in; loose cloth drapes over that
  addAttr(body, "PSH", 3).set(taubinSmooth(body, 140));
  // PSL: plain Laplacian smoothing (shrinks convex shapes, so only real hollows end up outside the surface); used for
  // the cavity shading in skinbake.mjs
  addAttr(body, "PSL", 3).set(taubinSmooth(body, 30, 0.5, 0));
  const bn = addAttr(body, "BN", 3);
  bn.set(computeNormals(body));
  addAttr(body, "TRIM", 1);
}

export function anatomy(body, joints) {
  const J = (n) => joints[n];
  const hipY = J("upperleg01.L____head")[1];
  const kneeY = J("lowerleg01.L____head")[1];
  let crotchY = Infinity;
  for (let i = 0; i < body.n; i++) {
    const x = body.P[i * 3];
    const y = body.P[i * 3 + 1];
    if (Math.abs(x) < 0.004 && y > kneeY && y < hipY && y < crotchY) crotchY = y;
  }
  const mirrorX = (name) => J(name).map((v, k) => (k === 0 ? Math.abs(v) : v));
  return {
    hipY,
    kneeY,
    crotchY,
    ankleY: J("foot.L____head")[1],
    shoulderY: J("shoulder01.L____head")[1],
    neckY: J("neck01____head")[1],
    apex: mirrorX("breast.L____tail"),
    elbow: mirrorX("lowerarm01.L____head"),
    wrist: mirrorX("wrist.L____head"),
    upperArm: mirrorX("upperarm01.L____head"),
  };
}

// `keep` fields are positive where the garment is. Several are intersected one after another.
function cutAll(body, fields) {
  let s = body;
  for (const make of fields) s = clip(s, make(s));
  return largestComponent(s);
}

// Split a band of width `width` (field units are metres) off the garment edge: inner part TRIM 0, band TRIM 1.
function withBand(s, make, width) {
  const [inner, edge] = clip(s, ((f) => (i) => f(i) - width)(make(s)), true);
  const parts = [];
  if (inner && inner.T.length) parts.push(inner);
  if (edge && edge.T.length) {
    edge.A.TRIM.data.fill(1);
    parts.push(edge);
  }
  return concat(parts);
}

// Final shape: out from the body.
//   loose(i) 0..1 blend toward the smoothed body, thick(i) offset along the body normal, minOff clearance,
//   flare(i) extra offset (hems), all per final vertex.
function shape(s, { loose, thick, minOff, flare = () => 0, smoothAttr = "PS", smoothing = 8 }) {
  const PS = s.A[smoothAttr].data;
  const BN = s.A.BN.data;
  // 1. the wanted displacement of every vertex from the body surface
  const D = new Float64Array(s.n * 3);
  for (let i = 0; i < s.n; i++) {
    const l = loose(i);
    const off = thick(i) + flare(i);
    for (let k = 0; k < 3; k++) D[i * 3 + k] = (PS[i * 3 + k] - s.P[i * 3 + k]) * l + BN[i * 3 + k] * off;
  }
  // 2. smooth that displacement over the garment, so the surface and its hems are clean curves
  const Ds = smoothing ? smoothVectors(s, D, 3, smoothing) : D;
  // 3. apply it, never closer to the body than minOff along the body normal
  for (let i = 0; i < s.n; i++) {
    const nx = BN[i * 3];
    const ny = BN[i * 3 + 1];
    const nz = BN[i * 3 + 2];
    let dx = Ds[i * 3];
    let dy = Ds[i * 3 + 1];
    let dz = Ds[i * 3 + 2];
    const d = dx * nx + dy * ny + dz * nz;
    if (d < minOff) {
      dx += nx * (minOff - d);
      dy += ny * (minOff - d);
      dz += nz * (minOff - d);
    }
    s.P[i * 3] += dx;
    s.P[i * 3 + 1] += dy;
    s.P[i * 3 + 2] += dz;
  }
  return s;
}

// Distance-to-edge helper: metres from a vertex to the nearest cut, from the same fields used to cut.
const minField = (makes) => (s) => {
  const fs = makes.map((m) => m(s));
  return (i) => Math.min(...fs.map((f) => f(i)));
};

// A tube (n sides) along a polyline of points. Each tube vertex takes the skin weights of the nearest vertex of
// `template` (the cloth it hangs on), so the cord follows the hip and thigh, not just the waist.
function tubeSurface(template, points, radii, sides) {
  const rings = points.length;
  const out = makeSurface(rings * sides);
  for (const [name, a] of Object.entries(template.A)) out.A[name] = { dim: a.dim, data: new Float64Array(out.n * a.dim) };
  for (let r = 0; r < rings; r++) {
    const p = points[r];
    const q = points[Math.min(rings - 1, r + 1)];
    const o = points[Math.max(0, r - 1)];
    let tx = q[0] - o[0];
    let ty = q[1] - o[1];
    let tz = q[2] - o[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    // two axes perpendicular to the tangent
    let ax = 1;
    let ay = 0;
    let az = 0;
    if (Math.abs(tx) > 0.9) {
      ax = 0;
      ay = 0;
      az = 1;
    }
    let ux = ty * az - tz * ay;
    let uy = tz * ax - tx * az;
    let uz = tx * ay - ty * ax;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = ty * uz - tz * uy;
    const vy = tz * ux - tx * uz;
    const vz = tx * uy - ty * ux;
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const i = r * sides + k;
      out.P[i * 3] = p[0] + (Math.cos(a) * ux + Math.sin(a) * vx) * radii[r];
      out.P[i * 3 + 1] = p[1] + (Math.cos(a) * uy + Math.sin(a) * vy) * radii[r];
      out.P[i * 3 + 2] = p[2] + (Math.cos(a) * uz + Math.sin(a) * vz) * radii[r];
      out.INF[i] = nearestInfluence(template, out.P[i * 3], out.P[i * 3 + 1], out.P[i * 3 + 2]);
      out.A.TRIM.data[i] = 1;
    }
  }
  for (let r = 0; r < rings - 1; r++) {
    for (let k = 0; k < sides; k++) {
      const a = r * sides + k;
      const b = r * sides + ((k + 1) % sides);
      out.T.push(a, a + sides, b, b, a + sides, b + sides);
    }
  }
  // make the winding face outward (the basis above has no fixed handedness)
  const a = out.T[0] * 3;
  const b = out.T[1] * 3;
  const c = out.T[2] * 3;
  const nx = (out.P[b + 1] - out.P[a + 1]) * (out.P[c + 2] - out.P[a + 2]) - (out.P[b + 2] - out.P[a + 2]) * (out.P[c + 1] - out.P[a + 1]);
  const ny = (out.P[b + 2] - out.P[a + 2]) * (out.P[c] - out.P[a]) - (out.P[b] - out.P[a]) * (out.P[c + 2] - out.P[a + 2]);
  const nz = (out.P[b] - out.P[a]) * (out.P[c + 1] - out.P[a + 1]) - (out.P[b + 1] - out.P[a + 1]) * (out.P[c] - out.P[a]);
  const ring0 = points[0];
  if (nx * (out.P[a] - ring0[0]) + ny * (out.P[a + 1] - ring0[1]) + nz * (out.P[a + 2] - ring0[2]) < 0) flipWinding(out);
  return out;
}

function nearestInfluence(s, x, y, z) {
  let best = Infinity;
  let at = 0;
  for (let i = 0; i < s.n; i++) {
    const d = (s.P[i * 3] - x) ** 2 + (s.P[i * 3 + 1] - y) ** 2 + (s.P[i * 3 + 2] - z) ** 2;
    if (d < best) {
      best = d;
      at = i;
    }
  }
  return s.INF[at];
}

// Highest-z garment vertex near (x, y): where the cloth surface is at the front of the hips.
function frontSurfaceZ(g, x, y, reach = 0.02) {
  let best = -Infinity;
  let at = -1;
  for (let i = 0; i < g.n; i++) {
    if (Math.abs(g.P[i * 3] - x) < reach && Math.abs(g.P[i * 3 + 1] - y) < reach && g.P[i * 3 + 2] > best) {
      best = g.P[i * 3 + 2];
      at = i;
    }
  }
  if (at < 0) throw new Error(`no garment vertex near x=${x}, y=${y}`);
  return { z: best, at };
}

// Drawstring: a knot at the front of the waistband and two cords hanging down the front of the thighs.
function drawstring(g, A) {
  const top = A.hipY + 0.118 - 0.022 * smooth(0.04, 0.12, 0.12); // waistband top at the front, as in trunks()
  const y0 = top - 0.028;
  const base = frontSurfaceZ(g, 0, y0);
  const parts = [];
  const knot = tubeSurface(g, [[0, y0, base.z + 0.004], [0, y0, base.z + 0.012], [0, y0, base.z + 0.02]], [0.007, 0.0105, 0.007], 8);
  parts.push(knot);
  for (const side of [-1, 1]) {
    const pts = [];
    const radii = [];
    const n = 9;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const x = side * (0.012 + 0.014 * t + 0.004 * Math.sin(t * 5));
      const y = y0 - 0.012 - t * 0.17;
      const s = frontSurfaceZ(g, x, y, 0.025);
      pts.push([x, y, s.z + 0.007 + 0.002 * Math.sin(t * 6)]);
      radii.push(0.0042 * (k === n - 1 ? 1.5 : 1));
    }
    parts.push(tubeSurface(g, pts, radii, 6));
  }
  return parts;
}

// Loose cloth does not follow the gluteal cleft: it bridges it. Trunks, board shorts and loose suits hang from the widest
// point of each cheek, so across the middle of the back the surface runs flat (or bulges a little) from one cheek to the
// other. For every vertex this takes the rear-most point of the garment within 2 cm above or below it (the cheek apex, the
// smallest z, among vertices no further than `reach` from the centre line) and pulls the vertex back to it, weighted by
// closeness to the centre (1 inside `core`, 0 outside `reach`). The displacement is smooth already (it is weighted by x and y), so it is not averaged again: averaging a thin column of
// large displacements against its neighbours is what left a groove.
// Without this the shell keeps the body's dark central crease and reads as a skin-tight garment.
function bridgeCleft(g, { yLo, yHi, core, reach, strength = 1, smoothing = 0 }) {
  const back = [];
  for (let i = 0; i < g.n; i++) {
    const y = g.P[i * 3 + 1];
    if (y >= yLo - 0.02 && y <= yHi && g.P[i * 3 + 2] < 0 && Math.abs(g.P[i * 3]) <= reach) back.push(i);
  }
  const D = new Float64Array(g.n * 3);
  const centre = new Float64Array(g.n);
  for (let i = 0; i < g.n; i++) {
    const y = g.P[i * 3 + 1];
    if (y < yLo || y > yHi) continue;
    const x = Math.abs(g.P[i * 3]);
    const z = g.P[i * 3 + 2];
    if (z > 0) continue; // the back only
    const wx = 1 - smooth(core, reach, x);
    // fade in along the height so the panel merges with the legs; the top edge (the waistband) runs straight across
    const wy = smooth(yLo, yLo + 0.03, y);
    centre[i] = wx * wy;
    if (wx * wy <= 0) continue;
    let rear = z;
    for (const j of back) if (Math.abs(g.P[j * 3 + 1] - y) < 0.02 && g.P[j * 3 + 2] < rear) rear = g.P[j * 3 + 2];
    D[i * 3 + 2] = (rear - z) * wx * wy * strength; // never forward, into the body: rear <= z
  }
  const Ds = smoothVectors(g, D, 3, smoothing);
  for (let i = 0; i < g.n; i++) g.P[i * 3 + 2] += Ds[i * 3 + 2];
  // The same panel must also move as one piece. The body's weights send each cheek to its own thigh and pelvis bone, so
  // when the legs bend by different amounts (a surfer's front and rear leg) the two halves swing apart and the bridge
  // folds along the centre line. Near the centre line the weights become the left/right average (each .L/.R bone gives half
  // its weight to its twin), fading back to the body's own weights at `reach`.
  for (let i = 0; i < g.n; i++) {
    const c = centre[i];
    if (c < 0.02) continue;
    const m = new Map();
    for (const [bone, w] of g.INF[i]) {
      m.set(bone, (m.get(bone) || 0) + w * (1 - c));
      const twin = bone.endsWith(".L") ? bone.slice(0, -2) + ".R" : bone.endsWith(".R") ? bone.slice(0, -2) + ".L" : null;
      if (twin) {
        m.set(bone, (m.get(bone) || 0) + w * c * 0.5);
        m.set(twin, (m.get(twin) || 0) + w * c * 0.5);
      } else {
        m.set(bone, (m.get(bone) || 0) + w * c);
      }
    }
    const list = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = list.reduce((a, e) => a + e[1], 0);
    g.INF[i] = list.map(([bone, w]) => [bone, w / sum]);
  }
}

export function trunks(body, A, kind) {
  if (kind !== "male") throw new Error("trunks are cut for the male body only");
  const waistTop = (s, i) => A.hipY + 0.118 - 0.022 * smooth(0.04, 0.12, s.P[i * 3 + 2]);
  const hemY = A.crotchY - 0.55 * (A.crotchY - A.kneeY);
  const waist = (s) => (i) => waistTop(s, i) - s.P[i * 3 + 1];
  const hem = (s) => (i) => s.P[i * 3 + 1] - hemY;
  let g = cutAll(body, [waist, hem]);
  g = withBand(g, waist, 0.05);
  const edge = minField([hem]);
  g = withBand(g, hem, 0.018);
  const e = edge(g);
  const waistDist = waist(g);
  // Board shorts are two legs, not a skirt. The strongly smoothed body (PSH) the loose cloth hangs from fills the gap between
  // the thighs, so below the crotch the cloth follows each thigh itself (loose falls to LEG_LOOSE over LEG_BLEND metres) and is
  // thinnest on the inner side of each leg, where the two legs face each other; the hem then stays two separate openings with
  // daylight between them, as in a real pair of shorts, and the crotch is a seam where the legs part.
  const LEG_LOOSE = 0.2;
  const LEG_BLEND = 0.05;
  const belowCrotch = (i) => smooth(0, LEG_BLEND, A.crotchY - g.P[i * 3 + 1]);
  const innerThigh = (i) => 1 - smooth(0.03, 0.09, Math.abs(g.P[i * 3]));
  const cloth = shape(g, {
    smoothAttr: "PSH",
    loose: (i) => 0.92 * smooth(-0.02, 0.06, g.P[i * 3 + 1] - hemY) * (1 - (1 - LEG_LOOSE / 0.92) * belowCrotch(i)),
    // snug over the hips and groin (a baggy pelvis stretches into spikes when the hip bends), baggier down the legs, but not
    // on the inner thigh
    thick: (i) =>
      (0.012 + 0.022 * smooth(0, 0.16, A.crotchY - g.P[i * 3 + 1])) * lerp(0.55, 1, smooth(0.005, 0.045, waistDist(i))) * (1 - 0.85 * belowCrotch(i) * innerThigh(i)),
    minOff: 0.007,
    flare: (i) => 0.012 * (1 - smooth(0, 0.03, e(i))),
  });
  smoothInfluences(cloth, 10, 0.7); // loose cloth folds at the hip crease instead of stretching into a spike
  bridgeCleft(cloth, { yLo: A.crotchY - 0.02, yHi: A.hipY + 0.13, core: 0.05, reach: 0.15 });
  return concat([cloth, ...drawstring(cloth, A)]);
}


// Distance (metres, straight line) from every vertex to the nearest vertex on the shell's border.
function borderDistance(g) {
  const flags = boundaryVertices(g);
  const border = [];
  for (let i = 0; i < g.n; i++) if (flags[i]) border.push(i);
  const d = new Float64Array(g.n);
  for (let i = 0; i < g.n; i++) {
    let best = Infinity;
    for (const b of border) {
      const q = (g.P[i * 3] - g.P[b * 3]) ** 2 + (g.P[i * 3 + 1] - g.P[b * 3 + 1]) ** 2 + (g.P[i * 3 + 2] - g.P[b * 3 + 2]) ** 2;
      if (q < best) best = q;
    }
    d[i] = Math.sqrt(best);
  }
  return d;
}

// ---- hem binding -------------------------------------------------------------------------------------------------------------
// The raw border of a cut shell follows triangle edges, so at the leg openings and waistband it shows tiny teeth and frayed corners.
// The binding makes each hem its own clean geometry: every border loop is resampled (points no closer than `spacing`) and smoothed
// along the loop (the shell's own border vertices move to the smoothed curve, so nothing is left sticking out), and a narrow tube
// (a few mm thick, `radius`) is swept along it, skinned like the cloth it is on. The tube is TRIM 1, so it is always the item's second
// colour; it covers the shell's raw boundary, so no sliver or fringe of the print can show at the edge.
function hemBinding(cloth, { radius = 0.0034, spacing = 0.0045, sides = 6, iterations = 8 } = {}) {
  const welded = weldKeys(cloth);
  const edgeCount = new Map();
  for (let i = 0; i < cloth.T.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = welded.id[cloth.T[i + k]];
      const b = welded.id[cloth.T[i + ((k + 1) % 3)]];
      const key = a < b ? a * welded.count + b : b * welded.count + a;
      edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
    }
  }
  const next = new Map();
  for (const [key, c] of edgeCount) {
    if (c !== 1) continue;
    const a = Math.floor(key / welded.count);
    const b = key % welded.count;
    if (!next.has(a)) next.set(a, []);
    if (!next.has(b)) next.set(b, []);
    next.get(a).push(b);
    next.get(b).push(a);
  }
  const at = new Map(); // welded id -> the first cloth vertex there
  for (let i = cloth.n - 1; i >= 0; i--) at.set(welded.id[i], i);
  const used = new Set();
  const tubes = [];
  const moved = new Map();
  const infMoved = new Map();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop = [start];
    used.add(start);
    for (;;) {
      const nb = next.get(loop[loop.length - 1]).find((n) => !used.has(n));
      if (nb === undefined) break;
      loop.push(nb);
      used.add(nb);
    }
    if (loop.length < 8) continue;
    const pts = loop.map((w) => [cloth.P[at.get(w) * 3], cloth.P[at.get(w) * 3 + 1], cloth.P[at.get(w) * 3 + 2]]);
    const closed = next.get(loop[0]).includes(loop[loop.length - 1]);
    // Taubin smoothing along the loop (shrink then inflate, so the loop does not shrink)
    let cur = pts.map((p) => p.slice());
    const n = cur.length;
    for (let it = 0; it < iterations * 2; it++) {
      const lambda = it % 2 === 0 ? 0.5 : -0.53;
      const out = cur.map((p, k) => {
        if (!closed && (k === 0 || k === n - 1)) return p;
        const a = cur[(k + n - 1) % n];
        const b = cur[(k + 1) % n];
        return [0, 1, 2].map((d) => p[d] + lambda * ((a[d] + b[d]) / 2 - p[d]));
      });
      cur = out;
    }
    loop.forEach((w, k) => moved.set(w, cur[k]));
    // skin weights too: along a cut the weights differ vertex to vertex, which makes the edge jitter when a hip bends; average them
    // along the loop so the whole hem moves as one
    let wts = loop.map((w) => new Map(cloth.INF[at.get(w)]));
    for (let it = 0; it < 8; it++) {
      wts = wts.map((m, k) => {
        const out = new Map();
        const add = (src, f) => {
          for (const [bone, x] of src) out.set(bone, (out.get(bone) || 0) + x * f);
        };
        add(m, 0.5);
        add(wts[(k + n - 1) % n], 0.25);
        add(wts[(k + 1) % n], 0.25);
        return out;
      });
    }
    const smoothedInf = wts.map((m) => {
      const list = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const tot = list.reduce((a, e) => a + e[1], 0);
      return list.map(([bone, x]) => [bone, x / tot]);
    });
    loop.forEach((w, k) => infMoved.set(w, smoothedInf[k]));
    // resample: keep a point only once it is `spacing` from the last kept one
    const kept = [0];
    for (let k = 1; k < n; k++) {
      const q = cur[kept[kept.length - 1]];
      if (Math.hypot(cur[k][0] - q[0], cur[k][1] - q[1], cur[k][2] - q[2]) >= spacing) kept.push(k);
    }
    if (closed && kept.length > 2) {
      const a = cur[kept[kept.length - 1]];
      const b = cur[0];
      if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < spacing * 0.6) kept.pop();
    }
    const centre = kept.map((k) => cur[k]); // the tube runs along the smoothed border itself, which is therefore inside it
    if (closed) centre.push(centre[0]);
    tubes.push(centre);
  }
  // the shell's own border vertices go to the smoothed curve
  for (let i = 0; i < cloth.n; i++) {
    const m = moved.get(welded.id[i]);
    if (m) {
      cloth.P[i * 3] = m[0];
      cloth.P[i * 3 + 1] = m[1];
      cloth.P[i * 3 + 2] = m[2];
      cloth.INF[i] = infMoved.get(welded.id[i]);
    }
  }
  return tubes.map((points) => tubeSurface(cloth, points, points.map(() => radius), sides));
}

// ---- the women's bikini bottom ----------------------------------------------------------------------------------------
// A fitted swimsuit bottom, unlike the men's board shorts: it hugs each cheek (a thin cloth, little pull toward the smoothed
// body), the waistband is narrow and sits on the hip bones, the back covers the whole seat, and the crease between the cheeks is made
// shallower, not bridged: loose cloth that spans the cleft (the trunks' cleft bridge at full strength) stands off the body as a flat
// panel and reads as a balloon on a bikini.
//
// The cut lines are smooth curves, defined as functions of position and cut exactly along them:
//   - the leg opening is a height h(u, z) above the crotch, u = |x| (made smooth at the centre line) and z front to back: a back
//     curve (the under-buttock fold, running across the seat and rising to the hip at the side) and a front curve (the groin line,
//     rising to the hip), blended smoothly with z; each rises from its centre height to the hip height by a smootherstep, so there
//     is no corner anywhere, at the crotch, across the seat or at the hip;
//   - the waistband is a straight line across the hip bones;
//   - the trim bands are an even width: their offset is measured as distance from the border (the field divided by the length of
//     its gradient), not as a height, which makes a band thin where the border is steep;
//   - the surface is subdivided once before cutting, so the border follows the curve to under a centimetre.
// The cut is Ed's choice of 2026-10-21 (of three that were rendered): B, a moderate high leg.
//   waist: the height of the one level waistband line above the hip joint (high enough that the top of the cleft is covered from
//   behind in every riding pose; no rise over the back); gap: how far the leg opening stays below the waistband at the hip; fold: the back
//   opening below the crotch at the middle of the seat; front: the front opening above the crotch at the middle; backRise /
//   frontRise: the u range over which each leg curve rises from its middle height to the hip height
const BIKINI_CUT = { waist: 0.062, gap: 0.057, fold: 0.03, front: 0.02, backRise: [0.01, 0.168], frontRise: [0.012, 0.15] };

const smootherstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

// A flat ribbon of binding lying on the garment along every border: `width` wide, `lift` above the cloth, always the second colour
// (TRIM 1). Its outer edge is the border itself, so the hem is flush with the skin; it takes the skin weights of the border vertex it
// starts from. `normals` are the outward normals of the garment's vertices.
function hemRibbon(cloth, normals, { width = 0.007, lift = 0.0004 } = {}) {
  const welded = weldKeys(cloth);
  const edgeCount = new Map();
  for (let i = 0; i < cloth.T.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = welded.id[cloth.T[i + k]];
      const b = welded.id[cloth.T[i + ((k + 1) % 3)]];
      const key = a < b ? a * welded.count + b : b * welded.count + a;
      edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
    }
  }
  const next = new Map();
  for (const [key, c] of edgeCount) {
    if (c !== 1) continue;
    const a = Math.floor(key / welded.count);
    const b = key % welded.count;
    if (!next.has(a)) next.set(a, []);
    if (!next.has(b)) next.set(b, []);
    next.get(a).push(b);
    next.get(b).push(a);
  }
  const at = new Map();
  for (let i = cloth.n - 1; i >= 0; i--) at.set(welded.id[i], i);
  // the way in from each border vertex: toward the mean of its neighbours that are not on the border
  const sum = new Map();
  for (let i = 0; i < cloth.T.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = welded.id[cloth.T[i + k]];
      if (!next.has(a)) continue;
      for (const m of [1, 2]) {
        const v = cloth.T[i + ((k + m) % 3)];
        if (next.has(welded.id[v])) continue;
        const e = sum.get(a) || [0, 0, 0, 0];
        e[0] += cloth.P[v * 3];
        e[1] += cloth.P[v * 3 + 1];
        e[2] += cloth.P[v * 3 + 2];
        e[3]++;
        sum.set(a, e);
      }
    }
  }
  const loops = [];
  const used = new Set();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop = [start];
    used.add(start);
    for (;;) {
      const nb = next.get(loop[loop.length - 1]).find((n) => !used.has(n));
      if (nb === undefined) break;
      loop.push(nb);
      used.add(nb);
    }
    if (loop.length >= 8) loops.push(loop);
  }
  const total = loops.reduce((a, l) => a + l.length * 2, 0);
  const out = makeSurface(total);
  for (const [name, a] of Object.entries(cloth.A)) addAttr(out, name, a.dim, name === "TRIM" ? 1 : 0);
  const outward = new Float64Array(total * 3);
  let off = 0;
  const quads = [];
  for (const loop of loops) {
    const n = loop.length;
    const closed = next.get(loop[0]).includes(loop[n - 1]);
    for (let k = 0; k < n; k++) {
      const src = at.get(loop[k]);
      const p = [cloth.P[src * 3], cloth.P[src * 3 + 1], cloth.P[src * 3 + 2]];
      const nn = [normals[src * 3], normals[src * 3 + 1], normals[src * 3 + 2]];
      const ia = at.get(loop[(k + n - 1) % n]);
      const ic = at.get(loop[(k + 1) % n]);
      const t = [cloth.P[ic * 3] - cloth.P[ia * 3], cloth.P[ic * 3 + 1] - cloth.P[ia * 3 + 1], cloth.P[ic * 3 + 2] - cloth.P[ia * 3 + 2]];
      const tl = Math.hypot(...t) || 1;
      const e = sum.get(loop[k]);
      let inw = e ? [e[0] / e[3] - p[0], e[1] / e[3] - p[1], e[2] / e[3] - p[2]] : [0, 0, 0];
      const along = (inw[0] * t[0] + inw[1] * t[1] + inw[2] * t[2]) / (tl * tl);
      inw = inw.map((x, d) => x - t[d] * along);
      const nl = inw[0] * nn[0] + inw[1] * nn[1] + inw[2] * nn[2];
      inw = inw.map((x, d) => x - nn[d] * nl); // in the surface
      const il = Math.hypot(...inw) || 1;
      for (let side = 0; side < 2; side++) {
        const i = off + k * 2 + side;
        for (let d = 0; d < 3; d++) out.P[i * 3 + d] = p[d] + nn[d] * lift + (side ? (inw[d] / il) * width : 0);
        out.INF[i] = cloth.INF[src];
        outward.set(nn, i * 3);
      }
    }
    for (let k = 0; k < (closed ? n : n - 1); k++) {
      const k1 = (k + 1) % n;
      quads.push([off + k * 2, off + k1 * 2, off + k * 2 + 1, off + k1 * 2 + 1]);
    }
    off += n * 2;
  }
  for (const [a, b, c, d] of quads) {
    for (const [x, y, z] of [[a, b, c], [b, d, c]]) {
      const ux = out.P[y * 3] - out.P[x * 3];
      const uy = out.P[y * 3 + 1] - out.P[x * 3 + 1];
      const uz = out.P[y * 3 + 2] - out.P[x * 3 + 2];
      const vx = out.P[z * 3] - out.P[x * 3];
      const vy = out.P[z * 3 + 1] - out.P[x * 3 + 1];
      const vz = out.P[z * 3 + 2] - out.P[x * 3 + 2];
      const dot = (uy * vz - uz * vy) * outward[x * 3] + (uz * vx - ux * vz) * outward[x * 3 + 1] + (ux * vy - uy * vx) * outward[x * 3 + 2];
      if (dot >= 0) out.T.push(x, y, z);
      else out.T.push(x, z, y);
    }
  }
  return out;
}

// ---- the bikini bottom as its own mesh ----------------------------------------------------------------------------------------
// The bottom is not cut from a copy of the skin. It is a regular grid, built here:
//   - the main grid is a band round the pelvis: NC columns (the angle round a vertical axis through the pelvis, column 0 straight
//     to the front) by NV rows. Row 0 is the waistband line and the last row is the leg-opening line, both exactly the cut-B curves
//     (waistHeight and height, solved by iteration on the surface the column hits), so the border is a grid edge by construction;
//   - at the middle of the front and of the back the opening line comes down to the crotch, and a small second grid, the gusset,
//     joins those two ends under the crotch (sharing the vertices of the end rows), which is what leaves two leg openings;
//   - each vertex is placed by casting a ray from the axis onto the body surface (a copy of the skin eased toward its heavily
//     smoothed self, strongly across the gluteal cleft, so the cloth spans the cleft smoothly), plus a constant offset along the
//     surface normal, then relaxed over the grid with the border held fixed;
//   - skin weights are the body's, interpolated at the hit point (barycentric) and averaged a little over the grid, four influences.
const BOTTOM = { columns: 120, rows: 12, tongue: 2, gusset: 8, offset: 0.0045, clearance: 0.0035, edgeOffset: 0.0005, edgeClear: 0.0007, taper: 0.025, ribbon: 0.007, relax: 12, fillet: 14, cleftStrength: 1 };

function closestOnTriangle(p, a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [1 - v, v, 0];
  }
  const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [1 - w, 0, w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return [0, 1 - w, w];
  }
  const den = 1 / (va + vb + vc);
  return [1 - vb * den - vc * den, vb * den, vc * den];
}

export function bikiniBottom(body, A, kind) {
  if (kind !== "female") throw new Error("the bikini is cut for the female body only");
  const B = BOTTOM;
  const cut = BIKINI_CUT;
  const top = A.hipY + cut.waist;
  const apex = top - cut.gap;
  const foldY = A.crotchY - cut.fold;
  const frontY = A.crotchY + cut.front;
  const height = (x, z) => {
    const u = Math.hypot(x, 0.012);
    const back = foldY + (apex - foldY) * smootherstep(cut.backRise[0], cut.backRise[1], u);
    const front = frontY + (apex - frontY) * smootherstep(cut.frontRise[0], cut.frontRise[1], u);
    return back + (front - back) * smootherstep(-0.03, 0.05, z);
  };
  // one level line all the way round: constant height above the hip bones, no rise anywhere (the whole band is set high enough to cover the cleft)
  const waistHeight = () => top;

  // the surface the cloth follows: the skin eased toward its smoothed copy (strongly across the gluteal cleft)
  const PSH = body.A.PSH.data;
  const Q = new Float64Array(body.n * 3);
  for (let i = 0; i < body.n; i++) {
    const x = body.P[i * 3];
    const cleft = body.P[i * 3 + 2] < 0 ? 1 - smooth(0.02, 0.075, Math.abs(x)) : 0;
    const w = 0.15 + (B.cleftStrength - 0.15) * cleft;
    for (let k = 0; k < 3; k++) Q[i * 3 + k] = body.P[i * 3 + k] + w * (PSH[i * 3 + k] - body.P[i * 3 + k]);
  }
  const qn = computeNormals({ n: body.n, P: Q, T: body.T });
  const yLo = A.crotchY - 0.04;
  const yHi = top + 0.05;
  const tris = [];
  for (let t = 0; t < body.T.length; t += 3) {
    const v = [body.T[t], body.T[t + 1], body.T[t + 2]];
    if (v.some((i) => Q[i * 3 + 1] < yLo - 0.02 || Q[i * 3 + 1] > yHi + 0.02)) continue;
    if (v.reduce((a, i) => a + armW(body, i), 0) / 3 > 0.5) continue;
    const ys = v.map((i) => Q[i * 3 + 1]);
    tris.push({ v, y0: Math.min(...ys), y1: Math.max(...ys) });
  }
  // the axis: vertical, through the middle of the pelvis front to back
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const tr of tris) {
    for (const i of tr.v) {
      if (Math.abs(Q[i * 3 + 1] - A.hipY) < 0.01) {
        zMin = Math.min(zMin, Q[i * 3 + 2]);
        zMax = Math.max(zMax, Q[i * 3 + 2]);
      }
    }
  }
  const zc = (zMin + zMax) / 2;
  // Rays start inside the pelvis (at the hip joint's height, on the axis) and run out and up or down to the wanted height, so
  // they leave the surface head on, even under the seat where a horizontal ray would graze it; the outermost hit is the surface.
  const RAY_R = 0.12;
  const castDir = (dx, dy, dz, pos) => {
    let best = null;
    for (const tr of tris) {
      const [i0, i1, i2] = tr.v;
      const e1x = pos[i1 * 3] - pos[i0 * 3];
      const e1y = pos[i1 * 3 + 1] - pos[i0 * 3 + 1];
      const e1z = pos[i1 * 3 + 2] - pos[i0 * 3 + 2];
      const e2x = pos[i2 * 3] - pos[i0 * 3];
      const e2y = pos[i2 * 3 + 1] - pos[i0 * 3 + 1];
      const e2z = pos[i2 * 3 + 2] - pos[i0 * 3 + 2];
      const px = dy * e2z - dz * e2y;
      const py = dz * e2x - dx * e2z;
      const pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-14) continue;
      const tx = -pos[i0 * 3];
      const ty = A.hipY - pos[i0 * 3 + 1];
      const tz = zc - pos[i0 * 3 + 2];
      const u = (tx * px + ty * py + tz * pz) / det;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y;
      const qy = tz * e1x - tx * e1z;
      const qz = tx * e1y - ty * e1x;
      const w = (dx * qx + dy * qy + dz * qz) / det;
      if (w < 0 || u + w > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) / det;
      if (t <= 0.15) continue;
      if (!best || t > best.t) best = { t, v: tr.v, bary: [1 - u - w, u, w] };
    }
    return best;
  };
  const hitAt = (theta, y) => castDir(Math.sin(theta) * RAY_R, y - A.hipY, Math.cos(theta) * RAY_R, Q);
  const point = (h) => [0, 1, 2].map((d) => h.bary[0] * Q[h.v[0] * 3 + d] + h.bary[1] * Q[h.v[1] * 3 + d] + h.bary[2] * Q[h.v[2] * 3 + d]);
  const normal = (h) => {
    const n = [0, 1, 2].map((d) => h.bary[0] * qn[h.v[0] * 3 + d] + h.bary[1] * qn[h.v[1] * 3 + d] + h.bary[2] * qn[h.v[2] * 3 + d]);
    const l = Math.hypot(...n) || 1;
    return n.map((x) => x / l);
  };

  // 1. the border lines, column by column
  const NC = B.columns;
  const NV = B.rows;
  const theta = (k) => (k / NC) * Math.PI * 2;
  const frontCols = []; // the columns of the front tongue, by x from low to high
  const backCols = [];
  for (let i = -B.tongue; i <= B.tongue; i++) {
    frontCols.push((i + NC) % NC);
    backCols.push((NC / 2 - i + NC) % NC);
  }
  const isFrontTongue = new Set(frontCols);
  const isBackTongue = new Set(backCols);
  const yTop = new Float64Array(NC); // the wanted heights that put the hit exactly on the cut lines
  const yBot = new Float64Array(NC);
  for (let k = 0; k < NC; k++) {
    let y = top;
    for (let it = 0; it < 8; it++) {
      const h = hitAt(theta(k), y);
      if (!h) throw new Error(`bikini bottom: no surface at the waistband, column ${k}`);
      const p = point(h);
      y += waistHeight(p[0], p[2]) - p[1];
    }
    yTop[k] = y;
    y = (apex + foldY) / 2;
    for (let it = 0; it < 12; it++) {
      const h = hitAt(theta(k), y);
      if (!h) throw new Error(`bikini bottom: no surface at the leg line, column ${k}`);
      const p = point(h);
      let want = height(p[0], p[2]);
      if (isBackTongue.has(k)) want = Math.max(want, A.crotchY + 0.01);
      if (isFrontTongue.has(k)) want = Math.max(want, frontY);
      y += want - p[1];
    }
    yBot[k] = y;
  }

  // Fillet: the outline is smoothed round the columns (the wanted heights, which are the (u, v) outline of the grid), so the waistband
  // flows into the leg line on a curve and no corner vertex is left where the raised back meets the hip.
  for (const line of [yTop, yBot]) {
    for (let pass = 0; pass < B.fillet; pass++) {
      const prev = Float64Array.from(line);
      for (let k = 0; k < NC; k++) line[k] = 0.25 * prev[(k + NC - 1) % NC] + 0.5 * prev[k] + 0.25 * prev[(k + 1) % NC];
    }
  }

  // the side panel: the smallest distance between the waistband line and the leg line over all columns
  let minSide = Infinity;
  for (let k = 0; k < NC; k++) {
    const t = hitAt(theta(k), yTop[k]);
    const b = hitAt(theta(k), yBot[k]);
    const pt = point(t);
    const pb = point(b);
    minSide = Math.min(minSide, Math.hypot(pt[0] - pb[0], pt[1] - pb[1], pt[2] - pb[2]));
  }
  console.log(`bikini bottom: smallest distance between the waistband and the leg line: ${(minSide * 100).toFixed(1)} cm`);

  // 2. vertices
  const N = NC * NV;
  const GR = B.gusset;
  const GC = frontCols.length;
  const total = N + GC * (GR - 1);
  const out = makeSurface(total);
  addAttr(out, "TRIM", 1);
  const hits = new Array(total);
  const outN = new Float64Array(total * 3);
  const base = new Float64Array(total * 3); // the surface point under every vertex
  const vid = (k, j) => k * NV + j;
  for (let k = 0; k < NC; k++) {
    for (let j = 0; j < NV; j++) {
      const y = yTop[k] + ((yBot[k] - yTop[k]) * j) / (NV - 1);
      const h = hitAt(theta(k), y);
      if (!h) throw new Error(`bikini bottom: no surface at column ${k} row ${j}`);
      const id = vid(k, j);
      hits[id] = h;
      const p = point(h);
      const n = normal(h);
      outN.set(n, id * 3);
      base.set(p, id * 3);
      for (let d = 0; d < 3; d++) out.P[id * 3 + d] = p[d] + n[d] * B.offset;
      out.UV[id * 2] = k / NC;
      out.UV[id * 2 + 1] = j / (NV - 1);
    }
  }
  // the gusset: from the front end row to the back end row under the crotch, on the surface (closest point to a curved path)
  for (let c = 0; c < GC; c++) {
    const f = vid(frontCols[c], NV - 1);
    const b = vid(backCols[c], NV - 1);
    const pf = [out.P[f * 3], out.P[f * 3 + 1], out.P[f * 3 + 2]];
    const pb = [out.P[b * 3], out.P[b * 3 + 1], out.P[b * 3 + 2]];
    const mid = [(pf[0] + pb[0]) / 2, A.crotchY - 0.006, (pf[2] + pb[2]) / 2];
    for (let m = 1; m < GR; m++) {
      const t = m / GR;
      const proxy = [0, 1, 2].map((d) => (1 - t) * (1 - t) * pf[d] + 2 * (1 - t) * t * mid[d] + t * t * pb[d]);
      let best = null;
      for (const tr of tris) {
        const [i0, i1, i2] = tr.v;
        if (proxy[1] < tr.y0 - 0.03 || proxy[1] > tr.y1 + 0.03) continue;
        const a = [Q[i0 * 3], Q[i0 * 3 + 1], Q[i0 * 3 + 2]];
        const bb = [Q[i1 * 3], Q[i1 * 3 + 1], Q[i1 * 3 + 2]];
        const cc = [Q[i2 * 3], Q[i2 * 3 + 1], Q[i2 * 3 + 2]];
        const bary = closestOnTriangle(proxy, a, bb, cc);
        const q = [0, 1, 2].map((d) => bary[0] * a[d] + bary[1] * bb[d] + bary[2] * cc[d]);
        const dd = (q[0] - proxy[0]) ** 2 + (q[1] - proxy[1]) ** 2 + (q[2] - proxy[2]) ** 2;
        if (!best || dd < best.dd) best = { dd, v: tr.v, bary };
      }
      const id = N + c * (GR - 1) + (m - 1);
      hits[id] = best;
      const p = point(best);
      const n = normal(best);
      outN.set(n, id * 3);
      base.set(p, id * 3);
      for (let d = 0; d < 3; d++) out.P[id * 3 + d] = p[d] + n[d] * B.offset;
      out.UV[id * 2] = frontCols[c] / NC;
      out.UV[id * 2 + 1] = 1 + t * 0.2;
    }
  }
  // 3. triangles (wound to face along the surface normal)
  const tri = (a, b, c) => {
    const ux = out.P[b * 3] - out.P[a * 3];
    const uy = out.P[b * 3 + 1] - out.P[a * 3 + 1];
    const uz = out.P[b * 3 + 2] - out.P[a * 3 + 2];
    const vx = out.P[c * 3] - out.P[a * 3];
    const vy = out.P[c * 3 + 1] - out.P[a * 3 + 1];
    const vz = out.P[c * 3 + 2] - out.P[a * 3 + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const o = outN[a * 3] + outN[b * 3] + outN[c * 3];
    const oy = outN[a * 3 + 1] + outN[b * 3 + 1] + outN[c * 3 + 1];
    const oz = outN[a * 3 + 2] + outN[b * 3 + 2] + outN[c * 3 + 2];
    if (nx * o + ny * oy + nz * oz >= 0) out.T.push(a, b, c);
    else out.T.push(a, c, b);
  };
  for (let k = 0; k < NC; k++) {
    const k1 = (k + 1) % NC;
    for (let j = 0; j < NV - 1; j++) {
      tri(vid(k, j), vid(k1, j), vid(k, j + 1));
      tri(vid(k1, j), vid(k1, j + 1), vid(k, j + 1));
    }
  }
  // gusset quads: columns in order of x, rows from the front end row to the back end row
  const gv = (c, m) => (m === 0 ? vid(frontCols[c], NV - 1) : m === GR ? vid(backCols[c], NV - 1) : N + c * (GR - 1) + (m - 1));
  for (let c = 0; c < GC - 1; c++) {
    for (let m = 0; m < GR; m++) {
      tri(gv(c, m), gv(c + 1, m), gv(c, m + 1));
      tri(gv(c + 1, m), gv(c + 1, m + 1), gv(c, m + 1));
    }
  }
  // 3b. the offset from the skin tapers to 0.5 mm at every border (elastic pulls the hem onto the skin) and is full only in the middle
  // of the panel
  const bd = borderDistance(out);
  const lift = new Float64Array(total);
  const minClear = new Float64Array(total);
  for (let i = 0; i < total; i++) {
    const f = smooth(0, B.taper, bd[i]);
    lift[i] = B.edgeOffset + (B.offset - B.edgeOffset) * f;
    minClear[i] = B.edgeClear + (B.clearance - B.edgeClear) * f;
    for (let d = 0; d < 3; d++) out.P[i * 3 + d] = base[i * 3 + d] + outN[i * 3 + d] * lift[i];
  }
  // 4. relax the interior over the grid (the border is held where the cut lines put it)
  const nbr = Array.from({ length: total }, () => new Set());
  for (let t = 0; t < out.T.length; t += 3) {
    for (let a = 0; a < 3; a++) {
      nbr[out.T[t + a]].add(out.T[t + (a + 1) % 3]);
      nbr[out.T[t + a]].add(out.T[t + (a + 2) % 3]);
    }
  }
  const border = boundaryVertices(out);
  // never closer to the real skin than the clearance: along the ray from the axis, a vertex inside the skin goes back out to it
  const clearance = () => {
    for (let i = 0; i < N; i++) {
      const dx = out.P[i * 3];
      const dy = out.P[i * 3 + 1] - A.hipY;
      const dz = out.P[i * 3 + 2] - zc;
      const real = castDir(dx, dy, dz, body.P);
      if (!real) continue;
      const want = real.t + minClear[i] / Math.hypot(dx, dy, dz);
      if (want > 1) {
        out.P[i * 3] = dx * want;
        out.P[i * 3 + 1] = A.hipY + dy * want;
        out.P[i * 3 + 2] = zc + dz * want;
      }
    }
  };
  for (let it = 0; it < B.relax; it++) {
    if (it % 3 === 2) clearance();
    const next = Float64Array.from(out.P);
    for (let i = 0; i < total; i++) {
      if (border[i]) continue;
      for (let d = 0; d < 3; d++) {
        let m = 0;
        for (const j of nbr[i]) m += out.P[j * 3 + d];
        next[i * 3 + d] = out.P[i * 3 + d] + 0.5 * (m / nbr[i].size - out.P[i * 3 + d]);
      }
    }
    out.P.set(next);
  }
  clearance();
  {
    let lo = Infinity;
    let hi = -Infinity;
    let peaks = 0;
    for (let k = 0; k < NC; k++) {
      const y = out.P[vid(k, 0) * 3 + 1];
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
      const a = out.P[vid((k + NC - 1) % NC, 0) * 3 + 1];
      const c = out.P[vid((k + 1) % NC, 0) * 3 + 1];
      if (y > a + 5e-4 && y > c + 5e-4) peaks++;
    }
    console.log(`bikini bottom: waistband height around the body, max minus min ${((hi - lo) * 100).toFixed(2)} cm; local maxima over 0.5 mm: ${peaks}`);
  }
  // 5. skin weights from the body at the hit points, averaged a little over the grid
  let inf = hits.map((h) => {
    const m = new Map();
    h.v.forEach((vi, c) => {
      for (const [bone, w] of body.INF[vi]) m.set(bone, (m.get(bone) || 0) + w * h.bary[c]);
    });
    return m;
  });
  for (let it = 0; it < 2; it++) {
    inf = inf.map((m, i) => {
      const o = new Map();
      const add = (src, f) => {
        for (const [bone, w] of src) o.set(bone, (o.get(bone) || 0) + w * f);
      };
      add(m, 0.5);
      for (const j of nbr[i]) add(inf[j], 0.5 / nbr[i].size);
      return o;
    });
  }
  for (let i = 0; i < total; i++) {
    const list = [...inf[i].entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = list.reduce((a, e) => a + e[1], 0);
    out.INF[i] = list.map(([bone, w]) => [bone, w / sum]);
  }
  return concat([out, hemRibbon(out, outN, { width: B.ribbon, lift: 0.0009 })]);
}

// ---- the bikini top as its own mesh ---------------------------------------------------------------------------------------------
// Built like the bottom (a regular grid between smooth outline curves, projected onto the body, tapered 0.5 mm edge offset, the body's
// skin weights interpolated, a flat hem ribbon, no cut shell anywhere):
//   - the main grid is a band round the chest: NC columns (angle round a vertical axis through the chest, column 0 straight to the front)
//     by NV rows. The bottom row is the lower edge of the band (level); the top row is the band's upper edge, rising over each breast to the
//     cup's upper arc, which is where the two cups and the centre gore are;
//   - at each shoulder a strap leaves the cup (front) and the band (back) as a tongue of columns, and a small grid joins the two tongue
//     ends over the top of the shoulder, so the straps run over the shoulders and the armholes are the holes between them.
const TOP = { columns: 96, rows: 16, strapCols: 3, strapRows: 10, offset: 0.0045, clearance: 0.0035, edgeOffset: 0.0005, edgeClear: 0.0007, taper: 0.025, ribbon: 0.007, relax: 8, fillet: 6 };

export function bikiniTop(body, A, kind) {
  if (kind !== "female") throw new Error("the bikini is cut for the female body only");
  const B = TOP;
  const [ax, ay, az] = A.apex;
  const bandLo = ay - 0.092;
  const bandHi = ay - 0.026;
  const strapX = 0.083;
  const strapEnd = A.shoulderY - 0.005; // where each strap leaves the front and the back of the chest
  const cupY = ay + 0.005;
  const cupTop = (x) => {
    const u = (Math.abs(x) - ax * 0.8) / 0.098;
    if (Math.abs(x) > 0.145 || Math.abs(u) >= 1) return bandHi;
    return Math.max(bandHi, cupY + 0.072 * Math.sqrt(1 - u * u) * 0.92);
  };

  // the surface the cloth follows: the skin eased halfway to its smoothed copy
  const PS = body.A.PS.data;
  const Q = new Float64Array(body.n * 3);
  for (let i = 0; i < body.n; i++) for (let k = 0; k < 3; k++) Q[i * 3 + k] = body.P[i * 3 + k] + 0.5 * (PS[i * 3 + k] - body.P[i * 3 + k]);
  const qn = computeNormals({ n: body.n, P: Q, T: body.T });
  const LIMB = /^(upperarm|lowerarm|wrist|metacarpal|finger)/;
  const limbW = (i) => weightOn(body, i, (b) => LIMB.test(b));
  const yLo = bandLo - 0.03;
  const yHi = A.shoulderY + 0.12;
  const tris = [];
  for (let t = 0; t < body.T.length; t += 3) {
    const v = [body.T[t], body.T[t + 1], body.T[t + 2]];
    if (v.some((i) => Q[i * 3 + 1] < yLo - 0.02 || Q[i * 3 + 1] > yHi + 0.02)) continue;
    // the arms are left out; up at the shoulder (where a strap runs) only the arm proper, so the top of the shoulder stays
    const ym = (Q[v[0] * 3 + 1] + Q[v[1] * 3 + 1] + Q[v[2] * 3 + 1]) / 3;
    if (v.reduce((a, i) => a + limbW(i), 0) / 3 > (ym < ay + 0.03 ? 0.4 : 0.95)) continue;
    tris.push({ v });
  }
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const tr of tris) {
    for (const i of tr.v) {
      if (Math.abs(Q[i * 3 + 1] - ay) < 0.01 && Math.abs(Q[i * 3]) < 0.12) {
        zMin = Math.min(zMin, Q[i * 3 + 2]);
        zMax = Math.max(zMax, Q[i * 3 + 2]);
      }
    }
  }
  const zc = (zMin + zMax) / 2;
  // horizontal ray from the axis at height y, angle theta (0 to the front); the outermost hit is the surface
  const hitAt = (theta, y) => {
    const dx = Math.sin(theta);
    const dz = Math.cos(theta);
    let best = null;
    for (const tr of tris) {
      const [i0, i1, i2] = tr.v;
      const y0 = Math.min(Q[i0 * 3 + 1], Q[i1 * 3 + 1], Q[i2 * 3 + 1]);
      const y1 = Math.max(Q[i0 * 3 + 1], Q[i1 * 3 + 1], Q[i2 * 3 + 1]);
      if (y < y0 || y > y1) continue;
      const e1x = Q[i1 * 3] - Q[i0 * 3];
      const e1y = Q[i1 * 3 + 1] - Q[i0 * 3 + 1];
      const e1z = Q[i1 * 3 + 2] - Q[i0 * 3 + 2];
      const e2x = Q[i2 * 3] - Q[i0 * 3];
      const e2y = Q[i2 * 3 + 1] - Q[i0 * 3 + 1];
      const e2z = Q[i2 * 3 + 2] - Q[i0 * 3 + 2];
      const px = -dz * e2y;
      const py = dz * e2x - dx * e2z;
      const pz = dx * e2y;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-14) continue;
      const tx = -Q[i0 * 3];
      const ty = y - Q[i0 * 3 + 1];
      const tz = zc - Q[i0 * 3 + 2];
      const u = (tx * px + ty * py + tz * pz) / det;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y;
      const qy = tz * e1x - tx * e1z;
      const qz = tx * e1y - ty * e1x;
      const w = (dx * qx + dz * qz) / det;
      if (w < 0 || u + w > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) / det;
      if (t <= 0.02) continue;
      if (!best || t > best.t) best = { t, v: tr.v, bary: [1 - u - w, u, w] };
    }
    return best;
  };
  const point = (h) => [0, 1, 2].map((d) => h.bary[0] * Q[h.v[0] * 3 + d] + h.bary[1] * Q[h.v[1] * 3 + d] + h.bary[2] * Q[h.v[2] * 3 + d]);
  const normal = (h) => {
    const n = [0, 1, 2].map((d) => h.bary[0] * qn[h.v[0] * 3 + d] + h.bary[1] * qn[h.v[1] * 3 + d] + h.bary[2] * qn[h.v[2] * 3 + d]);
    const l = Math.hypot(...n) || 1;
    return n.map((x) => x / l);
  };

  const NC = B.columns;
  const NV = B.rows;
  const theta = (k) => (k / NC) * Math.PI * 2;
  const xAt = (k) => {
    const h = hitAt(theta(k), ay);
    if (!h) throw new Error(`bikini top: no surface at the bust, column ${k}`);
    return point(h)[0];
  };
  const colX = Array.from({ length: NC }, (_, k) => xAt(k));
  // the strap tongues: strapCols columns round x = +-strapX on the front half and on the back half
  const pick = (front, sign) => {
    const cand = [];
    for (let k = 0; k < NC; k++) if ((k < NC / 4 || k > (3 * NC) / 4) === front) cand.push(k);
    cand.sort((a, b) => Math.abs(colX[a] - sign * strapX) - Math.abs(colX[b] - sign * strapX));
    return cand.slice(0, B.strapCols).sort((a, b) => colX[a] - colX[b]);
  };
  const tongues = { fl: pick(true, 1), fr: pick(true, -1), bl: pick(false, 1), br: pick(false, -1) };
  const strapPairs = [[tongues.fl, tongues.bl], [tongues.fr, tongues.br]];
  const isTongue = new Set(Object.values(tongues).flat());

  // the top line of the band, column by column: the band's top edge, the cups' upper arcs (smoothed round the columns), then the tongues
  const yTop = new Float64Array(NC);
  for (let k = 0; k < NC; k++) {
    const front = k < NC / 4 || k > (3 * NC) / 4;
    yTop[k] = front ? cupTop(colX[k]) : bandHi;
  }
  for (let pass = 0; pass < B.fillet; pass++) {
    const prev = Float64Array.from(yTop);
    for (let k = 0; k < NC; k++) yTop[k] = 0.25 * prev[(k + NC - 1) % NC] + 0.5 * prev[k] + 0.25 * prev[(k + 1) % NC];
  }
  for (const k of isTongue) yTop[k] = strapEnd;

  // vertices
  const N = NC * NV;
  const GR = B.strapRows;
  const GC = B.strapCols;
  const total = N + 2 * GC * (GR - 1);
  const out = makeSurface(total);
  addAttr(out, "TRIM", 1);
  const hits = new Array(total);
  const outN = new Float64Array(total * 3);
  const base = new Float64Array(total * 3);
  const vid = (k, j) => k * NV + j;
  for (let k = 0; k < NC; k++) {
    for (let j = 0; j < NV; j++) {
      const y = yTop[k] + ((bandLo - yTop[k]) * j) / (NV - 1);
      const h = hitAt(theta(k), y);
      if (!h) throw new Error(`bikini top: no surface at column ${k} row ${j}`);
      const id = vid(k, j);
      hits[id] = h;
      base.set(point(h), id * 3);
      outN.set(normal(h), id * 3);
      out.UV[id * 2] = k / NC;
      out.UV[id * 2 + 1] = j / (NV - 1);
    }
  }
  // each strap: from the front tongue end over the top of the shoulder to the back tongue end (closest point on the surface to a curved path)
  strapPairs.forEach(([front, back], s) => {
    for (let c = 0; c < GC; c++) {
      const f = vid(front[c], 0);
      const b = vid(back[c], 0);
      const pf = [base[f * 3], base[f * 3 + 1], base[f * 3 + 2]];
      const pb = [base[b * 3], base[b * 3 + 1], base[b * 3 + 2]];
      const mid = [(pf[0] + pb[0]) / 2, A.shoulderY + 0.075, (pf[2] + pb[2]) / 2];
      for (let m = 1; m < GR; m++) {
        const t = m / GR;
        const proxy = [0, 1, 2].map((d) => (1 - t) * (1 - t) * pf[d] + 2 * (1 - t) * t * mid[d] + t * t * pb[d]);
        let best = null;
        for (const tr of tris) {
          const [i0, i1, i2] = tr.v;
          const a = [Q[i0 * 3], Q[i0 * 3 + 1], Q[i0 * 3 + 2]];
          const bb = [Q[i1 * 3], Q[i1 * 3 + 1], Q[i1 * 3 + 2]];
          const cc = [Q[i2 * 3], Q[i2 * 3 + 1], Q[i2 * 3 + 2]];
          const bary = closestOnTriangle(proxy, a, bb, cc);
          const q = [0, 1, 2].map((d) => bary[0] * a[d] + bary[1] * bb[d] + bary[2] * cc[d]);
          const dd = (q[0] - proxy[0]) ** 2 + (q[1] - proxy[1]) ** 2 + (q[2] - proxy[2]) ** 2;
          if (!best || dd < best.dd) best = { dd, v: tr.v, bary };
        }
        const id = N + (s * GC + c) * (GR - 1) + (m - 1);
        hits[id] = best;
        base.set(point(best), id * 3);
        outN.set(normal(best), id * 3);
        out.UV[id * 2] = front[c] / NC;
        out.UV[id * 2 + 1] = -t * 0.2;
      }
    }
  });
  for (let i = 0; i < total; i++) for (let d = 0; d < 3; d++) out.P[i * 3 + d] = base[i * 3 + d] + outN[i * 3 + d] * B.offset;

  // triangles, wound to face along the surface normal
  const tri = (a, b, c) => {
    const ux = out.P[b * 3] - out.P[a * 3];
    const uy = out.P[b * 3 + 1] - out.P[a * 3 + 1];
    const uz = out.P[b * 3 + 2] - out.P[a * 3 + 2];
    const vx = out.P[c * 3] - out.P[a * 3];
    const vy = out.P[c * 3 + 1] - out.P[a * 3 + 1];
    const vz = out.P[c * 3 + 2] - out.P[a * 3 + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const o = outN[a * 3] + outN[b * 3] + outN[c * 3];
    const oy = outN[a * 3 + 1] + outN[b * 3 + 1] + outN[c * 3 + 1];
    const oz = outN[a * 3 + 2] + outN[b * 3 + 2] + outN[c * 3 + 2];
    if (nx * o + ny * oy + nz * oz >= 0) out.T.push(a, b, c);
    else out.T.push(a, c, b);
  };
  for (let k = 0; k < NC; k++) {
    const k1 = (k + 1) % NC;
    for (let j = 0; j < NV - 1; j++) {
      tri(vid(k, j), vid(k1, j), vid(k, j + 1));
      tri(vid(k1, j), vid(k1, j + 1), vid(k, j + 1));
    }
  }
  strapPairs.forEach(([front, back], s) => {
    const gv = (c, m) => (m === 0 ? vid(front[c], 0) : m === GR ? vid(back[c], 0) : N + (s * GC + c) * (GR - 1) + (m - 1));
    for (let c = 0; c < GC - 1; c++) {
      for (let m = 0; m < GR; m++) {
        tri(gv(c, m), gv(c + 1, m), gv(c, m + 1));
        tri(gv(c + 1, m), gv(c + 1, m + 1), gv(c, m + 1));
      }
    }
  });

  // the offset from the skin tapers to 0.5 mm at every border and is full only in the middle of the panel
  const bd = borderDistance(out);
  const minClear = new Float64Array(total);
  for (let i = 0; i < total; i++) {
    const f = smooth(0, B.taper, bd[i]);
    const lift = B.edgeOffset + (B.offset - B.edgeOffset) * f;
    minClear[i] = B.edgeClear + (B.clearance - B.edgeClear) * f;
    for (let d = 0; d < 3; d++) out.P[i * 3 + d] = base[i * 3 + d] + outN[i * 3 + d] * lift;
  }
  const nbr = Array.from({ length: total }, () => new Set());
  for (let t = 0; t < out.T.length; t += 3) {
    for (let a = 0; a < 3; a++) {
      nbr[out.T[t + a]].add(out.T[t + (a + 1) % 3]);
      nbr[out.T[t + a]].add(out.T[t + (a + 2) % 3]);
    }
  }
  const border = boundaryVertices(out);
  // never inside the real skin: a vertex goes back out along the ray from the axis (main grid only; the straps are on the shoulder)
  const castOut = (dx, dz, y, pos) => {
    // outermost hit of the horizontal ray through (dx, dz) at height y on the real skin
    const len = Math.hypot(dx, dz) || 1;
    const th = Math.atan2(dx / len, dz / len);
    let best = null;
    for (const tr of tris) {
      const [i0, i1, i2] = tr.v;
      const y0 = Math.min(pos[i0 * 3 + 1], pos[i1 * 3 + 1], pos[i2 * 3 + 1]);
      const y1 = Math.max(pos[i0 * 3 + 1], pos[i1 * 3 + 1], pos[i2 * 3 + 1]);
      if (y < y0 || y > y1) continue;
      const sx = Math.sin(th);
      const sz = Math.cos(th);
      const e1x = pos[i1 * 3] - pos[i0 * 3];
      const e1y = pos[i1 * 3 + 1] - pos[i0 * 3 + 1];
      const e1z = pos[i1 * 3 + 2] - pos[i0 * 3 + 2];
      const e2x = pos[i2 * 3] - pos[i0 * 3];
      const e2y = pos[i2 * 3 + 1] - pos[i0 * 3 + 1];
      const e2z = pos[i2 * 3 + 2] - pos[i0 * 3 + 2];
      const px = -sz * e2y;
      const py = sz * e2x - sx * e2z;
      const pz = sx * e2y;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-14) continue;
      const tx = -pos[i0 * 3];
      const ty = y - pos[i0 * 3 + 1];
      const tz = zc - pos[i0 * 3 + 2];
      const u = (tx * px + ty * py + tz * pz) / det;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y;
      const qy = tz * e1x - tx * e1z;
      const qz = tx * e1y - ty * e1x;
      const w = (sx * qx + sz * qz) / det;
      if (w < 0 || u + w > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) / det;
      if (t > 0.02 && (!best || t > best)) best = t;
    }
    return best;
  };
  const clearance = () => {
    for (let i = 0; i < N; i++) {
      const dx = out.P[i * 3];
      const dz = out.P[i * 3 + 2] - zc;
      const r = Math.hypot(dx, dz);
      const real = castOut(dx, dz, out.P[i * 3 + 1], body.P);
      if (real === null) continue;
      const want = real + minClear[i];
      if (want > r) {
        out.P[i * 3] = (dx / r) * want;
        out.P[i * 3 + 2] = zc + (dz / r) * want;
      }
    }
  };
  for (let it = 0; it < B.relax; it++) {
    if (it % 3 === 2) clearance();
    const next = Float64Array.from(out.P);
    for (let i = 0; i < total; i++) {
      if (border[i]) continue;
      for (let d = 0; d < 3; d++) {
        let m = 0;
        for (const j of nbr[i]) m += out.P[j * 3 + d];
        next[i * 3 + d] = out.P[i * 3 + d] + 0.5 * (m / nbr[i].size - out.P[i * 3 + d]);
      }
    }
    out.P.set(next);
  }
  clearance();
  // skin weights from the body at the hit points, averaged a little over the grid
  let inf = hits.map((h) => {
    const m = new Map();
    h.v.forEach((vi, c) => {
      for (const [bone, w] of body.INF[vi]) m.set(bone, (m.get(bone) || 0) + w * h.bary[c]);
    });
    return m;
  });
  for (let it = 0; it < 2; it++) {
    inf = inf.map((m, i) => {
      const o = new Map();
      const add = (src, f) => {
        for (const [bone, w] of src) o.set(bone, (o.get(bone) || 0) + w * f);
      };
      add(m, 0.5);
      for (const j of nbr[i]) add(inf[j], 0.5 / nbr[i].size);
      return o;
    });
  }
  for (let i = 0; i < total; i++) {
    const list = [...inf[i].entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = list.reduce((a, e) => a + e[1], 0);
    out.INF[i] = list.map(([bone, w]) => [bone, w / sum]);
  }
  return concat([out, hemRibbon(out, outN, { width: B.ribbon, lift: 0.0009 })]);
}

function sleeveField(A, axisFrom, axisTo, reach) {
  const d = axisTo.map((v, k) => v - axisFrom[k]);
  const len = Math.hypot(...d);
  const u = d.map((v) => v / len);
  return (s) => (i) => {
    if (armW(s, i) <= 0.5) return 1;
    const p = [Math.abs(s.P[i * 3]) - axisFrom[0], s.P[i * 3 + 1] - axisFrom[1], s.P[i * 3 + 2] - axisFrom[2]];
    return len * reach - (p[0] * u[0] + p[1] * u[1] + p[2] * u[2]);
  };
}

const neckCut = (dip) => (s) => (i) => 0.5 - neckHeadW(s, i) - dip * smooth(0.02, 0.1, s.P[i * 3 + 2]);

// The women's rashguard is worn with the bikini bottom (one matching set): its hem sits RASH_OVERLAP below the top of the bottom's
// waistband, so there is never a strip of skin between them, and it stands a few mm proud of the waistband there so the two never
// fight for the same pixels.
const RASH_OVERLAP = 0.03;
export function rash(body, A, kind) {
  const hemY = kind === "male" ? A.hipY + 0.05 : A.hipY + BIKINI_CUT.waist - RASH_OVERLAP;
  const hem = (s) => (i) => s.P[i * 3 + 1] - hemY;
  const sleeve = sleeveField(A, A.elbow, A.wrist, 0.93);
  let g = cutAll(body, [hem, neckCut(kind === "male" ? 0.02 : 0.07), sleeve]);
  g = withBand(g, hem, 0.03);
  g = withBand(g, sleeve, 0.03);
  const e = minField([hem])(g);
  const cloth = shape(g, {
    loose: () => 0.0,
    thick: () => (kind === "male" ? 0.0055 : 0.005),
    minOff: 0.005,
  });
  // the hem sits flush: the offset from the skin tapers to the border, and the binding is a flat ribbon
  return kind === "male" ? cloth : concat([cloth, hemRibbon(cloth, computeNormals(cloth), { width: 0.007, lift: 0.0009 })]);
}

export function fullsuit(body, A, kind) {
  const anklePlane = A.ankleY + 0.075;
  const leg = (s) => (i) => s.P[i * 3 + 1] - anklePlane;
  const sleeve = sleeveField(A, A.elbow, A.wrist, 0.93);
  let g = cutAll(body, [neckCut(kind === "male" ? 0.02 : 0.07), sleeve, leg]);
  g = withBand(g, leg, 0.03);
  g = withBand(g, sleeve, 0.03);
  return shape(g, { loose: () => 0.0, thick: () => 0.005, minOff: 0.0045 });
}

export function springsuit(body, A, kind) {
  const hemY = A.crotchY - 0.4 * (A.crotchY - A.kneeY);
  const leg = (s) => (i) => s.P[i * 3 + 1] - hemY;
  const sleeve = sleeveField(A, A.upperArm, A.elbow, 0.55);
  let g = cutAll(body, [neckCut(kind === "male" ? 0.02 : 0.07), sleeve, leg]);
  g = withBand(g, leg, 0.025);
  g = withBand(g, sleeve, 0.025);
  return shape(g, { loose: () => 0.0, thick: () => 0.005, minOff: 0.0045 });
}

export { boundaryVertices, makeSurface, weldKeys };
