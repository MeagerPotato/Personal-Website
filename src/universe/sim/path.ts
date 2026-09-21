import { TAU, angleDelta } from './math';

/**
 * THE WAY THERE: a smooth path from where the ship is to where the autopilot wants it, going
 * round whatever is in between. Space is mostly empty, so the way is usually a straight line.
 * When a body's keep-out disc is in the way, the way round is SEARCHED for, not guessed at:
 * candidate corners stand in a ring round every disc, two corners are joined when the straight
 * line between them is clear, and A* finds the shortest chain of corners from start to goal (a
 * visibility graph, the textbook answer to "round things" since Lozano-Pérez & Wesley, 1979).
 *
 * Shortest is not only short. The rest of a shortest way is itself the shortest way from
 * wherever you are on it, so planning again a second later, from a little further along, gives
 * the same way again: a ship at 280 u/s is never told that the other side of the sun would have
 * been better after all. (Guessing a corner at a time, which this file used to do, tied itself
 * in knots wherever bodies crowd: round a sun with a planet close by, between a planet and its
 * moons.) That holds for a ship ON its path. One that is not yet (it is still turning round)
 * can find the two ways round a body about equally long, and be told the one, then the other.
 * So a plan REMEMBERS which side it passed each body on (`walls`), and the next plan pays
 * dearly for changing sides.
 *
 * A centripetal Catmull-Rom spline (the kind that never loops or overshoots) rounds the corners,
 * and the result is sampled into points with their distance along the path and how sharply the
 * path bends there: all the speed profile (sim/profile.ts) and the pursuit (sim/autopilot.ts)
 * need.
 *
 * Planning runs about once a second while the autopilot flies, never per step. It still does not
 * allocate: a Path owns its buffers and is planned into again and again, and the search works in
 * scratch arrays of this module.
 */

export interface Disc {
  x: number;
  z: number;
  r: number;
}

export interface PathParams {
  /** Distance between samples, u. Long paths use bigger steps, to fit the buffers. */
  readonly sampleStep: number;
  /** A corner stands this many disc radii from the disc's centre (above 1). */
  readonly clearance: number;
  /**
   * s. A ship that is moving does not turn on the spot: its path BEGINS the way it is going, for
   * as far as it goes in this time, and bends toward the goal from there. (A ship going the wrong
   * way gets a hairpin, which the speed profile reads as "brake first": what a pilot would do.)
   */
  readonly leadSec: number;
  /**
   * Keep-outs are generous, and bodies are laid out closer together than that: a moon's and its
   * planet's overlap, two moons' touch whenever they pass each other, and so do a sun's and its
   * first planet's. A gap that opens and shuts as bodies move makes a plan that was right a
   * second ago wrong now, with the ship in the middle of it. So no gap ever shuts: two discs
   * that leave less than `corridor` u between them are both shrunk, in proportion, until they
   * do; but never to less than the share `squeeze` of their radius. (What is left is still well
   * clear of the bodies themselves. Whoever flies there should fly slowly: sim/autopilot.ts.)
   */
  readonly corridor: number;
  readonly squeeze: number;
}

export interface Path {
  /** Samples in use. */
  count: number;
  readonly x: Float64Array;
  readonly z: Float64Array;
  /** Distance along the path to each sample, u. */
  readonly s: Float64Array;
  /** How sharply the path bends at each sample, 1/u (one over the radius of the bend). */
  readonly curvature: Float64Array;
  /** Whole length, u. */
  length: number;
  /** The corners of the route, [x0, z0, x1, z1, ...], start and goal included. */
  readonly corners: Float64Array;
  cornerCount: number;
  /** Which leg of the route (corner k to corner k + 1) each sample lies on. */
  readonly legOf: Uint8Array;
  /** How much of each disc this plan kept out of (see PathParams.corridor), by the disc's index. */
  readonly keeps: Float64Array;
}

