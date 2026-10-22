// Builds the male and female surfers from MakeHuman CC0 assets and writes src/assets/surfers.data.js
// (two glTF binaries, base64, plus the textures as data URIs, so the single-file build stays self-contained).
//
//   node scripts/build-surfers.mjs [--male-hair short04] [--female-hair ponytail01] [--quiet]
//
// Sources (all CC0 1.0, listed with URLs in ASSETS.md):
//   GitHub makehumancommunity/makehuman, makehuman/data: 3dobjs/base.obj (mesh + UVs), rigs/default.mhskel and
//     rigs/default_weights.mhw (skeleton, skin weights), targets/macrodetails/* (body shape).
//   makehuman_system_assets_cc0.zip (read with HTTP Range requests, only the entries below are fetched):
//     skins/*   diffuse maps          hair/*     hair meshes (.mhclo + .obj + diffuse png with alpha)
//     eyes/*    eye meshes + iris map  eyebrows/* and eyelashes/*  meshes + alpha pngs
//
// MakeHuman file formats (read from the files themselves; the full description is at the top of scripts/lib/mh.mjs):
//   .obj    `v` positions in decimeters, `vt` texture coordinates (origin bottom left), `g` groups, faces `f v/vt ...`.
//           The exporter splits a vertex wherever its (v, vt) pair differs, so seams get one vertex per UV, and writes
//           TEXCOORD_0 with v flipped to the glTF convention (origin top left).
//   .mhclo  hair, eyebrows, eyelashes, eyes, clothes: `obj_file`, `material`, `x_scale/y_scale/z_scale a b d` and, after
//           `verts 0`, one line per proxy vertex: `a b c wa wb wc ox oy oz` (position = weighted sum of three base-mesh
//           vertices + offset scaled by |base[a]-base[b]|/d on that axis) or a single index (a direct base vertex).
//   .mhmat  `diffuseTexture`, `transparent`, colours; only the texture name and transparency are read.
//   .mhskel/.mhw  JSON: bones with head/tail joints and parents; per-bone [vertex, weight] lists.
// Everything fetched is cached under build/.cache/ (gitignored).
//
// What is made here (not downloaded): the clothing. MakeHuman's CC0 packs hold no swimwear (the 20 clothes are
// shoes, a hat and casual/work/elegant/sport suits), so trunks, bikini, rashguards, full and spring suits are cut from
// the body surface by scripts/lib/garments.mjs and share the body's skin weights.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { blendInfluence, influencesFrom, jointMap, shapeBody } from "./lib/character.mjs";
import { RACE, SHAPES } from "./lib/bodyspec.mjs";
import { tintHair } from "./lib/haircolour.mjs";
import { formatMeasure, measureBody } from "./lib/measure.mjs";
import * as G from "./lib/garments.mjs";
import { bleedColour, decodePng, encodeAlphaPng, encodeJpeg, meanNormalise, opaque, resize } from "./lib/image.mjs";
import { computeNormals, flipWinding, hemReport, makeSurface, surfaceFromBase, triCount, windsOutward } from "./lib/mesh.mjs";
import { cavityColors, darkenScalp, scalpMask } from "./lib/skinbake.mjs";
import { fitProxy, parseMhclo, parseMhmat, parseObj, triangulate } from "./lib/mh.mjs";
import { SYSTEM_ASSETS_ZIP, githubText, openRemoteZip } from "./lib/remote.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, "../src/assets/surfers.data.js");
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const quiet = argv.includes("--quiet");

const log = (...a) => {
  if (!quiet) console.log(...a);
};

