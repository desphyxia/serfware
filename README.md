# Seedfall

A cosy settlement game in the spirit of Serf City (The Settlers, 1993), on small procedurally
generated planets. Built with three.js; a Steam build via Electron lives in `desktop/` (appid 480 in development, see docs/STEAM.md).

- Design proposal: `proposal/seedfall.html`
- Roadmap and batch plan: `docs/ROADMAP.md` (one GitHub issue per batch)

## Run

```sh
npm ci
npm run dev          # http://localhost:5173, add #some-seed to pick a world
npm run check        # lint, typecheck, tests, single-file build, headless smoke test
npm run shots        # progress screenshots into artifacts/shots
npm run touch-test   # the game on a phone-sized touch screen (taps, long presses, two-finger gestures)
npm run soak         # long all-AI games (SOAK_DAYS=30): rules checked daily, determinism, a war to the end
```

The soak run can also be started by hand in CI (Actions, Soak, Run workflow; it never runs on its
own). It writes `soak-report.json`: per run, how each settlement grew, who won, and the time each
game day took.

## Multiplayer (WebRTC, development)

Games run in deterministic lockstep: every machine simulates the same world and only commands
travel over the network. Two co-op modes exist today: **shared keep** (everyone builds one
economy) and **neighbours** (each player gets their own Hearthship and territory).

```sh
npm run signal       # signalling server on ws://localhost:8787 (only used to connect)
npm run dev          # open two tabs, press M, Multiplayer: Host in one, Join the same room in the other
npm run mp-test      # two headless browsers play over real WebRTC and must stay in sync
```

Without a server, the host can create an invite code and the guest answers with a reply code.
The published single-file artifact runs in a sandbox that blocks network connections, so
multiplayer needs `npm run dev` or the desktop build (which plays through Steam lobbies).

## Saves

Press M for the game menu. Saves are the seed plus every command; loading replays them.
"Copy save" puts the save on the clipboard so it can be attached to bug reports.

## Territory, rivals and fog

Your border is made of light. Lantern posts, lamp houses and beacon towers are lit once a warden
walks in, and their light claims the land around them. Put out a lantern (demolish it) and
whatever stood only in its light burns down. Wardens per lantern follow the garrison sliders in
Economy → Tools (frontier and inland). Land you have never lit stays in fog.

Solo worlds start with one AI rival (Settings → World sets 0–3). The rival builds and expands
with lanterns like a player would, from inside the deterministic simulation. The debug dialog
can lift the fog.

## Combat

Only enemy lantern buildings and Hearthships within reach of your own lit lanterns can be
attacked. Select one to see how many wardens can go (each lantern keeps one at home) and the
chance to take it. Wardens march cross-country (mounts tire them less), loose a volley if they
carry bows, then duel at the door one at a time. Rank, blades, fatigue, resolve (gold, Glow,
full bellies) and the defenders' home ground decide each duel. Take a building and the border
redraws; buildings cut off are stranded, not burned, and come back if the land is won back
within a season. Take a Hearthship and that settlement falls. You can also win by holding 7 of
the 12 Star Wells for a day. Battle stakes (Settings → World) are Wounded by default, or Mortal.
Weaponsmiths make blades, bowyers bows, and stables mounts; gold in storage pays for promotions.

## Living world

Rain gathers into rivers that run to the sea; basins fill into lakes. Weather fronts drift with
the wind (trade winds near the equator, westerlies further out), bringing rain, and snow below
freezing. Rain leaves mud that slows walking; snow lies and melts. Seasons follow the planet's
axial tilt and are opposite in each hemisphere; fields only grow in the growing season. Each
harvest tires the soil, which recovers when left alone; water nearby and a hedgerow of trees
help crops. The top bar shows the season, temperature and weather where you look, with
tomorrow's forecast and the soil in its tooltip. The debug dialog can summon weather and skip days.

## Campaign

The game menu opens on the Campaign tab: a short tutorial (one goal at a time, the tool to use
pulses in the toolbar), The Long Voyage (twelve chapters on the Lanterne world, from landfall to
a second world in bloom; each opens when the one before is done) and standalone scenarios. Goals
show at the side of the screen. Chapters can be played in co-op: pick one under Multiplayer,
Scenario. Goals and scripted events run inside the simulation, so every player sees them at the
same moment and saves replay them exactly.

## Creating: world painter, scenarios, mods

The game menu's Create tab holds the creative tools:

- **World painter.** Raise and lower the ground, level it, flood it into sea, lay down regions
  (Meadowlands, Canopy Deeps, Saltglass…), plant woods, clear land, scatter rocks, put ore
  underground and move the Star Wells. A painted world is the seed plus the strokes, so it saves
  small and plays the same everywhere. Ctrl+Z undoes. Play it, save it, export it, or build a
  scenario on it.
- **Scenario editor.** A title, a story, goals (all at once or one at a time), events that fire
  once ("on day 2, a cold snap"; "when three houses stand, 10 planks") and how it can be lost, on
  any seed or painted world, with rivals, difficulty and your mods. Save, play, export.
- **Mods.** JSON packs that add goods and buildings (borrowing a base building's model), change
  costs, work times and other numbers, rename and retune the warden ranks, or change the start.
  "Mod template" downloads a worked example. Turned-on mods apply to new games and travel with
  saves and multiplayer starts.

Creations are kept in this browser and exported as `.json` files; the Steam build shares them on
the Workshop (see docs/STEAM.md).

## Keys

| Key | Action |
|-----|--------|
| Esc | Settings |
| F3 or ` | Debug dialog |
| F8 | Report a bug (copyable report) |
| Space | Pause / resume |
| M | Game menu (saves, multiplayer) |
| 1 / 2 | Flag / road tools |
| 3–7 | Buildings (7: lanterns, which light up and widen your border) |
| X | Demolish |
| P | Economy panel (stock, people and Glow, distribution, tools) |
| Click a settler | Their card: age, skills, journal; Follow keeps the camera on them |
| G | Hex grid overlay |
| WASD, Q/E | Move and turn the camera |
| R | Reset to north-up overview |
| Page Up / Page Down | Tilt the camera |

## Touch (phones and tablets)

| Gesture | Action |
|---------|--------|
| Tap | Select, place, or pick the tool under your finger |
| One finger drag | Move over the planet |
| Pinch | Zoom |
| Twist two fingers | Turn the view |
| Slide two fingers up or down | Tilt the view |
| Long press on the map | Put away the tool in hand; with nothing in hand, inspect what is there |
| Press and hold a tool button | What it does (there is no hover on a touch screen) |

On a phone the tools sit in two rows along the bottom and the stock is one line you can swipe.

## Reporting bugs

The line at the bottom left always shows seed, build, coordinate and time of day. Click it to copy.
Press F8 for a full report with errors, recent log lines, memory history and settings.

## Layout

| Path | What |
|------|------|
| `src/sim` | Deterministic, engine-agnostic simulation. No three.js or browser APIs (enforced by lint). |
| `src/core` | Settings, logging, crash reporter, memory monitor. |
| `src/render` | three.js rendering. |
| `src/ui` | DOM interface: HUD, dialogs. |
| `scripts` | Artifact packaging, smoke test, screenshots. |
