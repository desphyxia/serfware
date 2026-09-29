# Seedfall roadmap

Seedfall is a settlement game in the spirit of Serf City (The Settlers, 1993), set on small
procedurally generated planets. The design proposal lives in `proposal/seedfall.html`.

Every batch ends with CI green, one PR merged into `master`, and a playable single-file build.
Each batch has a GitHub issue (#1–#28) with its detailed scope.

## Principles

- **Everything is procedural.** Terrain, grids, biomes, flora, buildings, sounds and whole star
  systems come from seeds. A system seed can produce any number of planets; only the watched
  planet runs the full simulation.
- **Engine-agnostic simulation.** `src/sim` never imports three.js or browser APIs (lint rule).
  It uses fixed-point math and seeded randomness so lockstep multiplayer and golden replays work,
  and so the simulation can later be ported (for example to Godot) and verified against replays.
- **Content is data.** Buildings, goods, recipes, biomes and units are JSON.
- **Bug reports are easy.** The bug line always shows seed, build, coordinate and time of day.
  The crash reporter collects errors, logs, memory trends and settings into one copyable report.
- **Web first, Steam next.** WebRTC multiplayer comes first for development. The Steam build
  (Electron + steamworks.js, appid 480 during development) plugs into the same transport layer.

## Batches

| # | Batch | Issue |
|---|-------|-------|
| 1 | Tooling, debug overlay, settings, crash reporter | #1 |
| 2 | Planet: seeded spherical hex grid, 12 seeded pentagons, sky, day/night | #2 |
| 3 | Roads, flags, carriers, first buildings | #3 |
| 4 | Liveliness 1: vegetation, wind, animals, smoke, lights, ambient sound | #4 |
| 5 | WebRTC lockstep multiplayer, lobby, save/load | #5 |
| 6 | Economy 1: food, geology, mining, smelting, tools → professions | #6 |
| 7 | Settlers: individuals, needs, households, skills, follow cam, Glow v1 | #7 |
| 8 | Territory: lantern buildings, light borders, fog of war, AI builder v1 | #8 |
| 9 | Combat and PvP skirmish (follow-ups in #37) | #9 |
| 10 | Living world 2: water, wind, weather, seasons, soil | #10 |
| 11 | Living world 3: fire, ecology, succession, erosion, groundwater, wear | #11 |
| 12 | Steam: Electron + steamworks.js, Steam networking, Deck | #12 |
| 13 | Biome framework, Meadowlands polish, Canopy Deeps | #13 |
| 14 | Rimefall Tundra, Emberglass Steppe | #14 |
| 15 | Saltglass Flats, Tidewater Reach | #15 |
| 16 | Lumen Mire, Skyreef | #16 |
| 17 | Procedural star systems with any number of planets | #17 |
| 18 | Colonisation: probes, Hearthship, landing, launch rails, skyships | #18 |
| 19 | Terraforming: atmosphere model, megaprojects, seeding, Bloom | #19 |
| 20 | Knowledge and culture: Almanac, ruins, festivals, adaptive music | #20 |
| 21 | Adversity events and difficulty | #21 |
| 22 | AI personalities and diplomacy | #22 |
| 23 | Multiplayer modes 2: teams, relay co-op, Bloom race, fair starts | #23 |
| 24 | Campaign: tutorial, The Long Voyage, scenarios | #24 |
| 25 | Creative: world painter, scenario editor, mods, Workshop | #25 |
| 26 | Presentation: photo mode, time-lapse, postcards, async letters | #26 |
| 27 | Scale, handheld tuning, accessibility, localisation | #27 |
| 28 | Release candidate: soak tests, leak hunting, balance, stability | #28 |

Stretch after release: ranked play on curated seeds, persistent frontier servers.

## Follow-ups not yet filed as issues

- Batch 10b: dams and irrigation channels, water mills, floods from heavy rain on rivers,
  hedgerow and crop-rotation choices for farmers, frozen lakes, mud tint on roads,
  forecasts gated behind the Almanac (batch 20).

## Picking up work in a new session

1. Read this file and the open issues; the lowest-numbered open batch issue is next.
2. `npm ci && npm run check` must pass before starting.
3. Work on a branch `batch-NN-short-name`, open a PR that closes the issue, merge when CI is green.
4. Publish `dist-single/index.html` as the batch's playable artifact.
