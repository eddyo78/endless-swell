import { createWorld } from "./scene.js";
import { createRide, resetRide, updateRide, syncWorld, autopilot, cameraAirGap, stressCamera } from "./ride.js";
import {
  advanceBracket,
  bestTwo,
  createBracket,
  generateTour,
  hasTwist,
  judgeWave,
  mulberry32,
  placeFromRound,
  playerHeat,
  recordHeat,
  rivalWave,
} from "./competition.js";
import { catalog, equipItem, grantReward, isBody, itemMap, loadSave, registerGear, settleFinish, switchBody, writeSave } from "./save.js";
import { eventNumber } from "./season.js";
import * as printArt from "./printart.js";
import { CLOTH_CEILING } from "./printmat.js";
import { BOARD_SHAPES, createBoardParts } from "./board.js";
import { bindPanel, briefHTML, freeEndHTML, heatResultHTML, menuHTML, mountUI, tourEndHTML } from "./ui.js";
import { openLockerView, thumbCacheBytes, thumbCacheSize, thumbStats } from "./locker.js";

const canvas = document.getElementById("c");
const world = await createWorld(canvas);
const ride = createRide();
const ui = mountUI();
const save = loadSave();
// Every wearable item by id: the catalog plus the gear this save has won. Refreshed whenever gear is granted.
const byId = itemMap();
function syncItems() {
  Object.assign(byId, itemMap());
}

const showcase = {
  height: 0.96,
  curl: 1.02,
  tight: 0.1,
  peelSpeed: 11.1,
  wind: 0.14,
  windName: "offshore",
  feet: 11,
  tide: "mid",
  look: "day",
  twists: [],
  sharks: [],
  reef: [],
  zones: [],
  boards: [],
  locationId: "teahupoo",
  playedId: "teahupoo",
};

const app = {
  mode: "menu",
  cond: showcase,
  tour: null,
  bracket: null,
  heat: null,
  auto: false,
  forced: null,
  pause: false,
  saveOk: true,
  last: performance.now(),
  acc: 0,
  frames: 0,
  fpsT: 0,
  input: { steer: 0, thr: 0 },
  keys: {},
  pointer: { id: null, x0: 0, y0: 0, dx: 0, dy: 0 },
  gap: 0,
  resultView: null,
};

world.setQuality(save.quality);
applyLookout();
enterMenu();

function persist() {
  app.saveOk = writeSave(save);
}

function applyLookout() {
  world.surfer.apply(save.loadout, byId);
  world.applyLook(app.cond.look || "day");
}

// The Locker view while the Locker is open (src/locker.js): it owns the surfer and the canvas until closeLocker().
let lockerView = null;
function closeLocker() {
  if (!lockerView) return;
  const view = lockerView;
  lockerView = null;
  view.close();
}

// What the screen shows this frame: the game, or the Locker's studio.
function renderFrame() {
  if (lockerView) lockerView.frame();
  else world.composer.render();
}

function show(html) {
  closeLocker();
  ui.panels.innerHTML = html || "";
  ui.panels.style.display = html ? "block" : "none";
  if (!html) return;
  bindPanel(ui.panels, {
    free: () => startFree(),
    tour: () => openBrief(),
    locker: () => openLocker(),
    menu: () => enterMenu(),
    skin: (color) => {
      save.loadout.skin = color;
      persist();
      world.surfer.apply(save.loadout, byId);
      openLockerOrMenu();
    },
    body: (id) => {
      if (!isBody(id)) return;
      switchBody(save, id);
      persist();
      world.surfer.apply(save.loadout, byId);
      enterMenu();
    },
    begin: () => beginHeat(),
    next: () => continueTour(),
    done: () => showTourEnd(),
    heatMenu: () => leaveResult(),
  });
}

function openLockerOrMenu() {
  if (lockerView) lockerView.rebuild();
  else if (ui.panels.querySelector("#open-locker")) enterMenu();
}

function enterMenu() {
  app.mode = "menu";
  app.tour = null;
  app.heat = null;
  app.bracket = null;
  app.cond = showcase;
  world.applyLook("day");
  resetRide(ride, showcase, { mode: "menu", dLock: -6.5, s: 0.52, z: -6.5 });
  world.spray.clear();
  world.wake.clear();
  show(menuHTML(save));
  ui.hud.style.display = "none";
  ui.priority.style.display = "none";
}

