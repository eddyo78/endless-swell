import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { femaleB64, maleB64 } from "./assets/surfers.data.js";

const DECK = 0.05;

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
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
const _target = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _shoulder = new THREE.Vector3();
const _basis = new THREE.Matrix4();

export function patternAmount(pattern, u, v) {
  if (pattern === "stripes") return Math.abs(Math.sin(u * 18)) > 0.72 ? 1 : 0;
  if (pattern === "chevron") return Math.abs(((u * 7 + v) % 1) - 0.5) < 0.12 ? 1 : 0;
  if (pattern === "sunburst") return Math.abs(Math.sin(Math.atan2(v - 0.5, u - 0.55) * 7)) > 0.55 ? 0.85 : 0.05;
  if (pattern === "palm") {
    const blob = Math.sin(u * 13.1 + v * 4) * Math.sin(v * 9.3);
    return blob > 0.35 ? 1 : 0;
  }
  if (pattern === "tiger") return Math.sin(u * 22 + Math.sin(v * 8) * 3) > 0.45 ? 1 : 0;
  if (pattern === "panels") return u > 0.45 && u < 0.55 ? 1 : Math.abs(v) > 0.65 ? 0.7 : 0;
  return 0;
}

function paintGeometry(geo, pattern, c1, c2) {
  const pos = geo.attributes.position;
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  const A = new THREE.Color(c1);
  const B = new THREE.Color(c2);
  const colors = new Float32Array(pos.count * 3);
  const dy = box.max.y - box.min.y || 1;
  const dz = box.max.z - box.min.z || 1;
  const dx = box.max.x - box.min.x || 1;
  for (let i = 0; i < pos.count; i++) {
    const u = (pos.getY(i) - box.min.y) / dy;
    const v = (pos.getX(i) - box.min.x) / dx;
    const w = (pos.getZ(i) - box.min.z) / dz;
    const f = patternAmount(pattern, w * 0.65 + u * 0.35, v);
    const r = A.r + (B.r - A.r) * f;
    const g = A.g + (B.g - A.g) * f;
    const b = A.b + (B.b - A.b) * f;
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

function boardGeometry(shape) {
  const length = shape === "fish" ? 1.52 : shape === "gun" ? 2.2 : 1.76;
  const widthMul = shape === "fish" ? 1.32 : shape === "gun" ? 0.74 : 1;
  const positions = [];
  const indices = [];
  const half = (e) => {
    let w = 0.27 * Math.sin(Math.PI * e ** 0.85) ** 0.5;
    const nose = 0.1 * (1 - Math.min(1, e / 0.06));
    w = Math.max(w, e < 0.06 ? nose + w * 0.5 : w);
    return w * widthMul;
  };
  const rings = 40;
  const segs = 16;
  for (let i = 0; i <= rings; i++) {
    const e = i / rings;
    const z = (0.5 - e) * length;
    let width = half(e) + 0.004;
    const rocker = 0.031 * Math.sin(Math.PI * Math.min(1, e * 0.9 + 0.08)) ** 0.5 + 0.004;
    const vee = 0.11 * (Math.max(0, e - 0.65) / 0.35) ** 2.2 + 0.05 * (Math.max(0, 0.25 - e) / 0.25) ** 2;
    if (shape === "fish" && e > 0.84) {
      const notch = (e - 0.84) / 0.16;
      width *= 1 - notch * 0.15;
    }
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      let x = width * Math.sign(cx) * Math.abs(cx) ** 0.55;
      let y = rocker * (cy > 0 ? cy ** 0.8 : -(Math.abs(cy) ** 0.9) * 0.7) + vee;
      if (shape === "fish" && e > 0.9 && Math.abs(cx) < 0.35) {
        const notch = (e - 0.9) / 0.1 * (1 - Math.abs(cx) / 0.35);
        y -= notch * 0.02;
        zAdjust(positions, i, notch);
      }
      positions.push(x, y, z);
    }
  }
  function zAdjust() {}
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j;
      const b = i * segs + ((j + 1) % segs);
      indices.push(a, b, a + segs, b, b + segs, a + segs);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function paintBoard(geo, pattern, c1, c2) {
  const pos = geo.attributes.position;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    z0 = Math.min(z0, pos.getZ(i));
    z1 = Math.max(z1, pos.getZ(i));
  }
  const A = new THREE.Color(c1);
  const B = new THREE.Color(c2);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const u = (pos.getZ(i) - z0) / (z1 - z0 || 1);
    const v = pos.getX(i);
    const f = patternAmount(pattern, u, v * 2);
    colors[i * 3] = A.r + (B.r - A.r) * f;
    colors[i * 3 + 1] = A.g + (B.g - A.g) * f;
    colors[i * 3 + 2] = A.b + (B.b - A.b) * f;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
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
  return bones[name] || bones[name.replaceAll(".", "")];
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
    endRest: c.clone(),
  };
}

