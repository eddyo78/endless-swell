// The Locker's pictures: a live studio preview of the surfer and a thumbnail on every item card.
//
// Everything is drawn with the game's own renderer (one WebGL context: a second one would copy every texture) into render
// targets this module creates when the Locker opens and disposes when it closes:
//   - the preview: the active body wearing the loadout on its board, standing on a turntable under a neutral studio light
//     (a key, a fill and a rim light, a grey room for the reflections, linear tone mapping (no toe: dark saturated cloth keeps its colour)), drawn into the stage
//     rectangle of the page. It turns slowly; a drag turns it by hand.
//   - the thumbnails: 2x2 supersampled, rendered one at a time into a small target, read back, downscaled into a 160 px
//     canvas and cached (module level, least recently used, bounded). A board is shown from above; an outfit is the garment
//     on the body seen from behind and cropped to the garment; a body is a bust, three-quarter from the front.
//     Cards ask for their picture only when they scroll into view (IntersectionObserver), and at most a few milliseconds of
//     rendering run per frame.
// The surfer is shared with the game: opening the Locker moves its holder into the studio scene and closing puts it back,
// pose, transforms and dressing exactly as they were (see snapshotSurfer / restoreSurfer), and disposes the studio.
import * as THREE from "three";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GARMENTS, applyPose } from "./surfer.js";
import { defaultBottom, isBody } from "./save.js";
import { dropPrintsExcept, printCacheKeys } from "./printart.js";
import { itemFlag, lockerFine, lockerListHTML, lockerShellHTML, lockerSkinHTML } from "./ui.js";

export const THUMB_PX = 160; // stored picture, square
const THUMB_SUPER = 2; // rendered at this multiple, then downscaled
const THUMB_CACHE_MAX = 96; // pictures kept; 96 x 160 x 160 x 4 bytes = 9.8 MB
const THUMB_BUDGET_MS = 10; // rendering time per frame after the first picture of the frame
const BG_EDGE = "#071219"; // the page colour round the stage; the stage backdrop fades into it
const PREVIEW_WEIGHTS = { crouch: 0.14, glide: 0.86, claim: 0, wipe: 0 }; // the same relaxed stand the menu shows

// Pictures survive closing and reopening the Locker (they are plain 2D canvases, no GPU memory). Key: what the picture shows.
const thumbCache = new Map();
export const thumbStats = { rendered: 0, hits: 0, evicted: 0, renderMs: 0, maxMs: 0 };
export function thumbCacheBytes() {
  return thumbCache.size * THUMB_PX * THUMB_PX * 4;
}
export function thumbCacheSize() {
  return thumbCache.size;
}

function thumbKey(item, skin) {
  if (item.shape) return `board|${item.id}`;
  return `${isBody(item.id) ? "body" : "outfit"}|${item.id}|${skin.toLowerCase()}`;
}

function cachePut(key, canvas) {
  thumbCache.delete(key);
  thumbCache.set(key, canvas);
  while (thumbCache.size > THUMB_CACHE_MAX) {
    thumbCache.delete(thumbCache.keys().next().value);
    thumbStats.evicted++;
  }
}

function cacheGet(key) {
  const hit = thumbCache.get(key);
  if (hit) {
    thumbCache.delete(key); // re-insert: Map order is least recently used first
    thumbCache.set(key, hit);
  }
  return hit || null;
}

// ---- the surfer as the game left it ---------------------------------------------------------------------------------------

function snapshotSurfer(surfer) {
  const bones = [];
  for (const rig of [surfer.male, surfer.female]) {
    for (const bone of Object.values(rig.bones)) bones.push([bone, bone.position.clone(), bone.quaternion.clone(), bone.scale.clone()]);
  }
  return {
    parent: surfer.holder.parent,
    position: surfer.holder.position.clone(),
    quaternion: surfer.holder.quaternion.clone(),
    scale: surfer.holder.scale.clone(),
    bodyRotation: surfer.body.rotation.clone(),
    bodyVisible: surfer.body.visible,
    boardVisible: surfer.board.visible,
    yawRotation: surfer.yaw.rotation.clone(),
    states: [surfer.male, surfer.female].map((rig) => ({ ...rig.state })),
    bones,
  };
}

