// Headless proof for the surfers, outfits and boards: builds the game, serves dist/ on a
// local port for the life of this script only, drives the page through the
// window.__surf test hooks, and saves screenshots.
//
//   node scripts/shots.mjs [--out <dir>] [--dist <built folder>] [--skip-build] [--only a,b,c] [--list] [--png]
//
// Cameras: play (the game camera), close (behind and beside, 2 m), back (straight behind, closer),
// tight (straight behind at 1.35 m: the print on the back, shoulders and hips fills the frame),
// face (three-quarter face portrait at 1.5 m, normal lens), deck (straight down at the bare board, surfer hidden). Output is JPEG q92 unless --png.
//
// Needs a local Chrome (path below, or CHROME_PATH). Installs nothing. The
// browser and the server are closed in a finally block; the script exits when
// the last screenshot is written.
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const dist = opt("dist", join(root, "dist"));
const outDir = opt("out", join(root, "..", "_reports", "m5", "after"));
const EXT = flag("png") ? "png" : "jpg";
const only = opt("only", "")
  .split(",")
  .filter(Boolean);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

// Each scenario: a loadout, an input hold, a number of seconds to advance, and cameras. Steering: +1 is left (up the wall).
// The loadout goes straight to surfer.apply() (window.__surf.setLoadout), which throws if an item is for the other body.
const catalog = JSON.parse(readFileSync(join(root, "src", "data", "catalog.json"), "utf8"));
const TONES = catalog.skinTones;
const dress = (o) => ({ body: "male", skin: "#c68642", bottom: "trunks-red", board: "board-blue", ...o });
const FEMALE = { body: "female", bottom: "bikini-teal" };
const STILL = { steer: 0, thr: 0, sec: 0.8 };
const SCENARIOS = [
  { name: "01-male-default", loadout: dress({ skin: "#6e3a22" }), ...STILL, cams: ["play", "close", "back", "face"] },
  { name: "02-female-default", loadout: dress({ ...FEMALE, skin: "#6e3a22" }), ...STILL, cams: ["play", "close", "back", "face"] },
  { name: "03-male-light-skin", loadout: dress({ skin: "#f1c27d" }), ...STILL, cams: ["play", "close", "back", "face"] },
  { name: "04-female-light-skin", loadout: dress({ ...FEMALE, skin: "#f1c27d" }), ...STILL, cams: ["play", "close", "back", "face"] },
  { name: "05-board-short", loadout: dress({ board: "board-chevron" }), ...STILL },
  { name: "06-board-fish", loadout: dress({ board: "board-fish" }), ...STILL },
  { name: "07-board-gun", loadout: dress({ board: "board-gun" }), ...STILL },
  { name: "08-steer-left", loadout: dress({}), steer: 1, thr: 0, sec: 1.2 },
  { name: "09-steer-right", loadout: dress({}), steer: -1, thr: 0, sec: 1.2 },
  { name: "17-pump", loadout: dress({}), steer: 0, thr: 1, sec: 0.35 },
  { name: "18-stall", loadout: dress({}), steer: 0, thr: -1, sec: 0.8 },
  { name: "19-drop-in", loadout: dress({}), steer: 0, thr: 0, sec: 0, dropIn: true },
  { name: "10-tube", loadout: dress({}), autopilot: "tube" },
  { name: "11-claim", loadout: dress({}), autopilot: "claim" },
  { name: "12-wipeout", loadout: dress({}), autopilot: "wipe" },
  { name: "10f-tube-female", loadout: dress({ ...FEMALE }), autopilot: "tube" },
  { name: "11f-claim-female", loadout: dress({ ...FEMALE }), autopilot: "claim" },
  { name: "12f-wipeout-female", loadout: dress({ ...FEMALE }), autopilot: "wipe" },
  { name: "15-menu", view: "menu", loadout: dress({}) },
  { name: "16-locker-male", view: "locker", loadout: dress({ skin: "#f1c27d", board: "board-fish" }) },
  { name: "16-locker-female", view: "locker", loadout: dress({ ...FEMALE, skin: "#f1c27d", board: "board-fish" }) },
];
// Both bodies at all six skin tones: the play camera, a back close-up and a face portrait.
for (const body of ["male", "female"]) {
  for (const t of TONES) {
    SCENARIOS.push({
      name: `20-tone-${body}-${t.id}`,
      loadout: dress({ body, skin: t.color, bottom: body === "male" ? "trunks-red" : "bikini-teal" }),
      ...STILL,
      cams: ["play", "back", "face"],
    });
  }
}
// Every outfit in the catalog on the body it is made for (each outfit is one matching set).
for (const item of catalog.outfits) {
  const body = item.body;
  const loadout = dress({
    body,
    skin: body === "male" ? "#8d5524" : "#e0ac69",
    bottom: item.id,
    board: "board-chevron",
  });
  SCENARIOS.push({ name: `21-outfit-${item.id}`, loadout, ...STILL, cams: ["play", "back"] });
}
// Hero shots: each body at the light and brown tones, from the play camera (the camera is 6 cm off straight behind the
// surfer) and in a three-quarter close-up of the face at 1.5 m with a normal lens.
for (const body of ["male", "female"]) {
  for (const [tone, color] of [["light", "#f1c27d"], ["brown", "#6e3a22"]]) {
    SCENARIOS.push({
      name: `40-hero-${body}-${tone}`,
      loadout: dress({ body, skin: color, bottom: body === "male" ? "trunks-red" : "bikini-teal" }),
      ...STILL,
      cams: ["play", "face"],
    });
  }
}
// Studio views of each body in the bind pose, at the light and brown tones: front, side, back and a three-quarter face.
// These are the proportion and face evidence (the wave, water and island are hidden; see window.__surf.studio).
for (const body of ["male", "female"]) {
  for (const [tone, color] of [["light", "#f1c27d"], ["brown", "#8d5524"]]) {
    SCENARIOS.push({
      name: `30-studio-${body}-${tone}`,
      loadout: dress({ body, skin: color, bottom: body === "male" ? "trunks-red" : "bikini-teal" }),
      ...STILL,
      studio: [
        ["front", { yawDeg: 0, dist: 5 }],
        ["side", { yawDeg: 90, dist: 5 }],
        ["back", { yawDeg: 180, dist: 5 }],
        ["hips-back", { yawDeg: 180, dist: 1.6, fov: 30, aim: "root" }],
        ["hips-34", { yawDeg: 140, dist: 1.6, fov: 30, aim: "root" }],
        ["face-front", { yawDeg: 0, dist: 0.9, fov: 26, aim: "head" }],
        ["face-34", { yawDeg: 32, dist: 0.9, fov: 26, aim: "head" }],
        ["face-side", { yawDeg: 85, dist: 0.9, fov: 26, aim: "head" }],
      ],
    });
  }
}
// Milestone 4: the season flow screens (menu, event brief, results) and earned gear worn on both bodies. Each `m4` kind is
// set up in the page by setupM4() below; the screens are real (the menu, brief and results come from the game's own code).
SCENARIOS.push(
  { name: "m4-01-menu", m4: "menu" },
  { name: "m4-02-brief-locked-stop", m4: "brief-locked" },
  { name: "m4-03-brief-finale-twist", m4: "brief-finale" },
  { name: "m4-04-results-finale-trophy", m4: "results-finale" },
  { name: "m4-05-results-win", m4: "results-win" },
  { name: "m4-06-results-out", m4: "results-out" },
  { name: "m4-07-locker-earned", m4: "locker" },
  { name: "m4-08-gear-male", m4: "gear", body: "male", cams: ["play", "back"] },
  { name: "m4-09-gear-female", m4: "gear", body: "female", cams: ["play", "back"] },
);
// Milestone 5 (crisp prints): every print pattern on a male outfit (board shorts), a female outfit (the rashguard set) and a
// board, each from the play camera and a close view; the male scenes add a view straight down at the bare board
// (the "deck" camera). Items are earned-gear recipes registered with window.__surf.addGear, so any pattern can be worn in
// the same two colours. Catalog boards get the play camera and the deck camera.
const PRINT_PATTERNS = ["stripes", "chevron", "sunburst", "palm", "tiger", "panels"];
const M5_CLOTH = ["#c41622", "#f3f6f8"]; // red and white: the pair that smeared in the milestone 4 shots
const M5_BOARD = ["#e23b2f", "#f4f1ea"];
for (const pattern of PRINT_PATTERNS) {
  for (const body of ["male", "female"]) {
    SCENARIOS.push({
      name: `m5-print-${pattern}-${body}`,
      m5: { pattern, body },
      ...STILL,
      cams: body === "male" ? ["play", "close", "back", "tight", "deck"] : ["play", "close", "back", "tight"],
    });
  }
}
// The same prints on the front and the back of the bare body (board shorts, the bikini), in the studio view (bind pose,
// no wave) so every seam of the garment shows: the front is where the print wraps round each part of the shell.
for (const pattern of PRINT_PATTERNS) {
  for (const body of ["male", "female"]) {
    SCENARIOS.push({
      name: `m5-studio-${pattern}-${body}`,
      m5: { pattern, body, outfit: "bottom" },
      ...STILL,
      studio: [
        ["front", { yawDeg: 0, dist: 3.4, fov: 26, lookY: 0.95 }],
        ["back", { yawDeg: 180, dist: 3.4, fov: 26, lookY: 0.95 }],
      ],
    });
  }
}
// Every whole-body or bottom garment (trunks, bikini, full and spring suits, both bodies) at the play camera and the close
// camera, and in the studio view from the front, the side and the back (bind pose): the cut of each garment, legs and hem.
// Items are the catalog's.
for (const item of catalog.outfits) {
  const loadout = dress({ body: item.body, skin: item.body === "male" ? "#8d5524" : "#e0ac69", bottom: item.id, board: "board-blue" });
  SCENARIOS.push({ name: `m5s-${item.id}`, loadout, ...STILL, cams: ["play", "close"] });
  SCENARIOS.push({
    name: `m5s-studio-${item.id}`,
    loadout,
    ...STILL,
    studio: [
      ["front", { yawDeg: 0, dist: 3.4, fov: 26, lookY: 0.55 }],
      ["side", { yawDeg: 90, dist: 3.4, fov: 26, lookY: 0.55 }],
      ["back", { yawDeg: 180, dist: 3.4, fov: 26, lookY: 0.55 }],
    ],
  });
}
// The after3 set (Ed, 2026-10-21: men wear board shorts only, outfits are matching sets): male default; male patterned shorts with the
// matching board (a kit); the female in a matching bikini set (behind and three-quarter) and in a matching rashguard set (behind);
// the redesigned sunburst board seen from above.
SCENARIOS.push(
  { name: "a3-male-default", loadout: dress({ skin: "#8d5524" }), ...STILL, cams: ["play"] },
  { name: "a3-male-kit-palm", m5: { pattern: "palm", body: "male", outfit: "bottom", cloth: ["#0f8f8a", "#f4f1ea"], board: ["#0f8f8a", "#f4f1ea"] }, ...STILL, cams: ["play", "close"] },
  { name: "a3-female-bikini-chevron", m5: { pattern: "chevron", body: "female", outfit: "bottom", cloth: ["#e8574a", "#fff1e6"], board: ["#e8574a", "#fff1e6"] }, ...STILL, cams: ["back", "close"] },
  { name: "a3-female-rashset-stripes", m5: { pattern: "stripes", body: "female", outfit: "set", cloth: ["#14b8b0", "#f4f1ea"], board: ["#14b8b0", "#f4f1ea"] }, ...STILL, cams: ["back"] },
  { name: "a3-sunburst-board", m5: { pattern: "sunburst", body: "male", outfit: "bottom", cloth: ["#e8574a", "#fff1e6"], board: ["#e8574a", "#fff1e6"] }, ...STILL, cams: ["play", "deck"] },
);
// The after4 set (Ed, 2026-10-21: the women's bottoms looked puffy from behind): the bikini set and the rashguard set from straight
// behind and from the play camera, and a close crop of each bottom from behind and from the side (the studio view at the hips,
// bind pose, no wave; "tight" is the same crop in the riding pose).
const A4_BIKINI = { pattern: "chevron", body: "female", outfit: "bottom", cloth: ["#e8574a", "#fff1e6"], board: ["#e8574a", "#fff1e6"] };
const A4_SET = { pattern: "stripes", body: "female", outfit: "set", cloth: ["#14b8b0", "#f4f1ea"], board: ["#14b8b0", "#f4f1ea"] };
const A4_CROP = [
  ["crop-back", { yawDeg: 180, dist: 1.5, fov: 30, aim: "root" }],
  ["crop-side", { yawDeg: 90, dist: 1.5, fov: 30, aim: "root" }],
];
SCENARIOS.push(
  { name: "a4-bikini", m5: A4_BIKINI, ...STILL, cams: ["back", "play", "tight"] },
  { name: "a4-rashset", m5: A4_SET, ...STILL, cams: ["back", "tight"] },
  { name: "a4-bikini-studio", m5: A4_BIKINI, ...STILL, studio: A4_CROP },
  { name: "a4-rashset-studio", m5: A4_SET, ...STILL, studio: A4_CROP },
);
// The cuts set (the women's bikini bottom, three leg-line options built into three separate dist folders, one per cut): the chevron set
// and the plain teal bikini, and the chevron rashguard set, from straight behind and the play camera in the ride, and the hips from
// behind and from the side in the studio view.
const CUT_CHEVRON = { pattern: "chevron", body: "female", outfit: "bottom", cloth: ["#e8574a", "#fff1e6"], board: ["#e8574a", "#fff1e6"] };
const CUT_RASH = { pattern: "chevron", body: "female", outfit: "set", cloth: ["#0f8f8a", "#fff1e6"], board: ["#0f8f8a", "#fff1e6"] };
const CUT_CROP = [
  ["crop-back", { yawDeg: 180, dist: 1.5, fov: 30, aim: "root" }],
  ["crop-side", { yawDeg: 90, dist: 1.5, fov: 30, aim: "root" }],
];
SCENARIOS.push(
  { name: "cut-chevron", m5: CUT_CHEVRON, ...STILL, cams: ["back", "play"] },
  { name: "cut-chevron-studio", m5: CUT_CHEVRON, ...STILL, studio: CUT_CROP },
  { name: "cut-teal", loadout: dress({ body: "female", skin: "#e0ac69", bottom: "bikini-teal" }), ...STILL, cams: ["back", "play"] },
  { name: "cut-teal-studio", loadout: dress({ body: "female", skin: "#e0ac69", bottom: "bikini-teal" }), ...STILL, studio: CUT_CROP },
  { name: "cut-rashset", m5: CUT_RASH, ...STILL, cams: ["back", "tight"] },
  { name: "cut-rashset-studio", m5: CUT_RASH, ...STILL, studio: CUT_CROP },
);
// The final set (cut B wired in): the bikini set and the rashguard set from behind and at the play camera in the default stance, the
// tube and the pump (fin-*), and the same close from behind ("tight", fint-*) to check that the waistband covers the top of the cleft.
const FIN_POSES = { default: { ...STILL }, pump: { steer: 0, thr: 1, sec: 0.35 }, tube: { autopilot: "tube" } };
for (const [pose, pe] of Object.entries(FIN_POSES)) {
  for (const [set, m5] of [["bikini", CUT_CHEVRON], ["rashset", CUT_RASH]]) {
    SCENARIOS.push({ name: `fin-${set}-${pose}`, m5, ...pe, cams: ["back", "play"] });
    SCENARIOS.push({ name: `fint-${set}-${pose}`, m5, ...pe, cams: ["tight"] });
  }
}
// The waist set (the female waist slimmed): the bikini set in the default stance and the pump, from behind, beside ("close") and at
// the play camera, and the bare torso in the studio view from behind and from the side.
for (const [pose, pe] of [["default", { ...STILL }], ["pump", { steer: 0, thr: 1, sec: 0.35 }]]) {
  SCENARIOS.push({ name: `wa-bikini-${pose}`, m5: CUT_CHEVRON, ...pe, cams: ["back", "close", "play"] });
}
SCENARIOS.push({
  name: "wa-studio",
  m5: CUT_CHEVRON,
  ...STILL,
  studio: [
    ["behind", { yawDeg: 180, dist: 2.1, fov: 32, aim: "root" }],
    ["side", { yawDeg: 90, dist: 2.1, fov: 32, aim: "root" }],
  ],
});
// The crouch set (the lower spine stays straight in the bend, the bikini trim stays even): the bikini set and the rashguard set in the tube,
// the pump and the drop-in, from behind and at the play camera; the male in the tube and the pump at the play camera.
for (const [pose, pe] of [["tube", { autopilot: "tube" }], ["pump", { steer: 0, thr: 1, sec: 0.35 }], ["dropin", { steer: 0, thr: 0, sec: 0, dropIn: true }]]) {
  for (const [set, m5] of [["bikini", CUT_CHEVRON], ["rashset", CUT_RASH]]) SCENARIOS.push({ name: `cr-${set}-${pose}`, m5, ...pe, cams: ["back", "play"] });
}
SCENARIOS.push({ name: "cr-male-tube", loadout: dress({}), autopilot: "tube", cams: ["play"] }, { name: "cr-male-pump", loadout: dress({}), steer: 0, thr: 1, sec: 0.35, cams: ["play"] });
// The garment set (the bikini bottom built as its own grid mesh): standing from behind and at the play camera; tube, pump and drop-in close from behind
// ("tight"); and the hips from behind in the studio view.
SCENARIOS.push(
  { name: "gar-standing", m5: CUT_CHEVRON, ...STILL, cams: ["back", "tight", "play"] },
  { name: "gar-tube", m5: CUT_CHEVRON, autopilot: "tube", cams: ["tight"] },
  { name: "gar-pump", m5: CUT_CHEVRON, steer: 0, thr: 1, sec: 0.35, cams: ["tight"] },
  { name: "gar-dropin", m5: CUT_CHEVRON, steer: 0, thr: 0, sec: 0, dropIn: true, cams: ["tight"] },
  { name: "gar-studio", m5: CUT_CHEVRON, ...STILL, studio: [["crop-back", { yawDeg: 180, dist: 1.5, fov: 30, aim: "root" }], ["crop-side", { yawDeg: 90, dist: 1.5, fov: 30, aim: "root" }]] },
);
// The garment5 set (bikini top and bottom, and the rashguard set, all built as grid garments): both sets from behind, from the side (the studio
// view at 90 degrees) and at the play camera, plus close-ups from behind in the tube and the pump.
for (const [set, m5] of [["bikini", CUT_CHEVRON], ["rashset", CUT_RASH]]) {
  SCENARIOS.push(
    { name: `g5-${set}`, m5, ...STILL, cams: ["back", "play"] },
    { name: `g5-${set}-side`, m5, ...STILL, studio: [["side", { yawDeg: 90, dist: 2.6, fov: 30, lookY: 1.05 }], ["behind", { yawDeg: 180, dist: 2.6, fov: 30, lookY: 1.05 }]] },
    { name: `g5-${set}-tube`, m5, autopilot: "tube", cams: ["tight"] },
    { name: `g5-${set}-pump`, m5, steer: 0, thr: 1, sec: 0.35, cams: ["tight"] },
  );
}
for (const board of catalog.boards) {
  SCENARIOS.push({ name: `m5-board-${board.id}`, loadout: dress({ board: board.id }), ...STILL, cams: ["play", "deck"] });
}
// The look set (polish pass, 2026-10-22): light-tone surfers at the play camera in the default stance, the pump and the tube, both bodies.
for (const [pose, pe] of Object.entries(FIN_POSES)) {
  SCENARIOS.push({ name: `look-male-${pose}`, loadout: dress({ skin: "#f1c27d" }), ...pe, cams: ["play"] });
  SCENARIOS.push({ name: `look-female-${pose}`, loadout: dress({ ...FEMALE, skin: "#f1c27d" }), ...pe, cams: ["play"] });
}
// Every shot is taken from the play camera and the close camera unless the scenario names its own.
const DEFAULT_CAMS = ["play", "close"];