function prepareRig(gltf, kind) {
  const root = gltf.scene;
  root.name = kind;
  root.updateMatrixWorld(true);
  let skeleton = null;
  const meshes = {};
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    meshes[obj.name] = obj;
    obj.frustumCulled = false;
    obj.castShadow = false;
    obj.receiveShadow = false;
    if (obj.isSkinnedMesh && !skeleton) skeleton = obj.skeleton;
  });
  const bones = {};
  for (const bone of skeleton.bones) bones[bone.name] = bone;
  const body = meshes.body;
  body.geometry.computeBoundingBox();
  const minY = body.geometry.boundingBox.min.y;
  root.position.y = -minY + DECK;
  return {
    kind,
    root,
    bones,
    meshes,
    minY,
    restRoot: bones.root.position.clone(),
    legL: chainOf(bones, "upperleg01.L", "lowerleg01.L", "foot.L"),
    legR: chainOf(bones, "upperleg01.R", "lowerleg01.R", "foot.R"),
    armL: chainOf(bones, "upperarm01.L", "lowerarm01.L", "wrist.L"),
    armR: chainOf(bones, "upperarm01.R", "lowerarm01.R", "wrist.R"),
  };
}

function clothMaterial(roughness, metalness = 0.02) {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness,
    metalness,
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

function paintMesh(mesh, pattern, c1, c2) {
  if (!mesh) return;
  paintGeometry(mesh.geometry, pattern, c1, c2);
}

function showMesh(mesh, visible) {
  if (mesh) mesh.visible = visible;
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

function plantFoot(foot, holder, armature) {
  holder.getWorldQuaternion(_q);
  _up.set(0, 1, 0).applyQuaternion(_q);
  armature.getWorldQuaternion(_q2);
  _fwd.set(0, 0, 1).applyQuaternion(_q2);
  _fwd.addScaledVector(_up, -_fwd.dot(_up));
  if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, 1).applyQuaternion(_q2);
  _fwd.normalize();
  _side.crossVectors(_up, _fwd).normalize();
  _fwd.crossVectors(_side, _up).normalize();
  _basis.makeBasis(_side, _up, _fwd);
  _q.setFromRotationMatrix(_basis);
  foot.parent.updateWorldMatrix(true, false);
  foot.parent.getWorldQuaternion(_q2);
  foot.quaternion.copy(_q2.invert()).multiply(_q);
}

function pointFromShoulder(chain, armature, x, y, z) {
  chain.upper.updateWorldMatrix(true, false);
  _shoulder.setFromMatrixPosition(chain.upper.matrixWorld);
  armature.getWorldQuaternion(_q);
  _offset.set(x, y, z).applyQuaternion(_q);
  return _target.copy(_shoulder).add(_offset);
}

function curlFingers(bones, amount) {
  for (const [name, bone] of Object.entries(bones)) {
    if (!name.startsWith("finger")) continue;
    const seg = name.includes("-3") ? 1 : name.includes("-2") ? 0.65 : 0.3;
    bone.rotation.x = amount * seg;
  }
}

function poseRig(rig, holder, weights, time, extra) {
  const bones = rig.bones;
  const steer = extra.steer || 0;
  const thr = extra.thr || 0;
  const tube = extra.inTube ? 1 : 0;
  const deep = extra.deep ? 1 : 0;
  const wipe = weights.wipe || 0;
  for (const bone of rig.bones.root.skeleton?.bones || Object.values(bones)) bone.quaternion.identity();
  const drop = mixW(weights, 0.42, 0.22, 0.12, 0.3) + tube * 0.06 + deep * 0.05 + Math.max(-thr, 0) * 0.05;
  const pump = Math.sin(time * 8.4) * Math.max(thr, 0);
  bones.root.position.copy(rig.restRoot);
  bones.root.position.y -= drop - pump * 0.035;
  const bend = mixW(weights, 0.82, 0.4, 0.16, 0.35) + tube * 0.12 + deep * 0.08;
  const lean = steer * 0.28;
  bones.root.rotation.set(bend * 0.12, -steer * 0.08, lean * 0.45);
  bones.spine05.rotation.set(bend * 0.42, 0, lean * 0.35);
  bones.spine04.rotation.set(bend * 0.22, 0, lean * 0.2);
  bones.spine03.rotation.set(bend * 0.06, steer * -0.06, lean * 0.12);
  bones.spine02.rotation.set(-bend * 0.08, 0, 0);
  bones.spine01.rotation.set(-bend * 0.22, steer * -0.1, lean * 0.08);
  const hinge = bend * 0.74;
  bones.neck01.rotation.set(-hinge * 0.45, steer * 0.08, 0);
  bones.neck02.rotation.set(-hinge * 0.12, 0, 0);
  bones.head.rotation.set(-hinge * 0.18 + 0.22, steer * 0.12, 0);
  const clavL = findBone(bones, "clavicle.L");
  const clavR = findBone(bones, "clavicle.R");
  if (clavL) clavL.rotation.z = 0.45;
  if (clavR) clavR.rotation.z = -0.3;

  if (wipe > 0.5) {
    const s = Math.sin(time * 7.5);
    const c = Math.cos(time * 5.1);
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
    return;
  }

  holder.updateMatrixWorld(true);
  const front = mixW(weights, 0.34, 0.2, 0.12, 0);
  const back = mixW(weights, 0.38, 0.22, 0.14, 0);
  const liftL = DECK + (rig.legL.endRest.y - rig.minY);
  const liftR = DECK + (rig.legR.endRest.y - rig.minY);
  const footL = _candA.set(-0.12, liftL, -0.04 - front);
  const footR = _candB.set(0.15, liftR, 0.08 + back);
  const worldL = holder.localToWorld(footL.clone());
  const worldR = holder.localToWorld(footR.clone());
  rig.root.getWorldQuaternion(_q);
  const poleL = holder.localToWorld(new THREE.Vector3(-0.28, liftL + 0.45, -0.55));
  const poleR = holder.localToWorld(new THREE.Vector3(0.28, liftR + 0.45, -0.55));
  solveTwoBone(rig.legL, worldL, poleL);
  solveTwoBone(rig.legR, worldR, poleR);
  plantFoot(rig.legL.end, holder, rig.root);
  plantFoot(rig.legR.end, holder, rig.root);

  const tuck = tube * 0.08 + deep * 0.06;
  const wall = Math.max(0, -steer) * 0.1;
  const claim = weights.claim || 0;
  const left = pointFromShoulder(
    rig.armL,
    rig.root,
    0.1 + wall * (1 - claim),
    mixW(weights, -0.46, -0.28, -0.16, 0) - tuck + pump * 0.04,
    mixW(weights, -0.16, -0.22, -0.08, 0),
  ).clone();
  const right = pointFromShoulder(
    rig.armR,
    rig.root,
    mixW(weights, -0.06, -0.04, 0.02, 0),
    mixW(weights, -0.34, -0.2, 0.5, 0) + pump * 0.03,
    mixW(weights, 0.08, 0.04, -0.08, 0),
  ).clone();
  const elbowL = pointFromShoulder(rig.armL, rig.root, 0.42, -0.18, -0.4).clone();
  const elbowR = pointFromShoulder(rig.armR, rig.root, -0.38, claim > 0.4 ? 0.15 : -0.16, -0.36).clone();
  solveTwoBone(rig.armL, left, elbowL);
  solveTwoBone(rig.armR, right, elbowR);
  curlFingers(bones, 0.35 + tube * 0.12);
}

export async function createSurfer() {
  const [maleGltf, femaleGltf] = await Promise.all([loadGlb(maleB64), loadGlb(femaleB64)]);
  const male = prepareRig(maleGltf, "male");
  const female = prepareRig(femaleGltf, "female");

  const skin = new THREE.MeshPhysicalMaterial({
    color: 0x6e3a22,
    roughness: 0.42,
    metalness: 0,
    clearcoat: 0.16,
    clearcoatRoughness: 0.42,
    sheen: 0.35,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color("#c4896a"),
    specularIntensity: 0.55,
    ior: 1.4,
    envMapIntensity: 0.9,
  });
  skin.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `float sssWrap = pow(1.0 - saturate(dot(normal, geometryViewDir)), 2.0);
       outgoingLight += diffuseColor.rgb * vec3(1.0, 0.42, 0.3) * sssWrap * 0.07;
       #include <opaque_fragment>`,
    );
  };
  const eyes = new THREE.MeshPhysicalMaterial({ color: 0x1a120e, roughness: 0.18, clearcoat: 0.7, clearcoatRoughness: 0.15, metalness: 0 });
  const lashes = new THREE.MeshStandardMaterial({ color: 0x100c0a, roughness: 0.7, side: THREE.DoubleSide });
  const teeth = new THREE.MeshStandardMaterial({ color: 0xe7e0d6, roughness: 0.45 });
  const hair = new THREE.MeshStandardMaterial({
    color: 0x140e0c,
    roughness: 0.62,
    metalness: 0.02,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const trunks = clothMaterial(0.72);
  const bikini = clothMaterial(0.48);
  const rash = clothMaterial(0.55);
  const suit = clothMaterial(0.3, 0.08);
  const boardMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.38,
    clearcoat: 0.6,
    clearcoatRoughness: 0.3,
    vertexColors: true,
  });

  const assign = {
    body: skin,
    eyes,
    lashes,
    teeth,
    hair,
    ponytail: hair,
    trunks,
    bikiniBottom: bikini,
    bikiniTop: bikini,
    rash,
    onesie: suit,
  };
  for (const rig of [male, female]) {
    for (const [name, mesh] of Object.entries(rig.meshes)) {
      const mat = assign[name];
      if (!mat) continue;
      if (mesh.material && mesh.material !== mat) mesh.material.dispose();
      mesh.material = mat;
    }
  }
  female.root.visible = false;

  const yaw = new THREE.Group();
  yaw.rotation.y = Math.PI - 0.42;
  yaw.add(male.root, female.root);

  const board = new THREE.Group();
  let boardMesh = new THREE.Mesh(boardGeometry("short"), boardMat);
  paintBoard(boardMesh.geometry, "solid", "#3aa8ea", "#e8f7ff");
  board.add(boardMesh);
  const finMat = new THREE.MeshStandardMaterial({ color: 0xd8eef8, roughness: 0.4 });
  for (const [x, z] of [[0, 0.82], [0.17, 0.72], [-0.17, 0.72]]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.11, 0.1), finMat);
    fin.position.set(x * 0.9, -0.06, z - 0.06);
    boardMesh.add(fin);
  }

  const body = new THREE.Group();
  body.add(yaw);
  const holder = new THREE.Group();
  holder.add(board, body);

  const surfer = {
    holder,
    board,
    body,
    yaw,
    male,
    female,
    active: male,
    materials: { skin, trunks, bikini, rash, suit, boardMat },
    apply(loadout, byId) {
      const femaleOn = loadout.body === "female";
      male.root.visible = !femaleOn;
      female.root.visible = femaleOn;
      surfer.active = femaleOn ? female : male;
      skin.color.set(loadout.skin || "#6e3a22");
      skin.sheenColor.copy(skin.color).offsetHSL(0.01, 0.05, 0.12);
      skin.emissive.copy(skin.color).multiplyScalar(0.012);

      const bottom = byId[loadout.bottom];
      const top = loadout.top ? byId[loadout.top] : null;
      const style = bottom?.style || "trunks";
      const onesie = style === "onesie";
      const bikiniOn = style === "bikini" && !onesie;
      const trunksOn = style === "trunks" && !onesie;
      const rashOn = !onesie && top && top.style === "rash";
      for (const rig of [male, female]) {
        const m = rig.meshes;
        showMesh(m.body, true);
        showMesh(m.eyes, true);
        showMesh(m.lashes, true);
        showMesh(m.teeth, true);
        showMesh(m.hair, true);
        showMesh(m.ponytail, rig.kind === "female");
        showMesh(m.trunks, trunksOn);
        showMesh(m.bikiniBottom, bikiniOn);
        showMesh(m.bikiniTop, bikiniOn && !rashOn);
        showMesh(m.rash, rashOn);
        showMesh(m.onesie, onesie);
        const c1 = bottom?.color || "#c41622";
        const c2 = bottom?.color2 || c1;
        const pat = bottom?.pattern || "solid";
        if (trunksOn) paintMesh(m.trunks, pat, c1, c2);
        if (bikiniOn) {
          paintMesh(m.bikiniBottom, pat, c1, c2);
          paintMesh(m.bikiniTop, pat, c1, c2);
        }
        if (onesie) paintMesh(m.onesie, pat, c1, c2);
        if (rashOn) paintMesh(m.rash, top.pattern || "solid", top.color, top.color2 || top.color);
      }

      const boardItem = byId[loadout.board];
      if (boardItem) {
        boardMesh.geometry.dispose();
        boardMesh.geometry = boardGeometry(boardItem.shape || "short");
        paintBoard(boardMesh.geometry, boardItem.pattern || "solid", boardItem.color, boardItem.color2 || "#ffffff");
        const fins = boardMesh.children;
        const long = boardItem.shape === "gun" ? 1.2 : boardItem.shape === "fish" ? 0.82 : 1;
        fins.forEach((f, i) => {
          f.position.z = (i === 0 ? 0.78 : 0.66) * long - 0.06;
          f.visible = !(boardItem.shape === "fish" && i > 0);
        });
      }
    },
  };
  return surfer;
}

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
  poseRig(rig, surfer.holder, safe, time, extra);
}
