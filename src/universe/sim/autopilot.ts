import type { AssistParams, BodyField } from './assist';
import { maxYawRate, speedOf } from './flight';
import { angleDelta, angleOf, clamp } from './math';
import { bodyPositionAt, type OrbitTable } from './orbits';
import { createPath, planPath, pointAlong, type Disc, type Path, type PathParams } from './path';
import { speedProfile, type ProfileParams } from './profile';
import type { FlightInput, FlightParams, ShipState } from './types';

/**
 * THE AUTOPILOT: a virtual pilot that flies the ship to a body that is out of reach, with the
 * same stick and throttle a person has (docs/PLAN.md, Appendix A). The structure is a robot's
 * autonomous routine: a PATH round whatever is in the way (sim/path.ts), a SPEED PROFILE along
 * it (sim/profile.ts), and a PURSUIT that steers at a point a little way ahead on the path and
 * holds the profile's speed. It arrives beside the body's docking ring, travelling along it,
 * and hands over to the docking approach (sim/docking.ts), which is that ring's own pilot.
 *
 * Bodies move, and the ship never follows a path exactly, so the plan is made again about once
 * a second, from where the ship really is to where the body WILL be on arrival. Nothing ever
 * has to find its way back to a stale path. But a plan that is being flown at 280 u/s must not
 * change its mind. The path is the SHORTEST one (sim/path.ts), and the rest of a shortest path
 * is the shortest path from wherever the ship is on it, so planning again gives the same way
 * again; and every later plan keeps what the first one chose: which way round the ring to
 * arrive, and which families of bodies to go round as a whole.
 *
 * It is careful where care is needed: slow inside a keep-out and beside one, fast only in open
 * space; no throttle until the nose points the way the path runs; and it never steers at a point
 * it can only see ACROSS a keep-out.
 *
 * It flies the ordinary flight model with a stronger drive (`CruiseParams.flight`), so a trip
 * between systems takes seconds while the pilot's own top speed stays what it is. Taking the
 * controls back changes no velocity: the ship is simply flown by someone else from that step on.
 *
 * Pure and allocation-free after `createCruiseState`.
 */
export interface CruiseParams {
  /** The drive the autopilot flies with: the ordinary model, a stronger engine, less drag. */
  readonly flight: FlightParams;
  readonly path: PathParams;
  /** Journeys longer than this (u) are flown by the `far` profile, shorter ones by `near`. */
  readonly longLeg: number;
  readonly near: ProfileParams;
  readonly far: ProfileParams;
  /** Every body is kept clear of by its docking ring plus this, u. */
  readonly keepOut: number;
  /**
   * u. A body and everything that circles it (a planet and its moons, the home planet and its
   * station) are gone round as ONE disc, when that disc is no bigger than this and the journey
   * neither begins nor ends inside it. Bigger than this (a sun and its planets), going round
   * the lot would be a detour, not a courtesy.
   */
  readonly familyReach: number;
  /** The journey ends this many ring radii from the body; the docking approach takes over. */
  readonly handOffRadii: number;
  /** Seconds between plans. Bodies move: a plan is only right for a while. */
  readonly replanSec: number;
  /**
   * Pursuit: steer at the point this many seconds ahead on the path, within these distances (u).
   * The ship answers its stick late (its nose after yawResponseSec, its course after another
   * 1 / lateralGrip), and a look shorter than about three times that lag weaves.
   */
  readonly lookAheadSec: number;
  readonly lookAhead: readonly [min: number, max: number];
  /**
   * u. Steering at a point ahead cuts a bend short, by about a quarter of how far that point
   * lies aside of the way the path runs here. The look ends where that would be more than this.
   */
  readonly cornerCut: number;
  /** 1/s: how hard the throttle chases the speed the profile asks for. */
  readonly speedGain: number;
  /**
   * u/s. INSIDE a keep-out (leaving a ring, arriving beside a moon, squeezing between a planet
   * and its moon) there is no room for error, and this is the most it goes.
   */
  readonly keepOutSpeed: number;
  /**
   * 1/s. Fast is for open space: at the edge of a keep-out the ship still goes `keepOutSpeed`,
   * and every unit of distance from the nearest one allows this much more.
   */
  readonly openSpaceGain: number;
}