function openLocker() {
  app.mode = "menu";
  closeLocker();
  lockerView = openLockerView({
    world,
    save,
    byId,
    panels: ui.panels,
    // wear an owned item: the Locker calls this for a card the save owns; a locked card never reaches it
    equip: (id) => {
      if (!equipItem(save, id)) return false;
      persist();
      return true;
    },
    back: () => enterMenu(),
  });
}

// The event the save is on. A retry (save.attempt > 0) keeps the event and re-draws the bracket and the heat dice.
function openBrief() {
  app.tour = generateTour(eventNumber(save.season, save.event));
  app.cond = app.tour;
  app.bracket = createBracket(app.tour, save.attempt);
  world.applyLook(app.tour.look);
  app.mode = "brief";
  resetRide(ride, app.tour, { mode: "menu", dLock: -8, s: 0.48, z: -8 });
  show(briefHTML(app.tour, save.attempt));
  ui.hud.style.display = "none";
}

function startFree(cond = null) {
  app.tour = null;
  app.heat = null;
  app.bracket = null;
  app.cond = cond || { ...showcase, sharks: [], reef: [], zones: [], boards: [] };
  world.applyLook(app.cond.look || "day");
  app.mode = "ride";
  resetRide(ride, app.cond, { mode: "ride", fade: !cond, maxRide: 30, z: -18, msg: "Paddle in" });
  world.spray.clear();
  world.wake.clear();
  show("");
  ui.hud.style.display = "";
  ui.priority.style.display = "none";
  ui.scoreLabel.textContent = "SCORE";
}

function beginHeat() {
  if (!app.bracket || !app.tour) openBrief();
  const meta = playerHeat(app.bracket);
  if (!meta) return;
  const rival = meta.a.isPlayer ? meta.b : meta.a;
  const rand = mulberry32(app.tour.n * 13 + app.bracket.roundIndex * 97 + app.bracket.attempt * 7001);
  app.heat = {
    meta,
    rival,
    rand,
    clock: 0,
    max: app.tour.heatSeconds,
    limit: app.tour.waveCap,
    playerWaves: [],
    rivalWaves: [],
    priority: app.tour.n < 3 || rand() < 0.55 ? "player" : "rival",
    window: 0,
    windows: heatWindows(app.tour.heatSeconds, app.tour.waveCap),
    taken: null,
    interference: 0,
    playerRiding: false,
    rivalHoldUntil: -1,
    swapAfter: false,
    pendingInterference: false,
  };
  app.cond = app.tour;
  world.applyLook(app.tour.look);
  app.mode = "paddle";
  resetRide(ride, app.tour, { mode: "menu", dLock: -14, s: 0.4, z: -14 });
  world.spray.clear();
  world.wake.clear();
  show("");
  ui.hud.style.display = "";
  ui.priority.style.display = "";
  ui.scoreLabel.textContent = "WAVE";
  ride.msg = "Drop in";
  ride.msgT = 2;
}

// When each wave window opens: 12 s apart in the standard 42 s heat, the same share of the clock in a shorter one.
function heatWindows(seconds, waves) {
  const gap = (seconds * 12) / 42;
  return Array.from({ length: waves }, (_, i) => Math.round(i * gap * 10) / 10);
}

function dropIn() {
  const heat = app.heat;
  if (heat) {
    if (heat.playerWaves.length >= heat.limit) return;
    const rivalOwns = heat.priority === "rival" && (heat.taken === "rival" || !heat.taken);
    heat.pendingInterference = !!rivalOwns;
    heat.swapAfter = !heat.pendingInterference && heat.priority === "player";
    heat.taken = "player";
    heat.playerRiding = true;
    if (heat.pendingInterference) {
      ride.msg = "Interference";
    }
  }
  app.mode = "ride";
  resetRide(ride, app.cond, {
    mode: "ride",
    fade: !app.heat,
    maxRide: app.heat ? 16 : 28,
    z: -16,
    msg: heat && heat.pendingInterference ? "INTERFERENCE" : "Drop in",
  });
  world.spray.clear();
  world.wake.clear();
}

