import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { femaleB64, maleB64, textures } from "./assets/surfers.data.js";
import { BOARD_LIFT, createBoardParts, deckAt, deckNormal } from "./board.js";
import { boardTexture, garmentTexture, printSpec, trimPrints, zeroTexture } from "./printart.js";
import { createBoardMaterial, createGarmentMaterial } from "./printmat.js";
import { buildGarmentPrintGeometry, regionTransforms } from "./printuv.js";

// Frames used below.
//   holder  : the board's frame, sits on the wave face. +y is the face normal, board nose at -z (travel), +x is down the face
//             (away from the wall). The wall is at -x.
//   rig     : the MakeHuman skeleton's own frame. +z is the chest, +y up, +x the character's left.
// The surfer stands goofy (right foot forward), chest turned to the wall, head turned down the line.
export const STANCE_YAW = -Math.PI / 2 - 0.42;
const FOOT_CENTRE_FROM_ANKLE = 0.07; // the ankle bone sits this far behind the middle of the foot
// Scene light is strong and cool (sun, teal fill, blue sky) and ACES tone mapping squeezes the bright warm channels,
// so a plain catalog colour reads washed-out and green-yellow. Albedo is therefore scaled per channel before it reaches
// the material. The skin table was fitted in the browser (scripts/skin-calibrate.mjs, day look): for each catalog tone,
// the factor that makes the sunlit skin render as its hex. Other hexes interpolate by luminance. The skin colour map is a
// detail map whose mean sits at 60% (scripts/build-surfers.mjs SKIN_LEVEL), which is why the factors are above 1.
const skinTable = (rows) => rows.map(([hex, comp]) => ({ lum: new THREE.Color(hex).getHSL({}).l, comp }));
const SKIN_COMP = skinTable([
  ["#3b2418", [2.829, 2.057, 0.396]],
  ["#6e3a22", [2.117, 1.834, 0.817]],
  ["#8d5524", [1.921, 1.532, 0.661]],
  ["#c68642", [2.029, 1.257, 0.735]],
  ["#e0ac69", [2.464, 1.294, 0.777]],
  ["#f1c27d", [3.286, 1.417, 0.649]],
]);
// The same, fitted in the Locker's neutral studio light (scripts/studio-calibrate.mjs fit): the wave scene's gains above cancel its
// cool blue light and would turn skin and cloth orange under a neutral one. surfer.studio switches to these while the Locker is open.
const STUDIO_SKIN_COMP = skinTable([
["#3b2418", [1.302, 0.865, 0.303]],   // target 59,36,24 measured 59,36,25
  ["#6e3a22", [1.624, 1.381, 0.854]],   // target 110,58,34 measured 110,58,34
  ["#8d5524", [1.676, 1.573, 0.962]],   // target 141,85,36 measured 141,85,36
  ["#c68642", [1.728, 1.691, 1.456]],   // target 198,134,66 measured 198,134,66
  ["#e0ac69", [1.994, 2.069, 2.074]],   // target 224,172,105 measured 224,172,105
  ["#f1c27d", [2.01, 2.083, 2.099]],   // target 241,194,125 measured 241,194,125
]);
const STUDIO_CLOTH_FIT = [
["#c41622", [0.633, 0.431, 0.54]],   // target 196,22,34 measured 196,22,34
  ["#7a0610", [0.608, 0.05, 0.354]],   // target 122,6,16 measured 122,8,16
  ["#16324a", [0.431, 0.586, 0.623]],   // target 22,50,74 measured 22,50,74
  ["#0c1c2c", [0.24, 0.503, 0.577]],   // target 12,28,44 measured 12,28,44
  ["#0e6b4c", [0.294, 0.633, 0.632]],   // target 14,107,76 measured 14,107,76
  ["#d8ffe4", [0.627, 0.8, 0.655]],   // target 216,255,228 measured 216,255,228
  ["#f4f1ea", [0.629, 0.643, 0.655]],   // target 244,241,234 measured 244,241,234
  ["#e23b2f", [0.626, 0.607, 0.6]],   // target 226,59,47 measured 226,59,47
  ["#14b8b0", [0.404, 0.641, 0.651]],   // target 20,184,176 measured 20,184,176
  ["#063e42", [0.05, 0.606, 0.616]],   // target 6,62,66 measured 9,62,66
  ["#ff6a3d", [0.901, 0.634, 0.622]],   // target 255,106,61 measured 255,106,61
  ["#ffd0a8", [0.9, 0.643, 0.653]],   // target 255,208,168 measured 255,208,168
  ["#f3f6f8", [0.628, 0.646, 0.662]],   // target 243,246,248 measured 243,246,248
  ["#9fd6ea", [0.623, 0.643, 0.655]],   // target 159,214,234 measured 159,214,234
  ["#123a40", [0.366, 0.601, 0.615]],   // target 18,58,64 measured 18,58,64
  ["#3ddc97", [0.589, 0.642, 0.651]],   // target 61,220,151 measured 61,220,151
  ["#e6b422", [0.627, 0.642, 0.554]],   // target 230,180,34 measured 230,180,34
  ["#0a1330", [0.171, 0.408, 0.586]],   // target 10,19,48 measured 10,19,48
  ["#1b3f73", [0.475, 0.611, 0.65]],   // target 27,63,115 measured 27,63,115
  ["#8fd0ff", [0.621, 0.643, 0.739]],   // target 143,208,255 measured 143,208,255
  ["#141418", [0.411, 0.423, 0.477]],   // target 20,20,24 measured 20,20,24
  ["#3a3a44", [0.592, 0.604, 0.624]],   // target 58,58,68 measured 58,58,68
  ["#0f8f8a", [0.315, 0.638, 0.648]],   // target 15,143,138 measured 15,143,138
  ["#e8574a", [0.626, 0.627, 0.633]],   // target 232,87,74 measured 232,87,74
  ["#fff1e6", [0.9, 0.643, 0.654]],   // target 255,241,230 measured 255,241,230
  ["#f4ecd8", [0.629, 0.643, 0.654]],   // target 244,236,216 measured 244,236,216
  ["#4a3a24", [0.609, 0.604, 0.548]],   // target 74,58,36 measured 74,58,36
  ["#1f7fbf", [0.513, 0.636, 0.651]],   // target 31,127,191 measured 31,127,191
  ["#e9f6ff", [0.628, 0.646, 0.732]],   // target 233,246,255 measured 233,246,255
  ["#2a7d4f", [0.558, 0.636, 0.634]],   // target 42,125,79 measured 42,125,79
  ["#f0f7d8", [0.628, 0.648, 0.654]],   // target 240,247,216 measured 240,247,216
  ["#f0562c", [0.626, 0.626, 0.593]],   // target 240,86,44 measured 240,86,44
  ["#4a1f3d", [0.606, 0.514, 0.611]],   // target 74,31,61 measured 74,31,61
  ["#e9eef2", [0.627, 0.643, 0.655]],   // target 233,238,242 measured 233,238,242
  ["#3b4a57", [0.591, 0.621, 0.638]],   // target 59,74,87 measured 59,74,87
  ["#d6dde3", [0.627, 0.643, 0.655]],   // target 214,221,227 measured 214,221,227
  ["#f2b632", [0.627, 0.642, 0.605]],   // target 242,182,50 measured 242,182,50
  ["#27323a", [0.547, 0.587, 0.607]],   // target 39,50,58 measured 39,50,58
  ["#d2386c", [0.626, 0.603, 0.645]],   // target 210,56,108 measured 210,56,108
  ["#ffe3ec", [0.9, 0.643, 0.654]],   // target 255,227,236 measured 255,227,236
  ["#5b4aa6", [0.612, 0.621, 0.65]],   // target 91,74,166 measured 91,74,166
  ["#f3d9ff", [0.628, 0.643, 0.733]],   // target 243,217,255 measured 243,217,255
  ["#7d8a8c", [0.619, 0.638, 0.65]],   // target 125,138,140 measured 125,138,140
  ["#f1e6d4", [0.627, 0.643, 0.654]],   // target 241,230,212 measured 241,230,212
  ["#8fcf4a", [0.62, 0.643, 0.633]],   // target 143,207,74 measured 143,207,74
  ["#13261b", [0.396, 0.553, 0.502]],   // target 19,38,27 measured 19,38,27
  ["#4fc6d6", [0.603, 0.642, 0.654]],   // target 79,198,214 measured 79,198,214
  ["#08323f", [0.087, 0.584, 0.609]],   // target 8,50,63 measured 9,50,63
  ["#e0328c", [0.626, 0.593, 0.65]],   // target 224,50,140 measured 224,50,140
  ["#2a0b27", [0.551, 0.215, 0.563]],   // target 42,11,39 measured 42,11,39
  ["#ff7a1a", [0.9, 0.636, 0.508]],   // target 255,122,26 measured 255,122,26
  ["#0b6b72", [0.202, 0.633, 0.644]],   // target 11,107,114 measured 11,107,114
  ["#7a3df0", [0.62, 0.61, 0.652]],   // target 122,61,240 measured 122,61,240
  ["#e4d9ff", [0.627, 0.643, 0.734]],   // target 228,217,255 measured 228,217,255
  ["#c8182d", [0.631, 0.46, 0.586]],   // target 200,24,45 measured 200,24,45
  ["#f6e8e2", [0.631, 0.643, 0.655]],   // target 246,232,226 measured 246,232,226
  ["#4fd1a5", [0.602, 0.643, 0.653]],   // target 79,209,165 measured 79,209,165
  ["#0c3a3d", [0.221, 0.6, 0.61]],   // target 12,58,61 measured 12,58,61
  ["#17234d", [0.447, 0.541, 0.62]],   // target 23,35,77 measured 23,35,77
  ["#7fc4ff", [0.618, 0.643, 0.739]],   // target 127,196,255 measured 127,196,255
  ["#ff4a1c", [0.901, 0.621, 0.525]],   // target 255,74,28 measured 255,74,28
  ["#1a0a08", [0.477, 0.178, 0.097]],   // target 26,10,8 measured 26,10,9
  ["#2fbfae", [0.567, 0.642, 0.652]],   // target 47,191,174 measured 47,191,174
  ["#2a1466", [0.553, 0.419, 0.629]],   // target 42,20,102 measured 42,20,102
  ["#14101f", [0.412, 0.354, 0.529]],   // target 20,16,31 measured 20,16,31
  ["#ff3d9a", [0.902, 0.61, 0.649]],   // target 255,61,154 measured 255,61,154
  ["#dff6ff", [0.627, 0.646, 0.732]],   // target 223,246,255 measured 223,246,255
  ["#1e6fb0", [0.507, 0.634, 0.65]],   // target 30,111,176 measured 30,111,176
  ["#c45cf2", [0.626, 0.629, 0.655]],   // target 196,92,242 measured 196,92,242
  ["#201a3a", [0.515, 0.488, 0.602]],   // target 32,26,58 measured 32,26,58
  ["#1c0a24", [0.491, 0.179, 0.553]],   // target 28,10,36 measured 28,10,36
  ["#ff8a3c", [0.9, 0.638, 0.621]],   // target 255,138,60 measured 255,138,60
].map(([hex, comp]) => ({ rgb: new THREE.Color(hex), comp }));
// Cloth is compensated the same way, per colour: a fitted gain for every catalog cloth colour (scripts/cloth-calibrate.mjs,
// day look, refitted 2026-10-21 on the women's rashguard with the cloth light ceiling of src/printmat.js), so a "gold" rashguard renders gold. A colour that is not in the table (earned gear with generated colours,
// milestone 4) takes an inverse-distance blend of the fitted gains of the colours near it; CLOTH_COMP is the gain used
// before any fit exists.
const CLOTH_COMP = [0.85, 0.65, 0.55];
const BOARD_COMP = [0.3, 0.3, 0.3];
const CLOTH_FIT = [
  ["#c41622", [0.735, 1.198, 0.512]],
  ["#7a0610", [0.857, 4.006, 0.568]],
  ["#16324a", [2.075, 0.939, 0.558]],
  ["#0c1c2c", [2.385, 1.265, 0.744]],
  ["#0e6b4c", [1.734, 0.591, 0.5]],
  ["#d8ffe4", [0.482, 2.058, 0.577]],
  ["#f4f1ea", [1.903, 1.277, 0.772]],
  ["#e23b2f", [0.801, 0.597, 0.43]],
  ["#14b8b0", [0.05, 0.532, 0.387]],
  ["#063e42", [3.087, 0.828, 0.581]],
  ["#ff6a3d", [1.206, 0.303, 0.253]],
  ["#ffd0a8", [1.961, 0.569, 0.284]],
  ["#f3f6f8", [1.89, 1.564, 1.283]],
  ["#9fd6ea", [0.335, 0.684, 0.782]],
  ["#123a40", [2.242, 0.863, 0.593]],
  ["#3ddc97", [0.05, 0.734, 0.289]],
  ["#1b3f73", [1.777, 0.805, 0.444]],
  ["#8fd0ff", [0.096, 0.622, 1.545]],
  ["#141418", [2.029, 1.407, 0.897]],
  ["#3a3a44", [1.155, 0.846, 0.572]],
  // gold set and the four earned-gear palette colours moved out of the skin-tone band (scripts/check-genders.mjs), refitted 2026-10-21
  ["#e6b422", [1.025, 0.511, 0.05]],
  ["#0a1330", [2.56, 1.436, 0.739]],
  ["#f4ecd8", [1.808, 1.073, 0.49]],
  ["#f0562c", [0.908, 0.447, 0.306]],
  ["#7d8a8c", [0.721, 0.528, 0.39]],
  ["#1c0a24", [1.963, 1.461, 0.844]],
  // earned-gear palette colours (src/data/tour.json "gear"), fitted with scripts/cloth-calibrate.mjs fit
  ["#0f8f8a", [3.052, 0.526, 0.392]],
  ["#e8574a", [0.846, 0.485, 0.408]],
  ["#fff1e6", [2.834, 1.309, 0.709]],
  ["#4a3a24", [1.024, 0.843, 0.714]],
  ["#1f7fbf", [1.653, 0.537, 0.44]],
  ["#e9f6ff", [1.277, 1.538, 1.682]],
  ["#2a7d4f", [1.349, 0.55, 0.474]],
  ["#f0f7d8", [1.617, 1.576, 0.461]],
  ["#4a1f3d", [1.092, 1.171, 0.619]],
  ["#e9eef2", [1.32, 1.145, 0.99]],
  ["#3b4a57", [1.115, 0.728, 0.496]],
  ["#d6dde3", [0.906, 0.768, 0.654]],
  ["#f2b632", [1.19, 0.487, 0.05]],
  ["#27323a", [1.453, 0.933, 0.628]],
  ["#d2386c", [0.754, 0.694, 0.416]],
  ["#ffe3ec", [2.541, 0.829, 0.824]],
  ["#5b4aa6", [0.867, 0.703, 0.41]],
  ["#f3d9ff", [1.625, 0.671, 1.585]],
  ["#f1e6d4", [1.642, 0.912, 0.457]],
  ["#13261b", [2.046, 1.104, 0.817]],
  ["#08323f", [2.256, 0.935, 0.604]],
  ["#e0328c", [0.8, 0.626, 0.389]],
  ["#2a0b27", [1.613, 1.509, 0.799]],
  ["#ff7a1a", [1.238, 0.331, 0.05]],
  ["#0b6b72", [2.272, 0.59, 0.426]],
  ["#7a3df0", [0.508, 0.63, 0.813]],
  ["#e4d9ff", [1.11, 0.693, 1.581]],
  ["#c8182d", [0.74, 1.185, 0.527]],
  ["#f6e8e2", [1.946, 0.958, 0.618]],
  ["#4fd1a5", [0.05, 0.641, 0.347]],
  ["#0c3a3d", [1.859, 0.851, 0.604]],
  ["#17234d", [2.044, 1.126, 0.558]],
  ["#7fc4ff", [0.063, 0.555, 1.508]],
  ["#ff4a1c", [1.165, 0.207, 0.05]],
  ["#1a0a08", [2.012, 1.493, 0.578]],
  ["#2a1466", [1.618, 1.371, 0.485]],
  ["#14101f", [2.074, 1.468, 0.87]],
  ["#ff3d9a", [1.18, 0.092, 0.367]],
  ["#dff6ff", [0.852, 1.508, 1.664]],
  ["#1e6fb0", [1.254, 0.569, 0.415]],
  ["#201a3a", [1.718, 1.266, 0.655]],
  ["#ff8a3c", [1.289, 0.352, 0.167]],
  ["#8fcf4a", [0.429, 0.634, 0.143]],
  ["#4fc6d6", [0.05, 0.583, 0.534]],
  ["#c45cf2", [0.647, 0.475, 0.872]],
  ["#2fbfae", [0.05, 0.561, 0.387]],
].map(([hex, comp]) => ({ rgb: new THREE.Color(hex), comp }));