// Per body: macro shape, the chosen CC0 assets, and the licence record the report and ASSETS.md quote.
const KINDS = {
  male: {
    shape: SHAPES.male,
    hair: opt("male-hair", "short04"),
    // sun-bleached dark blond over brown: shadow, light and bleach colours (sRGB) for lib/haircolour.mjs
    scalpFloor: 0.45,
    hairColour: { shade: [52, 34, 20], light: [128, 92, 52], bleach: [182, 144, 90], streakAmount: 0.6, streakScale: 38, seed: 11 },
    brows: "eyebrow008",
    lashes: "eyelashes01",
    skins: {
      light: "skins/young_caucasian_male/young_lightskinned_male_diffuse.png",
      dark: "skins/young_african_male/young_darkskinned_male_diffuse.png",
    },
  },
  female: {
    shape: SHAPES.female,
    hair: opt("female-hair", "ponytail01"),
    // brown with sun streaks
    scalpFloor: 0.38,
    hairColour: { shade: [44, 28, 20], light: [124, 82, 52], bleach: [196, 144, 84], streakAmount: 0.5, streakScale: 46, seed: 23 },
    brows: "eyebrow001",
    lashes: "eyelashes02",
    skins: {
      light: "skins/young_caucasian_female/young_lightskinned_female_diffuse.png",
      dark: "skins/young_african_female/young_darkskinned_female_diffuse.png",
    },
  },
};
const EYE = { mesh: "eyes/high-poly/high-poly", material: "eyes/materials/brown.mhmat" };
const TEX = { skin: 2048, hair: 1024, eye: 512, brows: 512, lashes: 512 };
// skin under opaque hair is darkened to a fraction (the hair-root shade, whatever the tone); the fraction is per body because it
// has to suit the hair colour: black hair wants a deep root shade, the blond male's wants a light one
const SKIN_LEVEL = 0.6; // the skin detail map's mean sits at 60% grey; the material colour multiplies by 1/0.6

const used = []; // licence record: { file, url, licence }
const zip = await openRemoteZip(SYSTEM_ASSETS_ZIP);
const packMeta = JSON.parse((await zip.read("packs/makehuman_system_assets.json")).toString());
async function asset(name) {
  const key = name.split("/").pop().replace(/\.[a-z]+$/, "");
  used.push({ file: name, url: `${SYSTEM_ASSETS_ZIP} -> ${name}`, key });
  return zip.read(name);
}
function licenceOf(item) {
  const m = packMeta[item];
  if (!m) throw new Error(`${item} is not in packs/makehuman_system_assets.json`);
  if (m.license !== "CC0") throw new Error(`${item} is ${m.license}, not CC0; refusing to use it`);
  return m.license;
}

// ---------------------------------------------------------------------------------------------------------------
// bones

function boneOrder(skel) {
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
  return bones;
}

// ---------------------------------------------------------------------------------------------------------------
// proxies (hair, eyes, brows, lashes): fitted to the shaped body

// keepFace(cornersUv) can drop faces; used to remove the eye proxy's transparent cornea shell.
async function proxySurface(path, vertsDm, infl, forceBone, keepFace = () => true) {
  const clo = parseMhclo((await asset(`${path}.mhclo`)).toString());
  const obj = parseObj((await asset(`${path}.obj`)).toString());
  const fitted = fitProxy(clo, vertsDm);
  const meters = fitted.map((v) => v * 0.1);
  const faces = [...obj.groups.values()].flat().filter((f) => keepFace(f.map(([, t]) => [obj.uvs[t * 2], obj.uvs[t * 2 + 1]])));
  const { tv, tt } = triangulate(faces);
  const lists = clo.fit.map((f) => (forceBone ? [[forceBone, 1]] : blendInfluence(infl, f.v, f.w)));
  const s = surfaceFromBase(meters, obj.uvs, lists, tv, tt);
  return { s, clo, obj };
}

// Hair: normals point away from the middle of the head, blended with the card's own normal, so a cap of flat cards
// shades like one rounded mass of hair.
function hairNormals(s, centre, weightRadial) {
  const geo = computeNormals(s);
  const N = new Float64Array(s.n * 3);
  for (let i = 0; i < s.n; i++) {
    let rx = s.P[i * 3] - centre[0];
    let ry = s.P[i * 3 + 1] - centre[1];
    let rz = s.P[i * 3 + 2] - centre[2];
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl;
    ry /= rl;
    rz /= rl;
    let gx = geo[i * 3];
    let gy = geo[i * 3 + 1];
    let gz = geo[i * 3 + 2];
    if (gx * rx + gy * ry + gz * rz < 0) {
      gx = -gx;
      gy = -gy;
      gz = -gz;
    }
    const x = gx * (1 - weightRadial) + rx * weightRadial;
    const y = gy * (1 - weightRadial) + ry * weightRadial;
    const z = gz * (1 - weightRadial) + rz * weightRadial;
    const l = Math.hypot(x, y, z) || 1;
    N[i * 3] = x / l;
    N[i * 3 + 1] = y / l;
    N[i * 3 + 2] = z / l;
  }
  return N;
}

// ---------------------------------------------------------------------------------------------------------------
// textures

