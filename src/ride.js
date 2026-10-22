import * as THREE from "three";
import {
  clamp,
  closestOnSample,
  extraCloseout,
  facePoint,
  faceFrame,
  pushOutOfWater,
  sampleProfile,
  smoothstep,
  tubeFactor,
  waveParams,
} from "./wave.js";
import { applyPose } from "./surfer.js";

const G = 9.81;
// steering: push, damping (the lag of a turn is about 1/STEER_DAMP seconds), and the pocket the board settles toward
const GRAV_CAP = 2.6;
// the autopilot is a good rider, not a perfect one: it pumps a little behind the beat
const AUTO_LATE = 0.08;
const WARN_AHEAD = 34;
const KICK_MIN = 5;
// the wind twist's push is set in tour.json against the old steering push of 2.7; scaled so it still costs a rider who has to correct it (the quicker steering would otherwise shrug it off)
const WIND_SCALE = 2.2;
const LIP_GRACE = 0.4;
const STEER = 4.6;
const STEER_DAMP = 6;
const SETTLE = 3;
const TRIM_S = 0.5;
// the pump rhythm: the best interval between pumps and the width of the timing window (in seconds squared, a Gaussian)
export const PUMP_BEAT = 0.5;
export const PUMP_WIDTH = 0.03;

export function blankStats() {
  return {
    tubeTime: 0,
    deepTime: 0,
    committed: 0,
    speedSum: 0,
    speedSq: 0,
    samples: 0,
    maxSpeed: 0,
    pumps: 0,
    goodPumps: 0,
    stalls: 0,
    turns: 0,
    sSum: 0,
    lastSteer: 0,
    clean: false,
    kick: false,
    spit: false,
    wipe: false,
  };
}

export function createRide() {
  return {
    mode: "menu",
    t: 0,
    peel: 0,
    z: -16,
    d: -16,
    s: 0.46,
    vs: 0,
    speed: 10.5,
    vPeel: 11,
    dLock: -8,
    fade: false,
    maxRide: 28,
    tube: 0,
    tubeRun: 0,
    inTube: false,
    deep: false,
    spit: -1,
    spitDone: false,
    claim: -1,
    wipe: -1,
    wipeMsg: "",
    ended: false,
    reason: "",
    lost: 0,
    white: 0,
    drops: 0,
    msg: "",
    msgT: 0,
    score: 0,
    tubeShade: 0,
    wakeT: 0,
    pumpWas: false,
    lastPump: -10,
    pumpFx: { t: -10, q: 0, gap: 0 },
    lipT: 0,
    sMax: 1.1,
    warn: { text: "", level: 0 },
    pose: { crouch: 0.45, glide: 0.55, claim: 0, wipe: 0 },
    live: null,
    stats: blankStats(),
    camInit: false,
    pos: new THREE.Vector3(),
    camPos: new THREE.Vector3(),
    camLook: new THREE.Vector3(),
    camUp: new THREE.Vector3(0, 1, 0),
    normal: new THREE.Vector3(0, 1, 0),
    forward: new THREE.Vector3(0, 0, -1),
    lateral: new THREE.Vector3(1, 0, 0),
    ahead: new THREE.Vector3(0, 0, -1),
    desired: new THREE.Vector3(),
    look: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0),
    basis: new THREE.Matrix4(),
    tmp: new THREE.Vector3(),
  };
}

export function resetRide(st, cond, opts = {}) {
  st.mode = opts.mode || "ride";
  st.t = 0;
  st.peel = 0;
  st.z = opts.z ?? -16;
  st.d = st.z - st.peel;
  st.s = opts.s ?? 0.46;
  st.vs = 0;
  st.speed = opts.speed ?? Math.max(8, (cond.peelSpeed || 11) - 0.4);
  st.vPeel = cond.peelSpeed || 11;
  st.dLock = opts.dLock ?? st.d;
  st.fade = !!opts.fade;
  st.maxRide = opts.maxRide ?? 28;
  st.tube = 0;
  st.tubeRun = 0;
  st.inTube = false;
  st.deep = false;
  st.spit = -1;
  st.spitDone = false;
  st.claim = -1;
  st.wipe = -1;
  st.wipeMsg = "";
  st.ended = false;
  st.reason = "";
  st.lost = 0;
  st.white = 0;
  st.drops = 0;
  st.msg = opts.msg || "";
  st.msgT = opts.msg ? 1.6 : 0;
  st.score = 0;
  st.tubeShade = 0;
  st.wakeT = 0;
  st.pumpWas = false;
  st.lastPump = -10;
  st.pumpFx.t = -10;
  st.pumpFx.q = 0;
  st.pumpFx.gap = 0;
  st.lipT = 0;
  st.warn.text = "";
  st.warn.level = 0;
  st.pose.crouch = 0.5;
  st.pose.glide = 0.5;
  st.pose.claim = 0;
  st.pose.wipe = 0;
  st.stats = blankStats();
  st.camInit = false;
  st.live = {
    height: cond.height,
    curl: cond.curl,
    tight: cond.tight,
    zones: cond.zones || [],
    wind: cond.wind || 0,
    feet: cond.feet || 8,
  };
}

