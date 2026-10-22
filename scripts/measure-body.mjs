// Prints the body proportions (scripts/lib/measure.mjs) of the milestone 2 shapes and of the shapes build-surfers.mjs uses
// now, so a change can be judged by numbers.   node scripts/measure-body.mjs [--only male|female]
import { shapeBody, influencesFrom, jointMap } from "./lib/character.mjs";
import { BASELINE, RACE, SHAPES } from "./lib/bodyspec.mjs";
import { formatMeasure, measureBody } from "./lib/measure.mjs";
import { githubText } from "./lib/remote.mjs";
import { parseObj } from "./lib/mh.mjs";

const argv = process.argv.slice(2);
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
const base = parseObj(await githubText("3dobjs/base.obj"));
const skel = JSON.parse(await githubText("rigs/default.mhskel"));
const infl = influencesFrom(await githubText("rigs/default_weights.mhw"), base.verts.length / 3);

export async function measureSpec(kind, spec) {
  const dm = await shapeBody(kind, spec, RACE, base.verts);
  const verts = dm.map((v) => v * 0.1);
  const joints = jointMap(skel, verts);
  return measureBody({ verts, bodyFaces: base.groups.get("body"), joints, infl });
}

const table = {};
for (const kind of ["male", "female"]) {
  if (only && only !== kind) continue;
  for (const [label, specs] of [["milestone 2", BASELINE], ["now", SHAPES]]) {
    const m = await measureSpec(kind, specs[kind]);
    table[`${kind} ${label}`] = m;
    console.log(`\n${kind}, ${label}`);
    for (const line of formatMeasure(m)) console.log("  " + line);
  }
}
