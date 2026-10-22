// Node check for the surfer pose: are both feet on the deck? (no browser)
//   node scripts/check-pose.mjs [--verbose]
// For every body x board shape x stance weights x steer x throttle x tube state it poses the rig with the
// holder at the origin and measures, for each foot, the lowest skin vertex against the board deck at that
// spot. gap = vertex height - deck height: 0 is standing on it, negative is sunk in, positive is floating.
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { createSurfer, applyPose } from "../src/surfer.js";
import { BOARD_LIFT, deckAt } from "../src/board.js";

const verbose = process.argv.includes("--verbose");
const catalog = JSON.parse(readFileSync(new URL("../src/data/catalog.json", import.meta.url), "utf8"));
const byId = Object.fromEntries([...catalog.bodies, ...catalog.outfits, ...catalog.boards].map((i) => [i.id, i]));
const surfer = await createSurfer({ textures: false }); // geometry only; image decoding needs a browser

const BOARDS = { short: "board-blue", fish: "board-fish", gun: "board-gun" };
const WEIGHTS = {
  crouch: { crouch: 1, glide: 0, claim: 0, wipe: 0 },
  glide: { crouch: 0, glide: 1, claim: 0, wipe: 0 },
  mix: { crouch: 0.5, glide: 0.5, claim: 0, wipe: 0 },
  claim: { crouch: 0, glide: 0, claim: 1, wipe: 0 },
};
const wallPoint = { x: -0.5, y: 0.25, z: 0.05 };

function footVertices(rig, side) {
  const body = rig.meshes.body;
  const names = body.skeleton.bones.map((b) => b.name);
  const set = new Set();
  names.forEach((n, i) => {
    if (n === `foot${side}` || (n.startsWith("toe") && n.endsWith(side))) set.add(i);
  });
  const si = body.geometry.attributes.skinIndex;
  const sw = body.geometry.attributes.skinWeight;
  const out = [];
  for (let i = 0; i < si.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (set.has(si.getComponent(i, k))) w += sw.getComponent(i, k);
    if (w > 0.5) out.push(i);
  }
  return out;
}

const v = new THREE.Vector3();
function footGap(rig, ids) {
  const body = rig.meshes.body;
  let min = Infinity;
  let sumLow = 0;
  const gaps = [];
  for (const i of ids) {
    body.getVertexPosition(i, v);
    v.applyMatrix4(body.matrixWorld);
    surfer.holder.worldToLocal(v);
    const gap = v.y - (BOARD_LIFT + deckAt(surfer.shape, v.x, v.z));
    gaps.push(gap);
    min = Math.min(min, gap);
  }
  gaps.sort((a, b) => a - b);
  const low = gaps.slice(0, Math.max(1, Math.floor(gaps.length * 0.05)));
  sumLow = low.reduce((a, b) => a + b, 0) / low.length;
  return { min, lowMean: sumLow };
}

let worstFloat = -Infinity;
let worstSink = Infinity;
let cases = 0;
const rows = [];
for (const bodyId of ["male", "female"]) {
  for (const [shape, boardId] of Object.entries(BOARDS)) {
    surfer.apply({ body: bodyId, skin: "#c68642", bottom: bodyId === "male" ? "trunks-red" : "bikini-teal", board: boardId }, byId);
    const rig = surfer.active;
    const left = footVertices(rig, "L");
    const right = footVertices(rig, "R");
    for (const [wname, weights] of Object.entries(WEIGHTS)) {
      for (const steer of [-1, 0, 1]) {
        for (const thr of [-1, 0, 1]) {
          for (const tube of [0, 1]) {
            for (const tilt of [0, 0.5]) {
              rig.state.init = false;
              surfer.holder.position.set(0, 0, 0);
              surfer.holder.quaternion.identity();
              applyPose(surfer, weights, 1.3, { steer, thr, inTube: !!tube, deep: !!tube, dt: 1 / 60, vs: steer * 0.6, snap: true, tilt, wall: tube ? wallPoint : null });
              // let the smoothing settle on the held input, as it does in play
              for (let k = 0; k < 90; k++) {
                applyPose(surfer, weights, 1.3 + k / 60, { steer, thr, inTube: !!tube, deep: !!tube, dt: 1 / 60, vs: steer * 0.6, tilt, wall: tube ? wallPoint : null });
              }
              surfer.holder.updateMatrixWorld(true);
              const l = footGap(rig, left);
              const r = footGap(rig, right);
              cases++;
              const floatMax = Math.max(l.lowMean, r.lowMean);
              const sinkMin = Math.min(l.min, r.min);
              worstFloat = Math.max(worstFloat, floatMax);
              worstSink = Math.min(worstSink, sinkMin);
              rows.push({ bodyId, shape, wname, steer, thr, tube, tilt, l, r });
            }
          }
        }
      }
    }
  }
}