function readHuman() {
  let steer = 0;
  let thr = 0;
  const k = app.keys;
  if (k.ArrowLeft || k.KeyA) steer += 1;
  if (k.ArrowRight || k.KeyD) steer -= 1;
  if (k.ArrowUp || k.KeyW || k.Space) thr += 1;
  if (k.ArrowDown || k.KeyS) thr -= 1;
  if (app.pointer.id !== null) {
    steer += clamp1(-app.pointer.dx);
    thr += clamp1(-app.pointer.dy);
  }
  return { steer: clamp1(steer), thr: clamp1(thr) };
}

function clamp1(v) {
  return Math.max(-1, Math.min(1, v));
}

function currentInput() {
  if (app.forced) return app.forced;
  if (app.auto && (app.mode === "ride" || app.mode === "paddle" || app.mode === "menu")) {
    if (app.mode === "paddle") {
      const heat = app.heat;
      const age = heat.clock - heat.windows[heat.window];
      const drop = heat.priority === "player" || age > 5.2;
      return { steer: 0, thr: drop ? 1 : 0 };
    }
    if (app.mode === "ride" && ride.mode === "ride") return autopilot(ride, app.cond);
  }
  if (app.mode === "ride" || app.mode === "paddle") return readHuman();
  return { steer: 0, thr: 0 };
}

function heatClock(dt) {
  const heat = app.heat;
  if (!heat || app.mode === "brief" || app.mode === "result" || app.mode === "tourend") return;
  heat.clock += dt;
  const start = heat.windows[heat.window] ?? heat.max;
  const age = heat.clock - start;
  if (!heat.taken && heat.rivalWaves.length < heat.limit && age > 1.25 && heat.priority === "rival") {
    takeRival(false);
  }
  if (!heat.taken && app.mode === "paddle" && age > 6.5 && heat.rivalWaves.length < heat.limit) {
    takeRival(true);
  }
  if (app.mode !== "ride" && heat.window < heat.windows.length - 1 && heat.clock > heat.windows[heat.window + 1] - 0.05) {
    heat.window += 1;
    heat.taken = null;
  }
  if (heat.clock >= heat.max && app.mode !== "ride") endHeat();
}

function takeRival(declined) {
  const heat = app.heat;
  const wave = rivalWave(heat.rival.skill, app.tour, heat.rand);
  const stealing = !declined && heat.priority === "player" && heat.playerRiding;
  if (stealing) {
    wave.interference = true;
    wave.total = hasTwist(app.tour, "priority-strict") ? 0 : Math.round(wave.total * 0.5 * 10) / 10;
  }
  if (heat.priority === "rival") heat.priority = "player";
  heat.rivalWaves.push(wave);
  heat.taken = "rival";
  heat.rivalHoldUntil = heat.clock + 8;
}

function onWaveEnded() {
  if (!app.heat) {
    const judged = judgeWave(ride.stats, app.cond);
    if (judged.total > save.best) {
      save.best = judged.total;
      persist();
    }
    app.resultView = { judged };
    app.mode = "freeend";
    show(freeEndHTML(judged, save.best));
    return;
  }
  const heat = app.heat;
  let judged = judgeWave(ride.stats, app.tour);
  if (heat.pendingInterference) {
    heat.interference += 1;
    const zero = hasTwist(app.tour, "priority-strict") || heat.interference >= 2;
    judged = { ...judged, total: zero ? 0 : Math.round(judged.total * 0.5 * 10) / 10, interference: true };
  } else if (heat.swapAfter) heat.priority = "rival";
  heat.playerWaves.push(judged);
  heat.playerRiding = false;
  heat.pendingInterference = false;
  heat.swapAfter = false;
  if (heat.clock >= heat.max || (heat.playerWaves.length >= heat.limit && heat.rivalWaves.length >= 1 && heat.window >= heat.windows.length - 1)) {
    endHeat();
    return;
  }
  app.mode = "gap";
  app.gap = 1.3;
  ride.msg = judged.interference ? `Interference ${judged.total.toFixed(1)}` : judged.total.toFixed(1);
  ride.msgT = 1.3;
}

