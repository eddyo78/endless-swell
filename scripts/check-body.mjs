// Body proportions of the bodies the game ships, measured on the glTF the generator wrote (src/assets/surfers.data.js), in
// Node, no browser:   node scripts/check-body.mjs
// The measurements are scripts/lib/measure.mjs (ratios to height); the ranges below are the targets of milestone 3 (a fit adult
// male and an athletic, feminine adult female). A body outside its range fails, so a later change to the targets cannot quietly
// bring back the narrow chest and long thin arms.
import * as THREE from "three";
import { createSurfer } from "../src/surfer.js";
import { JOINTS_USED, formatMeasure, measureBody } from "./lib/measure.mjs";

const surfer = await createSurfer({ textures: false });

// [min, max] per measurement. Shoulder width is the bideltoid with the arms hung down (see measure.mjs).
const RANGES = {
  male: {
    shoulderWidth: [0.26, 0.3],
    shoulderJoints: [0.22, 0.25],
    chestCirc: [0.55, 0.64],
    waistCirc: [0.4, 0.48],
    chestToWaist: [1.2, 1.45],
    upperArmDia: [0.058, 0.075],
    foreArmDia: [0.043, 0.056],
    thighDia: [0.125, 0.145],
    armSpan: [0.97, 1.03],
    legLength: [0.46, 0.5],
  },
  female: {
    shoulderWidth: [0.245, 0.285],
    shoulderJoints: [0.195, 0.225],
    chestCirc: [0.5, 0.58],
    // Waist (Ed, 2026-10-21): slim and flat in front, the lower back as in the milestone-3 body (it is not to bow inward above the
    // bikini). Measured: circumference 0.385 (milestone 3: 0.416; first slimming, whose back bowed in: 0.368), width 0.150 (0.159;
    // 0.151), front depth from the spine line 0.074 (0.085; 0.072), back depth 0.0175 (0.0175; 0.0058), back at 56% of height
    // 0.0206 (0.0206; 0.0136). The back ranges sit between milestone 3 and the first slimming, closer to milestone 3.
    waistCirc: [0.37, 0.4],
    waistWidth: [0.144, 0.156],
    waistFront60: [0.066, 0.08],
    waistBack60: [0.014, 0.021],
    waistBack56: [0.017, 0.025],
    hipCirc: [0.52, 0.58],
    chestToWaist: [1.3, 1.46],
    upperArmDia: [0.052, 0.065],
    foreArmDia: [0.037, 0.047],
    thighDia: [0.118, 0.14],
    armSpan: [0.97, 1.03],
    legLength: [0.44, 0.48],
  },
};

let failed = 0;
for (const kind of ["male", "female"]) {
  const rig = surfer[kind];
  const mesh = rig.meshes.body;
  const pos = mesh.geometry.attributes.position;
  const si = mesh.geometry.attributes.skinIndex;
  const sw = mesh.geometry.attributes.skinWeight;
  const boneNames = mesh.skeleton.bones.map((b) => b.name);
  const verts = new Float64Array(pos.count * 3);
  const infl = new Array(pos.count);
  const ids = [];
  for (let i = 0; i < pos.count; i++) {
    verts[i * 3] = pos.getX(i);
    verts[i * 3 + 1] = pos.getY(i);
    verts[i * 3 + 2] = pos.getZ(i);
    const list = [];
    for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > 0) list.push([boneNames[si.getComponent(i, k)], sw.getComponent(i, k)]);
    infl[i] = list;
    ids.push(i);
  }
  // bone heads in the body mesh's own frame (the frame its vertices are in), whatever the model's place in the scene
  rig.root.updateMatrixWorld(true);
  const headOf = (name) => {
    const bone = mesh.skeleton.bones.find((b) => b.name === name.replaceAll(".", ""));
    if (!bone) throw new Error(`${kind} rig has no bone ${name}`);
    const p = bone.getWorldPosition(new THREE.Vector3());
    mesh.worldToLocal(p);
    return [p.x, p.y, p.z];
  };
  const joints = {};
  for (const j of JOINTS_USED) {
    const [bone, end] = j.split("____");
    joints[j] = end === "head" ? headOf(bone) : headOf("neck02"); // neck01's tail is where neck02 starts
  }
  const m = measureBody({ verts, vertexIds: ids, joints, infl });
  console.log(`${kind}:`);
  for (const line of formatMeasure(m)) console.log("  " + line);
  for (const [key, [lo, hi]] of Object.entries(RANGES[kind])) {
    const v = m[key];
    const pass = v >= lo && v <= hi;
    if (!pass) failed++;
    console.log(`${pass ? "ok  " : "FAIL"} ${kind} ${key} ${v.toFixed(3)} in [${lo}, ${hi}]`);
  }
}
if (failed) {
  console.log(`body checks FAILED (${failed})`);
  process.exit(1);
}
console.log("body checks passed");