// Calibration overrides, shared by the module's colour functions and exposed as surfer.tune.
const TUNE = { studio: false, skin: null, clothOverride: null, cloth: new THREE.Color(...CLOTH_COMP), board: new THREE.Color(...BOARD_COMP) };

function clothComp(color, out) {
  if (TUNE.clothOverride) return out.copy(TUNE.clothOverride);
  const table = TUNE.studio ? STUDIO_CLOTH_FIT : CLOTH_FIT;
  if (!table.length) return out.copy(TUNE.cloth);
  let wsum = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const e of table) {
    const d2 = (e.rgb.r - color.r) ** 2 + (e.rgb.g - color.g) ** 2 + (e.rgb.b - color.b) ** 2;
    if (d2 < 1e-6) return out.setRGB(...e.comp);
    const w = 1 / (d2 + 0.002) ** 2;
    wsum += w;
    r += w * e.comp[0];
    g += w * e.comp[1];
    b += w * e.comp[2];
  }
  return out.setRGB(r / wsum, g / wsum, b / wsum);
}
const _cc = new THREE.Color();

function skinComp(color, out, t = SKIN_COMP) {
  const l = color.getHSL({}).l;
  if (l <= t[0].lum) return out.setRGB(...t[0].comp);
  if (l >= t[t.length - 1].lum) return out.setRGB(...t[t.length - 1].comp);
  let i = 0;
  while (l > t[i + 1].lum) i++;
  const k = (l - t[i].lum) / (t[i + 1].lum - t[i].lum);
  return out.setRGB(...t[i].comp.map((v, c) => v + (t[i + 1].comp[c] - v) * k));
}