function wipe(st, msg) {
  if (st.mode === "wipe" || st.ended) return;
  st.mode = "wipe";
  st.wipe = st.t;
  st.wipeMsg = msg;
  st.stats.wipe = true;
  st.msg = "WIPEOUT";
  st.msgT = 2.1;
}

function claim(st) {
  if (st.claim >= 0 || st.mode !== "ride") return;
  st.mode = "claim";
  st.claim = st.t;
  st.stats.clean = true;
  st.score += 1000;
  st.msg = "CLEAN EXIT";
  st.msgT = 2.2;
}

/** Riding the wave out without a wipeout and without a tube exit is still a kick-out: it scores a better exit than a fall off the back. */
function kickOut(st) {
  if (st.stats.clean || st.stats.kick || st.mode !== "ride" || st.t < KICK_MIN) return;
  st.stats.kick = true;
  st.msg = "KICK OUT";
  st.msgT = 1.6;
}

function finish(st, reason) {
  if (st.ended) return;
  st.ended = true;
  st.reason = reason;
}

function liveCond(st, cond) {
  let height = cond.height;
  let curl = cond.curl;
  if (st.fade) {
    const f = smoothstep(22, 34, st.t);
    height *= 1 - 0.5 * f;
    curl *= 1 - 0.28 * f;
  }
  if (st.spit >= 0) {
    const open = smoothstep(0.7, 3.4, st.t - st.spit);
    curl *= 1 - 0.62 * open;
    height *= 1 - 0.22 * open;
  }
  st.live.height = height;
  st.live.curl = curl;
  st.live.tight = cond.tight;
  st.live.zones = cond.zones || [];
  st.live.wind = cond.wind || 0;
  st.live.feet = cond.feet || 8;
  return st.live;
}

