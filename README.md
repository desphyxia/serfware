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

## Roads and carriers

Transport follows Serf City's rules (studied from Freeserf's source):

- A road gets more carriers when goods queue on it: up to 2 on a road of 4 tiles, rising to 11
  on the longest roads. The extra carriers go home after three idle hours.
- A carrier arriving at a full flag swaps its good for one that goes back over its road, so two
  full flags never block each other. It also takes a good back rather than walk back empty.
- Goods take the road that brings them closer with the shortest queue.
- Supplies go round the buildings that want them: each building's claim is its distribution
  weight, halved for every one it already holds or has on the way. Sites whose builder has
  arrived come first. Goods already on their way into a store go on to a building that needs
  them, instead of being taken out again later.
- Economy panel → Transport sets which goods carriers pick up first. Goods that have waited an
  hour move up the list by themselves.

`npm run soak -- transport` measures it: goods waiting on flags, full flags, stale goods and
growth over 12 game days on several seeds.

## Map settings

Settings, World, **Ore mix** (balanced, coal and iron, gold-rich, scarce gold, stone country) and
**Hills from the start** (close to very far) shape the next world you generate, as in Settlers 2's
map generator. They travel with saves and multiplayer starts. The hills setting only moves the
start among sites with room to build, so on a hilly planet the effect can be small.

## Starting ore

Every start has coal, iron and granite within 10 steps of its Hearthship and gold within 14. Where
the generated land lacks a kind, a small deposit is laid in the nearest free hills. (A start with
no hills in reach has none to give.)

## Geologists and mines

Select a flag and choose **Send geologist** (it needs a hammer and a mountain, or ground within two
steps of one, in reach of the flag). A geologist samples 12 spots around the flag and plants a
signpost on each: ore, or nothing. A **small** signpost marks a deposit under 20 loads, so you
don't build a mine on a speck. You are told once when an ore is found, not for every signpost
beside an earlier one of the same kind. Signposts fade after a while.

## The AI rivals

Lessons from Settlers 2's AI: a rival attacks an undefended target first, then the weakest
garrison, then the surest odds; Warden rivals hold the border in full and the interior thin;
every rival sets the toolsmith's priorities from the tools its buildings are waiting for, builds
a toolsmith, clears away flags that lead nowhere and sites no road reaches, and puts idle hands to
work on woodcutters and quarries. `npm run soak -- ai` measures growth and war on six seeds.

## Wardens

Lantern buildings are staffed by the strongest free warden (rank first, then skill, then
distance). Economy panel → Tools → **Rotate wardens** (Serf City's "cycle knights") lasts half
a day: lanterns near a border swap their weakest warden on watch for a stronger free one.

## Productivity

As in Settlers 2, a workshop, farm, mine or other workplace shows its **productivity**: the share of
the last game day its worker spent at work, not waiting for goods or for room on the flag. A road
shows how busy its carrier was; a road that stays above 80% calls extra carriers.

## Exploring the sea

You never steer a boat. The sea is charted three ways:
- **Fishing boats:** every time a fisher lands a catch, the water around that spot is explored.
- **Lighthouse:** a tall shore tower that sees 16 steps over land and sea. It holds no land and needs no warden.
- **Boatyard:** build it on the open coast. Its crew sails out by itself to the nearest sea it hasn't
  seen, charts it, comes back and rests, then goes again. Select the yard and choose **Near**
  (10 steps), **Far** (18) or **Very far** (30) to say how far it may go. Crews report islands,
  Star Wells and new land.

## Quays, ferries and harbours

A **quay** is a small store on the shore with its flag at the water's edge. Select a finished quay
and choose **Ferry to** another quay (or a quay being built) within 8 steps of open water: a boat
costs 3 planks from your stores, and a boatman rows goods and people over the water like a road's
carrier. A ferry works as a road for every purpose: builders, wardens and goods cross on it.
**Upgrade to a harbour** (4 planks, 3 stone) and its ferries reach 14 steps. Taking a quay down
ends its ferries. Boats show only on the water; nothing is drawn or painted on the sea floor.

**Footholds.** A quay may also be placed on free shore outside your borders, if a finished quay's
ferry can reach it. It costs the ferry's 3 planks up front, the ferry is made for you, and a builder
and the materials cross to raise it. Once standing, a quay claims free ground 3 tiles around it
(a harbour 4), with no warden: enough to build the first road, flags and woodcutters. Rival ground
is never taken this way.

## Stores

A Storehouse has a goods mode, as in Serf City (select it, then In, Stop or Out):

- **In** takes in goods from the roads (the default).
- **Stop** keeps what it holds but takes no more; goods on their way here go elsewhere.
- **Out** carries its goods, most urgent first (the Transport list), to your other stores on In.

A store that still holds goods can't be demolished: set it to Out and wait until it is empty.
The Hearthship always takes goods in.

Under **Settings by good** (any store) each good can be set apart, as in Settlers 2: **Stop**
(this store takes no more of it), **Send** (it carries that good out to other stores) or
**Collect** (it brings that good in from the other stores, and new ones are sent here first).
The Hearthship can only collect.

## Placing things

Placement follows Serf City's rules too:

- Demolishing a flag that only two roads pass through joins them into one road. A junction flag
  (three or more roads) can't be removed until you remove roads.
- Lantern buildings keep two tiles between them, whoever they belong to, so lanterns claim land
  outward instead of in heaps.
- Small buildings may stand side by side; a large building needs empty ground around it, and so
  does anything next to a large one.
- A large building may go up on a slope. A builder first digs the ground level (about 2 hours
  per step of slope) and no materials are sent until the ground is level.

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


Rules taken from Serf City (studied from Freeserf's source):

- **War morale.** Wardens fighting on an enemy's land fight at three-quarters strength if their
  settlement holds none of the world's gold, rising to full strength at half of it or more
  (counted in stores). Defenders on their own land don't need it.
- **A fallen lantern decides the land around it.** When a lantern is taken, the land within its
  light goes to whoever has the nearest lantern now, even where the old owner also had light.
- **Three garrison levels.** Frontier (enemy land a few steps from the light), near (a short way
  off) and inland, each with its own slider in the Economy panel (Tools).
- **Who goes first.** Choose whether the strongest or the weakest wardens go on an attack.

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
