# Balance runs

Long all-AI games, played in parallel and summarised in a report. This is phase 1 of the balance plan: it
measures, it does not tune. Targets are agreed after the first report.

## Run it (Windows 11, WSL2)

Use the Linux side of WSL2, with the repo cloned inside it (`~/serfware`), not under `/mnt/c`: file access
there is much slower.

```sh
sudo apt install -y git curl           # once
# Node 22: for example with nvm (https://github.com/nvm-sh/nvm)
nvm install 22
git clone https://github.com/desphyxia/serfware.git && cd serfware
git checkout claude/project-thread-x5569w
npm ci

node scripts/balance-sweep.mjs economy --seeds 30   # growth curves: 3 temperaments x 3 levels x 2 sizes, 60 days
node scripts/balance-sweep.mjs war --seeds 30       # war pacing: three Wardens, 200 days
node scripts/balance-sweep.mjs ore --seeds 30       # the five ore mixes
node scripts/balance-report.mjs                     # writes balance-out/report.md
node scripts/balance-sweep.mjs players --seeds 6    # player counts per map size (not in the default run); then:
node scripts/balance-players.mjs                    # land use and resources per (size, players) cell: balance-out/players.md
```

- `node scripts/balance-sweep.mjs` with no suite runs all of them.
- `--workers N` sets the number of parallel games (default: cores minus one); `--days N` overrides the length.
- It is resumable: games already in `balance-out/<suite>.jsonl` are skipped. Stop with Ctrl-C and start again.
- WSL2 only sees half the host's RAM and all its cores by default; set `memory=` and `processors=` in
  `%UserProfile%\.wslconfig` if you want more. Each game uses a few hundred MB.
- Keep the machine awake (Windows power settings) for overnight runs.

## What it records

Per game: for every rival seat and every game day, buildings, people, Glow, the share of workplaces that did no
work the day before, and the stock of every good in the warehouses; at the end, buildings by type, captures,
settlements fallen, the winner and the day the game ended; and any rule violations from the daily invariant
check (`soak/invariants.ts`). The code is in `soak/balance/`; the matrix is in `scripts/balance-sweep.mjs`.

Each record also has a `flow` field (`soak/balance/probe.ts`; read by `scripts/balance-flows.mjs`, see below).
The probe only reads the economy and wraps a few of its methods, so a game plays out the same with or without
it (`BALANCE_PROBE=0` turns it off). It holds, per rival and game day, sparse `[good, count, ...]` pairs for
goods made, used as inputs, used up in building, eaten at meals, eaten by miners, used for upkeep, taken as
tools or arms, and lost on the road, with units made per building type; per day, the people, jobs, hunger,
births, deaths and warden counts; a row per building placed (placed, finished, lost); and, summed over blocks
of 10 days from four snapshots a day, why workplaces were idle (`working`, `no_worker`, `no_tool`,
`input:<good>`, `output_blocked`, ...), what building sites were waiting for (a missing material, or no builder
for want of a hammer, a free adult or a road), how long goods waited on flags, how loaded the roads were, and
the share of each day workplaces worked. Gatherers' searches for something to work on are counted, and an idle
gatherer is classed `no_target` or `no_path` when its last search found nothing or no route. Tools are counted as
the pool a seat owns (start, made, end) and as job starts, not as use-up, because a tool returns to the keep.
Quarries get a row each (`quarries`): the rock in reach (`Feature.Rock` with material left, within the quarry's
radius) and in the seat's territory when it was placed, when it first had none in reach, and when it went; and
`rockDay` has, per seat and day, the rock tiles and material left inside the territory. Together they tell a quarry
that was put where there was no rock from one that used its rock up.
The border has its own columns in the per-day rows: `territory` (land tiles inside the border), `frontier` (own tiles
`frontierTiles` offers a lantern), and running counts of what the AI did (`ai*`: thoughts, thoughts stopped at the
sites cap or with no idle hands, thoughts that wanted the border pushed out, `expand` calls, calls with no frontier
tile, lanterns placed, beacons and lamp houses chosen, calls that placed nothing, woodcutters built for the border).
`borderWhy` has, per day and seat, a running tally from `src/sim/ai/borderwhy.ts`: for one failed border try in eight,
what stood in the way of each frontier tile (`stand:` the tile itself, `flag:` its flag, `reach:` the distance to the
nearest flag, `road:` why no road could be laid, including the obstacle that alone would open a way). The counters and
the diagnostic only read; a game plays out the same with them.
Land and resources (`landDay`, `resDay`, `mapDay`, `landTiles`; fields in `landFields` and `resourceFields`; index 0 is the
start, index d + 1 the end of day d; `landDay` and `resDay` have one row more than there are rivals, the last being
player 0, the steward seat): each rival's land tiles by what is on them (buildings, roads, flags, ground kept clear
beside large buildings, fields, trees, rock, other growth, steep ground, open ground), and the rock units, trees (and
those fit to fell), ore loads of each kind and fish stock lying on the whole map and inside each border. What was taken
out is what the gathering buildings made (`producedBy`), and what became of it is in the per-good flows.
Wars add a log of attacks, duels, captures and falls.

A "day" in the per-day arrays is a 24-hour window starting where sampling began: the world is already
`startTick` ticks old (4770 of 7500 on the maps tried), and its daily work (meals, upkeep, closing the books)
runs at multiples of `dayTicks`, so each window holds exactly one meal but it falls part way in, not at the end.
End-of-window readings (people, food stock) are therefore between two meals; hunger is read at the meal itself
(`foodBefore`, `mealNeed`). Building times and the war log use absolute game time (tick / dayTicks).

Rule violations are kept whole: `broken` has the first 10, `brokenTotal` and `brokenKinds` count every (day,
message) pair. Records made before this change keep only the first 10 per game.

```sh
node scripts/balance-flows.mjs                 # writes balance-out/flows.md
node scripts/balance-flows.mjs --by temper     # the same, one block per value of a tag (economy: temper, level, size; war: level, size; ore: mix)
```

`flows.md` has, per suite (and per tag value with `--by`): units made per seat per day by block of ten days, and
which goods are never made; where each good goes (inputs, building, meals, rations, upkeep, arms, lost, left
over) and the tool pool (owned at the start and end, made, taken for jobs); the producing buildings; why
workplaces stood idle, which inputs they waited for, and how often gatherers found nothing to work on; when
buildings are placed, how long they take and what sites wait for; goods waiting on flags and road load; people
and food (with the meal's shortfall read at the meal); and, for wars, the event counts and the strength of the
seats. Rates count only seats still standing.

## Trying an AI change

Phase 1 plays the AI as it is. To measure a change to it without touching the baseline, a change is an option in
`aiOptions` (`src/sim/ai/builder.ts`), off by default, and the sweep turns it on from the environment, with the
output going to its own folder (a record lists the options that were on in `ai`):

```sh
BALANCE_AI=quarry       node scripts/balance-sweep.mjs economy --seeds 2 --days 60 --out balance-pilot3   # dead quarries pulled down and replaced
BALANCE_AI=quarry,stone node scripts/balance-sweep.mjs economy --seeds 2 --days 60 --out balance-pilot4   # and granite and the border toward rock when the rock runs low
node scripts/balance-report.mjs --out balance-pilot3
node scripts/balance-flows.mjs --out balance-pilot3
```

- `quarry`: a quarry with no rock left in reach, seen three times in a row, is pulled down and no longer counts against
  the quarry quota, so the usual quarry wishes place a new one; they look 22 tiles from the centre, not 14.
- `stone`: while the rock inside the border holds under 15 units, `relieveStone` starts on granite (one mine, up to 6
  geologist trips) without waiting for the stores to run bare, and every other new lantern goes toward rock outside the
  border.
- `food`: while the food in the warehouses runs under a day's need (0.45 a head, averaged over about a third of a day),
  one more food building at a time is added past the fixed opening quotas, each type capped by the population.
- `priority`: no new houses while there is room for everyone (six spare berths), and, with stone under 6, none of the
  wants that spend it on comforts and side projects (wells, flowerbeds, benches, sea, works, biome, terra, weaponsmith).
- `reach`: border lanterns are only tried on tiles the Hearthship's land reaches by land or bridge, with at least 6
  free tiles of that land within 5. Changes nothing on the maps tried (see the results).
- `clear`: when a border try placed nothing and a tree is what stands in the way (on the tile, on every spot for its flag,
  or across the road to it), build a woodcutter within reach of that tree; at most 3, a day apart.
- `tools`: the toolsmith's iron goes only to tools somebody is waiting for (more wanted than owned), plus one spare each of
  hammer, axe, pick, scythe and rod; no spare saws, shovels, cleavers, crooks or tongs.
- `ore`: geologists go without a toolsmith (two hammers in the stores are enough) and keep going while a wanted kind (coal,
  iron, gold with a smelter, granite when stone is short) has no usable sign, from the flags with the most unsampled hills;
  signs are remembered after the signpost is gone; a mine may stand on any free mountain tile within 2 steps of a remembered
  sign (a mine digs within 2), not only on the sign tile; the mine step runs before hedges and causeways; an exhausted mine
  is pulled down; one coal and one iron mine per 50 buildings, not one for ever.
- `release`: a seat stopped at the builder's sites cap (`sites` in `AI_LEVELS`: 2, 3 or 4 unfinished sites) pulls down the
  site that has had no material delivered or used for 4 days (what was delivered is lost) and does not place that kind
  again for 3 days, so the builder reaches the land-use step (geologists, mines, smelter) again.
- `smith`: the builder wants its toolsmith once a sawmill stands and 8 buildings are placed, with a quarry standing or, if
  not, 4 stone in the stores. Before, a standing quarry was required, so a seat whose rock had run out (its quarry pulled
  down) never built one. Smoke test (tiny and small, 3 seeds, 3 rivals, 60 days): 16 of 18 seats had a toolsmith by day 60
  against 10 of 18, the median first toolsmith on day 5 against day 10.
- `forge`: the smelter, goldsmith, bowyer and stable are placed within 9 steps of the Hearthship as before and, when that
  ring has no room, within 9 steps of up to 3 lit lanterns (a different few on each try).
- `survey` (needs `ore`): after 3 failed tries in a row to place a mine of a kind on its remembered signs, those signs are
  forgotten (except any within reach of a mine that still works), so the geologists see the kind as lacking and survey
  again; not again for 120 thoughts (about 2 days).
- `granite` (needs `ore`): granite mines are wanted whether or not the stores are short of stone, one plus one for every 30
  buildings and at most three, and the geologists look for a granite sign while that quota has none. Before, one granite mine
  was wanted only while the stores held under 8 stone, and relieveStone placed one or two when stone ran short.
- `armed`: plays the armed-wardens rule (`armedWardens`, a match option; see the results below), not an `aiOptions` switch.
- `nolattice`: plays the tile-centre roads. Since #181 a sweep plays the Serf City road lattice unless this is given, as the game
  does unless it is opened with `?lattice=0` (`latticeRoads`, a match option, not an `aiOptions` switch): flags and buildings sit
  on tile corners as well as tile centres. Before #181 the tile-centre roads were the default and `lattice` asked for the lattice,
  so in the results below a run named `lattice` (or with `lattice` in its tokens) is the lattice and one without it is the
  tile-centre roads; `lattice` no longer does anything. See "Result: the road lattice" below.
- `turn`: a building takes the best of its flag sides, as a player turns it with the mouse wheel, not the flattest one: every
  side is planned (the new road to the network, the distance to the buildings it trades with, the height step) and the
  cheapest is taken (`BALANCE_TURN_WEIGHT` sets the weight on the distance, default 2). Issue #148.
- `wide`: when the 9 steps round the keep (or the lantern a building is tried round) hold no spot, the search goes on round up
  to three lit lanterns and then over the seat's own land out to 16 steps from the keep. Issue #147.
- `cand`: the border lanterns are tried on the frontier tiles where a lantern fits, not on the first 40 of the list. Issue #150.
- `wood`: while planks and logs are both under 4 in the stores, one more woodcutter (a forester for every three) at a time, 30
  thoughts apart, up to `2 + finished buildings / 12`; the order may go past the sites cap. Issue #150.
- `rail`: from 15 finished buildings the voyage planner keeps a site for the launch rail and the AI's placements keep off it
  until the rail is placed there (`reserveRail`). Issue #147.
- `block` (or `BALANCE_BLOCK_WEIGHT=<w>`; needs `turn`): a flag side costs `w` (1 for `block`) for each free tile beside its
  flag that it would take out of use (`turnBlockWeight`). Issue #148.
- `norings`: plays without the rule that lets a carrier put a good on a full flag when the full flags make a ring, one good over
  the capacity at most (`transportOptions.breakRings`, a transport rule, not an AI switch; the soak invariant then allows 9
  goods on a flag). The rule is **on by default since #169**; until then the switch was `rings`, which no longer does anything.
  Issue #149.
- `keeproads`: from 8 buildings, a seat whose keep flag has fewer than 3 roads gets one more, every 4 thoughts, to the nearest
  flag of its own the keep flag does not join yet (path up to 12 nodes on the lattice, 6 off it; `keepRoads`,
  planner.ts `connectKeepFlag`). Issue #169.
- `nobows`: plays without the rule that gives the bowyer no planks while the stores hold a bow for every warden in the seat's
  lantern buildings who lacks one, and 4 more (`bowsByNeed`, ai/economy.ts `settings`). The rule is **on by default since
  #175**; until then the switch was `bows`, which no longer does anything. Issue #175.
- `nocoldstart`: plays without the rule that keeps start sites out of land that grows fields less than 35% of the year
  (`startOptions.avoidCold`, economy.ts `setupStart`, not an AI switch). On by default since #179.
- `nowarmfarms`: plays without the rule that puts farms and orchards where the land within 3 steps has the longest growing
  season (`warmFarms`, planner.ts `placeConnected`). On by default since #179.

Pilots so far (2 seeds, 36 economy games of 60 days each; the differences between the later rows are within the noise):

| Pilot | `BALANCE_AI` | Buildings d60 | People d60 | Hungry, days 30+ (pooled) | Deaths per seat-day | Quarries working |
|---|---|---|---|---|---|---|
| 2 | (none) | 40 | 103 | 61% | 0.83 | 1% |
| 3 | quarry | 47 | 108 | | | 37% |
| 5 | quarry,stone,food | 53 | 121 | | | |
| 6 | quarry,stone,food,priority | 55 | 120 | 32% | 0.70 | 74% |
| 7 | + reach | 55 | 125 | 34% | 0.74 | 75% |
| 8 | + reach,clear | 56 | 126 | 29% | 0.69 | 65% |

What stops growth: food quotas cap it in days 0-20, then stone starves further building (house and food sites wait on
stone 81-87% of the time from day 20), and then the border stops: territory is frozen after day 10 in nearly every seat.
The cause is not the AI's placement: each map holds four settlements (the three rivals and player 0, the steward seat,
which the harness does not measure), about 270 land tiles each on a tiny map and 390 on a small one, and the land the
Hearthship's land reaches is claimed within 10-30 days (seen on bal-001 and bal-003 at both sizes; `freeland.ts`). A seat's frontier tiles are mostly on land its own landmass
does not reach (an island, or across water) or have no road to them; trees block few of them. Lantern posts, lamp
houses and beacons all widen the border (light 5, 7 and 10 tiles; 1, 2 and 5 stone) once a warden lights them.