export interface CruiseState {
  readonly path: Path;
  /** The profile: u/s at every sample of the path. */
  readonly speeds: Float64Array;
  /** Scratch: how fast the ship may go at every sample, for how close it is to something. */
  readonly ceiling: Float64Array;
  /** The piece of the path the ship is on: from sample `index` to the next. */
  index: number;
  /** Which way round the ring the journey arrives: +1 counter-clockwise seen from above. */
  spin: number;
  /** Seconds until the next plan. 0 asks for one now. */
  replanIn: number;
  /** Seconds the journey still takes, as of the last plan. */
  etaSec: number;
  /** No plan has been made for this journey yet: the next one chooses, later ones keep. */
  fresh: boolean;
  /**
   * Which profile this journey is flown by. Chosen ONCE, by the length of the first plan: a long
   * journey must not turn into a short one (and slam on the brakes) when it has 600 u left.
   */
  far: boolean | null;
  /**
   * Per head of a family: 1 when this journey goes round the whole family as one disc.
   * Threading between a planet and its moon is for journeys that begin or end there.
   */
  readonly whole: Uint8Array;
  /** Scratch: how far each body's family reaches from it, and the head of the family it is in. */
  readonly family: Float64Array;
  readonly head: Int32Array;
  /**
   * Per body: the side the last plan passed it on (sim/path.ts, `walls`), so that the next plan
   * does not change sides for a few units' gain. Zeros: no side yet.
   */
  readonly sides: Float64Array;
  /**
   * Per body: the time (sim seconds) at which the last plan passes closest to it, which is where
   * the next plan expects it to be in the way. 0: not known yet.
   */
  readonly passAt: Float64Array;
  /**
   * The discs the last plan went round (the first `discCount` of them; the pursuit never aims
   * across one), the body each one stands for, and scratch for their walls.
   */
  discCount: number;
  readonly discs: Disc[];
  readonly bodyOf: Int32Array;
  readonly walls: Float64Array;
  /** Scratch: seconds from the start of the plan to each sample, and the sample nearest each disc. */
  readonly times: Float64Array;
  readonly nearest: Float64Array;
  readonly nearestAt: Int32Array;
}

export function createCruiseState(bodyCount: number): CruiseState {
  const path = createPath();
  return {
    path,
    speeds: new Float64Array(path.x.length),
    ceiling: new Float64Array(path.x.length),
    index: 0,
    spin: 1,
    replanIn: 0,
    etaSec: 0,
    fresh: true,
    far: null,
    whole: new Uint8Array(bodyCount),
    family: new Float64Array(bodyCount),
    head: new Int32Array(bodyCount),
    sides: new Float64Array(bodyCount * 2),
    passAt: new Float64Array(bodyCount),
    discCount: 0,
    bodyOf: new Int32Array(bodyCount + 1),
    walls: new Float64Array((bodyCount + 1) * 2),
    times: new Float64Array(path.x.length),
    nearest: new Float64Array(bodyCount + 1),
    nearestAt: new Int32Array(bodyCount + 1),
    discs: Array.from({ length: bodyCount }, () => ({ x: 0, z: 0, r: 0 })),
  };
}

/** Start a journey: the first step plans it. */
export function beginCruise(cruise: CruiseState): void {
  cruise.replanIn = 0;
  cruise.etaSec = 0;
  cruise.fresh = true;
  cruise.far = null;
  cruise.sides.fill(0);
  cruise.passAt.fill(0);
  cruise.discCount = 0;
  cruise.index = 0;
  cruise.path.count = 0;
}

/** The speed at which the docking approach wants to be handed a ship, u/s: about its own pace. */
function handOverSpeed(ring: number, assist: AssistParams): number {
  return Math.min(assist.orbitSpeed, Math.max(assist.orbitMaxRate * ring, 0.5 * assist.orbitSpeed));
}

/**
 * The approach takes over a little BEFORE the end of the path: as soon as the ship is within
 * this many hand-over radii of the body. (A line that touches a circle is within 1.15 of its
 * radius for 0.57 of that radius before the touching point.)
 */
const ARRIVAL_BAND = 1.15;
/** ...and only at no more than this many times the speed it asks to be handed a ship at. */
const ARRIVAL_PACE = 2.5;
const ARRIVAL_RUN = Math.sqrt(ARRIVAL_BAND * ARRIVAL_BAND - 1);

