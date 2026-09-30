import { describe, expect, it } from 'vitest';
import { readRealInput } from '../scripts/journeys/galaxies';
import { buildUniverse } from '../src/universe/data/build';
import { tuning } from '../src/universe/design/tuning';
import { familyReaches } from '../src/universe/sim/families';
import { createOrbitTable } from '../src/universe/sim/orbits';

// THE REGIME PIN. The autopilot goes round a family (a body and everything circling it) as ONE
// disc when the whole family, keep-outs included, reaches no further than tuning.cruise.familyReach
// from its body, and round its bodies one by one otherwise (sim/autopilot.ts, planCruise). Which
// of the two a family gets changes every journey past it, and content decides it. On 2026-09-30
// (the Projects binary) the families reach, keep-outs in: Software 271.8 u, Hardware 117.8,
// Canadian Fish with its moons 77.0, the home planet with the station and the satellite 70.2.
// Hardware stands 2.2 u under the line of 120: one more moon there flips it. The journey times
// the gate measured (npm run journeys) were measured in THIS regime, so a content change that
// flips a family fails here, and whoever makes it re-runs the journeys before updating the lists.

const RERUN =
  'run npm run journeys (the planner now goes round this family differently), and update this list';

/** Every body something circles, with how far its family reaches as the planner counts it. */
function families(): Array<{ id: string; reach: number }> {
  const manifest = buildUniverse(readRealInput());
  const orbits = createOrbitTable(manifest.systems, manifest.bodies);
  const rings = new Float64Array(orbits.count);
  for (const body of manifest.bodies) rings[orbits.indexOf(body.id)] = body.dockRadius;
  const reach = familyReaches(orbits, rings, tuning.cruise.keepOut, new Float64Array(orbits.count));
  const parents = new Set(manifest.bodies.map((body) => body.parent));
  return manifest.bodies
    .filter((body) => parents.has(body.id))
    .map((body) => ({ id: body.id, reach: reach[orbits.indexOf(body.id)] ?? 0 }));
}

describe('the families the autopilot goes round whole (the regime pin)', () => {
  const all = families();
  const whole = all.filter((family) => family.reach <= tuning.cruise.familyReach);
  const byBody = all.filter((family) => family.reach > tuning.cruise.familyReach);

  it('goes round these as one disc', () => {
    expect(
      whole.map(({ id }) => id),
      RERUN,
    ).toEqual(['page/about', 'project/canadian-fish-demo', 'system/hardware']);
  });

  it('goes round the bodies of these one by one', () => {
    expect(
      byBody.map(({ id }) => id),
      RERUN,
    ).toEqual(['system/software']);
  });
});
