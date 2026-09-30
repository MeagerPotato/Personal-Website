import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { readRealInput } from '../scripts/journeys/galaxies';
import { AssetStore } from '../src/universe/core/AssetStore';
import { JobQueue } from '../src/universe/core/jobs';
import { buildUniverse } from '../src/universe/data/build';
import type { UniverseManifest } from '../src/universe/data/types';
import { KEY_LIGHT_POSITION } from '../src/universe/design/materials';
import { tuning } from '../src/universe/design/tuning';
import { Galaxy } from '../src/universe/world/Galaxy';

// THE LEAN PIN. Every body is lit by its own light (its sun, or the key light round home), and so
// is a ship near it: from the body's docking ring inward, the ship's light (world/Galaxy.ts,
// lightAt) is the body's, and it lets go of the ship by world.shipLightClaimRadii ring radii (a
// little past the body's sphere of influence), where the blend of every sun near enough to pull
// takes over. The blend swings over the top in a binary's gap instead of flipping round, and the
// price is paid near the gap: a ship flying free by one sun's outer planets is lit from off its
// own sun, toward the other one and the key light.
//
// So this pins two things over a whole turn of the binary. On every ring, the ship is lit as its
// body is: 0 degrees apart (until 2026-09-30 the blend lit it on the rings too, and a ship on
// Robotics' ring was lit up to 57 degrees off Robotics' own light, on Days2Meet's 20, on Model
// Rocketry's 11). And where each body lets go, how far the blend leans off the body's own light:
// what a ship passing a planet near the gap sees, and how far its light turns on the way in or
// out. (A system of one sun, in a slot of its own, is too far from any other sun to feel its
// pull: Research's and Hackathons' bodies lean none.) That is decided by content (how wide each
// family is, and so how far its sun's pull reaches) and by tuning.world (shipLightFullRadii, shipLightFadeRadii, shipLightTiebreak and
// shipLightClaimRadii): a change that moves any of these fails here, so that whoever makes it
// looks again in flight (docs/PLAN.md §5.4, "the ship's light") before updating the list.

const LOOK_AGAIN =
  "the ship's light near these bodies now leans differently: judge it in flight (docs/PLAN.md §5.4) " +
  'and update this list';

/** Every 5 s of a turn, 32 points round each ring: within 0.1 degree of sampling finer. */
const STEP_SEC = 5;
const POINTS = 32;

interface Leans {
  /** On the ring. */
  ring: Record<string, number>;
  /** Where the body's light lets go of the ship (world.shipLightClaimRadii ring radii). */
  edge: Record<string, number>;
}

/** The worst angle, in degrees, between a ship's light and its body's own light, by body. */
function leans(manifest: UniverseManifest): Leans {
  const byId = new Map(manifest.bodies.map((body) => [body.id, body]));
  /** What lights a body: the first sun up its chain of parents, or null for the key light. */
  const lightOf = (id: string): string | null => {
    for (let at = byId.get(id); at; at = byId.get(at.parent ?? '')) {
      if (at.kind === 'sun') return at.id;
    }
    return null;
  };
  // Every body a ship can circle (a relay cannot): a sun lights itself, home the key light.
  const lit = manifest.bodies
    .filter((body) => body.docks !== false && body.dockRadius > 0)
    .map((body) => ({ body, light: lightOf(body.id) }));
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
  const worst = { ring: new Map<string, number>(), edge: new Map<string, number>() };
  const at = new Vector3();
  const light = new Vector3();
  const own = new Vector3();
  for (let t = 0; t < turnSec; t += STEP_SEC) {
    galaxy.frameUpdate({ elapsed: t, dt: 1 / 60, alpha: 1, simTime: t });
    for (const { body, light: source } of lit) {
      const centre = galaxy.subject(body.id)?.position;
      const from = source === null ? KEY_LIGHT_POSITION : galaxy.subject(source)?.position;
      if (!centre || !from)
        throw new Error(`no view of ${body.id} or ${source ?? 'the key light'}`);
      for (const [where, radius] of [
        ['ring', body.dockRadius],
        ['edge', body.dockRadius * tuning.world.shipLightClaimRadii],
      ] as const) {
        for (let k = 0; k < POINTS; k += 1) {
          const angle = (k / POINTS) * Math.PI * 2;
          at.set(centre.x + Math.cos(angle) * radius, 0, centre.z + Math.sin(angle) * radius);
          galaxy.lightAt(at, light).sub(at).normalize();
          own.subVectors(from, at).normalize();
          const seen = worst[where];
          seen.set(body.id, Math.max(seen.get(body.id) ?? 0, light.angleTo(own)));
        }
      }
    }
  }
  galaxy.dispose();
  const degrees = (seen: Map<string, number>): Record<string, number> =>
    Object.fromEntries([...seen].map(([id, radians]) => [id, (radians * 180) / Math.PI]));
  return { ring: degrees(worst.ring), edge: degrees(worst.edge) };
}

/** Rounded to whole degrees, and only those that lean by one or more. */
const leaning = (seen: Record<string, number>): Record<string, number> =>
  Object.fromEntries(
    Object.entries(seen)
      .map(([id, degrees]) => [id, Math.round(degrees)] as const)
      .filter(([, degrees]) => degrees > 0),
  );

describe("the ship's light near a body (the lean pin)", () => {
  const real = leans(buildUniverse(readRealInput()));

  it('is the body’s own light on every ring, home and suns included', () => {
    // Every ring there is: home's three, the two suns and their eight planets and moons.
    expect(Object.keys(real.ring).length).toBeGreaterThanOrEqual(13);
    expect(leaning(real.ring), LOOK_AGAIN).toEqual({});
    // Not merely under half a degree: the same light, to the rounding of acos near 1.
    for (const [id, degrees] of Object.entries(real.ring)) expect(degrees, id).toBeLessThan(1e-4);
  });

  it('leans off the body’s own light where the body lets go, by this many degrees at worst', () => {
    // Robotics is Hardware's outermost planet, and where it lets go (two rings out) on the gap
    // side, the two suns' pulls all but cancel and the key light, from above, is what is left:
    // leaving it that way, the ship's light turns from Hardware's to the key light's within 15 u.
    expect(leaning(real.edge), LOOK_AGAIN).toEqual({
      'page/about': 1,
      'page/contact': 2,
      'page/resume': 1,
      'project/days2meet': 46,
      'project/fish-online': 2,
      'project/fishai': 1,
      'project/model-rocketry': 21,
      'project/robotics': 153,
      'system/hardware': 11,
    });
  });

  it('comes from its own sun and nowhere else where no other sun pulls, claimed or not', () => {
    // CyberPatriot, Software's innermost planet, stays more than twice Hardware's reach from
    // Hardware's sun, past where its pull fades out (shipLightFadeRadii): where CyberPatriot lets
    // go, the blend is Software's light alone. To the rounding of acos near 1.
    expect(real.edge['project/cyberpatriot']).toBeLessThan(1e-4);
  });
});