export function updateRide(st, dt, input, cond) {
  const live = liveCond(st, cond);
  if (st.mode === "menu") {
    st.t += dt;
    st.vPeel = cond.peelSpeed || 11;
    st.peel -= st.vPeel * dt;
    st.z = st.peel + st.dLock;
    st.d = st.dLock;
    st.s = 0.5;
    st.speed = st.vPeel;
    return;
  }
  st.t += dt;
  st.vPeel = (cond.peelSpeed || 11) + 0.4 * Math.sin(st.t * 0.37);
  if (st.spit >= 0 && st.t - st.spit < 1.5) st.vPeel += 0.35;
  st.peel -= st.vPeel * dt;

  const surfing = st.mode === "ride" || st.mode === "claim";
  if (surfing) {
    const preExtra = extraCloseout(st.z, live.zones);
    const pre = waveParams(st.d, live.height, live.curl, live.tight, st.t, preExtra);
    const preFrame = faceFrame(pre, st.s);
    const arc = Math.max(pre.r0, 0.45) * 1.05;
    const vy = st.vs * arc * preFrame.ty;
    const pumpEdge = input.thr > 0.45 && !st.pumpWas;
    if (input.thr < -0.4) st.stats.stalls += dt;
    let boost = 0;
    if (pumpEdge) {
      // a pump pays by rhythm: one about every PUMP_BEAT seconds is worth the most; mashing is worth almost nothing, so the
      // timing is the skill. The first pump of a ride counts as decent, and a pump while the lip is closing in is always a
      // real fighting chance (the rescue floor).
      const period = st.t - st.lastPump;
      let timed = st.stats.pumps > 0 ? Math.exp(-((period - PUMP_BEAT) ** 2) / PUMP_WIDTH) : 0.7;
      if (st.d > -4) timed = Math.max(timed, 0.75);
      boost = 11 * timed + 2.5 * clamp((period - 0.2) / 0.2, 0, 1);
      st.pumpFx.t = st.t;
      st.pumpFx.q = timed;
      st.pumpFx.gap = st.stats.pumps > 0 ? period - PUMP_BEAT : 0;
      st.stats.pumps += 1;
      if (timed >= 0.5) st.stats.goodPumps += 1;
      st.lastPump = st.t;
    }
    st.pumpWas = input.thr > 0.45;
    const stall = clamp(-input.thr, 0, 1);
    // holding up trims the board for speed (about a third more drive); it is the easy way to keep pace, pumping is the way to pull ahead
    const trim = 1 + 0.34 * clamp(input.thr, 0, 1);
    const drive = (3.4 + 6.8 * Math.max(preFrame.ty, 0) * pre.p) * trim * (1 - stall * 0.55) * (0.84 + live.feet * 0.016);
    let accel = drive / Math.max(st.speed, 1);
    accel += (-G * vy) / Math.max(st.speed, 1);
    const drag = (st.speed < 5.2 ? 0.45 : 0.055) + stall * 0.28 + live.wind * 0.16;
    accel -= drag * st.speed;
    st.speed += accel * dt;
    if (boost) st.speed = Math.sqrt(st.speed * st.speed + boost);
    st.speed = clamp(st.speed, 3.1, 16.2 + live.feet * 0.12);

    const sMax = Math.min(pre.S * 0.9, THREE.MathUtils.lerp(1.58, 1.1, live.tight));
    st.sMax = sMax;
    // gravity down the face is capped below the steering push: on a small wave it used to out-pull the keys, so "up" could not be held
    const gravPull = Math.max((-5.4 * Math.max(preFrame.ty, 0)) / arc, -GRAV_CAP);
    // Hands off the keys the board settles toward the pocket (a soft spring) instead of sliding to the bottom of the face;
    // the more you steer, the less the spring and the pull matter, so a held key still goes where it points.
    const hands = 1 - Math.min(1, Math.abs(input.steer) * 3);
    const settle = -hands * SETTLE * (st.s - Math.min(TRIM_S, sMax * 0.85));
    // windPush: the side-shore wind twist shoves the board with a steady push, in steering units (negative: down the face, toward the trough)
    st.vs += (input.steer * STEER + gravPull * (input.steer < 0 ? 1 : 0) * (1 - 0.9 * hands) * (1 - stall * 0.65) + settle + (cond.windPush || 0) * WIND_SCALE) * dt;
    st.vs *= Math.exp(-dt * STEER_DAMP);
    st.s += st.vs * dt;
    if (st.s > sMax) {
      // pushing into the lip for LIP_GRACE seconds sucks you over; touching it for a moment does not
      if (pre.p > 0.5 && input.steer > 0.2 && st.mode === "ride") {
        st.lipT += dt;
        if (st.lipT > LIP_GRACE) wipe(st, "Too high — sucked over the falls");
      }
      st.s = sMax;
      st.vs = Math.min(st.vs, 0);
    }
    if (st.s < sMax - 0.02 || input.steer < 0.2) st.lipT = Math.max(0, st.lipT - dt * 2);
    if (st.s < 0.08) {
      st.s = 0.08;
      st.vs = Math.max(st.vs, 0);
    }
    st.z -= st.speed * dt;
    st.d = st.z - st.peel;

    const extra = extraCloseout(st.z, live.zones);
    const P = waveParams(st.d, live.height, live.curl, live.tight, st.t, extra);
    if (st.mode === "ride" && st.d > -0.8) {
      if (st.spitDone && st.tubeRun > 1.7) claim(st);
      else wipe(st, "Closed out — the lip got you");
    }
    if (st.mode === "ride" && extra > 0.78 && st.d > -7) {
      if (st.spitDone && st.tubeRun > 1.7) claim(st);
      else wipe(st, "Closeout section");
    }

    const inTube = st.d > -18 && st.d < 1.2 && P.S > 3.5 && st.s > 0.18;
    const deep = inTube && st.d > -7.5 && P.S > 3.85;
    if (st.mode === "ride") {
      if (inTube) {
        st.tube += dt;
        st.tubeRun += dt;
        st.stats.tubeTime += dt;
        st.score += dt * (deep ? 220 : 100);
        if (deep) st.stats.deepTime += dt;
        if (st.s > 0.32) st.stats.committed += dt;
      }
      if (st.inTube && !inTube) {
        if (st.tubeRun > 1.7) claim(st);
        else st.tubeRun = 0;
      }
      if (deep && st.tubeRun > 6.2 && !st.spitDone) {
        st.spit = st.t;
        st.spitDone = true;
        st.stats.spit = true;
        st.score += 500;
        st.msg = "SPIT";
        st.msgT = 2.3;
      }
      if (st.d < -46) {
        st.lost += dt;
        if (st.lost > 2) {
          kickOut(st);
          finish(st, st.stats.clean ? "Wave over." : "You outran it onto the shoulder.");
        }
      } else st.lost = 0;
      if (st.t > st.maxRide) {
        if (st.tube > 1.4 && st.mode === "ride") claim(st);
        else kickOut(st);
        finish(st, "Wave over.");
      }
      for (const shark of cond.sharks || []) {
        if (st.mode !== "ride") break;
        const sz = shark.z + Math.sin(st.t * 0.45 + shark.wobble) * 1.2;
        const ss = shark.s + Math.sin(st.t * 0.35 + shark.wobble) * 0.03;
        if (Math.abs(st.z - sz) < 1.35 && Math.abs(st.s - ss) < 0.11) wipe(st, "Shark. The fin was the only warning.");
      }
      for (const board of cond.boards || []) {
        if (st.mode !== "ride") break;
        const bz = board.z + Math.sin(st.t * 0.8 + board.wobble) * 0.4;
        if (Math.abs(st.z - bz) < 1.5 && Math.abs(st.s - board.s) < 0.1) wipe(st, "Loose board in the pocket");
      }
      for (const reef of cond.reef || []) {
        if (st.mode !== "ride") break;
        const hi = Math.max(reef.z0, reef.z1);
        const lo = Math.min(reef.z0, reef.z1);
        if (st.z < hi && st.z > lo && st.s < 0.16 + (cond.tide === "low" ? 0.05 : 0) + (cond.reefLift || 0)) {
          wipe(st, "Reef. Too low on the face.");
        }
      }
      if (st.mode === "ride" && st.spitDone && st.t - st.spit > 3.2 && st.tubeRun > 1.7) claim(st);
    }
    st.inTube = inTube && st.mode !== "wipe";
    st.deep = deep && st.mode !== "wipe";
    setWarning(st, cond, live, P, sMax, extra);

    st.stats.samples += 1;
    st.stats.speedSum += st.speed;
    st.stats.speedSq += st.speed * st.speed;
    st.stats.maxSpeed = Math.max(st.stats.maxSpeed, st.speed);
    st.stats.sSum += st.s;
    const sg = Math.sign(input.steer);
    if (sg && sg !== st.stats.lastSteer && Math.abs(input.steer) > 0.45) {
      st.stats.turns += 1;
      st.stats.lastSteer = sg;
    }
    if (st.mode === "claim" && st.t - st.claim > 1.7) finish(st, "Wave over — clean.");
  } else if (st.mode === "wipe") {
    st.z -= st.speed * dt;
    st.speed *= Math.exp(-dt * 0.8);
    st.d = st.z - st.peel;
    if (st.t - st.wipe > 2.15) finish(st, st.wipeMsg || "Wipeout");
  }

  let white = 0;
  if (st.spit >= 0) {
    const e = st.t - st.spit;
    white = smoothstep(0.25, 1.15, e) * (1 - smoothstep(2.1, 4.2, e)) * 0.42;
    if (e > 0.7 && e < 1.15) st.drops = 1;
  }
  if (st.mode === "wipe") white = Math.max(white, smoothstep(0.15, 0.9, st.t - st.wipe) * 0.75);
  st.white = white;
  st.drops = Math.max(0, st.drops - dt * 0.12);
  if (st.msgT > 0) st.msgT -= dt;
}

