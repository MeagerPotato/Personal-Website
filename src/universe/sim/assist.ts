import { maxYawRate, speedOf } from './flight';
import { angleDelta, angleOf, clamp, smoothstep } from './math';
import type { FlightInput, FlightParams, ShipState } from './types';

/** An approach gives way to another body out to this many of its ring radii (see orbitWish). */
const GIVE_WAY = 1.25;
/**
 * A pilot who asked to be on the ring and goes more than this many times as fast as it wants to
 * (an approach begun while the autopilot raced past) brakes the rest off as the autopilot would
 * (WishPace.brakeGain, not the assist's gentle speedGain), but no harder than FAR_DECEL u/s²: a
 * firm stop, not a wall. Past the reflex's limit it brakes as hard as it takes. (Firmer than the
 * autopilot's cruise.comfortDecel: an approach has no plan that began slowing it early. Held to
 * 700, a moon asked for at 440 u/s from 2 u inside its reach was passed 1.1 u above the sun
 * beyond it; at 1,000, 2.7 u.)
 */
const FAR_ABOVE = 2;
const FAR_DECEL = 1000;

/**
 * ORBIT ASSIST: let go of the controls near a planet and the ship eases onto a ring around it
 * and keeps circling, so a planet is a place to arrive at and not a thing to fly past.
 *
 * It is NOT gravity. Inverse-square gravity slingshots a ship that comes in fast and feels grabby
 * to one that comes in slowly. This is what a drone does when told to loiter: a VECTOR FIELD
 * around the ring says which way to travel from anywhere (along the ring when on it, tilted
 * toward it when off it), and a VIRTUAL PILOT flies the ordinary flight model along that field
 * with the same stick and throttle a person has. The ship in this universe goes where its nose
 * points (sim/flight.ts), so pushing it sideways would only fight its own grip; steering it is
 * the honest way. Docking (Phase 2) is this same pilot with full authority.
 *
 * The real pilot always wins. Thrust fades the assist out, the stick replaces its steering, the
 * brake switches it off, and a ship that passes by fast is left alone.
 *
 * Pure and allocation-free, like the rest of sim/.
 */

/** The solid things of the world at one instant. Row i is body i of the orbit table. */
export interface BodyField {
  readonly count: number;
  /** [x0, z0, x1, z1, ...] in world units. */
  readonly positions: Float64Array;
  /** The same layout, in units per second. */
  readonly velocities: Float64Array;
  /** How big each body is. */
  readonly radius: Float64Array;
  /** The ring a ship circles each body on, measured from its centre (the manifest's dockRadius). */
  readonly ringRadius: Float64Array;
}

export interface AssistParams {
  /** Pace on the ring, u/s ... */
  readonly orbitSpeed: number;
  /** ... but never more than this many radians per second, so a small moon is circled calmly. */
  readonly orbitMaxRate: number;
  /** The assist starts this many ring radii from the centre, and is at full strength inside fullRadii. */
  readonly soiRadii: number;
  readonly fullRadii: number;
  /** How steeply the field leans back toward the ring (1 = 45 degrees) ... */
  readonly inwardGain: number;
  /** ... reached this share of a ring radius away from it. */
  readonly inwardReach: number;
  /** The share of the assist that a pilot at full thrust switches off. */
  readonly thrustFade: number;
  /** A ship passing faster than this (relative to the body, u/s) is left alone: fades between the two. */
  readonly freeSpeeds: readonly [from: number, to: number];
  /** Full stick per radian of heading error. */
  readonly steerGain: number;
  /** 1/s: how hard the virtual pilot chases the pace it wants. */
  readonly speedGain: number;
  /** How much stronger another body must pull before the assist changes its mind. */
  readonly switchMargin: number;
  /** The pilot has to fly the other way round at this speed (u/s) before the assist follows suit. */
  readonly spinFlipSpeed: number;
  /**
   * DIVING AT A SURFACE: the assist takes the stick and swings the nose along the surface, so the
   * ship sweeps round a planet instead of ramming it. It goes by TIME TO IMPACT, so a fast ship
   * is turned early and a slow one late: not at all with `deflectSec[1]` seconds to spare, fully
   * at `deflectSec[0]`. "Impact" is `deflectGap` units above the surface, and ships closing
   * slower than `deflectSpeed` u/s are left to land on the cushion.
   */
  readonly deflectSec: readonly [full: number, none: number];
  readonly deflectGap: number;
  readonly deflectSpeed: number;
}

