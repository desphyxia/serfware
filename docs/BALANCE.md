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

## Cost

About 2 seconds of CPU per game day on a tiny or small world, so one 60-day game is about 2 minutes and a
200-day war several minutes. The `economy` suite at 30 seeds is 540 games (about 18 CPU-hours); on 8 cores
that is a bit over 2 hours. Use `--seeds 5` for a first look.

## Reading the report

Each cell is the median over seeds with the 10th to 90th percentile in brackets. "Goods with no stock" counts
rival-days on which the warehouses held none of a good (goods in transit or in a producer's input stock do
not count), so it points at bottlenecks, not proof of one.