const point = new Float64Array(2);

/** Below this many seconds to go, the way round the ring is settled: no late changes of mind. */
const SETTLED_SEC = 5;
/** Before that, the other way round has to be this much the shorter to be worth a change: a share, and u on top. */
const CHANGE_SHARE = 1.25;
const CHANGE_COST = 60;
/**
 * The throttle waits for the nose: full speed only with the nose within about 15 degrees of the
 * way the path runs here, none at all beyond 40 (as cosines). Speed made in the wrong direction
 * has to be unmade again, and beside a body there is no room for that. (Measured against the
 * PATH, not against the point steered at: in a tight bend that point is well inside the bend,
 * and a ship that is doing everything right would be held back.)
 */
const AIM_FULL = Math.cos((15 * Math.PI) / 180);
const AIM_NONE = Math.cos((40 * Math.PI) / 180);
/** How many pieces of the path ahead of the last known one the ship is looked for on. */
const PROGRESS_WINDOW = 12;
/**
 * An aim across a keep-out is shortened to this share, at most this often. Inside a keep-out,
 * only what lies deeper in than this share of the ship's own distance counts as across.
 */
const AIM_SHORTER = 0.7;
const AIM_TRIES = 8;
const AIM_INSIDE = 0.97;
/** A goal inside somebody's keep-out moves round the circle by this much (rad) at a time, this often at most. */
const GOAL_STEP = Math.PI / 12;
const GOAL_TRIES = 12;

/**
 * Plan the journey to body `i`, from where the ship is now. The first plan of a journey takes
 * two rounds: the first tells how long the journey takes, the second aims at where everything
 * will be by then. Later plans know how long is left, and keep what the first one chose.
 */
