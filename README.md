# Seedfall

A cosy settlement game in the spirit of Serf City (The Settlers, 1993), on small procedurally
generated planets. Built with three.js; Steam build via Electron later (appid 480 in development).

- Design proposal: `proposal/seedfall.html`
- Roadmap and batch plan: `docs/ROADMAP.md` (one GitHub issue per batch)

## Run

```sh
npm ci
npm run dev          # http://localhost:5173, add #some-seed to pick a world
npm run check        # lint, typecheck, tests, single-file build, headless smoke test
npm run shots        # progress screenshots into artifacts/shots
```

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
multiplayer needs `npm run dev` or the desktop build.

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
| WASD, Q/E, R/F | Move, turn, tilt the camera |

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