// Runs in the page. Puts the game in the state the scenario shows, using the real save, the real settle code and the test hooks.
function setupM4(kind, body) {
  const S = window.__surf;
  const save = S.save();
  const trophies = [{ season: 1, place: 4, at: 1 }, { season: 2, place: 2, at: 2 }];
  switch (kind) {
    case "menu":
      Object.assign(save, { season: 3, event: 4, points: 790, trophies });
      S.menu();
      break;
    case "brief-locked": // Season 2 calendar: event 6 is Pipeline (locked, played at Teahupo'o)
      Object.assign(save, { season: 2, event: 6, points: 330, trophies: trophies.slice(0, 1) });
      S.startTour();
      break;
    case "brief-finale": // Season 7 Finale: the side-shore wind season
      Object.assign(save, { season: 7, event: 10, points: 3000, trophies });
      S.startTour();
      break;
    case "results-finale": // a runner-up finish in the Season 3 Finale that ranks the player up
      Object.assign(save, { season: 3, event: 10, points: 860, trophies: trophies.slice(0, 2), pity: 2 });
      S.startTour();
      S.forceFinish(2);
      break;
    case "results-win":
      Object.assign(save, { season: 2, event: 5, points: 300, trophies: trophies.slice(0, 1) });
      S.startTour();
      S.forceFinish(1);
      break;
    case "results-out":
      Object.assign(save, { season: 3, event: 6, points: 700, trophies, pity: 1 });
      S.startTour();
      S.forceFinish(8);
      break;
    case "locker": {
      Object.assign(save, { season: 4, event: 1, points: 1200, trophies });
      S.setBody(body || "female");
      for (let i = 0; i < 6; i++) S.grantGear("common", 10 + i);
      for (let i = 0; i < 6; i++) S.grantGear("rare", 20 + i);
      for (let i = 0; i < 3; i++) S.grantGear("epic", 30 + i);
      const owned = save.owned.filter((id) => id.startsWith("gen:"));
      save.loadout.board = owned.find((id) => id.startsWith("gen:board")) || save.loadout.board;
      const b = save.loadout.body === "male" ? "gen:bottom:male" : "gen:bottom:female";
      save.loadout.bottom = owned.find((id) => id.startsWith(b)) || save.loadout.bottom;
      S.setLoadout(save.loadout);
      S.menu();
      document.querySelector("#open-locker").click();
      break;
    }
    case "gear": {
      // epic board + epic outfit (board shorts, or the women's bikini), all generated, for this body; the female also gets a rare rashguard set
      S.setBody(body);
      const got = {};
      for (const tier of ["epic", "rare"]) {
        for (let seed = 1; seed <= 80; seed++) {
          const it = S.grantGear(tier, seed);
          if (!it.generated) continue;
          if (it.shape && tier === "epic" && !got.board) got.board = it.id;
          else if (it.style === "rashset" && tier === "rare" && !got.set) got.set = it.id;
          else if ((it.style === "trunks" || it.style === "bikini") && tier === "epic" && !got.bottom) got.bottom = it.id;
        }
      }
      if (!got.board || !got.bottom || (body === "female" && !got.set)) throw new Error(`gear scenario found ${JSON.stringify(got)}`);
      return { body, skin: body === "male" ? "#8d5524" : "#e0ac69", bottom: body === "female" ? got.set : got.bottom, board: got.board };
    }
    default:
      throw new Error(`unknown m4 kind ${kind}`);
  }
  return null;
}

