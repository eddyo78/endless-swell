import { boardsAll, bottomsFor, catalog } from "./save.js";
import { locationById, stopStatus, twistLabel } from "./competition.js";
import { PITY_LIMIT, eventLabel, isFinale, rankInfo } from "./season.js";

const $ = (sel, root = document) => root.querySelector(sel);

export function mountUI() {
  const root = document.getElementById("ui");
  root.innerHTML = `
    <div class="hud" id="hud">
      <div class="stat main"><small id="score-label">SCORE</small><span id="score">0</span></div>
      <div class="stat"><small>TUBE</small><span id="tube">0.0s</span></div>
      <div class="stat"><small>SPEED</small><span id="speed">0</span></div>
      <div class="stat heat" id="heat-readout"><small>HEAT<span class="x"> · YOU–RIVAL</span></small><span id="heat-score">–</span></div>
    </div>
    <div class="btns">
      <button id="qbtn" type="button">Quality</button>
      <button id="rbtn" type="button">Restart (R)</button>
    </div>
    <div id="priority"></div>
    <div id="msg"></div>
    <div id="ridehint" aria-live="polite"></div>
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

// ---- first-run hint ------------------------------------------------------------------------------------------------
// The controls are not in the main menu any more. A new player sees one short line on the menu and the same line over the
// first ride; the full list lives on the Help screen. "Seen" is kept under its own localStorage key (not in the save).
const HINT_KEY = "endless-swell-hint-v1";
let hintSeenMem = false;
function hintSeen() {
  if (hintSeenMem) return true;
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch (err) {
    console.warn("first-run hint: localStorage is unavailable, the hint will show once per page load", err);
    return false;
  }
}
function markHintSeen() {
  hintSeenMem = true;
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch (err) {
    console.warn("first-run hint: could not remember that the hint was shown", err);
  }
}
const touchFirst = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
function hintLine() {
  return touchFirst()
    ? `<span><b>Drag</b> left or right to steer</span><span><b>Up</b> to pump</span><span><b>Down</b> to stall</span>`
    : `<span><kbd>←</kbd><kbd>→</kbd> steer</span><span><kbd>↑</kbd><kbd>Space</kbd> pump</span><span><kbd>↓</kbd> stall</span>`;
}
let hintTimer = 0;
/** First ride only: show the controls over the wave for a few seconds, then never again. */
function flashRideHint() {
  if (hintSeen()) return;
  markHintSeen();
  const el = document.getElementById("ridehint");
  if (!el) return;
  el.innerHTML = hintLine();
  el.classList.add("show");
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => el.classList.remove("show"), 9000);
}

function sheet(html, cls = "") {
  return `<div class="panel show"><div class="sheet ${cls}">${html}</div></div>`;
}

const FINISH_NAME = { 1: "Winner", 2: "Runner-up", 4: "Semifinal (top 4)", 8: "Quarterfinal", 16: "Round of 16" };
const TROPHY_NAME = { 1: "Champion", 2: "Runner-up", 4: "Top 4" };
const PLACE_WORD = { 1: "1st", 2: "2nd", 4: "Top 4", 8: "Top 8", 16: "Top 16" };

function rankLine(points) {
  const r = rankInfo(points);
  return `${r.title} · ${points} pts · ${r.toNext} to ${r.nextTitle}`;
}

/** Share of the way through the current rank, 0..100. */
function rankPct(points) {
  const r = rankInfo(points);
  return Math.max(0, Math.min(100, Math.round(((points - r.floor) / (r.nextAt - r.floor)) * 100)));
}

function shelfHTML(trophies) {
  if (!trophies.length) return `<p class="shelf empty">Trophy shelf: empty. Finish in the top 4 of a Season Finale to put the first trophy on it.</p>`;
  const chips = trophies
    .slice(-8)
    .reverse()
    .map((t) => `<span class="trophy t${t.place}" title="Season ${t.season} Finale">Season ${t.season} · ${TROPHY_NAME[t.place]}</span>`)
    .join("");
  return `<div class="shelf"><span class="label">Trophy shelf · ${trophies.length}</span><div class="trophies">${chips}</div></div>`;
}

/** A small cup in gold (1), silver (2) or bronze (4). Inline, so it needs no file. */
function trophySVG(place) {
  return `<svg class="cup c${place}" viewBox="0 0 64 72" aria-hidden="true"><defs><linearGradient id="cg${place}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--c1)"/><stop offset=".55" stop-color="var(--c2)"/><stop offset="1" stop-color="var(--c3)"/></linearGradient></defs><path d="M16 6h32v18c0 11-7 19-16 19S16 35 16 24z" fill="url(#cg${place})"/><path d="M16 12H6c0 12 5 20 14 22M48 12h10c0 12-5 20-14 22" fill="none" stroke="var(--c2)" stroke-width="4" stroke-linecap="round"/><path d="M28 43h8v10h-8z" fill="url(#cg${place})"/><path d="M20 53h24l3 12H17z" fill="url(#cg${place})"/><path d="M22 10v14c0 6 3 11 7 13" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/></svg>`;
}

export function menuHTML(save) {
  const tones = catalog.skinTones.map((t) => {
    const on = t.color.toLowerCase() === save.loadout.skin.toLowerCase() ? " on" : "";
    return `<button type="button" class="swatch${on}" data-skin="${t.color}" style="background:${t.color}" title="${t.name}" aria-label="Skin ${t.name}"></button>`;
  }).join("");
  const bodies = catalog.bodies.map((b) => {
    const on = save.loadout.body === b.id ? " on" : "";
    return `<button type="button" class="bodybtn${on}" data-body="${b.id}">${b.name}</button>`;
  }).join("");
  const label = eventLabel(save.season, save.event);
  const finale = isFinale(save.event) ? " It is the Season Finale." : "";
  const r = rankInfo(save.points);
  const hint = hintSeen() ? "" : `<div class="firsthint">${hintLine()}</div>`;
  return `<div class="panel show menu"><div class="mcol">
    <div class="mtop">
    <p class="kicker">TEAHUPO'O · TAHITI</p>
    <h1><span class="t1">Endless</span><span class="t2">Swell</span></h1>
    </div>
    <div class="mbot">
    <p class="lead">A left-hand reef barrel with no horizon. ${label} is waiting.${finale}</p>
    <button class="go" id="play-tour" type="button"><span class="go-top">${finale ? "Season Finale" : "Paddle out"}</span><span class="go-main">${label}</span></button>
    <div class="minor">
      <button class="alt" id="play-free" type="button">Free surf</button>
      <button class="alt" id="open-locker" type="button">Locker</button>
      <button class="alt icon" id="open-help" type="button" aria-label="How to play" title="How to play">?</button>
    </div>
    ${hint}
    <div class="rankcard">
      <div class="rank-title"><span class="label">Rank</span><b>${r.title}</b></div>
      <div class="bar"><i style="width:${rankPct(save.points)}%"></i></div>
      <p class="rank-line">${rankLine(save.points)}</p>
    </div>
    ${shelfHTML(save.trophies)}
    <div class="row pickers">
      <span class="label">Surfer</span><div class="bodybtns">${bodies}</div>
      <span class="label">Skin</span><div class="swatches">${tones}</div>
    </div>
    </div>
  </div></div>`;
}

/** The Help screen: the controls (moved off the main menu), how to read the wave bar, and the heat rules. */
export function helpHTML() {
  return sheet(`
    <p class="eyebrow">HOW TO PLAY</p>
    <h1>Read the wave</h1>
    <div class="split">
      <div>
        <h3>Keyboard</h3>
        <div class="ctl">
          <span><kbd>←</kbd> <kbd>A</kbd></span><span>Toward the wall</span>
          <span><kbd>→</kbd> <kbd>D</kbd></span><span>Toward the trough</span>
          <span><kbd>↑</kbd> <kbd>W</kbd> <kbd>Space</kbd></span><span>Pump, timed for speed</span>
          <span><kbd>↓</kbd> <kbd>S</kbd></span><span>Stall</span>
          <span><kbd>R</kbd></span><span>Restart the ride</span>
        </div>
        <h3>Touch</h3>
        <div class="ctl"><span>Drag</span><span>Left or right to steer, up to pump, down to stall</span></div>
      </div>
      <div>
        <h3>The wave bar</h3>
        <p class="fine big">The bar at the bottom of the screen shows where you are on the wave. The red end is the lip. The green is the pocket, where the tube is. The marker turns red when you are close to the lip and green when you are in the tube.</p>
        <h3>A heat</h3>
        <p class="fine big">The best two of your waves count, each judged to 10. The priority holder chooses first. Interference cuts the wave in half. Finish in the top 4 to move on; winning pays more.</p>
      </div>
    </div>
    <div class="actions"><button class="go small" id="help-back" type="button"><span class="go-main">Back</span></button></div>
  `, "help");
}

// The Locker is a studio preview of the surfer (drawn on the canvas by src/locker.js) beside a scrollable grid of cards. Each card
// has a picture (a canvas that src/locker.js fills with a rendering of the item), its name and its rarity or price. A locked
// item can be tried on in the preview but never worn.
export function lockerShellHTML() {
  return `<div class="panel lk">
    <div class="lk-stage" id="lk-view" aria-label="Surfer preview. Drag to turn."><div class="lk-badge" id="lk-badge"></div><div class="lk-hint"><span class="when-ready">Drag to turn</span><span class="when-wait">Setting up the studio…</span></div></div>
    <div class="lk-side">
      <div class="lk-head"><p class="kicker">EARNED GEAR · PREMIUM STAYS LOCKED</p><h1>Locker</h1><p class="fine" id="lk-fine"></p><div class="lk-skin"><span class="label">Skin</span><div class="swatches" id="lk-skin"></div></div></div>
      <div class="lk-scroll" id="lk-list"></div>
      <div class="lk-foot"><p class="fine">Premium prices are placeholders. Nothing is charged.</p><button class="go small" id="locker-back" type="button"><span class="go-main">Back</span></button></div>
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

/** The six skin-tone swatches of the Locker (the same tones and the same loadout field as the menu's picker). */
export function lockerSkinHTML(save) {
  return catalog.skinTones.map((t) => {
    const on = t.color.toLowerCase() === save.loadout.skin.toLowerCase() ? " on" : "";
    return `<button type="button" class="swatch${on}" data-skin="${t.color}" style="background:${t.color}" title="${t.name}" aria-label="Skin ${t.name}"></button>`;
  }).join("");
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
  const rules = tour.twists.map((id) => `<li class="rule">${twistLabel(id)}</li>`).join("");
  const stopNote =
    status === "locked"
      ? `<p class="note">${called.name} is locked (a premium break). This stop is surfed at ${played.name}.</p>`
      : status === "soon"
        ? `<p class="note">${called.name} is free but not built yet. This stop is surfed at ${played.name}.</p>`
        : "";
  return sheet(`
    <p class="eyebrow">${tour.finale ? "SEASON FINALE · " : ""}${called.name.toUpperCase()} · ${called.region.toUpperCase()}${status === "open" ? "" : ` · ${status === "locked" ? "LOCKED" : "NOT BUILT YET"}`}</p>
    <h1>${eventLabel(tour.season, tour.event).toUpperCase()}</h1>
    <div class="swellrow"><span class="swell"><b>${tour.feet.toFixed(1)} ft</b> swell</span></div>
    <ul class="facts chips">
      <li>${windText(tour)}</li>
      <li>Tide ${tour.tide}</li>
      <li>${tour.look}</li>
      ${tour.finale ? `<li class="rule">Season Finale — a heavier swell and a sharper field</li>` : ""}
      ${rules || (tour.finale ? "" : "<li>Standard heat</li>")}
      <li class="${hazards.length ? "haz" : "clean"}">${hazards.length ? hazards.join(", ") : "clean lineup"}</li>
    </ul>
    ${stopNote}
    <p class="rulesline">Top 4 moves you on; winning pays more. Heat: ${tour.heatSeconds} seconds, ${tour.waveCap > 2 ? `up to ${tour.waveCap} waves, the best two count` : "two waves, both count"}, each judged to 10. Priority holder chooses first. Interference cuts the wave in half.${attempt ? ` Attempt ${attempt + 1}: same conditions, a new draw.` : ""}</p>
    <div class="actions">
      <button class="go" id="begin-heat" type="button"><span class="go-main">Paddle out</span></button>
      <button class="alt" id="brief-back" type="button">Menu</button>
    </div>
  `, "brief");
}

export function freeEndHTML(result, best) {
  const parts = result.parts || {};
  const rows = Object.entries(parts).map(([k, v]) => `<li><span>${k[0].toUpperCase() + k.slice(1)}</span><b>${v}</b></li>`).join("");
  return sheet(`
    <p class="eyebrow">FREE SURF</p>
    <h1 class="${result.wipe ? "lost" : "won"}">${result.wipe ? "Wipeout" : "Wave"}</h1>
    <p class="scoreline">${result.total.toFixed(1)}<small>/10</small></p>
    <ul class="facts rows">${rows}</ul>
    <p class="fine">Best free-surf score ${best.toFixed(1)}</p>
    <div class="actions">
      <button class="go" id="again" type="button"><span class="go-main">Go again</span></button>
      <button class="alt" id="free-menu" type="button">Menu</button>
    </div>
  `, "result");
}

/** One side of the heat scoreboard: every wave, with the (up to) two that count marked. Ties keep the earlier wave. */
function waveRows(waves) {
  if (!waves.length) return `<li class="wave none"><span>No waves</span><b>—</b></li>`;
  const order = waves.map((w, i) => [w.total, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, 2).map((e) => e[1]);
  return waves
    .map((w, i) => {
      const counts = order.includes(i);
      const tag = [w.interference ? "interference" : "", w.wipe ? "wipe" : ""].filter(Boolean).join(" · ");
      return `<li class="wave ${counts ? "counts" : "out"}"><span>Wave ${i + 1}${tag ? ` <em>${tag}</em>` : ""}</span><b>${w.total.toFixed(1)}</b><i>${counts ? "counts" : "drops"}</i></li>`;
    })
    .join("");
}

export function heatResultHTML(view) {
  return sheet(`
    <p class="eyebrow">${view.roundName.toUpperCase()} · VS ${view.rivalName.toUpperCase()}</p>
    <h1 class="${view.won ? "won" : "lost"}">${view.won ? "Heat won" : "Heat lost"}</h1>
    <div class="board">
      <div class="side ${view.won ? "lead" : ""}">
        <h3>You</h3>
        <p class="total">${view.playerTotal.toFixed(1)}</p>
        <ul class="waves">${waveRows(view.playerWaves)}</ul>
      </div>
      <div class="vs">to</div>
      <div class="side ${view.won ? "" : "lead"}">
        <h3>${view.rivalName}</h3>
        <p class="total">${view.rivalTotal.toFixed(1)}</p>
        <ul class="waves">${waveRows(view.rivalWaves)}</ul>
      </div>
    </div>
    <p class="fine cap">Your best two waves count, each judged to 10.</p>
    <p class="note">${view.note}</p>
    ${view.bank ? `<p class="fine">Leaving now keeps your ${FINISH_NAME[view.bank].toLowerCase()} finish.</p>` : ""}
    <div class="actions">
      ${view.won && !view.champion ? `<button class="go" id="next-heat" type="button"><span class="go-main">Next heat</span></button>` : ""}
      ${view.champion || !view.won ? `<button class="go" id="tour-done" type="button"><span class="go-main">Results</span></button>` : ""}
      <button class="alt" id="heat-menu" type="button">Menu</button>
    </div>
  `, "result heat");
}

export function tourEndHTML(view) {
  const r = view.settled;
  const label = eventLabel(r.season, r.event);
  const title = r.place === 1 ? (r.finale ? "Season champion" : "Event won") : r.advanced ? "Top 4 · you advance" : "Out of the event";
  const rankUp = r.rankAfter.index > r.rankBefore.index;
  const from = rankUp ? 0 : rankPct(r.rankAfter.points - r.points);
  const to = rankPct(r.rankAfter.points);
  const gear = r.gear
    ? `<div class="reward gear ${r.tier}"><span class="label">New gear</span><p class="lead">Earned: ${r.gear.name} <small>(${r.tier})</small></p>${r.kit ? `<p class="lead">Kit: ${r.kit.name} <small>(matching ${r.kit.shape ? "board" : "board shorts"})</small></p>` : ""}${r.pityGuarantee ? `<p class="fine">Guaranteed after ${PITY_LIMIT} finishes without gear.</p>` : ""}</div>`
    : `<p class="fine">No new gear this time. Gear is guaranteed after ${PITY_LIMIT} finishes without it (now ${view.pity}).</p>`;
  const trophy = r.trophy
    ? `<div class="reward trophyline">${trophySVG(r.place)}<div><span class="label">New on the shelf</span><p class="lead">Trophy for the shelf: Season ${r.season} Finale · ${TROPHY_NAME[r.place]}</p></div></div>`
    : "";
  const next = r.advanced
    ? r.newSeason
      ? `Season ${r.next.season} begins: a new calendar and a new rival field, starting easier than this one ended.`
      : `${eventLabel(r.next.season, r.next.event)} is open.`
    : `A top-4 finish (winning the quarterfinal) moves you on. Retry keeps these conditions and draws a fresh bracket.`;
  const heroCls = r.place === 1 ? "gold" : r.place === 2 ? "silver" : r.advanced ? "bronze" : "out";
  return sheet(`
    <p class="eyebrow">${label.toUpperCase()} · ${FINISH_NAME[r.place].toUpperCase()}</p>
    <div class="hero ${heroCls}"><span class="place">${PLACE_WORD[r.place]}</span><h1 class="${r.advanced ? "won" : "lost"}">${title}</h1></div>
    <div class="reward points"><span class="lead"><b>+${r.points}</b> ranking points${r.finale ? " <small>(Season Finale pays half again)</small>" : ""}</span></div>
    <div class="rankcard ${rankUp ? "up" : ""}">
      ${rankUp ? `<p class="rankup"><b>Rank up: ${r.rankBefore.title} → ${r.rankAfter.title}</b></p>` : ""}
      <div class="bar" style="--from:${from}%;--to:${to}%"><i></i></div>
      <p class="rank-line"><span class="label">Rank</span> ${rankLine(r.rankAfter.points)}</p>
    </div>
    ${trophy}
    ${gear}
    <p class="note">${next}</p>
    <div class="actions">
      ${r.advanced ? `<button class="go" id="next-tour" type="button"><span class="go-main">${eventLabel(r.next.season, r.next.event)}</span></button>` : `<button class="go" id="retry-tour" type="button"><span class="go-main">Retry event</span></button>`}
      <button class="alt" id="end-menu" type="button">Menu</button>
    </div>
  `, `result tourend ${heroCls}`);
}

export function bindPanel(root, handlers) {
  root.querySelectorAll("[data-skin]").forEach((btn) => btn.addEventListener("click", () => handlers.skin(btn.dataset.skin)));
  root.querySelectorAll("[data-body]").forEach((btn) => btn.addEventListener("click", () => handlers.body(btn.dataset.body)));
  root.querySelectorAll("[data-equip]").forEach((btn) => btn.addEventListener("click", () => handlers.equip(btn.dataset.equip)));
  const map = {
    "play-free": "free",
    "play-tour": "tour",
    "open-locker": "locker",
    "open-help": "help",
    "help-back": "helpBack",
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
  // the first ride (free surf or the first heat) shows the controls over the wave once
  for (const id of ["play-free", "begin-heat"]) {
    const el = root.querySelector("#" + id);
    if (el) el.addEventListener("click", flashRideHint);
  }
}