/**
 * The line round a hazard at face position hs, z: the side that has room. Low is open down to the reef line (higher where a reef
 * sits at the same spot); high only while there is face left. Returns { high, target } (target is the face position to hold).
 */
export function dodgeLine(st, cond, h) {
  const reefHere = (cond.reef || []).some((r) => h.z < Math.max(r.z0, r.z1) + 8 && h.z > Math.min(r.z0, r.z1) - 8);
  const lowOk = h.s - 0.34 > (reefHere ? 0.3 : 0.2);
  const highOk = h.s + 0.34 < st.sMax - 0.04;
  const high = highOk && (!lowOk || h.s < st.s || reefHere);
  return { high, target: high ? h.s + 0.34 : h.s - 0.34 };
}

function dodgeWay(st, cond, h) {
  return dodgeLine(st, cond, h).high ? "GO HIGH (LEFT)" : "GO LOW (RIGHT)";
}

/** The one warning the player needs right now (st.warn: text, level 1 heads-up / 2 act now), for the HUD. Pure read of state. */
function setWarning(st, cond, live, P, sMax, extra) {
  const w = st.warn;
  w.text = "";
  w.level = 0;
  if (st.mode !== "ride") return;
  const say = (text, level) => {
    if (level > w.level) {
      w.text = text;
      w.level = level;
    }
  };
  for (const shark of cond.sharks || []) {
    const dz = st.z - shark.z; // positive: the fin is still ahead (we travel toward -z)
    if (dz > 0 && dz < WARN_AHEAD && Math.abs(shark.s - st.s) < 0.2) say(`SHARK AHEAD: ${dodgeWay(st, cond, shark)}`, dz < 14 ? 2 : 1);
  }
  for (const board of cond.boards || []) {
    const dz = st.z - board.z;
    if (dz > 0 && dz < WARN_AHEAD && Math.abs(board.s - st.s) < 0.18) say(`LOOSE BOARD: ${dodgeWay(st, cond, board)}`, dz < 12 ? 2 : 1);
  }
  for (const reef of cond.reef || []) {
    const hi = Math.max(reef.z0, reef.z1);
    const lo = Math.min(reef.z0, reef.z1);
    if (st.z > lo && st.z < hi + WARN_AHEAD && st.s < 0.34) say("REEF: STAY UP THE FACE (LEFT)", st.z < hi ? 2 : 1);
  }
  if (extraCloseout(st.z - WARN_AHEAD * 0.8, live.zones) > 0.3 && !st.spitDone) say(extra > 0.3 ? "CLOSEOUT: PUMP, RUN AHEAD OF THE LIP" : "CLOSEOUT AHEAD", extra > 0.3 ? 2 : 1);
  if (st.d < -26 && !st.inTube && !st.spitDone) say("OUT AHEAD OF THE CURL: EASE OFF, LET IT CATCH YOU", st.d < -36 ? 2 : 1);
  if (st.d > -5 && st.speed < st.vPeel + 1.2 && !(st.spitDone && st.tubeRun > 1.7)) say("LIP CATCHING YOU: PUMP", 2);
  if (P.p > 0.5 && st.s > sMax - 0.14 && st.lipT > 0.02) say("TOO HIGH: EASE OFF (RIGHT)", 2);
}

