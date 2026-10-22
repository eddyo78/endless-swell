import { boardsAll, bottomsFor, catalog } from "./save.js";
import { locationById, stopStatus, twistLabel } from "./competition.js";
import { PITY_LIMIT, eventLabel, isFinale, rankInfo } from "./season.js";
import { ico } from "./icons.js";
import { hudHTML } from "./hud.js";

const $ = (sel, root = document) => root.querySelector(sel);

// The Reef Poster palette (mockups/README.md), for the inline art the markup draws itself.
export const PAL = { abyss: "#0A1B2B", trench: "#123347", sunbleach: "#F3EAD7", driftwood: "#E4D6B6", flare: "#FF4F2E", sodium: "#FFC21A", lagoon: "#11B5A4", hibiscus: "#E8407F", cobalt: "#2B5CFF", lime: "#A8D82F", basic: "#BFB5A0" };

export function mountUI() {
  const root = document.getElementById("ui");
  root.innerHTML = `
    ${hudHTML()}
    <div id="ridehint" aria-live="polite"></div>
    <div id="pocket"><div id="depthbar"></div></div>
    <div id="pause" class="pausewrap" hidden></div>
    <div id="panels"></div>
  `;
  return {
    hud: $("#hud"),
    root,
    msg: $("#msg"),
    priority: $("#priority"),
    depth: $("#depthbar"),
    panels: $("#panels"),
    pocket: $("#pocket"),
    pauseBtn: $("#pausebtn"),
    pausePanel: $("#pause"),
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

/** A small cup in gold (1), silver (2) or bronze (4). Inline, so it needs no file. */
function trophySVG(place) {
  return `<svg class="cup c${place}" viewBox="0 0 64 72" aria-hidden="true"><defs><linearGradient id="cg${place}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--c1)"/><stop offset=".55" stop-color="var(--c2)"/><stop offset="1" stop-color="var(--c3)"/></linearGradient></defs><path d="M16 6h32v18c0 11-7 19-16 19S16 35 16 24z" fill="url(#cg${place})"/><path d="M16 12H6c0 12 5 20 14 22M48 12h10c0 12-5 20-14 22" fill="none" stroke="var(--c2)" stroke-width="4" stroke-linecap="round"/><path d="M28 43h8v10h-8z" fill="url(#cg${place})"/><path d="M20 53h24l3 12H17z" fill="url(#cg${place})"/><path d="M22 10v14c0 6 3 11 7 13" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/></svg>`;
}

const RANK_PIPS = 10;

/** The trophy shelf of the title screen: the newest cups on a plank, each with its season. Inline art, no file. */
function shelfHTML(trophies) {
  const board = `<div class="m-plank"></div>`;
  if (!trophies.length) {
    return `<div class="m-shelf empty"><div class="lab">Trophy shelf: empty</div><p>Finish in the top 4 of a Season Finale to put the first cup on it.</p>${board}</div>`;
  }
  const accent = { 1: PAL.sodium, 2: PAL.basic, 4: "#C98A5A" };
  const cups = trophies
    .slice(-4)
    .reverse()
    .map((t) => `<div class="tr t${t.place}" title="Season ${t.season} Finale · ${TROPHY_NAME[t.place]}">${ico("trophy", 54, accent[t.place] || PAL.basic, PAL.sunbleach)}<span class="yr">S${t.season}</span></div>`)
    .join("");
  return `<div class="m-shelf"><div class="lab">Trophy shelf · ${trophies.length}</div><div class="cups">${cups}</div>${board}</div>`;
}

/** The rank shield: cobalt, one to three chevrons by rank step, the top chevron in gold. */
export function shieldSVG(index, size = 104) {
  const n = Math.min(3, index + 1);
  const ys = n === 1 ? [70] : n === 2 ? [61, 79] : [52, 70, 88];
  const chev = (y, color) => `<path d="M30 ${y}L52 ${y - 16}L74 ${y}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
  const marks = ys.map((y, i) => chev(y, i === 0 ? PAL.sodium : PAL.sunbleach)).join("");
  const body = "M52 4L96 20V60C96 86 76 104 52 112C28 104 8 86 8 60V20Z";
  return `<svg class="shield" width="${size}" height="${Math.round((size * 116) / 104)}" viewBox="0 0 104 116" aria-hidden="true"><path d="${body}" fill="#031420" transform="translate(5 5)"/><path d="${body}" fill="${PAL.cobalt}" stroke="${PAL.abyss}" stroke-width="4"/><path d="M52 4L96 20V60C96 86 76 104 52 112V4Z" fill="#1E45C8"/>${marks}</svg>`;
}

function rankBlockHTML(save) {
  const r = rankInfo(save.points);
  const filled = Math.round((rankPct(save.points) / 100) * RANK_PIPS);
  const pips = Array.from({ length: RANK_PIPS }, (_, i) => `<i class="${i < filled ? "" : "o"}"></i>`).join("");
  return `<div class="m-rank">
    <div class="plate">
      <div class="shieldwrap">${shieldSVG(r.index)}</div>
      <div class="rt"><span class="cond">Your rank</span><b class="disp">${r.title}</b><div class="pips" role="img" aria-label="${rankPct(save.points)}% of the way to ${r.nextTitle}">${pips}</div><span class="rl">${save.points} pts · ${r.toNext} to ${r.nextTitle}</span></div>
    </div>
  </div>`;
}

const WAVE_UNDERLINE = `<svg class="m-squig" viewBox="0 0 400 44" preserveAspectRatio="none" aria-hidden="true"><path d="M2 20Q60 0 130 16T270 10T398 14V36Q350 46 290 40T126 40T2 50Z" fill="${PAL.sodium}"/><path d="M2 20Q60 0 130 16T270 10T398 14" fill="none" stroke="#031420" stroke-width="3"/></svg>`;

const STAMP = `<svg class="m-stamp" viewBox="0 0 150 150" aria-hidden="true">
  <circle cx="75" cy="75" r="70" fill="${PAL.sunbleach}" stroke="${PAL.abyss}" stroke-width="4"/>
  <circle cx="75" cy="75" r="57" fill="none" stroke="${PAL.abyss}" stroke-width="1.6" stroke-dasharray="3 4"/>
  <path d="M30 88Q50 58 78 66T120 84" fill="none" stroke="${PAL.lagoon}" stroke-width="7" stroke-linecap="round"/>
  <path d="M42 98Q75 86 108 98" fill="none" stroke="${PAL.abyss}" stroke-width="3" stroke-linecap="round"/>
  <defs><path id="arcT" d="M20 75A55 55 0 0 1 130 75"/><path id="arcB" d="M18 78A58 58 0 0 0 132 78"/></defs>
  <text font-family="Archivo" font-stretch="125%" font-weight="800" font-size="15" letter-spacing="3" fill="${PAL.abyss}"><textPath href="#arcT" startOffset="50%" text-anchor="middle">TEAHUPO'O</textPath></text>
  <text font-family="Archivo" font-stretch="75%" font-weight="800" font-size="13" letter-spacing="4" fill="${PAL.hibiscus}"><textPath href="#arcB" startOffset="50%" text-anchor="middle">TAHITI</textPath></text>
</svg>`;

const FOAM = `<svg class="m-foam" viewBox="0 0 1280 720" preserveAspectRatio="none" aria-hidden="true">
  <path d="M0 720V719Q300 719 520 714Q560 690 600 620Q660 590 720 612Q780 570 850 600Q920 566 990 596Q1060 586 1100 640Q1180 640 1280 600V720Z" fill="${PAL.sunbleach}"/>
  <path d="M0 720V720Q300 720 540 719Q570 700 600 654Q660 626 720 646Q780 612 850 638Q920 606 990 634Q1060 626 1100 676Q1180 676 1280 640V720Z" fill="#9AD6D2"/>
  <path d="M0 720V720Q300 720 580 719Q650 690 740 700Q830 674 930 698Q1040 682 1130 706Q1210 698 1280 686V720Z" fill="${PAL.lagoon}"/>
</svg>`;

const PLAY_ARROW = `<svg class="arrow" viewBox="0 0 40 40" aria-hidden="true"><path d="M10 5L35 20L10 35Z" fill="${PAL.abyss}" transform="translate(3 3)"/><path d="M10 5L35 20L10 35Z" fill="${PAL.sunbleach}"/></svg>`;

/**
 * The title screen (mockups/01-title.png, 01-title-phone.png): the wordmark, one PLAY with the next Season and Event, the rank
 * and the trophy shelf, and four icon tiles. The surfer is the live 3D rider behind it. The surfer and skin choice live in the
 * Locker now.
 */
export function menuHTML(save) {
  const label = eventLabel(save.season, save.event);
  const finale = isFinale(save.event);
  const hint = hintSeen() ? "" : `<div class="m-hint firsthint">${hintLine()}</div>`;
  const tile = (id, icon, accent, text) => `<button class="m-tile" id="${id}" type="button"><span class="sq">${ico(icon, 34, accent, PAL.abyss)}</span><span class="l cond">${text}</span></button>`;
  return `<div class="panel show menu">
    ${FOAM}
    <h1 class="m-logo"><span class="l1">Endless</span><span class="l2">Swell</span>${WAVE_UNDERLINE}</h1>
    ${STAMP}
    ${hint}
    <div class="m-tab"><span>${finale ? "Season Finale · " : ""}${label}</span></div>
    <button class="m-go" id="play-tour" type="button" aria-label="Play ${label}"><span class="t">Play</span>${PLAY_ARROW}<kbd>Enter</kbd></button>
    <div class="m-tiles">
      ${tile("open-locker", "locker", PAL.sodium, "Locker")}
      ${tile("play-free", "swell", PAL.lagoon, "Free surf")}
      ${tile("open-help", "help", PAL.hibiscus, "How to")}
      ${tile("open-settings", "settings", PAL.cobalt, "Settings")}
    </div>
    ${rankBlockHTML(save)}
    ${shelfHTML(save.trophies)}
  </div>`;
}

/** Settings: the quality choice (it was a pill over the ride) and the keys that no longer have buttons. */
export function settingsHTML(save) {
  const q = (value, text, note) => `<button type="button" class="seg ${save.quality === value ? "on" : ""}" data-quality="${value}" aria-pressed="${save.quality === value}"><b>${text}</b><small>${note}</small></button>`;
  return sheet(`
    <p class="eyebrow">SETTINGS</p>
    <h1>Settings</h1>
    <div class="setrow"><span class="label">Picture quality</span><div class="segs">${q("high", "High", "Sharper water, more spray")}${q("low", "Low", "Smoother on a slow device")}</div></div>
    <div class="setrow"><span class="label">Keys</span><p class="fine big"><kbd>R</kbd> restarts the ride or the heat. <kbd>Esc</kbd> pauses. <kbd>Shift</kbd>+<kbd>L</kbd> saves the play log.</p></div>
    <div class="actions"><button class="go small" id="settings-back" type="button"><span class="go-main">Back</span></button></div>
  `, "settings");
}

/** The pause sheet over a frozen ride. */
export function pauseHTML() {
  return `<div class="sheet pausesheet" role="dialog" aria-label="Paused">
    <p class="eyebrow">PAUSED</p>
    <div class="actions col">
      <button class="go" id="pause-resume" type="button"><span class="go-main">Resume</span></button>
      <button class="alt" id="pause-restart" type="button">Restart (R)</button>
      <button class="alt" id="pause-menu" type="button">Menu</button>
    </div>
  </div>`;
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
          <span><kbd>Esc</kbd></span><span>Pause</span>
        </div>
        <h3>Touch</h3>
        <div class="ctl"><span>Drag</span><span>Left or right to steer, up to pump, down to stall</span><span>Pause</span><span>The button at the bottom right</span></div>
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

// ---- the Locker --------------------------------------------------------------------------------------------------------
// A shop stage (mockups/05-locker.png): the surfer on a turntable in front of a disc whose colour is the rarity on show (drawn on the
// canvas by src/locker.js), skin tones in a column, and on the right icon tabs, rarity-framed cards and a detail plate. Each card
// has a picture (a canvas that src/locker.js fills with a rendering of the item). A locked item can be tried on in the preview
// but never worn.

/** The four rarity frames (mockups/05-locker.png): shape as well as colour. cut = the corner cuts [top-left, top-right, bottom-right, bottom-left]. */
export const RARITY = {
  basic: { name: "Basic", color: PAL.basic, cut: [0, 0, 0, 0], icon: "r-basic", rank: 0 },
  tour: { name: "Tour", color: PAL.lagoon, cut: [0, 18, 0, 0], icon: "r-tour", rank: 1 },
  elite: { name: "Elite", color: PAL.cobalt, cut: [16, 0, 16, 0], icon: "r-elite", rank: 2, double: true },
  sig: { name: "Signature", color: PAL.sodium, cut: [14, 14, 14, 14], icon: "r-signature", rank: 3, double: true, studs: true },
};

/**
 * Which of the four frames an item wears. The game's own ladder is starter, common, rare, epic and premium; it maps onto the
 * frames as: starter -> Basic, common -> Tour, rare -> Elite, epic and premium -> Signature.
 */
export function rarityKey(item) {
  if (item.tier === "premium") return "sig";
  switch (item.reward) {
    case "common":
      return "tour";
    case "rare":
      return "elite";
    case "epic":
      return "sig";
    default:
      return "basic";
  }
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

/** The frame art: a ground polygon, the coloured rule, a second rule for Elite and Signature, studs for Signature. */
function frameSVG(key) {
  const f = RARITY[key];
  const w = 152;
  const h = 196;
  const [a, b, c, d] = f.cut;
  const pts = (i) => `${a + i},${i} ${w - b - i},${i} ${w - i},${b + i} ${w - i},${h - c - i} ${w - c - i},${h - i} ${d + i},${h - i} ${i},${h - d - i} ${i},${a + i}`;
  const studs = f.studs ? [[22, 22], [w - 22, 22], [22, h - 28], [w - 22, h - 28]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="${f.color}"/>`).join("") : "";
  return `<svg class="fr" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polygon points="${pts(0)}" fill="#0F2638"/><polygon points="${pts(2.5)}" fill="none" stroke="${f.color}" stroke-width="5" vector-effect="non-scaling-stroke"/>${f.double ? `<polygon points="${pts(9)}" fill="none" stroke="${f.color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>` : ""}${studs}</svg>`;
}

export const LOCKER_TABS = ["board", "outfit", "surfer", "shelf"];

/** The tab strip. The outfit tab shows the shorts for the male body and the sets for the female body. */
export function lockerTabsHTML(save, tab) {
  const male = save.loadout.body === "male";
  const defs = {
    board: { icon: "board", label: "Board", accent: PAL.flare },
    outfit: { icon: male ? "shorts" : "bikini", label: male ? "Shorts" : "Sets", accent: male ? PAL.lagoon : PAL.hibiscus },
    surfer: { icon: "settings", label: "Surfer", accent: PAL.cobalt },
    shelf: { icon: "trophy", label: "Shelf", accent: PAL.sodium },
  };
  return LOCKER_TABS.map((id) => {
    const d = defs[id];
    const on = id === tab;
    return `<button type="button" class="lk-tab cond${on ? " on" : ""}" role="tab" aria-selected="${on}" data-tab="${id}">${ico(d.icon, 30, d.accent, on ? PAL.abyss : PAL.sunbleach)}<span>${d.label}</span></button>`;
  }).join("");
}

export function lockerShellHTML() {
  const chevron = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M15 5L8 12L15 19" fill="none" stroke="${PAL.abyss}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const drag = `<svg width="64" height="22" viewBox="0 0 64 22" aria-hidden="true"><path d="M4 11H60M12 4L4 11L12 18M52 4L60 11L52 18" fill="none" stroke="#9fb4c2" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `<div class="panel lk">
    <div class="lk-stage" id="lk-view" aria-label="Surfer preview. Drag to turn.">
      <button class="lk-back" id="locker-back" type="button" aria-label="Back to the menu">${chevron}</button>
      <div class="lk-badge" id="lk-badge"></div>
      <div class="lk-skinbox"><span class="cond lab">Skin</span><div class="lk-skin" id="lk-skin"></div></div>
      <div class="lk-hint cond"><span class="when-ready">${drag}Drag to turn</span><span class="when-wait">Setting up the studio…</span></div>
    </div>
    <div class="lk-side">
      <div class="lk-tabs" id="lk-tabs" role="tablist"></div>
      <p class="fine lk-fine" id="lk-fine"></p>
      <div class="lk-scroll" id="lk-list"></div>
      <div class="lk-detail" id="lk-detail"></div>
    </div>
  </div>`;
}

/** The six skin-tone hexes of the Locker (the same tones and the same loadout field as before; the title screen no longer has them). */
export function lockerSkinHTML(save) {
  return catalog.skinTones.map((t) => {
    const on = t.color.toLowerCase() === save.loadout.skin.toLowerCase() ? " on" : "";
    return `<button type="button" class="swatch${on}" data-skin="${t.color}" style="--c:${t.color}" title="${t.name}" aria-label="Skin ${t.name}" aria-pressed="${!!on}"><i></i></button>`;
  }).join("");
}

/** The Locker's fine-print line: gear count and the pity counter. */
export function lockerFine(save) {
  return `${save.gear.length} piece${save.gear.length === 1 ? "" : "s"} won by placement. Gear is guaranteed after ${PITY_LIMIT} finishes without it (now ${save.pity}).`;
}

/** What each tab lists, and how a card of it knows it is worn. */
function tabItems(save, tab) {
  if (tab === "board") return { list: boardsAll(), worn: (i) => save.loadout.board === i.id };
  if (tab === "outfit") return { list: bottomsFor(save.loadout.body), worn: (i) => save.loadout.bottom === i.id };
  return { list: catalog.bodies, worn: (i) => save.loadout.body === i.id };
}

/** The item a tab shows on the detail plate: the one on trial, else the one worn in that tab. */
export function lockerFocus(save, tab, selected, byId) {
  if (selected && byId[selected]) return byId[selected];
  if (tab === "board") return byId[save.loadout.board] || null;
  if (tab === "outfit") return byId[save.loadout.bottom] || null;
  if (tab === "surfer") return byId[save.loadout.body] || null;
  return null;
}

/**
 * The cards of a tab: boards, the active body's outfits (the other body's appear when that body is picked), or the bodies. selected
 * is the id on the preview that is not worn (or null). Every card is a button with data-equip; a card the save does not own is
 * marked locked and previews only. The shelf tab has no cards: it shows the rank and the cups.
 */
export function lockerListHTML(save, selected = null, tab = "board") {
  if (tab === "shelf") return lockerShelfHTML(save);
  const { list, worn: wornOf } = tabItems(save, tab);
  // generated gear: only what this save owns, newest first, after the authored pieces
  const authored = list.filter((i) => !i.generated);
  const earned = list
    .filter((i) => i.generated && save.owned.includes(i.id))
    .sort((a, b) => save.owned.indexOf(b.id) - save.owned.indexOf(a.id));
  const cells = [...authored, ...earned].map((item) => {
    const owned = save.owned.includes(item.id);
    const worn = wornOf(item);
    const key = rarityKey(item);
    const r = RARITY[key];
    const cls = ["item", `rar-${key}`, `r-${rarityOf(item)}`, worn ? "on" : "", owned ? "" : "locked", selected === item.id ? "sel" : ""].filter(Boolean).join(" ");
    const tag = worn ? "EQUIPPED" : owned ? "" : item.tier === "premium" ? "PREMIUM" : "LOCKED";
    return `<button type="button" class="${cls}" data-equip="${item.id}" title="${item.name}" ${owned ? "" : 'data-locked="1" aria-disabled="true"'}>
      ${frameSVG(key)}
      <span class="thumb"><canvas width="160" height="160"></canvas>${tag ? `<i class="tag">${tag}</i>` : ""}</span>
      <span class="rt" title="${r.name}">${ico(r.icon, 22, r.color, PAL.sunbleach)}</span>
      <b>${item.name}</b><small>${itemFlag(item, owned)}</small>
      ${owned ? "" : `<span class="lc">${ico("lock", 18, PAL.lime, PAL.sunbleach)}</span>`}
    </button>`;
  }).join("");
  return `<div class="items" role="tabpanel">${cells}</div>`;
}

/** The Shelf tab: the rank shield and every cup on the shelf (the most recent twelve). */
function lockerShelfHTML(save) {
  const r = rankInfo(save.points);
  const accent = { 1: PAL.sodium, 2: PAL.basic, 4: "#C98A5A" };
  const cups = save.trophies.length
    ? save.trophies
        .slice(-12)
        .reverse()
        .map((t) => `<div class="tr">${ico("trophy", 58, accent[t.place] || PAL.basic, PAL.sunbleach)}<span class="yr">Season ${t.season} · ${TROPHY_NAME[t.place]}</span></div>`)
        .join("")
    : `<p class="fine">Trophy shelf: empty. Finish in the top 4 of a Season Finale to put the first cup on it.</p>`;
  return `<div class="lk-shelf" role="tabpanel">
    <div class="rk">${shieldSVG(r.index, 84)}<div><span class="cond">Your rank</span><b class="disp">${r.title}</b><span class="rl">${rankLine(save.points)}</span></div></div>
    <div class="cups">${cups}</div>
  </div>`;
}

/** The plate under the cards: the name, rarity and flag of the focused item, and whether it is worn or locked. */
export function lockerDetailHTML(item, save) {
  if (!item) return "";
  const owned = save.owned.includes(item.id);
  const key = rarityKey(item);
  const r = RARITY[key];
  const worn = [save.loadout.body, save.loadout.bottom, save.loadout.board].includes(item.id);
  const premium = item.tier === "premium";
  const note = premium ? "Premium. Preview only." : owned ? (item.generated ? "Earned by placement." : "Yours.") : "Not won yet. Preview only.";
  const state = worn
    ? `<div class="d-state worn"><span class="cond">Equipped</span></div>`
    : owned
      ? `<div class="d-state owned"><span class="cond">Owned</span></div>`
      : `<div class="d-state locked">${ico("lock", 18, PAL.lime, PAL.abyss)}<span class="cond">Locked</span></div>`;
  return `<div class="d-nm disp">${item.name}</div>
    <div class="d-meta"><span class="d-rar">${ico(r.icon, 22, r.color, PAL.abyss)}<span class="cond">${r.name}</span></span><span class="d-flag cond">${itemFlag(item, owned)}</span></div>
    <div class="d-note cond">${owned ? "" : ico("lock", 18, PAL.lime, PAL.abyss)}${note}</div>
    ${state}`;
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
  root.querySelectorAll("[data-quality]").forEach((btn) => btn.addEventListener("click", () => handlers.quality(btn.dataset.quality)));
  const map = {
    "play-free": "free",
    "play-tour": "tour",
    "open-locker": "locker",
    "open-help": "help",
    "open-settings": "settings",
    "settings-back": "settingsBack",
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
