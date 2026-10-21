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

## Tour

Free surf is one showcase wave. **Tour N** is a seeded event: swell, wind, tide, light, rivals, and hazards all come from `N`. Early tours ramp quickly, then the curve flattens, with a heavier championship every 10th stop. Sharks show up from tour 3. Teahupoʻo is the break that is actually built. Pipeline, J-Bay, Nazaré, and a beachbreak are in the location list as locked stubs and fall back to the same reef until they are built.

Placement can unlock earned gear. Premium pieces stay locked (nothing is charged). Progress is in `localStorage` under `endless-swell-save-v1`.

The character is assembled from `src/data/catalog.json`: body, skin tone, bottom, optional top, board shape and pattern. Owned items swap in immediately.

## Layout

- `src/wave.js` — barrel math and the GLSL copy of it
- `src/shaders.js`, `src/scene.js` — water, sky, island, boats, spray, bloom, grade
- `src/ride.js` — physics, camera clamp, hazards
- `src/competition.js` — tours, heats, judging
- `src/surfer.js` — procedural body and board
- `src/save.js`, `src/ui.js`, `src/main.js` — save, menus, match flow

Water, spray, foam, the island, and the boards are procedural. There are no image textures.

## Roadmap

A real shop flow for the premium pieces, the other four breaks as their own bathymetry, and a CrazyGames SDK hook. The Pages build stays one JS chunk, well under 50 MB.

## License

Code is [MIT](LICENSE), Copyright © 2026 Ed Ostrowski.

[three.js](https://github.com/mrdoob/three.js) is MIT licensed (Copyright © 2010-2026 three.js authors). No third-party art is bundled. The Teahupoʻo footage used while building the look is a private reference and is not in this repository.
