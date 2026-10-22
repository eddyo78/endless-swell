import * as THREE from "three";

// UVs for printing on the garment shells (rashguards, trunks, bikini pieces, suits).
//
// The shells carry the MakeHuman body UVs, which are laid out for painting skin, not for printing: the atlas is cut into many
// islands (scripts/check-prints.mjs measures 230 to 375 seam-edge pairs per garment), texel density varies about 3x across one
// shell, and the trunks drawstring has no UV at all. A stripe drawn through those UVs breaks at every island border. So every
// shell gets its own projection at load time, the way a sewn garment is cut:
//
//   - the shell is split into regions by the bones its vertices follow: torso (spine, pelvis, breast, shoulder, neck), each arm
//     (upper arm to hand), each leg;
//   - each region is projected onto a cylinder round its own axis (torso: vertical, limbs: along the limb). u is the fraction of
//     the way round, measured along the section's real arc length, so a motif is not squeezed where the section is flat; v is
//     metres from the hem;
//   - where u wraps (the front of each region) the triangles that straddle the wrap take u + 1 on their low side, on duplicated
//     vertices. The print textures tile, and each region repeats the tile a whole number of times round, so the wrap is
//     invisible;
//   - the border between two regions is the seam between two sewn pieces. Cut along the mesh it would be a staircase of
//     triangle edges, so it is cut in the pixel shader instead: a triangle on the border carries both regions' UVs and a signed
//     field (the difference of the two regions' smoothed bone weights), and the shader draws region A where the field is positive
//     and region B where it is negative, anti-aliased. The seam is the smooth zero line of the field.
//
// The UVs are stored in these units (u in turns, v in metres) and the per-pattern repeat is a vertex-shader transform
// (regionTransforms), so one geometry serves every pattern and nothing is rebuilt when an item is equipped.

export const REGIONS = ["torso", "armL", "armR", "legL", "legR"];
const BINS = 72;
const TAU = Math.PI * 2;
// Torso score is faded out within this distance of the vertical torso axis (between the legs the axis runs through the cloth, where
// an angle round it means nothing); the legs, which have their own axes, take that cloth.
const AXIS_FADE = [0.05, 0.11];
const SMOOTH_PASSES = 4;
const MIN_REGION_VERTICES = 12;

/** Which region a bone drives. Bone names have no dots in the glb ("upperarm01L"). */
export function regionOfBone(name) {
  const side = name.endsWith("L") ? "L" : name.endsWith("R") ? "R" : "";
  if (/^(upperarm|lowerarm|wrist|metacarpal|finger)/.test(name)) return side ? `arm${side}` : "torso";
  if (/^(upperleg|lowerleg|foot|toe)/.test(name)) return side ? `leg${side}` : "torso";
  return "torso";
}

