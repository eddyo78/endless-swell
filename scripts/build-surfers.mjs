// Builds athletic male and female surfers from the MakeHuman CC0 base mesh,
// default skeleton, and macro targets. Output is embedded for the single-file build.
// Source and license: see ASSETS.md.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = "https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data";
const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, "../src/assets/surfers.data.js");

const KEEP_GROUPS = new Set([
  "body",
  "helper-l-eye",
  "helper-r-eye",
  "helper-upper-teeth",
  "helper-lower-teeth",
  "helper-l-eyelashes-1",
  "helper-l-eyelashes-2",
  "helper-r-eyelashes-1",
  "helper-r-eyelashes-2",
]);

async function text(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function parseObj(src) {
  const verts = [];
  const faces = [];
  let group = "";
  for (const line of src.split("\n")) {
    if (line.startsWith("v ")) {
      const p = line.trim().split(/\s+/);
      verts.push(+p[1], +p[2], +p[3]);
      continue;
    }
    if (line.startsWith("g ") || line.startsWith("o ")) {
      group = line.slice(2).trim();
      continue;
    }
    if (line.startsWith("f ") && KEEP_GROUPS.has(group)) {
      const idx = line.trim().split(/\s+/).slice(1).map((tok) => parseInt(tok, 10) - 1);
      for (let i = 1; i < idx.length - 1; i++) faces.push(group, idx[0], idx[i], idx[i + 1]);
    }
  }
  return { verts: Float64Array.from(verts), faces };
}

function parseTarget(src) {
  const out = [];
  for (const line of src.split("\n")) {
    if (!line || line[0] === "#") continue;
    const p = line.trim().split(/\s+/);
    if (p.length < 4) continue;
    out.push([+p[0], +p[1], +p[2], +p[3]]);
  }
  return out;
}

function applyTarget(verts, target, weight) {
  if (weight < 1e-4) return;
  for (const [i, x, y, z] of target) {
    const o = i * 3;
    verts[o] += x * weight;
    verts[o + 1] += y * weight;
    verts[o + 2] += z * weight;
  }
}

function muscleWeight(level) {
  const maxmuscle = Math.max(0, level * 2 - 1);
  const minmuscle = Math.max(0, 1 - level * 2);
  return { maxmuscle, minmuscle, averagemuscle: 1 - (maxmuscle + minmuscle) };
}

function fatWeight(level) {
  const maxweight = Math.max(0, level * 2 - 1);
  const minweight = Math.max(0, 1 - level * 2);
  return { maxweight, minweight, averageweight: 1 - (maxweight + minweight) };
}

async function loadMacro(gender, muscle, weight, race) {
  const mw = muscleWeight(muscle);
  const fw = fatWeight(weight);
  const jobs = [];
  for (const muscleName of ["maxmuscle", "averagemuscle", "minmuscle"]) {
    for (const weightName of ["minweight", "averageweight", "maxweight"]) {
      const w = mw[muscleName] * fw[weightName];
      if (w < 1e-4) continue;
      const file = `universal-${gender}-young-${muscleName}-${weightName}.target`;
      jobs.push([`${ROOT}/targets/macrodetails/${file}`, w]);
    }
  }
  for (const [raceName, rw] of Object.entries(race)) {
    if (rw < 1e-4) continue;
    const file = `${raceName}-${gender}-young.target`;
    jobs.push([`${ROOT}/targets/macrodetails/${file}`, rw]);
  }
  const targets = await Promise.all(jobs.map(async ([url, w]) => [await text(url).then(parseTarget), w]));
  return targets;
}

function influencesFrom(weightJson, vertCount) {
  const data = JSON.parse(weightJson);
  const lists = Array.from({ length: vertCount }, () => []);
  for (const [bone, pairs] of Object.entries(data.weights)) {
    for (const [idx, w] of pairs) lists[idx].push([bone, w]);
  }
  for (const list of lists) {
    list.sort((a, b) => b[1] - a[1]);
    if (list.length > 4) list.length = 4;
    let sum = 0;
    for (const item of list) sum += item[1];
    if (sum <= 1e-8) {
      list.length = 0;
      list.push(["root", 1]);
      continue;
    }
    for (const item of list) item[1] /= sum;
  }
  return lists;
}

function faceList(faces, groupName) {
  const tris = [];
  for (let i = 0; i < faces.length; i += 4) {
    if (groupName && faces[i] !== groupName) continue;
    if (!groupName && faces[i] !== "body") continue;
    tris.push(faces[i + 1], faces[i + 2], faces[i + 3]);
  }
  return tris;
}

function groups(faces, names) {
  const tris = [];
  const set = new Set(names);
  for (let i = 0; i < faces.length; i += 4) {
    if (!set.has(faces[i])) continue;
    tris.push(faces[i + 1], faces[i + 2], faces[i + 3]);
  }
  return tris;
}

function normalsFor(verts, tris) {
  const n = new Float32Array(verts.length);
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i] * 3;
    const b = tris[i + 1] * 3;
    const c = tris[i + 2] * 3;
    const ax = verts[b] - verts[a];
    const ay = verts[b + 1] - verts[a + 1];
    const az = verts[b + 2] - verts[a + 2];
    const bx = verts[c] - verts[a];
    const by = verts[c + 1] - verts[a + 1];
    const bz = verts[c + 2] - verts[a + 2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    for (const vi of [tris[i], tris[i + 1], tris[i + 2]]) {
      n[vi * 3] += nx;
      n[vi * 3 + 1] += ny;
      n[vi * 3 + 2] += nz;
    }
  }
  return n;
}

