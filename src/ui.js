import { catalog } from "./save.js";
import { locationById, specialLabel } from "./competition.js";

const $ = (sel, root = document) => root.querySelector(sel);

export function mountUI() {
  const root = document.getElementById("ui");
  root.innerHTML = `
    <div class="hud" id="hud">
      <div><small>TUBE</small><span id="tube">0.0s</span></div>
      <div><small>SPEED</small><span id="speed">0</span></div>
      <div><small id="score-label">SCORE</small><span id="score">0</span></div>
      <div id="heat-readout"><small>HEAT</small><span id="heat-score">–</span></div>
    </div>
    <div class="btns">
      <button id="qbtn" type="button">Quality</button>
      <button id="rbtn" type="button">Restart (R)</button>
    </div>
    <div id="priority"></div>
    <div id="msg"></div>
    <div id="pocket"><div id="depthbar"></div></div>
    <div id="fps"></div>
    <div id="panels"></div>
  `;
  return {
    hud: $("#hud"),
    tube: $("#tube"),
    speed: $("#speed"),
    score: $("#score"),
    scoreLabel: $("#score-label"),
    heatReadout: $("#heat-readout"),
    heatScore: $("#heat-score"),
    priority: $("#priority"),
    msg: $("#msg"),
    depth: $("#depthbar"),
    fps: $("#fps"),
    panels: $("#panels"),
    qbtn: $("#qbtn"),
    rbtn: $("#rbtn"),
  };
}

function card(html) {
  return `<div class="panel show"><div class="card">${html}</div></div>`;
}

export function menuHTML(save) {
  const tones = catalog.skinTones.map((t) => {
    const on = t.color.toLowerCase() === save.loadout.skin.toLowerCase() ? " on" : "";
    return `<button type="button" class="swatch${on}" data-skin="${t.color}" style="background:${t.color}" title="${t.name}"></button>`;
  }).join("");
  return card(`
    <h1>ENDLESS SWELL</h1>
    <p class="sub">TEAHUPO'O · TAHITI</p>
    <p class="lead">A left-hand reef barrel with no horizon. Tour ${save.nextTour} is waiting.</p>
    <div class="row"><span class="label">Skin</span><div class="swatches">${tones}</div></div>
    <div class="actions">
      <button class="big" id="play-free" type="button">Free surf</button>
      <button class="big alt" id="play-tour" type="button">Tour ${save.nextTour}</button>
      <button class="ghost" id="open-locker" type="button">Locker</button>
    </div>
    <div class="ctl">
      <span><kbd>←</kbd> <kbd>A</kbd></span><span>Toward the wall</span>
      <span><kbd>→</kbd> <kbd>D</kbd></span><span>Toward the trough</span>
      <span><kbd>↑</kbd> <kbd>W</kbd> <kbd>Space</kbd></span><span>Pump — timed for speed</span>
      <span><kbd>↓</kbd> <kbd>S</kbd></span><span>Stall</span>
      <span>Touch</span><span>Drag left/right to steer, up to pump, down to stall</span>
    </div>
  `);
}

export function lockerHTML(save) {
  const byId = Object.fromEntries([...catalog.outfits, ...catalog.boards, ...catalog.bodies].map((i) => [i.id, i]));
  const group = (title, items, equipped) => {
    const cells = items.map((item) => {
      const owned = save.owned.includes(item.id);
      const on = equipped(item) ? " on" : "";
      const flag = item.tier === "premium" ? `Premium · ${item.price}` : item.reward && !owned ? item.reward : owned ? "Owned" : "Locked";
      return `<button type="button" class="item${on}${owned ? "" : " locked"}" data-equip="${item.id}" ${owned ? "" : "disabled"}>
        <b>${item.name}</b><small>${flag}</small>
      </button>`;
    }).join("");
    return `<div class="group"><h3>${title}</h3><div class="items">${cells}</div></div>`;
  };
  const bottoms = catalog.outfits.filter((i) => i.style === "trunks" || i.style === "bikini" || i.style === "onesie");
  const tops = catalog.outfits.filter((i) => i.style === "rash");
  return card(`
    <h1>LOCKER</h1>
    <p class="sub">EARNED GEAR · PREMIUM STAYS LOCKED</p>
    ${group("Body", catalog.bodies, (i) => save.loadout.body === i.id)}
    ${group("Trunks, bikini, fullsuit", bottoms, (i) => save.loadout.bottom === i.id)}
    ${group("Top", tops, (i) => save.loadout.top === i.id)}
    <div class="row"><button type="button" class="ghost" id="clear-top">No top</button></div>
    ${group("Boards", catalog.boards, (i) => save.loadout.board === i.id)}
    <p class="fine">Premium prices are placeholders. Nothing is charged.</p>
    <button class="big" id="locker-back" type="button">Back</button>
  `);
}

