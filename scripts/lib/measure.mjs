// Body proportions measured on the shaped MakeHuman mesh (metres, rig frame: +y up, +z chest, +x the character's left).
// Used by scripts/build-surfers.mjs (printed on every build and checked against the ranges below) and by
// scripts/measure-body.mjs (before / after comparison). Every number is read off the vertices of the "body" group and the
// skeleton joints; nothing is estimated from the target weights.
//
// Definitions (all as ratios to height unless noted):
//   height            lowest to highest vertex of the body mesh
//   shoulderWidth     bideltoid with the arms hung straight down: the arm vertices (weighted to the upper arm, forearm or hand)
//                     are turned about the shoulder joint until the upper arm is vertical, then the x extent of the body in
//                     the band from 9 cm below to 3 cm above the joint is taken (the bind pose holds the arms out at
//                     about 45 degrees, which would inflate the number)
//   shoulderJoints    distance between the two upperarm01 joints (glenohumeral)
//   chestCirc         ellipse perimeter (Ramanujan) of the torso cross-section at 72.5% of height (the nipple line), from the
//                     x extent of the vertices that are not weighted to an arm (so the arms do not widen it) and the z extent
//   waistCirc         the same at 60% of height (a little above the navel)
//   hipCirc           the same at the widest point between crotch and waist (the hips, greater trochanter)
//   upperArmDia       mean diameter of the vertices in a 3 cm slab across the upper arm, halfway shoulder joint to elbow
//   foreArmDia        the same halfway elbow to wrist
//   thighDia          the same halfway hip joint to knee, on one leg
//   calfDia           the same on the lower leg
//   neckDia           same across the neck, halfway neck01 head to tail
//   armLength         shoulder joint to wrist along the bones (upper + lower), plus hand length (wrist to the furthest hand vertex)
//   armSpan           2 x armLength + shoulderJoints: what the span would be with the arms held out sideways
//   waistFront60 / waistBack60 / waistBack56   depth of the torso in front of / behind the spine line (the spine joints' z, interpolated at
//                     the band's height) at 60% and 56% of height; the lower back (56%) is what bows inward when a waist target pulls
//                     the whole circumference in
//   vTaper            shoulderWidth / waist width (x extent at 60% of height, arms excluded)
//   legLength         crotch height

const ARM_BONE = /^(clavicle|shoulder|upperarm|lowerarm|wrist|metacarpal|finger)/;
const HAND_BONE = /^(wrist|metacarpal|finger)/;