function outward(verts, tris) {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let c = 0;
  for (let i = 0; i < tris.length; i += 30) {
    const vi = tris[i];
    sx += verts[vi * 3];
    sy += verts[vi * 3 + 1];
    sz += verts[vi * 3 + 2];
    c++;
  }
  sx /= c;
  sy /= c;
  sz /= c;
  let dot = 0;
  for (let i = 0; i < tris.length; i += 90) {
    const a = tris[i] * 3;
    const b = tris[i + 1] * 3;
    const d = tris[i + 2] * 3;
    const ax = verts[b] - verts[a];
    const ay = verts[b + 1] - verts[a + 1];
    const az = verts[b + 2] - verts[a + 2];
    const bx = verts[d] - verts[a];
    const by = verts[d + 1] - verts[a + 1];
    const bz = verts[d + 2] - verts[a + 2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    dot += nx * (verts[a] - sx) + ny * (verts[a + 1] - sy) + nz * (verts[a + 2] - sz);
  }
  return dot >= 0;
}

function jointMap(skel, verts) {
  const out = {};
  for (const [name, ids] of Object.entries(skel.joints)) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (const id of ids) {
      x += verts[id * 3];
      y += verts[id * 3 + 1];
      z += verts[id * 3 + 2];
    }
    const n = ids.length || 1;
    out[name] = [x / n, y / n, z / n];
  }
  return out;
}

function weightOn(list, names) {
  let s = 0;
  for (const [bone, w] of list) if (names.has(bone)) s += w;
  return s;
}