// Runs in the page. Registers the outfit (m5.outfit: "bottom" is the board shorts or the bikini, "set" the women's rashguard set;
// default: shorts for the male, the rashguard set for the female) and a board in this pattern, and returns the loadout that wears
// them. m5.cloth and m5.board override the two colour pairs; m5.match false gives the board its own pattern (m5.boardPattern).
function setupM5(m5, cloth, board) {
  const S = window.__surf;
  const make = (slot, colours, pattern) =>
    S.addGear({ slot, body: slot === "board" ? null : m5.body, pattern, color: colours[0], color2: colours[1], tier: "epic", name: "Print test" }).id;
  const outfit = m5.outfit || (m5.body === "male" ? "bottom" : "set");
  return {
    body: m5.body,
    skin: m5.body === "male" ? "#8d5524" : "#e0ac69",
    bottom: make(outfit, m5.cloth || cloth, m5.pattern),
    board: make("board", m5.board || board, m5.boardPattern || m5.pattern),
  };
}

async function shoot(page, file) {
  await page.screenshot(EXT === "png" ? { path: file } : { path: file, type: "jpeg", quality: 92 });
}

function build() {
  const r = spawnSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`npm run build exited ${r.status}`);
}

function serve() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const file = join(dist, rel);
    if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  if (flag("list")) {
    for (const s of SCENARIOS) console.log(s.name);
    return;
  }
  if (!flag("skip-build")) build();
  const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chrome) throw new Error(`no Chrome found; tried ${CHROME_CANDIDATES.join(", ")}`);
  mkdirSync(outDir, { recursive: true });
  const server = await serve();
  const port = server.address().port;
  let browser = null;
  const log = [];
  try {
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      args: ["--no-sandbox", "--ignore-gpu-blocklist", "--enable-webgl", "--use-angle=metal", "--window-size=1280,720"],
      defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    });
    const page = await browser.newPage();
    page.on("pageerror", (e) => log.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") log.push(`console.${m.type()}: ${m.text()}`);
    });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__surf && window.__surf.ready, { timeout: 120000 });
    await page.evaluate(() => {
      window.__surf.pause = true;
    });

    const wanted = SCENARIOS.filter((s) => !only.length || only.includes(s.name) || only.some((o) => s.name.startsWith(o)));
    for (const sc of wanted) {
      if (sc.m4) {
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
        await page.waitForFunction(() => window.__surf && window.__surf.ready, { timeout: 120000 });
        await page.evaluate(() => {
          window.__surf.pause = true;
        });
        const result = await page.evaluate(setupM4, sc.m4, sc.body);
        if (sc.m4 === "gear") {
          sc.loadout = result;
          console.log(`${sc.name}: ${JSON.stringify(result)}`);
        } else {
          await page.evaluate(() => {
            window.__surf.advance(0.6);
            window.__surf.render();
          });
          await new Promise((r) => setTimeout(r, 200));
          const file = join(outDir, `${sc.name}.${EXT}`);
          await shoot(page, file);
          console.log(`wrote ${file} mode=${await page.evaluate(() => window.__surf.mode())}`);
          continue;
        }
      }
      if (sc.m5) {
        sc.loadout = await page.evaluate(setupM5, sc.m5, M5_CLOTH, M5_BOARD);
        console.log(`${sc.name}: ${JSON.stringify(sc.loadout)}`);
      }
      if (sc.view) {
        // the menu and Locker are only reachable from a fresh page: reload, then set the loadout
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
        await page.waitForFunction(() => window.__surf && window.__surf.ready, { timeout: 120000 });
        await page.evaluate((loadout) => {
          const S = window.__surf;
          S.pause = true;
          S.setLoadout(loadout);
          S.advance(1);
        }, sc.loadout);
        if (sc.view === "locker") {
          await page.click("#open-locker");
          await page.evaluate(() => window.__surf.advance(0.5));
        }
        const info = await page.evaluate(() => ({ state: window.__surf.state(), meshes: window.__surf.meshes() }));
        await page.evaluate(() => window.__surf.render());
        await new Promise((r) => setTimeout(r, 150));
        const file = join(outDir, `${sc.name}-play.${EXT}`);
        await shoot(page, file);
        console.log(`wrote ${file} mode=${await page.evaluate(() => window.__surf.mode())}`);
        continue;
      }
      const info = await page.evaluate(async (sc) => {
        const S = window.__surf;
        S.setLoadout(sc.loadout); // applies the whole loadout; throws if an item is for the other body
        S.setAutopilot(false);
        S.startFree();
        S.setInput(0, 0);
        const out0 = {};
        if (sc.dropIn) {
          S.advance(0.35); // just after the drop starts
          out0.state = S.state();
          out0.meshes = S.meshes();
          return out0;
        }
        S.advance(0.6); // settle the pose from the snap
        const out = {};
        if (sc.autopilot) {
          S.setAutopilot(true);
          let guard = 0;
          const want = sc.autopilot;
          while (guard++ < 4000) {
            S.advance(1 / 30);
            const st = S.state();
            if (want === "tube" && st.inTube && st.tube > 2.5) break;
            if (want === "claim" && st.mode === "claim") {
              S.advance(0.9);
              break;
            }
            if (want === "wipe") {
              if (guard === 200) S.triggerWipe();
              if (guard > 200 && S.state().mode === "wipe" && S.state().z) {
                S.advance(0.5);
                break;
              }
            }
            if (st.ended) break;
          }
          S.setAutopilot(false);
          out.state = S.state();
        } else {
          // ride mid-face on the autopilot first so the shot is not taken from the wave's base
          S.setAutopilot(true);
          S.advance(1.1);
          S.setInput(0, 0);
          S.advance(0.3);
          S.setInput(sc.steer, sc.thr);
          S.advance(sc.sec);
          out.state = S.state();
        }
        out.meshes = S.meshes();
        return out;
      }, sc);
      if (sc.studio) {
        for (const [view, opts] of sc.studio) {
          await page.evaluate((opts) => window.__surf.studio(opts), opts);
          await new Promise((r) => setTimeout(r, 150));
          const file = join(outDir, `${sc.name}-${view}.${EXT}`);
          await shoot(page, file);
          console.log(`wrote ${file}`);
        }
        await page.evaluate(() => {
          window.__surf.studioEnd();
          window.__surf.resize();
        });
        continue;
      }
      for (const cam of sc.cams || DEFAULT_CAMS) {
        await page.evaluate((cam) => {
          const S = window.__surf;
          S.render();
          if (cam === "close") S.closeCamera(2.05);
          if (cam === "back") S.backCamera(2.7);
          if (cam === "tight") S.backCamera(1.35);
          if (cam === "face") S.faceCamera(1.5, 32);
          if (cam === "deck") S.boardCamera(2.3);
        }, cam);
        await new Promise((r) => setTimeout(r, 150));
        const file = join(outDir, `${sc.name}-${cam}.${EXT}`);
        await shoot(page, file);
        if (cam === "face" || cam === "back" || cam === "tight") await page.evaluate(() => window.__surf.resize());
        if (cam === "deck") await page.evaluate(() => window.__surf.boardCameraEnd());
        console.log(`wrote ${file} mode=${info.state.mode} inTube=${info.state.inTube} s=${info.state.s.toFixed(2)}`);
      }
      if (flag("meshes")) console.log(info.meshes.join("\n"));
    }
  } finally {
    if (browser) await browser.close();
    await new Promise((r) => server.close(r));
    for (const l of log) console.log(l);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
