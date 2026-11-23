# Neon Harbor

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/Stalkerindie/makefun-gta6/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/Stalkerindie/makefun-gta6/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Neon Harbor is a 2D top-down open-world crime game. Rook Calloway owes fixer Mara Voss nineteen grand, and the only way out is through her jobs: steal cars, outrun the Harbor Police, and work across Marlowe Bay — a living city with traffic, pedestrians, a day/night cycle, and a wanted system that goes from zero to five stars. Everything is original: the city, the story, the art, and the synthesized WebAudio sound. No network requests, no external assets, no build step.

## The city

Marlowe Bay is a 3200×2400 seeded city: a road grid with named landmarks (Voss Garage, the Marlowe Bay Bank, St. Anselm Hospital, The Gull Cafe, the Docks, the Old Pier), parks, parking lots, and the bay along the south edge. The same seed builds the same city, so every run is fair and every screenshot is repeatable.

## The jobs

Six chained missions for Mara Voss, each with its own briefing and a live objective:

| Job | What you do | Pays |
| --- | --- | --- |
| 1. First Gear | Steal any car, bring it to Voss Garage | $500 |
| 2. The Parcel | Pick up a package at the Docks, deliver it to The Gull Cafe in 90 seconds | $800 |
| 3. Tail the Gull | Follow the teal courier for 15 seconds without losing him | $1,200 |
| 4. Hot Pursuit | Lose a 3-star wanted level | $1,500 |
| 5. The Bank Job | Crack the vault at the Marlowe Bay Bank, then escape | $5,000 |
| 6. The Last Run | Take the gold getaway car to the Old Pier with every cop on you | $10,000 |

Finish all six and the debt is paid — then the city is yours to free-roam.

## What is in the game

- **Driving and stealing** — walk up to any parked or traffic car and take it; the driver bails and runs. Cars slide along buildings instead of wedging into them, leave skid marks at speed, and wreck with an explosion when their health runs out.
- **Wanted system** — stealing, hitting pedestrians, and shooting raise the heat; it cools when you stay quiet and unseen. Police cars chase with line of sight, ram you, and give up when they lose you; foot cops close in and arrest you on foot.
- **Guidance that never leaves you guessing** — a pulsing beacon marks the objective in the world, an arrow hugs the screen edge and points at it (with the distance in metres) when it is off-screen, and the HUD shows the objective text with a live countdown, crack percentage, tail timer, or wanted count.
- **A minimap that earns its space** — roads, the bay, the objective, police, cash pickups, repair toolboxes, the courier and the getaway car, plus a tick showing which way you face.
- **Repair toolboxes** — green crosses appear around the city and patch a busted car (+45) or Rook on foot (+25), so a bad chase is recoverable.
- **Day and night** — the city darkens as time passes, and your headlights throw a beam ahead once it is dark enough.
- **Sound, saves, and records** — engine hum, sirens, gunshots, cash, and mission stings, all synthesized in WebAudio; your cash and progress save to localStorage, and your best haul is kept between visits.
- **Touch play** — on phones and tablets a virtual joystick steers and throttles (analog, so a little push means a little speed), with buttons to enter a car, shoot (hold for autofire), pause, and confirm.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser. Or serve `game/` with any static server:

```sh
python3 -m http.server --directory game 8080
```

The live game is at https://stalkerindie.github.io/makefun-gta6/

## Controls

| Keys | Does |
| --- | --- |
| WASD / arrows | Move on foot, drive in a car |
| E | Steal or leave a car |
| Space (hold) / click | Shoot — hold Space to keep firing |
| P | Pause |

On touch devices the joystick moves and steers, and the buttons do the rest.

## Tests

A headless simulation test lives in `tests/sim.mjs` (Node 22, no browser needed). It boots the real world, plays mission 1 through with an autopilot, hammers the world with random inputs, and checks that nothing crashes, nothing goes NaN, and the numbers stay in range:

```sh
node tests/sim.mjs
```

## How it is built

Plain static files under `game/` — `index.html` plus ES modules, no libraries and no framework. `main.ts` (Node 22, standard library only) stages `game/` and `screenshots/` into the output directory and writes `dossier.json` through the vendored make.fun library in `vendor/`. The entry point for the game is `game/index.html`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=6hamgm5y&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
