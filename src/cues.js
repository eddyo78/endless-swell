// In-ride coaching cues, drawn from the ride state only (nothing here changes a rule):
//   - a warning line for the one thing that will hurt you next (shark, loose board, reef, closeout, lip, too high), with the way out;
//   - a pump ring that closes on the beat (the next pump is worth the most when the ring meets the circle) and a word for the last pump;
//   - a tube bar under the HUD: how long this tube has run, and how far the run is toward the spit.
// Its own markup and styles, so the menu and HUD files can change without touching it.
import { PUMP_BEAT } from "./ride.js";

const SPIT_AT = 6.2; // seconds of tube run that open the spit (ride.js)

const CSS = `
#cue-warn { position: fixed; top: 33%; left: 0; right: 0; text-align: center; pointer-events: none; z-index: 2; opacity: 0; transition: opacity .12s;
  font: italic 800 clamp(20px, 3.6vw, 40px)/1.1 "Barlow Condensed", "Arial Narrow", Impact, system-ui, sans-serif; letter-spacing: .04em; text-transform: uppercase;
  text-shadow: 0 2px 0 #000a, 0 4px 18px #000c; color: #ffd66b; }
#cue-warn.act { color: #ff6a6a; animation: cue-flash .5s steps(2, jump-none) infinite; }
@keyframes cue-flash { 50% { opacity: .55; } }
#cue-pump { position: fixed; left: 50%; bottom: 13%; width: 84px; height: 84px; margin-left: -42px; pointer-events: none; z-index: 2; opacity: 0; transition: opacity .2s; }
#cue-pump .target { position: absolute; inset: 21px; border: 3px solid #eaffffcc; border-radius: 50%; box-shadow: 0 0 10px #0008; }
#cue-pump .close { position: absolute; inset: 0; border: 3px solid #2fe0c0; border-radius: 50%; transform: scale(1); box-shadow: 0 0 12px #2fe0c088; }
#cue-pump .word { position: absolute; left: -30px; right: -30px; top: 92px; text-align: center; font: italic 800 20px/1 "Barlow Condensed", "Arial Narrow", Impact, sans-serif;
  letter-spacing: .08em; text-transform: uppercase; text-shadow: 0 2px 8px #000c; opacity: 0; }
#cue-pump .word.show { opacity: 1; transition: none; }
#cue-tube { position: fixed; top: 112px; left: 18px; width: 190px; pointer-events: none; z-index: 2; opacity: 0; transition: opacity .25s; text-shadow: 0 2px 8px #000b; }
#cue-tube small { display: block; font: 700 10px/1 "Barlow", system-ui, sans-serif; letter-spacing: .2em; margin-bottom: 4px; }
#cue-tube .bar { height: 7px; border-radius: 4px; background: #ffffff26; overflow: hidden; }
#cue-tube .fill { height: 100%; width: 0; background: #2fe0c0; }
#cue-tube.deep .fill { background: #ffb23e; }
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
    <div id="cue-tube"><small></small><div class="bar"><div class="fill"></div></div></div>
  `;
  document.body.appendChild(root);
  const warn = root.querySelector("#cue-warn");
  const pump = root.querySelector("#cue-pump");
  const close = pump.querySelector(".close");
  const word = pump.querySelector(".word");
  const tube = root.querySelector("#cue-tube");
  const tubeLabel = tube.querySelector("small");
  const fill = tube.querySelector(".fill");
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
      close.style.borderColor = since > PUMP_BEAT + 0.2 ? "#ffffff66" : "#2fe0c0";
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
      let color = "#2fe0c0";
      if (q < 0.25) {
        text = gap < 0 ? "TOO FAST" : "TOO SLOW";
        color = "#ff8f6a";
      } else if (q < 0.7) {
        text = "GOOD";
        color = "#eaffff";
      }
      if (ride.stats.pumps > 1 || q < 0.7) {
        word.textContent = text;
        word.style.color = color;
        word.classList.add("show");
        wordT = ride.t;
      }
    }
    if (word.classList.contains("show") && ride.t - wordT > 0.55) word.classList.remove("show");
    // tube bar
    if (riding && (ride.inTube || ride.tubeRun > 0)) {
      tube.style.opacity = "1";
      tube.className = ride.deep ? "deep" : "";
      if (ride.spitDone) {
        tubeLabel.textContent = "SPIT!";
        fill.style.width = "100%";
      } else {
        tubeLabel.textContent = ride.deep ? "DEEP · SPIT AHEAD" : ride.tubeRun >= SPIT_AT ? "GO DEEPER FOR THE SPIT" : "IN THE TUBE · " + ride.tubeRun.toFixed(1) + "s";
        fill.style.width = Math.min(100, (ride.tubeRun / SPIT_AT) * 100).toFixed(1) + "%";
      }
    } else {
      tube.style.opacity = "0";
    }
  }

  return { update };
}