export function planCruise(
  orbits: OrbitTable,
  field: BodyField,
  state: Readonly<ShipState>,
  i: number,
  simTime: number,
  params: CruiseParams,
  assist: AssistParams,
  cruise: CruiseState,
): void {
  const { head, family, whole, discs, bodyOf, walls, sides, passAt, times, nearest, nearestAt } =
    cruise;
  const { fresh } = cruise;
  const ring = field.ringRadius[i] ?? 0;
  const reach = ring * params.handOffRadii;
  const speed = speedOf(state);

  // FAMILIES. How far a body and everything that circles it reach from it (parents come before
  // their children in the table, so backwards is children first)...
  for (let j = 0; j < field.count; j += 1) {
    const own = field.ringRadius[j] ?? 0;
    family[j] = own > 0 ? own + params.keepOut : 0;
  }
  for (let j = field.count - 1; j >= 0; j -= 1) {
    const parent = orbits.parent[j] ?? -1;
    if (parent < 0 || !((family[j] ?? 0) > 0)) continue;
    family[parent] = Math.max(family[parent] ?? 0, (orbits.radius[j] ?? 0) + (family[j] ?? 0));
  }
  // ...and whose family each body counts as part of: the biggest one round it that is still
  // small enough to go round as a whole.
  for (let j = 0; j < field.count; j += 1) {
    const parent = orbits.parent[j] ?? -1;
    const above = parent < 0 ? -1 : (head[parent] ?? parent);
    head[j] = above >= 0 && (family[above] ?? 0) <= params.familyReach ? above : j;
  }
  if (fresh) {
    // Go round a family as a whole unless the journey begins or ends inside it.
    for (let j = 0; j < field.count; j += 1) {
      const away = Math.hypot(
        state.x - (field.positions[j * 2] ?? 0),
        state.z - (field.positions[j * 2 + 1] ?? 0),
      );
      whole[j] = head[j] === j && head[i] !== j && away > (family[j] ?? 0) ? 1 : 0;
    }
  }

  let eta = cruise.etaSec;
  for (let round = fresh ? 0 : 1; round < 2; round += 1) {
    bodyPositionAt(orbits, i, simTime + eta, point);
    const cx = point[0] ?? 0;
    const cz = point[1] ?? 0;
    const d = Math.hypot(state.x - cx, state.z - cz);

    // IN THE WAY: everything else, each where it will be WHEN THE SHIP PASSES it: what is near
    // the start is passed now, what is near the target on arrival. The plan before this one knows
    // when (a ship leaving an orbit takes a second or two to get going, and a moon moves 5 u in
    // that time); before there is one, the share of the straight line that lies before the body.
    let discCount = 0;
    for (let j = 0; j < field.count; j += 1) {
      const h = head[j] ?? j;
      const disc = discs[discCount];
      const asFamily = whole[h] === 1;
      if (j === i || !disc || !((field.ringRadius[j] ?? 0) > 0) || (asFamily && h !== j)) continue;
      const along =
        ((field.positions[j * 2] ?? 0) - state.x) * (cx - state.x) +
        ((field.positions[j * 2 + 1] ?? 0) - state.z) * (cz - state.z);
      const known = passAt[j] ?? 0;
      const when =
        known > 0 ? Math.max(simTime, known) : simTime + eta * clamp(along / (d * d || 1), 0, 1);
      bodyPositionAt(orbits, j, when, point);
      disc.x = point[0] ?? 0;
      disc.z = point[1] ?? 0;
      const own = (field.ringRadius[j] ?? 0) + params.keepOut;
      disc.r = asFamily && (family[j] ?? 0) <= params.familyReach ? (family[j] ?? own) : own;
      bodyOf[discCount] = j;
      discCount += 1;
    }
    // The body itself is in the way too, but only its inside: the goal lies on the circle.
    const own = discs[discCount];
    let count = discCount;
    if (own) {
      own.x = cx;
      own.z = cz;
      own.r = reach * 0.9;
      bodyOf[discCount] = i;
      count += 1;
    }

    // WHICH WAY ROUND. Arrive ON the hand-over circle, travelling ALONG it: at one of the two
    // points where a straight line from the ship touches that circle. Counter-clockwise or
    // clockwise? Whichever makes the shorter journey, all told: a touching point in the gap
    // between a planet and its sun can take a way right round the planet to get to. A ship on its
    // way keeps to its choice unless the other has become MUCH the shorter, and late in the
    // journey it keeps to it whatever happens.
    // (The first round of a first plan is only there to tell the time: it remembers nothing.)
    const remember = !fresh || round === 1;
    const kept = cruise.spin;
    if (d > reach * 1.001 && (fresh || eta > SETTLED_SEC)) {
      let least = Infinity;
      // The way already chosen is tried LAST: if it stays, its plan is the one left standing.
      for (let turn = 0; turn < 2; turn += 1) {
        const spin = turn === 0 ? -kept : kept;
        touchingPoint(cx, cz, reach, state, spin, discs, discCount, point);
        loadWalls(cruise, count);
        planPath(
          cruise.path,
          state.x,
          state.z,
          point[0] ?? 0,
          point[1] ?? 0,
          discs,
          count,
          params.path,
          remember ? walls : null,
          state.vx,
          state.vz,
        );
        const loyal = fresh || spin === kept;
        const length = loyal ? cruise.path.length : cruise.path.length * CHANGE_SHARE + CHANGE_COST;
        if (length < least) {
          least = length;
          cruise.spin = spin;
        }
      }
    }
    if (d > reach * 1.001)
      touchingPoint(cx, cz, reach, state, cruise.spin, discs, discCount, point);
    else {
      point[0] = state.x;
      point[1] = state.z;
    }
    // (When the way tried last is the way chosen, this plan is that plan again: a millisecond.)
    loadWalls(cruise, count);
    planPath(
      cruise.path,
      state.x,
      state.z,
      point[0] ?? 0,
      point[1] ?? 0,
      discs,
      count,
      params.path,
      remember ? walls : null,
      state.vx,
      state.vz,
    );
    if (remember) {
      for (let j = 0; j < count; j += 1) {
        const body = bodyOf[j] ?? 0;
        sides[body * 2] = walls[j * 2] ?? 0;
        sides[body * 2 + 1] = walls[j * 2 + 1] ?? 0;
      }
    }
    cruise.far ??= cruise.path.length > params.longLeg;
    const profile = cruise.far ? params.far : params.near;

    // Fast is for open space.
    const { ceiling, path, speeds } = cruise;
    nearest.fill(Infinity);
    for (let k = 0; k < path.count; k += 1) {
      let room = Infinity;
      for (let j = 0; j < count; j += 1) {
        const disc = discs[j];
        if (!disc) continue;
        const away = Math.hypot((path.x[k] ?? 0) - disc.x, (path.z[k] ?? 0) - disc.z);
        room = Math.min(room, away - disc.r);
        if (away < (nearest[j] ?? Infinity)) {
          nearest[j] = away;
          nearestAt[j] = k;
        }
      }
      ceiling[k] = params.keepOutSpeed + params.openSpaceGain * Math.max(0, room);
    }
    eta = speedProfile(
      path,
      speed,
      handOverSpeed(ring, assist),
      reach * ARRIVAL_RUN,
      profile,
      speeds,
      ceiling,
    );

    // A nose that points the wrong way is brought round before anything else happens, and that
    // takes time the profile knows nothing of: a second or so, out of a dock.
    const turnSec =
      path.count < 2
        ? 0
        : Math.abs(
            angleDelta(
              state.heading,
              angleOf((path.x[1] ?? 0) - (path.x[0] ?? 0), (path.z[1] ?? 0) - (path.z[0] ?? 0)),
            ),
          ) / maxYawRate(speed, params.flight);
    eta += turnSec;

    // When does this plan pass what? The next one puts everything where it will be by then.
    times[0] = turnSec;
    for (let k = 1; k < path.count; k += 1) {
      const ds = (path.s[k] ?? 0) - (path.s[k - 1] ?? 0);
      times[k] = (times[k - 1] ?? 0) + (2 * ds) / ((speeds[k - 1] ?? 0) + (speeds[k] ?? 0) || 1);
    }
    for (let j = 0; j < discCount; j += 1) {
      passAt[bodyOf[j] ?? 0] = simTime + (times[nearestAt[j] ?? 0] ?? 0);
    }
    cruise.discCount = count;
  }
  cruise.fresh = false;
  cruise.etaSec = eta;
  cruise.index = 0;
  cruise.replanIn = params.replanSec;
}

