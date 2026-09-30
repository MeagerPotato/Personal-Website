import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { readRealInput } from '../scripts/journeys/galaxies';
import { AssetStore } from '../src/universe/core/AssetStore';
import { JobQueue } from '../src/universe/core/jobs';
import { buildUniverse } from '../src/universe/data/build';
import type { UniverseManifest } from '../src/universe/data/types';
import { Galaxy } from '../src/universe/world/Galaxy';

// THE LEAN PIN. A planet is lit by its own sun, and deep in its family so is a ship on its ring.
// But the ship's light (world/Galaxy.ts, lightAt) blends every sun near enough to pull, so that in
// a binary's gap it swings over the top instead of flipping round, and the price is paid near the
// gap: a ship on the ring of one sun's outer planets is lit from a little off its own sun, toward
// the other one and the key light. How far is decided by content (how wide each family is, and so
// how far its sun's pull reaches) and by tuning.world (shipLightFullRadii, shipLightFadeRadii,
// shipLightTiebreak). On 2026-09-30 (the Projects binary, tiebreak 0.2), the worst lean anywhere
// on a ring, over a whole turn of the binary: Robotics 57 degrees (Hardware's outermost planet,
// facing a family more than twice as wide), Days2Meet 20, Model Rocketry 11, Fish Online 1, and
// every other ring none. Robotics' is the one left to judge in flight (docs/PLAN.md §5.4, "the
// ship's light across the gap"): a change that moves any of these fails here, so that whoever
// makes it looks again before updating the list.

const LOOK_AGAIN =
  "the ship's light on these rings now leans differently: judge it in flight (docs/PLAN.md §5.4) " +
  'and update this list';

/** Every 5 s of a turn, 32 points round each ring: within 0.1 degree of sampling finer. */
const STEP_SEC = 5;
const POINTS = 32;

/** The worst angle, in degrees, between a ship's light on each ring and its body's own sun. */
function leans(manifest: UniverseManifest): Record<string, number> {
  const byId = new Map(manifest.bodies.map((body) => [body.id, body]));
  const sunOf = (id: string): string | undefined => {
    for (let at = byId.get(id); at; at = byId.get(at.parent ?? '')) {
      if (at.kind === 'sun') return at.id;
    }
    return undefined;
  };
  const lit = manifest.bodies.flatMap((body) => {
    const sun = sunOf(body.id);
    return sun && sun !== body.id ? [{ body, sun }] : [];
  });
  const galaxy = new Galaxy({
    manifest,
    assets: new AssetStore(),
    jobs: new JobQueue(1000),
    viewer: { position: new Vector3() },
    reducedMotion: false,
  });
  // A binary's suns share one period; one turn of it shows every way its families face.
  const turnSec = Math.max(
    STEP_SEC,
    ...manifest.bodies.map((body) => (body.kind === 'sun' ? (body.orbit?.periodSec ?? 0) : 0)),
  );
  const worst = new Map<string, number>();
  const at = new Vector3();
  const light = new Vector3();
  const own = new Vector3();
  for (let t = 0; t < turnSec; t += STEP_SEC) {
    galaxy.frameUpdate({ elapsed: t, dt: 1 / 60, alpha: 1, simTime: t });
    for (const { body, sun } of lit) {
      const centre = galaxy.subject(body.id)?.position;
      const sunAt = galaxy.subject(sun)?.position;
      if (!centre || !sunAt) throw new Error(`no view of ${body.id} or ${sun}`);
      for (let k = 0; k < POINTS; k += 1) {
        const angle = (k / POINTS) * Math.PI * 2;
        at.set(
          centre.x + Math.cos(angle) * body.dockRadius,
          0,
          centre.z + Math.sin(angle) * body.dockRadius,
        );
        galaxy.lightAt(at, light).sub(at).normalize();
        own.subVectors(sunAt, at).normalize();
        worst.set(body.id, Math.max(worst.get(body.id) ?? 0, light.angleTo(own)));
      }
    }
  }
  galaxy.dispose();
  return Object.fromEntries([...worst].map(([id, radians]) => [id, (radians * 180) / Math.PI]));
}

describe("the ship's light on a planet's ring (the lean pin)", () => {
  const real = leans(buildUniverse(readRealInput()));

  it('leans off its own sun on these rings, by this many degrees at worst', () => {
    const rounded = Object.entries(real).map(([id, degrees]) => [id, Math.round(degrees)] as const);
    expect(Object.fromEntries(rounded.filter(([, degrees]) => degrees > 0)), LOOK_AGAIN).toEqual({
      'project/days2meet': 20,
      'project/fish-online': 1,
      'project/model-rocketry': 11,
      'project/robotics': 57,
    });
  });

  it('comes from its own sun and nowhere else where no other sun pulls', () => {
    // CyberPatriot, Software's innermost planet, stays more than twice Hardware's reach from
    // Hardware's sun, past where its pull fades out (shipLightFadeRadii). To the rounding of acos
    // near 1: a millionth of a degree.
    expect(real['project/cyberpatriot']).toBeLessThan(1e-4);
  });
});