function restoreSurfer(surfer, snap) {
  snap.parent.add(surfer.holder);
  surfer.holder.position.copy(snap.position);
  surfer.holder.quaternion.copy(snap.quaternion);
  surfer.holder.scale.copy(snap.scale);
  surfer.body.rotation.copy(snap.bodyRotation);
  surfer.body.visible = snap.bodyVisible;
  surfer.board.visible = snap.boardVisible;
  surfer.yaw.rotation.copy(snap.yawRotation);
  [surfer.male, surfer.female].forEach((rig, i) => Object.assign(rig.state, snap.states[i]));
  for (const [bone, p, q, s] of snap.bones) {
    bone.position.copy(p);
    bone.quaternion.copy(q);
    bone.scale.copy(s);
  }
  surfer.holder.updateMatrixWorld(true);
}

// ---- the studio -------------------------------------------------------------------------------------------------------

function radialTexture(size, stops) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size * 0.46, 0, size / 2, size / 2, size * 0.72);
  for (const [at, colour] of stops) g.addColorStop(at, colour);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function blobTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.55, "rgba(0,0,0,0.25)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function buildStudio(renderer) {
  const scene = new THREE.Scene();
  const turntable = new THREE.Group();
  scene.add(turntable);

  const key = new THREE.DirectionalLight(0xfff3e6, 2.7);
  key.position.set(-2.4, 3.4, 3.2);
  const fill = new THREE.DirectionalLight(0xe2ecff, 0.9);
  fill.position.set(3.2, 1.4, 2.6);
  const rim = new THREE.DirectionalLight(0xffffff, 1.9);
  rim.position.set(1.8, 2.8, -3.6);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x58616a, 0.5);
  scene.add(key, fill, rim, hemi);

  const room = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(room, 0.04); // a render target: disposing only its texture would leak the framebuffer
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.5;
  pmrem.dispose();
  room.dispose();

  // the floor of the turntable: a disc and a soft contact shadow under the board (placed once the surfer is posed)
  const stage = new THREE.Group();
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 0.03, 64),
    new THREE.MeshStandardMaterial({ color: 0x10171c, roughness: 0.85, metalness: 0.1 }),
  );
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }),
  );
  stage.add(plate, blob);
  turntable.add(stage);

  const stageBg = radialTexture(256, [[0, "#34444f"], [0.5, "#1a2832"], [1, BG_EDGE]]);
  const thumbBg = radialTexture(64, [[0, "#3c4c58"], [1, "#1a252e"]]);
  scene.background = stageBg;
  return { scene, turntable, stage, plate, blob, stageBg, thumbBg, envTarget };
}

function disposeStudio(studio) {
  studio.scene.traverse((obj) => {
    if (obj === studio.scene) return;
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (obj.material.map) obj.material.map.dispose();
      obj.material.dispose();
    }
  });
  studio.stageBg.dispose();
  studio.thumbBg.dispose();
  studio.envTarget.dispose();
}

// ---- the Locker ---------------------------------------------------------------------------------------------------------

/**
 * Open the Locker in `panels`. ctx: { world, save, byId, panels, equip(id) -> boolean (wear an owned item and save), skin(hex) (set the
 * loadout skin and save), back() }.
 * Returns the view; the caller calls view.frame() instead of the world's render while it is open and view.close() to leave.
 */