const _comp = new THREE.Color();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qHolder = new THREE.Quaternion();
const _qArm = new THREE.Quaternion();
const _qRel = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _side = new THREE.Vector3();
const _hip = new THREE.Vector3();
const _to = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _candA = new THREE.Vector3();
const _candB = new THREE.Vector3();
const _knee = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const HOLDER_Z = new THREE.Vector3(0, 0, 1);

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

// Dress one garment mesh: its two colours (each with the cloth gain fitted for it, see clothComp) and its print. The print is
// a mask texture (src/printart.js) drawn at runtime and cached, repeated a whole number of times round each part of the shell
// (src/printuv.js); the material mixes the two colours by that mask (src/printmat.js) and shows the hem bands in the second
// colour. withTextures false (the Node checks, which have no canvas) records the choice and builds no texture.
function dressGarment(mesh, style, pattern, c1, c2, withTextures) {
  const uniforms = mesh.material.userData.print;
  const A = uniforms.uPrintA.value.set(c1);
  A.multiply(clothComp(A, _cc));
  const B = uniforms.uPrintB.value.set(c2);
  B.multiply(clothComp(B, _cc));
  mesh.userData.print = { pattern, style, c1, c2 };
  const spec = printSpec(pattern, style);
  const { m } = regionTransforms(mesh.geometry.userData.print.circ, spec ? spec.tile : { tw: 1, th: 1 }, spec || {});
  m.forEach((row, r) => uniforms.uPrintM.value[r].set(...row));
  if (withTextures) mesh.material.map = spec ? garmentTexture(pattern) : zeroTexture();
}

function decodeGlb(b64) {
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer;
}

function loadGlb(b64) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(decodeGlb(b64), "", resolve, reject);
  });
}

function findBone(bones, name) {
  const bone = bones[name] || bones[name.replaceAll(".", "")];
  if (!bone) throw new Error(`surfer rig has no bone "${name}"`);
  return bone;
}

function chainOf(bones, upperName, midName, endName) {
  const upper = findBone(bones, upperName);
  const mid = findBone(bones, midName);
  const end = findBone(bones, endName);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  upper.getWorldPosition(a);
  mid.getWorldPosition(b);
  end.getWorldPosition(c);
  const upperDir = b.clone().sub(a);
  const lowerDir = c.clone().sub(b);
  return {
    upper,
    mid,
    end,
    upperLen: upperDir.length(),
    lowerLen: lowerDir.length(),
    upperDir: upperDir.normalize(),
    lowerDir: lowerDir.normalize(),
    upperRest: a.clone(),
    midRest: b.clone(),
    endRest: c.clone(),
  };
}

// Lowest point of the skin weighted to one foot (foot bone and its toes), in the bind pose.
function lowestFootPoint(bodyMesh, side) {
  const names = bodyMesh.skeleton.bones.map((bone) => bone.name);
  const footSet = new Set();
  names.forEach((name, i) => {
    if (name === `foot${side}` || (name.startsWith("toe") && name.endsWith(side))) footSet.add(i);
  });
  if (!footSet.size) throw new Error(`surfer rig has no foot/toe bones for side ${side}`);
  const pos = bodyMesh.geometry.attributes.position;
  const skinIndex = bodyMesh.geometry.attributes.skinIndex;
  const skinWeight = bodyMesh.geometry.attributes.skinWeight;
  let min = Infinity;
  for (let i = 0; i < pos.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (footSet.has(skinIndex.getComponent(i, k))) w += skinWeight.getComponent(i, k);
    if (w > 0.5) min = Math.min(min, pos.getY(i));
  }
  if (!Number.isFinite(min)) throw new Error(`no skin vertices weighted to the ${side} foot`);
  return min;
}