function ellipse(width, depth) {
  const a = width / 2;
  const b = depth / 2;
  const h = ((a - b) * (a - b)) / ((a + b) * (a + b));
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

function weightTo(infl, v, test) {
  let w = 0;
  for (const [bone, x] of infl[v]) if (test(bone)) w += x;
  return w;
}

// The joints measureBody reads, by MakeHuman joint name.
export const JOINTS_USED = [
  "upperarm01.L____head",
  "upperarm01.R____head",
  "lowerarm01.L____head",
  "wrist.L____head",
  "upperleg01.L____head",
  "lowerleg01.L____head",
  "foot.L____head",
  "neck01____head",
  "neck01____tail",
  "root____head",
  "spine05____head",
  "spine04____head",
  "spine03____head",
  "spine02____head",
  "spine01____head",
];

// verts: Float64Array of positions in metres, indexed by vertex id. The body surface is either bodyFaces (obj faces: arrays of
// [vertexIndex, uvIndex] corners) or an explicit list of vertex ids. infl[v] is [[boneName, weight], ...]; bone names may be
// the MakeHuman names ("upperarm01.L") or the names three.js gives them after loading a glTF (dots removed: "upperarm01L").
export function measureBody({ verts, bodyFaces, vertexIds, joints, infl }) {
  let ids = vertexIds;
  if (!ids) {
    const used = new Set();
    for (const face of bodyFaces) for (const [v] of face) used.add(v);
    ids = [...used];
  }
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of ids) {
    minY = Math.min(minY, verts[v * 3 + 1]);
    maxY = Math.max(maxY, verts[v * 3 + 1]);
  }
  const height = maxY - minY;
  const J = (name) => joints[name];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  const shoulderY = J("upperarm01.L____head")[1];
  const band = (y0, y1, filter) => {
    let lo = Infinity;
    let hi = -Infinity;
    let zlo = Infinity;
    let zhi = -Infinity;
    for (const v of ids) {
      const y = verts[v * 3 + 1];
      if (y < y0 || y > y1) continue;
      if (filter && !filter(v)) continue;
      lo = Math.min(lo, verts[v * 3]);
      hi = Math.max(hi, verts[v * 3]);
      zlo = Math.min(zlo, verts[v * 3 + 2]);
      zhi = Math.max(zhi, verts[v * 3 + 2]);
    }
    return { width: hi - lo, depth: zhi - zlo, zlo, zhi };
  };
  const torsoOnly = (v) => weightTo(infl, v, (b) => ARM_BONE.test(b)) < 0.5;
  const torsoAt = (frac) => {
    const y = minY + frac * height;
    return band(y - 0.012, y + 0.012, torsoOnly);
  };

  // arms hung down: rotate every arm vertex about its shoulder joint (in the xy plane) so the upper arm is vertical
  const jL = J("upperarm01.L____head");
  const eL = J("lowerarm01.L____head");
  const rotation = Math.atan2(-1, 0) - Math.atan2(eL[1] - jL[1], eL[0] - jL[0]);
  const cs = Math.cos(rotation);
  const sn = Math.sin(rotation);
  let hungMax = 0;
  for (const v of ids) {
    let x = Math.abs(verts[v * 3]);
    let y = verts[v * 3 + 1];
    if (weightTo(infl, v, (b) => /^(upperarm|lowerarm|wrist|metacarpal|finger)/.test(b)) > 0.5) {
      const dx = x - jL[0];
      const dy = y - jL[1];
      x = jL[0] + dx * cs - dy * sn;
      y = jL[1] + dx * sn + dy * cs;
    }
    if (y >= shoulderY - 0.09 && y <= shoulderY + 0.03) hungMax = Math.max(hungMax, x);
  }
  const shoulder = { width: 2 * hungMax };
  const chest = torsoAt(0.725);
  const waist = torsoAt(0.6);
  const spineLine = ["root", "spine05", "spine04", "spine03", "spine02", "spine01"].map((n) => J(`${n}____head`)).sort((a, b) => a[1] - b[1]);
  const spineZ = (y) => {
    for (let i = 0; i + 1 < spineLine.length; i++) {
      if (y >= spineLine[i][1] && y <= spineLine[i + 1][1]) {
        return spineLine[i][2] + ((y - spineLine[i][1]) / (spineLine[i + 1][1] - spineLine[i][1])) * (spineLine[i + 1][2] - spineLine[i][2]);
      }
    }
    throw new Error(`no spine segment at y ${y}`);
  };
  const depthsAt = (frac) => {
    const y = minY + frac * height;
    const b = band(y - 0.012, y + 0.012, torsoOnly);
    return { front: b.zhi - spineZ(y), back: spineZ(y) - b.zlo };
  };
  const w60 = depthsAt(0.6);
  const w56 = depthsAt(0.56);
  // hips: widest torso+leg cross-section between the crotch and the waist (legs are included: this is the widest x extent
  // of the body there)
  const crotchY = Math.min(...ids.filter((v) => Math.abs(verts[v * 3]) < 0.004 && verts[v * 3 + 1] > minY + 0.3 * height && verts[v * 3 + 1] < minY + 0.55 * height).map((v) => verts[v * 3 + 1]));
  let hips = { width: 0, depth: 0 };
  for (let f = 0.5; f <= 0.58; f += 0.01) {
    const y = minY + f * height;
    const b = band(y - 0.012, y + 0.012, torsoOnly);
    if (b.width > hips.width) hips = b;
  }

  // diameter of the limb at the middle of a joint pair: vertices in a slab across the axis, radius about the axis
  const limbDia = (a, b, test, reach = 0.16) => {
    const axis = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(...axis);
    const u = axis.map((x) => x / len);
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    let sum = 0;
    let n = 0;
    for (const v of ids) {
      if (test && !test(v)) continue;
      const d = [verts[v * 3] - mid[0], verts[v * 3 + 1] - mid[1], verts[v * 3 + 2] - mid[2]];
      const along = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
      if (Math.abs(along) > 0.015) continue;
      const r = Math.hypot(d[0] - u[0] * along, d[1] - u[1] * along, d[2] - u[2] * along);
      if (r > reach) continue;
      sum += r;
      n++;
    }
    if (!n) throw new Error("limb slab is empty");
    return (2 * sum) / n;
  };
  const isArm = (v) => weightTo(infl, v, (b) => /^(upperarm|lowerarm)/.test(b)) > 0.5;
  const isThigh = (v) => weightTo(infl, v, (b) => /^upperleg/.test(b)) > 0.5;
  const isCalf = (v) => weightTo(infl, v, (b) => /^lowerleg/.test(b)) > 0.5;
  const isNeck = (v) => weightTo(infl, v, (b) => /^neck/.test(b)) > 0.5;
  const upperArmDia = limbDia(J("upperarm01.L____head"), J("lowerarm01.L____head"), isArm, 0.14);
  const foreArmDia = limbDia(J("lowerarm01.L____head"), J("wrist.L____head"), isArm, 0.12);
  const thighDia = limbDia(J("upperleg01.L____head"), J("lowerleg01.L____head"), isThigh, 0.2);
  const calfDia = limbDia(J("lowerleg01.L____head"), J("foot.L____head"), isCalf, 0.15);
  const neckDia = limbDia(J("neck01____head"), J("neck01____tail"), isNeck, 0.12);

  // hand length: wrist joint to the furthest vertex weighted to the hand
  let handLen = 0;
  const wrist = J("wrist.L____head");
  for (const v of ids) {
    if (weightTo(infl, v, (b) => HAND_BONE.test(b) && /\.?L$/.test(b)) < 0.5) continue;
    handLen = Math.max(handLen, Math.hypot(verts[v * 3] - wrist[0], verts[v * 3 + 1] - wrist[1], verts[v * 3 + 2] - wrist[2]));
  }
  const upperLen = dist(J("upperarm01.L____head"), J("lowerarm01.L____head"));
  const lowerLen = dist(J("lowerarm01.L____head"), wrist);
  const shoulderJoints = dist(J("upperarm01.L____head"), J("upperarm01.R____head"));
  const armLength = upperLen + lowerLen + handLen;
  const armSpan = 2 * armLength + shoulderJoints;

  const r = (x) => x / height;
  return {
    heightM: height,
    shoulderWidth: r(shoulder.width),
    shoulderJoints: r(shoulderJoints),
    chestCirc: r(ellipse(chest.width, chest.depth)),
    chestWidth: r(chest.width),
    chestDepth: r(chest.depth),
    waistCirc: r(ellipse(waist.width, waist.depth)),
    waistFront60: r(w60.front),
    waistBack60: r(w60.back),
    waistBack56: r(w56.back),
    waistWidth: r(waist.width),
    waistDepth: r(waist.depth),
    hipCirc: r(ellipse(hips.width, hips.depth)),
    hipWidth: r(hips.width),
    upperArmDia: r(upperArmDia),
    foreArmDia: r(foreArmDia),
    thighDia: r(thighDia),
    calfDia: r(calfDia),
    neckDia: r(neckDia),
    upperArmLen: r(upperLen),
    foreArmLen: r(lowerLen),
    handLen: r(handLen),
    armLength: r(armLength),
    armSpan: r(armSpan),
    vTaper: shoulder.width / waist.width,
    chestToWaist: ellipse(chest.width, chest.depth) / ellipse(waist.width, waist.depth),
    legLength: r(crotchY - minY),
  };
}