export function autopilot(st, cond) {
  let targetS = st.t < 2.6 ? 0.42 : 0.5;
  let targetD = st.t < 2.6 ? -14 : -4.8;
  if (st.spit >= 0) {
    const out = clamp((st.t - st.spit) / 2.4, 0, 1);
    targetD = -22;
    targetS = 0.5 - 0.2 * out;
  }
  // the nearest shark or loose board in the next 26 m decides the line: round it on the side that has room
  let near = null;
  for (const h of [...(cond.sharks || []), ...(cond.boards || [])]) {
    const dz = st.z - h.z;
    if (dz > -1.5 && dz < 26 && (!near || st.z - near.z > dz)) near = h;
  }
  if (near) targetS = dodgeLine(st, cond, near).target;
  if (extraCloseout(st.z - 10, cond.zones) > 0.3) targetD = -18;
  const wobble = Math.sin(st.t * 1.2) * 0.08 + Math.sin(st.t * 0.47) * 0.04;
  const steer = clamp((targetS - st.s) * 3.1 - st.vs * 0.55 + wobble, -1, 1);
  const kick = st.spit >= 0 ? 3.2 : 1.8;
  const want = st.vPeel + clamp((st.d - targetD) * 0.28, -2.6, kick);
  let thr = clamp((want - st.speed) * 0.9, -1, 1);
  if (st.speed < want - 0.3) {
    // behind the pace: pump on the beat (a short press every PUMP_BEAT seconds), hold the trim in between
    const sinceBeat = st.t - st.lastPump;
    thr = sinceBeat >= PUMP_BEAT + AUTO_LATE || (st.pumpWas && sinceBeat < 0.1) ? 1 : 0.3;
  }
  return { steer, thr };
}

/**
 * A rider who is bad at this (the warm-up check drives it): the first wave of a heat gets no input at all and ends in a
 * wipeout; every later wave steers like the autopilot and pumps for the first `effort` seconds, then coasts.
 */
export function poorAutopilot(st, cond, waveIndex, effort = 3) {
  if (waveIndex === 0) return { steer: 0, thr: 0 };
  const a = autopilot(st, cond);
  return { steer: a.steer, thr: st.t < effort ? (Math.sin(st.t * Math.PI * 2 * 2.4) > 0 ? 1 : 0) : 0 };
}

/**
 * A point on the wave wall `reach` metres up the face from the board, in holder space (x across, y along the
 * face normal, z along the board), for the rear hand to trail through in the tube.
 */
function wallPoint(P, st, fr, reach) {
  const p0 = facePoint(P, st.s);
  const sMax = P.S * 0.98;
  let ds = reach / Math.max(P.r0, 0.45);
  for (let k = 0; k < 3; k++) {
    const p1 = facePoint(P, Math.min(sMax, st.s + ds));
    const dist = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    if (dist < 1e-4) break;
    ds *= reach / dist;
  }
  const p = facePoint(P, Math.min(sMax, st.s + ds));
  const vx = p[0] - st.pos.x;
  const vy = p[1] - st.pos.y;
  const x = vx * st.lateral.x + vy * st.lateral.y;
  const y = vx * st.normal.x + vy * st.normal.y;
  // fr.x/fr.y is the board's own face point; the holder sits 0.02 above it
  return { x, y: y + 0.03, z: 0.05 };
}