function prepareRig(gltf, kind) {
  const root = gltf.scene;
  root.name = kind;
  root.updateMatrixWorld(true);
  let skeleton = null;
  const meshes = {};
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    if (meshes[obj.name]) throw new Error(`${kind} rig has two meshes named "${obj.name}"`);
    meshes[obj.name] = obj;
    obj.frustumCulled = false;
    obj.castShadow = false;
    obj.receiveShadow = false;
    if (obj.isSkinnedMesh && !skeleton) skeleton = obj.skeleton;
  });
  if (!skeleton) throw new Error(`${kind} rig has no skinned mesh`);
  const bones = {};
  for (const bone of skeleton.bones) bones[bone.name] = bone;
  const body = meshes.body;
  if (!body) throw new Error(`${kind} rig has no "body" mesh; found ${Object.keys(meshes).join(", ")}`);
  body.geometry.computeBoundingBox();
  const minY = body.geometry.boundingBox.min.y;

  // Everything below is measured with the rig still at the origin and unrotated, so these are rig-frame numbers.
  const legL = chainOf(bones, "upperleg01.L", "lowerleg01.L", "foot.L");
  const legR = chainOf(bones, "upperleg01.R", "lowerleg01.R", "foot.R");
  const armL = chainOf(bones, "upperarm01.L", "lowerarm01.L", "wrist.L");
  const armR = chainOf(bones, "upperarm01.R", "lowerarm01.R", "wrist.R");
  const restRootWorld = new THREE.Vector3();
  bones.root.getWorldPosition(restRootWorld);
  const hipCentre = legL.upperRest.clone().add(legR.upperRest).multiplyScalar(0.5);
  const ankleH = {
    L: legL.endRest.y - lowestFootPoint(body, "L"),
    R: legR.endRest.y - lowestFootPoint(body, "R"),
  };
  const ankleY = (legL.endRest.y + legR.endRest.y) / 2;

  root.position.y = -minY + BOARD_LIFT + 0.05;
  return {
    kind,
    root,
    armature: bones.root.parent,
    bones,
    meshes,
    minY,
    restRoot: bones.root.position.clone(),
    hipOffset: hipCentre.clone().sub(restRootWorld),
    hipAboveAnkle: hipCentre.y - ankleY,
    ankleH,
    legL,
    legR,
    armL,
    armR,
    state: { init: false, steer: 0, thr: 0, tube: 0, deep: 0, drag: 0 },
  };
}

// Scene light is bright, so every character material keeps its mirror-like reflection low (specularIntensity)
// or the sky and sun reflections wash the colour out to grey-white. (The cloth materials are made in src/printmat.js.)

function showMesh(mesh, visible) {
  if (typeof visible !== "boolean") throw new Error(`showMesh(${mesh?.name}) wants a boolean, got ${visible}`);
  mesh.visible = visible;
}

function mixW(weights, crouch, glide, claim, wipe) {
  return crouch * weights.crouch + glide * weights.glide + claim * weights.claim + wipe * (weights.wipe || 0);
}

function setDirection(bone, bindDir, worldDir) {
  const parent = bone.parent;
  parent.updateWorldMatrix(true, false);
  parent.getWorldQuaternion(_q);
  _desired.copy(worldDir).normalize().applyQuaternion(_q2.copy(_q).invert());
  if (_desired.lengthSq() < 1e-8 || bindDir.lengthSq() < 1e-8) return;
  bone.quaternion.setFromUnitVectors(bindDir, _desired);
}

function solveTwoBone(chain, target, pole) {
  const { upper, mid, upperLen, lowerLen, upperDir, lowerDir } = chain;
  upper.updateWorldMatrix(true, false);
  _hip.setFromMatrixPosition(upper.matrixWorld);
  _to.copy(target).sub(_hip);
  const reach = Math.max(upperLen + lowerLen - 1e-4, 1e-4);
  const minReach = Math.abs(upperLen - lowerLen) + 1e-4;
  const raw = _to.length();
  const len = Math.min(reach, Math.max(minReach, raw || minReach));
  if (raw < 1e-6) _to.set(0, -1, 0);
  _to.setLength(len);
  _pole.copy(pole).sub(_hip);
  _axis.crossVectors(_to, _pole);
  if (_axis.lengthSq() < 1e-10) _axis.set(1, 0, 0);
  _axis.normalize();
  const cosA = THREE.MathUtils.clamp((upperLen * upperLen + len * len - lowerLen * lowerLen) / (2 * upperLen * len), -1, 1);
  const ang = Math.acos(cosA);
  _dir.copy(_to).normalize();
  _candA.copy(_dir).applyAxisAngle(_axis, ang);
  _candB.copy(_dir).applyAxisAngle(_axis, -ang);
  const kneeDir = _candA.dot(_pole) >= _candB.dot(_pole) ? _candA : _candB;
  setDirection(upper, upperDir, kneeDir);
  upper.updateWorldMatrix(true, true);
  _knee.setFromMatrixPosition(mid.matrixWorld);
  _to.copy(target).sub(_knee);
  setDirection(mid, lowerDir, _to);
  mid.updateWorldMatrix(true, true);
}

// Orient a foot flat on a surface. upWorld is the surface normal, fwdWorld the way the toes point.
function plantFoot(foot, upWorld, fwdWorld) {
  _up.copy(upWorld).normalize();
  _fwd.copy(fwdWorld).addScaledVector(_up, -fwdWorld.dot(_up));
  if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, 1);
  _fwd.normalize();
  _side.crossVectors(_up, _fwd).normalize();
  _fwd.crossVectors(_side, _up).normalize();
  _basis.makeBasis(_side, _up, _fwd);
  _q.setFromRotationMatrix(_basis);
  foot.parent.updateWorldMatrix(true, false);
  foot.parent.getWorldQuaternion(_q2);
  foot.quaternion.copy(_q2.invert()).multiply(_q);
}

function curlFingers(bones, amount) {
  for (const [name, bone] of Object.entries(bones)) {
    if (!name.startsWith("finger")) continue;
    const seg = name.includes("-3") ? 1 : name.includes("-2") ? 0.65 : 0.3;
    bone.rotation.x = amount * seg;
  }
}

// Smooth the raw inputs so the stance eases toward them instead of snapping.
function track(rig, extra) {
  const s = rig.state;
  const dt = extra.dt > 0 ? Math.min(extra.dt, 0.1) : 1 / 60;
  const snap = !!extra.snap || !s.init;
  const k = (rate) => (snap ? 1 : 1 - Math.exp(-dt * rate));
  const steerIn = clamp(extra.steer || 0, -1, 1) * 0.75 + clamp((extra.vs || 0) / 0.8, -1, 1) * 0.25;
  s.steer += (steerIn - s.steer) * k(8);
  s.thr += (clamp(extra.thr || 0, -1, 1) - s.thr) * k(10);
  s.tube += ((extra.inTube ? 1 : 0) - s.tube) * k(5);
  s.deep += ((extra.deep ? 1 : 0) - s.deep) * k(5);
  s.drag += ((extra.inTube && extra.wall ? 1 : 0) - s.drag) * k(4);
  s.init = true;
  return s;
}

function poseWipe(rig, weights, time, extra) {
  const bones = rig.bones;
  const s = Math.sin(time * 7.5);
  const c = Math.cos(time * 5.1);
  const thr = extra.thr || 0;
  const drop = mixW(weights, 0.42, 0.22, 0.12, 0.3) + Math.max(-thr, 0) * 0.05;
  bones.root.position.copy(rig.restRoot);
  bones.root.position.y -= drop;
  bones.root.rotation.set(0.8 * s, 0.6 * c, 1.1 * s);
  bones.spine03.rotation.set(0.5, 0.4 * s, 0.6 * c);
  findBone(bones, "upperarm01.L").rotation.set(-1.5, 0.4 * s, 1.3);
  findBone(bones, "upperarm01.R").rotation.set(-1.2, -0.4, -1.5);
  findBone(bones, "lowerarm01.L").rotation.set(0.7 * c, 0, 0.4);
  findBone(bones, "lowerarm01.R").rotation.set(0.5, 0, -0.5);
  findBone(bones, "upperleg01.L").rotation.set(-1.3, 0.2, 0.5 * s);
  findBone(bones, "upperleg01.R").rotation.set(-0.5, -0.4, -0.9);
  findBone(bones, "lowerleg01.L").rotation.set(1.15, 0, 0);
  findBone(bones, "lowerleg01.R").rotation.set(0.7 + 0.3 * s, 0, 0);
  bones.head.rotation.set(0.4 * s, 0.5 * c, 0.3 * s);
  curlFingers(bones, 0.8);
}