export const PATH_SAMPLES = 512;
const MAX_CORNERS = 32;
/** Candidate corners to a disc: every 30 degrees, so that a way can wrap round it. */
const RING_POINTS = 12;
/** Discs beyond this many are not looked at. No galaxy we build comes close. */
const MAX_DISCS = 40;
const MAX_NODES = 2 + MAX_DISCS * RING_POINTS;
/** u. Every corner costs a little extra: of two ways about as long, the simpler one wins. */
const CORNER_COST = 3;
/** u. What passing a body on the other side than the plan before costs: only a way that is this much shorter is worth it. */
const SWITCH_COST = 80;
/** u. How far beyond a disc its wall reaches. Going round the END of a wall is no near thing any more. */
const WALL_REACH = 150;
/** u. Brushing a keep-out by less than this is not worth a corner: keep-outs are generous. */
const TOLERANCE = 0.25;
/** The spline may bow into a disc where the straight legs did not: this many extra corners mend it. */
const MAX_REPAIRS = 4;

/**
 * An END of the path may lie inside a disc, or right beside one (a ship leaving an orbit starts
 * inside that body's keep-out; a moon's ring lies inside its planet's). The leg that begins or
 * ends there, AND ONLY THAT LEG, has less of such a disc to respect: this share of the distance
 * from the disc's centre to that end, so that it cannot go deeper in than it is, and the end
 * itself is in nobody's sight. Every other leg respects every disc whole. (The discs used to
 * shrink for the whole plan. Then a gap between a sun and its first planet was open to a ship
 * leaving the sun's ring, and shut a second later, when it planned again from further out: with
 * the ship in front of it.)
 */
const INSIDE_SHARE = 0.93;
/** Which end a leg touches: bits for `isClear`. */
const FROM_START = 1;
const TO_GOAL = 2;

export function createPath(): Path {
  return {
    count: 0,
    x: new Float64Array(PATH_SAMPLES),
    z: new Float64Array(PATH_SAMPLES),
    s: new Float64Array(PATH_SAMPLES),
    curvature: new Float64Array(PATH_SAMPLES),
    length: 0,
    corners: new Float64Array(MAX_CORNERS * 2),
    cornerCount: 0,
    legOf: new Uint8Array(PATH_SAMPLES),
    keeps: new Float64Array(MAX_DISCS),
  };
}

// Scratch of the search. One plan at a time: nothing here outlives a call.
/** How much of each disc counts: all of it, and what is left for the leg from the start, and for the leg to the goal. */
const keep = new Float64Array(MAX_DISCS);
const startKeep = new Float64Array(MAX_DISCS);
const goalKeep = new Float64Array(MAX_DISCS);
/** Legs stay this many times a keep-out's radius from its centre (set by each plan). */
let margin = 1;
const nodeX = new Float64Array(MAX_NODES);
const nodeZ = new Float64Array(MAX_NODES);
const cost = new Float64Array(MAX_NODES);
const cameFrom = new Int16Array(MAX_NODES);
/** 0 = not seen yet, 1 = reached, 2 = done with. */
const mark = new Uint8Array(MAX_NODES);

/**
 * Plan from (x0, z0) to (x1, z1) round `discs` (the first `discCount` of them), into `path`.
 * Discs are only read. Returns `path`.
 *
 * The search keeps its straight legs a little further out than the keep-outs themselves, and
 * the curve is checked again once it is drawn: a spline bows a little between its corners, and
 * where that takes it into a disc after all, one more corner beside that disc mends it.
 *
 * `walls` is the memory between one plan of a journey and the next: [nx0, nz0, nx1, nz1, ...],
 * for every disc a unit vector pointing AWAY from where the last plan passed it (zeros: it did
 * not come near). A wall stands from the disc's centre out along that vector; a way that crosses
 * it passes the disc on the other side, and pays SWITCH_COST. This plan writes its own walls
 * back. The caller carries them from plan to plan (the discs of one plan are not always the
 * discs of the next) and clears them when a new journey begins.
 *
 * (vx, vz) is how the ship is moving, u/s (see PathParams.leadSec).
 */
