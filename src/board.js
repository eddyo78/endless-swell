import * as THREE from "three";

// Procedural surfboards. The shapes are built here; the print (stripes, chevrons, a sunburst...) is a mask texture drawn in
// src/printart.js and mapped onto the hull by the planform UVs this file writes (see buildHull).
//
// Board space: +x is the surfer's right when the board travels toward -z, +y is
// up, the NOSE is at -z (the direction of travel) and the TAIL at +z. The origin
// is the middle of the board at the height of its lowest bottom point.
//
// Every board is a lofted hull: RINGS cross-sections from nose to tail, each a
// closed ring of SEGS points. Section shape comes from per-shape curves for
// half-width, thickness and rocker. deckAt() reads the same curves, so a foot
// target and the rendered deck can never disagree.

export const SEGS = 28; // even; vertex 0 and SEGS/2 are the rail apexes, SEGS/4 the deck centreline
export const RINGS = 56;
export const BOARD_LIFT = 0.07; // metres the board origin sits above the holder (the wave face) origin

const RAIL_P = 0.62; // rail roundness: x = w * |cos|^RAIL_P
const TOP_Q = 0.7; // deck dome: y = T * |sin|^TOP_Q
const BOT_Q = 0.85;
const TOP_FRAC = 0.58; // share of thickness above the rail apex
const BOT_FRAC = 0.42;
const PAD_TH = 0.007;
const STRINGER_LIFT = 0.0012;

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function smooth(x) {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

// Monotone cubic (Fritsch-Carlson) through [x, y] keys. No overshoot, so a
// width curve can never bulge past its own key values.
function curve(keys) {
  const n = keys.length;
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * d[i];
      m[i + 1] = tau * b * d[i];
    }
  }
  return (x) => {
    const v = clamp(x, xs[0], xs[n - 1]);
    let i = 0;
    while (i < n - 2 && v > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (v - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// t runs 0 (nose) to 1 (tail). Widths are half-widths in metres.
const SPEC_DATA = {
  short: {
    length: 1.76,
    half: [[0, 0], [0.006, 0.04], [0.02, 0.08], [0.06, 0.14], [0.15, 0.21], [0.3, 0.252], [0.43, 0.262], [0.55, 0.255], [0.7, 0.225], [0.85, 0.17], [0.95, 0.115], [0.985, 0.095], [1, 0.07]],
    thick: [[0, 0.012], [0.05, 0.03], [0.2, 0.052], [0.45, 0.062], [0.7, 0.052], [0.9, 0.035], [1, 0.02]],
    noseRocker: 0.085,
    tailRocker: 0.035,
    notch: 0,
    pad: { t0: 0.74, t1: 0.955, maxHalf: 0.125 },
    plugT: 0.965,
    stance: { front: -0.14, rear: 0.46 },
    fins: "thruster",
  },
  fish: {
    length: 1.52,
    half: [[0, 0], [0.006, 0.05], [0.025, 0.11], [0.08, 0.19], [0.2, 0.28], [0.35, 0.325], [0.5, 0.34], [0.65, 0.325], [0.8, 0.28], [0.92, 0.22], [0.98, 0.16], [1, 0.14]],
    thick: [[0, 0.014], [0.05, 0.034], [0.2, 0.058], [0.45, 0.068], [0.7, 0.058], [0.9, 0.04], [1, 0.03]],
    noseRocker: 0.055,
    tailRocker: 0.025,
    notch: 0.15,
    pad: { t0: 0.74, t1: 0.94, maxHalf: 0.13 },
    plugT: 0.95,
    stance: { front: -0.1, rear: 0.4 },
    fins: "twin",
  },
  gun: {
    length: 2.2,
    half: [[0, 0], [0.01, 0.03], [0.04, 0.075], [0.12, 0.14], [0.25, 0.195], [0.4, 0.213], [0.5, 0.212], [0.62, 0.197], [0.76, 0.16], [0.88, 0.11], [0.96, 0.06], [1, 0]],
    thick: [[0, 0.012], [0.05, 0.028], [0.2, 0.05], [0.45, 0.06], [0.7, 0.05], [0.9, 0.032], [1, 0.018]],
    noseRocker: 0.11,
    tailRocker: 0.04,
    notch: 0,
    pad: { t0: 0.78, t1: 0.96, maxHalf: 0.11 },
    plugT: 0.975,
    stance: { front: -0.2, rear: 0.66 },
    fins: "thruster-gun",
  },
};

const SPECS = {};
for (const [name, data] of Object.entries(SPEC_DATA)) {
  SPECS[name] = { ...data, name, halfAt: curve(data.half), thickAt: curve(data.thick) };
}

export const BOARD_SHAPES = Object.keys(SPECS);

function specFor(shape) {
  const spec = SPECS[shape];
  if (!spec) throw new Error(`unknown board shape "${shape}"; known: ${BOARD_SHAPES.join(", ")}`);
  return spec;
}

export function boardLength(shape) {
  return specFor(shape).length;
}

export function boardStance(shape) {
  return specFor(shape).stance;
}

function rocker(spec, t) {
  return spec.noseRocker * Math.max(0, 1 - t / 0.38) ** 2.2 + spec.tailRocker * Math.max(0, (t - 0.68) / 0.32) ** 2;
}

function section(spec, t) {
  const w = spec.halfAt(t);
  const T = spec.thickAt(t);
  return { w, T, yc: rocker(spec, t) + T * BOT_FRAC };
}

function topY(spec, t, x) {
  const { w, T, yc } = section(spec, t);
  if (w < 1e-5) return yc;
  const u = clamp(Math.abs(x) / w, 0, 1);
  const c = u ** (1 / RAIL_P);
  const s = Math.sqrt(Math.max(0, 1 - c * c));
  return yc + T * TOP_FRAC * s ** TOP_Q;
}

function bottomY(spec, t, x) {
  const { w, T, yc } = section(spec, t);
  if (w < 1e-5) return yc;
  const u = clamp(Math.abs(x) / w, 0, 1);
  const c = u ** (1 / RAIL_P);
  const s = Math.sqrt(Math.max(0, 1 - c * c));
  return yc - T * BOT_FRAC * s ** BOT_Q;
}

function padHalf(spec, t) {
  const { t0, t1, maxHalf } = spec.pad;
  const rr = (t - (t0 + t1) / 2) / ((t1 - t0) / 2);
  if (Math.abs(rr) >= 1) return 0;
  return Math.min(0.8 * spec.halfAt(t), maxHalf) * Math.sqrt(1 - rr ** 4);
}

function padLift(spec, t) {
  const { t0, t1 } = spec.pad;
  const rr = (t - (t0 + t1) / 2) / ((t1 - t0) / 2);
  return PAD_TH + 0.018 * smooth((rr - 0.25) / 0.75) ** 2;
}

function notchShift(spec, t, x, w) {
  if (!spec.notch) return 0;
  // slope of this ramp times spec.notch must stay below the board length, or rings fold back over each other
  const k = clamp((t - 0.8) / 0.2, 0, 1) ** 1.6;
  return spec.notch * k * (1 - clamp(Math.abs(x) / Math.max(w, 1e-4), 0, 1));
}

/** Height of the standing surface (deck, plus traction pad where there is one) at board-space (x, z), in board space. */
export function deckAt(shape, x, z) {
  const spec = specFor(shape);
  const t = clamp(z / spec.length + 0.5, 0, 1);
  let y = topY(spec, t, x);
  const half = padHalf(spec, t);
  if (half > 0 && Math.abs(x) < half) y += padLift(spec, t);
  return y;
}

/** Unit surface normal of the standing surface at (x, z), board space. Uses the slope along the board. */
export function deckNormal(shape, x, z, out = new THREE.Vector3()) {
  const e = 0.03;
  const dydz = (deckAt(shape, x, z + e) - deckAt(shape, x, z - e)) / (2 * e);
  const dydx = (deckAt(shape, x + e, z) - deckAt(shape, x - e, z)) / (2 * e);
  return out.set(-dydx, 1, -dydz).normalize();
}

// Print texture density: pixels per metre of board. 900 gives a 1584 x 472 mask for the shortboard (a 2.2 m gun is 1980 long),
// about 5 texels per screen pixel at the closest camera, so a print edge stays sharp while mip-mapping keeps it clean far away.
export const BOARD_PRINT_PPM = 900;

function buildHull(spec) {
  const L = spec.length;
  const positions = [];
  const deckSide = [];
  const railArc = [];
  const indices = [];
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    const { w, T, yc } = section(spec, t);
    const ring = positions.length / 3;
    for (let j = 0; j < SEGS; j++) {
      const a = (j / SEGS) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const x = w * Math.sign(c) * Math.abs(c) ** RAIL_P;
      const y = s >= 0 ? yc + T * TOP_FRAC * Math.abs(s) ** TOP_Q : yc - T * BOT_FRAC * Math.abs(s) ** BOT_Q;
      const z = (t - 0.5) * L - notchShift(spec, t, x, w);
      positions.push(x, y, z);
      deckSide.push(s >= 0 ? 1 : 0);
    }
    // Distance along this section (metres, over the surface) from each vertex to the nearer rail apex (vertex 0 and
    // SEGS / 2). The print shader draws the rail band where this is under half the band width, so the band is a crisp
    // line of constant width however the mesh is cut.
    const cum = [0];
    for (let j = 1; j <= SEGS; j++) {
      const p = (ring + j - 1) * 3;
      const q = (ring + (j % SEGS)) * 3;
      cum.push(cum[j - 1] + Math.hypot(positions[q] - positions[p], positions[q + 1] - positions[p + 1], positions[q + 2] - positions[p + 2]));
    }
    const perimeter = cum[SEGS];
    const loop = (d) => Math.min(Math.abs(d), perimeter - Math.abs(d));
    for (let j = 0; j < SEGS; j++) railArc.push(Math.min(loop(cum[j]), loop(cum[j] - cum[SEGS / 2])));
  }
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEGS; j++) {
      const a = i * SEGS + j;
      const b = i * SEGS + ((j + 1) % SEGS);
      indices.push(a, b, a + SEGS, b, b + SEGS, a + SEGS);
    }
  }
  // End caps: their own vertices (so the end face is flat-shaded), stitched between the deck half and its mirror on the bottom half.
  const capRing = (ring, faceTail) => {
    const base = positions.length / 3;
    for (let j = 0; j < SEGS; j++) {
      const src = (ring * SEGS + j) * 3;
      positions.push(positions[src], positions[src + 1], positions[src + 2]);
      deckSide.push(deckSide[ring * SEGS + j]);
      railArc.push(railArc[ring * SEGS + j]);
    }
    const mirror = (j) => (SEGS - j) % SEGS;
    for (let j = 0; j < SEGS / 2; j++) {
      const t0 = base + j;
      const t1 = base + j + 1;
      const b0 = base + mirror(j);
      const b1 = base + mirror(j + 1);
      const quad = faceTail ? [[t0, t1, b0], [t1, b1, b0]] : [[t0, b0, t1], [t1, b0, b1]];
      for (const tri of quad) {
        if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
        indices.push(tri[0], tri[1], tri[2]);
      }
    }
  };
  capRing(0, false);
  capRing(RINGS, true);
  // Print UVs: a plan view of the board. u runs across (the widest half-width on either side maps to 0 and 1), v along the
  // board from the nose (0) to the tail (1). The deck and the bottom read the same print, and the rail, where the surface turns
  // vertical, stays one continuous surface: there is no seam to hide. The strip of rail where the plan view stretches the print
  // is under 1 cm either side of the apex, inside the rail band.
  let xMax = 0;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    xMax = Math.max(xMax, Math.abs(positions[i]));
    zMin = Math.min(zMin, positions[i + 2]);
    zMax = Math.max(zMax, positions[i + 2]);
  }
  const uvs = new Float32Array((positions.length / 3) * 2);
  for (let i = 0; i < positions.length / 3; i++) {
    uvs[i * 2] = (positions[i * 3] + xMax) / (2 * xMax);
    uvs[i * 2 + 1] = (positions[i * 3 + 2] - zMin) / (zMax - zMin);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute("railArc", new THREE.Float32BufferAttribute(railArc, 1));
  geo.setAttribute("deckSide", new THREE.Float32BufferAttribute(deckSide, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  // The end caps meet in a point at the nose and the tail, so their triangles have no area and computeVertexNormals() leaves
  // their vertices with a zero normal; the shader's normalize() of that is NaN, which the bloom pass spreads over the whole
  // frame as black (seen from the front, in the title screen's camera). Give those vertices the direction of their end.
  {
    const nrm = geo.attributes.normal;
    const mid = (zMin + zMax) / 2;
    for (let i = 0; i < nrm.count; i++) {
      if (Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i)) < 1e-6) nrm.setXYZ(i, 0, 0, positions[i * 3 + 2] < mid ? -1 : 1);
    }
  }
  // The print mask covers this box of the board plan (metres, board space) at this size in pixels (multiples of 4).
  geo.userData.print = {
    xMax,
    zMin,
    zMax,
    ppm: BOARD_PRINT_PPM,
    width: Math.ceil((2 * xMax * BOARD_PRINT_PPM) / 4) * 4,
    height: Math.ceil(((zMax - zMin) * BOARD_PRINT_PPM) / 4) * 4,
  };
  return geo;
}