export function syncWorld(world, st, dt, input, cond) {
  const live = st.live;
  const extra = extraCloseout(st.z, live.zones);
  const P = waveParams(st.d, live.height, live.curl, live.tight, st.t, extra);
  const fr = faceFrame(P, st.s);
  st.normal.set(fr.nx, fr.ny, 0).normalize();
  const across = st.tmp.set(-st.normal.y, st.normal.x, 0);
  const yaw = Math.atan2(st.vs * Math.max(P.r0, 1), Math.max(st.speed, 0.5)) * 0.9;
  st.forward.set(0, 0, -1).multiplyScalar(Math.cos(yaw)).addScaledVector(across, Math.sin(yaw)).normalize();
  st.lateral.crossVectors(st.forward, st.normal);
  if (st.lateral.lengthSq() < 1e-6) st.lateral.set(1, 0, 0);
  st.lateral.normalize();
  st.ahead.crossVectors(st.normal, st.lateral).normalize();
  if (st.ahead.dot(st.forward) < 0) st.ahead.negate();

  st.pos.set(fr.x, fr.y, st.z).addScaledVector(st.normal, 0.02);
  st.basis.makeBasis(st.lateral, st.normal, st.ahead.clone().negate());
  const holder = world.surfer.holder;
  holder.quaternion.setFromRotationMatrix(st.basis);
  holder.position.copy(st.pos);
  if (st.mode === "wipe") {
    const e = st.t - st.wipe;
    holder.position.y += Math.sin(Math.min(e, 1.2) * 2.6) * 0.8 - e * 0.45;
    holder.rotateZ(e * 2.1);
    holder.rotateX(e * 1.1);
  }
  const weights = { crouch: 0, glide: 0, claim: 0, wipe: 0 };
  if (st.mode === "wipe") weights.wipe = 1;
  else if (st.mode === "claim" && st.t - st.claim > 0.35) weights.claim = 1;
  else {
    // paddle-in / menu: relaxed and upright; the first 1.4 s of a ride: the drop, deep crouch easing out; tube: low
    const upright = st.mode === "menu" ? 0.2 : 0;
    const drop = st.mode === "ride" ? clamp(1 - st.t / 1.4, 0, 1) : 0;
    const crouch = clamp(0.34 - upright + drop * 0.45 + (st.inTube ? 0.5 : 0) + Math.max(input.thr, 0) * 0.28, 0, 1);
    weights.crouch = crouch;
    weights.glide = 1 - crouch;
  }
  const snap = !st.camInit;
  for (const k of Object.keys(weights)) {
    st.pose[k] += (weights[k] - st.pose[k]) * (snap ? 1 : Math.min(1, dt * 4));
  }
  applyPose(world.surfer, st.pose, st.t, {
    steer: input.steer,
    thr: input.thr,
    inTube: st.inTube,
    deep: st.deep,
    dt,
    vs: st.vs,
    snap,
    tilt: Math.atan2(-st.lateral.y, st.normal.y) * 0.55,
    wall: st.inTube ? wallPoint(P, st, fr, 0.62) : null,
  });

  const aspect = world.camera.aspect;
  const m = clamp((aspect - 0.6) / 1.2, 0, 1);
  const back = 1.5 + 0.5 * m;
  const lift = 0.7 + 0.2 * m;
  st.desired.copy(st.pos)
    .addScaledVector(st.ahead, -back)
    .addScaledVector(st.normal, 0.48)
    .addScaledVector(st.lateral, -0.06);
  st.desired.y += lift;
  st.look.copy(st.pos).addScaledVector(st.ahead, 9).addScaledVector(st.normal, 0.2);
  st.look.y += 0.25;
  st.up.set(0, 1, 0).lerp(st.normal, 0.3).normalize();

  if (!st.camInit) {
    st.camPos.copy(st.desired);
    st.camLook.copy(st.look);
    st.camUp.copy(st.up);
    st.camInit = true;
  }
  const kp = 1 - Math.exp(-dt * 8);
  const kl = 1 - Math.exp(-dt * 5);
  st.camPos.lerp(st.desired, kp);
  st.camLook.lerp(st.look, kl);
  st.camUp.lerp(st.up, kl).normalize();

  const camCond = { height: live.height, curl: live.curl, tight: live.tight, zones: live.zones };
  pushOutOfWater(st.camPos, st.peel, camCond, st.t, 0.46);
  pushOutOfWater(st.camLook, st.peel, camCond, st.t, 0.2);

  const cam = world.camera;
  cam.position.copy(st.camPos);
  cam.position.x += Math.sin(st.t * 13) * 0.005;
  cam.position.y += Math.sin(st.t * 17) * 0.005;
  cam.up.copy(st.camUp);
  cam.lookAt(st.camLook);

  const shade = tubeFactor(fr.x, fr.y + 0.8, st.z, st.peel, camCond, st.t);
  st.tubeShade += (shade - st.tubeShade) * Math.min(1, dt * 3);
  world.sun.intensity = (2.6 * (world.uniforms.uGlare.value > 0.5 ? 1 : 0.45)) * (1 - 0.72 * st.tubeShade);
  world.scene.environmentIntensity = 0.85 * (1 - 0.4 * st.tubeShade);
  world.hemi.intensity = 0.15 + 1.15 * st.tubeShade;
  world.sun.position.copy(holder.position).addScaledVector(world.uniforms.uSunDir.value, 40);
  world.sun.target.position.copy(holder.position);

  world.uniforms.uTime.value = st.t;
  world.uniforms.uHeight.value = live.height;
  world.uniforms.uCurl.value = live.curl;
  world.uniforms.uTight.value = live.tight;
  world.uniforms.uPeel.value = st.peel;
  world.uniforms.uWind.value = live.wind;
  const zones = live.zones || [];
  const c0 = world.uniforms.uC0.value;
  const c1 = world.uniforms.uC1.value;
  const cp = world.uniforms.uCp.value;
  c0.set(0, 0, 0, 0);
  c1.set(1, 1, 1, 1);
  cp.set(0, 0, 0, 0);
  for (let i = 0; i < Math.min(4, zones.length); i++) {
    c0.setComponent(i, zones[i].z0);
    c1.setComponent(i, zones[i].z1);
    cp.setComponent(i, zones[i].power);
  }
  world.uniforms.uSpit.value = st.spit >= 0 ? Math.max(0, 1 - (st.t - st.spit) / 4) : 0;
  world.wave.position.z = st.peel;

  world.sky.position.copy(cam.position);
  world.ocean.position.x = Math.round(cam.position.x / 40) * 40;
  world.ocean.position.z = Math.round(cam.position.z / 40) * 40;
  world.clouds.position.z = cam.position.z;
  world.island.position.z = cam.position.z - 2400;
  if (world.clouds.userData.mat) world.clouds.userData.mat.uniforms.uTime.value = st.t;

  const surfingNow = st.mode === "ride" || st.mode === "claim";
  if (surfingNow) {
    const count = Math.floor((world.quality === "low" ? 28 : 70) * dt * 60 * (0.55 + 0.6 * Math.abs(st.vs) + 0.25 * Math.max(input.thr, 0)));
    for (let i = 0; i < count; i++) {
      const side = Math.random() < 0.64 ? 1 : -1;
      const along = 0.15 + Math.random() * 0.8;
      const x = fr.x + side * 0.22 * fr.ny + (Math.random() - 0.5) * 0.12;
      const y = fr.y - side * 0.18 * fr.nx * 0.5 + 0.04;
      const sp = 1.6 + Math.random() * 3.4;
      const mist = Math.random() < 0.16;
      world.spray.emit(
        x, y, st.z + along,
        side * sp * fr.ny + (Math.random() - 0.5) * 1.1,
        side * sp * -fr.nx * 0.35 + 1.1 + Math.random() * 2.6,
        -st.speed * (0.4 + Math.random() * 0.4),
        mist ? 0.08 + Math.random() * 0.12 : 0.007 + Math.random() * 0.018,
        0.45 + Math.random() * 0.7,
        { grow: mist ? 1.5 : 0.12, drag: 0.9, alpha: mist ? 0.1 : 0.95, grav: 7 },
      );
    }
    st.wakeT += dt;
    if (st.wakeT > 0.04) {
      st.wakeT = 0;
      world.wake.push(st.z + 0.7, st.s, st.t);
    }
  }
  const lipN = Math.floor((world.quality === "low" ? 8 : 18) * dt * 60);
  for (let i = 0; i < lipN; i++) {
    const ahead = -2 - Math.random() * 18;
    const d = st.d + ahead;
    const Q = waveParams(d, live.height, live.curl, live.tight, st.t, extraCloseout(st.peel + d, live.zones));
    if (Q.p < 0.35) continue;
    const s = Q.S * (0.92 + Math.random() * 0.08);
    const q = faceFrame(Q, Math.min(s, Q.S));
    world.spray.emit(q.x, q.y + 0.15, st.peel + d, 0.4 + Math.random() * 1.2, 1.2 + Math.random() * 2.2, -st.vPeel * 0.3, 0.02 + Math.random() * 0.05, 0.5 + Math.random() * 0.45, { grow: 0.5, drag: 1.1, alpha: 0.35, grav: 3 });
  }
  if (st.spit >= 0 && st.t - st.spit < 2.5) {
    const k = smoothstep(0, 0.35, st.t - st.spit) * (1 - smoothstep(1.5, 2.5, st.t - st.spit));
    const n = Math.floor((world.quality === "low" ? 10 : 22) * k * dt * 60);
    for (let i = 0; i < n; i++) {
      const rad = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * P.r0 * 0.8;
      world.spray.emit(
        Math.sin(rad) * rr * 0.85,
        Math.max(0.2, P.r0 + Math.cos(rad) * rr * 0.5),
        st.z + Math.random() * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.2) * 1.4,
        -(st.speed + 8 + Math.random() * 8),
        0.4 + Math.random() * 1.1,
        1.1 + Math.random(),
        { grow: 1.7, drag: 0.5, alpha: 0.04, grav: 0.3 },
      );
    }
  }
  if (cond.look === "storm") {
    const n = Math.floor(dt * 60 * (world.quality === "low" ? 8 : 16));
    for (let i = 0; i < n; i++) {
      world.spray.emit(
        cam.position.x + (Math.random() - 0.5) * 18,
        cam.position.y + 6 + Math.random() * 4,
        cam.position.z - Math.random() * 16,
        -2, -14, -6,
        0.01, 0.6,
        { grow: 0, drag: 0.1, alpha: 0.35, grav: 4 },
      );
    }
  }

  world.spray.brightFn = (x, y, z) => 1 - 0.55 * tubeFactor(x, y, z, st.peel, camCond, st.t);
  world.spray.update(dt);
  world.wake.uniforms.uLight.value = 1 - 0.55 * st.tubeShade;
  if (st.mode !== "wipe") world.wake.update(st.t, st.peel, camCond, 3.2);

  placeHazards(world, st, cond);

  const sunClip = world.uniforms.uSunDir.value.clone().multiplyScalar(400).add(cam.position).project(cam);
  const visible = sunClip.z < 1 && Math.abs(sunClip.x) < 1.2 && Math.abs(sunClip.y) < 1.2;
  const sx = sunClip.x * 0.5 + 0.5;
  const sy = sunClip.y * 0.5 + 0.5;
  const drawn = distortUv(sx, sy, world.gradePass.uniforms.uDistort.value, cam.aspect);
  world.gradePass.uniforms.uSun.value.set(sx, sy);
  world.gradePass.uniforms.uSunDraw.value.set(drawn[0], drawn[1]);
  world.gradePass.uniforms.uSunOn.value = visible ? 1 : 0;
  world.gradePass.uniforms.uWhite.value = st.white;
  world.gradePass.uniforms.uDrops.value = st.drops;
  world.gradePass.uniforms.uTime.value = st.t;
}