export function planPath(
  path: Path,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  discs: readonly Readonly<Disc>[],
  discCount: number,
  params: PathParams,
  walls: Float64Array | null = null,
  vx = 0,
  vz = 0,
): Path {
  const { corners, x, z } = path;
  const used = Math.min(discCount, MAX_DISCS);
  // Legs stay this much clear of a keep-out: less than a chord between two neighbouring corners
  // of a ring dips inside that ring, or no way could ever wrap round a disc.
  margin = Math.min(1 + (params.clearance - 1) / 3, params.clearance * 0.95);
  for (let j = 0; j < used; j += 1) keep[j] = discs[j]?.r ?? 0;
  // No gap ever shuts (PathParams.corridor).
  for (let j = 0; j < used; j += 1) {
    const a = discs[j];
    for (let m = j + 1; a && m < used; m += 1) {
      const b = discs[m];
      if (!b || !(a.r > 0) || !(b.r > 0)) continue;
      const between = Math.hypot(a.x - b.x, a.z - b.z);
      const share = Math.max(params.squeeze, (between - params.corridor) / ((a.r + b.r) * margin));
      if (share >= 1) continue;
      keep[j] = Math.min(keep[j] ?? 0, a.r * share);
      keep[m] = Math.min(keep[m] ?? 0, b.r * share);
    }
  }
  path.keeps.set(keep.subarray(0, used));
  keepsSeenFrom(x0, z0, discs, used, startKeep);
  keepsSeenFrom(x1, z1, discs, used, goalKeep);

  // The way the ship is going, as far as it is clear (half as far, a quarter as far: a ship
  // heading for a body gets less of a run-up), and never more than half the way to the goal.
  // A ship with no clear run-up at all gets none: it is slow, or about to be, and a slow ship
  // goes where its pilot points it.
  corners[0] = x0;
  corners[1] = z0;
  let first = 0;
  const speed = Math.hypot(vx, vz);
  let lead = Math.min(speed * params.leadSec, Math.hypot(x1 - x0, z1 - z0) / 2);
  for (let tries = 0; tries < 3 && lead >= params.sampleStep * 2; tries += 1) {
    const px = x0 + (vx / speed) * lead;
    const pz = z0 + (vz / speed) * lead;
    if (isClear(x0, z0, px, pz, discs, used, FROM_START)) {
      corners[2] = px;
      corners[3] = pz;
      first = 1;
      // The search sets out from the end of the run-up: that is the start it has to get away from.
      keepsSeenFrom(px, pz, discs, used, startKeep);
      break;
    }
    lead /= 2;
  }

  let count = findRoute(path, first, x1, z1, discs, used, params.clearance, walls);
  if (count === 0) {
    // Walled in, which no galaxy we build does to anybody. Fly straight, let the cushions fend
    // the ship off (sim/collide.ts), and plan again in a second from wherever that leaves it.
    corners[0] = x0;
    corners[1] = z0;
    corners[2] = x1;
    corners[3] = z1;
    count = 2;
  }

  for (let repairs = 0; ; repairs += 1) {
    drawCurve(path, count, params.sampleStep);
    if (repairs >= MAX_REPAIRS || count >= MAX_CORNERS || count === 2) break;

    // Where is the curve deepest inside something?
    let at = -1;
    let blocker = -1;
    let depth = TOLERANCE;
    for (let j = 0; j < used; j += 1) {
      const disc = discs[j];
      if (!disc) continue;
      for (let i = 1; i + 1 < path.count; i += 1) {
        const inside =
          keepOnLeg(j, path.legOf[i] ?? 0, first, count) -
          Math.hypot((x[i] ?? 0) - disc.x, (z[i] ?? 0) - disc.z);
        if (inside > depth) {
          at = i;
          blocker = j;
          depth = inside;
        }
      }
    }
    const disc = blocker < 0 ? undefined : discs[blocker];
    if (at < 0 || !disc) break;

    // One more corner, beside that body where the curve passes it.
    let nx = (x[at] ?? 0) - disc.x;
    let nz = (z[at] ?? 0) - disc.z;
    const n = Math.hypot(nx, nz);
    if (n < 1e-6) break;
    nx /= n;
    nz /= n;
    const leg = path.legOf[at] ?? 0;
    const out = keepOnLeg(blocker, leg, first, count) * params.clearance;
    const vx = disc.x + nx * out;
    const vz = disc.z + nz * out;
    const tooNear = (k: number): boolean =>
      Math.hypot(vx - (corners[k * 2] ?? 0), vz - (corners[k * 2 + 1] ?? 0)) < 1;
    // A corner on top of a corner changes nothing: this is as good as the curve gets.
    if (tooNear(leg) || tooNear(leg + 1)) break;
    corners.copyWithin(leg * 2 + 4, leg * 2 + 2, count * 2);
    corners[leg * 2 + 2] = vx;
    corners[leg * 2 + 3] = vz;
    count += 1;
    // A corner more before the search's start: the legs up to that start are one more.
    if (leg <= first) first += 1;
  }
  path.cornerCount = count;

  // Which side of everything did this plan pass on?
  if (walls) {
    for (let j = 0; j < used; j += 1) {
      const disc = discs[j];
      if (!disc) continue;
      // Seen from the disc, the path sweeps through a range of bearings as it goes by (half a
      // turn for a straight pass, more when it wraps round). The wall stands opposite the middle
      // of that range: as far from the path as a line from the centre can be.
      let nearest = Infinity;
      let at = 0;
      let seen = false;
      let from = 0;
      let last = 0;
      let swept = 0;
      for (let i = 0; i < path.count; i += 1) {
        const dx = (x[i] ?? 0) - disc.x;
        const dz = (z[i] ?? 0) - disc.z;
        const d = Math.hypot(dx, dz);
        if (d < nearest) {
          nearest = d;
          at = i;
        }
        if (d > disc.r + WALL_REACH || d < 1e-6) continue;
        const bearing = Math.atan2(dx, dz);
        if (seen) swept += angleDelta(last, bearing);
        else from = bearing;
        seen = true;
        last = bearing;
      }
      // Far from the path, a body has no side worth remembering; nor has one the path ends at.
      if (!seen || at === path.count - 1) continue;
      const middle = from + swept / 2;
      walls[j * 2] = -Math.sin(middle);
      walls[j * 2 + 1] = -Math.cos(middle);
    }
  }

  // Distance along the path, and how sharply it bends (the circle through three samples).
  const { s, curvature } = path;
  const samples = path.count;
  s[0] = 0;
  for (let i = 1; i < samples; i += 1) {
    s[i] =
      (s[i - 1] ?? 0) + Math.hypot((x[i] ?? 0) - (x[i - 1] ?? 0), (z[i] ?? 0) - (z[i - 1] ?? 0));
  }
  path.length = s[samples - 1] ?? 0;
  for (let i = 0; i < samples; i += 1) {
    if (i === 0 || i === samples - 1) {
      curvature[i] = 0;
      continue;
    }
    const ax = (x[i] ?? 0) - (x[i - 1] ?? 0);
    const az = (z[i] ?? 0) - (z[i - 1] ?? 0);
    const bx = (x[i + 1] ?? 0) - (x[i] ?? 0);
    const bz = (z[i + 1] ?? 0) - (z[i] ?? 0);
    const cx = (x[i + 1] ?? 0) - (x[i - 1] ?? 0);
    const cz = (z[i + 1] ?? 0) - (z[i - 1] ?? 0);
    const a = Math.hypot(ax, az);
    const b = Math.hypot(bx, bz);
    const sides = a * b * Math.hypot(cx, cz);
    curvature[i] = sides < 1e-9 ? 0 : (2 * Math.abs(ax * bz - az * bx)) / sides;
    // A path that doubles back on itself (the hairpin of a ship going the wrong way) has three
    // samples in a line, which the circle through them calls straight. It is the opposite.
    if (ax * bx + az * bz <= 0 && a + b > 1e-9)
      curvature[i] = Math.max(curvature[i] ?? 0, 4 / (a + b));
  }
  return path;
}

