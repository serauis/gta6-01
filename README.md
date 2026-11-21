# PALMIRA HEAT — an open-world crime game

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/serauis/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard)
[![reward](https://make.fun/badge/gta6-01/serauis/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01)

An entry for make.fun's [gta6-01](https://make.fun/bounty/gta6-01) bounty.

**PALMIRA HEAT** is an original top-down 2.5D open-world crime game, written
from scratch with zero libraries — every sprite is drawn in code on a 2D
canvas and every sound is synthesized with WebAudio.

You are Rico Vega, back in the coastal city of Palmira and working to earn
back the family beach garage. Roam the city on foot or behind the wheel,
run a five-mission story chain (timed delivery, car theft, a hot pickup at
two stars, taxi fares, and a bank job with a three-star escape), and dodge
— or outrun — a police wanted system that escalates from a single cruiser
to five-star chases with gunfire. Between missions there is free-roam work:
taxi fares, ten hidden packages, a pay'n'spray that clears your heat and
repairs your ride, pistol combat, busted/wasted respawns, and a money
progression saved locally so you can continue the story later.

The world stays alive around you: AI traffic, pedestrians, a full HUD with
minimap (roads, packages, police blips, objective marker, player arrow),
an objective beacon, and a day cycle that fades into dusk with lamp glow
and headlights.

## How to play

Open `game/index.html` in a browser — no build step, no network needed.

- **WASD / arrow keys** — walk or drive
- **E** — enter / exit a car (any car can be taken)
- **Shift** — handbrake (drift)
- **Space** — fire pistol (on foot)
- **M** — mute
- **P / Esc** — pause

`main.ts` is the make.fun harness entry: it copies `game/` and
`screenshots/` to the output directory and writes the dossier.