export function openLockerView(ctx) {
  const t0 = performance.now();
  const { world, save, byId, panels } = ctx;
  const renderer = world.renderer;
  const surfer = world.surfer;

  panels.innerHTML = lockerShellHTML();
  panels.style.display = "block";
  const stageEl = panels.querySelector("#lk-view");
  const listEl = panels.querySelector("#lk-list");
  const badgeEl = panels.querySelector("#lk-badge");
  const fineEl = panels.querySelector("#lk-fine");
  const skinEl = panels.querySelector("#lk-skin");
  const backEl = panels.querySelector("#locker-back");

  // what to put back
  const snap = snapshotSurfer(surfer);
  const printKeys = printCacheKeys();
  const rendererState = {
    toneMapping: renderer.toneMapping,
    exposure: renderer.toneMappingExposure,
    clearColor: renderer.getClearColor(new THREE.Color()).clone(),
    clearAlpha: renderer.getClearAlpha(),
  };

  const studio = buildStudio(renderer);
  surfer.studio = true; // skin and cloth gains fitted to the neutral studio light (restored in close)
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.toneMappingExposure = 1;
  const outputPass = new OutputPass();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.05, 60);
  const thumbCamera = new THREE.PerspectiveCamera(24, 1, 0.05, 60);
  studio.turntable.add(surfer.holder);
  // the game left the holder on the wave (placed and turned by the ride): stand it upright at the middle of the turntable
  surfer.holder.position.set(0, 0, 0);
  surfer.holder.quaternion.identity();
  surfer.holder.scale.set(1, 1, 1);

  let stageRT = null;
  let thumbHdr = null;
  let thumbOut = null;
  let readback = null;
  let readCanvas = null;
  let closed = false;
  let ready = false; // the studio's shaders are compiled (off the main thread); until then the stage shows the page colour
  let sel = null; // the id on the preview that is not equipped (a locked item), or an owned item just picked
  let previewLoadout = { ...save.loadout };
  let previewDirty = true;
  let spin = { yaw: 0.6, auto: true, resumeAt: 0, speed: 0.5 };
  let framing = null; // the standing surfer's extent (see measureFraming)
  let framingKey = null;
  let lastFit = null; // where the top of the head, the plate and its sides fall on screen (NDC) in the last stage frame
  let last = performance.now();
  const queue = [];
  const queued = new Set();
  let observer = null;
  const stats = {
    openMs: 0,
    firstFrameMs: null,
    firstFrameCost: null,
    drainedMs: null,
    compileMs: null,
    stageFrames: 0,
    thumbsRendered: 0,
    thumbRenderMs: 0,
    thumbMaxMs: 0,
    cardsBuilt: 0,
    cacheHitsAtBuild: 0,
  };

  // -- dressing ------------------------------------------------------------------------------------------------------------
  function loadoutWith(id) {
    const item = byId[id];
    if (!item) throw new Error(`locker: "${id}" is not an item`);
    const l = { ...save.loadout };
    if (isBody(id)) {
      l.body = id;
      l.bottom = defaultBottom(id);
    } else if (item.shape) {
      l.board = id;
    } else {
      l.bottom = id;
    }
    return l;
  }

  function poseStage() {
    studio.turntable.rotation.y = spin.yaw;
    surfer.body.visible = true;
    surfer.board.visible = true;
    studio.stage.visible = true;
    studio.scene.updateMatrixWorld(true);
    applyPose(surfer, PREVIEW_WEIGHTS, 0, { snap: true, dt: 1 / 60 });
    surfer.holder.updateMatrixWorld(true);
    const key = `${previewLoadout.body}|${surfer.shape}`;
    if (framingKey !== key) {
      measureFraming();
      framingKey = key;
    }
    placePlate();
  }

  function dressPreview() {
    surfer.apply(previewLoadout, byId);
    poseStage();
    previewDirty = false;
    paintBadge();
  }

  // The standing surfer's size, from the real skinned vertices, with the turntable at 0: the lowest and highest points, the
  // highest point's distance from the axis, and the widest reach from the axis. Measured again when the body or the board shape
  // changes (the hair of one body and the fins of one board differ from the next).
  const _v = new THREE.Vector3();
  function measureFraming() {
    studio.turntable.rotation.y = 0;
    studio.scene.updateMatrixWorld(true);
    let minY = Infinity;
    let maxY = -Infinity;
    let topR = 0;
    let reach = 0;
    surfer.holder.traverse((obj) => {
      if (!obj.isMesh || !obj.visible) return;
      let up = obj.parent;
      while (up && up !== surfer.holder) {
        if (!up.visible) return;
        up = up.parent;
      }
      const count = obj.geometry.attributes.position.count;
      for (let i = 0; i < count; i++) {
        if (obj.isSkinnedMesh) obj.getVertexPosition(i, _v);
        else _v.fromBufferAttribute(obj.geometry.attributes.position, i);
        _v.applyMatrix4(obj.matrixWorld);
        const r = Math.hypot(_v.x, _v.z);
        if (_v.y < minY) minY = _v.y;
        if (_v.y > maxY) {
          maxY = _v.y;
          topR = r;
        }
        if (r > reach) reach = r;
      }
    });
    studio.turntable.rotation.y = spin.yaw;
    framing = { centreY: (minY + maxY) / 2, halfHeight: (maxY - minY) / 2, topY: maxY, topR, radius: reach, floorY: minY };
  }

  // The plate sits clearly below the lowest fin of the board on show.
  function placePlate() {
    studio.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(surfer.board);
    const r = framing.radius + 0.12;
    studio.plate.scale.set(r, 1, r);
    studio.plate.position.y = box.min.y - 0.03 - 0.015; // top face 3 cm under the fin tips
    studio.blob.scale.set(framing.radius * 1.5, 1, framing.radius * 0.9);
    studio.blob.rotation.y = Math.PI / 2; // long axis along the board
    studio.blob.position.y = box.min.y - 0.03 - 0.0015;
    studio.blob.renderOrder = 1;
    framing.plateY = box.min.y - 0.03;
    framing.plateR = r;
  }

  function paintBadge() {
    const l = previewLoadout;
    const outfit = byId[l.bottom];
    const board = byId[l.board];
    const trying = sel && !save.owned.includes(sel);
    badgeEl.className = trying ? "lk-badge trying" : "lk-badge";
    badgeEl.replaceChildren();
    const line = (cls, text) => {
      const span = document.createElement("span");
      span.className = cls;
      span.textContent = text;
      badgeEl.appendChild(span);
    };
    if (trying) {
      const item = byId[sel];
      line("l1", `Trying on · ${item.name}`);
      line("l2", `LOCKED · ${itemFlag(item, false)} · preview only, not equipped`);
    } else {
      line("l1", `Wearing · ${outfit.name}`);
      line("l2", board.name);
    }
  }

  // -- the list ------------------------------------------------------------------------------------------------------------
  function paintCard(canvas, picture) {
    const ctx2 = canvas.getContext("2d");
    ctx2.drawImage(picture, 0, 0, canvas.width, canvas.height);
    canvas.dataset.pic = "1";
  }

  function request(card) {
    const id = card.dataset.equip;
    const item = byId[id];
    const canvas = card.querySelector("canvas");
    if (!item || !canvas || canvas.dataset.pic) return;
    const key = thumbKey(item, save.loadout.skin);
    const hit = cacheGet(key);
    if (hit) {
      thumbStats.hits++;
      paintCard(canvas, hit);
      return;
    }
    if (queued.has(key)) return;
    queued.add(key);
    queue.push({ key, item });
  }

  function buildList() {
    const scroll = listEl.scrollTop;
    if (observer) observer.disconnect();
    listEl.innerHTML = lockerListHTML(save, sel);
    skinEl.innerHTML = lockerSkinHTML(save);
    fineEl.textContent = lockerFine(save);
    listEl.scrollTop = scroll;
    const cards = [...listEl.querySelectorAll(".item")];
    stats.cardsBuilt = cards.length;
    // a card whose picture is cached is painted now; the rest wait until they are scrolled into view
    for (const card of cards) {
      const item = byId[card.dataset.equip];
      const hit = item && thumbCache.get(thumbKey(item, save.loadout.skin));
      if (hit) {
        cacheGet(thumbKey(item, save.loadout.skin));
        paintCard(card.querySelector("canvas"), hit);
        stats.cacheHitsAtBuild++;
      }
    }
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) request(entry.target);
      },
      { root: listEl, rootMargin: "120px 0px" },
    );
    for (const card of cards) observer.observe(card);
  }

  function onListClick(e) {
    const card = e.target.closest("[data-equip]");
    if (!card) return;
    pick(card.dataset.equip);
  }

  // Select a card. An owned item is worn (ctx.equip saves it) and the preview shows the saved loadout; a locked item only
  // goes on the preview, marked locked, and is never equipped.
  function pick(id) {
    const item = byId[id];
    if (!item) throw new Error(`locker: "${id}" is not an item`);
    if (save.owned.includes(id)) {
      ctx.equip(id);
      sel = null;
      previewLoadout = { ...save.loadout };
    } else {
      sel = id;
      previewLoadout = loadoutWith(id);
    }
    previewDirty = true;
    buildList();
  }

  // -- the stage ------------------------------------------------------------------------------------------------------------
  const drag = { id: null, x: 0 };
  function onDown(e) {
    drag.id = e.pointerId;
    drag.x = e.clientX;
    spin.auto = false;
    stageEl.setPointerCapture(e.pointerId);
    stageEl.classList.add("grab");
  }
  function onMove(e) {
    if (e.pointerId !== drag.id) return;
    spin.yaw += (e.clientX - drag.x) * 0.012;
    drag.x = e.clientX;
  }
  function onUp(e) {
    if (e.pointerId !== drag.id) return;
    drag.id = null;
    spin.resumeAt = performance.now() + 1800;
    stageEl.classList.remove("grab");
  }
  stageEl.addEventListener("pointerdown", onDown);
  stageEl.addEventListener("pointermove", onMove);
  stageEl.addEventListener("pointerup", onUp);
  stageEl.addEventListener("pointercancel", onUp);
  listEl.addEventListener("click", onListClick);
  // a skin swatch: saved like the menu's picker; the preview and every picture that shows skin follow at once
  const onSkin = (e) => {
    const swatch = e.target.closest("[data-skin]");
    if (!swatch) return;
    ctx.skin(swatch.dataset.skin);
    previewLoadout.skin = save.loadout.skin;
    previewDirty = true;
    buildList();
  };
  skinEl.addEventListener("click", onSkin);
  const onBack = () => ctx.back();
  backEl.addEventListener("click", onBack);

  function renderStage() {
    const rect = stageEl.getBoundingClientRect();
    const size = renderer.getSize(new THREE.Vector2());
    // the whole canvas is the page colour; the stage draws on top inside its rectangle
    renderer.setRenderTarget(null);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.x, size.y);
    renderer.setClearColor(BG_EDGE, 1);
    renderer.clear();
    if (!ready || rect.width < 8 || rect.height < 8 || !framing) return;
    const pr = renderer.getPixelRatio();
    const w = Math.max(2, Math.round(rect.width * pr));
    const h = Math.max(2, Math.round(rect.height * pr));
    if (!stageRT) stageRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    else if (stageRT.width !== w || stageRT.height !== h) stageRT.setSize(w, h);
    const aspect = rect.width / rect.height;
    camera.aspect = aspect;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // Fit by projecting the real extremes: the top of the head at its nearest turn, the near edge of the plate and its two sides.
    // Start from the pinhole estimate and back off until the head has 6% of the frame above it and everything is inside.
    const elev = 0.16;
    const lookY = framing.centreY - framing.halfHeight * 0.04;
    const pts = [
      new THREE.Vector3(0, framing.topY, framing.topR), // head, turned toward the camera
      new THREE.Vector3(0, framing.plateY, framing.plateR), // near edge of the plate
      new THREE.Vector3(framing.plateR, framing.plateY, 0),
      new THREE.Vector3(-framing.plateR, framing.plateY, 0),
    ];
    let dist = Math.max((framing.halfHeight * 1.1) / tanHalf, ((framing.plateR * 1.04) / (tanHalf * aspect)));
    camera.updateProjectionMatrix();
    for (let i = 0; i < 40; i++) {
      camera.position.set(0, lookY + Math.sin(elev) * dist, Math.cos(elev) * dist);
      camera.lookAt(0, lookY, 0);
      camera.updateMatrixWorld(true);
      const ndc = pts.map((p) => p.clone().project(camera));
      lastFit = { dist, top: ndc[0].y, bottom: ndc[1].y, side: Math.max(Math.abs(ndc[2].x), Math.abs(ndc[3].x)) };
      if (lastFit.top <= 0.88 && lastFit.bottom >= -0.97 && lastFit.side <= 0.97) break;
      dist *= 1.03;
    }
    studio.scene.background = studio.stageBg;
    renderer.setRenderTarget(stageRT);
    renderer.render(studio.scene, camera);
    renderer.setRenderTarget(null);
    renderer.setScissorTest(true);
    renderer.setViewport(rect.left, size.y - rect.bottom, rect.width, rect.height);
    renderer.setScissor(rect.left, size.y - rect.bottom, rect.width, rect.height);
    outputPass.renderToScreen = true;
    outputPass.render(renderer, null, stageRT);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.x, size.y);
    stats.stageFrames++;
  }

  // -- thumbnails -----------------------------------------------------------------------------------------------------------
  const GARMENT_MESHES = {
    trunks: ["trunks"],
    bikini: ["bikiniBottom", "bikiniTop"],
    rashset: ["bikiniBottom", "rash"],
    fullsuit: ["fullsuit"],
    springsuit: ["springsuit"],
  };

  function ensureThumbTargets() {
    if (thumbHdr) return;
    const S = THUMB_PX * THUMB_SUPER;
    thumbHdr = new THREE.WebGLRenderTarget(S, S, { type: THREE.HalfFloatType, samples: 4 });
    thumbOut = new THREE.WebGLRenderTarget(S, S, { type: THREE.UnsignedByteType });
    readback = new Uint8Array(S * S * 4);
    readCanvas = document.createElement("canvas");
    readCanvas.width = readCanvas.height = S;
  }

  // The body standing straight in the bind pose (arms as the generator made them), turned to `yaw`; the board hidden unless asked.
  function bindPose(yaw, showBoard) {
    const rig = surfer.active;
    for (const bone of Object.values(rig.bones)) bone.quaternion.identity();
    rig.bones.root.position.copy(rig.restRoot);
    surfer.body.rotation.set(0, 0, 0);
    surfer.body.visible = true;
    surfer.board.visible = showBoard;
    surfer.yaw.rotation.set(0, yaw, 0);
    studio.turntable.rotation.y = 0;
    studio.stage.visible = false;
    studio.scene.updateMatrixWorld(true);
  }

  function frameOutfit(style, yaw) {
    const rig = surfer.active;
    const box = new THREE.Box3();
    const part = new THREE.Box3();
    for (const name of GARMENT_MESHES[style]) {
      const mesh = rig.meshes[name];
      mesh.computeBoundingBox();
      part.copy(mesh.boundingBox).applyMatrix4(mesh.matrixWorld);
      box.union(part);
    }
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    return { centre: c, size: Math.max(s.y, Math.max(s.x, s.z) * 1.05) * 1.3, yaw };
  }

  function drawThumb(job) {
    const { item } = job;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(thumbCamera.fov / 2));
    let centre;
    let size;
    if (item.shape) {
      surfer.apply({ ...save.loadout, board: item.id }, byId);
      surfer.body.visible = false;
      surfer.board.visible = true;
      surfer.body.rotation.set(0, 0, 0);
      surfer.holder.position.set(0, 0, 0);
      surfer.holder.quaternion.identity();
      studio.turntable.rotation.y = 0;
      studio.stage.visible = false;
      studio.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(surfer.board);
      centre = box.getCenter(new THREE.Vector3());
      size = Math.max(box.max.z - box.min.z, box.max.x - box.min.x) * 1.1;
      const dist = size / 2 / tanHalf;
      // from above, nose up the picture, tilted back a little so the rocker shows
      thumbCamera.up.set(0, 0, -1);
      thumbCamera.position.set(centre.x, centre.y + dist * Math.cos(0.3), centre.z + dist * Math.sin(0.3));
    } else if (isBody(item.id)) {
      surfer.apply({ ...save.loadout, body: item.id, bottom: defaultBottom(item.id) }, byId);
      bindPose(0.5, false);
      const head = surfer.active.bones.head.getWorldPosition(new THREE.Vector3());
      centre = new THREE.Vector3(head.x, head.y - 0.06, head.z);
      size = 0.72;
      const dist = size / 2 / tanHalf;
      thumbCamera.up.set(0, 1, 0);
      thumbCamera.position.set(centre.x, centre.y + 0.03, centre.z + dist);
    } else {
      surfer.apply({ ...save.loadout, bottom: item.id }, byId);
      bindPose(Math.PI + 0.42, false);
      const f = frameOutfit(item.style, Math.PI + 0.42);
      centre = f.centre;
      size = f.size;
      const dist = size / 2 / tanHalf + 0.15;
      thumbCamera.up.set(0, 1, 0);
      thumbCamera.position.set(centre.x, centre.y + size * 0.06, centre.z + dist);
    }
    thumbCamera.lookAt(centre);
    thumbCamera.updateProjectionMatrix();
    studio.scene.background = studio.thumbBg;
    const S = THUMB_PX * THUMB_SUPER;
    renderer.setRenderTarget(thumbHdr);
    renderer.render(studio.scene, thumbCamera);
    outputPass.renderToScreen = false;
    outputPass.render(renderer, thumbOut, thumbHdr);
    renderer.readRenderTargetPixels(thumbOut, 0, 0, S, S, readback);
    renderer.setRenderTarget(null);
    readCanvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(readback.buffer.slice(0)), S, S), 0, 0);
    const out = document.createElement("canvas");
    out.width = out.height = THUMB_PX;
    const c2 = out.getContext("2d");
    c2.imageSmoothingEnabled = true;
    c2.imageSmoothingQuality = "high";
    c2.translate(0, THUMB_PX);
    c2.scale(1, -1); // read-back rows run bottom to top
    c2.drawImage(readCanvas, 0, 0, THUMB_PX, THUMB_PX);
    return out;
  }

  function runThumbs() {
    ensureThumbTargets();
    const start = performance.now();
    let n = 0;
    while (queue.length && (n === 0 || performance.now() - start < THUMB_BUDGET_MS)) {
      const job = queue.shift();
      const t = performance.now();
      const picture = drawThumb(job);
      const ms = performance.now() - t;
      queued.delete(job.key);
      cachePut(job.key, picture);
      thumbStats.rendered++;
      thumbStats.renderMs += ms;
      thumbStats.maxMs = Math.max(thumbStats.maxMs, ms);
      stats.thumbsRendered++;
      stats.thumbRenderMs += ms;
      stats.thumbMaxMs = Math.max(stats.thumbMaxMs, ms);
      for (const card of listEl.querySelectorAll(".item")) {
        if (card.dataset.equip === job.item.id) paintCard(card.querySelector("canvas"), picture);
      }
      n++;
    }
    previewDirty = true; // the surfer was dressed for the pictures: put the preview back on it
    if (!queue.length) stats.drainedMs = performance.now() - t0;
  }

  // -- one frame ------------------------------------------------------------------------------------------------------------
  function frame() {
    if (closed) throw new Error("locker: frame() after close()");
    const started = performance.now();
    const dt = Math.min(0.1, (started - last) / 1000);
    last = started;
    if (!spin.auto && drag.id === null && started >= spin.resumeAt && spin.resumeAt > 0) spin.auto = true;
    if (spin.auto) spin.yaw += dt * spin.speed;
    if (!ready) {
      renderStage(); // clears the canvas; the studio itself waits for its shaders
      return;
    }
    if (queue.length) runThumbs();
    if (previewDirty) dressPreview();
    studio.turntable.rotation.y = spin.yaw;
    studio.scene.updateMatrixWorld(true);
    renderStage();
    if (stats.firstFrameMs === null) {
      stats.firstFrameMs = performance.now() - t0;
      stats.firstFrameCost = performance.now() - started;
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    stageEl.removeEventListener("pointerdown", onDown);
    stageEl.removeEventListener("pointermove", onMove);
    stageEl.removeEventListener("pointerup", onUp);
    stageEl.removeEventListener("pointercancel", onUp);
    listEl.removeEventListener("click", onListClick);
    skinEl.removeEventListener("click", onSkin);
    backEl.removeEventListener("click", onBack);
    if (observer) observer.disconnect();
    observer = null;
    queue.length = 0;
    queued.clear();
    // the surfer first: back to the game's scene and dressing, then drop the masks the pictures drew
    restoreSurfer(surfer, snap);
    surfer.studio = false;
    surfer.apply(save.loadout, byId);
    const onShow = new Set([surfer.materials.boardMat.map]);
    for (const rig of [surfer.male, surfer.female]) for (const name of GARMENTS[rig.kind]) onShow.add(rig.meshes[name].material.map);
    dropPrintsExcept(printKeys, onShow);
    // then the studio
    disposeStudio(studio);
    outputPass.dispose();
    if (stageRT) stageRT.dispose();
    if (thumbHdr) thumbHdr.dispose();
    if (thumbOut) thumbOut.dispose();
    stageRT = thumbHdr = thumbOut = readback = readCanvas = null;
    renderer.toneMapping = rendererState.toneMapping;
    renderer.toneMappingExposure = rendererState.exposure;
    renderer.setClearColor(rendererState.clearColor, rendererState.clearAlpha);
    renderer.setRenderTarget(null);
    renderer.setScissorTest(false);
    const size = renderer.getSize(new THREE.Vector2());
    renderer.setViewport(0, 0, size.x, size.y);
    panels.innerHTML = "";
  }

  buildList();
  dressPreview();
  // Compile every program the studio needs without blocking the page (KHR_parallel_shader_compile where the browser has it):
  // the first open on a cold shader cache took about 3 s of frozen page when the first frame compiled them synchronously.
  ensureThumbTargets();
  renderer.setRenderTarget(thumbHdr);
  const compiling = renderer.compileAsync(studio.scene, camera);
  renderer.setRenderTarget(null);
  compiling.then(() => {
    if (closed) return;
    stats.compileMs = performance.now() - t0;
    ready = true;
    stageEl.classList.add("ready");
  });
  stats.openMs = performance.now() - t0;

  return {
    frame,
    close,
    pick,
    /** Rebuild the cards after the save changed under the Locker (a skin, a grant). */
    rebuild() {
      previewLoadout = { ...save.loadout };
      sel = null;
      previewDirty = true;
      buildList();
    },
    get closed() {
      return closed;
    },
    get ready() {
      return ready;
    },
    get pending() {
      return queue.length;
    },
    stats,
    /** Test hook: turn the turntable to this angle (radians) and stop it spinning. */
    turn(yaw) {
      spin.yaw = yaw;
      spin.auto = false;
      spin.resumeAt = 0;
    },
    state() {
      return {
        selected: sel,
        previewLoadout: { ...previewLoadout },
        trying: !!(sel && !save.owned.includes(sel)),
        badge: badgeEl.innerText,
        framing,
        fit: lastFit,
        stageRect: stageEl.getBoundingClientRect().toJSON(),
        stageTarget: stageRT ? { w: stageRT.width, h: stageRT.height } : null,
        thumbTarget: thumbHdr ? { w: thumbHdr.width, h: thumbHdr.height } : null,
      };
    },
  };
}