/**
 * The shortest chain of corners from corner `first` of `path.corners` to the goal, written
 * after that corner. Returns how many corners the path then has, or 0 when there is no way.
 */
function findRoute(
  path: Path,
  first: number,
  x1: number,
  z1: number,
  discs: readonly Readonly<Disc>[],
  used: number,
  clearance: number,
  walls: Float64Array | null,
): number {
  // The search starts from corner `first`: the ship itself, or the end of its run-up.
  const { corners } = path;
  const x0 = corners[first * 2] ?? 0;
  const z0 = corners[first * 2 + 1] ?? 0;
  if (isClear(x0, z0, x1, z1, discs, used, FROM_START | TO_GOAL)) {
    corners[first * 2 + 2] = x1;
    corners[first * 2 + 3] = z1;
    return first + 2;
  }

  // The corners there are to choose from: start, goal, and a ring round every disc, without the
  // corners that stand inside a neighbour (keep-outs overlap: a moon's and its planet's).
  nodeX[0] = x0;
  nodeZ[0] = z0;
  nodeX[1] = x1;
  nodeZ[1] = z1;
  let nodes = 2;
  for (let j = 0; j < used; j += 1) {
    const disc = discs[j];
    const ring = (keep[j] ?? 0) * clearance;
    if (!disc || !(ring > 0)) continue;
    for (let k = 0; k < RING_POINTS; k += 1) {
      const angle = (k / RING_POINTS) * TAU;
      const px = disc.x + ring * Math.sin(angle);
      const pz = disc.z + ring * Math.cos(angle);
      let free = true;
      for (let m = 0; m < used && free; m += 1) {
        const other = discs[m];
        if (other && m !== j && Math.hypot(px - other.x, pz - other.z) < (keep[m] ?? 0) * margin) {
          free = false;
        }
      }
      if (!free) continue;
      nodeX[nodes] = px;
      nodeZ[nodes] = pz;
      nodes += 1;
    }
  }

  // A*: always carry on from the corner that promises the shortest way as the crow flies.
  cost.fill(Infinity, 0, nodes);
  mark.fill(0, 0, nodes);
  cost[0] = 0;
  cameFrom[0] = -1;
  mark[0] = 1;
  for (;;) {
    let u = -1;
    let least = Infinity;
    for (let v = 0; v < nodes; v += 1) {
      if (mark[v] !== 1) continue;
      const promise = (cost[v] ?? 0) + Math.hypot(x1 - (nodeX[v] ?? 0), z1 - (nodeZ[v] ?? 0));
      if (promise < least) {
        least = promise;
        u = v;
      }
    }
    if (u < 0) return 0;
    if (u === 1) break;
    mark[u] = 2;
    const ux = nodeX[u] ?? 0;
    const uz = nodeZ[u] ?? 0;
    for (let v = 1; v < nodes; v += 1) {
      if (mark[v] === 2) continue;
      const vx = nodeX[v] ?? 0;
      const vz = nodeZ[v] ?? 0;
      let through = (cost[u] ?? 0) + Math.hypot(vx - ux, vz - uz) + (v === 1 ? 0 : CORNER_COST);
      if (through >= (cost[v] ?? Infinity)) continue;
      const ends = (u === 0 ? FROM_START : 0) | (v === 1 ? TO_GOAL : 0);
      if (!isClear(ux, uz, vx, vz, discs, used, ends)) continue;
      if (walls) {
        through += SWITCH_COST * wallsCrossed(ux, uz, vx, vz, discs, used, walls);
        if (through >= (cost[v] ?? Infinity)) continue;
      }
      cost[v] = through;
      cameFrom[v] = u;
      mark[v] = 1;
    }
  }

  let count = 0;
  for (let v = 1; v >= 0; v = cameFrom[v] ?? -1) count += 1;
  count += first;
  if (count > MAX_CORNERS) return 0;
  let k = count - 1;
  for (let v = 1; v >= 0; v = cameFrom[v] ?? -1) {
    corners[k * 2] = nodeX[v] ?? 0;
    corners[k * 2 + 1] = nodeZ[v] ?? 0;
    k -= 1;
  }
  return count;
}