// Coverage mask of the UV triangles of the reference skin (torso, arms, legs; not head, hands, feet).
function uvMask(surface, size, triOk) {
  const mask = new Uint8Array(size * size);
  for (let t = 0; t < surface.T.length / 3; t++) {
    if (!triOk(t)) continue;
    const pts = [0, 1, 2].map((k) => {
      const v = surface.T[t * 3 + k];
      return [surface.UV[v * 2] * size, (1 - surface.UV[v * 2 + 1]) * size];
    });
    const minX = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0]))));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(...pts.map((p) => p[0]))));
    const minY = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1]))));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(...pts.map((p) => p[1]))));
    const [a, b, c] = pts;
    const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(den) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / den;
        const l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / den;
        if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) mask[y * size + x] = 1;
      }
    }
  }
  return mask;
}

const uri = (buf, mime) => `data:${mime};base64,${buf.toString("base64")}`;
const sizes = [];
function record(label, buf) {
  sizes.push([label, buf.length]);
  return buf;
}

// ---------------------------------------------------------------------------------------------------------------
// glTF binary

const pad4 = (buf) => (buf.length % 4 ? Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4))]) : buf);

function glbFor(character) {
  const binParts = [];
  let offset = 0;
  const bufferViews = [];
  const accessors = [];
  function push(data, target) {
    if (offset % 4) {
      const pad = 4 - (offset % 4);
      binParts.push(Buffer.alloc(pad));
      offset += pad;
    }
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) });
    binParts.push(buf);
    offset += buf.length;
    return bufferViews.length - 1;
  }
  const nodes = [{ name: "Armature", children: [] }];
  const boneNodeStart = 1;
  character.bones.forEach((name, i) => {
    const node = { name, translation: character.boneLocals[i].map((v) => +v.toFixed(5)) };
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
    world[i] = pi < 0 ? [...lt] : [world[pi][0] + lt[0], world[pi][1] + lt[1], world[pi][2] + lt[2]];
    const o = i * 16;
    inv[o] = 1;
    inv[o + 5] = 1;
    inv[o + 10] = 1;
    inv[o + 15] = 1;
    inv[o + 12] = -world[i][0];
    inv[o + 13] = -world[i][1];
    inv[o + 14] = -world[i][2];
  });
  accessors.push({ bufferView: push(inv), componentType: 5126, count: character.bones.length, type: "MAT4" });
  const meshes = [];
  const meshNodes = [];
  for (const part of character.parts) {
    const s = part.surface;
    if (!s.T.length) throw new Error(`${character.kind} part ${part.name} is empty`);
    const pos = Float32Array.from(s.P);
    const nrm = Float32Array.from(part.normals);
    const uv = new Float32Array(s.n * 2);
    for (let i = 0; i < s.n; i++) {
      uv[i * 2] = s.UV[i * 2];
      uv[i * 2 + 1] = 1 - s.UV[i * 2 + 1]; // obj uvs start bottom left, glTF top left
    }
    const joints = new Uint16Array(s.n * 4);
    const weights = new Float32Array(s.n * 4);
    for (let i = 0; i < s.n; i++) {
      s.INF[i].slice(0, 4).forEach(([bone, w], k) => {
        const idx = character.boneIndex.get(bone);
        if (idx === undefined) throw new Error(`unknown bone ${bone} on ${part.name}`);
        joints[i * 4 + k] = idx;
        weights[i * 4 + k] = w;
      });
    }
    const big = s.n > 65535;
    const idx = big ? Uint32Array.from(s.T) : Uint16Array.from(s.T);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], pos[i + k]);
        max[k] = Math.max(max[k], pos[i + k]);
      }
    }
    const attrs = {};
    const add = (semantic, data, type, comp = 5126, extra = {}) => {
      const view = push(data, 34962);
      accessors.push({ bufferView: view, componentType: comp, count: s.n, type, ...extra });
      attrs[semantic] = accessors.length - 1;
    };
    add("POSITION", pos, "VEC3", 5126, { min, max });
    add("NORMAL", nrm, "VEC3");
    add("TEXCOORD_0", uv, "VEC2");
    add("JOINTS_0", joints, "VEC4", 5123);
    add("WEIGHTS_0", weights, "VEC4");
    if (s.A.TRIM) add("_TRIM", Float32Array.from(s.A.TRIM.data), "SCALAR");
    if (part.color) add("COLOR_0", part.color, "VEC3");
    const idxView = push(idx, 34963);
    accessors.push({ bufferView: idxView, componentType: big ? 5125 : 5123, count: idx.length, type: "SCALAR" });
    meshes.push({ name: part.name, primitives: [{ attributes: attrs, indices: accessors.length - 1 }] });
    nodes.push({ name: part.name, mesh: meshes.length - 1, skin: 0 });
    meshNodes.push(nodes.length - 1);
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