if (verbose) {
  for (const r of rows) {
    console.log(`${r.bodyId} ${r.shape} ${r.wname} steer=${r.steer} thr=${r.thr} tube=${r.tube} tilt=${r.tilt}  L lowest ${(r.l.min * 100).toFixed(1)} cm, low5% ${(r.l.lowMean * 100).toFixed(1)} cm | R lowest ${(r.r.min * 100).toFixed(1)} cm, low5% ${(r.r.lowMean * 100).toFixed(1)} cm`);
  }
}
console.log(`cases ${cases}`);
console.log(`worst floating (mean of lowest 5% of foot vertices above deck): ${(worstFloat * 100).toFixed(2)} cm`);
console.log(`deepest sink (single lowest foot vertex below deck): ${(worstSink * 100).toFixed(2)} cm`);
const okFloat = worstFloat < 0.015;
const okSink = worstSink > -0.02;

// ---- does the stance respond? (holder-space positions of head, pelvis and hands) ----
surfer.apply({ body: "male", skin: "#c68642", bottom: "trunks-red", board: "board-blue" }, byId);
const rig = surfer.active;
const holderPos = (bone) => surfer.holder.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
function settle(weights, input, seconds = 1.5, t0 = 2) {
  rig.state.init = false;
  surfer.holder.updateMatrixWorld(true);
  applyPose(surfer, weights, t0, { ...input, dt: 1 / 60, snap: true });
  for (let k = 0; k < seconds * 60; k++) applyPose(surfer, weights, t0 + k / 60, { ...input, dt: 1 / 60 });
  surfer.holder.updateMatrixWorld(true);
  return { head: holderPos(rig.bones.head), pelvis: holderPos(rig.bones.root), handL: holderPos(rig.armL.end), handR: holderPos(rig.armR.end) };
}
const mix = WEIGHTS.mix;
const left = settle(mix, { steer: 1, thr: 0 });
const right = settle(mix, { steer: -1, thr: 0 });
const crouchP = settle(WEIGHTS.crouch, { steer: 0, thr: 0 });
const glideP = settle(WEIGHTS.glide, { steer: 0, thr: 0 });
const claimP = settle(WEIGHTS.claim, { steer: 0, thr: 0 });
const tubeFree = settle(WEIGHTS.crouch, { steer: 0, thr: 0, inTube: false });
const tubeWall = settle(WEIGHTS.crouch, { steer: 0, thr: 0, inTube: true, deep: true, wall: wallPoint });
const hipYs = [];
rig.state.init = false;
for (let k = 0; k < 120; k++) {
  applyPose(surfer, mix, 3 + k / 60, { steer: 0, thr: 1, dt: 1 / 60, snap: k === 0 });
  surfer.holder.updateMatrixWorld(true);
  if (k >= 30) hipYs.push(holderPos(rig.bones.root).y);
}
const pumpRange = Math.max(...hipYs) - Math.min(...hipYs);
const cm = (v) => (v * 100).toFixed(1);
const checks = [
  [`head x, steer left ${cm(left.head.x)} cm vs steer right ${cm(right.head.x)} cm (left leans toward the wall, -x): shift >= 8 cm`, right.head.x - left.head.x >= 0.08],
  [`pelvis x, steer left ${cm(left.pelvis.x)} cm vs right ${cm(right.pelvis.x)} cm: shift >= 3 cm`, right.pelvis.x - left.pelvis.x >= 0.03],
  [`head y, glide ${cm(glideP.head.y)} cm vs crouch ${cm(crouchP.head.y)} cm: crouch lower by >= 6 cm`, glideP.head.y - crouchP.head.y >= 0.06],
  [`right hand y above head y in the claim: hand ${cm(claimP.handR.y)} cm, head ${cm(claimP.head.y)} cm`, claimP.handR.y > claimP.head.y],
  [`rear hand x, free ${cm(tubeFree.handL.x)} cm vs tube wall drag ${cm(tubeWall.handL.x)} cm: >= 25 cm nearer the wall`, tubeFree.handL.x - tubeWall.handL.x >= 0.25],
  [`pelvis bobs ${cm(pumpRange)} cm over 1.5 s of pumping: >= 2 cm`, pumpRange >= 0.02],
];
// ---- do the shoulders sit? ----
// Milestone 1 lifted both clavicles by 0.35 rad in every pose (a shrug: bulbous shoulders). The shoulder joint's height in
// the chest's own frame (spine01, the top spine bone) is compared with the bind pose; the shrug is measured too, for the record.
const chest = rig.bones.spine01;
const shoulderHeights = () => {
  surfer.holder.updateMatrixWorld(true);
  chest.updateWorldMatrix(true, true);
  return ["upperarm01L", "upperarm01R"].map((n) => chest.worldToLocal(rig.bones[n].getWorldPosition(new THREE.Vector3())).y);
};
for (const bone of Object.values(rig.bones)) bone.quaternion.identity();
rig.bones.root.position.copy(rig.restRoot);
const bindShoulder = shoulderHeights();
const rise = (stance, input) => {
  settle(stance, input);
  const h = shoulderHeights();
  return Math.max(h[0] - bindShoulder[0], h[1] - bindShoulder[1]);
};
const riseGlide = rise(WEIGHTS.glide, { steer: 0, thr: 0 });
const riseCrouch = rise(WEIGHTS.crouch, { steer: 0, thr: 0 });
const riseTube = rise(WEIGHTS.crouch, { steer: 0, thr: 0, inTube: true, deep: true, wall: wallPoint });
const riseClaim = rise(WEIGHTS.claim, { steer: 0, thr: 0 });
// the old shrug, applied on top of the glide pose
settle(WEIGHTS.glide, { steer: 0, thr: 0 });
rig.bones.clavicleL.rotation.z = 0.35;
rig.bones.clavicleR.rotation.z = -0.35;
const oldH = shoulderHeights();
const oldRise = Math.max(oldH[0] - bindShoulder[0], oldH[1] - bindShoulder[1]);
checks.push(
  [`shoulders, glide: ${cm(riseGlide)} cm above the bind pose in the chest frame (the 0.35 rad shrug of milestone 1 gave ${cm(oldRise)} cm): <= 1.5 cm`, riseGlide <= 0.015],
  [`shoulders, crouch ${cm(riseCrouch)} cm, tube ${cm(riseTube)} cm: <= 1.5 cm`, riseCrouch <= 0.015 && riseTube <= 0.015],
  [`shoulders, claim (arm overhead) ${cm(riseClaim)} cm: <= 4 cm`, riseClaim <= 0.04],
);
let okResponse = true;
for (const [text, ok] of checks) {
  console.log(`${ok ? "ok  " : "FAIL"} ${text}`);
  if (!ok) okResponse = false;
}
const ok = okFloat && okSink && okResponse;
console.log(ok ? "pose checks passed" : "pose checks FAILED (limits: float < 1.5 cm, sink < 2 cm, responses above)");
process.exit(ok ? 0 : 1);