function endHeat() {
  const heat = app.heat;
  if (!heat || app.mode === "result") return;
  const playerTotal = bestTwo(heat.playerWaves);
  const rivalTotal = bestTwo(heat.rivalWaves);
  const round = app.bracket.rounds[app.bracket.roundIndex];
  const won = recordHeat(heat.meta, playerTotal, rivalTotal);
  const place = won && round.name === "Final" ? 1 : placeFromRound(round.name, won);
  app.resultView = {
    won,
    champion: won && round.name === "Final",
    roundName: round.name,
    rivalName: heat.rival.name,
    playerTotal,
    rivalTotal,
    playerWaves: heat.playerWaves,
    rivalWaves: heat.rivalWaves,
    note: heatNote(round.name, won),
    place,
    // what leaving the screen now keeps: winning the quarterfinal is a sure top 4, winning the semifinal a sure runner-up
    bank: won ? BANKED[round.name] || null : null,
  };
  const movingOn = won && round.name !== "Final";
  if (!movingOn) conclude(place);
  app.mode = "result";
  show(heatResultHTML(app.resultView));
  ui.priority.style.display = "none";
}

const BANKED = { Quarterfinal: 4, Semifinal: 2 };

function heatNote(roundName, won) {
  if (!won) return "The heat got away.";
  if (roundName === "Final") return "That's the reef.";
  if (roundName === "Quarterfinal") return "Top 4 secured: the next event is open whatever happens now. The semifinal is for the title.";
  return `${nextRoundName(roundName)} is next.`;
}

function nextRoundName(name) {
  if (name === "Round of 16") return "Quarterfinal";
  if (name === "Quarterfinal") return "Semifinal";
  if (name === "Semifinal") return "Final";
  return "The next heat";
}

function continueTour() {
  if (!app.bracket || !app.tour || app.mode !== "result") return;
  const adv = advanceBracket(app.bracket, app.tour);
  if (adv.status === "next") beginHeat();
  else showTourEnd();
}

function conclude(place) {
  if (app.bracket.settled) throw new Error("conclude: this event was already settled");
  const settled = settleFinish(save, place);
  app.bracket.settled = true;
  syncItems();
  persist();
  app.resultView = { ...(app.resultView || {}), settled, place, pity: save.pity };
}

// Leaving the heat result with the Menu button. After winning the quarterfinal the top 4 is already earned, so it is banked
// (4th place; 2nd after winning the semifinal) instead of being lost with the unplayed rounds. Any other result is left as is.
function leaveResult() {
  const view = app.resultView;
  if (app.bracket && !app.bracket.settled && view && view.bank) conclude(view.bank);
  enterMenu();
}

function showTourEnd() {
  app.mode = "tourend";
  show(tourEndHTML(app.resultView));
}

function tick(dt) {
  // the Locker has taken the surfer into its studio: the ride must not move it
  if (lockerView) return;
  const input = currentInput();
  app.input = input;
  if (app.mode === "paddle" && input.thr > 0.55) dropIn();
  if (app.heat && (app.mode === "paddle" || app.mode === "ride" || app.mode === "gap")) heatClock(dt);
  if (app.mode === "gap") {
    app.gap -= dt;
    updateRide(ride, dt, { steer: 0, thr: 0 }, app.cond);
    if (app.gap <= 0) {
      app.mode = "paddle";
      resetRide(ride, app.cond, { mode: "menu", dLock: -12, s: 0.4, z: ride.z });
      ride.msg = "Next wave";
      ride.msgT = 1.2;
    }
  } else if (app.mode === "ride") {
    updateRide(ride, dt, input, app.cond);
    if (ride.ended) onWaveEnded();
  } else if (app.mode === "menu" || app.mode === "brief" || app.mode === "paddle") {
    updateRide(ride, dt, input, app.cond);
  }
  syncWorld(world, ride, dt, input, app.cond);
  paintHud();
}