function distortUv(u, v, k, aspect) {
  let x = (u - 0.5) * aspect;
  let y = v - 0.5;
  const r2 = x * x + y * y;
  const rmax = 0.25 * (aspect * aspect + 1);
  const s = (1 + k * r2) / (1 + k * rmax);
  x = (x * s) / aspect + 0.5;
  y = y * s + 0.5;
  return [x, y];
}

function placeHazards(world, st, cond) {
  const live = st.live;
  world.sharks.children.forEach((fin, i) => {
    const shark = (cond.sharks || [])[i];
    if (!shark) {
      fin.visible = false;
      return;
    }
    fin.visible = true;
    const z = shark.z + Math.sin(st.t * 0.45 + shark.wobble) * 1.2;
    const s = shark.s + Math.sin(st.t * 0.35 + shark.wobble) * 0.03;
    const d = z - st.peel;
    const extra = extraCloseout(z, live.zones);
    const P = waveParams(d, live.height, live.curl, live.tight, st.t, extra);
    const fr = faceFrame(P, clamp(s, 0.05, Math.max(0.2, P.S * 0.85)));
    fin.position.set(fr.x, fr.y, z);
    fin.lookAt(fr.x + fr.nx, fr.y + fr.ny + 0.2, z);
    const bob = 0.15 + Math.sin(st.t * 2 + shark.wobble) * 0.05;
    fin.position.addScaledVector(st.normal.set(fr.nx, fr.ny, 0), bob);
  });
  world.reef.children.forEach((rock, i) => {
    const reef = (cond.reef || [])[Math.floor(i / 2)];
    if (!reef) {
      rock.visible = false;
      return;
    }
    rock.visible = true;
    const z = THREE.MathUtils.lerp(reef.z0, reef.z1, (i % 2 === 0 ? 0.35 : 0.7) + (i % 3) * 0.02);
    const d = z - st.peel;
    const P = waveParams(d, live.height, live.curl, live.tight, st.t, 0);
    const fr = faceFrame(P, 0.12);
    rock.position.set(fr.x + (i - 3) * 0.4, Math.max(0.05, fr.y - 0.25), z);
    rock.rotation.y = i;
  });
  world.debris.children.forEach((board, i) => {
    const item = (cond.boards || [])[i];
    if (!item) {
      board.visible = false;
      return;
    }
    board.visible = true;
    const z = item.z + Math.sin(st.t * 0.8 + item.wobble) * 0.4;
    const d = z - st.peel;
    const P = waveParams(d, live.height, live.curl, live.tight, st.t, 0);
    const fr = faceFrame(P, item.s);
    board.position.set(fr.x, fr.y + 0.08 + Math.sin(st.t * 1.4 + i) * 0.04, z);
    board.rotation.set(0.1, st.t * 0.2 + i, 0.4);
  });
}

