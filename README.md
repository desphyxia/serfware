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

**Seas** (as generated, close, mixed) joins the lands: starting from the largest, each land is linked
to the nearest joined one, and where the water between is wider than the setting allows, shoal
islets are raised along it. *Close* leaves no stretch of open water wider than 6 tiles (a quay's
ferry reaches 8 steps); *mixed* allows 12 (a harbour reaches 14). Star Well islands count as lands.
Measured on seed russet-heron-417, widest crossing before and after (close / mixed): large 16 to 6 / 12
with 3 / 1 islets added; huge 26 to 6 / 12 with 7 / 3 added. The default leaves worlds exactly as
they were.

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

An AI seat is a *brain* (`src/sim/ai/brain.ts`): every `period` ticks it is given an `AiContext`
(the world, its player, `act(command)`) and gives orders with the same commands a human uses. The scripted
AI (`AiBuilder`) is the default; `WorldOptions.brain` swaps in another. With `world.recordAi` on, every order
a seat gives is kept in `world.aiLog` (for tournaments, learning and tests).

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

## Engineers, outriders and match rules

- **Palisade** (select one of your lit lanterns, Engineers; 4 planks, 2 logs): its defenders fight 30 %
  stronger, in the duels and in the odds preview. It is lost with the lantern.
- **Field camp** (2 planks, 2 logs): one attack from that lantern may come from 6 steps further than the
  usual reach; the camp is used up by the attack that needed it.
- **Bridge** (Materials, Bridge tool; 2 planks): a deck over shallow water inside your border, joined to
  your land or another bridge. Settlers, roads and marching armies cross it, rivals' armies too.
- **Outriders** (select an enemy flag, *Send an outrider*): a mounted warden (a warden with a mount) rides
  from a lantern in reach to a bare enemy flag that no lit lantern watches (more than 3 steps from every
  one), cuts it down and the roads that met there, and goes home. Flags at doors are not touched.
- **Prisoners**: a beaten attacker may be taken prisoner and exchanged through Diplomacy; that landed in
  batch 22.
- **Reach overlay**: with a lit lantern selected, red rings mark the enemy lanterns and Hearthships it
  could attack now. **Combat sounds** (clashing blades at a door, arrows in flight) play when the fighting
  is near the view, and are captioned if captions are on.
- **Match rules**: when hosting a game, choose the peace (none to 10 days), the stakes of a duel (wounded
  or mortal) and how it is won (last settlement standing, hold the Star Wells, or either). They travel
  with the start message, and are kept in saves and for rejoining players.
- Not done: the AI does not use palisades, camps or outriders yet; a bridge cannot be taken down.

## Photo mode, time-lapse, postcards and letters