function buildClothes(verts, bodyTris, infl, joints) {
  const hip = joints["upperleg01.L____head"][1];
  const knee = joints["lowerleg01.L____head"][1];
  const neck = joints["neck01____head"][1];
  const shoulder = joints["shoulder01.L____head"][1];
  const LEG = new Set(["upperleg01.L", "upperleg02.L", "upperleg01.R", "upperleg02.R", "pelvis.L", "pelvis.R", "root"]);
  const SHIN = new Set(["lowerleg01.L", "lowerleg02.L", "lowerleg01.R", "lowerleg02.R", "foot.L", "foot.R"]);
  const BREAST = new Set(["breast.L", "breast.R"]);
  const TORSO = new Set(["spine01", "spine02", "spine03", "spine04", "spine05", "clavicle.L", "clavicle.R", "shoulder01.L", "shoulder01.R", "breast.L", "breast.R"]);
  const ARM = new Set(["upperarm01.L", "upperarm02.L", "upperarm01.R", "upperarm02.R", "lowerarm01.L", "lowerarm02.L", "lowerarm01.R", "lowerarm02.R"]);
  const HEAD = new Set(["head", "neck01", "neck02", "neck03"]);
  const HAND = new Set(["wrist.L", "wrist.R"]);
  const FOOT = new Set(["foot.L", "foot.R"]);
  for (const [name] of Object.entries(joints)) {
    if (name.startsWith("finger")) HAND.add(name.split("____")[0]);
    if (name.startsWith("toe")) FOOT.add(name.split("____")[0]);
  }
  const pick = { trunks: [], bikiniBottom: [], bikiniTop: [], rash: [], onesie: [], hair: [] };
  const tmp = [0, 0, 0];
  for (let i = 0; i < bodyTris.length; i += 3) {
    const ids = [bodyTris[i], bodyTris[i + 1], bodyTris[i + 2]];
    tmp[0] = tmp[1] = tmp[2] = 0;
    let leg = 0;
    let shin = 0;
    let breast = 0;
    let torso = 0;
    let arm = 0;
    let head = 0;
    let hand = 0;
    let foot = 0;
    for (const id of ids) {
      tmp[0] += verts[id * 3];
      tmp[1] += verts[id * 3 + 1];
      tmp[2] += verts[id * 3 + 2];
      const list = infl[id];
      leg += weightOn(list, LEG);
      shin += weightOn(list, SHIN);
      breast += weightOn(list, BREAST);
      torso += weightOn(list, TORSO);
      arm += weightOn(list, ARM);
      head += weightOn(list, HEAD);
      hand += weightOn(list, HAND);
      foot += weightOn(list, FOOT);
    }
    const y = tmp[1] / 3;
    const z = tmp[2] / 3;
    leg /= 3;
    shin /= 3;
    breast /= 3;
    torso /= 3;
    arm /= 3;
    head /= 3;
    hand /= 3;
    foot /= 3;
    const aboveKnee = y > knee + 0.04 && y < hip + 0.06;
    if (aboveKnee && leg > 0.4 && shin < 0.35 && head < 0.02 && arm < 0.05) pick.trunks.push(...ids);
    if (y > knee + (hip - knee) * 0.58 && y < hip + 0.015 && leg > 0.4 && shin < 0.15 && head < 0.02) pick.bikiniBottom.push(...ids);
    const chestLow = hip + Math.max(0.16, (shoulder - hip) * 0.42);
    const chestHigh = shoulder - 0.06;
    if (z > 0.025 && y > chestLow && y < chestHigh && head < 0.04 && arm < 0.15 && (breast > 0.1 || torso > 0.5)) {
      pick.bikiniTop.push(...ids);
    }
    if ((torso > 0.4 || arm > 0.5) && head < 0.05 && hand < 0.2 && y < neck - 0.02 && y > hip - 0.02) {
      pick.rash.push(...ids);
    }
    if (head < 0.04 && hand < 0.18 && foot < 0.12 && y < neck - 0.02 && y > -0.72) pick.onesie.push(...ids);
  }
  return pick;
}

function hairTris(verts, bodyTris, infl, normals) {
  const tris = [];
  for (let i = 0; i < bodyTris.length; i += 3) {
    const ids = [bodyTris[i], bodyTris[i + 1], bodyTris[i + 2]];
    let ok = 0;
    for (const id of ids) {
      const list = infl[id];
      let head = 0;
      for (const [bone, w] of list) if (bone === "head") head += w;
      const nz = normals[id * 3 + 2];
      const ny = normals[id * 3 + 1];
      if (head > 0.62 && nz < 0.35 && ny > -0.15) ok++;
    }
    if (ok === 3) tris.push(...ids);
  }
  return tris;
}

function shell(verts, tris, normals, amount) {
  const v = new Float64Array(verts);
  const seen = new Set(tris);
  for (const id of seen) {
    let nx = normals[id * 3];
    let ny = normals[id * 3 + 1];
    let nz = normals[id * 3 + 2];
    const len = Math.hypot(nx, ny, nz) || 1;
    v[id * 3] += (nx / len) * amount;
    v[id * 3 + 1] += (ny / len) * amount;
    v[id * 3 + 2] += (nz / len) * amount;
  }
  return { verts: v, tris };
}