export interface AssistState {
  /** Row of the body whose ring the ship is being eased onto, or -1. */
  body: number;
  /** Which way round: +1 counter-clockwise seen from above, -1 clockwise, 0 not chosen yet. */
  spin: number;
  /** 0 to 1: how much of the flying the assist did in the last step. For the HUD and for tests. */
  weight: number;
}

export function createAssistState(): AssistState {
  return { body: -1, spin: 0, weight: 0 };
}

/** How strongly body `i` claims a ship at (x, z): 1 near its ring, 0 outside its sphere of influence. */
export function pullOf(
  field: BodyField,
  i: number,
  x: number,
  z: number,
  params: AssistParams,
): number {
  const ring = field.ringRadius[i] ?? 0;
  if (!(ring > 0)) return 0;
  const d = Math.hypot(x - (field.positions[i * 2] ?? 0), z - (field.positions[i * 2 + 1] ?? 0));
  return 1 - smoothstep(params.fullRadii * ring, params.soiRadii * ring, d);
}

/** 0 to 1: how urgently the ship must be steered off body `i`'s surface. */
export function deflectOf(
  field: BodyField,
  i: number,
  state: Readonly<ShipState>,
  params: AssistParams,
): number {
  const surface = field.radius[i] ?? 0;
  if (!(surface > 0)) return 0;
  const rx = state.x - (field.positions[i * 2] ?? 0);
  const rz = state.z - (field.positions[i * 2 + 1] ?? 0);
  const d = Math.hypot(rx, rz);
  if (d < 1e-9) return 1;
  // Closing speed: how fast the gap shrinks, in the body's own frame.
  const closing =
    -(
      (state.vx - (field.velocities[i * 2] ?? 0)) * rx +
      (state.vz - (field.velocities[i * 2 + 1] ?? 0)) * rz
    ) / d;
  if (closing <= 0) return 0;
  const secondsLeft = (d - surface - params.deflectGap) / closing;
  return (
    (1 - smoothstep(params.deflectSec[0], params.deflectSec[1], secondsLeft)) *
    smoothstep(0, params.deflectSpeed, closing)
  );
}

/**
 * Decide whose ring the ship belongs to. The strongest claim wins, but the body that already has
 * the ship keeps it until another pulls clearly harder: a station sweeping past a ship that is
 * circling its planet must not steal it. A surface the ship is diving at outranks any ring.
 */
export function chooseBody(
  field: BodyField,
  state: Readonly<ShipState>,
  assist: AssistState,
  params: AssistParams,
): number {
  let best = -1;
  let bestClaim = 0;
  let currentClaim = 0;
  for (let i = 0; i < field.count; i += 1) {
    const claim =
      pullOf(field, i, state.x, state.z, params) + 2 * deflectOf(field, i, state, params);
    if (i === assist.body) currentClaim = claim;
    if (claim > bestClaim) {
      best = i;
      bestClaim = claim;
    }
  }
  const keep =
    assist.body >= 0 && currentClaim > 0 && bestClaim <= currentClaim + params.switchMargin;
  if (!keep && best !== assist.body) {
    assist.body = best;
    assist.spin = 0;
  }
  return assist.body;
}

/**
 * The pace of a pilot who ASKED to be on the ring (sim/docking.ts), instead of the loose assist's
 * `orbitSpeed` and `orbitMaxRate`: they want to be there, not to drift there.
 */
export interface WishPace {
  /** u/s along the ring ... */
  readonly speed: number;
  /** ... but never more than this many radians per second round the body. */
  readonly maxRate: number;
  /** u/s faster for every unit still off the ring, up to `speed`. */
  readonly hurry: number;
  /**
   * 1/s: how hard it brakes when it goes faster than it wants to (the loose assist's speedGain is
   * gentle: a pilot who asked to be on the ring at 30 u/s and passes it at 200 wants that gone).
   */
  readonly brakeGain: number;
  /** u/s: never faster than this, whatever the ring wants (the reflex, sim/reflex.ts). */
  readonly limit: number;
}

