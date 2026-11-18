# Neon Shores

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/Bonser386/neon-shores/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/Bonser386/neon-shores/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Neon Shores** is an open-world crime game in the spirit of GTA 6, played in a desktop browser. You are Rico Vega, broke and fresh out, in Solmar — a coastal city of downtown towers, a palm-lined beach boardwalk, a container port and quiet suburbs, all under a neon dusk sky. Steal cars, run jobs, and stay ahead of the Solmar PD.

## What is in the game

- **A city to explore on foot and by car** — an 8×8 road grid with traffic that follows the streets, pedestrians on the sidewalks, parked cars at the curb, and five districts that look and feel different.
- **Cars to steal and drive** — walk up to a car, press E, and drive off with a chase camera and arcade handling. Traffic keeps flowing around you. The fastest ride in town is the cyan Vortex GT sports car, parked near the start — low, spoilered, with a neon underglow.
- **A wanted level (1–5 stars) and police who respond** — stealing, hitting pedestrians and shooting raise the heat. Patrol cars chase and ram, officers on foot shoot and try to bust you. The hotter the wanted level, the faster and sharper the pursuit gets — at five stars a patrol car outruns a normal stolen car. Lay low and the stars cool off one by one.
- **Missions and a story** — seven jobs with a beacon, an objective line and a payout: steal a car and reach the boardwalk pickup, deliver a gold coupe to the chop shop, lose a three-star chase, run five cash drops, escape a four-star chase to a beach safehouse, courier a package to the port warehouse in a car, and a final delivery to the docks under pursuit.
- **Combat** — fists and a pistol with a magazine and reload; police shoot back; health regrows after a quiet spell.
- **A HUD with a minimap** — money, wanted stars, health, ammo, speed, the clock, the objective and a live top-down map with the player arrow, the mission marker, police dots and traffic.
- **Menus and saving** — a title screen with the story and controls, pause, busted and wasted screens, and progress (money and jobs done) saved in localStorage.
- **Feel and polish** — dusk lighting with long shadows, neon signs glowing off the downtown towers and gateway arches spanning the streets, streetlight halos, car headlights that actually light the road, tyre smoke, impact sparks, muzzle flash and screen shake, and every sound synthesized live with WebAudio (engine, sirens, shots, pickups). No audio files, no images, no network requests at all.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser. Keyboard and mouse: WASD to move/drive, mouse drag to look, Shift to run, E to steal/exit a car, F to punch, click to shoot, R to reload, Esc to pause, M to mute.

## How it is built

Plain static files under `game/`, no build step. Three.js (r160) is vendored as `game/vendor/three.module.min.js` and loaded through one import map. The game's own source is split into one file per job under `game/src/`: `city.js` (city generation and the road graph), `player.js` (on-foot controls and combat), `vehicles.js` (car physics and traffic AI), `pedestrians.js`, `police.js` (wanted level and pursuit), `missions.js` (the seven-job story), `hud.js` (HUD and minimap), `audio.js` (synthesized sounds), `effects.js` (particles, screen shake, glow and neon signs), `shots.js` (the four deterministic screenshot scenes), `config.js` and `random.js` (seeded RNG). `main.ts` hands the game in; `screenshots/` holds four renders of the game itself.

Everything in this game — the city, the characters, the cars, the story and the sounds — is original, made for this bounty. Nothing is taken from any commercial game.

---

<sub>Entered on [make.fun](https://make.fun/?ref=7dkxfn6v&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
