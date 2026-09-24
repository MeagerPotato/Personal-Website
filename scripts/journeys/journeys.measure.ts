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
// runs every default: the real galaxy from src/content, and 4, 6 and 8 systems (the real ones
// plus typical future ones in the free slots, laid out by the real layout code). Options come from
// JOURNEYS, JSON or the path of a JSON file (see scripts/journeys/example.json):
//
//   PowerShell  $env:JOURNEYS = '{"galaxies":["real",4],"layout":{"minSystemGap":100}}'; npm run journeys
//   bash        JOURNEYS=scripts/journeys/example.json npm run journeys
//
//   galaxies       ["real", 4, 6, 8]: "real", or a number of systems, home included
//   layout         merged into tuning.layout for the build: clusterAxisDeg, maxSystemRadius,
//                  minSystemGap, planetRadius, orbitGap...
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