/** What the last plan remembers of each body goes into a plan with that body's disc. */
function loadWalls(cruise: CruiseState, count: number): void {
  const { walls, sides, bodyOf } = cruise;
  for (let j = 0; j < count; j += 1) {
    const body = bodyOf[j] ?? 0;
    walls[j * 2] = sides[body * 2] ?? 0;
    walls[j * 2 + 1] = sides[body * 2 + 1] ?? 0;
  }
}

/**
 * Where a straight line from the ship touches the circle of radius `reach` round (cx, cz), such
 * that a ship arriving along that line goes round the circle the `spin` way. Written to `out`.
 *
 * Unless that point lies inside another body's keep-out (a moon passing close by its planet's
 * ring): then the point a little further round the circle, the way the ship will be going
 * anyway, until it is in nobody's.
 */
function touchingPoint(
  cx: number,
  cz: number,
  reach: number,
  state: Readonly<ShipState>,
  spin: number,
  discs: readonly Readonly<Disc>[],
  others: number,
  out: Float64Array,
): void {
  const d = Math.hypot(state.x - cx, state.z - cz);
  let at = angleOf(state.x - cx, state.z - cz) + spin * Math.acos(Math.min(1, reach / d));
  for (let tries = 0; tries < GOAL_TRIES; tries += 1) {
    out[0] = cx + reach * Math.sin(at);
    out[1] = cz + reach * Math.cos(at);
    let free = true;
    for (let j = 0; j < others && free; j += 1) {
      const disc = discs[j];
      if (disc && Math.hypot((out[0] ?? 0) - disc.x, (out[1] ?? 0) - disc.z) < disc.r) free = false;
    }
    if (free) return;
    at += spin * GOAL_STEP;
  }
}

/**
 * One step of the journey to body `i`: plan if it is time to, then write what the virtual pilot
 * does with the controls into `out`. Fly the result with `params.flight`.
 */