/** Reproduce the old pole-cam offset and report air clearance before and after the clamp. */
export function stressCamera(aspect = 0.56) {
  // The v1 pole cam added ~1.4m of world-up. On a low ceiling that offset
  // crosses the lip (negative air gap). Height 0.45 / s at the wall is one
  // of those poses.
  const cond = { height: 0.45, curl: 1.05, tight: 0, zones: [] };
  const time = 4;
  const d = -10;
  const peel = -20;
  const P = waveParams(d, cond.height, cond.curl, cond.tight, time, 0);
  const s = Math.min(1.58, P.S * 0.9);
  const fr = faceFrame(P, s);
  const normal = new THREE.Vector3(fr.nx, fr.ny, 0).normalize();
  const across = new THREE.Vector3(-normal.y, normal.x, 0);
  const forward = new THREE.Vector3(0, 0, -1);
  const lateral = new THREE.Vector3().crossVectors(forward, normal).normalize();
  const ahead = new THREE.Vector3().crossVectors(normal, lateral).normalize();
  const pos = new THREE.Vector3(fr.x, fr.y, peel + d).addScaledVector(normal, 0.02);
  const m = clamp((aspect - 0.6) / 1.2, 0, 1);
  const legacy = pos.clone()
    .addScaledVector(ahead, -(1.8 + 1.1 * m))
    .addScaledVector(normal, 0.45)
    .add(new THREE.Vector3(0, 1.4 + 0.35 * m, 0))
    .addScaledVector(lateral, -0.1);
  legacy.y = Math.max(legacy.y, 0.6);
  sampleProfile(legacy.z - peel, cond.height, cond.curl, cond.tight, time, 0, 88);
  const before = closestOnSample(legacy.x, legacy.y).sd;
  const fixed = legacy.clone();
  pushOutOfWater(fixed, peel, cond, time, 0.46);
  sampleProfile(fixed.z - peel, cond.height, cond.curl, cond.tight, time, 0, 88);
  const after = closestOnSample(fixed.x, fixed.y).sd;
  const buried = pos.clone().addScaledVector(normal, -1.8);
  const buriedBefore = (() => {
    sampleProfile(buried.z - peel, cond.height, cond.curl, cond.tight, time, 0, 64);
    return closestOnSample(buried.x, buried.y).sd;
  })();
  pushOutOfWater(buried, peel, cond, time, 0.46);
  sampleProfile(buried.z - peel, cond.height, cond.curl, cond.tight, time, 0, 64);
  const buriedAfter = closestOnSample(buried.x, buried.y).sd;
  return { before, after, buriedBefore, buriedAfter, s, S: P.S };
}

export function cameraAirGap(st) {
  const live = st.live;
  if (!live) return 99;
  sampleProfile(st.camPos.z - st.peel, live.height, live.curl, live.tight, st.t, extraCloseout(st.camPos.z, live.zones), 72);
  return closestOnSample(st.camPos.x, st.camPos.y).sd;
}