function ponytail(joints) {
  const head = joints["head____head"];
  const tail = joints["head____tail"];
  const ax = head[0];
  const ay = (head[1] + tail[1]) * 0.5;
  const az = Math.min(head[2], tail[2]) - 0.04;
  const positions = [];
  const indices = [];
  const rings = 7;
  const segs = 8;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const y = ay - t * 0.05 - t * t * 0.16;
    const z = az - 0.03 - t * 0.05;
    const r = 0.034 * (1 - t * 0.72);
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      positions.push(ax + Math.cos(a) * r, y, z + Math.sin(a) * r * 0.8);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j;
      const b = i * segs + ((j + 1) % segs);
      indices.push(a, b, a + segs, b, b + segs, a + segs);
    }
  }
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ax = positions[b] - positions[a];
    const ay = positions[b + 1] - positions[a + 1];
    const az = positions[b + 2] - positions[a + 2];
    const bx = positions[c] - positions[a];
    const by = positions[c + 1] - positions[a + 1];
    const bz = positions[c + 2] - positions[a + 2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    for (const o of [a, b, c]) {
      normals[o] += nx;
      normals[o + 1] += ny;
      normals[o + 2] += nz;
    }
  }
  return { positions, indices, normals };
}

function compact(srcVerts, tris, normals, infl, boneIndex) {
  const map = new Map();
  const pos = [];
  const nrm = [];
  const joints = [];
  const weights = [];
  const idx = [];
  for (const vi of tris) {
    let ni = map.get(vi);
    if (ni === undefined) {
      ni = map.size;
      map.set(vi, ni);
      pos.push(srcVerts[vi * 3], srcVerts[vi * 3 + 1], srcVerts[vi * 3 + 2]);
      let nx = normals[vi * 3] || 0;
      let ny = normals[vi * 3 + 1] || 1;
      let nz = normals[vi * 3 + 2] || 0;
      const len = Math.hypot(nx, ny, nz) || 1;
      nrm.push(nx / len, ny / len, nz / len);
      const list = infl[vi] || [["root", 1]];
      const j = [0, 0, 0, 0];
      const w = [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) {
        if (!list[k]) break;
        j[k] = boneIndex.get(list[k][0]) ?? 0;
        w[k] = list[k][1];
      }
      joints.push(...j);
      weights.push(...w);
    }
    idx.push(ni);
  }
  return { pos, nrm, joints, weights, idx };
}

function meshFrom(name, packed) {
  return { name, ...packed };
}

function scaleAll(verts, s) {
  for (let i = 0; i < verts.length; i++) verts[i] *= s;
}

