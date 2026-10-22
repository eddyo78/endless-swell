// In-ride coaching cues, drawn from the ride state only (nothing here changes a rule):
//   - a warning line for the one thing that will hurt you next (shark, loose board, reef, closeout, lip, too high), with the way out;
//   - a pump ring that closes on the beat (the next pump is worth the most when the ring meets the circle) and a word for the last pump;
// (The tube-time dial itself is in src/hud.js; this file keeps one coaching line over it.)
// Its own markup and styles, so the menu and HUD files can change without touching it.
import { PUMP_BEAT, SPIT_RUN } from "./ride.js";

const CSS = `
#cue-warn { position: fixed; top: calc(88 * var(--u)); left: 50%; transform: translateX(-50%) skewX(-9deg); pointer-events: none; z-index: 2; opacity: 0; transition: opacity .12s;
  padding: 6px 18px 4px; background: var(--abyss); color: var(--sodium); box-shadow: 5px 5px 0 #031420b3; max-width: calc(100% - 24px); text-align: center;
  font: 800 clamp(18px, 3.2vw, 36px)/1.05 var(--disp); letter-spacing: .03em; text-transform: uppercase; }
#cue-warn.act { background: var(--flare); color: var(--sunbleach); animation: cue-flash .5s steps(2, jump-none) infinite; }
@keyframes cue-flash { 50% { opacity: .6; } }
#cue-pump { position: fixed; left: 50%; bottom: 17%; width: 84px; height: 84px; margin-left: -42px; pointer-events: none; z-index: 2; opacity: 0; transition: opacity .2s; }
#cue-pump .target { position: absolute; inset: 21px; border: 4px solid var(--sunbleach); border-radius: 50%; box-shadow: 3px 3px 0 #031420b3; }
#cue-pump .close { position: absolute; inset: 0; border: 4px solid var(--lagoon); border-radius: 50%; transform: scale(1); }
#cue-pump .word { position: absolute; left: -30px; right: -30px; top: 92px; text-align: center; font: 900 22px/1 var(--disp);
  letter-spacing: .08em; text-transform: uppercase; text-shadow: 2px 2px 0 #031420; opacity: 0; }
#cue-pump .word.show { opacity: 1; transition: none; }
#cue-tube { position: fixed; bottom: calc(var(--dial-bottom) + var(--dial-h) + 6px); left: var(--dial-left); transform: skewX(-9deg); pointer-events: none; z-index: 2; opacity: 0; transition: opacity .25s;
  padding: 4px 12px 3px; background: var(--lagoon); color: var(--abyss); box-shadow: 4px 4px 0 #031420b3; white-space: nowrap; font: 800 15px/1 var(--text); font-stretch: 70%; letter-spacing: .12em; text-transform: uppercase; }
#cue-tube.deep { background: var(--sodium); }

@media (max-width: 700px), (max-aspect-ratio: 1 / 1) { #cue-warn { top: calc(188 * var(--u)); } }
`;

export function mountCues() {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement("div");
  root.id = "cues";
  root.innerHTML = `
    <div id="cue-warn"></div>
    <div id="cue-pump"><div class="target"></div><div class="close"></div><div class="word"></div></div>
    <div id="cue-tube"></div>
  `;
  document.body.appendChild(root);
  const warn = root.querySelector("#cue-warn");
  const pump = root.querySelector("#cue-pump");
  const close = pump.querySelector(".close");
  const word = pump.querySelector(".word");
  const tube = root.querySelector("#cue-tube");
  let lastFxT = -10;
  let wordT = -10;
  let lastWarn = "";

  /** `live`: the HUD is up (a heat wave or free surf is on the water). `ride`: the ride state from ride.js. */
  function update(ride, live, thr) {
    const riding = live && ride.mode === "ride";
    // warnings
    const w = riding ? ride.warn : null;
    if (w && w.level > 0) {
      if (w.text !== lastWarn) warn.textContent = w.text;
      lastWarn = w.text;
      warn.className = w.level > 1 ? "act" : "";
      warn.style.opacity = "1";
    } else {
      lastWarn = "";
      warn.style.opacity = "0";
    }
    // pump ring: shows from the first pump, closes on the next beat after the last one
    if (riding && ride.stats.pumps > 0) {
      const since = ride.t - ride.lastPump;
      const k = Math.max(0, 1 - since / PUMP_BEAT); // 1 at the pump, 0 on the beat
      close.style.transform = `scale(${(1 + k * 0.9).toFixed(3)})`;
      close.style.borderColor = since > PUMP_BEAT + 0.2 ? "#F3EAD766" : "#11B5A4";
      pump.style.opacity = since < 2.5 ? "1" : "0";
    } else {
      pump.style.opacity = "0";
    }
    // the word for the last pump
    if (riding && ride.pumpFx.t !== lastFxT) {
      lastFxT = ride.pumpFx.t;
      const q = ride.pumpFx.q;
      const gap = ride.pumpFx.gap;
      let text = "PERFECT";
      let color = "#11B5A4";
      if (q < 0.25) {
        text = gap < 0 ? "TOO FAST" : "TOO SLOW";
        color = "#FF4F2E";
      } else if (q < 0.7) {
        text = "GOOD";
        color = "#F3EAD7";
      }
      if (ride.stats.pumps > 1 || q < 0.7) {
        word.textContent = text;
        word.style.color = color;
        word.classList.add("show");
        wordT = ride.t;
      }
    }
    if (word.classList.contains("show") && ride.t - wordT > 0.55) word.classList.remove("show");
    // the coaching line over the tube dial: what the run needs next (the dial itself is in the HUD)
    if (riding && (ride.inTube || ride.tubeRun > 0) && !ride.spitDone && ride.tubeRun > 1.7) {
      tube.style.opacity = "1";
      tube.className = ride.deep ? "deep" : "";
      tube.textContent = ride.deep ? "Deep: the spit is ahead" : ride.tubeRun >= SPIT_RUN ? "Go deeper for the spit" : "In the tube: hold the line";
    } else {
      tube.style.opacity = "0";
    }
  }

  return { update };
}