/**
 * What a pilot who wants to circle body `i` would do with the controls right now, written into
 * `out`. Chooses which way round when `assist.spin` is still 0, and follows a pilot who has
 * clearly turned round.
 *
 * `pace` is for a pilot who ASKED to be there (sim/docking.ts): its own pace, a hurry (the further
 * from the ring, the faster the way back to it), and the brake when the ship is too fast for it.
 * It also gives way: see GIVE_WAY below. The loose assist never hurries, and never brakes: that
 * is the pilot's to do.
 */
export function orbitWish(
  field: BodyField,
  i: number,
  state: Readonly<ShipState>,
  flight: FlightParams,
  params: AssistParams,
  assist: AssistState,
  out: FlightInput,
  pace: Readonly<WishPace> | null = null,
): FlightInput {
  const bodyVx = field.velocities[i * 2] ?? 0;
  const bodyVz = field.velocities[i * 2 + 1] ?? 0;
  const ring = Math.max(field.ringRadius[i] ?? 0, 1e-6);
  const noseX = Math.sin(state.heading);
  const noseZ = Math.cos(state.heading);

  // Outward from the body; from its very centre, "outward" is wherever the nose points.
  let outX = state.x - (field.positions[i * 2] ?? 0);
  let outZ = state.z - (field.positions[i * 2 + 1] ?? 0);
  const d = Math.hypot(outX, outZ);
  if (d < 1e-9) {
    outX = noseX;
    outZ = noseZ;
  } else {
    outX /= d;
    outZ /= d;
  }
  // Along the ring, counter-clockwise: the derivative of (sin a, cos a).
  const alongX = outZ;
  const alongZ = -outX;

  // Which way round? The way the ship already travels; at rest, the way its nose leans.
  const swirl = (state.vx - bodyVx) * alongX + (state.vz - bodyVz) * alongZ;
  if (assist.spin === 0) {
    const lean = Math.abs(swirl) > 1 ? swirl : noseX * alongX + noseZ * alongZ;
    assist.spin = lean < 0 ? -1 : 1;
  } else if (swirl * assist.spin < -params.spinFlipSpeed) {
    assist.spin = -assist.spin;
  }
  const spin = assist.spin;

  // The field: along the ring, leaning toward it by how far off it the ship is.
  const off = d - ring;
  const lean = params.inwardGain * clamp(off / (params.inwardReach * ring), -1, 1);
  let dirX = spin * alongX - lean * outX;
  let dirZ = spin * alongZ - lean * outZ;
  const length = Math.hypot(dirX, dirZ);
  dirX /= length;
  dirZ /= length;

  // The body moves too: the ring is followed in ITS frame, so its velocity is added on top.
  const top = pace ? pace.speed : params.orbitSpeed;
  const rate = pace ? pace.maxRate : params.orbitMaxRate;
  const speed = Math.min(top, Math.min(top, rate * ring) + (pace ? pace.hurry : 0) * Math.abs(off));
  let wantX = speed * dirX + bodyVx;
  let wantZ = speed * dirZ + bodyVz;
  if (pace) {
    // An approach gives way. Inside another body's ring it never closes on that body, whatever
    // its own ring wants, and slides round it instead (fading out by GIVE_WAY rings): a moon that
    // lies between the ship and its planet's ring, or the moon it is leaving, is gone round, not
    // skimmed. The cushions (sim/collide.ts) would stop the ship too, but only at the shell.
    // (From proposal/warp.)
    for (let j = 0; j < field.count; j += 1) {
      if (j === i) continue;
      const surface = field.radius[j] ?? 0;
      if (!(surface > 0)) continue;
      const inner = Math.max(field.ringRadius[j] ?? 0, surface);
      const reach = GIVE_WAY * inner;
      const rx = state.x - (field.positions[j * 2] ?? 0);
      const rz = state.z - (field.positions[j * 2 + 1] ?? 0);
      const dj = Math.hypot(rx, rz);
      if (dj >= reach || dj < 1e-9) continue;
      const nx = rx / dj;
      const nz = rz / dj;
      const closing =
        (wantX - (field.velocities[j * 2] ?? 0)) * nx +
        (wantZ - (field.velocities[j * 2 + 1] ?? 0)) * nz;
      if (closing >= 0) continue;
      const weight = clamp((reach - dj) / (reach - inner), 0, 1);
      wantX -= closing * weight * nx;
      wantZ -= closing * weight * nz;
    }
  }
  const wantSpeed = Math.hypot(wantX, wantZ);

  // Feed-forward. To stay on a circle the nose has to keep turning, and a turning ship slides
  // outward a little (the grip is finite): so ask for the turn rate of the ring up front, and
  // point the nose into the turn by the slip angle. What is left for the feedback is the error.
  const share = Math.max(0, spin * (dirX * alongX + dirZ * alongZ));
  const ringRate = spin * (speed / ring) * share * share;
  const noseTarget = angleOf(wantX, wantZ) + Math.atan2(ringRate, flight.lateralGrip);
  const error = angleDelta(state.heading, noseTarget);

  out.turn = clamp(ringRate / maxYawRate(speedOf(state), flight) + params.steerGain * error, -1, 1);
  // Throttle: hold the pace against drag and close the gap, but only once the nose has come round.
  const forwardSpeed = state.vx * noseX + state.vz * noseZ;
  const push = flight.forwardDrag * wantSpeed + params.speedGain * (wantSpeed - forwardSpeed);
  // A pilot who asked to be there also brakes, when the ship is faster than it wants to be: gently
  // by the assist's own gain; firmly when far faster than that; and as hard as it takes when the
  // course it is on is running out (the reflex, WishPace.limit).
  const risky = pace ? forwardSpeed - pace.limit : -Infinity;
  const slow = pace
    ? Math.max(
        -push,
        Math.min(pace.brakeGain * (forwardSpeed - FAR_ABOVE * wantSpeed), FAR_DECEL),
        pace.brakeGain * risky,
      )
    : 0;
  out.thrust =
    risky > 0 ? 0 : clamp((Math.max(0, Math.cos(error)) * push) / flight.thrustAccel, 0, 1);
  out.brake = slow > 0 ? clamp(slow / (flight.brakeDrag * Math.max(forwardSpeed, 1)), 0, 1) : 0;
  out.boost = false;
  return out;
}