function buildStringer(spec) {
  const L = spec.length;
  const n = 48;
  const w = 0.007;
  const t0 = 0.07;
  const t1 = 0.93;
  const positions = [];
  const indices = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    const z = (t - 0.5) * L;
    for (const x of [-w, 0, w]) {
      positions.push(x, topY(spec, t, x) + STRINGER_LIFT, z);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 2; k++) {
      const a = i * 3 + k;
      const b = a + 1;
      indices.push(a, b, a + 3, b, b + 3, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildPad(spec) {
  const L = spec.length;
  const R = 14;
  const C = 10;
  const { t0, t1 } = spec.pad;
  const positions = [];
  const colors = [];
  const indices = [];
  const grid = (r, c) => r * (C + 1) + c;
  for (let r = 0; r <= R; r++) {
    const t = t0 + ((t1 - t0) * r) / R;
    const half = padHalf(spec, t);
    const z = (t - 0.5) * L;
    for (let c = 0; c <= C; c++) {
      const x = half * (2 * (c / C) - 1);
      const y = topY(spec, t, x) + padLift(spec, t);
      positions.push(x, y, z);
      const grain = (r + c) % 2 ? 1 : 0.8;
      colors.push(0.035 * grain, 0.038 * grain, 0.042 * grain);
    }
  }
  const topCount = positions.length / 3;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const a = grid(r, c);
      const b = grid(r, c + 1);
      indices.push(a, a + C + 1, b, b, a + C + 1, b + C + 1);
    }
  }
  // skirt: perimeter loop dropped to just below the deck
  const loop = [];
  for (let c = 0; c <= C; c++) loop.push(grid(0, c));
  for (let r = 1; r <= R; r++) loop.push(grid(r, C));
  for (let c = C - 1; c >= 0; c--) loop.push(grid(R, c));
  for (let r = R - 1; r >= 1; r--) loop.push(grid(r, 0));
  const lowerOf = new Map();
  for (const idx of loop) {
    const x = positions[idx * 3];
    const z = positions[idx * 3 + 2];
    const t = clamp(z / L + 0.5, 0, 1);
    lowerOf.set(idx, positions.length / 3);
    positions.push(x, topY(spec, t, x) - 0.002, z);
    colors.push(0.03, 0.032, 0.035);
  }
  const cx = 0;
  const cz = ((t0 + t1) / 2 - 0.5) * L;
  for (let k = 0; k < loop.length; k++) {
    const a = loop[k];
    const b = loop[(k + 1) % loop.length];
    const la = lowerOf.get(a);
    const lb = lowerOf.get(b);
    const ax = positions[a * 3];
    const az = positions[a * 3 + 2];
    const bx = positions[b * 3];
    const bz = positions[b * 3 + 2];
    if (Math.abs(ax - bx) < 1e-9 && Math.abs(az - bz) < 1e-9) continue; // collapsed end of the pad
    // pick the winding whose normal points away from the pad centre
    const midx = (ax + bx) / 2 - cx;
    const midz = (az + bz) / 2 - cz;
    const ex = bx - ax;
    const ez = bz - az;
    // (a, la, b) has normal = (la-a) x (b-a) = (0,-h,0) x (ex,0,ez) = (-h*ez, 0, h*ex)
    const outward = -ez * midx + ex * midz > 0;
    if (outward) indices.push(a, la, b, b, la, lb);
    else indices.push(a, b, la, b, lb, la);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  // the top grid faces +y; re-derive so the top normals are not averaged with the skirt
  const nrm = geo.attributes.normal;
  for (let i = 0; i < topCount; i++) {
    if (!loop.includes(i)) continue;
    nrm.setXYZ(i, 0, 1, 0);
  }
  nrm.needsUpdate = true;
  return geo;
}

function buildPlug(spec) {
  const z = (spec.plugT - 0.5) * spec.length;
  const t = spec.plugT;
  const geo = new THREE.CylinderGeometry(0.013, 0.013, 0.008, 18);
  geo.translate(0, topY(spec, t, 0) + 0.004, z);
  return geo;
}

// A foiled fin: swept, flat-sided plate with a rounded leading edge. Shape space is (along board, down).
function finGeometry(base, height, sweep, thick) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(sweep * 0.5, height * 0.62, sweep, height);
  shape.quadraticCurveTo(base * 0.8, height * 0.35, base, 0);
  shape.lineTo(0, 0);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thick,
    bevelEnabled: true,
    bevelThickness: thick * 0.45,
    bevelSize: thick * 0.45,
    bevelSegments: 2,
    curveSegments: 8,
  });
  geo.translate(-base / 2, 0, -thick / 2);
  // shape x -> board z (tail positive), shape y (down) -> board -y, shape z -> board x
  const m = new THREE.Matrix4().set(0, 0, 1, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1);
  geo.applyMatrix4(m);
  geo.computeVertexNormals();
  return geo;
}

