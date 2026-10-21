import * as THREE from "three";

const D = Math.PI / 180;

const POSES = {
  crouch: {
    hipsY: 0.55, hips: [18, -15, 0], spine: [30, 0, 0], chest: [12, 6, 0], neck: [-24, 0, 0], head: [-20, 10, 0],
    thL: [-78, 0, 30], snL: [105, 0, 0], ftL: [-25, 0, -20], thR: [-66, 0, -26], snR: [110, 0, 0], ftR: [-42, 0, 18],
    uaL: [-58, 0, 70], faL: [-10, 0, 12], hdL: [0, 0, 0], uaR: [30, 0, -42], faR: [-55, 0, 0], hdR: [0, 0, 0],
  },
  glide: {
    hipsY: 0.72, hips: [12, -12, 0], spine: [22, 0, 0], chest: [8, 6, 0], neck: [-16, 0, 0], head: [-12, 10, 0],
    thL: [-50, 0, 30], snL: [70, 0, 0], ftL: [-20, 0, -20], thR: [-45, 0, -26], snR: [78, 0, 0], ftR: [-33, 0, 18],
    uaL: [-35, 0, 62], faL: [-15, 0, 10], hdL: [0, 0, 0], uaR: [20, 0, -38], faR: [-40, 0, 0], hdR: [0, 0, 0],
  },
  claim: {
    hipsY: 0.88, hips: [2, 0, 0], spine: [5, 14, 0], chest: [-4, 8, -4], neck: [-8, 6, 0], head: [-14, 14, 0],
    thL: [-25, 0, 22], snL: [40, 0, 0], ftL: [-15, 0, -16], thR: [-22, 0, -20], snR: [45, 0, 0], ftR: [-22, 0, 14],
    uaL: [-15, 0, 50], faL: [-10, 0, 8], hdL: [0, 0, 0], uaR: [0, 0, -168], faR: [-12, 0, 0], hdR: [0, 0, 0],
  },
  wipe: {
    hipsY: 0.5, hips: [60, 30, 40], spine: [20, 0, 30], chest: [10, 0, 0], neck: [10, 0, 0], head: [0, 0, 0],
    thL: [-90, 0, 50], snL: [40, 0, 0], ftL: [0, 0, 0], thR: [-20, 0, -60], snR: [80, 0, 0], ftR: [0, 0, 0],
    uaL: [-120, 0, 90], faL: [-30, 0, 0], hdL: [0, 0, 0], uaR: [-150, 0, -100], faR: [-30, 0, 0], hdR: [0, 0, 0],
  },
};

const POSE_KEYS = Object.keys(POSES.crouch).filter((k) => k !== "hipsY");

