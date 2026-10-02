# Seedfall on Steam

The desktop build is the web game inside an Electron window, with Steamworks through
[steamworks.js](https://github.com/ceifa/steamworks.js). It lives in `desktop/` and has its own
`package.json`; the web build and CI never install it.

## What Steam adds

| Feature | How |
|---|---|
| **Multiplayer** | Friends-only Steam lobbies and Steam P2P networking. It's a `Transport` beside WebRTC (`src/net/steamTransport.ts`, `src/net/steamLobby.ts`), so there are no signalling servers, invite codes, ports or NAT to deal with. Invites work from the overlay (Shift+Tab) and the friends list, and so does `+connect_lobby`. |
| **Overlay** | Enabled for Electron (`electronEnableSteamOverlay`). |
| **Rich presence** | Friends see the seed, the game day and the settlement's size (`src/platform/steam.ts`). |
| **Achievements** | Unlocked by milestones in play (`src/platform/achievements.ts`). The ids must exist in the Steamworks partner site, and the web build toasts them instead. |
| **Steam Cloud** | Saves are mirrored to Steam Cloud and appear on any machine (`src/platform/cloudSaves.ts`). |
| **Controller** | The game reads gamepads directly (`src/ui/gamepad.ts`), so Steam Input's gamepad template works on the Deck and every pad. |
| **Workshop** | Scenarios, painted worlds and mods are shared as one `creation.json` per Workshop item (`desktop/main.cjs`: `steam:workshopUpload`, `steam:workshopItems`). Game menu → Create → Share uploads; "Get my subscriptions" adds subscribed items to the library. The app needs the Workshop enabled in Steamworks (with a `scenario`, `world` and `mod` tag). |
| **Steam Deck** | Starts fullscreen with the Deck preset: a larger UI, a 40 fps cap, and medium-light graphics. |

## Running it in development

1. Install and start the Steam client and sign in. App id 480 (Spacewar) is used for development:
   `desktop/steam_appid.txt`.
2. In the repository root, run `npm run build:single` (the game as one HTML file).
3. In `desktop/`, run `npm install`, copy the game in with `mkdir -p app && cp ../dist-single/index.html app/`,
   then `npm start`.

Without Steam the window still opens and the game plays as the web build does. The log says
"Steam is not available".

`npm run smoke` in `desktop/` starts the shell headless (xvfb on Linux), waits for the world,
checks the bridge and exits. It needs no Steam client.

## Building depots

```
cd desktop
npm install
npm run build -- --platforms=linux,win32        # add --dev for a steam_appid.txt beside the exe
```

This produces `desktop/dist/depot-linux/` and `desktop/dist/depot-win32/`: the Electron app
with the game and steamworks.js (its native modules stay outside the asar).

## Uploading with steamcmd

1. In the Steamworks partner site, create the app and two depots (Linux and Windows), then put
   their ids into `desktop/steam/app_build.vdf` and the `depot_build_*.vdf` files. The files use
   480/481/482 as placeholders.
2. Configure there too:
   - **Achievements:** the ids from `src/platform/achievements.ts`.
   - **Rich presence:** `desktop/steam/rich_presence_english.vdf`.
   - **Steam Cloud:** byte quota about 50 MB, 200 files.
   - **Launch options:** `seedfall` on Linux and `seedfall.exe` on Windows.
3. Build the depots (above), then run:

   ```
   steamcmd +login <build-account> +run_app_build "$(pwd)/steam/app_build.vdf" +quit
   ```

4. Set the build live on a branch in the partner site. Test with the Steam client (Deck: Deck
   Verified checklist: controller, text input through the on-screen keyboard, 1280×800).

## Not in CI

CI has no Steam client, so the Steam paths run against a fake Steam in `tests/steam.test.ts`
(lobbies, P2P, lockstep over Steam). The web build never loads Electron or steamworks.js: the
game only talks to `window.seedfallDesktop` when it is there.
