import catalog from "./data/catalog.json";

export const SAVE_KEY = "endless-swell-save-v1";

export function allItems() {
  return [...catalog.bodies, ...catalog.outfits, ...catalog.boards];
}

export function defaultOwned() {
  return allItems().filter((i) => i.ownedDefault).map((i) => i.id);
}

export function defaultSave() {
  return {
    v: 1,
    nextTour: 1,
    results: [],
    owned: defaultOwned(),
    loadout: {
      body: "male",
      skin: "#6e3a22",
      bottom: "trunks-red",
      top: null,
      board: "board-blue",
    },
    quality: "high",
    best: 0,
  };
}

function sanitize(data) {
  const base = defaultSave();
  if (!data || typeof data !== "object") return base;
  const owned = new Set(base.owned);
  if (Array.isArray(data.owned)) {
    for (const id of data.owned) {
      if (allItems().some((i) => i.id === id)) owned.add(id);
    }
  }
  const load = data.loadout || {};
  const next = {
    ...base,
    nextTour: Number.isFinite(data.nextTour) && data.nextTour >= 1 ? Math.floor(data.nextTour) : 1,
    results: Array.isArray(data.results) ? data.results.slice(-40) : [],
    owned: [...owned],
    quality: data.quality === "low" ? "low" : "high",
    best: Number.isFinite(data.best) ? data.best : 0,
    loadout: {
      body: load.body === "female" ? "female" : "male",
      skin: typeof load.skin === "string" ? load.skin : base.loadout.skin,
      bottom: owned.has(load.bottom) ? load.bottom : "trunks-red",
      top: load.top && owned.has(load.top) ? load.top : null,
      board: owned.has(load.board) ? load.board : "board-blue",
    },
  };
  if (next.loadout.body === "female" && next.loadout.bottom === "trunks-red" && owned.has("bikini-teal") && !data.loadout) {
    next.loadout.bottom = "bikini-teal";
  }
  return next;
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    return sanitize(JSON.parse(raw));
  } catch {
    return defaultSave();
  }
}

export function writeSave(data) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function owns(save, id) {
  return save.owned.includes(id);
}

const TIER_ORDER = ["common", "rare", "epic"];

export function rewardTier(tourN, place) {
  if (place === 1 && tourN % 50 === 0) return "epic";
  if (place === 1 && tourN % 25 === 0) return "rare";
  if (place === 1) return "common";
  if (place === 2 && tourN % 25 === 0) return "rare";
  if (place === 2) return "common";
  if (place <= 4 && tourN % 10 === 0) return "common";
  return null;
}

export function grantReward(save, tourN, place) {
  const tier = rewardTier(tourN, place);
  if (!tier) return null;
  const min = TIER_ORDER.indexOf(tier);
  const pool = allItems().filter((item) => {
    if (item.tier === "premium") return false;
    if (!item.reward) return false;
    if (save.owned.includes(item.id)) return false;
    return TIER_ORDER.indexOf(item.reward) >= min;
  });
  const fallback = allItems().filter((item) => item.tier !== "premium" && item.reward && !save.owned.includes(item.id));
  const list = pool.length ? pool : fallback;
  if (!list.length) return null;
  const pick = list[tourN % list.length];
  save.owned.push(pick.id);
  return pick;
}

export { catalog };