function buildCharacter(kind, baseVerts, faces, infl, skel, targets) {
  const verts = Float64Array.from(baseVerts);
  for (const [target, w] of targets) applyTarget(verts, target, w);
  scaleAll(verts, 0.1);
  const bodyTris = faceList(faces, "body");
  if (!outward(verts, bodyTris)) {
    for (let i = 0; i < bodyTris.length; i += 3) {
      const t = bodyTris[i + 1];
      bodyTris[i + 1] = bodyTris[i + 2];
      bodyTris[i + 2] = t;
    }
  }
  const normals = normalsFor(verts, bodyTris);
  const joints = jointMap(skel, verts);
  for (const key of Object.keys(joints)) {
    joints[key][0] *= 1;
  }
  const clothes = buildClothes(verts, bodyTris, infl, joints);
  const hair = hairTris(verts, bodyTris, infl, normals);
  const eyes = groups(faces, ["helper-l-eye", "helper-r-eye"]);
  const lashes = groups(faces, ["helper-l-eyelashes-1", "helper-l-eyelashes-2", "helper-r-eyelashes-1", "helper-r-eyelashes-2"]);
  const teeth = groups(faces, ["helper-upper-teeth", "helper-lower-teeth"]);
  const allNorm = normalsFor(verts, bodyTris.concat(eyes, lashes, teeth));
  for (let i = 0; i < allNorm.length; i++) if (!allNorm[i] && normals[i]) allNorm[i] = normals[i];

  const bones = [];
  const byName = skel.bones;
  const pending = Object.keys(byName);
  const placed = new Set();
  while (pending.length) {
    let moved = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const name = pending[i];
      const parent = byName[name].parent;
      if (parent && !placed.has(parent)) continue;
      bones.push(name);
      placed.add(name);
      pending.splice(i, 1);
      moved = true;
    }
    if (!moved) throw new Error("bone cycle");
  }
  const boneIndex = new Map(bones.map((name, i) => [name, i]));
  const boneLocals = bones.map((name) => {
    const spec = byName[name];
    const head = joints[spec.head];
    const parent = spec.parent ? joints[byName[spec.parent].head] : [0, 0, 0];
    return [head[0] - parent[0], head[1] - parent[1], head[2] - parent[2]];
  });

  const pack = (name, vts, tris, inflate) => {
    const src = inflate ? shell(vts, tris, allNorm, inflate).verts : vts;
    return meshFrom(name, compact(src, tris, allNorm, infl, boneIndex));
  };
  const meshes = [
    pack("body", verts, bodyTris, 0),
    pack("eyes", verts, eyes, 0),
    pack("lashes", verts, lashes, 0.001),
    pack("teeth", verts, teeth, 0),
    pack("hair", verts, hair, kind === "female" ? 0.01 : 0.014),
    pack("trunks", verts, clothes.trunks, 0.007),
    pack("bikiniBottom", verts, clothes.bikiniBottom, 0.006),
    pack("bikiniTop", verts, clothes.bikiniTop, 0.005),
    pack("rash", verts, clothes.rash, 0.006),
    pack("onesie", verts, clothes.onesie, 0.007),
  ];
  if (kind === "female") {
    const pony = ponytail(joints);
    const lists = [];
    for (let i = 0; i < pony.positions.length / 3; i++) lists.push([["head", 1]]);
    meshes.push(meshFrom("ponytail", compact(Float64Array.from(pony.positions), pony.indices, pony.normals, lists, boneIndex)));
  }
  let minY = Infinity;
  for (const id of bodyTris) minY = Math.min(minY, verts[id * 3 + 1]);
  console.log(kind, "body verts", meshes[0].pos.length / 3, "tris", meshes[0].idx.length / 3, "minY", minY.toFixed(3), "hip", joints["upperleg01.L____head"].map((n) => n.toFixed(3)).join(","));
  return { bones, boneLocals, parent: bones.map((name) => byName[name].parent), meshes, minY };
}

function pad4(buf) {
  const n = (4 - (buf.length % 4)) % 4;
  if (!n) return buf;
  return Buffer.concat([buf, Buffer.alloc(n)]);
}