function gather(attr, srcOf, name) {
  if (!attr) throw new Error(`garment geometry has no "${name}" attribute`);
  if (attr.isInterleavedBufferAttribute) throw new Error(`garment attribute "${name}" is interleaved; the print projection reads plain buffers`);
  const size = attr.itemSize;
  const out = new attr.array.constructor(srcOf.length * size);
  for (let i = 0; i < srcOf.length; i++) for (let k = 0; k < size; k++) out[i * size + k] = attr.array[srcOf[i] * size + k];
  return new THREE.BufferAttribute(out, size, attr.normalized);
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// The cylinder of one region: axis, angle reference, arc-length table and hem. project(x, y, z) -> { f, along }.
// A limb's axis bends at its middle joint (elbow, knee): two straight segments, and a point belongs to the first segment on the
// shoulder (hip) side of the plane that bisects the bend, the second on the other side. On that plane the distance along both
// axes is the same, so v is continuous across the bend. (A single straight axis from shoulder to wrist passes through the
// inside of a bent elbow, where the angle round it is undefined.)
function makeFrame(r, positions, vertexList, joints, axisZ) {
  const segs = [];
  if (r === 0) {
    segs.push({ o: new THREE.Vector3(0, 0, axisZ), d: new THREE.Vector3(0, 1, 0), base: 0 });
  } else {
    const [a, m, b] = joints[REGIONS[r]].map((q) => new THREE.Vector3(...q));
    const d0 = m.clone().sub(a).normalize();
    const d1 = b.clone().sub(m).normalize();
    segs.push({ o: a, d: d0, base: 0 }, { o: m, d: d1, base: m.distanceTo(a) });
    segs.bisector = d0.clone().add(d1).normalize();
    segs.joint = m;
  }
  for (const seg of segs) {
    seg.e1 = new THREE.Vector3(0, 0, 1);
    seg.e1.addScaledVector(seg.d, -seg.e1.dot(seg.d)).normalize();
    seg.e2 = new THREE.Vector3().crossVectors(seg.d, seg.e1);
  }
  const p = new THREE.Vector3();
  const polar = (x, y, z) => {
    let seg = segs[0];
    if (segs.length > 1) {
      p.set(x, y, z).sub(segs.joint);
      if (p.dot(segs.bisector) >= 0) seg = segs[1];
    }
    p.set(x - seg.o.x, y - seg.o.y, z - seg.o.z);
    const t = p.dot(seg.d);
    p.addScaledVector(seg.d, -t);
    let a = Math.atan2(p.dot(seg.e2), p.dot(seg.e1));
    if (a < 0) a += TAU;
    return { a, rho: p.length(), along: r === 0 ? y : seg.base + t };
  };
  // mean radius per angle bin (empty bins take the region mean, so a partial garment such as a bikini top still has a closed
  // section), smoothed, then the arc length of that section up to every bin edge
  let prof = new Float64Array(BINS);
  const cnt = new Float64Array(BINS);
  let mean = 0;
  let hem = r === 0 ? Infinity : -Infinity;
  for (const v of vertexList) {
    const q = polar(positions.getX(v), positions.getY(v), positions.getZ(v));
    mean += q.rho;
    const bin = Math.min(BINS - 1, Math.floor((q.a / TAU) * BINS));
    prof[bin] += q.rho;
    cnt[bin]++;
    hem = r === 0 ? Math.min(hem, q.along) : Math.max(hem, q.along);
  }
  mean /= vertexList.length;
  for (let b = 0; b < BINS; b++) prof[b] = cnt[b] ? prof[b] / cnt[b] : mean;
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float64Array(BINS);
    for (let b = 0; b < BINS; b++) next[b] = 0.25 * prof[(b + BINS - 1) % BINS] + 0.5 * prof[b] + 0.25 * prof[(b + 1) % BINS];
    prof = next;
  }
  const dTheta = TAU / BINS;
  const cum = new Float64Array(BINS + 1);
  for (let b = 0; b < BINS; b++) {
    const slope = (prof[(b + 1) % BINS] - prof[(b + BINS - 1) % BINS]) / (2 * dTheta);
    cum[b + 1] = cum[b] + Math.hypot(prof[b], slope) * dTheta;
  }
  const circ = cum[BINS];
  const sign = r === 0 ? 1 : -1;
  return {
    circ,
    project(x, y, z) {
      const q = polar(x, y, z);
      const k = q.a / dTheta;
      const b = Math.min(BINS - 1, Math.floor(k));
      const f = (cum[b] + (cum[b + 1] - cum[b]) * (k - b)) / circ;
      return { f, along: sign * (q.along - hem) };
    },
  };
}

/**
 * Build the print geometry of one garment shell.
 * @param src       BufferGeometry: position, normal, skinIndex, skinWeight, _trim (0 cloth, 1 trim band), index
 * @param boneNames the skeleton's bone names, indexed like skinIndex
 * @param pelvisOnly  a garment too small to be sewn from several pieces (the bikini bottom): the print runs unbroken over the
 *                  whole pelvis (the torso cylinder), and only the strip of the crotch between the legs, where the torso axis passes
 *                  through the cloth, goes to the legs
 * @param joints    rig-frame joint positions [x, y, z]: armL / armR = [shoulder, elbow, wrist], legL / legR = [hip, knee, ankle]
 * @returns a new geometry (the caller disposes src) with
 *            uv         region A's UV (u turns round, v metres from the hem)
 *            printUvB   region B's UV (equal to uv away from region borders)
 *            printRegion  A + 8 * B (region indices, REGIONS)
 *            printPhi     > 0 draws A, < 0 draws B (1 away from borders)
 *            printTrim    1 on the hem bands, which are always the second colour
 *          and geometry.userData.print = { circ: metres round each region (0 when the shell has none), seamVertices, triangles,
 *          borderTriangles }
 */
