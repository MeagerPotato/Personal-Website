import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { measure, optionsFromEnv } from './measure';

// HOW LONG A JOURNEY TAKES: from pointing at a body (or a nav link) until the ship is docked
// there and its page opens, flown headless by the real simulation (fly.ts says exactly how).
// Slow on purpose (thousands of journeys), so it is NOT part of `npm test`:
//
//   npm run journeys
//
// runs every default in about 30 s (a minute with "stop"): the real galaxy from src/content, and
// 4, 6 and 8 systems (the real ones plus typical future ones in the free slots, laid out by the
// real layout code). Options come from
// JOURNEYS, JSON or the path of a JSON file (see scripts/journeys/example.json):
//
//   PowerShell  $env:JOURNEYS = '{"galaxies":["real",4],"layout":{"slotRoom":860,"maxSystemRadius":350}}'; npm run journeys
//   bash        JOURNEYS=scripts/journeys/example.json npm run journeys
//
//   galaxies       ["real", 4, 6, 8]: "real", or a number of systems, home included
//   layout         merged into tuning.layout for the build: homeRoom, slotRoom, clusterAxisDeg
//                  (where the systems are), maxSystemRadius, planetRadius, orbitGap...
//   slotExponent   the OLD sunflower spiral instead of the honeycomb: slot k 1000 * k^slotExponent
//                  out (0.5 is the spiral the site used), to compare against
//   positions      { "code": [x, z] }: hand-placed systems, as content can do
//   tuning         merged over tuning.ts for the flight: flight, cruise (near, far, longLeg,
//                  keepOutSpeed...), assist, cushion, edge, dock, and spawn (tuning.ship.spawn)
//   name           what to call that setup in the tables
//   variants       [{ "name", "layout", "slotExponent", "positions", "tuning" }, ...] to compare
//                  several setups in one run, like for like (the same start conditions)
//   sample         { "between": "all" | n, "within": "all" | n, "spawn": true,
//                    "starts": n | { "real": 6, "grown": 1 } }
//   limitSec       60: not docked by then is a failure
//   stop           true or { "coastSec": 10 }: also fly every journey between systems again and
//                  press Stop at its fastest moment, then watch it brake: how far it slides,
//                  how close it comes to anything, whether it touches a shell
//   stress         true or { "journeys": 60, "modes": [...], "kinds": ["between"], "coastSec": 10 }:
//                  a VISITOR WHO CHANGES THEIR MIND (stress.ts). A seeded sample of journeys
//                  (between systems; "kinds" may add "within" and "spawn"), each flown again and
//                  again with one thing done to it: "redirect" (another body every 0.1 s and just
//                  before it arrives), "stop" (every 0.25 s, at its fastest, 1 to 20 steps before it
//                  arrives), "reach" (a body it races past, within reach, every 0.1 s there is one),
//                  "stopDock" (Stop, then E at the first body offered), "tap" (the brake, an arrow
//                  or the throttle for 67 to 133 ms instead of Stop, and an arrow or the throttle
//                  in the first second of the orbit), "doubleTap" (two presses, 2 to 30 steps
//                  apart, the second while the ship is still fast), "undock" (the web layer lets
//                  go: a page with no body; also in the first second of the orbit), "reachBack"
//                  (a body raced past, then back), "chain" (4 to 8 bodies in a row, 0.03 to
//                  0.43 s apart), "rebuild" (the engine rebuilt from its snapshot, as after a lost
//                  WebGL context), "reload" (a full page load with no body: the journey is not
//                  taken up, and the ship must come to rest).
//                  Every flight must dock where it was sent (or come to rest) without touching a
//                  shell or passing closer than half a cushion to anything: 0 failures is the gate
//                  for a change to the autopilot, the approach, Stop, the guard or the snapshot.
//                  With every kind and Stop: 2, 3.5, 7 and 11 minutes for 2, 4, 6 and 8 systems,
//                  so run a galaxy per process ("galaxies": [8]) to have all four in 11.
//   seed, includeDrafts, rows (print every journey), out (write every journey as JSON)
//
// JOURNEYS_OUT=<file.json> also writes every journey. A formula that JSON cannot say goes in a
// *.measure.ts of its own beside this one: import { measure } from './measure' and pass
// variants: [{ name, slot: (order, id, spiral) => [x, z] }].

it('measures how long journeys take', () => {
  const { options, out } = optionsFromEnv();
  const reports = measure(options);
  if (out !== null) {
    const path = resolve(out);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ options, reports }, null, 1));
    console.log(`\nevery journey: ${path}`);
  }
  expect(reports.length).toBeGreaterThan(0);
});