// ---------------------------------------------------------------------------------------------------------------
// one body

async function buildCharacter(kind, spec, base, skel, infl) {
  const vertsDm = await shapeBody(kind, spec.shape, RACE, base.verts);
  const verts = vertsDm.map((v) => v * 0.1);
  const joints = jointMap(skel, verts);
  const measures = measureBody({ verts, bodyFaces: base.groups.get("body"), joints, infl });
  log(`${kind} proportions:`);
  for (const line of formatMeasure(measures)) log("  " + line);

  // body
  const bodyFaces = triangulate(base.groups.get("body"));
  const body = surfaceFromBase(verts, base.uvs, infl, bodyFaces.tv, bodyFaces.tt);
  if (!windsOutward(body)) flipWinding(body);
  const bodyNormals = computeNormals(body);

  const parts = [{ name: "body", surface: body, normals: bodyNormals }];
  const counts = {};

  // teeth stay: the base mesh's own helper teeth
  const teethFaces = triangulate([...base.groups.get("helper-upper-teeth"), ...base.groups.get("helper-lower-teeth")]);
  const teeth = surfaceFromBase(verts, base.uvs, infl, teethFaces.tv, teethFaces.tt);
  parts.push({ name: "teeth", surface: teeth, normals: computeNormals(teeth) });

  // eyes, brows, lashes, hair
  // The high-poly eye proxy is two shells per eye: the eyeball (iris + sclera in the texture) and a slightly larger
  // transparent cornea whose uvs all point at the small blue disc in the texture's corner. The cornea is dropped (the
  // eye material's clearcoat stands in for it); keeping it would paint the disc, which has alpha 0, as black.
  const eyes = await proxySurface(EYE.mesh, vertsDm, infl, undefined, (uvs) => {
    const u = uvs.reduce((a, p) => a + p[0], 0) / uvs.length;
    const v = uvs.reduce((a, p) => a + p[1], 0) / uvs.length;
    return !(u > 0.85 && v < 0.15);
  });
  licenceOf("high-poly");
  if (!windsOutward(eyes.s)) flipWinding(eyes.s); // two closed balls: the front faces must be the outside
  parts.push({ name: "eyes", surface: eyes.s, normals: computeNormals(eyes.s) });
  const brows = await proxySurface(`eyebrows/${spec.brows}/${spec.brows}`, vertsDm, infl);
  licenceOf(spec.brows);
  parts.push({ name: "brows", surface: brows.s, normals: computeNormals(brows.s) });
  const lashes = await proxySurface(`eyelashes/${spec.lashes}/${spec.lashes}`, vertsDm, infl);
  licenceOf(spec.lashes);
  parts.push({ name: "lashes", surface: lashes.s, normals: computeNormals(lashes.s) });
  const hair = await proxySurface(`hair/${spec.hair}/${spec.hair}`, vertsDm, infl, "head");
  licenceOf(spec.hair);
  const headC = joints["head____head"].map((v, k) => (v + joints["head____tail"][k]) / 2);
  parts.push({ name: "hair", surface: hair.s, normals: hairNormals(hair.s, headC, 0.6) });
  const hairMat = parseMhmat((await asset(`hair/${spec.hair}/${spec.hair}.mhmat`)).toString());

  // clothes
  G.prepareBody(body);
  parts[0].color = cavityColors(body); // COLOR_0 on the skin: hollows are darker (see lib/skinbake.mjs)
  const A = G.anatomy(body, joints);
  // Men wear board shorts and nothing else (Ed, 2026-10-21: no shirts, no suits for men); the women's cuts are the bikini, the
  // rashguard (worn with the bikini bottom as one matching set), the fullsuit and the springsuit.
  const outfit = kind === "male" ? { trunks: G.trunks } : { bikiniBottom: G.bikiniBottom, bikiniTop: G.bikiniTop, rash: G.rash, fullsuit: G.fullsuit, springsuit: G.springsuit };
  for (const [name, make] of Object.entries(outfit)) {
    const s = make(body, A, kind);
    parts.push({ name, surface: s, normals: computeNormals(s) });
    // how sharp a corner each border of the garment has: the turning angle between the two segments meeting at each border point
    const { turns, degree, hot } = hemReport(s);
    const all = turns.flat().sort((x, y) => x - y);
    if (all.length) console.log(`hem ${kind} ${name}: ${turns.length} border loops, ${all.length} points, turning angle max ${all[all.length - 1].toFixed(1)} deg, p99 ${all[Math.floor(all.length * 0.99)].toFixed(1)} deg, median ${all[Math.floor(all.length / 2)].toFixed(1)} deg; border vertex degrees ${JSON.stringify(degree)}`);
    if (hot.length) console.log(`   sharpest points (turn over 45 deg, x y z in metres): ${hot.sort((a, b) => b.deg - a.deg).slice(0, 5).map((h) => `${h.deg.toFixed(0)} deg at ${h.at.map((v) => v.toFixed(3)).join(",")}`).join("; ")}`);
  }
  for (const p of parts) counts[p.name] = triCount(p.surface);

  // body part carries PS/BN/TRIM attributes for the cutting; the glb keeps only what the game reads
  body.A = {};

  // reference skin: torso, arms and legs (not head, hands, feet) for the mean of the skin detail map
  const SKIN_REF_BAD = /^(head|neck|jaw|eye|oculi|orbicularis|oris|levator|risorius|temporalis|special|tongue|wrist|metacarpal|finger|foot|toe)/;
  const refMask = uvMask(body, TEX.skin, (t) => {
    let bad = 0;
    for (let k = 0; k < 3; k++) for (const [b, w] of body.INF[body.T[t * 3 + k]]) if (SKIN_REF_BAD.test(b)) bad += w;
    return bad / 3 < 0.2;
  });
  const HEAD_NOT = /^(root|pelvis|spine|breast|clavicle|shoulder|upperarm|lowerarm|wrist|metacarpal|finger|upperleg|lowerleg|foot|toe)/;
  const isHead = (t) => {
    let w = 0;
    for (let k = 0; k < 3; k++) for (const [b, x] of body.INF[body.T[t * 3 + k]]) if (!HEAD_NOT.test(b)) w += x;
    return w / 3 > 0.5;
  };
  const hairSurface = parts.find((p) => p.name === "hair").surface;
  return { kind, spec, measures, parts, counts, joints, refMask, hairMat, A, body, bodyNormals, hairSurface, isHead };
}