// World position of (x, y, z) given in holder space, using only the holder's rotation (offsets from a shoulder).
function holderOffset(anchor, off, out) {
  return out.set(off[0], off[1], off[2]).applyQuaternion(_qHolder).add(anchor);
}

const _shoulder = new THREE.Vector3();
const _armTarget = new THREE.Vector3();
const _armPole = new THREE.Vector3();
const _footA = new THREE.Vector3();
const _footB = new THREE.Vector3();
const _poleA = new THREE.Vector3();
const _poleB = new THREE.Vector3();
const _hipHolder = new THREE.Vector3();
const _rootWorld = new THREE.Vector3();
const _fwdHolder = new THREE.Vector3();
const _ankleWorld = new THREE.Vector3();
const _rollAxis = new THREE.Vector3();
const _normalA = new THREE.Vector3();
const _normalB = new THREE.Vector3();
const _upWorldA = new THREE.Vector3();
const _upWorldB = new THREE.Vector3();
const _fwdWorld = new THREE.Vector3();

function reachArm(chain, off, poleOff, hand) {
  chain.upper.updateWorldMatrix(true, false);
  _shoulder.setFromMatrixPosition(chain.upper.matrixWorld);
  if (hand) {
    _armTarget.copy(hand);
  } else {
    holderOffset(_shoulder, off, _armTarget);
  }
  const max = (chain.upperLen + chain.lowerLen) * 0.985;
  _to.copy(_armTarget).sub(_shoulder);
  if (_to.length() > max) _armTarget.copy(_shoulder).addScaledVector(_to.normalize(), max);
  holderOffset(_shoulder, poleOff, _armPole);
  solveTwoBone(chain, _armTarget, _armPole);
}

function poseStance(rig, surfer, weights, time, extra) {
  const { holder } = surfer;
  const bones = rig.bones;
  const st = track(rig, extra);
  const shape = surfer.shape;
  const stance = surfer.stance;
  const crouch = weights.crouch;
  const glide = weights.glide;
  const claim = weights.claim;
  const steer = st.steer;
  const thr = st.thr;
  const pump = Math.sin(time * 8.4) * Math.max(thr, 0);
  const sway = Math.sin(time * 1.9) * 0.018;

  surfer.body.rotation.set(0, 0, extra.tilt || 0);
  surfer.yaw.rotation.set(0, STANCE_YAW, 0);
  holder.updateMatrixWorld(true);
  holder.getWorldQuaternion(_qHolder);
  rig.armature.getWorldQuaternion(_qArm);
  _qRel.copy(_qHolder).invert().multiply(_qArm); // rig axes expressed in holder axes

  // chest direction in holder space, flattened onto the deck: the way the toes point
  _fwdHolder.set(0, 0, 1).applyQuaternion(_qRel);
  _fwdHolder.y = 0;
  _fwdHolder.normalize();

  // 1. Pose the torso (poseRig has already reset every bone to the rest pose).
  const drop =
    mixW(weights, 0.3, 0.2, 0.1, 0) + st.tube * 0.07 + st.deep * 0.04 + Math.max(-thr, 0) * 0.05 + Math.abs(steer) * 0.04 - pump * 0.03;
  const bend = (mixW(weights, 0.82, 0.4, 0.16, 0) + st.tube * 0.2 + st.deep * 0.1 + Math.max(thr, 0) * 0.08) * 0.8;
  const lean = steer * 0.3 + st.drag * 0.34 + st.tube * 0.05 + sway; // radians toward the wall (+) or down the face (-)

  _rollAxis.copy(HOLDER_Z).applyQuaternion(_qHolder).applyQuaternion(_q.copy(_qArm).invert());
  const set = (name, roll, pitch, twist = 0) => {
    const bone = bones[name];
    _q.setFromAxisAngle(_rollAxis, roll);
    _q2.setFromAxisAngle(X_AXIS, pitch);
    bone.quaternion.copy(_q).multiply(_q2);
    if (twist) bone.rotateY(twist);
  };
  // head heading: rotate the chest toward the direction of travel (holder -z)
  _to.set(0, 0, -1).applyQuaternion(_qHolder).applyQuaternion(_q.copy(_qArm).invert());
  const heading = Math.atan2(_to.x, _to.z);

  // The forward bend is taken at the hips (root) and the upper back; the lower spine (spine01, spine02) stays nearly straight, so the
  // waist does not fold and the side flesh does not bunch into a roll above the bikini (Ed, 2026-10-21).
  set("root", lean * 0.25, bend * 0.34);
  set("spine01", lean * 0.12, -bend * 0.04);
  set("spine02", lean * 0.1, -bend * 0.02);
  set("spine03", lean * 0.15, bend * 0.04, heading * 0.08);
  set("spine04", lean * 0.2, bend * 0.12, heading * 0.1);
  set("spine05", lean * 0.18, bend * 0.22, heading * 0.12);
  const hinge = bend * 0.74;
  set("neck01", 0, -hinge * 0.45, heading * 0.24);
  set("neck02", 0, -hinge * 0.12, heading * 0.2);
  set("head", 0, -hinge * 0.18 + 0.12, heading * 0.26 - steer * 0.1);
  // Shoulders sit where the bind pose put them (relaxed, a hair low). Milestone 1 lifted both clavicles by 0.35 rad (20
  // degrees) for every pose, which shrugged the shoulders up into the neck and made the deltoids look bulbous; they now
  // lift only as far as an arm raised overhead needs (claim).
  const clavLift = -0.05 + claim * 0.18;
  findBone(bones, "clavicle.L").rotation.z = clavLift;
  findBone(bones, "clavicle.R").rotation.z = -clavLift;

  // 2. Feet on the deck. Front foot is the character's right (rig -x), rear is the left.
  const spread = 0.03 * (crouch - glide);
  const zFront = stance.front - spread;
  const zRear = stance.rear + spread;
  const yFront = BOARD_LIFT + deckAt(shape, 0, zFront) + rig.ankleH.R;
  const yRear = BOARD_LIFT + deckAt(shape, 0, zRear) + rig.ankleH.L;
  _footA.set(-_fwdHolder.x * FOOT_CENTRE_FROM_ANKLE, yFront, zFront - _fwdHolder.z * FOOT_CENTRE_FROM_ANKLE); // right / front
  _footB.set(-_fwdHolder.x * FOOT_CENTRE_FROM_ANKLE, yRear, zRear - _fwdHolder.z * FOOT_CENTRE_FROM_ANKLE); // left / rear
  _poleA.copy(_footA).addScaledVector(_fwdHolder, 0.55);
  _poleA.y += 0.5;
  _poleB.copy(_footB).addScaledVector(_fwdHolder, 0.55);
  _poleB.y += 0.5;
  const footWorldA = holder.localToWorld(_footA.clone());
  const footWorldB = holder.localToWorld(_footB.clone());
  const poleWorldA = holder.localToWorld(_poleA.clone());
  const poleWorldB = holder.localToWorld(_poleB.clone());

  // 3. Pelvis: between the feet, shifted with the lean and the pump. Lower it until both legs can reach their feet.
  const shiftX = -lean * 0.2 - st.drag * 0.04;
  const shiftZ = pump * 0.025 + Math.max(-thr, 0) * 0.05 - Math.max(thr, 0) * 0.02;
  const hipY = (yFront + yRear) / 2 + rig.hipAboveAnkle;
  let extraDrop = 0;
  for (let iter = 0; iter < 5; iter++) {
    _hipHolder.set(shiftX, hipY - drop - extraDrop, (zFront + zRear) / 2 + shiftZ);
    _to.copy(rig.hipOffset).applyQuaternion(bones.root.quaternion).applyQuaternion(_qRel);
    _rootWorld.copy(_hipHolder).sub(_to);
    holder.localToWorld(_rootWorld);
    rig.armature.updateWorldMatrix(true, false);
    bones.root.position.copy(rig.armature.worldToLocal(_rootWorld));
    bones.root.updateWorldMatrix(false, true);
    solveTwoBone(rig.legR, footWorldA, poleWorldA);
    solveTwoBone(rig.legL, footWorldB, poleWorldB);
    let miss = 0;
    for (const [chain, target] of [[rig.legR, footWorldA], [rig.legL, footWorldB]]) {
      chain.end.getWorldPosition(_ankleWorld);
      miss = Math.max(miss, _ankleWorld.distanceTo(target));
    }
    if (miss < 0.002) break;
    extraDrop += miss * 1.2;
  }
  // soles flat on the deck
  deckNormal(shape, 0, zFront, _normalA);
  deckNormal(shape, 0, zRear, _normalB);
  _upWorldA.copy(_normalA).applyQuaternion(_qHolder);
  _upWorldB.copy(_normalB).applyQuaternion(_qHolder);
  _fwdWorld.copy(_fwdHolder).applyQuaternion(_qHolder);
  plantFoot(rig.legR.end, _upWorldA, _fwdWorld);
  plantFoot(rig.legL.end, _upWorldB, _fwdWorld);

  // 4. Arms. Front arm is the right, rear arm the left. Offsets are from the shoulder, in holder space (-x is toward the wall).
  const frontOff = [
    mixW(weights, -0.22, -0.14, -0.2, 0) - steer * 0.16 - st.tube * 0.08,
    mixW(weights, -0.3, -0.4, 0.5, 0) + pump * 0.04,
    mixW(weights, -0.32, -0.22, -0.14, 0) - thr * 0.05,
  ];
  const rearOff = [
    mixW(weights, 0.2, 0.14, 0.28, 0) + steer * 0.1,
    mixW(weights, -0.3, -0.4, 0.06, 0) - pump * 0.03,
    mixW(weights, 0.3, 0.2, 0.34, 0),
  ];
  let rearHand = null;
  if (st.drag > 0.02 && extra.wall) {
    // blend the free-hanging rear hand toward the wall point
    rig.armL.upper.updateWorldMatrix(true, false);
    _shoulder.setFromMatrixPosition(rig.armL.upper.matrixWorld);
    holderOffset(_shoulder, rearOff, _candA);
    const wallWorld = holder.localToWorld(_candB.set(extra.wall.x, extra.wall.y, extra.wall.z ?? 0.05));
    rearHand = _candA.lerp(wallWorld, st.drag).clone();
  }
  reachArm(rig.armR, frontOff, [0.35, -0.3, -0.05], null);
  reachArm(rig.armL, rearOff, [0.35, -0.3, 0.05], rearHand);
  curlFingers(bones, 0.35 + st.tube * 0.12);
}