/** How many walls does the straight line from a to b cross? */
function wallsCrossed(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  discs: readonly Readonly<Disc>[],
  used: number,
  walls: Float64Array,
): number {
  let crossed = 0;
  for (let j = 0; j < used; j += 1) {
    const disc = discs[j];
    const nx = walls[j * 2] ?? 0;
    const nz = walls[j * 2 + 1] ?? 0;
    if (!disc || (nx === 0 && nz === 0)) continue;
    const reach = disc.r + WALL_REACH;
    const wx = disc.x + nx * reach;
    const wz = disc.z + nz * reach;
    // Two segments cross when each has its ends on either side of the other.
    const d1 = (bx - ax) * (disc.z - az) - (bz - az) * (disc.x - ax);
    const d2 = (bx - ax) * (wz - az) - (bz - az) * (wx - ax);
    const d3 = (wx - disc.x) * (az - disc.z) - (wz - disc.z) * (ax - disc.x);
    const d4 = (wx - disc.x) * (bz - disc.z) - (wz - disc.z) * (bx - disc.x);
    if (d1 * d2 < 0 && d3 * d4 < 0) crossed += 1;
  }
  return crossed;
}

/** What is left of every disc for a leg that begins or ends at (x, z): see INSIDE_SHARE. */
function keepsSeenFrom(
  x: number,
  z: number,
  discs: readonly Readonly<Disc>[],
  used: number,
  out: Float64Array,
): void {
  for (let j = 0; j < used; j += 1) {
    const disc = discs[j];
    out[j] = disc ? Math.min(disc.r, Math.hypot(x - disc.x, z - disc.z) * INSIDE_SHARE) : 0;
  }
}

