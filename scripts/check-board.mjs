// Node check for src/board.js (no browser). Exits non-zero on the first failure.
//   node scripts/check-board.mjs
import * as THREE from "three";
import { BOARD_SHAPES, RINGS, SEGS, boardTriangles, createBoardParts, deckAt, deckNormal } from "../src/board.js";

let failures = 0;
function check(ok, message) {
  if (!ok) {
    failures++;
    console.error(`FAIL ${message}`);
  }
}

function faceNormal(pos, a, b, c, out) {
  const A = new THREE.Vector3().fromBufferAttribute(pos, a);
  const B = new THREE.Vector3().fromBufferAttribute(pos, b);
  const C = new THREE.Vector3().fromBufferAttribute(pos, c);
  return out.copy(B.sub(A)).cross(C.sub(A)).normalize();
}

for (const shape of BOARD_SHAPES) {
  const parts = createBoardParts(shape);
  const pos = parts.hull.attributes.position;
  const nrm = parts.hull.attributes.normal;
  const L = parts.length;

  // 1. hull winding: every non-cap triangle faces away from the board's centreline
  const idx = parts.hull.index.array;
  const hullTris = RINGS * SEGS * 2;
  let inward = 0;
  const n = new THREE.Vector3();
  for (let i = 0; i < hullTris; i++) {
    const a = idx[i * 3];
    const b = idx[i * 3 + 1];
    const c = idx[i * 3 + 2];
    faceNormal(pos, a, b, c, n);
    if (n.lengthSq() < 0.5) continue; // zero-area triangle at the nose or pin tail
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    const ring = Math.floor(a / SEGS);
    const cy = (pos.getY(ring * SEGS) + pos.getY(ring * SEGS + SEGS / 2)) / 2; // mid-section height from the two rail apexes
    const out = new THREE.Vector3(cx, (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3 - cy, 0);
    if (out.lengthSq() < 1e-10) continue;
    if (n.dot(out.normalize()) < -0.05) inward++;
  }
  check(inward === 0, `${shape}: ${inward} hull triangles face inward`);

  // 2. caps face outward along the board axis
  let capBad = 0;
  let capCount = 0;
  const total = parts.hull.index.count / 3;
  for (let i = hullTris; i < total; i++) {
    faceNormal(pos, idx[i * 3], idx[i * 3 + 1], idx[i * 3 + 2], n);
    if (n.lengthSq() < 0.5) continue; // zero-area triangle at a pointed end
    capCount++;
    const z = pos.getZ(idx[i * 3]);
    const expect = z < 0 ? -1 : 1;
    if (n.z * expect < 0.2) capBad++;
  }
  check(capCount > 0 || shape !== "fish", `${shape}: no end caps`); // short and gun end in a point: both caps are zero-area
  check(capBad === 0, `${shape}: ${capBad} of ${capCount} cap triangles face the wrong way`);

  // 3. deckAt agrees with the rendered deck centreline
  let worst = 0;
  for (let i = 3; i <= RINGS - 3; i++) {
    const z = (i / RINGS - 0.5) * L;
    const top = pos.getY(i * SEGS + SEGS / 4);
    const pad = deckAt(shape, 0, z) - top;
    worst = Math.max(worst, Math.abs(pad) < 0.05 ? 0 : 1); // difference is the pad only
    if (z < (0.7 - 0.5) * L) check(Math.abs(pad) < 1e-6, `${shape}: deckAt(0,${z.toFixed(2)}) != hull deck by ${pad}`);
  }
  check(worst === 0, `${shape}: deckAt differs from the hull by more than a pad`);

  // 4. normals: deck centre up, bottom centre down, rails outward
  let badNormals = 0;
  for (let i = 4; i < RINGS - 4; i++) {
    const top = nrm.getY(i * SEGS + SEGS / 4);
    const bot = nrm.getY(i * SEGS + (3 * SEGS) / 4);
    const rail = nrm.getX(i * SEGS);
    const railL = nrm.getX(i * SEGS + SEGS / 2);
    if (top < 0.7 || bot > -0.7 || rail < 0.3 || railL > -0.3) badNormals++;
  }
  check(badNormals === 0, `${shape}: ${badNormals} rings with a wrong-way vertex normal`);

  // 5. nose is at -z: the nose end is the one that is lifted and narrow, fins and plug are at +z
  const noseY = pos.getY(0 * SEGS + SEGS / 4);
  const midY = pos.getY((RINGS / 2) * SEGS + SEGS / 4);
  check(noseY > midY - 0.03, `${shape}: nose is not lifted`);
  for (const f of parts.fins) check(f.position.z > 0.15 * L, `${shape}: fin at z=${f.position.z} is not on the tail half`);
  check(parts.plug.boundingBox === null && (parts.plug.computeBoundingBox(), parts.plug.boundingBox.min.z > 0.3 * L), `${shape}: leash plug is not at the tail`);

  // 6. fins hang below the hull bottom, not through the deck
  for (const f of parts.fins) {
    f.geometry.computeBoundingBox();
    const bb = f.geometry.boundingBox;
    check(f.position.y + bb.min.y < -0.05, `${shape}: fin tip does not hang below the board`);
    check(f.position.y + bb.max.y < deckAt(shape, f.position.x, f.position.z) - 0.005, `${shape}: fin pokes through the deck`);
  }

  // 7. deck normal is near vertical under the stance
  const up = deckNormal(shape, 0, parts.stance.rear);
  check(up.y > 0.95, `${shape}: deck normal at the rear foot is ${up.toArray()}`);

  const tris = boardTriangles(parts);
  console.log(`${shape}: length ${L} m, hull ${total} tris, whole board ${tris} tris, ${parts.fins.length} fins, hull verts ${pos.count}`);
}

if (failures) {
  console.error(`${failures} board check(s) failed`);
  process.exit(1);
}
console.log("board checks passed");
