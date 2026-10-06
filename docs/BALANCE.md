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

## Looking at the map

Three small helpers in `soak/balance/` bundle and run like the job (`node scripts/bundle-job.mjs /tmp/x.mjs soak/balance/x.ts`):

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
