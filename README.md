# Endless Swell

**Play:** [https://eddyo78.github.io/endless-swell/](https://eddyo78.github.io/endless-swell/)

A browser surfing game. One heavy reef break, an endless tour, and a surfer you dress yourself. No install — it runs in WebGL.

## Controls

| Input | Action |
| --- | --- |
| Left arrow / A / drag left | Toward the wall |
| Right arrow / D / drag right | Down the face, toward the trough |
| Up arrow / W / Space / drag up | Pump |
| Down arrow / S / drag down | Stall |
| R | Restart the wave |
| Enter | Start from the menu or the heat brief |

The camera sits just behind the board, wide and slightly fisheye, and it stays on the air side of the water. Steering into the wall will not punch the view through the wave.

Quality (high / low) is in the corner and is remembered on this browser.

## Run it locally

```bash
npm ci
npm run dev
```

`npm run build` writes `dist/` for GitHub Pages (`base` is `./`). `npm run build:single` also writes `single/endless-swell.html`, one file with the script and styles inlined, which opens from `file://`.

Node 20 or newer.

## How a ride works

The wave is one analytic barrel, shared by the mesh shader and the gameplay code (`src/wave.js`). The surfer travels toward −Z. −X is the wall, +X is the open face. Speed comes from the slope under the board: climbing spends it, dropping and a timed pump give it back, stalling and drag take it away. A deep barrel that runs long enough spits. Sharks, reef, closeouts, and loose boards are placed from the tour seed.

Judging is 0–10 from commitment, time in the tube, speed, flow, variety, a clean exit, and a spit. A wipeout caps the wave. Heats are best two waves. The draw is a round of 16, a quarterfinal, a semifinal, and a final. Priority is a rule: drop in on someone else's wave and the score is cut; a second time, or a strict-priority tour, and the wave is a zero.

## Seasons and events

Free surf is one showcase wave. The tournament never ends and is shown as **Season S · Event E** (the player never sees a level number; the internal number n = (S-1)·10 + E seeds everything). A season is ten events and event 10 is the **Season Finale**. Every event is a seeded round-of-16 draw: the swell, wind, tide, light, rivals and hazards come from the season and the event, so Season 2 · Event 3 never plays like Season 1 · Event 3.

- **Gate.** Finish in the top 4 (win the quarterfinal) to advance; winning pays more. A failed event stays on the same event: same conditions and rival field, a re-drawn bracket and new heat dice. Leaving after a quarterfinal win banks your 4th place.
- **Difficulty.** A sawtooth (`src/competition.js` `eventDials`, numbers in `src/data/tour.json`): a season climbs over events 1-9 and the Finale adds a small bump; the next season starts well below the last peak but a little above the last start, and both ends creep toward a cap (rival skill 0.72, Finale 0.75, swell 14 ft) that a skilled player can beat. Hazards (sharks, reef, closeouts, loose boards) ramp over seasons 1-3 and then stay.
- **Rule twists.** Event 5 of every season is spit-counts-double and event 8 is strict priority. From season 4 each season also carries one season twist, in blocks of all six: two-wave set, 30-second heat, side-shore wind, dry reef, spit-double, strict priority. At most two are on at once.
- **Calendar.** Each season has its own seeded order of ten stops (`seasonCalendar`). Teahupoʻo opens the season and is the Finale; two stops are premium breaks and the rest are free. Pipeline, J-Bay and Nazaré are shown as locked, Beachbreak (free) as not built yet; every stop that is not built is surfed on Teahupoʻo.
- **Rank and trophies.** World Ranking Points per finish (only go up), a rank ladder that keeps going (Qualifier ... Legend, then Legend II, III, ...) and a trophy shelf with a season-stamped trophy for every top-4 finish in a Season Finale.
- **Earned gear.** Placement wins gear from the season's reward band (`rewards` in `src/data/tour.json`): common, rare or epic, drawn from exactly that tier, with a pity counter (five finishes without gear guarantee a common). Pieces are generated (`src/gear.js`): basic pattern x palette x slot, made for the body worn when won, and every outfit is one matching set (one pattern, one colour pair): board shorts for the man (men wear no shirts and no suits), the bikini (top and bottom), a rashguard set (rashguard and bottom) or a fullsuit (rare and up) for the woman, and boards for both. A man's win may come as a kit: the shorts and a board in the same pattern and colours (`gear.kit` in `tour.json`). When the palette tables are used up, generated palettes continue, so it never runs out. Premium pieces stay locked and nothing is charged.

Progress is in `localStorage` under `endless-swell-save-v2` (season, event, attempt, points, pity, trophies, gear recipes, items, loadout). A version 1 save (`endless-swell-save-v1`) is read once and migrated, and left in place. Teahupoʻo is the break that is actually built.

The character is assembled from `src/data/catalog.json`: male or female body, skin tone, one outfit (a matching set) and a board shape and pattern. The game has a male body and a female body, and every outfit is made for exactly one of them (`body` in the catalog): the bikini is the woman's, trunks are the man's and the man has nothing else to wear (no shirts, no suits); the women's rashguard sets and suits are the woman's. The Locker shows only the active body's outfits, and `surfer.apply()` throws if an item is for the other body. The main menu picks the surfer and the skin tone. Owned items swap in immediately. Patterns (stripes, chevron, sunburst, palm, tiger, panels) are drawn at runtime as small mask textures and cached (`src/printart.js`), mapped onto each garment by a print projection computed at load (`src/printuv.js`) and onto each board by planform UVs (`src/board.js`), and mixed in the two item colours by the material (`src/printmat.js`); no image files are shipped for them. The bodies are rigged MakeHuman meshes with skin, eye, eyebrow, eyelash and hair textures, posed in code; see [ASSETS.md](ASSETS.md).

## Layout

- `src/wave.js` — barrel math and the GLSL copy of it
- `src/shaders.js`, `src/scene.js` — water, sky, boats, spray, bloom, grade
- `src/island.js` — the backdrop headland: height function, terrain mesh and shader, palms (all generated)
- `src/ride.js` — physics, camera clamp, hazards
- `src/competition.js` — the difficulty sawtooth, twists, calendar, heats, judging
- `src/season.js`, `src/gear.js`, `src/data/tour.json` — season arithmetic, points, ranks, reward table; the earned-gear generator; every tournament number
- `src/surfer.js` — rigged surfers, outfits, code-driven poses, board
- `scripts/build-surfers.mjs`, `scripts/lib/` — generates the surfers; `scripts/lib/bodyspec.mjs` holds each body's shape targets, `scripts/measure-body.mjs` prints the body proportions (milestone 2 against now)
- `npm run check` — board, pose (feet on the board, stance, shoulders), genders, body proportions, island, the tour curve (prints events 1-300), save version 2 and the finish rules, the reward simulation, the print UVs and pattern tables (`scripts/check-prints.mjs --no-browser`); `npm run check:prints` also draws every pattern in headless Chrome, uploads it, wears every item and compares printed colours with solid ones (needs `npm run build` first); `npm run check:flow` plays the season flow in headless Chrome; `npm run shots` photographs everything (`--only`, `--out`); `node scripts/perf.mjs` measures frame cost
- `src/save.js`, `src/ui.js`, `src/main.js` — save, menus, match flow

Water, spray, foam, the island, the boards and the clothes are procedural. Surfer bodies, skin, eyes, brows, lashes and hair come from MakeHuman CC0 assets (see [ASSETS.md](ASSETS.md)); the clothes are cut from the body mesh by `scripts/lib/garments.mjs`.

## Roadmap

A real shop flow for the premium pieces, the other four breaks as their own bathymetry (Beachbreak first), and a CrazyGames SDK hook. The Pages build stays one JS chunk, well under 50 MB (about 11 MB now).

## License

Code is [MIT](LICENSE), Copyright © 2026 Ed Ostrowski.

[three.js](https://github.com/mrdoob/three.js) is MIT licensed (Copyright © 2010-2026 three.js authors). Surfer meshes are derived from MakeHuman assets released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) by the MakeHuman Team. Sources, what was generated here, and why the meshes are not Draco-compressed are listed in [ASSETS.md](ASSETS.md). No MakeHuman application code (AGPL) is included. The Teahupoʻo footage used while building the look is a private reference and is not in this repository.
