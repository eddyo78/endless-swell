import { boardsAll, bottomsFor, catalog } from "./save.js";
import { locationById, stopStatus, twistLabel } from "./competition.js";
import { PITY_LIMIT, eventLabel, isFinale, rankInfo } from "./season.js";

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

const FINISH_NAME = { 1: "Winner", 2: "Runner-up", 4: "Semifinal (top 4)", 8: "Quarterfinal", 16: "Round of 16" };
const TROPHY_NAME = { 1: "Champion", 2: "Runner-up", 4: "Top 4" };

function rankLine(points) {
  const r = rankInfo(points);
  return `${r.title} · ${points} pts · ${r.toNext} to ${r.nextTitle}`;
}

function shelfHTML(trophies) {
  if (!trophies.length) return `<p class="fine shelf">Trophy shelf: empty. Finish in the top 4 of a Season Finale to put the first trophy on it.</p>`;
  const chips = trophies
    .slice(-8)
    .reverse()
    .map((t) => `<span class="trophy t${t.place}" title="Season ${t.season} Finale">Season ${t.season} · ${TROPHY_NAME[t.place]}</span>`)
    .join("");
  return `<div class="shelf"><span class="label">Trophy shelf · ${trophies.length}</span><div class="trophies">${chips}</div></div>`;
}