function poseRig(rig, surfer, weights, time, extra) {
  for (const bone of Object.values(rig.bones)) bone.quaternion.identity();
  if ((weights.wipe || 0) > 0.5) {
    surfer.body.rotation.set(0, 0, extra.tilt || 0);
    surfer.yaw.rotation.set(0, STANCE_YAW, 0);
    track(rig, { ...extra, snap: true });
    poseWipe(rig, weights, time, extra);
    return;
  }
  poseStance(rig, surfer, weights, time, extra);
}

// Meshes each body's glb must contain, by name. A mesh the glb has and this list lacks (or the reverse) is an error:
// the generator and the game must agree on what exists. The male glb has board shorts only (men wear no tops and no suits,
// Ed 2026-10-21) and the female glb has no trunks.
export const FACE_MESHES = ["body", "eyes", "brows", "lashes", "teeth", "hair"];
export const GARMENTS = {
  male: ["trunks"],
  female: ["bikiniBottom", "bikiniTop", "rash", "fullsuit", "springsuit"],
};
// Cloth roughness (and metalness for the neoprene suits) per garment mesh.
const GARMENT_SURFACE = {
  trunks: [0.72],
  bikiniBottom: [0.48],
  bikiniTop: [0.48],
  rash: [0.55],
  fullsuit: [0.3, 0.08],
  springsuit: [0.3, 0.08],
};
// the print style of each garment mesh (what src/printart.js printSpec is asked for)
const GARMENT_STYLE = { trunks: "trunks", bikiniBottom: "bikini", bikiniTop: "bikini", rash: "rash", fullsuit: "fullsuit", springsuit: "springsuit" };

// Which skin detail map a tone uses: the dark-skinned maps for dark tones, the light-skinned maps for the rest.
export function skinFamily(color) {
  return new THREE.Color(color).getHSL({}).l < SKIN_DARK_LIGHTNESS ? "dark" : "light";
}
const SKIN_DARK_LIGHTNESS = 0.32; // deep (0.17) and brown (0.28) use the dark maps; bronze (0.35) and lighter use the light maps

function loadTexture(url, { srgb, wrap = THREE.ClampToEdgeWrapping }) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.flipY = false; // the glb uvs and these images follow the glTF convention
        tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.anisotropy = 8;
        tex.wrapS = tex.wrapT = wrap;
        resolve(tex);
      },
      undefined,
      () => reject(new Error(`could not decode a surfer texture (${url.slice(0, 40)}...)`)),
    );
  });
}

// Tileable pore / fine-grain height map for the skin bump (original, generated here, no image file). Round pits on a
// jittered grid over a little value noise, wrapped so it tiles.
function makePoreTexture(size = 256) {
  let seed = 90210;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const cell = 8;
  const n = size / cell;
  const pits = [];
  for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) pits.push([(cx + 0.2 + rand() * 0.6) * cell, (cy + 0.2 + rand() * 0.6) * cell, 0.9 + rand() * 1.3]);
  const grain = new Float32Array(size * size);
  for (let i = 0; i < grain.length; i++) grain[i] = rand();
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let h = 0.55 + 0.1 * (grain[y * size + x] - 0.5);
      const cx0 = Math.floor(x / cell);
      const cy0 = Math.floor(y / cell);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const p = pits[((cy0 + oy + n) % n) * n + ((cx0 + ox + n) % n)];
          // the pit is stored in its wrapped cell; shift it to where that cell sits next to this one
          const px = p[0] + (cx0 + ox - ((cx0 + ox + n) % n)) * cell;
          const py = p[1] + (cy0 + oy - ((cy0 + oy + n) % n)) * cell;
          const d = Math.hypot(x + 0.5 - px, y + 0.5 - py) / p[2];
          if (d < 1.6) h -= 0.38 * Math.exp(-d * d * 1.3);
        }
      }
      const v = Math.max(0, Math.min(1, h)) * 255;
      const k = (y * size + x) * 4;
      data[k] = data[k + 1] = data[k + 2] = v;
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// Hair colour is set in the generator (scripts/lib/haircolour.mjs: sun-bleached dark blond for the male, sun-streaked brown
// for the female), so the material tint only compensates the scene's cool, strong light and ACES tone mapping (calibrated by eye against renders).
const HAIR = {
  male: { color: [0.38, 0.28, 0.16], roughness: 0.5, clearcoat: 0.0 },
  female: { color: [0.38, 0.28, 0.16], roughness: 0.5, clearcoat: 0.0 },
};

/**
 * Build the surfers. options.textures = false skips decoding the images (they need a browser: Image and canvas) and
 * leaves every map empty; geometry, skeleton and posing are identical. scripts/check-pose.mjs uses it to run in Node.
 */