export function buildGarmentPrintGeometry(src, boneNames, joints, { pelvisOnly = false } = {}) {
  const pos = src.attributes.position;
  const skinIndex = src.attributes.skinIndex;
  const skinWeight = src.attributes.skinWeight;
  if (!src.index) throw new Error("garment geometry is not indexed");
  const tri = src.index.array;
  const nTri = tri.length / 3;
  const nVert = pos.count;
  const R = REGIONS.length;
  const boneRegion = boneNames.map((n) => REGIONS.indexOf(regionOfBone(n)));

  // 1. per-vertex region scores: the skin weight on each region's bones, the torso's faded out near its axis, then smoothed over
  //    the mesh so the zero line between two regions is a clean curve
  let score = new Float32Array(nVert * R);
  for (let v = 0; v < nVert; v++) {
    for (let k = 0; k < 4; k++) {
      const w = skinWeight.array[v * 4 + k];
      if (w > 0) score[v * R + boneRegion[skinIndex.array[v * 4 + k]]] += w;
    }
  }
  let zSum = 0;
  let zN = 0;
  for (let v = 0; v < nVert; v++) {
    if (score[v * R] > 0.5) {
      zSum += pos.getZ(v);
      zN++;
    }
  }
  const axisZ = zN ? zSum / zN : 0;
  for (let v = 0; v < nVert; v++) score[v * R] *= smoothstep(AXIS_FADE[0], AXIS_FADE[1], Math.hypot(pos.getX(v), pos.getZ(v) - axisZ));
  const nbr = Array.from({ length: nVert }, () => new Set());
  for (let t = 0; t < nTri; t++) {
    for (let k = 0; k < 3; k++) {
      nbr[tri[t * 3 + k]].add(tri[t * 3 + ((k + 1) % 3)]);
      nbr[tri[t * 3 + k]].add(tri[t * 3 + ((k + 2) % 3)]);
    }
  }
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    const next = new Float32Array(score.length);
    for (let v = 0; v < nVert; v++) {
      const n = nbr[v];
      for (let r = 0; r < R; r++) {
        let sum = 0;
        for (const u of n) sum += score[u * R + r];
        next[v * R + r] = n.size ? 0.5 * score[v * R + r] + (0.5 * sum) / n.size : score[v * R + r];
      }
    }
    score = next;
  }
  if (pelvisOnly) {
    const legL = REGIONS.indexOf("legL");
    const legR = REGIONS.indexOf("legR");
    for (let v = 0; v < nVert; v++) {
      const torso = smoothstep(AXIS_FADE[0], AXIS_FADE[1], Math.hypot(pos.getX(v), pos.getZ(v) - axisZ));
      const left = smoothstep(-0.008, 0.008, pos.getX(v));
      for (let r = 0; r < R; r++) score[v * R + r] = -1;
      score[v * R] = torso;
      score[v * R + legL] = (1 - torso) * left;
      score[v * R + legR] = (1 - torso) * (1 - left);
    }
  }
  const argmax = () => {
    const out = new Uint8Array(nVert);
    for (let v = 0; v < nVert; v++) {
      let best = 0;
      for (let r = 1; r < R; r++) if (score[v * R + r] > score[v * R + best]) best = r;
      out[v] = best;
    }
    return out;
  };
  let vRegion = argmax();
  // a region that wins fewer than MIN_REGION_VERTICES vertices is too small to project: its vertices go to their next best
  const wins = new Array(R).fill(0);
  for (let v = 0; v < nVert; v++) wins[vRegion[v]]++;
  for (let r = 0; r < R; r++) {
    if (wins[r] > 0 && wins[r] < MIN_REGION_VERTICES) for (let v = 0; v < nVert; v++) score[v * R + r] = -1;
  }
  vRegion = argmax();

  // 2. one cylinder per region
  const frames = new Array(R).fill(null);
  for (let r = 0; r < R; r++) {
    const list = [];
    for (let v = 0; v < nVert; v++) if (vRegion[v] === r) list.push(v);
    if (list.length) frames[r] = makeFrame(r, pos, list, joints, axisZ);
  }

  // 3. the triangles. A triangle whose vertices agree on a region is drawn in that region (A = B). On a border it takes the two
  //    regions A, B of its first two disagreeing vertices and carries both UV sets and the field A - B.
  const srcOf = [];
  const outIndex = new Uint32Array(tri.length);
  const uvA = [];
  const uvB = [];
  const code = [];
  const phi = [];
  const slot = new Map();
  let seamVertices = 0;
  let borderTriangles = 0;
  const fa = [0, 0, 0];
  const fb = [0, 0, 0];
  const pa = [null, null, null];
  const pb = [null, null, null];
  for (let t = 0; t < nTri; t++) {
    const vs = [tri[t * 3], tri[t * 3 + 1], tri[t * 3 + 2]];
    const rs = vs.map((v) => vRegion[v]);
    const A = rs[0];
    let B = A;
    for (const r of rs) if (r !== A) B = r;
    if (B !== A) borderTriangles++;
    for (let k = 0; k < 3; k++) {
      pa[k] = frames[A].project(pos.getX(vs[k]), pos.getY(vs[k]), pos.getZ(vs[k]));
      pb[k] = B === A ? pa[k] : frames[B].project(pos.getX(vs[k]), pos.getY(vs[k]), pos.getZ(vs[k]));
      fa[k] = pa[k].f;
      fb[k] = pb[k].f;
    }
    const wrapA = Math.max(...fa) - Math.min(...fa) > 0.5;
    const wrapB = Math.max(...fb) - Math.min(...fb) > 0.5;
    for (let k = 0; k < 3; k++) {
      const sa = wrapA && fa[k] < 0.5 ? 1 : 0;
      const sb = wrapB && fb[k] < 0.5 ? 1 : 0;
      const v = vs[k];
      const key = (((v * R + A) * R + B) * 2 + sa) * 2 + sb;
      let id = slot.get(key);
      if (id === undefined) {
        id = srcOf.length;
        slot.set(key, id);
        srcOf.push(v);
        uvA.push(pa[k].f + sa, pa[k].along);
        uvB.push(pb[k].f + sb, pb[k].along);
        code.push(A + 8 * B);
        phi.push(B === A ? 1 : score[v * R + A] - score[v * R + B]);
        if (sa || sb) seamVertices++;
      }
      outIndex[t * 3 + k] = id;
    }
  }

  const geo = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "skinIndex", "skinWeight"]) geo.setAttribute(name, gather(src.attributes[name], srcOf, name));
  geo.setAttribute("printTrim", gather(src.attributes._trim, srcOf, "_trim"));
  geo.setAttribute("uv", new THREE.BufferAttribute(Float32Array.from(uvA), 2));
  geo.setAttribute("printUvB", new THREE.BufferAttribute(Float32Array.from(uvB), 2));
  geo.setAttribute("printRegion", new THREE.BufferAttribute(Float32Array.from(code), 1));
  geo.setAttribute("printPhi", new THREE.BufferAttribute(Float32Array.from(phi), 1));
  geo.setIndex(new THREE.BufferAttribute(outIndex, 1));
  geo.userData.print = {
    circ: frames.map((fr) => (fr ? fr.circ : 0)),
    seamVertices,
    triangles: nTri,
    borderTriangles,
  };
  return geo;
}

/**
 * The per-region transform from the stored UV (u turns round, v metres from the hem) to the tile's own UV, as four numbers per
 * region (a, b, c, d: tile.x = a u + b v, tile.y = c u + d v), plus the whole number of tile repeats round each region.
 * The tile is tw x th metres. The repeat count is the whole number nearest to circ / (the tile length that runs round), and the
 * tile is scaled by the small remainder (at most about 15%) so the repeats close exactly round the region: no break at the wrap.
 * swap runs the tile's y axis round the region instead of along it (vertical stripes on trunks). around forces the repeat count.
 */
export function regionTransforms(circ, tile, { swap = false, around = null } = {}) {
  const roundLen = swap ? tile.th : tile.tw;
  const alongLen = swap ? tile.tw : tile.th;
  const m = [];
  const repeats = [];
  for (const c of circ) {
    if (!(c > 0)) {
      m.push([0, 0, 0, 0]);
      repeats.push(0);
      continue;
    }
    const n = around ?? Math.max(1, Math.round(c / roundLen));
    const scale = c / (n * roundLen);
    const k = 1 / (alongLen * scale);
    m.push(swap ? [0, k, n, 0] : [n, 0, 0, k]);
    repeats.push(n);
  }
  return { m, repeats };
}