export function cruiseInput(
  orbits: OrbitTable,
  field: BodyField,
  state: Readonly<ShipState>,
  i: number,
  simTime: number,
  dt: number,
  params: CruiseParams,
  assist: AssistParams,
  cruise: CruiseState,
  out: FlightInput,
): FlightInput {
  cruise.replanIn -= dt;
  if (cruise.replanIn <= 0 || cruise.path.count === 0) {
    planCruise(orbits, field, state, i, simTime, params, assist, cruise);
  }
  cruise.etaSec = Math.max(0, cruise.etaSec - dt);

  const { path, speeds } = cruise;
  const { x, z, s, curvature, count } = path;
  out.boost = false;
  out.brake = 0;
  out.thrust = 0;
  out.turn = 0;
  if (count < 2) return out;

  // Where on the path is the ship? On the nearest of the next few pieces of it, never further
  // back than it was. (Not "past every sample whose finish line it has crossed": a plan made
  // for a ship that is moving can begin with a corner the ship has already gone past, and a
  // finish line that lies behind it is never crossed.)
  let index = cruise.index;
  let nearestPiece = Infinity;
  for (let k = cruise.index; k < Math.min(cruise.index + PROGRESS_WINDOW, count - 1); k += 1) {
    const px = (x[k + 1] ?? 0) - (x[k] ?? 0);
    const pz = (z[k + 1] ?? 0) - (z[k] ?? 0);
    const span = px * px + pz * pz;
    const t =
      span < 1e-12
        ? 0
        : clamp(((state.x - (x[k] ?? 0)) * px + (state.z - (z[k] ?? 0)) * pz) / span, 0, 1);
    const off = Math.hypot(state.x - (x[k] ?? 0) - px * t, state.z - (z[k] ?? 0) - pz * t);
    if (off < nearestPiece - 1e-9) {
      nearestPiece = off;
      index = k;
    }
  }
  cruise.index = index;
  const legX = (x[index + 1] ?? 0) - (x[index] ?? 0);
  const legZ = (z[index + 1] ?? 0) - (z[index] ?? 0);
  const leg = Math.hypot(legX, legZ) || 1;
  const along = clamp(
    ((state.x - (x[index] ?? 0)) * legX + (state.z - (z[index] ?? 0)) * legZ) / leg,
    0,
    leg,
  );
  const here = (s[index] ?? 0) + along;

  // STEER: pure pursuit. The circle through the ship, tangent to its nose, that passes through
  // a point `look` ahead on the path has curvature 2 sin(a) / look. A nose that points AWAY from
  // the path is simply turned round first, as hard as it goes.
  const flight = params.flight;
  const speed = speedOf(state);
  let look = clamp(params.lookAheadSec * speed, params.lookAhead[0], params.lookAhead[1]);
  // Steering at a point BEYOND a bend cuts the bend short. So the look ends where the path has
  // swung this far aside from the way it runs here; and because that shortens it little by
  // little as a bend comes closer, nothing ever jumps.
  const fromX = (x[index] ?? 0) + (legX / leg) * along;
  const fromZ = (z[index] ?? 0) + (legZ / leg) * along;
  for (let k = index + 1; k < count && (s[k] ?? 0) <= here + look; k += 1) {
    const aside = (legX * ((z[k] ?? 0) - fromZ) - legZ * ((x[k] ?? 0) - fromX)) / leg;
    if (Math.abs(aside) > params.cornerCut * 4) {
      look = (s[k] ?? 0) - here;
      break;
    }
  }
  look = Math.max(look, params.lookAhead[0]);
  pointAlong(path, here + look, index, point);
  // And never aim ACROSS a keep-out. The path goes round them, but a ship that is a little off
  // its path, on the inside of a bend, can see the point it steers at through the very thing
  // the bend goes round. Then it steers at a nearer point: back to the path first.
  for (let tries = 0; tries < AIM_TRIES && look > params.lookAhead[0]; tries += 1) {
    if (aimIsClear(state.x, state.z, point[0] ?? 0, point[1] ?? 0, cruise)) break;
    look = Math.max(look * AIM_SHORTER, params.lookAhead[0]);
    pointAlong(path, here + look, index, point);
  }
  const toX = (point[0] ?? 0) - state.x;
  const toZ = (point[1] ?? 0) - state.z;
  const reach = Math.hypot(toX, toZ);
  // In a bend the ship's course trails its nose (by the turn rate over the sideways grip): a
  // nose held ON the pursuit would let the ship drift out of every bend. Hold it that much inside.
  const k = Math.min(Math.max(index + 1, 1), count - 2);
  const ax = (x[k] ?? 0) - (x[k - 1] ?? 0);
  const az = (z[k] ?? 0) - (z[k - 1] ?? 0);
  const bx = (x[k + 1] ?? 0) - (x[k] ?? 0);
  const bz = (z[k + 1] ?? 0) - (z[k] ?? 0);
  const slip = (Math.sign(bx * az - bz * ax) * speed * (curvature[k] ?? 0)) / flight.lateralGrip;
  const error =
    reach < 1e-6 ? 0 : angleDelta(state.heading, angleOf(toX, toZ) + clamp(slip, -0.3, 0.3));
  const facing = Math.abs(error) < Math.PI / 2;
  if (facing) {
    // A ship at rest has no curvature to fly; give it enough "speed" to bring its nose round.
    const yaw = (2 * Math.max(speed, params.lookAhead[0]) * Math.sin(error)) / Math.max(reach, 1);
    out.turn = clamp(yaw / maxYawRate(speed, flight), -1, 1);
  } else {
    out.turn = error < 0 ? -1 : 1;
  }

  // THROTTLE: the profile's speed here, the acceleration it is about to ask for, and whatever
  // the drag takes. All of it waits for the nose: facing the wrong way, the only sensible speed
  // is none.
  const off = angleDelta(state.heading, angleOf(legX, legZ) + clamp(slip, -0.3, 0.3));
  const aim = facing ? clamp((Math.cos(off) - AIM_NONE) / (AIM_FULL - AIM_NONE), 0, 1) : 0;
  const v0 = speeds[index] ?? 0;
  const v1 = speeds[index + 1] ?? v0;
  const wanted = aim * (v0 + (v1 - v0) * (along / leg));
  const ahead = (aim * (v1 * v1 - v0 * v0)) / (2 * leg);
  const forward = state.vx * Math.sin(state.heading) + state.vz * Math.cos(state.heading);
  const push = ahead + params.speedGain * (wanted - forward) + flight.forwardDrag * forward;
  if (push >= 0) {
    out.thrust = clamp((Math.cos(error) * push) / flight.thrustAccel, 0, 1);
  } else {
    out.brake = clamp(-push / (flight.brakeDrag * Math.max(forward, 1)), 0, 1);
  }
  return out;
}