export async function createSurfer({ textures: loadTextures = true } = {}) {
  const [maleGltf, femaleGltf] = await Promise.all([loadGlb(maleB64), loadGlb(femaleB64)]);
  const male = prepareRig(maleGltf, "male");
  const female = prepareRig(femaleGltf, "female");

  const tex = {
    skin: {},
    hair: {},
    brows: {},
    lashes: {},
    eye: null,
  };
  const jobs = [];
  const want = (obj, key, url, opts) => {
    obj[key] = null;
    if (loadTextures) jobs.push(loadTexture(url, opts).then((t) => { obj[key] = t; }));
  };
  for (const kind of ["male", "female"]) {
    tex.skin[kind] = {};
    tex.hair[kind] = {};
    for (const family of ["light", "dark"]) want(tex.skin[kind], family, textures.skin[kind][family], { srgb: true });
    want(tex.hair[kind], "map", textures.hair[kind].map, { srgb: true });
    want(tex.hair[kind], "alpha", textures.hair[kind].alpha, { srgb: false });
    want(tex.brows, kind, textures.brows[kind], { srgb: false });
    want(tex.lashes, kind, textures.lashes[kind], { srgb: false });
  }
  want(tex, "eye", textures.eye, { srgb: true });
  await Promise.all(jobs);
  const pores = loadTextures ? makePoreTexture(256) : null;
  if (pores) pores.repeat.set(70, 70);

  // The skin map is a detail map: its mean is SKIN_LEVEL of full brightness and the colour carries the tone, so
  // every catalog tone keeps reading as its swatch (calibrated in scripts/skin-calibrate.mjs).
  const skin = new THREE.MeshPhysicalMaterial({
    color: 0x6e3a22,
    map: tex.skin.male.dark,
    roughness: 0.58,
    metalness: 0,
    clearcoat: 0.03,
    clearcoatRoughness: 0.5,
    sheen: 0.12,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color("#c4896a"),
    specularIntensity: 0.16,
    ior: 1.4,
    bumpMap: pores,
    bumpScale: 0.5,
    vertexColors: true, // COLOR_0 on the body glb is baked cavity shading (scripts/lib/skinbake.mjs): hollows are darker
  });
  skin.onBeforeCompile = (shader) => {
    // hollows are also rougher and ridges (brow, nose, cheekbone) glossier, so the specular is not uniform
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>
       #ifdef USE_COLOR
         roughnessFactor = clamp(roughnessFactor * (1.12 - 0.15 * vColor.r), 0.2, 1.0);
       #endif`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `float sssWrap = pow(1.0 - saturate(dot(normal, geometryViewDir)), 2.0);
       outgoingLight += diffuseColor.rgb * vec3(1.0, 0.42, 0.3) * sssWrap * 0.07;
       #include <opaque_fragment>`,
    );
  };
  // The whites are a warm off-white and the reflections are kept low: with a full-strength clearcoat and specular the
  // blue sky turned the sclera blue-grey, which read as pale, glassy, unhealthy eyes in close-ups.
  const eyes = new THREE.MeshPhysicalMaterial({
    color: 0xffe6d6,
    map: tex.eye,
    roughness: 0.38,
    clearcoat: 0.12,
    clearcoatRoughness: 0.2,
    specularIntensity: 0.16,
    metalness: 0,
  });
  // Brows and lashes are black strokes on alpha. Lambert (no mirror reflection) so the sky does not turn them blue; a
  // little brown emissive lifts the strokes from pure black to dark brown hair.
  const cutout = (alphaMap, emissive) =>
    new THREE.MeshLambertMaterial({
      alphaMap,
      color: 0x000000,
      emissive: new THREE.Color(...emissive),
      alphaTest: 0.35,
      alphaToCoverage: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
  const brows = { male: cutout(tex.brows.male, [0.045, 0.03, 0.025]), female: cutout(tex.brows.female, [0.06, 0.04, 0.03]) };
  const lashes = { male: cutout(tex.lashes.male, [0.02, 0.015, 0.012]), female: cutout(tex.lashes.female, [0.02, 0.015, 0.012]) };
  const teeth = new THREE.MeshStandardMaterial({ color: 0xe7e0d6, roughness: 0.45 });
  const hair = {};
  for (const kind of ["male", "female"]) {
    const h = HAIR[kind];
    hair[kind] = new THREE.MeshPhysicalMaterial({
      map: tex.hair[kind].map,
      alphaMap: tex.hair[kind].alpha,
      alphaTest: 0.45,
      alphaToCoverage: true,
      side: THREE.DoubleSide,
      color: new THREE.Color(...h.color),
      roughness: h.roughness,
      clearcoat: h.clearcoat,
      clearcoatRoughness: 0.35,
      specularIntensity: 0.25,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }
  const boardMat = createBoardMaterial();
  if (loadTextures) boardMat.map = zeroTexture(); // the map is always set, so the print shader is always compiled in
  const stringerMat = new THREE.MeshPhysicalMaterial({
    color: 0xd9b27a,
    roughness: 0.5,
    specularIntensity: 0.4,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const padMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, specularIntensity: 0.2 });
  const plugMat = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, metalness: 0.8, roughness: 0.35 });
  const finMat = new THREE.MeshPhysicalMaterial({ color: 0x2a3036, roughness: 0.4, specularIntensity: 0.5 });

  for (const rig of [male, female]) {
    const kind = rig.kind;
    const assign = {
      body: skin,
      eyes,
      brows: brows[kind],
      lashes: lashes[kind],
      teeth,
      hair: hair[kind],
    };
    const expected = [...FACE_MESHES, ...GARMENTS[kind]];
    const found = Object.keys(rig.meshes);
    const unknown = found.filter((name) => !expected.includes(name));
    const missing = expected.filter((name) => !rig.meshes[name]);
    if (unknown.length || missing.length) {
      throw new Error(`${kind} rig meshes do not match what the game expects: unknown [${unknown.join(", ")}], missing [${missing.join(", ")}]`);
    }
    // The joints that axe each part of a garment's print projection, in the rig frame (src/printuv.js).
    const joints = {
      armL: [rig.armL.upperRest.toArray(), rig.armL.midRest.toArray(), rig.armL.endRest.toArray()],
      armR: [rig.armR.upperRest.toArray(), rig.armR.midRest.toArray(), rig.armR.endRest.toArray()],
      legL: [rig.legL.upperRest.toArray(), rig.legL.midRest.toArray(), rig.legL.endRest.toArray()],
      legR: [rig.legR.upperRest.toArray(), rig.legR.midRest.toArray(), rig.legR.endRest.toArray()],
    };
    for (const [name, mesh] of Object.entries(rig.meshes)) {
      if (mesh.material && mesh.material !== assign[name]) mesh.material.dispose();
      if (GARMENTS[kind].includes(name)) {
        // Each garment has its own print UVs (replacing the body atlas UVs it was cut with) and its own material, since
        // each carries its own two colours.
        const cut = mesh.geometry;
        // the bikini bottom is too small to be cut in pieces: the print runs unbroken over it (src/printuv.js pelvisOnly)
        mesh.geometry = buildGarmentPrintGeometry(cut, mesh.skeleton.bones.map((bone) => bone.name), joints, { pelvisOnly: name === "bikiniBottom" });
        cut.dispose();
        mesh.material = createGarmentMaterial(...GARMENT_SURFACE[name]);
        if (loadTextures) mesh.material.map = zeroTexture();
      } else {
        mesh.material = assign[name];
      }
    }
  }
  female.root.visible = false;

  const yaw = new THREE.Group();
  yaw.rotation.y = STANCE_YAW;
  yaw.add(male.root, female.root);

  const board = new THREE.Group();
  board.position.y = BOARD_LIFT;
  const hullMesh = new THREE.Mesh(new THREE.BufferGeometry(), boardMat);
  const stringerMesh = new THREE.Mesh(new THREE.BufferGeometry(), stringerMat);
  const padMesh = new THREE.Mesh(new THREE.BufferGeometry(), padMat);
  const plugMesh = new THREE.Mesh(new THREE.BufferGeometry(), plugMat);
  const finGroup = new THREE.Group();
  board.add(hullMesh, stringerMesh, padMesh, plugMesh, finGroup);

  const body = new THREE.Group();
  body.add(yaw);
  const holder = new THREE.Group();
  holder.add(board, body);

  let builtShape = null;
  // The board's print: its two colours (plain, the old vertex colours had no gain) and the mask of this pattern on this shape.
  function dressBoard(pattern, c1, c2) {
    const uniforms = boardMat.userData.print;
    uniforms.uPrintA.value.set(c1);
    uniforms.uPrintB.value.set(c2);
    hullMesh.userData.print = { pattern, shape: builtShape, c1, c2 };
    if (loadTextures) boardMat.map = pattern === "solid" ? zeroTexture() : boardTexture(pattern, builtShape, hullMesh.geometry.userData.print);
  }
  function setBoardShape(shape) {
    if (shape === builtShape) return;
    const parts = createBoardParts(shape);
    for (const [mesh, geometry] of [[hullMesh, parts.hull], [stringerMesh, parts.stringer], [padMesh, parts.pad], [plugMesh, parts.plug]]) {
      mesh.geometry.dispose();
      mesh.geometry = geometry;
    }
    for (const fin of [...finGroup.children]) {
      fin.geometry.dispose();
      finGroup.remove(fin);
    }
    for (const spec of parts.fins) {
      const fin = new THREE.Mesh(spec.geometry, finMat);
      fin.position.copy(spec.position);
      fin.rotation.copy(spec.rotation);
      finGroup.add(fin);
    }
    builtShape = shape;
    surfer.shape = shape;
    surfer.stance = parts.stance;
  }

  const surfer = {
    holder,
    board,
    body,
    yaw,
    male,
    female,
    active: male,
    shape: "short",
    stance: null,
    // The cloth materials belong to the garment meshes (one each); these are the active body's.
    materials: {
      skin,
      boardMat,
      hair,
      eyes,
      get trunks() { return surfer.active.meshes.trunks?.material; },
      get bikini() { return surfer.active.meshes.bikiniBottom?.material; },
      get rash() { return surfer.active.meshes.rash.material; },
      get suit() { return (surfer.active.meshes.fullsuit || surfer.active.meshes.springsuit).material; },
    },
    textures: tex,
    tune: TUNE,
    /** The Locker's neutral studio light is on (src/locker.js): skin and cloth use the studio gains. Call apply() after changing it. */
    get studio() {
      return TUNE.studio;
    },
    set studio(on) {
      TUNE.studio = !!on;
    },
    /** Test hook (scripts/cloth-calibrate.mjs): paint one garment mesh of the active body in a single colour. */
    paintSolid(meshName, hex) {
      const mesh = surfer.active.meshes[meshName];
      if (!mesh) throw new Error(`no mesh ${meshName}`);
      dressGarment(mesh, mesh.userData.print?.style || "rash", "solid", hex, hex, loadTextures);
    },
    /**
     * Dress the surfer. The body is the loadout's body; every outfit item must be made for that body (item.body),
     * otherwise this throws: a bikini is never shown on the male, trunks never on the female.
     */
    apply(loadout, byId) {
      if (loadout.body !== "male" && loadout.body !== "female") throw new Error(`loadout.body must be "male" or "female", got ${loadout.body}`);
      const bottom = byId[loadout.bottom];
      if (!bottom) throw new Error(`loadout.bottom "${loadout.bottom}" is not in the catalog`);
      if (loadout.top) throw new Error(`loadout.top "${loadout.top}": there are no separate tops; an outfit is one matching set (loadout.bottom)`);
      if (bottom.body !== loadout.body) {
        throw new Error(`bottom "${bottom.id}" is made for the ${bottom.body} body, not the ${loadout.body} body`);
      }
      const rig = loadout.body === "female" ? female : male;
      male.root.visible = rig === male;
      female.root.visible = rig === female;
      surfer.active = rig;
      skin.color.set(loadout.skin || "#6e3a22");
      skin.sheenColor.copy(skin.color).offsetHSL(0.01, 0.05, 0.06);
      skin.map = tex.skin[rig.kind][skinFamily(skin.color)];
      skin.color.multiply(surfer.tune.skin || skinComp(skin.color, _comp, TUNE.studio ? STUDIO_SKIN_COMP : SKIN_COMP));
      boardMat.color.copy(surfer.tune.board);
      skin.emissive.copy(skin.color).multiplyScalar(0.012);

      // One outfit, one pattern, one colour pair: every piece it shows is dressed the same.
      const showing = {
        trunks: bottom.style === "trunks",
        bikiniBottom: bottom.style === "bikini" || bottom.style === "rashset",
        bikiniTop: bottom.style === "bikini",
        rash: bottom.style === "rashset",
        fullsuit: bottom.style === "fullsuit",
        springsuit: bottom.style === "springsuit",
      };
      if (bottom.style === "trunks" && rig.kind !== "male") throw new Error("trunks need the male body");
      if (bottom.style !== "trunks" && rig.kind !== "female") throw new Error(`a ${bottom.style} outfit needs the female body (men wear board shorts only)`);
      for (const r of [male, female]) {
        for (const name of FACE_MESHES) showMesh(r.meshes[name], true);
        for (const name of GARMENTS[r.kind]) showMesh(r.meshes[name], r === rig && !!showing[name]);
      }
      const c1 = bottom.color;
      const c2 = bottom.color2 || c1;
      const pat = bottom.pattern || "solid";
      for (const name of GARMENTS[rig.kind]) {
        if (showing[name]) dressGarment(rig.meshes[name], GARMENT_STYLE[name], pat, c1, c2, loadTextures);
        // an item can ask for a glossier cloth (the gold set): the sheen shows its colour apart from skin
        if (showing[name]) rig.meshes[name].material.roughness = bottom.gloss ?? GARMENT_SURFACE[name][0];
      }

      const boardItem = byId[loadout.board];
      setBoardShape(boardItem?.shape || "short");
      dressBoard(boardItem?.pattern || "solid", boardItem?.color || "#3aa8ea", boardItem?.color2 || "#e8f7ff");
      if (loadTextures) {
        const onShow = new Set([boardMat.map]);
        for (const r of [male, female]) for (const name of GARMENTS[r.kind]) onShow.add(r.meshes[name].material.map);
        trimPrints(onShow);
      }
    },
  };
  setBoardShape("short");
  dressBoard("solid", "#3aa8ea", "#e8f7ff");
  return surfer;
}

/**
 * Pose the active rig for one tick.
 * weights: {crouch, glide, claim, wipe} blend of the base stances.
 * extra:   {steer, thr, inTube, deep, dt, vs, tilt, snap, wall:{x,y,z}} - inputs and wave state.
 *          wall is a point on the wave wall in holder space for the rear hand to drag along in the tube.
 */
export function applyPose(surfer, weights, time, extra = {}) {
  const rig = surfer.active;
  if (!rig) return;
  const safe = {
    crouch: weights.crouch || 0,
    glide: weights.glide || 0,
    claim: weights.claim || 0,
    wipe: weights.wipe || 0,
  };
  const sum = safe.crouch + safe.glide + safe.claim + safe.wipe;
  if (sum < 1e-4) safe.crouch = 1;
  poseRig(rig, surfer, safe, time, extra);
}