/**
 * How much of disc `j` a sample on leg `leg` has to keep out of, in a path of `count` corners
 * whose search began at corner `first`.
 */
function keepOnLeg(j: number, leg: number, first: number, count: number): number {
  let r = keep[j] ?? 0;
  if (leg <= first) r = Math.min(r, startKeep[j] ?? 0);
  if (leg >= count - 2) r = Math.min(r, goalKeep[j] ?? 0);
  return r;
}

/**
 * Does the straight line from a to b stay out of sight of every disc? `ends` says whether a is
 * the start and whether b is the goal (FROM_START, TO_GOAL).
 */
function isClear(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  discs: readonly Readonly<Disc>[],
  used: number,
  ends = 0,
): boolean {
  const lx = bx - ax;
  const lz = bz - az;
  const span = lx * lx + lz * lz;
  for (let j = 0; j < used; j += 1) {
    const disc = discs[j];
    let r = keep[j] ?? 0;
    if ((ends & FROM_START) !== 0) r = Math.min(r, startKeep[j] ?? 0);
    if ((ends & TO_GOAL) !== 0) r = Math.min(r, goalKeep[j] ?? 0);
    r *= margin;
    if (!disc || !(r > 0)) continue;
    const t = span < 1e-12 ? 0 : ((disc.x - ax) * lx + (disc.z - az) * lz) / span;
    const c = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = ax + lx * c - disc.x;
    const dz = az + lz * c - disc.z;
    if (dx * dx + dz * dz < r * r) return false;
  }
  return true;
}

