// The riding display (mockups/03-hud.png): the heat score, the combo meter and multiplier, trick popups, the tube-time dial, the heat
// clock with the placing and the round ladder, and a live strip of the heat's scores. It only draws: every number comes in through
// update() from the ride, the judging and the heat (src/main.js), and the popups come from the ride's own events (src/ride.js
// emit()). Nothing here changes a rule.
import { ico } from "./icons.js";
import { comboLayout } from "./competition.js";
import { SPIT_RUN } from "./ride.js";

const PAL = { abyss: "#0A1B2B", sunbleach: "#F3EAD7", flare: "#FF4F2E", sodium: "#FFC21A", lagoon: "#11B5A4", hibiscus: "#E8407F", cobalt: "#2B5CFF" };
const DIAL_SEGMENTS = 12;
const DIAL_EMPTY = "#27465A";
// how long a popup stays, in ride seconds, and how many may be up at once
const LIFE = { barrel: 1.5, spit: 1.9, clean: 1.9, kick: 1.5, wipe: 1.9, tier: 1.1, lost: 1.1 };
const MAX_POPUPS = 3;

/** The dial: a half ring of 12 steps, the tube icon and the time. Built once; update() recolours the steps and sets the numbers. */
function dialSVG() {
  const cx = 130;
  const cy = 150;
  const R = 112;
  const r = 84;
  const p = (a, rad) => [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad];
  let segs = "";
  for (let i = 0; i < DIAL_SEGMENTS; i++) {
    const a0 = Math.PI + (i / DIAL_SEGMENTS) * Math.PI + 0.025;
    const a1 = Math.PI + ((i + 1) / DIAL_SEGMENTS) * Math.PI - 0.025;
    const [x0, y0] = p(a0, R);
    const [x1, y1] = p(a1, R);
    const [x2, y2] = p(a1, r);
    const [x3, y3] = p(a0, r);
    segs += `<path data-seg="${i}" d="M${x0} ${y0}A${R} ${R} 0 0 1 ${x1} ${y1}L${x2} ${y2}A${r} ${r} 0 0 0 ${x3} ${y3}Z" fill="${DIAL_EMPTY}"/>`;
  }
  const plate = `M${cx - R - 6} ${cy + 22}A${R + 6} ${R + 6} 0 0 1 ${cx + R + 6} ${cy + 22}Z`;
  return `<svg class="h-tube" id="h-tube" viewBox="0 0 260 190" aria-label="Tube time">
    <path d="${plate}" fill="#031420" transform="translate(6 6)"/><path d="${plate}" fill="${PAL.abyss}"/>
    ${segs}
    <g transform="translate(${cx - 30} ${cy - 96})" style="color:${PAL.sunbleach}">${ico("tube", 60, PAL.lagoon, PAL.sunbleach)}</g>
    <text id="h-tube-n" x="${cx}" y="${cy + 8}" text-anchor="middle" font-family="Big Shoulders Display" font-weight="900" font-size="64" fill="${PAL.sunbleach}">0.0<tspan font-size="30" dx="3">s</tspan></text>
    <text x="${cx}" y="${cy + 30}" text-anchor="middle" font-family="Archivo" font-stretch="70%" font-weight="800" font-size="13" letter-spacing="2.4" fill="#9fb4c2">TUBE TIME</text>
  </svg>`;
}

const HEX = "M46 4L84 25V67L46 88L8 67V25Z";

/** The HUD's markup (mounted once by src/ui.js mountUI). */
export function hudHTML() {
  const bar = Array.from({ length: comboLayout.segments }, () => "<i></i>").join("");
  return `<div class="hud" id="hud">
    <div class="h-score">
      <small class="cond" id="score-label">Heat score</small>
      <b class="disp" id="score">0.0</b>
      <span class="h-wave cond" id="h-wave"></span>
    </div>
    <svg class="h-mult" id="h-mult" viewBox="0 0 92 92" aria-hidden="true"><path d="${HEX}" fill="#031420" transform="translate(5 5)"/><path d="${HEX}" fill="${PAL.sodium}" stroke="${PAL.abyss}" stroke-width="4"/><path d="M46 4L84 25V67L46 88Z" fill="#F2A900"/><text id="h-mult-t" x="46" y="62" text-anchor="middle" font-family="Big Shoulders Display" font-weight="900" font-size="52" fill="${PAL.abyss}" transform="rotate(-6 46 46)">x1</text></svg>
    <div class="h-combo"><div class="bar" id="h-bar">${bar}</div><div class="tag disp"><span>Combo <b id="h-combo">0</b></span></div></div>
    <div class="h-clock" id="h-clock">
      <div class="t">${ico("clock", 34, PAL.flare, PAL.abyss)}<b class="disp" id="h-time">0:00</b></div>
      <div class="p"><b class="disp" id="h-stand"></b><div class="cond"><span id="h-cap"></span><div class="ladder" id="h-ladder"></div></div></div>
    </div>
    <div id="popups" aria-live="polite"></div>
    <div id="msg"></div>
    ${dialSVG()}
    <div class="h-board" id="h-board"></div>
    <div class="h-event cond" id="priority"></div>
    <button class="h-pause" id="pausebtn" type="button" aria-label="Pause"><i></i><i></i></button>
  </div>`;
}