function glbFor(character) {
  const binParts = [];
  let offset = 0;
  const bufferViews = [];
  const accessors = [];
  function push(data, typeBytes) {
    if (offset % typeBytes) {
      const pad = typeBytes - (offset % typeBytes);
      binParts.push(Buffer.alloc(pad));
      offset += pad;
    }
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length });
    binParts.push(buf);
    offset += buf.length;
    return bufferViews.length - 1;
  }
  const nodes = [];
  const boneNodeStart = 1;
  nodes.push({ name: "Armature", children: [] });
  character.bones.forEach((name, i) => {
    const node = {
      name,
      translation: character.boneLocals[i].map((v) => +v.toFixed(5)),
    };
    const kids = [];
    character.bones.forEach((other, j) => {
      if (character.parent[j] === name) kids.push(boneNodeStart + j);
    });
    if (kids.length) node.children = kids;
    nodes.push(node);
  });
  const rootChildren = character.bones.map((name, i) => (character.parent[i] ? null : boneNodeStart + i)).filter((n) => n !== null);
  const inv = new Float32Array(character.bones.length * 16);
  const world = character.bones.map(() => [0, 0, 0]);
  character.bones.forEach((name, i) => {
    const parent = character.parent[i];
    const pi = parent ? character.bones.indexOf(parent) : -1;
    const lt = character.boneLocals[i];
    if (pi < 0) world[i] = [...lt];
    else world[i] = [world[pi][0] + lt[0], world[pi][1] + lt[1], world[pi][2] + lt[2]];
    const o = i * 16;
    inv[o] = 1;
    inv[o + 5] = 1;
    inv[o + 10] = 1;
    inv[o + 15] = 1;
    inv[o + 12] = -world[i][0];
    inv[o + 13] = -world[i][1];
    inv[o + 14] = -world[i][2];
  });
  const invView = push(inv, 4);
  accessors.push({
    bufferView: invView,
    componentType: 5126,
    count: character.bones.length,
    type: "MAT4",
  });
  const meshes = [];
  const meshNodes = [];
  for (const mesh of character.meshes) {
    if (!mesh.idx.length) continue;
    const pos = Float32Array.from(mesh.pos);
    const nrm = Float32Array.from(mesh.nrm);
    const joints = Uint16Array.from(mesh.joints);
    const weights = Float32Array.from(mesh.weights);
    const idx = Uint16Array.from(mesh.idx);
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], pos[i + k]);
        max[k] = Math.max(max[k], pos[i + k]);
      }
    }
    const views = [push(pos, 4), push(nrm, 4), push(joints, 4), push(weights, 4), push(idx, 4)];
    const base = accessors.length;
    accessors.push(
      { bufferView: views[0], componentType: 5126, count: pos.length / 3, type: "VEC3", min, max },
      { bufferView: views[1], componentType: 5126, count: nrm.length / 3, type: "VEC3" },
      { bufferView: views[2], componentType: 5123, count: joints.length / 4, type: "VEC4" },
      { bufferView: views[3], componentType: 5126, count: weights.length / 4, type: "VEC4" },
      { bufferView: views[4], componentType: 5123, count: idx.length, type: "SCALAR" },
    );
    meshes.push({
      name: mesh.name,
      primitives: [{
        attributes: { POSITION: base, NORMAL: base + 1, JOINTS_0: base + 2, WEIGHTS_0: base + 3 },
        indices: base + 4,
      }],
    });
    const nodeIndex = nodes.length;
    nodes.push({ name: mesh.name, mesh: meshes.length - 1, skin: 0 });
    meshNodes.push(nodeIndex);
  }
  nodes[0].children = rootChildren.concat(meshNodes);
  const bin = pad4(Buffer.concat(binParts));
  const json = {
    asset: { version: "2.0", generator: "endless-swell build-surfers" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes,
    skins: [{ joints: character.bones.map((_, i) => boneNodeStart + i), inverseBindMatrices: 0, skeleton: boneNodeStart }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  };
  const jsonBuf = Buffer.from(JSON.stringify(json));
  const jsonPad = Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20);
  const total = 12 + 8 + jsonBuf.length + jsonPad.length + 8 + bin.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  let o = 12;
  out.writeUInt32LE(jsonBuf.length + jsonPad.length, o);
  o += 4;
  out.writeUInt32LE(0x4e4f534a, o);
  o += 4;
  jsonBuf.copy(out, o);
  o += jsonBuf.length;
  jsonPad.copy(out, o);
  o += jsonPad.length;
  out.writeUInt32LE(bin.length, o);
  o += 4;
  out.writeUInt32LE(0x004e4942, o);
  o += 4;
  bin.copy(out, o);
  return out;
}

const obj = parseObj(await text(`${ROOT}/3dobjs/base.obj`));
const skel = JSON.parse(await text(`${ROOT}/rigs/default.mhskel`));
const weightText = await text(`${ROOT}/rigs/default_weights.mhw`);
const vertCount = obj.verts.length / 3;
const infl = influencesFrom(weightText, vertCount);
console.log("base", vertCount, "faces", obj.faces.length / 4);

const race = { caucasian: 0.42, african: 0.3, asian: 0.28 };
const maleTargets = await loadMacro("male", 0.78, 0.22, race);
const femaleTargets = await loadMacro("female", 0.66, 0.26, race);
const male = buildCharacter("male", obj.verts, obj.faces, infl, skel, maleTargets);
const female = buildCharacter("female", obj.verts, obj.faces, infl, skel, femaleTargets);
const maleGlb = glbFor(male);
const femaleGlb = glbFor(female);
mkdirSync(dirname(outFile), { recursive: true });
const banner = `// Generated by scripts/build-surfers.mjs from MakeHuman CC0 assets. Do not edit.
`;
writeFileSync(outFile, `${banner}export const maleB64 = ${JSON.stringify(maleGlb.toString("base64"))};\nexport const femaleB64 = ${JSON.stringify(femaleGlb.toString("base64"))};\n`);
console.log("wrote", outFile, "male", maleGlb.length, "female", femaleGlb.length);