export function briefHTML(tour) {
  const called = locationById[tour.locationId];
  const played = locationById[tour.playedId];
  const moved = called.id !== played.id;
  const hazards = [
    tour.sharks.length ? `${tour.sharks.length} shark${tour.sharks.length > 1 ? "s" : ""}` : null,
    tour.reef.length ? "exposed reef" : null,
    tour.zones.length ? "closeout sections" : null,
    tour.boards.length ? "loose boards" : null,
  ].filter(Boolean);
  return card(`
    <h1>TOUR ${tour.n}${tour.champ ? " · CHAMPIONSHIP" : ""}</h1>
    <p class="sub">${played.name.toUpperCase()} · ${played.region.toUpperCase()}</p>
    <ul class="facts">
      <li><b>${tour.feet.toFixed(1)} ft</b> swell</li>
      <li>Wind ${tour.windName}</li>
      <li>Tide ${tour.tide}</li>
      <li>${tour.look}</li>
      <li>${specialLabel(tour.special)}</li>
      <li>${hazards.length ? hazards.join(", ") : "clean lineup"}</li>
    </ul>
    ${moved ? `<p class="fine">${called.name} is still locked. This heat is drawn on the Tahiti reef.</p>` : ""}
    <p class="fine">Heat is best two waves, each judged to 10. Priority holder chooses first. Interference cuts the wave in half.</p>
    <div class="actions">
      <button class="big" id="begin-heat" type="button">Paddle out</button>
      <button class="ghost" id="brief-back" type="button">Menu</button>
    </div>
  `);
}

export function freeEndHTML(result, best) {
  const parts = result.parts || {};
  const rows = Object.entries(parts).map(([k, v]) => `<li>${k}<b>${v}</b></li>`).join("");
  return card(`
    <h1>${result.wipe ? "Wipeout" : "Wave"}</h1>
    <p class="scoreline">${result.total.toFixed(1)}<small>/10</small></p>
    <ul class="facts">${rows}</ul>
    <p class="fine">Best free-surf score ${best.toFixed(1)}</p>
    <div class="actions">
      <button class="big" id="again" type="button">Go again</button>
      <button class="ghost" id="free-menu" type="button">Menu</button>
    </div>
  `);
}

export function heatResultHTML(view) {
  const you = view.playerWaves.map((w) => `<li>${w.total.toFixed(1)}${w.interference ? " interference" : ""}${w.wipe ? " wipe" : ""}</li>`).join("") || "<li>—</li>";
  const them = view.rivalWaves.map((w) => `<li>${w.total.toFixed(1)}${w.interference ? " interference" : ""}</li>`).join("") || "<li>—</li>";
  return card(`
    <h1>${view.won ? "Heat won" : "Heat lost"}</h1>
    <p class="sub">${view.roundName.toUpperCase()} · VS ${view.rivalName.toUpperCase()}</p>
    <p class="scoreline">${view.playerTotal.toFixed(1)} <small>to</small> ${view.rivalTotal.toFixed(1)}</p>
    <div class="split">
      <div><h3>You</h3><ul class="facts">${you}</ul></div>
      <div><h3>${view.rivalName}</h3><ul class="facts">${them}</ul></div>
    </div>
    <p class="fine">${view.note}</p>
    <div class="actions">
      ${view.won && !view.champion ? `<button class="big" id="next-heat" type="button">Next heat</button>` : ""}
      ${view.champion || !view.won ? `<button class="big" id="tour-done" type="button">Results</button>` : ""}
      <button class="ghost" id="heat-menu" type="button">Menu</button>
    </div>
  `);
}

export function tourEndHTML(view) {
  const reward = view.reward ? `<p class="lead">Earned: ${view.reward.name}</p>` : `<p class="fine">No new gear this time.</p>`;
  return card(`
    <h1>${view.place === 1 ? `Tour ${view.tourN} champion` : `Tour ${view.tourN}`}</h1>
    <p class="sub">${view.place === 1 ? "THE REEF IS YOURS" : `FINISHED ${ordinal(view.place)}`}</p>
    ${reward}
    <p class="fine">${view.place === 1 ? `Tour ${view.tourN + 1} is open.` : "Same draw if you run it again."}</p>
    <div class="actions">
      ${view.place === 1 ? `<button class="big" id="next-tour" type="button">Tour ${view.tourN + 1}</button>` : `<button class="big" id="retry-tour" type="button">Retry tour</button>`}
      <button class="ghost" id="end-menu" type="button">Menu</button>
    </div>
  `);
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function bindPanel(root, handlers) {
  root.querySelectorAll("[data-skin]").forEach((btn) => btn.addEventListener("click", () => handlers.skin(btn.dataset.skin)));
  root.querySelectorAll("[data-equip]").forEach((btn) => btn.addEventListener("click", () => handlers.equip(btn.dataset.equip)));
  const map = {
    "play-free": "free",
    "play-tour": "tour",
    "open-locker": "locker",
    "locker-back": "menu",
    "clear-top": "clearTop",
    "begin-heat": "begin",
    "brief-back": "menu",
    again: "free",
    "free-menu": "menu",
    "next-heat": "next",
    "tour-done": "done",
    "heat-menu": "menu",
    "next-tour": "tour",
    "retry-tour": "tour",
    "end-menu": "menu",
  };
  for (const [id, key] of Object.entries(map)) {
    const el = root.querySelector("#" + id);
    if (el && handlers[key]) el.addEventListener("click", handlers[key]);
  }
}