const BURST = "M105 6L126 52L174 28L158 78L204 96L156 116L172 166L122 142L104 186L86 142L36 168L52 118L6 98L54 80L36 30L84 54Z";

function popupHTML(type, d) {
  switch (type) {
    case "barrel":
      return `<div class="pop barrel"><div class="slab"></div><div class="t disp">Barrel${d.run > 1 ? ` <em>x${d.run}</em>` : ""}</div><div class="pts disp"><span>${d.deep ? "Deep · " : ""}${d.x > 1 ? `Combo x${d.x} · ` : ""}${d.run} s in the tube</span></div></div>`;
    case "spit":
      return `<div class="pop spit"><svg viewBox="0 0 210 190" aria-hidden="true"><path d="${BURST}" fill="#031420" transform="translate(7 7)"/><path d="${BURST}" fill="${PAL.sodium}" stroke="${PAL.abyss}" stroke-width="4" stroke-linejoin="round"/><text x="105" y="118" text-anchor="middle" font-family="Big Shoulders Display" font-weight="900" font-size="74" fill="${PAL.hibiscus}" stroke="${PAL.abyss}" stroke-width="2" paint-order="stroke" transform="rotate(-5 105 100)">SPIT!</text></svg></div>`;
    case "clean":
      return `<div class="pop slabpop clean"><div class="slab"></div><div class="t disp">Clean exit</div></div>`;
    case "kick":
      return `<div class="pop slabpop kick"><div class="slab"></div><div class="t disp">Kick out</div></div>`;
    case "wipe":
      return `<div class="pop slabpop wipe"><div class="slab"></div><div class="t disp">Wipeout</div></div>`;
    case "tier":
      return `<div class="pop chip tier"><span class="disp">Combo x${d.x}</span></div>`;
    case "lost":
      return `<div class="pop chip lost"><span class="disp">Combo lost</span></div>`;
    default:
      throw new Error(`hud: no popup called "${type}"`);
  }
}