// ---------------------------------------------------------------------------------------------------------------

const base = parseObj(await githubText("3dobjs/base.obj"));
const skel = JSON.parse(await githubText("rigs/default.mhskel"));
const infl = influencesFrom(await githubText("rigs/default_weights.mhw"), base.verts.length / 3);
log("base", base.verts.length / 3, "vertices,", base.uvs.length / 2, "uvs,", [...base.groups.get("body")].length, "body faces");

const bones = boneOrder(skel);
const boneIndex = new Map(bones.map((n, i) => [n, i]));
const textures = { skin: {}, hair: {}, brows: {}, lashes: {}, eye: null };
const glbs = {};
const report = {};

for (const [kind, spec] of Object.entries(KINDS)) {
  const ch = await buildCharacter(kind, spec, base, skel, infl);
  const jointsM = ch.joints;
  const boneLocals = bones.map((name) => {
    const b = skel.bones[name];
    const head = jointsM[b.head];
    const parent = b.parent ? jointsM[skel.bones[b.parent].head] : [0, 0, 0];
    return [head[0] - parent[0], head[1] - parent[1], head[2] - parent[2]];
  });
  const glb = glbFor({ kind, bones, boneIndex, boneLocals, parent: bones.map((n) => skel.bones[n].parent), parts: ch.parts });
  glbs[kind] = glb;
  record(`${kind} glb`, glb);
  report[kind] = ch.counts;

  // hair: colour jpeg + alpha png (decoded first: the skin bake needs the alpha)
  const hairSrc = resize(decodePng(await asset(`hair/${spec.hair}/${spec.hair}_diffuse.png`)), TEX.hair, TEX.hair);
  const scalp = scalpMask({
    body: ch.body,
    normals: ch.bodyNormals,
    hair: ch.hairSurface,
    alpha: { w: hairSrc.w, h: hairSrc.h, data: hairSrc.data },
    size: TEX.skin,
    isHead: ch.isHead,
  });
  let covered = 0;
  for (const v of scalp) if (v > 0.5) covered++;
  log(`  scalp under ${spec.hair}: ${covered} texels (${((covered / (TEX.skin * TEX.skin)) * 100).toFixed(2)}% of the skin map) darkened`);
  // skin detail maps: one per family, mean-normalised
  textures.skin[kind] = {};
  for (const [family, path] of Object.entries(spec.skins)) {
    const item = path.split("/")[1];
    licenceOf(item);
    const src = resize(decodePng(await asset(path)), TEX.skin, TEX.skin);
    const { img, mean } = meanNormalise(src, (x, y) => ch.refMask[y * TEX.skin + x] === 1, SKIN_LEVEL);
    darkenScalp(img, scalp, spec.scalpFloor);
    textures.skin[kind][family] = uri(record(`${kind} skin ${family} jpg`, encodeJpeg(img, 86)), "image/jpeg");
    log(`  skin ${kind}/${family}: source mean RGB ${mean.map((v) => v.toFixed(0)).join(",")}`);
  }
  const hairAlpha = encodeAlphaPng(hairSrc);
  tintHair(hairSrc, spec.hairColour);
  bleedColour(hairSrc, 8);
  textures.hair[kind] = {
    map: uri(record(`${kind} hair colour jpg`, encodeJpeg(opaque(hairSrc), 84)), "image/jpeg"),
    alpha: uri(record(`${kind} hair alpha png`, hairAlpha), "image/png"),
  };
  // brows and lashes are black strokes on alpha: only the alpha is kept (the game colours the strokes)
  const browSrc = resize(decodePng(await asset(`eyebrows/${spec.brows}/${spec.brows}.png`)), TEX.brows, TEX.brows);
  textures.brows[kind] = uri(record(`${kind} brows alpha png`, encodeAlphaPng(browSrc)), "image/png");
  const lashSrc = resize(decodePng(await asset(`eyelashes/${spec.lashes}/${spec.lashes}.png`)), TEX.lashes, TEX.lashes);
  textures.lashes[kind] = uri(record(`${kind} lashes alpha png`, encodeAlphaPng(lashSrc)), "image/png");
}
{
  licenceOf("brown");
  const eye = resize(decodePng(await asset("eyes/materials/brown_eye.png")), TEX.eye, TEX.eye);
  textures.eye = uri(record("eye jpg", encodeJpeg(opaque(eye), 90)), "image/jpeg");
  await asset(EYE.material);
}