**Photo mode (F2).** Frames the view and hides the interface. Blur (depth of field around the
camera's focus), a time-of-day slider (moves the light up to 12 hours from the world clock) and
seven filters (vivid, faded, noir, sepia, golden hour, frost). Everything here is only how the world
is drawn: the simulation and the clock are untouched, so it is safe in multiplayer. **Take photo**
saves a PNG; **Make postcard** puts the same picture on a paper card with the seed, your line (or the
day and season) and a stamp.

**Time-lapse** (Game menu, Saves tab). Plays the current solo game again from its first tick at
×8 to ×2048 from the command log alone, with a progress bar, restart, an optional slow camera turn and
the photo tools. When it reaches the end it compares its checksum with the game's, and says so if this
build plays the log differently. Nobody gives orders in it. Multiplayer games are made into a
time-lapse by saving them and loading the save first.

**Skyship letters (F4).** Write a note, with or without a small picture of your settlement, and the
game gives you a one-line code (or JSON) to hand to someone however you like. Pasting a code someone
sent you and pressing *Receive* adds it to your Letters, with a button to visit their world's seed.
There is no server: letters travel like saves do, and a received letter is cut to size and its
picture checked before it is kept.

## Scale, handhelds, accessibility and languages

**Scale.** `npm run soak -- scale` grows a huge world with eight AI settlements and records settlers and
the wall-clock cost of a tick. Measured (30 game days): the AIs reach about 930 settlers and 1,350
people and then stop growing (they run out of land), at 3.5 ms per tick by day 30 (ticks come ten a second);
that is about 3.7 µs per settler, so 12,000 settlers would cost roughly 45 ms a tick by extrapolation,
which has not been measured because no game here reaches it. The drawing side was the bigger cost:
`npm run scale-perf` times the settler view with 12,000 synthetic settlers on a tiny world. Before
this batch it took about 25 ms per frame of JavaScript; now settlers that are hidden, indoors, beyond
the 4,000-figure limit or far from the camera are not animated and not allocated for, and it takes
about 9 ms close up and 12 ms from orbit. (The simulation still runs everyone; there is no separate
road-graph-only mode, and nothing here ran on a GPU or a real handheld.)

**Handheld preset** (Settings, Graphics, *Handheld*): 30 fps limit, 70 % render resolution, no
shadows, bloom or occlusion, thin vegetation and particles, simple atmosphere, interface at 125 %.
It draws about as many triangles as Low (321k against 317k in `npm run perf`'s close-up); what it
saves are the post-processing and shadow passes and about half the pixels. Its 30 fps target is a
setting, not a measurement: it was not run on a handheld.

**Accessibility.**
- *Colours* (Settings, Interface): the *colour-blind safe* palette colours goods and players from eight
  colours chosen so that the two nearest are at least 28 ΔE (CIE76) apart for normal vision and for
  protan, deutan and tritan simulations (tests check this). Goods also carry a shape (circle, square,
  diamond) beside the colour, so seventeen goods never depend on colour alone.
- *Text size* scales text on top of the interface scale.
- *Controls* tab: every key can be rebound (Escape is reserved); the camera keys, tools, panels and
  the new photo and letter keys included. Arrow keys always move the camera.
- *Captions for sounds*: words at the foot of the screen for work sounds ("[hammering, left]"), rain,
  waves, wind and birdsong or crickets, shown even when the sound is off. The game has no voices.

**Languages.** Interface text is written in English and wrapped in `t("…")`; a language is a file in
`src/locales` mapping English text to its translation (`{name}` marks values that must stay). Swedish is
included for the 184 texts wrapped so far: Settings, the toolbar and build bar, photo mode, letters,
the time-lapse bar and captions. That is a part of the interface: the info panels, economy panel,
Almanac, diplomacy, campaign texts, building names and descriptions are still English. The Swedish
was written by the assistant, not a native speaker, and should be reviewed. `npm run strings` lists
the texts and each language's coverage (`-- --write` refreshes `src/locales/template.json`); a test
fails if a translation is missing, stale or loses a `{value}`.

## Release-candidate checks

- **Network faults** (`tests/netfault.test.ts`): three peers on a network that delays, reorders and repeats
  messages stay in sync; with 12 % of messages lost the game used to stop for good at the first lost
  turn packet (6 ticks in). A peer stuck on a turn for half a second now asks the others for it and they
  send what they hold. Lost *resume* messages after a pause are not covered.
- **Leaks** (`npm run swap-leak`, in `npm run check`; `npm run leak-soak` for a long run, also a manual
  job in the Soak workflow): starting a world used to leave 12 textures on the GPU, one set per world:
  the three tile-data textures were never disposed, and every water node kept two full-screen
  textures of its own. Now 3 are left per world (full-screen depth copies tied to three.js's own render
  objects; I could not free them from outside it). Old worlds, views and sessions are garbage-collected
  (checked with weak references). A 3-minute run with five world swaps: heap +3.8 MB a minute (r² 0.5),
  textures +4.3 a minute, geometries and objects flat.
- **Budgets** (`tests/budget.test.ts`, `npm run budget`, both in CI): a tiny world with three AIs costs
  0.34 ms a tick (limit 1.5 ms); a huge world builds in 2.3 s (limit 10 s); the busy close-up draws at
  most 450 meshes and 900k (medium) or 650k (handheld) triangles (it draws 200 to 330 meshes and
  350k to 720k triangles, varying run to run, so this catches only a large regression); the single-file build stays under
  2,200 KB (1,650 KB now).
- **Balance** (`npm run soak -- war`, `-- ai`): measured, not changed. In four-warden wars on six tiny
  seeds, 1 to 5 lanterns changed hands in 40 days, one to three settlements fell, and only two of six
  wars ended with a winner (day 5 and day 15); the other four stalled with two or three settlements
  standing. The AI soak shows the growth numbers quoted in the issues. Whether stalled wars are a
  problem is a design call, so it is filed rather than tuned.

## Keys

| Key | Action |
|-----|--------|
| Esc | Settings |
| F3 or ` | Debug dialog |
| F2 | Photo mode |
| F4 | Skyship letters |
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