function pivot(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

function limb(length, radiusFar, radiusJoint, material, part) {
  const geo = new THREE.CylinderGeometry(radiusJoint, radiusFar, length, 10, 4);
  geo.translate(0, -length / 2, 0);
  const attr = geo.attributes.position;
  for (let i = 0; i < attr.count; i++) {
    const ny = -attr.getY(i) / length;
    const k = 1 + 0.18 * Math.sin(Math.PI * Math.min(1, ny * 1.15));
    attr.setX(i, attr.getX(i) * k);
    attr.setZ(i, attr.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.userData.part = part;
  const capA = new THREE.Mesh(new THREE.SphereGeometry(radiusJoint * 1.02, 8, 6), material);
  capA.userData.part = part;
  mesh.add(capA);
  const capB = new THREE.Mesh(new THREE.SphereGeometry(radiusFar * 1.02, 8, 6), material);
  capB.userData.part = part;
  capB.position.y = -length;
  mesh.add(capB);
  return mesh;
}

function tag(mesh, part) {
  mesh.userData.part = part;
  return mesh;
}

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

export function createSurfer() {
  const skin = new THREE.MeshPhysicalMaterial({ color: 0x6e3a22, roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.5, sheen: 0.3, sheenColor: new THREE.Color("#6a3d28") });
  const cloth = new THREE.MeshStandardMaterial({ color: 0xb0141a, roughness: 0.62, vertexColors: true });
  const hair = new THREE.MeshStandardMaterial({ color: 0x0c0807, roughness: 0.8 });
  const suit = new THREE.MeshStandardMaterial({ color: 0x1b3f73, roughness: 0.45, vertexColors: true });
  const rash = new THREE.MeshStandardMaterial({ color: 0xf3f6f8, roughness: 0.55, vertexColors: true });
  const bikiniMat = new THREE.MeshStandardMaterial({ color: 0x14b8b0, roughness: 0.5, vertexColors: true });
  const boardMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.3, vertexColors: true,
  });

  const root = new THREE.Group();
  const J = {};
  J.hips = pivot(root, 0, 0.95, 0);
  const hipMesh = tag(new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), skin), "hips");
  hipMesh.scale.set(1.12, 0.85, 0.82);
  J.hips.add(hipMesh);

  J.spine = pivot(J.hips, 0, 0.06, 0);
  const spineMesh = tag(new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 12), skin), "torso");
  spineMesh.scale.set(1.1, 1.25, 0.85);
  spineMesh.position.y = 0.14;
  J.spine.add(spineMesh);

  J.chest = pivot(J.spine, 0, 0.26, 0);
  const chestMesh = tag(new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), skin), "torso");
  chestMesh.scale.set(1.35, 1.08, 0.8);
  chestMesh.position.y = 0.1;
  J.chest.add(chestMesh);

  const chestSide = [];
  for (const s of [-1, 1]) {
    const pec = tag(new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), skin), "torso");
    pec.scale.set(1.15, 1.6, 0.85);
    pec.position.set(0.13 * s, 0.07, -0.05);
    J.chest.add(pec);
    chestSide.push(pec);
    const trap = tag(new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), skin), "torso");
    trap.position.set(0.215 * s, 0.22, 0);
    J.chest.add(trap);
  }
  const collar = tag(new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), skin), "torso");
  collar.scale.set(1.5, 0.6, 0.8);
  collar.position.set(0, 0.25, -0.02);
  J.chest.add(collar);

  const breasts = new THREE.Group();
  for (const s of [-1, 1]) {
    const b = tag(new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), skin), "torso");
    b.scale.set(1, 0.9, 1.15);
    b.position.set(0.075 * s, 0.12, 0.1);
    breasts.add(b);
  }
  breasts.visible = false;
  J.chest.add(breasts);

  J.neck = pivot(J.chest, 0, 0.3, 0);
  const neckMesh = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.12, 8), skin), "skin");
  neckMesh.position.y = 0.04;
  J.neck.add(neckMesh);
  J.head = pivot(J.neck, 0, 0.1, 0.01);
  const head = tag(new THREE.Mesh(new THREE.SphereGeometry(0.105, 16, 12), skin), "head");
  head.scale.set(0.92, 1.12, 1.02);
  head.position.y = 0.09;
  J.head.add(head);
  const hairMesh = tag(new THREE.Mesh(new THREE.SphereGeometry(0.108, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair), "hair");
  hairMesh.scale.set(0.95, 1.1, 1.05);
  hairMesh.position.set(0, 0.105, -0.008);
  hairMesh.rotation.x = -0.25;
  J.head.add(hairMesh);

  const shorts = [];
  for (const [name, sign] of [["L", 1], ["R", -1]]) {
    J["sh" + name] = pivot(J.chest, 0.22 * sign, 0.21, 0);
    J["ua" + name] = pivot(J["sh" + name], 0, 0, 0);
    J["ua" + name].add(limb(0.29, 0.068, 0.052, skin, "arm"));
    J["fa" + name] = pivot(J["ua" + name], 0, -0.29, 0);
    J["fa" + name].add(limb(0.26, 0.054, 0.038, skin, "arm"));
    J["hd" + name] = pivot(J["fa" + name], 0, -0.26, 0);
    const hand = tag(new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), skin), "hand");
    hand.scale.set(0.6, 1.5, 1);
    hand.position.y = -0.06;
    J["hd" + name].add(hand);

    J["th" + name] = pivot(J.hips, 0.095 * sign, -0.03, 0);
    J["th" + name].add(limb(0.44, 0.1, 0.065, skin, "leg"));
    const short = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.104, 0.096, 0.26, 12), cloth), "shorts");
    short.position.y = -0.11;
    J["th" + name].add(short);
    shorts.push(short);
    J["sn" + name] = pivot(J["th" + name], 0, -0.44, 0);
    J["sn" + name].add(limb(0.44, 0.066, 0.042, skin, "leg"));
    J["ft" + name] = pivot(J["sn" + name], 0, -0.44, 0);
    const foot = tag(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.25), skin), "foot");
    foot.position.set(0, -0.025, 0.07);
    J["ft" + name].add(foot);
  }

  const bikiniTop = new THREE.Group();
  for (const s of [-1, 1]) {
    const cup = tag(new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), bikiniMat), "bikini");
    cup.scale.set(1.1, 0.85, 0.7);
    cup.position.set(0.07 * s, 0.16, 0.12);
    bikiniTop.add(cup);
  }
  bikiniTop.visible = false;
  J.chest.add(bikiniTop);

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

  const yaw = new THREE.Group();
  yaw.rotation.y = Math.PI / 2 + 0.6;
  yaw.add(root);
  root.position.set(0, 0.03, 0.05);
  const body = new THREE.Group();
  body.add(yaw);
  const holder = new THREE.Group();
  holder.add(board, body);

  function partMeshes() {
    const all = [];
    holder.traverse((o) => {
      if (o.isMesh && o.userData.part) all.push(o);
    });
    return all;
  }

  function apply(loadout, byId) {
    const female = loadout.body === "female";
    skin.color.set(loadout.skin || "#6e3a22");
    skin.sheenColor.set(loadout.skin || "#6e3a22");
    hipMesh.scale.set(female ? 1.34 : 1.12, female ? 0.78 : 0.85, female ? 1.05 : 0.82);
    chestMesh.scale.set(female ? 1.12 : 1.35, female ? 1.02 : 1.08, female ? 0.72 : 0.8);
    J.shL.position.x = female ? 0.18 : 0.22;
    J.shR.position.x = female ? -0.18 : -0.22;
    holder.scale.setScalar(female ? 1.0 : 1.06);

    const bottom = byId[loadout.bottom];
    const top = loadout.top ? byId[loadout.top] : null;
    const onesie = bottom && bottom.style === "onesie";
    breasts.visible = female && !onesie;
    const bikini = bottom && bottom.style === "bikini";
    const rashOn = !onesie && top && top.style === "rash";

    const clothItem = bottom;
    cloth.color.set("#ffffff");
    suit.color.set("#ffffff");
    rash.color.set("#ffffff");
    bikiniMat.color.set("#ffffff");
    const c1 = clothItem?.color || "#c41622";
    const c2 = clothItem?.color2 || c1;
    const pat = clothItem?.pattern || "solid";
    for (const m of shorts) {
      m.material = onesie ? suit : bikini ? bikiniMat : cloth;
      m.visible = true;
      m.scale.set(1, bikini ? 0.48 : 1, 1);
      m.position.y = bikini ? -0.05 : -0.11;
      const g = m.geometry;
      paintGeometry(g, pat, c1, c2);
    }
    if (bikini) {
      paintGeometry(bikiniTop.children[0].geometry, pat, c1, c2);
      paintGeometry(bikiniTop.children[1].geometry, pat, c1, c2);
      bikiniMat.color.set("#ffffff");
    }
    bikiniTop.visible = bikini && !onesie;

    const suitColor = onesie ? c1 : "#1b3f73";
    suit.color.set(suitColor);
    for (const m of partMeshes()) {
      if (onesie && (m.userData.part === "torso" || m.userData.part === "arm" || m.userData.part === "leg" || m.userData.part === "hips" || m.userData.part === "foot")) {
        m.material = suit;
      } else if (m.userData.part === "torso" || m.userData.part === "arm" || m.userData.part === "leg" || m.userData.part === "hips" || m.userData.part === "foot" || m.userData.part === "skin") {
        if (m.userData.part !== "shorts" && m.userData.part !== "bikini") m.material = skin;
      }
    }
    if (rashOn) {
      rash.color.set("#ffffff");
      const rc1 = top.color;
      const rc2 = top.color2 || rc1;
      for (const m of partMeshes()) {
        if (m.userData.part === "torso") {
          m.material = rash;
          paintGeometry(m.geometry, top.pattern || "solid", rc1, rc2);
        }
      }
    }
    breasts.children?.forEach?.(() => {});
    if (!onesie) {
      breasts.traverse((o) => {
        if (o.isMesh) o.material = skin;
      });
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
  }

  return { holder, board, body, yaw, joints: J, apply, materials: { skin, cloth, suit, rash, bikiniMat, boardMat } };
}

export function applyPose(surfer, weights, time) {
  const J = surfer.joints;
  let hipsY = 0;
  for (const [name, w] of Object.entries(weights)) hipsY += POSES[name].hipsY * w;
  J.hips.position.y = hipsY + Math.sin(time * 2.1) * 0.01;
  for (const key of POSE_KEYS) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (const [name, w] of Object.entries(weights)) {
      const e = POSES[name][key];
      x += e[0] * w;
      y += e[1] * w;
      z += e[2] * w;
    }
    if (key === "uaL") {
      z += Math.sin(time * 1.7) * 4;
      x += Math.sin(time * 1.1) * 5;
    }
    if (key === "uaR") x += Math.sin(time * 1.3 + 1) * 4;
    if (key === "spine") y += Math.sin(time * 0.9) * 3;
    J[key].rotation.set(x * D, y * D, z * D, "YXZ");
  }
}
