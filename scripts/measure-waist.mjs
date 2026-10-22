// Waist profile of the female body: width (side to side), front depth and back depth measured from the spine line, at several
// heights, as fractions of height; plus the waist circumference (ellipse of width and depth, as in lib/measure.mjs).
//   node scripts/measure-waist.mjs              original | slimmed (first slimming, 2026-10-21) | now (the shape in bodyspec.mjs)
// "original" is the female shape of milestone 3: none of the waist targets. "slimmed" is measure-waist-circ-decr 0.8 + stomach-tone-incr 0.7.
// The spine line is the spine joints' z (the rig's joints, spine01..spine05 + root), linearly interpolated at the band's height.
import { shapeBody, influencesFrom, jointMap } from "./lib/character.mjs";
import { RACE, SHAPES } from "./lib/bodyspec.mjs";
import { githubText } from "./lib/remote.mjs";
import { parseObj } from "./lib/mh.mjs";

const base = parseObj(await githubText("3dobjs/base.obj"));
const skel = JSON.parse(await githubText("rigs/default.mhskel"));
const infl = influencesFrom(await githubText("rigs/default_weights.mhw"), base.verts.length / 3);
const ARM = /^(clavicle|shoulder|upperarm|lowerarm|wrist|metacarpal|finger)/;

const used = new Set();
for (const face of base.groups.get("body")) for (const [v] of face) used.add(v);
const ids = [...used].filter((v) => infl[v].reduce((a, [b, w]) => a + (ARM.test(b) ? w : 0), 0) < 0.5);

function ellipse(width, depth) {
  const a = width / 2;
  const b = depth / 2;
  const h = ((a - b) * (a - b)) / ((a + b) * (a + b));
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

export const FRACTIONS = [0.52, 0.54, 0.56, 0.58, 0.6, 0.62];

export function profile(vertsDm) {
  const verts = vertsDm.map((v) => v * 0.1);
  const joints = jointMap(skel, verts);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of used) {
    minY = Math.min(minY, verts[v * 3 + 1]);
    maxY = Math.max(maxY, verts[v * 3 + 1]);
  }
  const height = maxY - minY;
  const spine = ["root", "spine05", "spine04", "spine03", "spine02", "spine01"]
    .map((n) => joints[`${n}____head`])
    .sort((a, b) => a[1] - b[1]);
  const spineZ = (y) => {
    for (let i = 0; i + 1 < spine.length; i++) if (y >= spine[i][1] && y <= spine[i + 1][1]) {
      const t = (y - spine[i][1]) / (spine[i + 1][1] - spine[i][1]);
      return spine[i][2] + t * (spine[i + 1][2] - spine[i][2]);
    }
    throw new Error(`no spine segment at y ${y}`);
  };
  const out = {};
  for (const f of FRACTIONS) {
    const y = minY + f * height;
    let xlo = Infinity, xhi = -Infinity, zlo = Infinity, zhi = -Infinity;
    for (const v of ids) {
      const vy = verts[v * 3 + 1];
      if (Math.abs(vy - y) > 0.012) continue;
      xlo = Math.min(xlo, verts[v * 3]);
      xhi = Math.max(xhi, verts[v * 3]);
      zlo = Math.min(zlo, verts[v * 3 + 2]);
      zhi = Math.max(zhi, verts[v * 3 + 2]);
    }
    const sz = spineZ(y);
    out[f] = { width: (xhi - xlo) / height, front: (zhi - sz) / height, back: (sz - zlo) / height, circ: ellipse(xhi - xlo, zhi - zlo) / height };
  }
  return out;
}

const WAIST_TARGETS = ["measure/measure-waist-circ-decr", "stomach/stomach-tone-incr", "stomach/stomach-pregnant-decr", "torso/torso-scale-horiz-decr"];
const withoutWaist = (t) => t.filter(([p]) => !WAIST_TARGETS.includes(p));
const cur = SHAPES.female;
export const VARIANTS = {
  original: { ...cur, targets: withoutWaist(cur.targets) },
  slimmed: { ...cur, targets: [...withoutWaist(cur.targets), ["measure/measure-waist-circ-decr", 0.8], ["stomach/stomach-tone-incr", 0.7]] },
  now: cur,
};

function show(label, p) {
  console.log(`\n${label}   (fractions of height)`);
  console.log("  height  width  front  back   circ");
  for (const f of FRACTIONS) console.log(`  ${f.toFixed(2)}   ${p[f].width.toFixed(4)} ${p[f].front.toFixed(4)} ${p[f].back.toFixed(4)} ${p[f].circ.toFixed(4)}`);
}

if (process.argv[1].endsWith("measure-waist.mjs")) {
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
  const res = {};
  for (const [name, spec] of Object.entries(VARIANTS)) {
    if (only && name !== only) continue;
    res[name] = profile(await shapeBody("female", spec, RACE, base.verts));
    show(name, res[name]);
  }
}