## Player counts

The `players` suite plays the same economy with fewer or more players on a map, to tell the size of the map from the land
each player gets. `players` counts everyone: player 0 (the steward seat, which is not measured) and the AI rivals, all of
one temperament, so 2 players is one rival. The cells are tiny with 2 and 3 players, small with 3 and 4, and medium with 3
to 6, each with the three temperaments and `--seeds` seeds; medium games run 90 days, the others 60.

```sh
BALANCE_AI=quarry,stone,food,priority node scripts/balance-sweep.mjs players --seeds 6 --workers 15 --out balance-players
node scripts/balance-players.mjs --out balance-players      # writes balance-players/players.md
```

`balance-players.mjs` has, per cell: land per player; growth per AI seat (buildings, people, the day buildings reach 90% of
their final count, hunger); the land at the end (claimed by all players, free, each seat's territory over time and by
use); and, for stone (from rock and from granite), logs, coal, iron ore, gold ore and fish, what lay on the map, what lay
inside the AI seats' borders at the end, what they took out, and the share of that used, lost or left in stock.

`balance-flows.mjs` assumes the same number of rivals in every game, so run it once per cell: split `players.jsonl` by
`spec.size` and the number of personalities into one directory each, and point `--out` at it. (`balance-report.mjs`
runs on the whole file; its header says "3 seats per game", which is wrong for these cells.)

### Result: the first run (2026-10-07)

144 games (8 cells × 3 temperaments × 6 seeds), pilot-6 AI (`quarry,stone,food,priority`), 8 h 9 min on 15 workers,
7137 CPU-minutes. Player 0 is the steward and is not measured; per-seat figures are medians over AI seats.

| Cell | Land per player | Buildings (end) | Territory | Free land on the map | Open ground in a border |
|---|---|---|---|---|---|
| tiny, 2 players | 567 | 59 | 585 | 16% | 22% |
| tiny, 3 players | 378 | 46 | 297 | 10% | 20% |
| small, 3 players | 577 | 67 | 466 | 5% | 18% |
| small, 4 players | 433 | 55 | 369 | 5% | 19% |
| medium, 3 players | 1453 | 105 | 1209 | 19% | 41% |
| medium, 4 players | 1090 | 97 | 770 | 23% | 29% |
| medium, 5 players | 872 | 91 | 825 | 5% | 29% |
| medium, 6 players | 726 | 83 | 654 | 7% | 25% |

- Every seat stops growing early: buildings reach 90% of their final count by day 7 to 11 (tiny, small) and day 16 to 24
  (medium), and territory is fixed after about day 10. On medium with 3 and 4 players this happens with 29 to 41% of the
  border still open ground and 19 to 23% of the map unclaimed, so land per seat is not what stops them there.
- Rock is the scarce resource: the AI takes 43% (tiny, 2 players) to 75% (medium, 6 players) of all the rock on the map,
  and 81 to 95% of the rock inside its borders. Granite is plentiful and almost untouched (1 to 7% taken). Coal, iron
  ore and gold ore are 0 to 6% taken; gold mines are built by 9% of the seats.
- Hunger (the stores held less food than the 0.45 a head the people need at the daily meal), pooled over seat-days from
  day 30 on: tiny 14% (2 players) and 31% (3), small 49% (3) and 44% (4), medium 39%, 40%, 28% and 26% (3 to 6 players).
  The per-seat median shown in an earlier version of the report hid this (it read 0 to 5% for several cells); the report
  now pools. A 20-day block with food made per day below what the people need is hungry on 50 to 62% of its seat-days on
  medium, against 2 to 6% for a block above it, so hunger follows the food made, which is flat after about day 10.

### Result: mining and hunger (same run, flow reports per cell)

- Mines: every AI seat has coal and iron ore inside its border (700 to 4,600 loads under the land at day 5, and a median of
  about 2,000 to 2,700 still there at the end), yet 54% of seats build a coal mine, 47% an iron mine, 9% a gold mine. A seat
  that mines digs a median of about 170 to 200 loads. Exactly one mine of each kind is ever placed: `ai/economy.ts` tests
  `count("coalmine") < 1`, which counts an exhausted mine, so nothing replaces it. There is no cap in the engine.
  From day 30 on, 85 to 97% of mine snapshots are `exhausted` and 3 to 9% are waiting for food; miners eat 1 food per 2 loads
  of coal or iron and use about 3% of what a seat eats, so food cost is not what stops mining.
- Why a seat has no mine (`soak/balance/mining.ts`, 3 seeds × 3 seats, medium, 60 days): no toolsmith yet (4 of 9 seats at
  day 10; geologists wait for one), then no geologist sign although ore lies under the land (some seats at day 60), then
  exhaustion within 10 to 20 days, and in two seats a mine that every gate allowed was still not placed for 10 days or more.
  Picks piled up in three seats (10 to 17 in stock).
- Iron has no use in the cost of any common building (only tools, blades and six late works buildings). The toolsmith waits
  for iron on 98 to 100% of its snapshots; farms, woodcutters and fishers have no tool in any warehouse for 20 to 38% of
  their snapshots from day 10 on, and farms also find nothing to sow on about 43% of them.
- Hunger follows food made per day, which is flat after about day 10 while the people are housed up to the room: a
  20-day block with food made under the need is hungry on 50 to 62% of seat-days on medium, a block above it on 2 to 6%.
  Hunger only stops births and slows work (`hungry` in `dailyLife`); no one starves.

### Result: `tools` and `ore` (pilots 9 and 10, on top of pilot 6, 2 seeds, 36 economy games of 60 days)

Mean over all rivals, from `economy.jsonl` (not the same aggregation as the table above):

| Pilot | `BALANCE_AI` | Buildings d10 / d20 / d40 / end | People end | Woodcutter / farm / fisher with no tool | Coal / iron ore / iron made per seat | Seats with a smelter at the end |
|---|---|---|---|---|---|---|
| 6 | quarry,stone,food,priority | 42.4 / 48.2 / 51.0 / 51.7 | 116.9 | 37% / 28% / 18% | 25 / 13 / 2.4 | 3% |
| 9 | + tools | 42.3 / 48.4 / 50.8 / 51.5 | 116.6 | 37% / 25% / 18% | 32 / 15 / 3.6 | 6% |
| 10 | + tools,ore | 42.3 / 48.5 / 50.1 / 51.2 | 114.5 | 32% / 25% / 17% | 107 / 49 / 28 | 19% |
| 11 | quarry,stone,food,priority,release | 42.4 / 48.2 / 51.1 / 52.2 | 116.1 | 36% / 27% / 18% | 32 / 11 / 2.4 | 4% |
| 12 | + tools,ore,release | 42.3 / 49.2 / 51.3 / 52.5 | 116.4 | 31% / 26% / 17% | 106 / 49 / 33 | 20% |
| 13 | quarry,stone,food,priority,smith | 42.4 / 48.9 / 51.6 / 52.3 | 116.0 | 37% / 15% / 14% | 22 / 7.3 / 1.6 | 2% |
| 14 | + tools,ore,release,smith | 42.5 / 49.4 / 51.9 / 53.1 | 116.3 | 27% / 9% / 12% | 110 / 53 / 32 | 15% |
| 15 | + forge | 42.5 / 49.3 / 51.9 / 53.3 | 116.8 | 26% / 8% / 10% | 109 / 64 / 34 | 18% |
| 16 | + survey | 42.8 / 48.7 / 50.9 / 52.2 | 114.4 | 29% / 8% / 11% (pilot 15: 28% / 9% / 11% by the same count) | 101 / 52 / 30 | 18% |

- `tools` alone changes little: the spare saws, cleavers and crooks are no longer made (0.24, 0.22, 0.16 per seat in pilot 6
  against 0.02, 0 and 0), scythes are made a little more, and the toolsmith still waits for iron on 90% of its snapshots.
- `ore` makes about four times the coal and ore and about twelve times the iron, and exhausted mines are 24 to 35% of mine snapshots
  against 71 to 81%. The toolsmith waits on its input 76% of its snapshots against 100%. Tool shortages ease a little
  (woodcutters 37 to 32%) and building and population do not move: nothing common costs iron, so more iron has no
  consumer (the toolsmith made 2.5 tools a seat in pilot 10 and 2.8 in pilot 6). Why the toolsmith still waits on
  its input with 28 iron made a seat has not been looked at.
- Hunger was not measured for pilots 9 and 10.
- Frozen seats: in the `players` run, 118 of 396 AI seats (30%) spend at least half their thoughts from day 30 on stopped at
  the builder's sites cap (`sites` in `AI_LEVELS`: 2, 3 or 4 unfinished sites; the builder places nothing new, and never
  reaches the economy step that places mines and sends geologists). In the one seat traced (bal-001 seat 1) the sites that
  held the cap were three flowerbeds, each waiting for one log. The unfinished sites left in frozen seats at the end are
  mostly houses, flowerbeds, quarries, foresters, orchards and granite mines, at a median age of 51 days.
- `release` (pilots 11 and 12): seats that spend at least half their thoughts from day 30 on at the sites cap fall from
  11 to 15% of the 108 seats (pilots 8, 9 and 10; pilot 6 predates the counter) to 4% (pilot 11) and 3% (pilot 12).
  Buildings and people do not move beyond the noise (52.2 and 52.5 against 51.7 buildings at the end, 116.1 and 116.4
  against 116.9 people), and mines are as in pilots 6 and 10. The 30% of the `players` run is higher because it includes
  medium maps and up to six rivals. How many sites `release` pulled down was not counted. Unfreezing the builder does not
  lift growth on tiny and small maps; what stalled the sites (logs, stone, planks) probably does, but that was not tested.
- `smith` (pilots 13 and 14): seats with a toolsmith at the end rise from 46% to 87% (83% with all four switches). Farms
  with no tool fall from 28% to 15% of their snapshots (9% in pilot 14) and fishers from 18% to 14% (12%); woodcutters stay
  at 37% alone and fall to 27% with the other switches. Buildings at the end are 52.3 (pilot 13) and 53.1 (pilot 14) against
  51.7, people 116.0 and 116.3 against 116.9: the tool shortage eases and growth does not follow. The toolsmith still waits
  on iron on 81% of its snapshots in pilot 14 (smelters stand in 15% of seats). Frozen seats are 14% with `smith` alone
  (no `release`) and 6% with all four.
- `forge` (pilot 15, on top of pilot 14): the smelter, goldsmith, bowyer and stable are looked for within 9 steps of the
  Hearthship (the default centre of `placeConnected`; the land-use step of #101 passes `maxDist: 9` and nothing in the code
  or the commit says why), and with `forge`, when that ring is full, within 9 steps of up to 3 lit lanterns. Of the 24 seats
  (of 108) that ever built both a coal and an iron mine, 16 built a smelter in pilot 14 and 19 in pilot 15. Smelters stand in
  18% of seats at the end (15%), iron made is 34 per seat (32), the toolsmith still waits on iron on 82% of its snapshots,
  buildings and people are as in pilot 14 (53.3 and 116.8). The counts of seats with mines (24 of 108 with both, 37 coal,
  27 iron) came from sweep snapshots and miss mines pulled down when exhausted, so they are too low; do not read them as a
  limit. The planner's own record gives the figures in the next bullet.
