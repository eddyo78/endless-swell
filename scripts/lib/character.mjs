// Body shaping from the MakeHuman macro targets, skin weights and skeleton (all CC0, from the GitHub repo).
import { githubText } from "./remote.mjs";

// Every target file carries the header "This asset was explicitly released as CC0 in september 2020"; one without it is refused.
async function targetText(rel) {
  const src = await githubText(rel);
  if (!/explicitly released as CC0/.test(src)) throw new Error(`${rel} does not carry the CC0 header; refusing to use it`);
  return src;
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

export function applyTarget(verts, target, weight) {
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

export async function loadMacro(gender, muscle, weight, race) {
  const mw = muscleWeight(muscle);
  const fw = fatWeight(weight);
  const jobs = [];
  for (const muscleName of ["maxmuscle", "averagemuscle", "minmuscle"]) {
    for (const weightName of ["minweight", "averageweight", "maxweight"]) {
      const w = mw[muscleName] * fw[weightName];
      if (w < 1e-4) continue;
      jobs.push([`targets/macrodetails/universal-${gender}-young-${muscleName}-${weightName}.target`, w]);
    }
  }
  for (const [raceName, rw] of Object.entries(race)) {
    if (rw < 1e-4) continue;
    jobs.push([`targets/macrodetails/${raceName}-${gender}-young.target`, rw]);
  }
  return Promise.all(jobs.map(async ([rel, w]) => [parseTarget(await targetText(rel)), w]));
}

// Region targets: [[path under targets/ without .target, weight], ...]. Paths may contain "{s}", which expands to the
// left and right files ("l-" and "r-"), e.g. "armslegs/{s}-upperarm-muscle-incr".
export async function loadRegions(list) {
  const jobs = [];
  for (const [path, w] of list) {
    if (w < 1e-4) continue;
    if (path.includes("{s}")) {
      const dir = path.slice(0, path.lastIndexOf("/") + 1);
      const name = path.slice(dir.length);
      for (const side of ["l", "r"]) jobs.push([`${dir}${name.replace("{s}", side)}`, w]);
    } else {
      jobs.push([path, w]);
    }
  }
  return Promise.all(jobs.map(async ([rel, w]) => [parseTarget(await targetText(`targets/${rel}.target`)), w, rel]));
}

// The shaped base mesh, decimeters: macro targets (gender, age, muscle, weight, ancestry) then the region targets.
export async function shapeBody(kind, spec, race, baseVerts) {
  const vertsDm = Float64Array.from(baseVerts);
  for (const [target, w] of await loadMacro(kind, spec.muscle, spec.weight, race)) applyTarget(vertsDm, target, w);
  for (const [target, w] of await loadRegions(spec.targets || [])) applyTarget(vertsDm, target, w);
  return vertsDm;
}

export function influencesFrom(weightJson, vertCount) {
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

export function jointMap(skel, verts) {
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

// Weighted blend of base-vertex influences for a fitted proxy vertex.
export function blendInfluence(infl, v, w) {
  const m = new Map();
  for (let k = 0; k < 3; k++) {
    if (!w[k]) continue;
    for (const [bone, bw] of infl[v[k]]) m.set(bone, (m.get(bone) || 0) + bw * w[k]);
  }
  const list = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  let sum = 0;
  for (const e of list) sum += e[1];
  return list.map(([bone, bw]) => [bone, bw / sum]);
}