export function menuHTML(save) {
  const tones = catalog.skinTones.map((t) => {
    const on = t.color.toLowerCase() === save.loadout.skin.toLowerCase() ? " on" : "";
    return `<button type="button" class="swatch${on}" data-skin="${t.color}" style="background:${t.color}" title="${t.name}"></button>`;
  }).join("");
  const bodies = catalog.bodies.map((b) => {
    const on = save.loadout.body === b.id ? " on" : "";
    return `<button type="button" class="bodybtn${on}" data-body="${b.id}">${b.name}</button>`;
  }).join("");
  const label = eventLabel(save.season, save.event);
  const finale = isFinale(save.event) ? " It is the Season Finale." : "";
  return card(`
    <h1>ENDLESS SWELL</h1>
    <p class="sub">TEAHUPO'O · TAHITI</p>
    <p class="lead">A left-hand reef barrel with no horizon. ${label} is waiting.${finale}</p>
    <p class="rank"><span class="label">Rank</span> ${rankLine(save.points)}</p>
    ${shelfHTML(save.trophies)}
    <div class="row pickers">
      <span class="label">Surfer</span><div class="bodybtns">${bodies}</div>
      <span class="label">Skin</span><div class="swatches">${tones}</div>
    </div>
    <div class="actions">
      <button class="big" id="play-free" type="button">Free surf</button>
      <button class="big alt" id="play-tour" type="button">${label}</button>
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

// The Locker is a studio preview of the surfer (drawn on the canvas by src/locker.js) beside a scrollable grid of cards. Each card
// has a picture (a canvas that src/locker.js fills with a rendering of the item), its name and its rarity or price. A locked
// item can be tried on in the preview but never worn.
export function lockerShellHTML() {
  return `<div class="panel lk">
    <div class="lk-stage" id="lk-view" aria-label="Surfer preview. Drag to turn."><div class="lk-badge" id="lk-badge"></div><div class="lk-hint"><span class="when-ready">Drag to turn</span><span class="when-wait">Setting up the studio…</span></div></div>
    <div class="lk-side">
      <div class="lk-head"><h1>LOCKER</h1><p class="sub">EARNED GEAR · PREMIUM STAYS LOCKED</p><p class="fine" id="lk-fine"></p></div>
      <div class="lk-scroll" id="lk-list"></div>
      <div class="lk-foot"><p class="fine">Premium prices are placeholders. Nothing is charged.</p><button class="big" id="locker-back" type="button">Back</button></div>
    </div>
  </div>`;
}

export function rarityOf(item) {
  if (item.tier === "premium") return "premium";
  return item.reward || "basic";
}

export function itemFlag(item, owned) {
  if (item.tier === "premium") return `Premium · ${item.price}`;
  if (item.generated) return `Earned · ${item.reward}`;
  if (owned) return "Owned";
  return item.reward ? `Locked · ${item.reward}` : "Locked";
}

/** The Locker's fine-print line: gear count and the pity counter. */
export function lockerFine(save) {
  return `${save.gear.length} piece${save.gear.length === 1 ? "" : "s"} won by placement. Gear is guaranteed after ${PITY_LIMIT} finishes without it (now ${save.pity}).`;
}

/**
 * The cards of the active body: body, its outfits, boards. selected is the id on the preview (or null). Every card is a button
 * with data-equip; a card the save does not own is marked locked and previews only.
 */
export function lockerListHTML(save, selected = null) {
  const group = (title, list, equipped) => {
    // generated gear: only what this save owns, newest first, after the authored pieces
    const authored = list.filter((i) => !i.generated);
    const earned = list
      .filter((i) => i.generated && save.owned.includes(i.id))
      .sort((a, b) => save.owned.indexOf(b.id) - save.owned.indexOf(a.id));
    const cells = [...authored, ...earned].map((item) => {
      const owned = save.owned.includes(item.id);
      const worn = equipped(item);
      const cls = ["item", `r-${rarityOf(item)}`, worn ? "on" : "", owned ? "" : "locked", selected === item.id ? "sel" : ""].filter(Boolean).join(" ");
      const tag = worn ? "EQUIPPED" : owned ? "" : item.tier === "premium" ? "PREMIUM" : "LOCKED";
      return `<button type="button" class="${cls}" data-equip="${item.id}" ${owned ? "" : 'data-locked="1" aria-disabled="true"'}>
        <span class="thumb"><canvas width="160" height="160"></canvas>${tag ? `<i class="tag">${tag}</i>` : ""}</span>
        <b>${item.name}</b><small>${itemFlag(item, owned)}</small>
      </button>`;
    }).join("");
    return `<div class="group"><h3>${title}</h3><div class="items">${cells}</div></div>`;
  };
  // Only the active body's outfits are shown; the other body's items appear when that body is picked.
  const body = save.loadout.body;
  const bodyName = catalog.bodies.find((b) => b.id === body).name;
  const bottoms = bottomsFor(body);
  return [
    group("Body", catalog.bodies, (i) => save.loadout.body === i.id),
    group(body === "male" ? `${bodyName}: board shorts` : `${bodyName}: sets (bikini, rashguard, suits)`, bottoms, (i) => save.loadout.bottom === i.id),
    group("Boards", boardsAll(), (i) => save.loadout.board === i.id),
  ].join("");
}

function windText(tour) {
  if (!tour.windPush) return `Wind ${tour.windName}`;
  return `Wind sideshore · pushes you ${tour.windPush > 0 ? "toward the wall" : "down toward the trough"}`;
}

export function briefHTML(tour, attempt = 0) {
  const called = locationById[tour.locationId];
  const played = locationById[tour.playedId];
  const status = stopStatus(called);
  const hazards = [
    tour.sharks.length ? `${tour.sharks.length} shark${tour.sharks.length > 1 ? "s" : ""}` : null,
    tour.reef.length ? "exposed reef" : null,
    tour.zones.length ? "closeout sections" : null,
    tour.boards.length ? "loose boards" : null,
  ].filter(Boolean);
  const rules = tour.twists.map((id) => `<li>${twistLabel(id)}</li>`).join("");
  const stopNote =
    status === "locked"
      ? `<p class="fine">${called.name} is locked (a premium break). This stop is surfed at ${played.name}.</p>`
      : status === "soon"
        ? `<p class="fine">${called.name} is free but not built yet. This stop is surfed at ${played.name}.</p>`
        : "";
  return card(`
    <h1>${eventLabel(tour.season, tour.event).toUpperCase()}</h1>
    <p class="sub">${tour.finale ? "SEASON FINALE · " : ""}${called.name.toUpperCase()} · ${called.region.toUpperCase()}${status === "open" ? "" : ` · ${status === "locked" ? "LOCKED" : "NOT BUILT YET"}`}</p>
    <ul class="facts">
      <li><b>${tour.feet.toFixed(1)} ft</b> swell</li>
      <li>${windText(tour)}</li>
      <li>Tide ${tour.tide}</li>
      <li>${tour.look}</li>
      ${tour.finale ? "<li>Season Finale — a heavier swell and a sharper field</li>" : ""}
      ${rules || (tour.finale ? "" : "<li>Standard heat</li>")}
      <li>${hazards.length ? hazards.join(", ") : "clean lineup"}</li>
    </ul>
    ${stopNote}
    <p class="fine">Top 4 moves you on; winning pays more. Heat: ${tour.heatSeconds} seconds, ${tour.waveCap > 2 ? `up to ${tour.waveCap} waves, the best two count` : "two waves, both count"}, each judged to 10. Priority holder chooses first. Interference cuts the wave in half.${attempt ? ` Attempt ${attempt + 1}: same conditions, a new draw.` : ""}</p>
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
    ${view.bank ? `<p class="fine">Leaving now keeps your ${FINISH_NAME[view.bank].toLowerCase()} finish.</p>` : ""}
    <div class="actions">
      ${view.won && !view.champion ? `<button class="big" id="next-heat" type="button">Next heat</button>` : ""}
      ${view.champion || !view.won ? `<button class="big" id="tour-done" type="button">Results</button>` : ""}
      <button class="ghost" id="heat-menu" type="button">Menu</button>
    </div>
  `);
}

export function tourEndHTML(view) {
  const r = view.settled;
  const label = eventLabel(r.season, r.event);
  const title = r.place === 1 ? (r.finale ? "Season champion" : "Event won") : r.advanced ? "Top 4 · you advance" : "Out of the event";
  const rankUp = r.rankAfter.index > r.rankBefore.index;
  const gear = r.gear
    ? `<p class="lead">Earned: ${r.gear.name} <small>(${r.tier})</small></p>${r.kit ? `<p class="lead">Kit: ${r.kit.name} <small>(matching ${r.kit.shape ? "board" : "board shorts"})</small></p>` : ""}${r.pityGuarantee ? `<p class="fine">Guaranteed after ${PITY_LIMIT} finishes without gear.</p>` : ""}`
    : `<p class="fine">No new gear this time. Gear is guaranteed after ${PITY_LIMIT} finishes without it (now ${view.pity}).</p>`;
  const trophy = r.trophy ? `<p class="lead trophyline">Trophy for the shelf: Season ${r.season} Finale · ${TROPHY_NAME[r.place]}</p>` : "";
  const next = r.advanced
    ? r.newSeason
      ? `Season ${r.next.season} begins: a new calendar and a new rival field, starting easier than this one ended.`
      : `${eventLabel(r.next.season, r.next.event)} is open.`
    : `A top-4 finish (winning the quarterfinal) moves you on. Retry keeps these conditions and draws a fresh bracket.`;
  return card(`
    <h1>${title}</h1>
    <p class="sub">${label.toUpperCase()} · ${FINISH_NAME[r.place].toUpperCase()}</p>
    <p class="lead">+${r.points} ranking points${r.finale ? " <small>(Season Finale pays half again)</small>" : ""}</p>
    <p class="rank">${rankUp ? `<b>Rank up: ${r.rankBefore.title} → ${r.rankAfter.title}</b><br>` : ""}<span class="label">Rank</span> ${rankLine(r.rankAfter.points)}</p>
    ${trophy}
    ${gear}
    <p class="fine">${next}</p>
    <div class="actions">
      ${r.advanced ? `<button class="big" id="next-tour" type="button">${eventLabel(r.next.season, r.next.event)}</button>` : `<button class="big" id="retry-tour" type="button">Retry event</button>`}
      <button class="ghost" id="end-menu" type="button">Menu</button>
    </div>
  `);
}

export function bindPanel(root, handlers) {
  root.querySelectorAll("[data-skin]").forEach((btn) => btn.addEventListener("click", () => handlers.skin(btn.dataset.skin)));
  root.querySelectorAll("[data-body]").forEach((btn) => btn.addEventListener("click", () => handlers.body(btn.dataset.body)));
  root.querySelectorAll("[data-equip]").forEach((btn) => btn.addEventListener("click", () => handlers.equip(btn.dataset.equip)));
  const map = {
    "play-free": "free",
    "play-tour": "tour",
    "open-locker": "locker",
    "locker-back": "menu",
    "begin-heat": "begin",
    "brief-back": "menu",
    again: "free",
    "free-menu": "menu",
    "next-heat": "next",
    "tour-done": "done",
    "heat-menu": "heatMenu",
    "next-tour": "tour",
    "retry-tour": "tour",
    "end-menu": "menu",
  };
  for (const [id, key] of Object.entries(map)) {
    const el = root.querySelector("#" + id);
    if (el && handlers[key]) el.addEventListener("click", handlers[key]);
  }
}
