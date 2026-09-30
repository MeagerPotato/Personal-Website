import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { readRealInput } from '../scripts/journeys/galaxies';
import { AssetStore } from '../src/universe/core/AssetStore';
import { JobQueue } from '../src/universe/core/jobs';
import { buildUniverse } from '../src/universe/data/build';
import type { UniverseManifest } from '../src/universe/data/types';
import { KEY_LIGHT_POSITION } from '../src/universe/design/materials';
import { tuning } from '../src/universe/design/tuning';
import { topSpeed } from '../src/universe/sim/flight';
import { Galaxy } from '../src/universe/world/Galaxy';

// THE LEAN PIN. Every body is lit by its own light (its sun, or the key light round home), and so
// is a ship near it: from the body's docking ring inward, the ship's light (world/Galaxy.ts,
// lightAt) is the body's, and it lets go of the ship by world.shipLightClaimRadii ring radii (a
// little past the body's sphere of influence), where the blend of every sun near enough to pull
// takes over. The blend swings over the top in a binary's gap instead of flipping round, and the
// price is paid near the gap: a ship flying free by one sun's outer planets is lit from off its
// own sun, toward the other one and the key light.
//
// So this pins three things over a whole turn of the binary. On every ring, the ship is lit as
// its body is: 0 degrees apart (until 2026-09-30 the blend lit it on the rings too, and a ship on
// Robotics' ring was lit up to 57 degrees off Robotics' own light, on Days2Meet's 20, on Model
// Rocketry's 11). Where each body lets go, how far the blend leans off the body's own light: what
// a ship passing a planet near the gap sees, and how far its light turns on the way in or out.
// And how fast it turns that way: the most in one frame for a pilot leaving a ring at boost.
// (A system of one sun, in a slot of its own, is too far from any other sun to feel its pull:
// Research's and Hackathons' bodies lean none.) That is decided by content (how wide each family
// is, and so how far its sun's pull reaches), by tuning.world (shipLightFullRadii,
// shipLightFadeRadii, shipLightTiebreak and shipLightClaimRadii) and by how the light turns
// (sim/shipLight.ts): a change that moves any of these fails here, so that whoever makes it looks
// again in flight (docs/PLAN.md §5.4, "the ship's light") before updating the list.

const LOOK_AGAIN =
  "the ship's light near these bodies now leans or turns differently: judge it in flight " +
  '(docs/PLAN.md §5.4) and update this list';

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

/** Every 20 s of a turn, 48 ways out of each ring: within a degree of every 5 s and 96 ways. */
const EXIT_STEP_SEC = 20;
const EXITS = 48;

/**
 * The widest turn of the ship's light in one frame, in degrees, for a pilot leaving each ring
 * straight out at a boosting pilot's top speed (sim/flight.ts, topSpeed), from the ring to 3 ring
 * radii (past where the body lets go), in every direction and over a whole turn of the binary.
 */
function exitTurns(manifest: UniverseManifest): Record<string, number> {
  const galaxy = new Galaxy({
    manifest,
    assets: new AssetStore(),
    jobs: new JobQueue(1000),
    viewer: { position: new Vector3() },
    reducedMotion: false,
  });
  const bodies = manifest.bodies.filter((body) => body.docks !== false && body.dockRadius > 0);
  const turnSec = Math.max(
    EXIT_STEP_SEC,
    ...manifest.bodies.map((body) => (body.kind === 'sun' ? (body.orbit?.periodSec ?? 0) : 0)),
  );
  const perFrame = topSpeed(tuning.flight, true) / tuning.loop.stepHz;
  const worst = new Map<string, number>();
  const at = new Vector3();
  const light = new Vector3();
  const last = new Vector3();
  for (let t = 0; t < turnSec; t += EXIT_STEP_SEC) {
    galaxy.frameUpdate({ elapsed: t, dt: 1 / 60, alpha: 1, simTime: t });
    for (const body of bodies) {
      const centre = galaxy.subject(body.id)?.position;
      if (!centre) throw new Error(`no view of ${body.id}`);
      for (let k = 0; k < EXITS; k += 1) {
        const angle = (k / EXITS) * Math.PI * 2;
        for (let r = body.dockRadius; r <= 3 * body.dockRadius; r += perFrame) {
          at.set(centre.x + Math.cos(angle) * r, 0, centre.z + Math.sin(angle) * r);
          galaxy.lightAt(at, light).sub(at).normalize();
          if (r > body.dockRadius) {
            worst.set(body.id, Math.max(worst.get(body.id) ?? 0, light.angleTo(last)));
          }
          last.copy(light);
        }
      }
    }
  }
  galaxy.dispose();
  return Object.fromEntries([...worst].map(([id, radians]) => [id, (radians * 180) / Math.PI]));
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

  it('turns by at most this many degrees in a frame for a boosting pilot leaving a ring', () => {
    // Where a body lets go, the light turns from the body's own to the blend's, by ANGLE
    // (sim/shipLight.ts, turnToward), so that the turn is spread over the whole way out. The
    // widest is Robotics', on the gap side: from Hardware's light to the gap's key light, 153
    // degrees off it where Robotics lets go (above), 23 degrees in a frame at worst for a pilot
    // leaving at boost (the blend alone turned about 19 there). Blending the two directions as
    // vectors would make it 34. Rings whose light turns by less than 2 degrees are left out.
    const exits = exitTurns(buildUniverse(readRealInput()));
    expect(Object.keys(exits).length).toBeGreaterThanOrEqual(13);
    const turning = Object.fromEntries(
      Object.entries(leaning(exits)).filter(([, degrees]) => degrees >= 2),
    );
    expect(turning, LOOK_AGAIN).toEqual({
      'project/cyberpatriot': 3,
      'project/days2meet': 13,
      'project/model-rocketry': 3,
      'project/robotics': 23,
      'system/hardware': 8,
    });
  });

  it('comes from its own sun and nowhere else where no other sun pulls, claimed or not', () => {
    // CyberPatriot, Software's innermost planet, stays more than twice Hardware's reach from
    // Hardware's sun, past where its pull fades out (shipLightFadeRadii): where CyberPatriot lets
    // go, the blend is Software's light alone. To the rounding of acos near 1.
    expect(real.edge['project/cyberpatriot']).toBeLessThan(1e-4);
  });
});