/** Mount the controller on the markup of hudHTML(). Returns { update(frame), reset() }. */
export function mountHud(root) {
  const $ = (sel) => {
    const el = root.querySelector(sel);
    if (!el) throw new Error(`hud: missing ${sel}`);
    return el;
  };
  const el = {
    label: $("#score-label"),
    score: $("#score"),
    wave: $("#h-wave"),
    mult: $("#h-mult"),
    multT: $("#h-mult-t"),
    bar: $("#h-bar"),
    combo: $("#h-combo"),
    clock: $("#h-clock"),
    time: $("#h-time"),
    stand: $("#h-stand"),
    cap: $("#h-cap"),
    ladder: $("#h-ladder"),
    popups: $("#popups"),
    tube: $("#h-tube"),
    tubeN: $("#h-tube-n"),
    board: $("#h-board"),
    strip: $("#priority"),
  };
  const segs = [...el.bar.children];
  const dial = [...el.tube.querySelectorAll("[data-seg]")];
  const last = { label: "", score: "", wave: "", mult: 0, combo: -1, lit: -1, time: "", stand: "", cap: "", ladder: "", board: "", strip: "", dial: -1, dialN: "", tubeOn: null };
  let shown = 0; // the big number as drawn (it counts up to the real one)
  let target = 0;
  const popups = []; // { el, type, born, life }
  let prevX = 1;
  let lastMoves = 0; // the chain's length at the last step, so "combo lost" is only said for a chain worth losing

  const set = (key, node, value) => {
    if (last[key] === value) return;
    last[key] = value;
    node.textContent = value;
  };

  function say(type, data, t) {
    // one popup of a kind at a time: the new one replaces the old
    for (let i = popups.length - 1; i >= 0; i--) {
      if (popups[i].type === type || popups.length >= MAX_POPUPS) {
        popups[i].el.remove();
        popups.splice(i, 1);
      }
    }
    const holder = document.createElement("div");
    holder.innerHTML = popupHTML(type, data);
    const node = holder.firstElementChild;
    el.popups.appendChild(node);
    popups.push({ el: node, type, born: t, life: LIFE[type] });
  }

  function reset() {
    for (const p of popups) p.el.remove();
    popups.length = 0;
    shown = 0;
    target = 0;
    prevX = 1;
    lastMoves = 0;
    last.score = last.mult = last.combo = last.lit = last.dial = -1;
    last.dialN = last.label = last.wave = "";
  }

  /**
   * f: { dt, t (ride clock), points (the big number is a count of points), score (its value), decimals, label, wave, combo { points, moves, x, broke },
   *      clock { text, standing, caption, round, rounds }, board [{ name, value, you, color }], strip, tube { total, run, inTube, spit },
   *      events [ride events] }
   */
  function update(f) {
    // -- the big number: counts up to the real one (points) or follows it (a judged score)
    target = f.score;
    if (f.points) {
      shown += (target - shown) * Math.min(1, f.dt * 9);
      if (Math.abs(target - shown) < 0.6) shown = target;
    } else {
      shown = target;
    }
    set("label", el.label, f.label);
    set("score", el.score, f.points ? Math.round(shown).toLocaleString("en-US") : shown.toFixed(f.decimals ?? 1));
    set("wave", el.wave, f.wave || "");

    // -- combo: the meter, the count and the multiplier
    const c = f.combo;
    if (c.points !== last.lit) {
      last.lit = c.points;
      segs.forEach((seg, i) => {
        const third = comboLayout.segments / 3;
        seg.className = i < c.points ? (i < third ? "a" : i < third * 2 ? "b" : "c") : "";
      });
    }
    if (c.moves !== last.combo) {
      last.combo = c.moves;
      el.combo.textContent = String(c.moves);
    }
    if (c.x !== last.mult) {
      last.mult = c.x;
      el.multT.textContent = `x${c.x}`;
      el.mult.classList.toggle("on", c.x > 1);
      el.mult.classList.remove("bump");
      if (c.x > 1) {
        void el.mult.getBoundingClientRect(); // restart the one-step bump
        el.mult.classList.add("bump");
      }
    }

    // -- the clock block
    const k = f.clock;
    set("time", el.time, k.text);
    set("stand", el.stand, k.standing || "");
    set("cap", el.cap, k.caption || "");
    el.clock.classList.toggle("free", !k.standing);
    const ladderKey = `${k.round}|${(k.rounds || []).join(",")}`;
    if (last.ladder !== ladderKey) {
      last.ladder = ladderKey;
      el.ladder.innerHTML = (k.rounds || []).map((_, i) => `<i class="${i < k.round ? "k" : i === k.round ? "m" : ""}"></i>`).join("");
    }

    // -- the heat's scores
    const boardKey = f.board.map((b) => `${b.name}|${b.value}|${b.you ? 1 : 0}|${b.color}`).join(";");
    if (last.board !== boardKey) {
      last.board = boardKey;
      el.board.innerHTML = f.board.map((b) => `<div class="${b.you ? "y" : ""}" style="--c:${b.color}"><span class="n cond">${b.name}</span><span class="v disp">${b.value}</span></div>`).join("");
    }
    set("strip", el.strip, f.strip || "");
    el.strip.hidden = !f.strip;

    // -- the tube dial: how far the tube run is toward the spit, and the tube time of the wave
    const lit = f.tube.spit ? DIAL_SEGMENTS : Math.min(DIAL_SEGMENTS, Math.floor((f.tube.run / SPIT_RUN) * DIAL_SEGMENTS + 1e-6));
    const dialKey = lit * 2 + (f.tube.spit ? 1 : 0);
    if (dialKey !== last.dial) {
      last.dial = dialKey;
      dial.forEach((seg, i) => seg.setAttribute("fill", i < lit ? (f.tube.spit || i === lit - 1 ? PAL.sodium : PAL.lagoon) : DIAL_EMPTY));
    }
    const n = f.tube.total.toFixed(1);
    if (n !== last.dialN) {
      last.dialN = n;
      el.tubeN.firstChild.nodeValue = n;
    }
    if (last.tubeOn !== f.tube.inTube) {
      last.tubeOn = f.tube.inTube;
      el.tube.classList.toggle("on", f.tube.inTube);
    }

    // -- popups: the ride's own events, then the combo's
    let rideX = c.x;
    for (const e of f.events) {
      if (e.type === "tube") say("barrel", { run: e.run, deep: e.deep, x: rideX }, f.t);
      else if (e.type === "spit") say("spit", {}, f.t);
      else if (e.type === "clean") say("clean", {}, f.t);
      else if (e.type === "kick") say("kick", {}, f.t);
      else if (e.type === "wipe") say("wipe", {}, f.t);
    }
    if (c.broke && lastMoves >= 3) say("lost", {}, f.t);
    if (c.x > prevX) say("tier", { x: c.x }, f.t);
    prevX = c.x;
    lastMoves = c.moves;
    for (let i = popups.length - 1; i >= 0; i--) {
      if (f.t - popups[i].born >= popups[i].life) {
        popups[i].el.remove();
        popups.splice(i, 1);
      }
    }
  }

  return { update, reset, get popups() { return popups.map((p) => p.type); } };
}
