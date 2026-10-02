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
- Batch 11b: bucket-line figures running between a well and the fire; a firebreak order (clear a
  strip of scrub and trees); burnt-down buildings leaving ruins; erosion and deltas changing the
  terrain height, not only the soil; a groundwater overlay in build mode; a bow for the hunter's
  figure; AI rivals fighting fires.
- Batch 13b: gliders riding updrafts between Canopy treehouses; rope lifts and gliders as
  carriers (a canopy logistics layer); regional colour grading; honey and fruit in recipes
  (honey cakes at the bakery); orchards and hedgerows for the AI; the planned regions'
  (Rimefall, Emberglass, Saltglass, Tidewater, Lumen, Skyreef) rules and flora in batches 14–16.
- Soak findings to follow up: a war of four Wardens on a tiny world takes the human seat and
  then stalls for 90+ days (three equal Wardens never finish each other; they need to pick a
  weakest target and press); a Builder squeezed onto a small coastal start grows slowly; late game
  days cost up to ~4 s of simulation on a small world with four settlements (fine at normal
  speed, worth profiling for fast-forward).
- Batch 25b: painting with a held brush (strokes while dragging; today each click remakes the
  world, about half a second); a height and region preview under the brush; mod scripting beyond
  data (new jobs, new kinds of building); models and icons in mods; scenario editor triggers with
  several actions and conditions combined with "and"; Workshop ratings, update notes and preview
  images; scenario and world thumbnails in the library.
- Batch 24b: voiced or illustrated story beats (the story is text for now); chapter goals that
  follow the whole team in co-op (they follow player 0's settlement); a scenario editor and
  shareable scenario files; medals for finishing chapters fast or on hard; tutorial steps for
  the economy panels, combat and the night sky; campaign progress kept in the save and synced
  between devices (it lives in this browser's storage).
- Batch 23b: rejoining and spectating over Steam (the Steam lobby closes at the start); a
  scoreboard and team chat; picking teams for AI rivals in the lobby; relay posts (each player
  keeping one planet) with hand-overs; fair starts weighing biome and neighbours too; a spectator
  camera that follows the action; stewards that play to the absent player's own plans.
- Batch 22b: rivals that break their own word (a Warden turning on a truce when the odds are
  good) and remember who broke theirs; walking traders and prisoners on the map instead of goods
  appearing in the keep; caravans choosing what to bring from what the settlement lacks; hunting
  the native beasts and taming them as pack animals; hamlets with their own small trades;
  rival names and temperaments shown over their Hearthships; diplomacy between human players
  in neighbours mode tested over the network.
- Batch 21b: blighted rows reading clearly in every light; flood water that follows the
  terrain; craters around meteorites; settlers sheltering from meteor showers and floods; a
  calendar of past and coming events in the Almanac; difficulty for the AI's choices; per-event
  toggles in custom games; insurance for buildings (a "guild hall" that rebuilds).
- Batch 20b: settlers walking to the maypole and dancing on feast days; more Almanac pages
  (aurora, sky islands, glowcaps, comets, the Bloom); forecasts in the Almanac itself; lore
  pages from each relic; statues of famous settlers; a music settings page (layers on and off);
  decorations for the AI; colonies keeping their own Almanac but sharing what home knows.
- Batch 19b: terraforming for the AI; an atmosphere panel with history graphs; ice caps (the
  polar ice biome) visibly retreating; comets streaking down to their impact; mirrors seen in
  orbit; native fauna; a Bloom celebration (festival, colour grade, flowers everywhere); oxygen
  and pressure affecting settlers (masks, domes) before the Bloom; molten worlds cooled by
  sunshades into a lava-crust look; reserves drawn as a border on the ground.
- Batch 18b: colonies' wardens and lanterns on shared colony worlds (PvP beyond home), AI
  rivals that colonise, the AI using launch rails, return voyages carrying people home, the
  founders walking to the rail to board (they vanish from the keep for now), a moving craft in
  orbit seen from the system map in 3D, colony-coloured roofs from cultural drift, dialect names
  for colony-born newcomers, per-colony saves of the view, and surveying from orbit before a
  probe lands (hazard markers on the globe).
- Batch 17b: a molten world's lava look, gas giants you can orbit (their moons as landing
  sites), multiplayer: seeing the system shared (survey views are local for now), a 3D orrery
  instead of the flat map, carrier load (how much one carries) by gravity, and system-wide
  summary sim for colonies once batch 18 lets people live on other planets.
- Batch 16b: a stronger day/night terminator on locked planets from orbit (the view fill evens
  it out); skiffs as real carriers between islands and ropeways; ballast for heavy goods
  on low-gravity worlds; gliders as a carrier layer over the Skyreef (with the Canopy gliders);
  peat bogs that regrow; glowcaps lighting roads for carriers beyond the mire; AI use of
  glowcap farms, ropeways and peat.
- Batch 15b: a salt trade route with rival settlements (salt as currency); barges carrying goods
  along the coast and up rivers (boats are moored props for now); tide tables in the Almanac;
  the AI raising causeways and siting dew condensers; storm forecasts and shelter orders; glass
  windows and lamps made from the kiln's glass; gulls over the flats; spires as a quarry of
  salt crystal.
- Batch 14b: coal as waystation fuel (a "fuel" input group without touching log distribution);
  settlers caught by an eruption fleeing; lava flows and new land from big eruptions; ice fishing
  holes on frozen lakes; warm clothing from a tailor for Rimefall walkers; the AI siting
  waystations and avoiding ice roads before the thaw; obsidian tools and glass for the Lumen
  Mire lanterns; a warmth overlay in build mode; aurora sounds.

## Picking up work in a new session

1. Read this file and the open issues; the lowest-numbered open batch issue is next.
2. `npm ci && npm run check` must pass before starting.
3. Work on a branch `batch-NN-short-name`, open a PR that closes the issue, merge when CI is green.
4. Publish `dist-single/index.html` as the batch's playable artifact.