export function formatMeasure(m) {
  const f = (x, d = 3) => x.toFixed(d);
  return [
    `height ${f(m.heightM, 3)} m`,
    `shoulder width (bideltoid) ${f(m.shoulderWidth)} of height, shoulder joints ${f(m.shoulderJoints)}`,
    `chest circumference ${f(m.chestCirc)} (width ${f(m.chestWidth)}, depth ${f(m.chestDepth)}), waist ${f(m.waistCirc)} (width ${f(m.waistWidth)}, depth ${f(m.waistDepth)}; from the spine line: front ${f(m.waistFront60, 4)}, back ${f(m.waistBack60, 4)}, back at 56% ${f(m.waistBack56, 4)}), hips ${f(m.hipCirc)}`,
    `V-taper (shoulder / waist width) ${f(m.vTaper, 2)}, chest / waist circumference ${f(m.chestToWaist, 2)}`,
    `upper-arm diameter ${f(m.upperArmDia)}, forearm ${f(m.foreArmDia)}, thigh ${f(m.thighDia)}, calf ${f(m.calfDia)}, neck ${f(m.neckDia)}`,
    `arm length ${f(m.armLength)} (upper ${f(m.upperArmLen)}, fore ${f(m.foreArmLen)}, hand ${f(m.handLen)}), arm span ${f(m.armSpan)}, leg length ${f(m.legLength)}`,
  ];
}