mkdirSync(dirname(outFile), { recursive: true });
const banner = `// Generated by scripts/build-surfers.mjs from MakeHuman CC0 assets (see ASSETS.md). Do not edit.\n`;
writeFileSync(
  outFile,
  `${banner}export const maleB64 = ${JSON.stringify(glbs.male.toString("base64"))};\nexport const femaleB64 = ${JSON.stringify(glbs.female.toString("base64"))};\nexport const textures = ${JSON.stringify(textures)};\n`,
);

console.log("\ntriangles per mesh");
for (const kind of Object.keys(report)) console.log(`  ${kind}: ${Object.entries(report[kind]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
for (const kind of Object.keys(report)) {
  const r = report[kind];
  const head = r.body + r.eyes + r.brows + r.lashes + r.teeth + r.hair;
  const outfits = Object.entries(r).filter(([k]) => !["body", "eyes", "brows", "lashes", "teeth", "hair"].includes(k));
  const worst = r.trunks || r.rash + r.bikiniBottom; // the most any one outfit shows: trunks, or the rashguard set
  console.log(`  ${kind}: body+face+hair ${head}; all outfit meshes together ${outfits.reduce((a, [, v]) => a + v, 0)}; worst visible loadout (trunks or rashguard set) ${head + worst}; every mesh in the file ${Object.values(r).reduce((a, v) => a + v, 0)}`);
}
console.log("\nbytes");
for (const [label, n] of sizes) console.log(`  ${label.padEnd(24)} ${n}`);
console.log("fetched assets:");
for (const u of used) console.log(`  ${u.file}`);
console.log("wrote", outFile, `(${(Buffer.byteLength(JSON.stringify(textures)) / 1e6).toFixed(2)} MB of texture data URIs)`);