/**
 * Is the straight line from the ship at (ax, az) to (bx, bz) clear of every keep-out of the last
 * plan? Of one the ship is inside of already, only what is deeper in than the ship counts.
 */
function aimIsClear(ax: number, az: number, bx: number, bz: number, cruise: CruiseState): boolean {
  const lx = bx - ax;
  const lz = bz - az;
  const span = lx * lx + lz * lz;
  for (let j = 0; j < cruise.discCount; j += 1) {
    const disc = cruise.discs[j];
    if (!disc) continue;
    const r = Math.min(
      cruise.path.keeps[j] ?? 0,
      Math.hypot(ax - disc.x, az - disc.z) * AIM_INSIDE,
    );
    const t = span < 1e-12 ? 0 : clamp(((disc.x - ax) * lx + (disc.z - az) * lz) / span, 0, 1);
    if (Math.hypot(ax + lx * t - disc.x, az + lz * t - disc.z) < r) return false;
  }
  return true;
}

/**
 * Has the journey to body `i` reached the circle where the docking approach takes over? Within
 * reach is not enough: a ship that comes by at speed (its plan changed under it, the body came to
 * meet it) stays the autopilot's until it has slowed down. The approach is a gentle pilot.
 */
export function cruiseArrived(
  field: BodyField,
  state: Readonly<ShipState>,
  i: number,
  params: CruiseParams,
  assist: AssistParams,
): boolean {
  const ring = field.ringRadius[i] ?? 0;
  const d = Math.hypot(
    state.x - (field.positions[i * 2] ?? 0),
    state.z - (field.positions[i * 2 + 1] ?? 0),
  );
  if (d > ring * params.handOffRadii * ARRIVAL_BAND) return false;
  const pace = Math.hypot(
    state.vx - (field.velocities[i * 2] ?? 0),
    state.vz - (field.velocities[i * 2 + 1] ?? 0),
  );
  return pace <= handOverSpeed(ring, assist) * ARRIVAL_PACE;
}