- Why seats have no iron mine (`mining.ts` and `minewhy.ts` with `tools,ore,release,smith,forge`, 12 games, 36 seats, 60
  days, from the planner's `hadMine`): 20 built an iron mine, 23 a coal mine, 17 a smelter. Of the 16 without an iron mine, 8
  never remembered an iron sign (7 of them have 8 or fewer iron tiles inside the border) and 8 remembered signs but none of
  the tiles near them (23 to 28 in the largest cases) could take a mine: no flag spot, a field, tree or hedge on the tile,
  or no road path. Steepness is the smaller part: in three traced seats 0 to 2 of the 6 to 28 tiles tried were over the mine
  slope limit (3.2), while a flag needs a neighbour under slope 2.2 and the neighbours were also blocked by trees, fields,
  buildings and other flags. Those 8
  stay stuck: the remembered signs count as found, so no geologist goes out again, and the mine step retries the same tiles
  every ~10 thoughts for the rest of the game. Seen in small bal-001 seat 1 (49 iron tiles under its land) and tiny bal-002
  seat 1.
- `survey` (pilot 16, on top of pilot 15): no gain. Same 12 games and 36 seats as above with the switch on: 20 built an iron
  mine (20 without it), 5 are stuck on remembered signs (8), 11 never remembered an iron sign (8). The stuck case that
  motivated it, small bal-001 seat 1, now builds one; a seat that built one before (small bal-006 seat 1, tiny bal-004 seat
  3) now has none; the likely reason, not checked, is that a try can fail for passing reasons (a road blocked by a site) and
  the switch then forgets signs a mine could have used. Seats trade places and the total does not move. Pilot 16 over 36 games: buildings
  42.8 / 48.7 / 50.9 / 52.2 against 42.5 / 49.3 / 51.9 / 53.3, people 114.4 against 116.8, smelter seats 18% (18%), iron
  made 30 per seat (34), frozen seats 4.6% (5.6%), toolsmith at the end 84% (83%): within the noise or a little lower. Not
  tested: whether the geologists find new signs after the forgetting (only the outcome was counted), other thresholds than 3
  tries and 120 thoughts, and the `players` suite.
- `granite` (pilots 17 and 18): more stone, no measurable growth. Pilot 17 is the pilot 15 stack plus `granite`; pilot 18 is the
  pilot 15 stack alone, both run on `master` after #137 (the stranded-goods fix), which pilot 15 predates. Same aggregation
  for all three (means over all rival seats; day n is the n-th daily sample, so d10 here is not the d10 of the table above):

  | Pilot | Buildings d10 / d20 / d40 / end | People end | Stone from granite mines / quarries per seat | Stone made per seat-day, days 0-9 / 10-19 / 20-29 |
  |---|---|---|---|---|
  | 15 (stack, before #137) | 43.8 / 49.9 / 51.9 / 53.3 | 116.8 | 54.7 / 65.1 | 8.5 / 1.96 / 0.56 |
  | 18 (stack, after #137) | 44.8 / 51.8 / 54.4 / 55.4 | 122.7 | 60.8 / 66.4 | 8.7 / 2.65 / 0.89 |
  | 17 (stack + `granite`, after #137) | 45.0 / 52.0 / 54.8 / 55.9 | 122.9 | 73.6 / 66.1 | 9.8 / 2.5 / 0.85 |

  Pilot 17 against 15 looks like a gain (+2.6 buildings, +6.1 people) but pilot 18, without `granite`, has nearly all of it
  (+2.1, +5.9): it comes from what changed in `master` between the pilots (#137 most likely; #140, #134 and #135 also landed,
  and which of them counts was not isolated). `granite` itself adds 13 stone a seat over 60 days (+10% of the stone made, 127
  to 140) and 0.5 buildings, 0.2 people: within the noise, not tested for it. Stone made per seat-day still falls to about
  0.1 to 0.5 from day 30 on, and granite mines standing at the end are 0.15 to 0.16 a seat in all three (exhausted mines are
  pulled down, so this does not count what was built). Not measured: the share of sites waiting for stone, hunger.
- Why so few granite mines at the end (`mining.ts` with `tools,ore,release,smith,forge,granite`, 12 games, 36 seats, 60 days, from
  the planner's `hadMine`): 18 seats built a granite mine, 5 remembered a sign but built none, 13 never remembered one; the
  low count at the end is exhausted mines being pulled down, not mines never built. The 18 seats with a mine have 33 granite
  tiles (654 loads) under their land on day 5, 26 tiles (493 loads) on day 60, so their mines dug about 160 loads and left three
  quarters in the ground, and they hold 184 stone in the warehouses on day 60. The other 18 seats have 12 tiles (236 loads)
  and dig nothing (3 loads), and hold 20 stone. Of those 18, 9 saw no granite sign at any check day and 4 saw only signs the AI
  ignores (small deposits); 7 of the 13 with no remembered sign have 5 or fewer granite tiles. So more granite mines would not
  help the seats that already have one (stone is not short there on day 60), and the seats that are short of stone mostly have
  little granite inside the border. Means of 18 and 18 seats from one probe; not compared with the switch off, not checked
  why the first mine's reach leaves most of the granite, and day-60 stone in the warehouses is one snapshot.
- Would pushing the border toward mountain ground find granite (`soak/balance/borderrock.ts`, same 12 games and switches, days
  5, 10, 20, 40 and 60; 36 seats, 16 with 15 or fewer granite tiles inside the border on day 5 and 20 with more): no, because
  there is no free ground to push into. Territory is the same on day 5 as on day 60 (poor seats 200.6 and 202.2 tiles, rich
  seats 410.9 and 411.4; no seat's grew after day 10), and the free granite on the Hearthship's land within 20 land steps of
  the border is 0.1 tiles a poor seat and 0.2 a rich one (31 of the 36 seats have none within 20 steps). Free mountain ground
  within 20 steps is 0.6 to 0.7 tiles. In 4 of the games (12 seats, days 5 and 10, the same on both days) the free land of any
  kind within 20 steps of the border was 0 for 5 seats and 23 tiles or fewer for the other 7. The map is already divided between the seats on
  day 5, so where a border grows is not what leaves a seat short of granite: how much granite lies inside the start territory
  is. Granite inside the border falls a little (poor 7.1 to 6.4 tiles, rich 34.7 to 28.9) as mines dig it. Not measured:
  before day 5, or how large the start territory is on each map size.
- Why the toolsmith waits (`soak/balance/toolsmith.ts`, 6 games, 1,080 seat-days with `tools,ore`): no toolsmith stood on
  54% of seat-days and only 9 of 18 seats ever got one (the builder wants one only while a quarry stands, and quarries are
  pulled down when the rock runs out: 14 of 18 seats had none at day 60). Where one stands it waits for iron on 48% of its
  seat-days, in 99% of them in a seat with no smelter; in one traced seat no tile within 9 steps of the keep (the smelter
  is placed there, `placeConnected`) could take a smelter: 157 taken, 79 without a flag spot, 16 that could not be built on (the probe did not split slope from the other causes), 2 without a road.
  Where iron is made, the toolsmith holds a full set of inputs and idles by the `tools` priorities.
- The design question behind these numbers (ore and ingots in building costs) is issue #131.

## Targets (agreed 2026-10-08)

Set after the first report. All are measured on the 36-game tiny and small economy suite (3 temperaments × 3 levels × 2
seeds, 60 days, mean over all AI rivals); medium maps get their own check later. The figures in the middle column are the
baselines they replace.

| Area | Baseline | Target |
|---|---|---|
| Growth | Buildings grow about 7% from day 20 to day 60 (48.2 to 51.7, pilot 6); they reach 90% of their final count by day 7 to 11 | Still growing at day 40: at least 25% more buildings from day 20 to day 60 |
| Hunger | 14 to 49% of seat-days from day 30 have less food than the meal needs (per `players` cell; pooled) | 10% or less |
| Frozen seats | 11 to 15% (3% with `release`) | 3% or less |
| Tools | Woodcutter / farm / fisher without a tool on 37% / 28% / 18% of snapshots (pilot 6; 26% / 8% / 10% with the full stack) | 10% or less each |
| Granite | Granite mines make 29% (pilot 6) to 46% (pilot 15) of the stone made per seat over 60 days; the 1 to 7% in the `players` run is the share of the granite on the map that is taken | Granite is 30% or more of the stone the AI uses (met by pilot 15; the stone is the limit, see the `granite` result) |
| Metal chain (smelter, iron mine) | Smelter in 3% of seats at the end (18% with the full stack); an iron mine in 20 of 36 seats | No target until #131 decides where iron is used |
| War: winners | 5 of 30 games end with a winner within 200 days (17%) | 80% or more of games |
| War: timing | Every win is by day 9 to 60 | Winners decided between day 40 and day 150 |
| War: activity | Wardens out attacking fall to about 0 from day 60; seats standing are flat at 68% from day 80 | Steady attacks to the end of the game |
| War: weapons | Blades made by 6% of seats, bows by 12% | No target until #131 decides where iron is used |

The granite share is read from units made per building type (granite mine against quarry) in the flow records. Met so far:
frozen seats (3% in pilot 12) and, in pilot 15, tools for farms (8%) and fishers (10%) but not woodcutters (26%). Growth is
far from its target (pilot 15 grows about 8% from day 20 to day 60); hunger was not measured for pilots 9 to 15. The granite
share is in the `granite` bullets above (pilot 17: 73.6 stone per seat from granite mines against 66.1 from quarries).

### Result: war baseline (2026-10-09)

`BALANCE_AI=quarry,stone,food,priority node scripts/balance-sweep.mjs war --seeds 5 --workers 12 --out balance-war1`: 30 games
(3 levels × tiny and small × 5 seeds), three Wardens, up to 200 days, 114 minutes, 90 rival seats. The first war run
(2026-10-04, 30 games) predates the flow probe and the AI switches and is not comparable seat for seat.

- Games that end with a winner: 5 of 30 (days 9, 14, 22, 29 and 60); the other 25 run to the day limit. The first run had 6 of 30.
- Fighting is early and then stops: the first attack on a rival is on a median day 5.7 (77% of games have one, 19 attacks and
  10 captures per game, 1.1 falls of a rival per game). Seats still standing fall from 89% (days 0-9) to 68% by day 80 and
  stay there; wardens out attacking are 0.12 per seat at most (days 10-19) and about 0 from day 60. Wardens per seat stay at
  14 to 15, morale falls from 1 to 0.92.
- No weapons: blades are made by 6% of seats (0.15 a seat-day at best, nothing after day 30), iron by 12% (3.9 a seat over
  the whole game), iron ore by 13%, bows by 12%. What is given out as arms per seat over a game: bows 6.2, logs 4.0, planks 4.4,
  stone 7.8, mounts 0.4.
- The economy is as in the other suites: stone made falls from 10.2 a seat-day (days 0-9) to 0.6 or less from day 20 on; fish from
  25.5 to about 1; of the 1,117 planks made per seat, 668 are neither used nor lost (left over), and blades, mounts and peat are
  missing from the warehouses in 92 to 100% of snapshots (iron ore on easy).
- Rule violations: 4 games, 601 (day, message) pairs: "flag # is not on its tile" 600 (3 games, first seen in
  `war|easy|tiny|bal-004`, day 1), "flag # holds # goods" once. The same message appeared in the first war run, so it predates
  the AI switches. Traced with `soak/balance/flagwhy.ts` in `war|easy|tiny|bal-004`: the flag is flag 0, the steward seat's
  (player 0), with tile -1 from the start of the game. Its keep stands on tile 551, whose six neighbours are all lake tiles (it has the most land of the four players: 218 own land tiles, 113 flat within 7 steps), so
  `bestFlagTile` returned -1 and `settleAt` (`economy.ts`, `createFlag(flagTile, ...)`) made the flag anyway. `setupStart` picks
  the keep tile without checking that a flag can stand beside it (`landingProblem` checks that no tile within 2 is water, but
  `setupStart` does not call it). The other 2 games with this message were not traced.
- War targets are in the table under "Targets" (set 2026-10-09): 80% or more of games with a winner, decided between day 40 and
  day 150, with steady attacks to the end. None is met: 17% of games have a winner, all by day 60, and wardens stop attacking.
  "Steady attacks" has no number yet; a reading to agree: some attack in at least 80% of the 10-day blocks while two or more
  seats stand. The war suite is the 30-game one above (tiny and small, three Wardens, 200 days).

### Result: what holds building sites up, and what limits growth (tiny and small maps)

From the flow records of pilots 6, 14 and 15 (`node scripts/balance-sites.mjs balance-pilot15 [--size tiny|small]`) and a probe,
`soak/balance/sites.ts`, run on six games (tiny and small, seeds bal-001 to bal-003, normal level, a builder, a trader and a
warden, 60 days, `tools,ore,release,smith,forge`; summed by `scripts/balance-sites-probe.mjs`). Figures are pilot 15 unless
the probe is named; pilots 6 and 14 differ by a few points and say the same.

- **Sites wait for a material, mostly stone, after day 10.** Share of site snapshots waiting for a material by block of ten
  days: 47, 80, 92, 92, 93 and 97%; for stone 13, 29, 39, 45, 45 and 47%; for planks 27, 37, 39, 36, 36 and 36%; for logs 7, 15,
  14, 11, 12 and 14%. Sites without a builder are 35% of snapshots in days 0 to 9 and 15, 6, 7, 5 and 3% after (over the whole
  game, 24% of house-site snapshots wait for want of a free adult). Pilot 6 has the same shape (stone 32 to 60% from day 10).
- **Stone is out.** Stone made per seat and day: 8.5, 2.0, 0.6, 0.4, 0.4 and 0.1 by block. The median seat has 3 rock tiles
  (18 units) inside its border in days 0 to 9 and 1 tile (5 units) from day 20. Seats with no stone in the warehouses at the
  end of the day: 1, 10, 13, 20, 23 and 27%. In the probe, 97% of the site-samples where nothing had been sent for stone
  (475 in days 20 to 59) were in a seat with no stone in any warehouse; the stone-starved sites are mostly houses (231
  samples, one stone each), then butchers (134) and toolsmiths (129).
- **Planks and logs are not short.** 840 planks made per seat, 143 used for building, 71 for upkeep and 71 as inputs; the
  warehouses hold a mean of 89 planks in days 0 to 9 and 536 in days 50 to 59, and are out on 3 to 11% of seat-days. Logs go
  to the sawmills (about 90% of seat-days have no log in stock), so the one-log flowerbeds starve (195 site-samples, 98% of a
  flowerbed's snapshots wait for the log). Planks nothing was sent for, days 20 to 59 (113 site-samples): no route from any
  store that holds them 69%, none in stock 29%. Why a store with planks has no route to the site was not traced.
- **Goods can be stranded on a site's own flag.** In the probe, of the sites with a material on its way, 88% (stone, 371
  samples) and 71% (planks, 282) had a good that had lain on one flag for over a day. Of the stone samples 99% (all of the
  plank samples) had that good on the site's own flag (`nextHop` is -2), where nothing carries it in: a carrier only enters a
  building with a good it brings to the flag, and `chooseTransfer` moves goods to a next flag only. 297 of the 325 stone
  samples on the own flag and all 200 plank samples were 6 days old or more. The supply loop re-aims a store-bound good lying
  on a flag to the nearest building that needs it, and that can be the building whose flag it lies on: 4 of 86 stone redirects
  to sites and 1 of 226 plank redirects did so, and so did 15 logs, 12 fish, 5 bread and others going to finished buildings.
  There are more ways in than the redirect; they are traced in the next section. `release` only acts when a seat is at the
  sites cap, and the cap rarely holds (below).
- **Roads and carriers are not the general limit.** 82 to 94% of roads are under 25% loaded, 1% of flags are full, and sites
  that get their materials finish in a median of 0.2 to 0.5 days (houses 0.3 days when placed in days 0 to 29).
- **Land near the centres is used up, and that is what stops the houses.** In 62 to 77% of seat-samples from day 10 the AI
  wants a house (not housed, houses under people / 7) and has none open; the quota is met in 5 to 10% and planks are under
  5 in 3 to 11%. Once a day, for such a seat, the probe looked for a tile within 9 steps of the keep or any lit lantern where
  `placeOn` would put a house: a tile was found 15, 10, 17, 7, 4 and 4 times against none 41, 110, 121, 141, 143 and 128 times
  by block (the search stopped at 400 tiles in 151 of the 684 "none" checks, so at least 78% of them looked at every tile).
  Of the tiles examined in those seats, 66 to 70% had no spot for the flag, 24 to 26% could not be built on (in a separate
  trace, 0 to 2 of 6 to 28 tiles were over the slope limit) and 6 to 8% had no road. For scale: room is 30 plus 6 a house, a
  seat places 16.1 houses over the game and holds 118 to 120 people in days 30 to 59.
- **The AI's own caps are not the limit after day 10.** Thoughts stopped at the sites cap: 19, 10, 9, 9, 8 and 7% (pilot 15,
  with `release`); in the probe seats at the cap were 19, 5, 5, 3, 0 and 0% of samples. Buildings placed per seat per block:
  46.1, 10.0, 4.1, 0.8, 1.8 and 0.8. The house want is on in most seat-samples and finds no place (above).
- **Across seats** (108, pilot 15): buildings at the end go with territory (r 0.84 at the end, 0.82 at the start), rock inside the
  border at the start (0.62) and stone made (0.64), and little with planks made (0.26) or logs made (0.27). Territory and
  stone are not independent (a larger seat has both), so this does not say which one limits. By quarter of stone made the
  buildings are 27.4, 45.1, 64.6 and 75.9.

What this points to: on tiny and small maps growth is limited by ground and, for what is placed, by stone. The border is fixed
by day 10; the ground inside it near the centres no longer takes a house (flag spots, features, roads); and stone, which
houses, wells, farms, beacons and most other buildings need, stops being made when the rock in the border is gone. Planks,
logs, builders, general transport and the sites cap are not what stops it after day 10. Stranded goods hold up some sites.

Not verified: why stores with planks have no route to the site; and whether more ground, more rock or stone from further away
lifts growth (no change was tried). The
probe's house search approximates `placeOn` (the keep and every lit lantern as centres, 400 tiles at most; the random lantern
the builder picks, and its limit of 60 tries, are not modelled). Six games, one level and one switch stack.

### Result: goods stranded on the flag of the building they are bound for (`soak/balance/strand.ts`)

Fixed since: this is issue #136, fixed by #137 (`03bbc33`). The figures below are from before the fix, so they describe the
stranding, not the game as it is now; the sites results above were also measured before it.

A good that lies on a flag with no carrier, bound for a building that stands on that same flag, is never moved. Traced in
`economy.ts` (line numbers as on this branch; none of the functions below behaves differently from `origin/master`, whose diff
of this file is the good-id constants in `need` and `upkeepGood` and a precomputed store list in `supply`):

- A carrier only enters a building with a good it carries onto the building's flag (`stepCarrier`, case "carry", line 3232).
  `chooseTransfer` moves a good only when `nextHop(g)` is the flag at the other end of the road (`if (hop !== to) continue`,
  line 3392); for a good on its destination's flag `nextHopFrom` returns -2 (line 3342), which never equals a flag.
  `returnGood` skips it the same way (line 3358). The only caller of `receive` (line 2164) is the carrier's "enter" step.
  Meanwhile the building counts the good as `pending`, so `need` (line 1786, `upkeepNeed` line 1814) asks for no other one.
- Three ways in, each traced with the call stack of one good (a replay of the game with accessors on that good):
  1. `supply` re-aims a store-bound good lying on a flag to the nearest building that needs it (lines 2006 to 2038,
     `g.dest = b.id` at 2034), nearest being distance 0 when that building's flag is the flag it lies on. Good 4824 (tiny
     bal-003): a stone made by a quarry at tick 48580, bound for the keep, carried over flags 124, 44, 21 and 22 to flag 9,
     put down at tick 48781; at tick 48805 `supply` changed its destination to house site #147, whose flag is 9. The site had
     a builder, no dig, 0 of 1 stone delivered and 1 pending; the stone lay there unchanged at the end of each day to day 10
     and was still there at day 60.
  2. `assignDestination` (lines 1893 to 1914, `g.dest = best` at 1911) gives a freshly made good to a building that needs it,
     the nearest by route, and a building asking for the good it makes itself is at distance 0. Good 17203 (small
     bal-003): a plank sawn by sawmill #12 at tick 158742 was given to sawmill #12, which asks for one plank of upkeep once
     its wear is 0.5 (`upkeepNeed`); the plank lay on the sawmill's own flag to the end of the game and the sawmill's upkeep
     request counts as met.
  3. `dropCarriedGoodAt` (line 1705; callers `splitRoad` 1582 and `dismissCarrier` 1630) puts what a carrier carries down at
     the nearer end of the road when the road is split or the carrier dismissed, without asking whether that flag is the
     destination's. Good 79 (small bal-003): a plank sent by supply at tick 4730 to house site #26 (flag 29, created at tick
     4726); at tick 4966 an AI building placed a flag on the road it was carried over, and the carrier dropped it on flag 29.
     It lay there for the 59.9 days the game lasted.
- Not only store-bound goods: ways 2 and 3 involve goods whose destination was a building, not a store, when they got there.
  In the six games (the switch stack `tools,ore,release,smith,forge`), 79 goods lay on their destination's flag for 1500
  ticks or more: 50 through way 1, 21 planks of a sawmill through way 2, and 8 whose destination was already a building (one
  traced to way 3, the other seven not traced; six of them, bound for the keep in tiny bal-001, lasted 0.6 to 5.9 days).
- It happens with every AI switch off, too: in three tiny games (bal-001 to bal-003) 26 goods lay there (14 through way 1,
  10 sawmill planks, 2 destination already a building), median 48.4 days, longest 59.1; two sites held one (stone) and
  neither finished by day 60. The small games of that run were stopped.
- How long, and what becomes of the sites (six games, switch stack): the 79 goods lay a median of 37.5 days (90th percentile
  57.7, longest 59.9, i.e. to the end). Seven sites held one (three houses, a well, two coal mines, a woodcutter); none
  finished. Four were demolished and their goods moved on: three after 4 to 4.1 days (a match for `release`'s 4 days, not
  traced), one after 31.7 days; three were still open at the end after 55.7, 53.5 and 59.9 days. Goods stranded at the end of day 10, 20, 30,
  40, 50 and 60, summed over the six games: 3, 3, 4, 4, 4 and 3 for sites, and 28, 31, 59, 60, 60 and 60 for finished buildings
  (fish, logs, grain, bread, planks, ore and stone, the building's flag filling up with them).
- Cause: no code path moves, or delivers, a good that is lying on its destination's flag, and four callers (`supply` redirect,
  `assignDestination`, `dropCarriedGoodAt`, and the spawn at a store's flag, line 2044) can put one there. Sure of the
  invariant and of the three traced ways (stack traces, and the same goods still there days or weeks later); not traced:
  the six keep-bound goods, why `release` did not pull down the three open sites, the fourth way (line 2044, no case seen),
  and the effect on growth, which I did not measure. A fix would be small (not changed here): leave out of
  `assignDestination`, the redirect and the spawn any building whose flag is the good's flag, `receive` it at once when
  `dropCarriedGoodAt` is about to put a good on its destination's flag, and let an idle carrier take a good whose next hop is -2
  into the building.

### Result: the armed-wardens rule (`soak/balance/mix.ts`, issue #146)

The rule is a match option, off by default and fixed at game start (`armedWardens`): a lantern building (lantern, lamphouse,
beacon) is lit only by a warden who carries a blade and a shield. The weaponsmith makes shields as well as blades (1 iron and
1 fuel each), whichever the stores hold fewer of, and stops at 6 pairs plus one per vacant lantern place; a seat starts with
8 blades and 8 shields; Builder and Trader seats may build the weaponsmith.

`mix.ts` prints, per seat at days 5, 10, 20, 40 and 60, the buildings per kind, wardens, lantern buildings lit and dark, land
tiles held and the blades, shields and iron in the stores. `ARMED=1` plays the rule. Tiny and small maps, `bal-001` to
`bal-006`, 3 rivals (builder, trader, warden), 60 days, `BALANCE_EXTRA=tools,ore,release,smith,forge,granite`: 12 games, 36 seats.
Means per seat at day 60:

| | Rule off | On, no cap on arms | On, with the cap |
|---|---|---|---|
| Buildings | 52.8 | 52.8 | 52.7 |
| Land tiles held | 318 | 318 | 319 |
| Wardens | 8.5 | 7.1 | 7.5 |
| Lantern buildings dark | 0.0 | 0.4 | 0.4 |
| Blades / shields in the stores | 6 / 0 | 23 / 23 | 5 / 6 |
| Iron in the stores | 85 | 12 | 96 |

- With the rule off, the game is the one on master (52.6 buildings per seat before this change).
- Without a cap the weaponsmith spent the iron: seats with one held about 30 pairs for about 7 wardens, and iron fell from 85
  to 12. With the cap, iron and buildings are as with the rule off. Land at day 5 is 312 against 317 tiles (0.6 lantern buildings
  dark per seat at day 5, 0.8 at day 10), and equal from day 40.
- Dark lantern buildings at day 60: 7 of 36 seats. Six have no iron supply (no smelter and no ore), so no new arms. The
  seventh (small `bal-006`, seat 3) has arms in the stores and no free adult: 15 houses against 27 with the rule off, and 16
  wardens in them. The details panel now says "Waiting for a free adult" in that case, and "Waiting for arms" in the other.
- 26 of 36 seats built a weaponsmith with the rule on (the run without the cap; 9, 9 and 8 for the builder, trader and warden seats); 7 with the rule
  off, all of them warden seats.
- The games above have `peaceDays` 999, so they do not show war.

War: `BALANCE_AI=quarry,stone,food,priority,armed node scripts/balance-sweep.mjs war --seeds 2 --workers 4 --out balance-war-armed`,
12 games (3 levels × tiny and small × seeds `bal-001` and `bal-002`, three Wardens, 200 days, 83 minutes), against the same 12
games in the `balance-war1` baseline (rule off, same switches except `armed`):

| | Rule off (baseline) | Rule on |
|---|---|---|
| Games that end with a winner | 1 (day 14) | 0 |
| Captures, all 12 games | 113 | 32 |
| Rivals fallen, all 12 games | 19 | 12 |
| Attacks on days 0-19 / 20-39 / 40-59 / 60-79 / 80-99 / 100+ | 153 / 4 / 3 / 5 / 2 / 2 | 44 / 5 / 0 / 0 / 2 / 0 |
| First attack, median day (11 of 12 games have one with the rule on) | 5.4 | 5.7 |
| Rule violations | 1 | 0 |

- Fighting is early and then stops with the rule off, and the same with it on, only smaller: about a third of the early
  attacks and captures. The war targets (winners decided by day 40 to 150; steady attacks to the end) are met by neither.
- Not explained by this run: why there are fewer early attacks (an attack takes wardens that hold the lanterns; seats start
  with 8 pairs). The wardens per seat and the lantern buildings left dark in these games were not read out. Two seeds per cell,
  so the games are too few to call the 113 against 32 more than a large difference.

### The standard assessment (`assess`, `scripts/balance-assess.mjs`)

One suite for a change to the game or the AI: every world size (`--sizes tiny,small,medium,large,huge`), a mixed table of
temperaments (builder, trader, warden in turn), a short peace (`--peace`, 999 for no war), and `--days` long. The report turns
the games into one markdown file by size: growth and people, food and hunger, logistics (roads, flags, goods lying and stuck on
flags), materials and mining, land, war, the armed-wardens rule, colonisation, terraforming, growth stalls (a seat is stalled
on a day when its finished buildings are no more than 10 days before; what the first cause five days into the stall was, and
which conditions are commoner on stalled days than on growing ones), and what holds workplaces and building sites up. Give it
two run directories to read them side by side.

```sh
STACK=quarry,stone,food,priority,tools,ore,release,smith,forge,granite,turn,wide
BALANCE_AI=$STACK     node scripts/balance-sweep.mjs assess --seeds 3 --sizes medium,large --days 80 --peace 999 --workers 3 --out base
BALANCE_AI=$STACK,wood node scripts/balance-sweep.mjs assess --seeds 3 --sizes medium,large --days 80 --peace 999 --workers 3 --out wood
node scripts/balance-assess.mjs base wood --names base,wood --out report.md
```

Probes that play the assess game (the full AI stack, no war, three rivals; `turn` and `wide` as trailing arguments) and say what
the AI did and why it could not do more, bundled like the other helpers. All are read-only except `railwhy`:

- `stallwhy.ts <size> <seed> <days> [turn] [wide]`: per seat and 10-day window, the builder's thoughts by where they stopped
  (site cap, no planks, no idle hands, the wants list), how many had an empty list or tried and failed, and what was placed
  (`aiTrace` in `builder.ts`).
- `tilewhy.ts <size> <seed> <days> [turn] [wide]`: at the end, every tile of each seat's land and why a house or a farm cannot
  stand there (the reason the build tool would give), or whether a road can join it; also the land by use and feature.
- `whyexpand.ts <size> <seed> <days> [turn] [wide]`: per seat, the stores and people, the frontier tiles a lantern would be tried
  on (all, and the first 40 the builder looks at) with the reason each turns a lantern down, and the rock left in and round the border.
- `jamwhy.ts <size> <seed> <seat> <days> [turn] [wide]` (#148, #149): every 10 days, the flags of one seat holding the most goods,
  what stands on them, where each good is bound and the route length. `railwhy.ts <size> <seed> <days>` (#147): the questions the
  voyage planner asks before a launch rail, one by one, then a rail placed the way it places it (this one places a building).
- `ringwhy.ts <size> <seed> <seat> <days> [turn] [wide] [norings] [w=<weight>]` (#149): every 10 days, the full flags of one seat that no good can leave (each good bound for another flag in the set, no good coming back to swap), their goods by next hop, and a cycle through them; `norings` plays without `transportOptions.breakRings`; it prints how many times the rule fired.
- `colonywhy.ts <size> <seed> <days> [population idle]` (#126): plays the assess game with a lowered colony threshold (default 30 people, 5 idle) and records, each day from day 10, the first voyage gate each seat fails (rail, probes, Hearthship), then the voyage events and, every 10 days, what a loading Hearthship's rail still lacks. `COLONY_FLAGS="early,railsites"` turns those two switches on for it.
- `hungerwhy.ts <size> <seed> <days>` (#126): per seat and 10-day window, hungry days, people, idle adults, food, the days food cover was under 1 or nobody was idle, the food buildings standing and building, where the builder's thoughts stopped, and the food wishes placed or failed; at the end, the farm, orchard, fisher and hunter sites on the seat's land by reach, why placement fails (no road path), and the pockets of land that no road reaches with what blocks them.
- `BALANCE_FOUND="population,idle"` changes when the AI founds a colony (`VoyagePlanner.found`); the record lists it in `found`.

#### Result: border candidates and wood by need (#150, medium and large, 3 seeds each, 80 days, no war)

Standard stack with `turn` and `wide` as the base; 6 games a variant, 3 per size, so differences under about 15% are noise.

| Buildings per seat, day 60 | base | `cand` | `wood` | `cand,wood` |
|---|---|---|---|---|
| medium | 91.3 | 89.9 (-2%) | 91.9 (+1%) | 90.7 (-1%) |
| large | 107 | 113 (+6%) | 121 (+13%) | 125 (+18%) |

- Large, `cand,wood` against base: people d60 209 / 235, land held d60 1336 / 1413, logs made days 0-59 557 / 819, planks
  512 / 662, stalled seat-days 41% / 33%, buildings when a stall starts 96 / 117, goods stuck on flags d60 32.5 / 7.3.
  `wood` alone raised logs by 51% and buildings by 13% but goods stuck on flags went from 32.5 to 47.3.
- Medium: no change in wood made or in buildings; stalled seat-days 47% base against 50% to 54% with the switches.
- Workplaces with no worker on large, day 60: 3.6 base, 5.0 with `cand,wood` (probably the extra woodcutters and foresters; not checked).
- Not explained: iron ore on large fell 33% with `cand,wood`; rule violations in medium were in every game of every variant.
- Why games stall (#150, from `stallwhy`, `tilewhy` and `whyexpand`): on tiny and small maps the land is full from about day 20
  (every want fails, pockets of land no road reaches); on medium to huge, `expand` tried 40 mostly wooded frontier tiles, wood ran
  short because woodcutters were added only when adults stood idle, and a builder at its sites cap with sites waiting for planks
  did nothing at all.
- Not measured: `cand` and `wood` on tiny and small maps.

#### Result: rings of full flags, the blocking-tile penalty and the reserved rail site (#147, #148, #149)

Standard stack plus `turn` and `wide` as the base, no war, 3 seeds a size; differences under about 15% are noise.

**A ring of full flags is a deadlock (#149).** `ringwhy.ts` takes the full flags of a seat and keeps those where no good can move
(each good's next hop is a flag in the same set, and no good comes back for a swap). In the jam of #149 (small `bal-002`, seat 2,
`turn` with partner weight 0.5) that left 28 flags deadlocked at day 50 and 26 at day 60, with a cycle of four full flags (pasture,
beacon, apiary, hunter) and chains queueing behind it. With `rings` the same game fired the rule 37 times between day 10 and day 20
and never again, and had 9 goods on flags at day 20 against 121.

80-day games, `rings` against the base (the cap of one good over the capacity, rerun on small and medium):

| Per seat, day 60 | tiny | small | medium |
|---|---|---|---|
| Buildings | 45.1 → 45.1 | 54.1 → 55.1 (+2%) | 91.3 → 97.6 (+7%) |
| People | 97.4 → 97.4 | 117 → 118 | 176 → 187 (+6%) |
| Goods stuck on flags | 0.78 → 0.78 | 1.09 → 1.9 | 30.6 → 2.7 (-91%) |
| Goods lying on flags | 1.49 → 1.49 | 5.46 → 11.6 | 40.1 → 11 (-73%) |
| Full flags | 0 → 0 | 0.22 → 0.81 | 4.4 → 0.96 (-78%) |
| Stalled seat-days | 86% → 86% | 73% → 71% | 47% → 44% |

The first version let a flag take any number over its capacity; one reached 30 goods in a small game. With the cap, no flag went past 9.
`base` itself shows 9-good flags on some days (medium `bal-001`, `bal-002`) and, in medium `bal-003`, "flag is not on its tile" on every
day; something other than this rule over-fills flags now and then, not traced.

**The blocking-tile penalty (`block`, weight 1) is worse.** On small, goods lying on flags at day 60 went from 5.5 to 27.9 and goods
stuck from 1.1 to 25.5; launch-rail seats fell on small (44% to 22%) and medium (67% to 33%) and probes fell by half or more on small and medium (tiny sent more: 0.33 to 1.33). Buildings
were within noise (small 54.1 → 57.3, medium 91.3 → 90.7). Not understood; my guess is that the penalty pushes flags onto
existing hubs, which fill. It stays off.

**The reserved rail site (`rail`)**, 200-day games, tiny and small, 3 seeds each (9 seats a size), base against `rail`:

| | tiny | small |
|---|---|---|
| Seats with a launch rail | 11% → 33% | 33% → 44% |
| Probes sent per game | 0.33 → 3 | 5.33 → 4 |
| Hearthships sent | 0 → 0 | 0 → 0 |
| Buildings d200 | 45.8 → 44.7 | 60.8 → 62.1 |
| People d200 | 91.9 → 96.9 | 122 → 129 |
| Land held d200 | 252 → 254 | 340 → 359 |
| Goods stuck on flags d60 | 0.78 → 0.89 | 1.09 → 5.48 |
| Stalled seat-days | 92% → 90% | 82% → 84% |

- Two more tiny seats and one more small seat build a rail (of 9 each), so the reservation helps a little; with 3 games a size that is
  1 to 3 seats.
- No game sends a Hearthship in either run: the AI founds a colony from 70 people and 14 idle adults (`VoyagePlanner.found`), and these
  seats have 92 and 122 people at day 200 with few idle. So the rail alone does not bring colonies; that threshold is the AI's own limit
  and was left as it is.
- Goods stuck on small rose at day 60 (1.09 → 5.48) without `rings`; one seat's jam is likely, not looked at.
- Together (`rings,block,rail`) on medium: buildings 91.3 → 90.9, land held 780 → 721, launch-rail seats 67% → 44%; the loss follows
  `block`, which alone cut rails to 33%.

#### Result: hunger, the launch rail and the Hearthship's loading (#126)

**Why colonies are not founded.** With the colony threshold lowered to 30 people and 5 idle (`colonywhy.ts`), nine games on tiny,
small and medium still sent no Hearthship. The voyage planner asks in order: a launch rail (30 finished buildings, iron 6, plank 8,
stone 10 in the stores, and no unfinished building at all), probes (iron 2, plank 2), then the Hearthship (the people and idle
numbers, plank 30, stone 12, log 10, iron 6 and every cargo good in the stores at once). The rail gate fails first: a growing
seat almost never has every building finished. After it, logs: the sawmills empty the stores of logs as fast as woodcutters fill them
while planks pile up, so `log 10` rarely holds. And no toolsmith makes a saw, because `toolsByDemand` counts only tools a workplace
or site waits for, not cargo.

**The game itself loads a Hearthship progressively.** A `hearthship` command creates a voyage "loading"; the launch rail asks
carriers for the craft and cargo (`voyages.ts` `refreshWants`); founders board at departure (12 idle adults, at least 6). The AI
orders only when the stores hold everything. With `orderEarly` (off) most goods arrived, but the voyage stalled on the saw
(nothing makes one) and on logs (the sawmills win them). Not built: wants of the rail that outrank the sawmills for logs, a toolsmith
that makes the cargo tools.

**Hunger** is seat-specific. Mechanisms seen with `hungerwhy.ts`: no site a road can reach (pockets of land fenced by water or trees),
the "no idle hands" early return before the food wishes, and farm sites that fail. `foodWithoutIdle` takes the second one.

Standard stack as the base, no war, 80 days, tiny, small and medium, 3 seeds each (3 games a size; differences under about 15% are
noise). `large` was left out of these runs.

| | tiny | small | medium |
|---|---|---|---|
| Hungry seat-days from day 30: base | 44% | 40% | 34% |
| `foodidle` | 24% | 43% | 26% |
| `railsites` | 44% | 40% | 39% |
| Goods stuck on flags d60: base | 0.78 | 1.09 | 41.7 |
| `foodidle` | 0.11 | 3.33 | 10.4 |
| `railsites` | 0.78 | 2.67 | 41.4 |
| Seats with a launch rail: base | 11% | 44% | 56% |
| `foodidle` | 11% | 11% | 56% |
| `railsites` | 11% | 44% | 67% |
| Probes sent per game: base | 0.33 | 4 | 4.67 |
| `foodidle` | 0.33 | 2.67 | 6.33 |
| `railsites` | 0.33 | 4 | 7 |

- `foodWithoutIdle` (`foodidle`): the food wishes also run when no adult is idle. Buildings and people on medium +7% to +10%; tiny
  dipped at day 20 (45 to 38 buildings) and was level by day 60. No rule violations. It is on by default (it acts only with
  `foodByNeed`, the `food` token); `BALANCE_AI=...,nofoodidle` plays without it. The `foodidle` rows above were played with the
  switch on and the base (`ab11-base`) with it absent, which was the same as off.
- `railWithSites` (`railsites`, off): the launch rail may be ordered while buildings are unfinished. Two more medium seats build a
  rail and probes rise on medium; buildings, people and hunger are otherwise level, hunger on medium 34% to 39% (not traced). No game
  sent a Hearthship, since the 70-person threshold stands.
- `orderEarly` (off, experimental): see above.
- Node crashed at random (signals 11, 5, 4) in parallel sweeps under WSL2, more often with more workers; a solo replay of a crashed game
  ran clean. Sweeps ran at low concurrency (2 workers) and resumed (the sweep skips games already in `assess.jsonl`); one failed game
  was retried.

### Result: the road lattice (`lattice`, PRs #159 and #162)

Asked after #159 (the lattice) and #162 (AI rivals and hamlets on it) merged: did they change anything balance-wise? The lattice was
off unless `?lattice=1` then (it is the default since #181), so two questions.

**1. The default game.** `hash.ts` on `377234d` (before #159), `20b350b` (#159) and `637273d` (#162), same games, 24 pairs
(12 games a build: `A`, standard stack, no war, tiny, small and medium two seeds each for 80 days, large one seed for 40 days;
`B`, peace 5 and `armed`, tiny and small two seeds each for 60 days, medium one seed for 40 days; days 1, 2, 4, 8, … and the last;
the pairs are one build against the next): all 24 pairs gave equal lines, 90 distinct checksums. #159 and
#162 leave the default game bit-identical, so an assessment from before them is still a valid baseline.

**2. The lattice game** (standard stack, three rivals, no war, 80 days, 3 seeds a size, 9 games; the default baseline is
`ab12-food`, 10 games). Per rival seat, default / lattice before the fix below / lattice after it:

| | tiny | small | medium |
|---|---|---|---|
| Buildings d60 | 44 / 31 / 86 | 54 / 35 / 72 | 103 / 46 / 80 |
| People d60 | 95 / 80 / 171 | 116 / 85 / 155 | 196 / 108 / 178 |
| Road tiles per finished building d60 | 3.6 / 6.6 / 3.9 | 3.6 / 7.2 / 4.4 | 3.9 / 8.0 / 5.8 |
| Hungry seat-days from day 30 | 24% / 26% / 23% | 43% / 32% / 29% | 26% / 34% / 36% |
| Open land at the end (share of held) | 0.11 / – / 0.16 | 0.20 / – / 0.31 | 0.21 / – / 0.37 |
| Seats with a smelter | 33% / – / 56% | 22% / – / 44% | 89% / 0% / 56% |

Land held is the same in all three (tiny 258 / – / 249 on day 60, medium 826 / – / 817), and no game had a war or a colony.

- **Cause of the first result (before the fix), verified in a probe.** `planner.ts` read positions of lattice nodes from the
  tile-only `grid.center`. A flag on a tile corner has an id past the end of that table, so its distance was NaN and the "6 nearest
  flags" a new building's flag joins fell back to flag id order: far away or unreachable. Flag sides were also counted only over
  neighbouring tile centres. In tiny `bal-001` on day 30, seat 1 had 136 tiles where a house fits and no road to any of them.
  The AI's rings were not the cause: `land.ring()` is tile based on the lattice too.
- **The fix** (`stepsBetween`, `planSide`, `flagSides` in `planner.ts` use `land.lattice.pos`, `land.pt`, `land.nbrs`,
  `land.ownerOf`): tiny `bal-001` day 30, buildings of seats 1 to 3: 36 / 34 / 25 before, 164 / 98 / 65 after, 67 / 34 / 59 in the
  default game. It touches the lattice only: the same 12 games, played with the fix, give checksum series equal to `637273d`'s.
- **After the fix, the lattice is not like the default game.** Tiny grows about twice as fast (the same land holds more
  buildings), small about a third faster, medium is 22% behind and has no smelter on 44% of seats against 11%. Medium's road
  tiles per building are +49%. (The medium deficit was a bug, see "Why the lattice differs (#164)" below: this table is from
  before #166 and #167.)
- **A rule break.** One lattice game (medium `bal-002`) had flag 97 hold 9 goods, 45 times in the record from day 36 (#163).
  The default games had none.
- **Not checked:** war and trade on the lattice, `large`. One sweep, so differences under about 15% are noise. (The other
  `grid.center` reads in the AI were checked in #167: three were hit and fixed, the rest only get tile ids.)
- **The 9-goods flag (#163), cause and fix.** In the medium `bal-002` game a flag held 6 goods and 1 promised place when
  `recomputeTerritory` removed roads and two dismissed carriers put their goods down on it (`dropCarriedGoodAt` counts the goods,
  not the promised places); the carrier the place was promised to then arrived and `dropAt` pushed the 9th. Not specific to the
  lattice: drops that leave goods plus promised places over the capacity were counted in 1 of 6 default games (3 events) and 3 of 6
  lattice games (6 events) of tiny and small, 60 days, seeds 001 to 003 (counts, not realised 9s; one realised in 19 games). Fix:
  `dropAt` gives up the promise of a carrier arriving at a flag that already holds the capacity (one over with `breakRings`) and
  takes the swap path or waits. The 12 default same-game series equal `637273d`; the replay of `bal-002` runs 80 days with no flag
  over 8 goods.
- Node crashed at random under WSL2 here too (kernel log: signals 11, 5 and 4, 22 captures in 1 day 20 hours; the faulting address
  of two SIGILLs lies outside the Node binary). The crashes were not traced; the sweeps ran at 2 workers with retries.

#### Why the lattice differs from the default game (#164)

Nine lattice games again on master `7264f58` (planner fix, #166, #167), same seeds and settings, and the default baseline `ab12-food`.
Per rival seat, default → lattice:

| | tiny | small | medium |
|---|---|---|---|
| Buildings d20 | 37.7 → 80 (+112%) | 52.1 → 69.1 (+33%) | 77.1 → 83 (+8%) |
| Buildings d60 | 43.7 → 86.4 (+98%) | 54.1 → 78.7 (+45%) | 103 → 120 (+16%) |
| People d60 | 95 → 174 (+82%) | 116 → 159 (+36%) | 196 → 235 (+20%) |
| Land held d60 | 258 → 249 | 350 → 352 | 826 → 916 |
| Land under buildings at the end (share of held) | 0.18 → 0.36 | 0.17 → 0.26 | 0.14 → 0.17 |
| Road tiles per finished building d60 | 3.6 → 3.9 | 3.6 → 4.3 | 3.9 → 5.0 |
| Hungry seat-days from day 30 | 24% → 24% | 43% → 40% | 26% → 38% |
| Full flags d60 | 0 → 0 | 0.33 → 2.2 | 1.6 → 12.6 |
| Goods stuck on flags d60 | 0.1 → 0 | 3.3 → 17 | 10 → 91 |

- **Medium was a bug, now fixed.** In the sweep before #167 the lattice medium seats lost most of their buildings on days 10 to 15
  (one seat 61 → 26). `lost.ts` on `fb3ffe8`, medium `bal-001`, lattice, 20 days: 308 buildings burned down (`scorchBuilding`: 105
  houses, 39 beacons, 15 wells, 14 farms, …) from day 11, plus 108 AI `tidy` removals of sites. On master the same game loses 5
  to fire in 30 days; the default game loses 0 to 4. The cause, read from #167 and not tested on its own: a kiln's spark lit a
  tile corner and the fire code read tile-only arrays with a corner id. The lattice is now ahead at every size.
- **Why tiny grows faster.** In the default game a flag and every road node use a tile centre. Tiny `bal-003` seat 1, day 5, of
  about 270 dry tiles: 63 road, 37 flags and 37 buildings (137) in the default game; on the lattice 19 road nodes on centres (58 on
  corners), 0 flags on centres (37 on corners) and 37 buildings (56). Tiny `bal-001`, day 20: 75 to 140 centres used by roads and
  flags per seat in the default game, 25 to 55 on the lattice. Default seats freeze with 15 to 25 free tiles where a house fits and
  no road to them (own roads, flags and buildings in the way); tiny `bal-003` seat 3 holds 23 buildings from day 3 to day 80.
  Lattice seats freeze later and higher, and also have free tiles with no route. Not tested: that this is all of it.
- **New: goods back up on the lattice** on small and medium (table above). Tiny has none. See #169 below.
- Three games a size: indications, not settled results.

#### Goods back up on the lattice (#169)

The nine lattice games on `7264f58` against the default baseline, then `jam.ts` on three jammed seats. Few games: indications.

- **Not just the bigger economy.** Seat-days from day 20 at the same number of finished buildings, mean goods stuck on flags,
  default → lattice: medium 60 to 80 buildings 1 → 219, 100 to 120 buildings 8.7 → 39, 120 to 150 buildings 14 → 218; small 60 to
  80 buildings 3.8 → 141 (other bands equal); tiny none. A few seats carry the means: seats with 30 or more goods stuck on 50 days
  or more were 4 of 18 small and medium seats on the lattice (medium `bal-001` seat 1, `bal-002` seat 2, `bal-003` seat 3; small
  `bal-001` seat 3; peaks 157 to 497) and 1 of 18 in the default game (medium `bal-002` seat 2, 45 days, peak 367). Lattice jams
  start at 64 to 70 buildings (medium `bal-002` seat 2 on day 15, small `bal-001` seat 3 on day 25); the default jam starts on
  day 35 at 129 buildings.
- **A jam is a lock-up.** Small `bal-001` seat 3, lattice: 116 stuck goods on day 25, 133 on day 30, 157 on day 40, on about 20
  flags, 16 to 19 full, all on corners; every stuck good waits because the next flag is full. Medium `bal-002` seat 2, lattice:
  192 to 231 stuck on 29 flags, 28 to 30 full, the seat stays at 64 buildings. Both have a ring of 3 full flags, each holding a
  good bound for the next.
- **`breakRings` unlocks them.** Small `bal-001` seat 3: 0 stuck goods on every day, 79 to 81 buildings against 69 to 70. Medium
  `bal-002` seat 2: 239 stuck on day 20, 16 on day 25, 14 to 20 after; 123 to 126 buildings against 64. The other seats changed
  little.
- **The default game locks up too, later.** Medium `bal-002` seat 2: 123 stuck on day 35, 323 on day 40, 51 full flags, 154
  buildings. `jam.ts` finds no ring there, so what holds it is not known.
- **Storage.** Stores have no stock limit (`storeAccepts` checks the mode only). Goods go to the nearest store, so they converge:
  of 157 stuck goods 97 are bound for a store (Hearthship 89, storehouse 8), and both store flags hold 8 of 8. The number of
  storehouses does not separate jammed seats from healthy ones (jammed seats ended with 0 to 5). More stores were not tested;
  clearing the ring alone removed the jam.
- **Why sooner on the lattice: not found.** Failed hypothesis, more loops in the road network: triangles and 4-cycles of the flag
  graph per seat on days 10 to 40 were 0 to 3 and 0 to 2 on the lattice, 0 to 3 and 0 to 3 in the default game; flags with 3 roads
  or more were 35% of flags on the lattice and 33% in the default game. Not tested: road lengths and carriers (road tiles per
  building are +21 to 27% on the lattice), flags that serve a building and a junction at once, the order goods are moved in.
- **A keep flag with one road jams (two of the four seats), found after the ring rule went on.** `netshape.ts`, small and medium,
  seeds 001 to 003, days 10, 15, 20: on the lattice the keep's flag has 1 road in 2 of 18 seats and both jam later (medium
  `bal-002` seat 2, `bal-003` seat 3, peaks about 330 stuck goods); the other 16 have 2 to 5. The other two jam seats have 3 and 5
  roads at the keep, so this is not all of it. In the default game every seat has 2 or more (mean 2.9). The free corners beside
  that flag are roadable (`keepflag.ts`); the AI did not build there. The lone road is busy on day 10 (carrier worked 0.53 and
  0.78 of the day). With the ring rule on, medium `bal-003` seat 3 on day 30: 153 stuck on 27 flags, 152 waiting on a full next
  flag, 132 bound for the keep, no cycle, the keep's own flag holding 1 good: a queue into one road, not a ring.
- **Test: three roads at the keep flag (`keeproad.ts`, day 8, medium, lattice, 45 days, the same game with and without).**
  `bal-002` seat 2 (ring rule off): stuck goods on days 25 to 45 157 / 228 / 229 / 225 / 231 → 22 / 0 / 2 / 0 / 0, buildings d45
  64 → 167. `bal-003` seat 3 (ring rule on): 80 / 153 / 143 / 166 / 177 → 0 / 0 / 16 / 5 / 7, buildings d45 124 → 108 (13% fewer;
  not looked into). The other seats change by 3% or less. One game each, so an indication; the single road into the keep is a
  cause of the jam in these two seats.
- Carrier load (0.11 to 0.14 against 0.12 on day 20), helpers called and the share of flags that carry a building and join 3
  roads or more (0.24 to 0.28 against 0.27 to 0.29) are the same in both modes. Roads are longer in nodes on the lattice (mean
  4.3 to 5.3 against 3.6, longest 13 to 15 against 7), but a lattice step is a different distance, so that is not compared.
  Not found: why the lattice AI leaves a keep flag with one road (untested guess: later roads end on the first road's nodes,
  which splits it, instead of on the keep flag). No game code changed for this.

#### `breakRings` on by default (#169)

Decided with the owner: the ring rule (`transportOptions.breakRings`, #149) is on in every game, default and lattice. Checked with
three 9-game sweeps (tiny, small, medium, seeds 001 to 003, 80 days, the standard stack, master `d598b89` game code): the default
game as it was, the default game with the rule, and the lattice with the rule against the lattice sweep without it (`ab19-lat`).
Per rival seat, without → with:

| | default tiny | default small | default medium | lattice tiny | lattice small | lattice medium |
|---|---|---|---|---|---|---|
| Buildings d60 | 43.7 → 43.7 | 54.1 → 53.6 | 103 → 101 | 86.4 → 86.3 | 78.7 → 81.4 | 120 → 132 |
| People d60 | 95.4 → 95.4 | 116 → 116 | 196 → 193 | 174 → 173 | 159 → 161 | 235 → 263 |
| Hungry seat-days from day 30 | 24% → 24% | 43% → 34% | 26% → 26% | 24% → 28% | 40% → 29% | 38% → 25% |
| Full flags d60 | 0 → 0 | 0.33 → 1.61 | 1.56 → 1.98 | 0 → 0 | 2.18 → 0.11 | 12.6 → 3.49 |
| Goods stuck on flags d60 | 0.11 → 0.11 | 3.33 → 5.44 | 10.4 → 9.48 | 0 → 0 | 16.8 → 0.03 | 90.5 → 15.5 |

- The default game hardly changes (tiny identical, small and medium within 2% on buildings and people; the small hunger and
  stuck-goods differences come from one or two seats). The lattice small and medium games gain: medium buildings +10%, people
  +12%, hungry seat-days 38% → 25%, stuck goods −83%. No rule violations in any of the 27 games.
- Seats with 30 or more goods stuck on 50 days or more (small and medium, 18 seats): lattice 4 → 1, default 0 → 0 (the earlier
  default baseline `ab12-food` had one, medium `bal-002` seat 2). The one left is medium `bal-003` seat 3, lattice: still jammed
  on days 25 to 50 (peak 211 stuck goods on 33 full flags, 333 on 49 without the rule) and 52 to 80; so the rule does not clear
  every jam, and what holds that one is not known.
- Wall time per game in the lattice sweeps rose (small 39 → 53 min, medium 59 → 134), but those games were played three sweeps
  at a time against a sweep played alone, and the games are bigger; the default pair, played side by side, differ by −5% to +4%.
  One lattice game timed on its own (medium `bal-002`, 40 days, `jam.ts`, the machine also running other work): 2081 s without the
  rule, 1863 s with it, so the rule itself costs no visible time.
- Existing saves and replays play differently from this change on, as for any change to the rules of the game.
- Three games a size: indications, not settled results.

#### Three roads at the keep flag (`keeproads`, #169)

The AI switch `keepRoads` (off by default) against the sweeps with the ring rule on (`ab20-latr`, `ab20-defr`): the same 9 games,
tiny, small, medium, seeds 001 to 003, 80 days, the standard stack, master `0ee0f4e` game code. Per rival seat, without → with:

| | default tiny | default small | default medium | lattice tiny | lattice small | lattice medium |
|---|---|---|---|---|---|---|
| Buildings d60 | 43.7 → 44.6 | 53.6 → 55.4 | 101 → 103 | 86.3 → 90.3 | 81.4 → 81.4 | 132 → 124 |
| People d60 | 95.4 → 103 | 116 → 124 | 193 → 204 | 173 → 179 | 161 → 158 | 263 → 237 |
| Hungry seat-days from day 30 | 24% → 32% | 34% → 38% | 26% → 32% | 28% → 35% | 29% → 32% | 25% → 30% |
| Goods stuck on flags d20 | 0.03 → 0 | 3.26 → 1.64 | 10.1 → 8.1 | 5.12 → 0.48 | 7.09 → 0.11 | 30.3 → 3.4 |
| Goods stuck on flags d60 | 0.11 → 1.89 | 5.44 → 2.56 | 9.48 → 10.6 | 0 → 0.06 | 0.03 → 0.4 | 15.5 → 10.2 |
| Full flags d20 | 0 → 0.03 | 1.6 → 0.89 | 5.02 → 6.91 | 3.18 → 0.84 | 4.66 → 1.12 | 7.84 → 1.91 |

- **Fewer goods stuck early on the lattice:** stuck goods on day 20 −89% to −98%, full flags −73% to −76%, on every size. Seat-days
  with 30 or more goods stuck (small and medium, 18 seats): lattice 95 → 72, default 102 → 56. Seats with 50 such days or more:
  lattice 1 → 0, default 0 → 0. No rule violations in the 18 games.
- **The four seats that jammed on the lattice** (days with 30 or more stuck, buildings d60): medium `bal-002` seat 2 16 → 0, 123 →
  167; medium `bal-001` seat 1 3 → 4, 165 → 170; small `bal-001` seat 3 0 → 0, 83 → 74; medium `bal-003` seat 3 55 → 40, 149 →
  106. The last one (the queue into the keep above) still backs up and, as in the `keeproad.ts` test, builds fewer: why is not known.
- **Growth does not follow.** Default: buildings +2% to +4%, people +6% to +8%. Lattice: tiny +5%, small 0%, medium buildings −6%,
  people −10%. Single seats swing far both ways (lattice medium `bal-002` seat 1 203 → 146, tiny `bal-002` seat 1 91 → 148), so
  with one game a seed most of this is noise.
- **Hunger is up in all six columns** (+3 to +8 points of hungry seat-days). Looked into afterwards (`seatwhy.ts`): a few seats
  carry it, with large swings both ways (lattice 367 → 435 hungry seat-days, default 378 → 458), and the food buildings pooled
  over all seats hardly change (farms 139 → 141 and 97 → 97). The two largest cases are seats out of land: default medium
  `bal-003` seat 1 grew faster early (78 buildings on day 15 against 57) and then fed more people from the same few food
  buildings, with no site left for more; lattice tiny `bal-002` seat 3 filled its land by day 10 with houses, a storehouse and a
  quay instead of farms, and its keep flag had 3 roads on day 10 in both runs, so its game changed through the other seats. Not
  tied to the rule with one game a seed.
- **Why medium `bal-003` seat 3 builds less:** the warden seat's bowyer (#175). With the jam gone, planks reach the bowyer, which
  turns all of them into bows nobody uses (1099 made, 1078 still in the stores on day 79); from day 30 the stores hold no plank,
  houses drop off the wants list and the seat stays at 105 to 109 buildings at the room limit. The jam had kept planks from the
  bowyer (200 to 750 in the stores). With `bows` the seat reaches 141 (next section).
- Wall time: the default games ran faster with the switch (they were played two sweeps at a time against three before); three of
  the lattice games took about 9 hours each in a retry pass overnight, against 20 to 83 minutes for the other six. Not
  measured whether that is the switch or the machine.
- Not made the default: it clears the early backlog but costs one seat a third of its buildings and comes with more hunger.

#### Bows by need (`bows`, #175)

The warden seat (seat 3 in the assess games) builds a bowyer, which makes a bow from every plank it gets; bows arm wardens and
nothing else, and 97 to 98% of them were still in the stores on day 79. Seats with a bowyer had under 5 planks in the stores on
41 to 50 of the 50 days from day 30, seats without one on 0 to 2. The AI switch `bowsByNeed` sets the bowyer's plank share to 0
while bows are not wanted. Three 9-game sweeps (tiny, small, medium, seeds 001 to 003, 80 days, the standard stack, the
`bow-limit` branch, which with the switch off plays as master `953d5ff`) against the same games without it. Seats with a bowyer only (the others play the same rules, and their
differences are the game taking another course):

| Seats with a bowyer | lattice (8) | lattice + `keeproads` (8) | default (4) |
|---|---|---|---|
| Days with under 5 planks in the stores, of 50 | 41.4 → 2.9 | 47.5 → 3.5 | 46.5 → 2.3 |
| Bows made per seat | 1053 → 42 | 1228 → 39 | 703 → 40 |
| Buildings d60 | 93.3 → 98.3 | 82.6 → 90.1 | 77.3 → 91.0 |
| Buildings d79 | 94.5 → 102.3 | 82.4 → 90.1 | 77.5 → 97.0 |
| People d60 | 206 → 222 | 181 → 201 | 163 → 196 |
| Hungry days from day 30, of 50 | 10.4 → 10.1 | 12.1 → 13.0 | 10.0 → 21.8 |

- The plank shortage is gone and the warden seats build more (+8% to +25% by day 79). Medium `bal-003` seat 3 with `keeproads`
  goes 106 → 141 buildings on day 60; medium `bal-001` seat 3 in the default game 90 → 142.
- Default-game hunger rises in two of the four seats (tiny `bal-001` seat 3 19 → 48 days, medium `bal-001` seat 3 16 → 33), the
  latter the seat that grew by half. Not looked into.
- Over all seats (all 27 per sweep) buildings d60 change by −1% to +8%, wardens are unchanged, and there are no rule violations.
  Seats with 30 or more goods stuck on 50 days or more: lattice 1 → 0, lattice + `keeproads` 0 → 0, default 0 → 1 (small
  `bal-001` seat 2, not a bowyer seat).
- The bows are not needed in these games (no war, `peaceDays` 999); with war on, the 4 spare and the wardens' need decide how many
  are kept. War: next section.

#### `bowsByNeed` with war, and on by default (#175)

Four 9-game sweeps with war from day 5 (`--peace 5`; tiny, small, medium, seeds 001 to 003, 80 days, the standard stack, master
`7cd18cb`): the default game and the lattice, each without and with `bows`. Per game or per rival seat, without → with:

| | default tiny | default small | default medium | lattice tiny | lattice small | lattice medium |
|---|---|---|---|---|---|---|
| Attacks ordered | 3 → 3 | 3.67 → 3.67 | 10 → 8.67 | 3 → 3 | 1.67 → 1.67 | 11.7 → 11 |
| Buildings captured | 2 → 2 | 2.67 → 2.67 | 5 → 4.33 | 2 → 2 | 1 → 1 | 4.67 → 3.67 |
| Rivals fallen | 1.33 → 1.33 | 1 → 1 | 1 → 1 | 1.33 → 1.33 | 0.67 → 0.67 | 0 → 0 |
| Seats standing at the end | 67% → 67% | 78% → 78% | 67% → 67% | 78% → 78% | 78% → 78% | 100% → 100% |
| Wardens d60 | 4.8 → 4.8 | 13.6 → 13.6 | 19.7 → 19.2 | 8.71 → 8.71 | 6.29 → 6.29 | 20.3 → 21.4 |
| Buildings d60 | 36.8 → 36.8 | 58 → 58.1 | 73.1 → 81 | 59.7 → 61.2 | 77.6 → 66.3 | 126 → 134 |
| Bows made, whole game | 1.67 → 1.67 | 7.56 → 7.11 | 209 → 23.3 | 248 → 8 | 154 → 3.11 | 208 → 19.3 |

- War goes as before: the one game won (default tiny `bal-001`) is won by the same seat on the same day (12), the fallen rivals,
  the seats standing and the day of the first attack are the same; medium has a few fewer attacks and captures. No rule
  violations.
- Seats with a bowyer (5 in each mode): buildings d79 93.8 → 107.4 (default) and 91.6 → 112.0 (lattice); days with under 5
  planks in the stores 30.0 → 19.4 and 45.0 → 0.0 of 50; hungry days 18.4 → 22.2 and 15.6 → 17.8.
- Lattice small −14% is one seat without a bowyer (`bal-002` seat 2, 212 → 113 buildings, stopping on day 30 with no war event
  in the game): the game took another course; what stops it is not known.
- **On by default since #175**, in the default game and on the lattice; `nobows` plays without it.

#### Hunger and the climate (`coldstart`, `warmfarms`, #179)

Fields and orchard fruit grow only while a tile is above 5° with little snow (`Climate.growing`). `Climate.growingGuess` estimates
the share of the year a tile grows from the climate model (seasons, the day's swing, rain from the tile's moisture, snow), without
drawing from the weather's random stream; against the simulated weather of an 80-day game it correlates 0.99 and reads 3 to 5
points high. Measured on the assess games (12 games, 80 days, the standard stack):

- Borders stop growing by day 20 in 33 of 36 seats, so a seat farms the land it starts with.
- Of 19 seats with a cold keep, 7 hold a lot of warmer land and 12 are cold almost everywhere.
- Of the 9 seats hungry 40+ days, 5 farm much colder land than their open land (small `bal-003` seat 1: orchard trees grow 0%
  of the year, its open land 97% at the median; tiny `bal-001` seat 3: fields .14, open land .59), 2 farm at their land's
  median, and 2 (medium `bal-001` seat 2, both road modes) are cold everywhere.

Tried first: weighing warmth into every start site (400 points from frozen to growing all year) cut hungry seat-days by 21% but
crowded the starts on tiny and medium maps (buildings −10%, people −6%); comparing the starts' warmth in the fair-starts band did
nothing, because `evenStarts` makes up for a cold start with soil and ore. Both were dropped for:

- `startOptions.avoidCold`: a start site whose land within 7 steps grows less than 35% of the year loses 400 points for each
  whole share below it (at most 140). On the 9 assess maps cold rival starts go 6 → 3, the closest keeps 10 → 12 steps apart,
  and 5 maps keep the same starts.
- `aiOptions.warmFarms`: farm and orchard sites gain up to 30 (frozen to growing all year) for the growing season of the land
  within 3 steps, against the ranking's cost for distance from the centre.

Six 9-game sweeps (tiny, small, medium, seeds 001 to 003, 80 days, no war, the standard stack), each switch alone and both,
against the same games without them; hungry seat-days / seats hungry 40+ days / buildings at the end / people at the end:

| Roads | without | `coldstart` | `warmfarms` | both |
|---|---|---|---|---|
| default | 594 / 7 / 1873 / 3869 | 587 / 7 / 1982 / 4133 | 493 / 4 / 1767 / 3636 | 482 / 3 / 1860 / 3827 |
| lattice | 553 / 5 / 2801 / 5586 | 448 / 3 / 2928 / 5623 | 531 / 5 / 2935 / 5772 | 427 / 4 / 2955 / 5874 |

- Both together: hungry seat-days 1147 → 909 (−21%), buildings +3%, people +3%.
- `warmfarms` fixes the seats that farmed their cold land (small `bal-003` seat 1 62 → 1 hungry days, medium `bal-003` seat 2
  48 → 14); `coldstart` the seats that started in the tundra (lattice medium `bal-001` seat 2 80 → 4, small `bal-001` seat 1
  77–80 → 24–33). Maps with no cold start play as before.
- Small `bal-003`: `coldstart` swaps seats 2 and 3, so the same tundra site (grows 5% of the year) goes to seat 3, hungry 62 to
  72 days in every run with it. Not looked into; the seats are placed in turn, and the cold penalty (at most 140) is smaller
  than the one for a site too close to another keep.
- Medium `bal-001` seat 3 (its start grows 32% of the year) ends with far fewer buildings in 4 of the 6 runs (167 → 60–118,
  lattice 211 → 53–54). Not looked into.
- Not swept with war.
- What the defaults changed in the test scenarios (fixed seeds): on `amber-fern-212` small the rival's new start lies between
  the sea and the player's border (99 of its tiles within 9 steps of the keep, against 198 before). Slope is not the trouble: by day
  8 seven tiles there still take a launch rail (three after digging), but each sits in a pocket of 2 to 4 tiles that trees, a rock,
  steep ground, water and the border cut off from every road, so it never flies without `reserveRail` (#147; with it, the rail on
  day 3.4 as before; with `widePlacement` instead, day 4); in
  `aibiome`'s mire game the rival grows faster and wins by the Star Wells on day 13, which ended its building (the test now plays
  conquest only); the war test's `amber-fern-212` no longer raids in 40 days (4 of 8 tiny seeds tried do, by day 3 to 6), so it
  plays `copper-wren-118`; and the deadlock check in `transport` caught a carrier idle for one tick between trips, so a road now
  counts only when it is jammed on two checks in a row.
- **On by default since #179**, in the default game and on the lattice; `nocoldstart` and `nowarmfarms` play without them.

Probes (read-only, `soak/balance`): `bordclimate.ts` (border size and warmth over the game), `seatclimate.ts` (the ground and weather
each seat starts on), `fieldroom.ts` (open room round the farms and orchards), `farmclimate.ts` (fields against open land), `warmguess.ts` (`growingGuess` against
the weather), `startclimate.ts` (starts with and without `avoidCold`).

#### Launch rails and the lattice under the shipped AI (#179, #181)

The sweeps above play the standard stack, whose AI switches are all off in the game. Runs `ab26` and `ab27` play the switches the
game ships with (no tokens apart from those named; both climate switches on), no war, 80 days, 3 seeds a size, 9 games each.

**Launch rails.** With the shipped switches no seat builds a launch rail in 80 days, with or without the cold-start rule, so
`avoidCold` costs the game no rails. `reserveRail` alone brings none either (and costs tiny and small 7 to 8% of their buildings);
`widePlacement`, alone or with it, gives one medium seat a rail. On the standard stack (which has `wide`) `rail` raises the seats
with a rail on the default roads from 0 / 33 / 44% to 33 / 44 / 56% (tiny / small / medium; one seat is 11%) and costs medium 10% of
its buildings and people at day 60; on the lattice it changes no seat's rail (67% on each size before and after).

**The lattice by default (#181).** `nolattice` replays the old default exactly (every line equal to `ab26-shp`). Per rival seat,
tile-centre roads / lattice:

| | tiny | small | medium |
|---|---|---|---|
| Buildings d60 | 38.6 / 66.4 (+72%) | 49.4 / 66.6 (+35%) | 63.8 / 70.7 (+11%) |
| People d60 | 81.6 / 135 (+66%) | 106 / 135 (+27%) | 143 / 149 (+4%) |
| Hungry seat-days from day 30 | 88% / 86% | 79% / 64% | 67% / 82% |
| Land held d60 | 264 / 242 | 356 / 336 | 771 / 857 |
| Stalled seat-days | 89% / 76% | 85% / 83% | 69% / 70% |
| Probes sent | 0 / 0 | 0 / 0.67 | 0 / 1.33 |

The lattice builds more on every size, but medium seats go hungry on more days (67% to 82%), not looked into. Land held does not
change between day 20 and day 60 in either mode: with the shipped switches the seats stop growing their borders by day 20.

**Lattice by default since #181**: in the game unless it is opened with `?lattice=0`, and in sweeps unless `nolattice`. Saves keep
the roads they were made with, campaign scenarios keep the tile-centre roads, `World` itself is tile-centre when `latticeRoads` is
unset (the tests' games did not change), and colony worlds do not inherit the home world's roads.

## Looking at the map

Eight small helpers in `soak/balance/` bundle and run like the job (`node scripts/bundle-job.mjs /tmp/x.mjs soak/balance/x.ts`):

- `mining.ts <size> <seed> <rivals> <days>`: plays the pilot 6 AI and, at days 5, 10, 15, 20, 30, 40, 60 and 90, prints one
  JSON line per seat: the conditions the AI tests before it opens a mine (fed, toolsmith, picks, stone, sites), the geologist
  signs by kind, the ore under the seat's land, and the state of its mines. Read-only. `BALANCE_EXTRA="tools,ore"` adds the
  experimental switches on top of the pilot 6 ones (also for `minewhy.ts`). With `ore` it also prints the mines the planner
  has built (`had`), the iron signs it remembers and the tiles it would try. Do not run twelve at once: some die in V8.
- `minewhy.ts <size> <seed> <rivals> <seat> <kind> <from> <to>` (kind 2 coal, 3 iron, 4 gold, 5 granite): for one seat and
  each day, whether the builder reached the economy step and whether it gave an order, the rests that hold a family back,
  every sign tile of the kind with the first reason `placeOn` would turn it down (not mountain, no flag spot, no road),
  the orders given by kind, the geologist's flags and surveyable ground, and the unfinished sites with what they wait for.
  Read-only. `BALANCE_TYPE=smelter` gives the reasons for that building on the tiles within 9 of the keep instead.
- `toolsmith.ts <size> <seed> <rivals> <days>`: per seat and day (`BALANCE_EVERY=1` for every day), the toolsmiths and
  smelters (worker, iron, plank, coal and ore held), the stores, the unfinished sites, the AI's thoughts and the ones
  stopped at the sites cap. Read-only.

- `hash.ts <size> <seed> <days>`: plays three default-brain rivals and prints the world checksum at the end of days 1, 2, 4,
  8, 16. Run on two builds, equal lines mean they play identically. With every AI switch off, this branch and `master` at
  `03bbc33` gave equal lines in 6 games (tiny and small, 3 seeds, 16 days). It also reads `BALANCE_AI` (the same tokens as
  `run.ts`, those that are `aiOptions` switches, plus `armed`), `BALANCE_PEACE` (default 999) and plays the AI builder, so it can
  compare two builds on the assess game; it prints the last day as well as the powers of two.
- `latticewhy.ts <size> <seed> <days> [lattice]`: plays the assess game (standard stack, three rivals) on the road lattice with
  `lattice` and on tile-centre roads without. Per seat: where the builder's last 10 days of thoughts stopped and what failed; the own
  tiles where a house, farm or woodcutter fits, with a flag side and a road, and whether `placeConnected` places one within 9 and 16
  steps. Places buildings at the end.
- `flag9.ts <size> <seed> <days> [lattice] [from=<day>]` (#163): plays the assess game and, from day `from` (default 20), watches the
  flags that hold 5 goods or more. At the first flag over the capacity it prints the push that did it with its stack, the flag, its
  roads, carriers and goods, and the last 40 events on the flag (pushes, splices, every change of `reserved`, `dropAt` calls).
- `flagover.ts <size> <seed> <days> [lattice]` (#163): counts the goods a dismissed carrier puts down (`dropCarriedGoodAt`) and those
  after which the flag's goods plus its reserved places exceed the capacity, with the callers, and the road removals by caller.
  One JSON line.
- `centerwatch.ts <size> <seed> <days> [war]` (#167): plays the assess game on the road lattice under `watchCornerIds` (which also
  watches `grid.center`) and prints every place a corner id reaches a tile-only lookup, with callers and counts. Before the fixes
  7 games (tiny and small, 2 seeds, 40 days; tiny and small with war; medium, 30 days) showed reads in `clearForest`, the
  `diagnoseBorder` probe and `Ecology.ignite`/`fuel`/`stepFire` (a kiln lights a corner); after them, 0 places in all 7.
- `roomwhy.ts <size> <seed> <day,day,...> [lattice]` (#164): plays the assess game and at each day counts, per rival seat, the tiles
  inside the border by what holds them (water, building, flag, road, tree, rock, field, steep, free), the road and flag nodes on
  tile centres against corners, and for the free tiles where a house fits (first 8) why a road cannot reach them
  (`diagnoseBorder`'s road questions). Read-only.
- `lost.ts <size> <seed> <days> [lattice]` (#164): wraps `Economy.removeBuilding` and counts every lost building by cause
  (fire, stranding, a demolish command and the AI routine that gave it, a flag removed) with the first day, and the losses per
  seat by day. Read-only.
- `jam.ts <size> <seed> <days> [lattice] [norings] [dump=<day>,...]` (#169): plays the assess game; every 5 days prints per seat the
  goods stuck on flags (waiting 6 game hours or more), the full flags and the buildings, and every 10 days the shape of the flag
  graph (flags, junctions, triangles, 4-cycles). On the dump days it opens each seat with 20 stuck goods or more: why each is
  stuck (carrier promised, no destination, bound for the building at this flag, no route, next flag full, next flag has room), the
  destination building types, the stores (flag fill, goods stored), the goods by type, the flags on corners, and the rings of full
  flags. `norings` plays without `transportOptions.breakRings`. Read-only.
- `netshape.ts <size> <seed> <day>,<day>... [lattice] [norings]` (#169): per rival seat on those days, roads, mean and longest road
  in tiles, carrier load, roads with helpers, flags that carry a building and join 3 roads or more, the roads out of each store's
  flag, and the goods on flags bound for a store. Read-only.
- `keepflag.ts <size> <seed> <day> [lattice] [norings]` (#169): per rival seat, the keep's flag, the roads out of it (length,
  where they lead, the carrier's busy share) and every node beside it (use, feature, owner, whether a road may go there). Read-only.
- `keeproad.ts <size> <seed> <fixDay> <days> [lattice] [norings] [nofix]` (#169): plays the assess game; on `fixDay` each seat
  whose keep flag has fewer than 3 roads gets roads to its nearest unjoined flags until it has 3 (`nofix` plays the same game
  without); every 5 days prints per seat stuck goods, full flags, buildings and the keep flag's roads. A probe that changes the
  game it plays, not a rule.
- `seatwhy.ts <size> <seed> <days> [every=<d>] [seats=<n>,...]` (#169, #175): plays the assess game with the switches of
  `BALANCE_AI` (the sweep tokens, `lattice` and `norings` included) and, per seat and window (5 days by default), prints buildings
  and sites by type, adults and room, idle adults, hungry days, food in the stores and the builder's food cover, food buildings
  standing and building, the keep flag's roads, full flags and stuck goods, and the builder's thoughts: where they stopped, what
  was placed, failed and listed. Its day-60 building counts match the sweep records. Read-only (needs the aiTrace hook).
- `sites.ts <size> <seed> <rivals> <days>`: four samples a day of every unfinished site with no material on site: what is
  missing and whether it is in a warehouse, has a route, a free flag, a claim, or is on its way (and where the oldest good
  lies); the AI's house want and whether any tile within 9 of the keep or a lit lantern would take a house; the goods the
  supply loop re-aims onto a flag. One JSON line; `scripts/balance-sites-probe.mjs <files>` sums games into tables, and
  `scripts/balance-sites.mjs <dir> [--size s]` does the same questions from the flow records of a sweep. Read-only. Two or
  three at once; more die in V8.
- `strand.ts <size> <seed> <rivals> <days> [good id]`: goods lying on the flag of the building they are bound for: the
  redirects that put them there, how long each lay, how it got its destination, the sites that held one and whether they
  finished (`scripts/balance-strand.mjs <files>` sums games). With a good id it replays the game and logs every write to
  that good's fields with the call stack (`STRAND_BUILDING=<id>` does the same for a building's flag, built and builder).
  `BALANCE_EXTRA=none` turns every AI switch off. Read-only; two at a time.
- `slope.ts <size> <seed>`: the share of mountain tiles and of all land by slope against the limits 1.3, 2.2, 2.6 and 3.2.
- `rockmap.ts <seed> <size>`: rock tiles and units within 8, 14, 20 and 30 tiles of each keep at the start.
- `landmap.ts <size> <seed>...`: the land each seat's landmass holds, the keeps on it (player 0's included), and the land
  claimed at the start.
- `freeland.ts <size> <seed> <days>`: plays the pilot 6 AI for some days, then reports where unowned land lies from each
  border (steps to the nearest, free land within 2, 5, 10 and 20 steps, and what it is made of).

## Cost

A 60-day `economy` game takes about 12 to 13 CPU-minutes (tiny 10, small 15; warden 11, builder 12.5, trader 14 minutes),
measured over 36 games on 15 workers. The `economy` suite at 30 seeds is 540 games, so about 110 CPU-hours: a bit over
7 hours on 15 workers. A 2-seed pilot is 36 games, about 8 CPU-hours and 35 to 40 minutes on 15 workers. War and ore games
have not been timed since the harness grew. The engine was sped up (goods lookups, ring cache, the supply loop; the games
are unchanged) by about 1.4 times, and the sweep starts the longest games first so that the slow ones do not run
last on their own. Use `--seeds 5` for a first look.

## Reading the report

Each cell is the median over seeds with the 10th to 90th percentile in brackets. "Goods with no stock" counts
rival-days on which the warehouses held none of a good (goods in transit or in a producer's input stock do
not count), so it points at bottlenecks, not proof of one.