/** Round the first `count` corners with a spline and sample it into the path's buffers. */
function drawCurve(path: Path, count: number, sampleStep: number): void {
  const { corners } = path;
  let chord = 0;
  for (let k = 0; k + 1 < count; k += 1) {
    chord += Math.hypot(
      (corners[k * 2 + 2] ?? 0) - (corners[k * 2] ?? 0),
      (corners[k * 2 + 3] ?? 0) - (corners[k * 2 + 1] ?? 0),
    );
  }
  // Every leg rounds its number of samples up, and the last one adds the goal.
  const step = Math.max(sampleStep, chord / (PATH_SAMPLES - count - 2));

  let used = 0;
  for (let k = 0; k + 1 < count; k += 1) {
    const p1x = corners[k * 2] ?? 0;
    const p1z = corners[k * 2 + 1] ?? 0;
    const p2x = corners[k * 2 + 2] ?? 0;
    const p2z = corners[k * 2 + 3] ?? 0;
    // Beyond either end, the spline carries straight on: mirror the neighbour.
    const p0x = k > 0 ? (corners[k * 2 - 2] ?? 0) : 2 * p1x - p2x;
    const p0z = k > 0 ? (corners[k * 2 - 1] ?? 0) : 2 * p1z - p2z;
    const p3x = k + 2 < count ? (corners[k * 2 + 4] ?? 0) : 2 * p2x - p1x;
    const p3z = k + 2 < count ? (corners[k * 2 + 5] ?? 0) : 2 * p2z - p1z;

    const pieces = Math.max(1, Math.ceil(Math.hypot(p2x - p1x, p2z - p1z) / step));
    const last = k + 2 === count;
    for (let i = 0; i < pieces + (last ? 1 : 0) && used < PATH_SAMPLES; i += 1) {
      catmullRom(p0x, p0z, p1x, p1z, p2x, p2z, p3x, p3z, i / pieces, path, used);
      path.legOf[used] = k;
      used += 1;
    }
  }
  path.count = used;
}

/** The point at distance `at` along the path, written to `out` as [x, z]. Clamped to the ends. */
export function pointAlong(
  path: Readonly<Path>,
  at: number,
  from: number,
  out: Float64Array,
): number {
  const { s, x, z, count } = path;
  let i = Math.max(0, Math.min(from, count - 2));
  while (i + 2 < count && (s[i + 1] ?? 0) < at) i += 1;
  const s0 = s[i] ?? 0;
  const span = (s[i + 1] ?? s0) - s0;
  const t = span > 1e-9 ? Math.min(1, Math.max(0, (at - s0) / span)) : 0;
  out[0] = (x[i] ?? 0) + ((x[i + 1] ?? x[i] ?? 0) - (x[i] ?? 0)) * t;
  out[1] = (z[i] ?? 0) + ((z[i + 1] ?? z[i] ?? 0) - (z[i] ?? 0)) * t;
  return i;
}

/**
 * Centripetal Catmull-Rom from p1 to p2 (p0 and p3 shape the ends), at `t` from 0 to 1, by the
 * Barry-Goldman pyramid. "Centripetal" is the knot spacing sqrt(distance): the one choice that
 * cannot form a loop or a cusp, however unevenly the corners are spaced.
 */
function catmullRom(
  p0x: number,
  p0z: number,
  p1x: number,
  p1z: number,
  p2x: number,
  p2z: number,
  p3x: number,
  p3z: number,
  t: number,
  path: Path,
  index: number,
): void {
  const t0 = 0;
  const t1 = t0 + Math.max(1e-6, Math.sqrt(Math.hypot(p1x - p0x, p1z - p0z)));
  const t2 = t1 + Math.max(1e-6, Math.sqrt(Math.hypot(p2x - p1x, p2z - p1z)));
  const t3 = t2 + Math.max(1e-6, Math.sqrt(Math.hypot(p3x - p2x, p3z - p2z)));
  const u = t1 + (t2 - t1) * t;

  const a1x = mix(p0x, p1x, t0, t1, u);
  const a1z = mix(p0z, p1z, t0, t1, u);
  const a2x = mix(p1x, p2x, t1, t2, u);
  const a2z = mix(p1z, p2z, t1, t2, u);
  const a3x = mix(p2x, p3x, t2, t3, u);
  const a3z = mix(p2z, p3z, t2, t3, u);
  const b1x = mix(a1x, a2x, t0, t2, u);
  const b1z = mix(a1z, a2z, t0, t2, u);
  const b2x = mix(a2x, a3x, t1, t3, u);
  const b2z = mix(a2z, a3z, t1, t3, u);
  path.x[index] = mix(b1x, b2x, t1, t2, u);
  path.z[index] = mix(b1z, b2z, t1, t2, u);
}

/** The value at `u` on the line through (ta, a) and (tb, b). */
function mix(a: number, b: number, ta: number, tb: number, u: number): number {
  return (a * (tb - u) + b * (u - ta)) / (tb - ta);
}
