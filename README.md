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

## Keys

| Key | Action |
|-----|--------|
| Esc | Settings |
| F3 or ` | Debug dialog |
| F8 | Report a bug (copyable report) |
| Space | Pause / resume |

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