function buildFins(spec) {
  const L = spec.length;
  const fins = [];
  const add = (geometry, t, x, cant, toe) => {
    const z = (t - 0.5) * L;
    fins.push({
      geometry,
      position: new THREE.Vector3(x, bottomY(spec, t, x) + 0.012, z),
      rotation: new THREE.Euler(0, Math.sign(x) * toe, -Math.sign(x) * cant, "YXZ"),
    });
  };
  const deg = Math.PI / 180;
  if (spec.fins === "twin") {
    for (const x of [-0.2, 0.2]) add(finGeometry(0.16, 0.095, 0.115, 0.012), 0.8, x, 7 * deg, 3 * deg);
  } else if (spec.fins === "thruster-gun") {
    add(finGeometry(0.13, 0.135, 0.085, 0.011), 0.905, 0, 0, 0);
    for (const x of [-0.085, 0.085]) add(finGeometry(0.125, 0.125, 0.08, 0.011), 0.85, x, 5 * deg, 3 * deg);
  } else {
    add(finGeometry(0.11, 0.11, 0.07, 0.01), 0.89, 0, 0, 0);
    for (const x of [-0.135, 0.135]) add(finGeometry(0.115, 0.105, 0.07, 0.01), 0.835, x, 5 * deg, 3 * deg);
  }
  return fins;
}

/** Everything one board shape is made of. The caller owns (and disposes) the geometries. */
export function createBoardParts(shape) {
  const spec = specFor(shape);
  return {
    shape,
    length: spec.length,
    stance: spec.stance,
    hull: buildHull(spec),
    stringer: buildStringer(spec),
    pad: buildPad(spec),
    plug: buildPlug(spec),
    fins: buildFins(spec),
  };
}

/** Triangle count of a parts bundle, for the report. */
export function boardTriangles(parts) {
  const count = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
  return count(parts.hull) + count(parts.stringer) + count(parts.pad) + count(parts.plug) + parts.fins.reduce((n, f) => n + count(f.geometry), 0);
}
