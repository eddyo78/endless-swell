import { createWorld } from "./scene.js";
import { createRide, resetRide, updateRide, syncWorld, autopilot, cameraAirGap, stressCamera } from "./ride.js";
import {
  advanceBracket,
  bestTwo,
  createBracket,
  generateTour,
  judgeWave,
  mulberry32,
  placeFromRound,
  playerHeat,
  recordHeat,
  rivalWave,
} from "./competition.js";
import { catalog, grantReward, loadSave, owns, writeSave } from "./save.js";
import { bindPanel, briefHTML, freeEndHTML, heatResultHTML, lockerHTML, menuHTML, mountUI, tourEndHTML } from "./ui.js";

const canvas = document.getElementById("c");
const world = await createWorld(canvas);
const ride = createRide();
const ui = mountUI();
const save = loadSave();
const byId = Object.fromEntries([...catalog.bodies, ...catalog.outfits, ...catalog.boards].map((item) => [item.id, item]));

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
  special: null,
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

function harmonizeOutfit() {
  const bottom = byId[save.loadout.bottom];
  if (!bottom) return;
  if (save.loadout.body === "female" && bottom.style === "trunks" && owns(save, "bikini-teal")) {
    save.loadout.bottom = "bikini-teal";
    save.loadout.top = null;
  }
  if (save.loadout.body === "male" && bottom.style === "bikini") save.loadout.bottom = "trunks-red";
}

function applyLookout() {
  world.surfer.apply(save.loadout, byId);
  world.applyLook(app.cond.look || "day");
}

function show(html) {
  ui.panels.innerHTML = html || "";
  ui.panels.style.display = html ? "block" : "none";
  if (!html) return;
  bindPanel(ui.panels, {
    free: () => startFree(),
    tour: () => openBrief(save.nextTour),
    locker: () => openLocker(),
    menu: () => enterMenu(),
    skin: (color) => {
      save.loadout.skin = color;
      persist();
      world.surfer.apply(save.loadout, byId);
      openLockerOrMenu();
    },
    body: (id) => {
      if (id !== "male" && id !== "female") return;
      save.loadout.body = id;
      harmonizeOutfit();
      persist();
      world.surfer.apply(save.loadout, byId);
      enterMenu();
    },
    equip: (id) => {
      const item = byId[id];
      if (!item || !owns(save, id)) return;
      if (item.id === "male" || item.id === "female") {
        save.loadout.body = item.id;
        harmonizeOutfit();
      } else if (item.style === "rash") save.loadout.top = item.id;
      else if (item.shape) save.loadout.board = item.id;
      else {
        save.loadout.bottom = item.id;
        if (item.style === "onesie" || item.style === "bikini") save.loadout.top = null;
        if (item.style === "bikini") save.loadout.body = "female";
        if (item.style === "trunks") save.loadout.body = "male";
      }
      persist();
      world.surfer.apply(save.loadout, byId);
      openLocker();
    },
    clearTop: () => {
      save.loadout.top = null;
      persist();
      world.surfer.apply(save.loadout, byId);
      openLocker();
    },
    begin: () => beginHeat(),
    next: () => continueTour(),
    done: () => showTourEnd(),
  });
}

function openLockerOrMenu() {
  if (ui.panels.querySelector("#open-locker, #locker-back")) {
    if (ui.panels.querySelector("#locker-back")) openLocker();
    else enterMenu();
  }
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
  show(lockerHTML(save));
}

function openBrief(n) {
  app.tour = generateTour(n);
  app.cond = app.tour;
  app.bracket = createBracket(app.tour);
  world.applyLook(app.tour.look);
  app.mode = "brief";
  resetRide(ride, app.tour, { mode: "menu", dLock: -8, s: 0.48, z: -8 });
  show(briefHTML(app.tour));
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
  if (!app.bracket || !app.tour) openBrief(save.nextTour);
  const meta = playerHeat(app.bracket);
  if (!meta) return;
  const rival = meta.a.isPlayer ? meta.b : meta.a;
  const rand = mulberry32(app.tour.n * 13 + app.bracket.roundIndex * 97);
  app.heat = {
    meta,
    rival,
    rand,
    clock: 0,
    max: 42,
    limit: 3,
    playerWaves: [],
    rivalWaves: [],
    priority: app.tour.n < 3 || rand() < 0.55 ? "player" : "rival",
    window: 0,
    windows: [0, 12, 24],
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
    wave.total = app.tour.special === "priority-strict" ? 0 : Math.round(wave.total * 0.5 * 10) / 10;
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
    const zero = app.tour.special === "priority-strict" || heat.interference >= 2;
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
  app.resultView = {
    won,
    champion: won && round.name === "Final",
    roundName: round.name,
    rivalName: heat.rival.name,
    playerTotal,
    rivalTotal,
    playerWaves: heat.playerWaves,
    rivalWaves: heat.rivalWaves,
    note: won
      ? (round.name === "Final" ? "That's the reef." : `${nextRoundName(round.name)} is next.`)
      : "The heat got away.",
    place: won && round.name === "Final" ? 1 : placeFromRound(round.name, won),
  };
  const movingOn = won && round.name !== "Final";
  if (!movingOn) conclude(app.resultView.place);
  app.mode = "result";
  show(heatResultHTML(app.resultView));
  ui.priority.style.display = "none";
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
  const tourN = app.tour.n;
  const reward = grantReward(save, tourN, place);
  save.results.push({ tour: tourN, place, at: Date.now() });
  if (place === 1) save.nextTour = tourN + 1;
  persist();
  app.resultView.reward = reward;
  app.resultView.place = place;
  app.resultView.tourN = tourN;
}

function showTourEnd() {
  app.mode = "tourend";
  show(tourEndHTML(app.resultView));
}

function tick(dt) {
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
  world.composer.render();
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
  if ((e.code === "Enter" || e.code === "Space") && app.mode === "menu") startFree();
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
    if (id !== "male" && id !== "female") return;
    save.loadout.body = id;
    harmonizeOutfit();
    world.surfer.apply(save.loadout, byId);
    persist();
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
  startFree: () => startFree(),
  rideTour(n) {
    const tour = generateTour(n);
    startFree(tour);
    app.tour = tour;
  },
  startTour(n) { openBrief(n); },
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
  render() { world.composer.render(); },
  airGap: () => cameraAirGap(ride),
  stress: () => stressCamera(world.camera.aspect || 0.56),
  sharks: () => world.sharks.children.filter((c) => c.visible).length,
  mode: () => app.mode,
  tour: () => (app.tour ? app.tour.n : save.nextTour),
  save: () => save,
  heat: () => app.heat && {
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