function paintHud() {
  const showHud = app.mode === "ride" || app.mode === "paddle" || app.mode === "gap";
  ui.hud.style.visibility = showHud ? "visible" : "hidden";
  document.getElementById("pocket").style.visibility = showHud ? "visible" : "hidden";
  ui.tube.textContent = ride.tube.toFixed(1) + "s";
  ui.speed.textContent = ride.speed.toFixed(1);
  if (app.heat) {
    ui.score.textContent = ride.stats && ride.mode !== "menu" ? (judgeWave(ride.stats, app.cond).total || 0).toFixed(1) : "–";
    ui.heatScore.textContent = `${bestTwo(app.heat.playerWaves).toFixed(1)}–${bestTwo(app.heat.rivalWaves).toFixed(1)}`;
    ui.heatReadout.style.display = "";
    const left = Math.max(0, app.heat.max - app.heat.clock);
    ui.priority.style.display = "";
    ui.priority.textContent = `Priority ${app.heat.priority === "player" ? "you" : app.heat.rival.name.split(" ")[0]} · ${left.toFixed(0)}s · wave ${Math.min(app.heat.limit, app.heat.playerWaves.length + (app.mode === "ride" ? 1 : 0))}/${app.heat.limit}`;
  } else {
    ui.score.textContent = Math.round(ride.score);
    ui.heatReadout.style.display = "none";
    ui.priority.style.display = "none";
  }
  ui.msg.textContent = ride.msgT > 0 ? ride.msg : "";
  ui.msg.style.opacity = ride.msgT > 0 ? Math.min(1, ride.msgT * 2) : 0;
  const t = Math.max(0, Math.min(1, -ride.d / 28));
  ui.depth.style.left = (t * 100).toFixed(1) + "%";
  ui.depth.className = ride.d > -2.2 ? "danger" : ride.inTube ? "good" : "";
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - app.last) / 1000);
  app.last = now;
  if (!app.pause) {
    app.acc += dt;
    const step = 1 / 60;
    while (app.acc >= step) {
      tick(step);
      app.acc -= step;
    }
  }
  renderFrame();
  app.frames += 1;
  app.fpsT += dt;
  if (app.fpsT > 0.5) {
    ui.fps.textContent = Math.round(app.frames / app.fpsT) + " fps";
    app.frames = 0;
    app.fpsT = 0;
  }
}

ui.qbtn.addEventListener("click", () => {
  save.quality = save.quality === "high" ? "low" : "high";
  world.setQuality(save.quality);
  ui.qbtn.textContent = "Quality: " + save.quality.toUpperCase();
  persist();
});
ui.qbtn.textContent = "Quality: " + save.quality.toUpperCase();
ui.rbtn.addEventListener("click", () => restart());

function restart() {
  if (app.mode === "freeend") startFree();
  else if (app.mode === "ride" && !app.heat) startFree();
  else if (app.heat && (app.mode === "paddle" || app.mode === "ride" || app.mode === "gap")) beginHeat();
}

addEventListener("keydown", (e) => {
  app.keys[e.code] = true;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
  if (e.code === "KeyR") restart();
  if ((e.code === "Enter" || e.code === "Space") && app.mode === "menu" && !lockerView) startFree();
  if ((e.code === "Enter" || e.code === "Space") && app.mode === "brief") beginHeat();
  if ((e.code === "Enter" || e.code === "Space") && app.mode === "paddle") dropIn();
});
addEventListener("keyup", (e) => {
  app.keys[e.code] = false;
});
canvas.addEventListener("pointerdown", (e) => {
  app.pointer.id = e.pointerId;
  app.pointer.x0 = e.clientX;
  app.pointer.y0 = e.clientY;
  app.pointer.dx = app.pointer.dy = 0;
  if (app.mode === "paddle") dropIn();
});
addEventListener("pointermove", (e) => {
  if (e.pointerId !== app.pointer.id) return;
  app.pointer.dx = (e.clientX - app.pointer.x0) / (innerWidth * 0.18);
  app.pointer.dy = (e.clientY - app.pointer.y0) / (innerHeight * 0.18);
});
addEventListener("pointerup", (e) => {
  if (e.pointerId === app.pointer.id) {
    app.pointer.id = null;
    app.pointer.dx = app.pointer.dy = 0;
  }
});
addEventListener("resize", () => world.resize());

