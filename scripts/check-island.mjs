// Checks on the backdrop island (src/island.js), in Node: the height function is deterministic and finite, the crest is
// jagged and varied in height, the shore exists with a rock band and white-water shelf, the palms stand on land and the
// mesh budget holds. Prints the numbers it checks.   node scripts/check-island.mjs
import { ISLAND, crestAt, palmSites, shorelineZ, terrainHeight } from "../src/island.js";

let failed = 0;
const ok = (cond, text) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${text}`);
  if (!cond) failed++;
};

// deterministic and finite
const probe = [[0, 0], [1234.5, -987.6], [-3000, 500], [3500, -2800]];
const a = probe.map(([x, z]) => terrainHeight(x, z));
const b = probe.map(([x, z]) => terrainHeight(x, z));
ok(a.every((v, i) => Number.isFinite(v) && v === b[i]), `terrainHeight is finite and repeatable (${a.map((v) => v.toFixed(1)).join(", ")})`);

// silhouette from the camera: the island group sits 2400 m ahead, the camera 3 m above the sea. Elevation angle of the
// highest point at every x, as the camera sees it.
const camY = 3;
const sil = [];
for (let x = -3600; x <= 3000; x += 15) {
  let best = -90;
  for (let z = ISLAND.zFront; z > ISLAND.zBack; z -= 20) {
    const d = 2400 - z;
    if (d < 300) continue;
    const ang = (Math.atan2(terrainHeight(x, z) - camY, d) * 180) / Math.PI;
    if (ang > best) best = ang;
  }
  sil.push(best);
}
const maxAng = Math.max(...sil);
const minAng = Math.min(...sil.slice(20, sil.length - 20));
ok(maxAng > 10 && maxAng < 22, `highest summit seen at ${maxAng.toFixed(1)} degrees above the horizon (want 10 to 22)`);
ok(minAng < maxAng * 0.7, `crest varies in height: lowest saddle ${minAng.toFixed(1)} degrees against the summit ${maxAng.toFixed(1)}`);
// jaggedness: count slope sign changes of the silhouette (summits and saddles) and the steepest edge
let turns = 0;
let steep = 0;
for (let i = 2; i < sil.length; i++) {
  const d0 = sil[i - 1] - sil[i - 2];
  const d1 = sil[i] - sil[i - 1];
  if (d0 * d1 < 0 && Math.abs(d0) + Math.abs(d1) > 0.05) turns++;
  steep = Math.max(steep, Math.abs(d1));
}
ok(turns >= 14, `silhouette has ${turns} summits and saddles over the visible 6.6 km (want at least 14)`);
ok(steep > 0.35, `steepest ridge flank changes ${steep.toFixed(2)} degrees per 15 m (a jagged edge; want > 0.35)`);

// shore: sea level at the shoreline, foam shelf under 12 m, dark rock band up to about 70 m, mountain behind
const x0 = 0;
const zs = shorelineZ(x0);
ok(Math.abs(terrainHeight(x0, zs)) < 0.5, `height at the shoreline is ${terrainHeight(x0, zs).toFixed(2)} m (about 0)`);
ok(terrainHeight(x0, zs + 60) < -0.5, `60 m offshore the ground is under the sea (${terrainHeight(x0, zs + 60).toFixed(1)} m)`);
ok(terrainHeight(x0, zs - 100) > 8 && terrainHeight(x0, zs - 100) < 20, `100 m inland the shelf is ${terrainHeight(x0, zs - 100).toFixed(1)} m (foam band)`);
ok(terrainHeight(x0, zs - 380) > 55 && terrainHeight(x0, zs - 380) < 200, `380 m inland the rock band reaches ${terrainHeight(x0, zs - 380).toFixed(1)} m`);

// the sea cuts every edge: no land at the ends or the back
const edges = [terrainHeight(-ISLAND.halfWidth, 0), terrainHeight(ISLAND.halfWidth, 0), terrainHeight(0, ISLAND.zBack), terrainHeight(2000, ISLAND.zBack + 10)];
ok(edges.every((v) => v < -5), `edges are under the sea (${edges.map((v) => v.toFixed(0)).join(", ")} m)`);

// crest data
const crests = [];
for (let x = -3000; x <= 3000; x += 100) crests.push(crestAt(x).height);
ok(Math.max(...crests) < 1100 && Math.min(...crests) > 90, `crest heights ${Math.min(...crests).toFixed(0)} to ${Math.max(...crests).toFixed(0)} m`);

// palms
const palms = palmSites();
ok(palms.length >= 50 && palms.length <= 200, `${palms.length} palms (want 50 to 200)`);
ok(palms.every(([, y]) => y > 19), "every palm stands on land above the foam shelf");
const xs = palms.map((p) => p[0]);
ok(Math.max(...xs) - Math.min(...xs) > 4000, `palms spread over ${(Math.max(...xs) - Math.min(...xs)).toFixed(0)} m of shore`);

// mesh budget
const tris = ISLAND.columns * ISLAND.rows * 2;
ok(tris <= 40000, `terrain is ${tris} triangles (budget 40000)`);

if (failed) {
  console.log(`island checks FAILED (${failed})`);
  process.exit(1);
}
console.log("island checks passed");