/**
 * One step of the assist: what the ship should actually fly, given what the pilot asks. Writes
 * the blend into `out` (which may not be `pilot`) and returns it.
 */
export function assistInput(
  field: BodyField,
  state: Readonly<ShipState>,
  pilot: Readonly<FlightInput>,
  flight: FlightParams,
  params: AssistParams,
  assist: AssistState,
  out: FlightInput,
): FlightInput {
  const i = chooseBody(field, state, assist, params);
  if (i < 0) {
    assist.weight = 0;
    return copyInput(pilot, out);
  }

  const relativeSpeed = Math.hypot(
    state.vx - (field.velocities[i * 2] ?? 0),
    state.vz - (field.velocities[i * 2 + 1] ?? 0),
  );
  const thrust = clamp(pilot.thrust || 0, 0, 1);
  const brake = clamp(pilot.brake || 0, 0, 1);
  const turn = clamp(pilot.turn || 0, -1, 1);
  const orbiting =
    pullOf(field, i, state.x, state.z, params) *
    (1 - params.thrustFade * thrust) *
    (1 - brake) *
    (1 - smoothstep(params.freeSpeeds[0], params.freeSpeeds[1], relativeSpeed));
  const steering = Math.max(orbiting, deflectOf(field, i, state, params));
  assist.weight = steering;
  if (steering <= 0) return copyInput(pilot, out);

  orbitWish(field, i, state, flight, params, assist, wish);
  // The stick replaces the assist's steering; it does not fight it.
  out.turn = clamp(turn + steering * (1 - Math.abs(turn)) * wish.turn, -1, 1);
  out.thrust = Math.max(thrust, orbiting * wish.thrust);
  out.brake = brake;
  out.boost = pilot.boost;
  return out;
}

const wish: FlightInput = { thrust: 0, turn: 0, brake: 0, boost: false };

function copyInput(from: Readonly<FlightInput>, to: FlightInput): FlightInput {
  to.thrust = from.thrust;
  to.turn = from.turn;
  to.brake = from.brake;
  to.boost = from.boost;
  return to;
}