window.__surf = {
  ready: false,
  get pause() { return app.pause; },
  set pause(v) { app.pause = v; },
  setAutopilot(v) { app.auto = !!v; if (v) app.forced = null; },
  setInput(steer, thr) { app.auto = false; app.forced = { steer, thr }; },
  setBody(id) {
    if (!isBody(id)) return;
    switchBody(save, id);
    world.surfer.apply(save.loadout, byId);
    persist();
  },
  // Test hook: dress the surfer with exactly this loadout (no ownership rules, not saved). apply() still throws if an
  // item does not belong to the body.
  setLoadout(loadout) {
    Object.assign(save.loadout, loadout);
    world.surfer.apply(save.loadout, byId);
  },
  setSkin(color) {
    save.loadout.skin = color;
    world.surfer.apply(save.loadout, byId);
    persist();
  },
  triggerWipe() {
    ride.mode = "wipe";
    ride.wipe = ride.t;
    if (ride.stats) ride.stats.wipe = true;
  },
  closeCamera(dist = 2.05) {
    const pos = ride.pos;
    const ahead = ride.ahead;
    const normal = ride.normal;
    const lateral = ride.lateral;
    const cam = world.camera;
    cam.position.copy(pos).addScaledVector(ahead, -dist).addScaledVector(normal, 0.95).addScaledVector(lateral, 0.55);
    cam.position.y += 0.35;
    cam.up.set(0, 1, 0).lerp(normal, 0.4).normalize();
    cam.lookAt(pos.clone().addScaledVector(normal, 0.72).addScaledVector(ahead, 0.15));
    world.composer.render();
  },
  // Test hook: three-quarter close-up of the face (a Locker-style portrait), from the open-face side, with a normal lens.
  faceCamera(dist = 1.5, yawDeg = 32, boneName = "head", fov = 30) {
    const cam = world.camera;
    const head = world.surfer.active.bones[boneName];
    const a = cam.position.clone();
    const b = cam.position.clone();
    head.getWorldPosition(a);
    head.getWorldQuaternion(cam.quaternion);
    b.set(0, 0, 1).applyQuaternion(cam.quaternion);
    b.y = 0;
    b.normalize();
    const side = ride.lateral.x >= 0 ? 1 : -1;
    const ang = (yawDeg * Math.PI) / 180 * side;
    const bx = b.x * Math.cos(ang) - b.z * Math.sin(ang);
    const bz = b.x * Math.sin(ang) + b.z * Math.cos(ang);
    if (boneName === "head") a.y += 0.06; // centre on the face, not the skull
    cam.position.set(a.x + bx * dist, a.y + 0.03, a.z + bz * dist);
    cam.up.set(0, 1, 0);
    cam.fov = fov;
    cam.updateProjectionMatrix();
    cam.lookAt(a);
    world.composer.render();
  },
  // Test hook: straight from behind the board at a closer distance than the game camera.
  backCamera(dist = 2.7) {
    const cam = world.camera;
    cam.position.copy(ride.pos).addScaledVector(ride.ahead, -dist).addScaledVector(ride.normal, 1.15);
    cam.up.set(0, 1, 0).lerp(ride.normal, 0.4).normalize();
    cam.fov = 48;
    cam.updateProjectionMatrix();
    cam.lookAt(ride.pos.clone().addScaledVector(ride.normal, 0.85).addScaledVector(ride.ahead, 0.4));
    world.composer.render();
  },
  // Test hook: a studio view of the active body, for proportions and faces. The wave, water, island and props are hidden
  // and the camera orbits the surfer, who stands at the origin in the bind pose (arms as the generator made them), or in
  // the pose the ride left when bind is false. yawDeg 0 looks at the front, 90 at the character's left side, 180 at the
  // back. aim: a bone name to look at (the head, say) instead of the height lookY. Call studioEnd() and start a ride to get
  // the game back (the ride puts the surfer on the wave again).
  studio({ yawDeg = 0, dist = 5, lookY = 1, fov = 26, bind = true, aim = null } = {}) {
    const surfer = world.surfer;
    const rig = surfer.active;
    for (const key of ["wave", "ocean", "island", "clouds", "boats", "sharks", "reef", "debris"]) world[key].visible = false;
    world.spray.points.visible = false;
    world.wake.mesh.visible = false;
    for (const id of ["ui", "pocket"]) document.getElementById(id).style.display = "none";
    surfer.board.visible = !bind;
    surfer.holder.position.set(0, 0, 0);
    surfer.holder.quaternion.identity();
    surfer.body.rotation.set(0, 0, 0);
    if (bind) {
      surfer.yaw.rotation.set(0, 0, 0);
      for (const bone of Object.values(rig.bones)) bone.quaternion.identity();
      rig.bones.root.position.copy(rig.restRoot);
    }
    surfer.holder.updateMatrixWorld(true);
    const look = world.camera.position.clone().set(0, lookY, 0);
    if (aim) {
      rig.bones[aim].getWorldPosition(look);
      if (aim === "head") look.y += 0.06; // centre on the face, not the skull
    }
    const a = (yawDeg * Math.PI) / 180;
    const cam = world.camera;
    cam.position.set(look.x + Math.sin(a) * dist, look.y, look.z + Math.cos(a) * dist);
    cam.up.set(0, 1, 0);
    cam.fov = fov;
    cam.updateProjectionMatrix();
    cam.lookAt(look);
    world.sky.position.copy(cam.position);
    world.composer.render();
  },
  // Undo studio(): show the world again (start a ride afterwards to put the surfer back on the wave).
  studioEnd() {
    for (const key of ["wave", "ocean", "island", "clouds", "boats", "sharks", "reef", "debris"]) world[key].visible = true;
    world.spray.points.visible = true;
    world.wake.mesh.visible = true;
    for (const id of ["ui", "pocket"]) document.getElementById(id).style.display = "";
    world.surfer.board.visible = true;
  },
  // Test hook: cost of one frame as drawn now. Renders `frames` frames through the whole composer, forcing the GPU to finish
  // each one with a 1x1 readPixels, and returns the mean wall time per frame (ms) plus draw calls and triangles per frame
  // summed over every pass (renderer.info is not reset between passes).
  frameStats(frames = 120) {
    const r = world.renderer;
    const gl = r.getContext();
    const px = new Uint8Array(4);
    for (let i = 0; i < 12; i++) world.composer.render();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    r.info.autoReset = false;
    r.info.reset();
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      world.composer.render();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    const ms = (performance.now() - t0) / frames;
    const out = { ms, calls: r.info.render.calls / frames, triangles: r.info.render.triangles / frames, width: r.domElement.width, height: r.domElement.height };
    r.info.autoReset = true;
    r.info.reset();
    return out;
  },
  resize() { world.resize(); },
  startFree: () => startFree(),
  rideTour(n) {
    const tour = generateTour(n);
    startFree(tour);
    app.tour = tour;
  },
  startTour() { openBrief(); },
  menu() { enterMenu(); },
  // Test hook: grant one piece of exactly this tier through the real grantReward() (not saved to storage).
  grantGear(tier, seed = 1) {
    const item = grantReward(save, tier, mulberry32(seed));
    syncItems();
    return item;
  },
  // Test hook: register one earned-gear recipe (src/gear.js) through the real recipeToItem() so a shot or a check can wear any
  // pattern in any palette. Returns the catalog-shaped item; it is not owned, saved or granted.
  addGear(recipe) {
    const item = registerGear(recipe);
    syncItems();
    return item;
  },
  // Test hook (scripts/check-prints.mjs): the print module (mask drawing, texture cache and its counters) and the board builder,
  // and the renderer the game draws with, so a check can draw every pattern and upload every texture in the real page.
  catalogItems: () => ({ outfits: catalog.outfits, boards: catalog.boards }),
  prints: () => ({ ...printArt, BOARD_SHAPES, createBoardParts, renderer: world.renderer, clothCeiling: CLOTH_CEILING, bloomThreshold: world.bloom.threshold }),
  // Test hook: the board alone, from above and behind at this distance (the surfer is hidden). Call boardCameraEnd() after.
  boardCamera(dist = 2.3) {
    const cam = world.camera;
    const holder = world.surfer.holder;
    world.surfer.body.visible = false;
    holder.updateMatrixWorld(true);
    const centre = world.camera.position.clone();
    world.surfer.board.getWorldPosition(centre);
    cam.position.copy(ride.pos).addScaledVector(ride.ahead, -dist * 0.25).addScaledVector(ride.normal, dist);
    cam.up.copy(ride.ahead);
    cam.fov = 40;
    cam.updateProjectionMatrix();
    cam.lookAt(centre.addScaledVector(ride.normal, 0.05));
    world.composer.render();
  },
  boardCameraEnd() {
    world.surfer.body.visible = true;
    world.resize();
  },
  // Test hook: end the current heat now with these two heat totals (the player's and the rival's) through the real endHeat().
  finishHeat(playerTotal, rivalTotal) {
    const heat = app.heat;
    if (!heat) throw new Error("finishHeat: no heat is running");
    heat.playerWaves = playerTotal > 0 ? [{ total: playerTotal, wipe: false, interference: false }] : [];
    heat.rivalWaves = rivalTotal > 0 ? [{ total: rivalTotal, wipe: false, interference: false }] : [];
    app.mode = "gap";
    endHeat();
  },
  // Test hook: settle the current event with this finish as if the bracket had ended there, and show the results screen.
  forceFinish(place) {
    if (!app.tour || !app.bracket) throw new Error("forceFinish: open an event first");
    app.resultView = { won: place <= 4, champion: place === 1, roundName: "Final", rivalName: "", playerTotal: 0, rivalTotal: 0, playerWaves: [], rivalWaves: [], note: "", place, bank: null };
    conclude(place);
    showTourEnd();
  },
  beginHeat,
  advance(sec) {
    const step = 1 / 60;
    let left = sec;
    while (left > 1e-6) {
      const dt = Math.min(step, left);
      tick(dt);
      left -= dt;
    }
  },
  render() { renderFrame(); },
  airGap: () => cameraAirGap(ride),
  stress: () => stressCamera(world.camera.aspect || 0.56),
  sharks: () => world.sharks.children.filter((c) => c.visible).length,
  mode: () => app.mode,
  tour: () => (app.tour ? app.tour.n : eventNumber(save.season, save.event)),
  event: () => ({ season: save.season, event: save.event, attempt: save.attempt }),
  save: () => save,
  heat: () => app.heat && {
    max: app.heat.max,
    limit: app.heat.limit,
    windows: app.heat.windows,
    opponent: app.heat.rival.name,
    clock: app.heat.clock,
    priority: app.heat.priority,
    player: bestTwo(app.heat.playerWaves),
    rival: bestTwo(app.heat.rivalWaves),
    waves: app.heat.playerWaves.map((w) => w.total),
    round: app.bracket.rounds[app.bracket.roundIndex].name,
  },
  bracket: () => app.bracket && ({
    round: app.bracket.rounds[app.bracket.roundIndex].name,
    index: app.bracket.roundIndex,
    rounds: app.bracket.rounds.map((r) => r.name),
  }),
  nearestShark: () => {
    const sharks = app.cond?.sharks || [];
    let best = 1e9;
    for (const shark of sharks) best = Math.min(best, Math.abs(shark.z - ride.z));
    return sharks.length ? best : null;
  },
  state: () => ({
    s: ride.s,
    d: ride.d,
    z: ride.z,
    speed: ride.speed,
    tube: ride.tube,
    inTube: ride.inTube,
    deep: ride.deep,
    spit: ride.spitDone,
    ended: ride.ended,
    mode: ride.mode,
    white: ride.white,
    reason: ride.reason,
    clean: !!ride.stats?.clean,
    wipe: !!ride.stats?.wipe,
  }),
  quality: () => world.quality,
  // Test hook (scripts/check-locker.mjs, shots): the open Locker view (null when closed) and the thumbnail cache's counters.
  locker: () => lockerView,
  lockerPictures: () => ({ count: thumbCacheSize(), bytes: thumbCacheBytes(), ...thumbStats }),
  surfer: () => world.surfer,
  world: () => world,
  meshes() {
    const lines = [];
    world.surfer.holder.traverse((obj) => {
      if (!obj.isMesh) return;
      const color = obj.material?.color?.getHexString?.() || "";
      lines.push(`${obj.name} vis=${obj.visible} ${obj.material?.type || ""} #${color}`);
    });
    return lines;
  },
};

requestAnimationFrame((now) => {
  app.last = now;
  requestAnimationFrame(loop);
  window.__surf.ready = true;
});
