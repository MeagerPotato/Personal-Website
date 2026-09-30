/**
 * WHICH LABELS MAY SHOW, AND WHERE. Names over a crowded sky overlap, and overlapping names are
 * worse than missing ones. Greedy, by importance: the most important label is placed, then the
 * next one that does not touch anything placed so far, and so on. A label may offer more than one
 * PLACE (on the star map a name may sit below its body, above it, beside it, or slid along it:
 * ui/Labels.ts), tried in turn; one that finds no room anywhere may move ONE label already placed
 * to another of that label's places, if that makes room for both (`makeRoom`); and the few that
 * matter most (a system's name, on the map) may be placed TOGETHER, every way of placing them
 * tried before one is left out (`searchTogether`). Pure, allocation-free, and steady from frame
 * to frame: a label that shows keeps showing, where it is, until it really is in the way, and a
 * hidden one only appears where there is real room for it, so nothing flickers while things
 * drift past each other.
 */

export interface LabelBoxes {
  count: number;
  /** How many places each label may offer: its first, and `places - 1` others. */
  readonly places: number;
  /**
   * Top-left corner of each place of each label, in CSS px: [row * places + k], the first place
   * at k = 0 (with one place, simply [row]). A NaN corner is no place at all: a label need not
   * offer every place, nor even its first.
   */
  readonly left: Float64Array;
  readonly top: Float64Array;
  /** The size of each label, wherever it goes. */
  readonly width: Float64Array;
  readonly height: Float64Array;
  /** Lower is more important. Not finite (Infinity, NaN): this label is not a candidate at all. */
  readonly priority: Float64Array;
  /** In: whether each label showed last time. Out: whether it shows now. */
  readonly shown: Uint8Array;
  /**
   * In: at which of its places a label that showed last time showed, as its index this time
   * (the caller keeps track: places may come and go), or `NOWHERE` if that place is gone. Out:
   * where it shows now. Meaningless for a label that does not show.
   */
  readonly at: Uint8Array;
  /** Scratch: the rows by priority. Kept from call to call, because it is nearly sorted already. */
  readonly order: Int32Array;
  /** Scratch: where each label showed last time (`at`, as it came in). */
  readonly was: Uint8Array;
  /** Scratch for `searchTogether`: the place tried, and the best found, by position in `order`. */
  readonly trial: Uint8Array;
  readonly best: Uint8Array;
}

/** `at` for a label whose place last time is not among its places now. */
export const NOWHERE = 255;

export function createLabelBoxes(capacity: number, places = 1): LabelBoxes {
  const order = new Int32Array(capacity);
  for (let i = 0; i < capacity; i += 1) order[i] = i;
  const count = Math.max(1, Math.min(Math.floor(places), NOWHERE));
  return {
    count: 0,
    places: count,
    left: new Float64Array(capacity * count),
    top: new Float64Array(capacity * count),
    width: new Float64Array(capacity),
    height: new Float64Array(capacity),
    priority: new Float64Array(capacity).fill(Infinity),
    shown: new Uint8Array(capacity),
    at: new Uint8Array(capacity),
    order,
    was: new Uint8Array(capacity),
    trial: new Uint8Array(capacity),
    best: new Uint8Array(capacity),
  };
}

/** A box on the page, in CSS px. */
export interface ScreenBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Room that is TAKEN before the first label is placed, by things that are not labels and do not
 * move for them: the dock prompt, the boost pad. A label that would touch one does not show.
 */
export interface TakenBoxes {
  count: number;
  readonly boxes: readonly ScreenBox[];
}

export function createTakenBoxes(capacity: number): TakenBoxes {
  return {
    count: 0,
    boxes: Array.from({ length: capacity }, () => ({ left: 0, top: 0, width: 0, height: 0 })),
  };
}

export interface DeclutterParams {
  /** Labels keep at least this far apart (CSS px) ... */
  readonly gapPx: number;
  /** ... but one that shows already may stay until it is this much closer than that. */
  readonly keepPx: number;
  /** Never more labels than this at once, however much room there is. */
  readonly max: number;
}

/**
 * Decide `boxes.shown`, and `boxes.at`, for this frame. Each label, most important first:
 *
 * - one that showed last time goes back to its first place if that has room to spare (a gap and a
 *   keep: it was elsewhere only for want of room), or else stays where it was while it may (a
 *   keep closer than the gap), as a label with one place always has;
 * - otherwise it takes the first of its places with real room (a gap);
 * - and one that has room nowhere may move one label already placed to another of that label's
 *   places, where there is real room for it, if that alone makes room (`makeRoom`).
 *
 * Labels more important than `together` (a priority below it) are placed as one: should that
 * leave one of them out, every way of placing them is tried (`searchTogether`), the way that shows
 * the most of them wins, and everything else is then placed round them as above.
 */
export function declutter(
  boxes: LabelBoxes,
  params: DeclutterParams,
  taken?: Readonly<TakenBoxes>,
  together = -Infinity,
): void {
  const { count, places, priority, shown, order, at, was, best } = boxes;

  // Insertion sort: from one frame to the next hardly anything changes places.
  for (let k = 1; k < count; k += 1) {
    const row = order[k] ?? 0;
    const key = sortKey(priority[row] ?? Infinity);
    let j = k - 1;
    while (j >= 0 && sortKey(priority[order[j] ?? 0] ?? Infinity) > key) {
      order[j + 1] = order[j] ?? 0;
      j -= 1;
    }
    order[j + 1] = row;
  }
  for (let row = 0; row < count; row += 1) {
    const last = at[row] ?? NOWHERE;
    was[row] = shown[row] && last < places ? last : NOWHERE;
  }

  placeFrom(boxes, params, taken, 0, 0);

  // The group placed together: the first in the order, as far as they are that important.
  let group = 0;
  let missing = 0;
  while (group < count && group < params.max) {
    const value = priority[order[group] ?? 0] ?? Infinity;
    if (!(Number.isFinite(value) && value < together)) break;
    if (!shown[order[group] ?? 0]) missing += 1;
    group += 1;
  }
  if (missing === 0 || places < 2) return;
  const most = searchTogether(boxes, params, taken, group);
  if (most <= group - missing) return;
  for (let g = 0; g < group; g += 1) {
    const row = order[g] ?? 0;
    const place = best[g] ?? NOWHERE;
    shown[row] = place === NOWHERE ? 0 : 1;
    if (place !== NOWHERE) at[row] = place;
  }
  placeFrom(boxes, params, taken, group, most);
}

/** The greedy pass of `declutter`, from position `start` in the order, `placed` placed already. */
function placeFrom(
  boxes: LabelBoxes,
  params: DeclutterParams,
  taken: Readonly<TakenBoxes> | undefined,
  start: number,
  placed: number,
): void {
  const { count, places, priority, shown, order, at, was } = boxes;
  const { gapPx, keepPx } = params;
  let done = placed;
  for (let k = start; k < count; k += 1) {
    const row = order[k] ?? 0;
    shown[row] = 0;
    if (!Number.isFinite(priority[row] ?? Infinity) || done >= params.max) continue;
    const last = was[row] ?? NOWHERE;
    let place = -1;
    if (last !== NOWHERE) {
      if (last !== 0 && fits(boxes, row, 0, gapPx + keepPx, k, -1, taken)) place = 0;
      else if (fits(boxes, row, last, gapPx - keepPx, k, -1, taken)) place = last;
    }
    for (let p = 0; place < 0 && p < places; p += 1) {
      if (p !== last && fits(boxes, row, p, gapPx, k, -1, taken)) place = p;
    }
    if (place < 0) place = makeRoom(boxes, row, k, params, taken);
    if (place < 0) continue;
    shown[row] = 1;
    at[row] = place;
    done += 1;
  }
}

/**
 * How many places `searchTogether` tries at most in one frame. A handful of systems with a few
 * places each take a few hundred; past this, the best way found so far stands.
 */
const TOGETHER_TRIES = 4000;
const search = { tries: 0, most: -1 };

/**
 * Every way of placing the first `group` labels in the order (each at one of its places, or left
 * out), the most important first and each where it was last time first. The first way found that
 * shows the most of them goes into `boxes.best`, by position in the order (NOWHERE: left out),
 * and how many it shows is returned. Only what was there first is in their way.
 */
function searchTogether(
  boxes: LabelBoxes,
  params: DeclutterParams,
  taken: Readonly<TakenBoxes> | undefined,
  group: number,
): number {
  search.tries = 0;
  search.most = -1;
  dive(boxes, params, taken, group, 0, 0);
  return search.most;
}

function dive(
  boxes: LabelBoxes,
  params: DeclutterParams,
  taken: Readonly<TakenBoxes> | undefined,
  group: number,
  g: number,
  placed: number,
): void {
  const { places, order, was, trial, best } = boxes;
  if (g === group) {
    if (placed > search.most) {
      search.most = placed;
      best.set(trial.subarray(0, group));
    }
    return;
  }
  // Nothing down this way can beat what has been found, or time is up.
  if (placed + group - g <= search.most || search.tries >= TOGETHER_TRIES) return;
  const row = order[g] ?? 0;
  const last = was[row] ?? NOWHERE;
  for (let i = -1; i < places; i += 1) {
    const place = i < 0 ? last : i;
    if (place === NOWHERE || (i >= 0 && place === last)) continue;
    search.tries += 1;
    const pad = i < 0 ? params.gapPx - params.keepPx : params.gapPx;
    if (!clearOfTrial(boxes, row, place, pad, g, taken)) continue;
    trial[g] = place;
    dive(boxes, params, taken, group, g + 1, placed + 1);
    if (search.most === group) return;
  }
  trial[g] = NOWHERE;
  dive(boxes, params, taken, group, g + 1, placed);
}

/**
 * Is place `p` of label `row` a place at all, and clear, `pad` round it, of what was there first
 * and of the labels before position `g` in the order, as `searchTogether` has placed them so far?
 */
function clearOfTrial(
  boxes: LabelBoxes,
  row: number,
  p: number,
  pad: number,
  g: number,
  taken: Readonly<TakenBoxes> | undefined,
): boolean {
  const { places, left, top, width, height, order, trial } = boxes;
  const pl = left[row * places + p] ?? Number.NaN;
  const pt = top[row * places + p] ?? Number.NaN;
  if (!Number.isFinite(pl) || !Number.isFinite(pt)) return false;
  const l = pl - pad;
  const t = pt - pad;
  const r = pl + (width[row] ?? 0) + pad;
  const b = pt + (height[row] ?? 0) + pad;
  if (!clearOfTaken(l, t, r, b, taken)) return false;
  for (let m = 0; m < g; m += 1) {
    const place = trial[m] ?? NOWHERE;
    if (place === NOWHERE) continue;
    if (overlaps(boxes, order[m] ?? 0, place, l, t, r, b)) return false;
  }
  return true;
}

/**
 * Room for label `row` nowhere: is there a place of it where ONE label already placed is all that
 * is in the way, and can that one move to another of its own places, with real room there (a keep
 * closer, where it was last time), clear of this label too? Then it moves, and this label takes
 * that place. Nothing else moves, and nothing that showed is hidden for it. The place, or -1.
 */
function makeRoom(
  boxes: LabelBoxes,
  row: number,
  k: number,
  params: DeclutterParams,
  taken?: Readonly<TakenBoxes>,
): number {
  const { places, left, top, width, height, shown, order, at, was } = boxes;
  const { gapPx, keepPx } = params;
  const w = width[row] ?? 0;
  const h = height[row] ?? 0;
  for (let p = 0; p < places; p += 1) {
    const pl = left[row * places + p] ?? Number.NaN;
    const pt = top[row * places + p] ?? Number.NaN;
    if (!Number.isFinite(pl) || !Number.isFinite(pt)) continue;
    const pad = p === was[row] ? gapPx - keepPx : gapPx;
    if (!clearOfTaken(pl - pad, pt - pad, pl + w + pad, pt + h + pad, taken)) continue;
    // Who is in the way: exactly one label, or this place is no good.
    let blocker = -1;
    let blockers = 0;
    for (let m = 0; m < k && blockers < 2; m += 1) {
      const other = order[m] ?? 0;
      if (!shown[other]) continue;
      if (overlaps(boxes, other, at[other] ?? 0, pl - pad, pt - pad, pl + w + pad, pt + h + pad)) {
        blocker = other;
        blockers += 1;
      }
    }
    if (blockers !== 1) continue;
    for (let q = 0; q < places; q += 1) {
      if (q === at[blocker]) continue;
      const qPad = q === was[blocker] ? gapPx - keepPx : gapPx;
      if (!fits(boxes, blocker, q, qPad, k, blocker, taken)) continue;
      // ...and clear of this label, in its new place.
      const ql = left[blocker * places + q] ?? 0;
      const qt = top[blocker * places + q] ?? 0;
      const bw = width[blocker] ?? 0;
      const bh = height[blocker] ?? 0;
      if (ql - qPad < pl + w && ql + bw + qPad > pl && qt - qPad < pt + h && qt + bh + qPad > pt) {
        continue;
      }
      at[blocker] = q;
      return p;
    }
  }
  return -1;
}

/**
 * Is place `p` of label `row` a place at all, and clear, `pad` round it, of what was there first
 * and of every label placed so far (those before position `k` in the order that show), but
 * `skip`'s?
 */
function fits(
  boxes: LabelBoxes,
  row: number,
  p: number,
  pad: number,
  k: number,
  skip: number,
  taken?: Readonly<TakenBoxes>,
): boolean {
  const { places, left, top, width, height, shown, order, at } = boxes;
  const pl = left[row * places + p] ?? Number.NaN;
  const pt = top[row * places + p] ?? Number.NaN;
  if (!Number.isFinite(pl) || !Number.isFinite(pt)) return false;
  const l = pl - pad;
  const t = pt - pad;
  const r = pl + (width[row] ?? 0) + pad;
  const b = pt + (height[row] ?? 0) + pad;
  // What was there first: the same gap, and the same patience with a label that shows already.
  if (!clearOfTaken(l, t, r, b, taken)) return false;
  // Everything before it in the order that shows is already placed.
  for (let m = 0; m < k; m += 1) {
    const other = order[m] ?? 0;
    if (other === skip || !shown[other]) continue;
    if (overlaps(boxes, other, at[other] ?? 0, l, t, r, b)) return false;
  }
  return true;
}

/** Does label `row`, at its place `p`, overlap the box from (l, t) to (r, b)? */
function overlaps(
  boxes: LabelBoxes,
  row: number,
  p: number,
  l: number,
  t: number,
  r: number,
  b: number,
): boolean {
  const { places, left, top, width, height } = boxes;
  const ol = left[row * places + p] ?? 0;
  const ot = top[row * places + p] ?? 0;
  return l < ol + (width[row] ?? 0) && r > ol && t < ot + (height[row] ?? 0) && b > ot;
}

function clearOfTaken(
  l: number,
  t: number,
  r: number,
  b: number,
  taken?: Readonly<TakenBoxes>,
): boolean {
  for (let m = 0; m < (taken?.count ?? 0); m += 1) {
    const box = taken?.boxes[m];
    if (!box) continue;
    if (l < box.left + box.width && r > box.left && t < box.top + box.height && b > box.top) {
      return false;
    }
  }
  return true;
}

/**
 * How far a label lies above or below a box (CSS px): the gap between them up and down, negative
 * by as much as they overlap. Infinity where they are more than `besidePx` apart side by side,
 * because then no height can make them touch.
 */
export function verticalClearance(
  left: number,
  top: number,
  width: number,
  height: number,
  box: Readonly<ScreenBox>,
  besidePx: number,
): number {
  if (left - besidePx >= box.left + box.width || left + width + besidePx <= box.left) {
    return Infinity;
  }
  return Math.max(top - (box.top + box.height), box.top - (top + height));
}

/**
 * How far a label must move, down (`way` 1) or up (-1), to keep `gapPx` clear of a box it would
 * otherwise come within `gapPx` of (CSS px; 0 if it is clear already). The label goes all the way
 * PAST the box in that direction, never back across it: a name only ever moves away from its
 * body, and the box (the ship) is most often right beside that body.
 */
export function glidePast(
  left: number,
  top: number,
  width: number,
  height: number,
  box: Readonly<ScreenBox>,
  gapPx: number,
  way: 1 | -1,
): number {
  if (left - gapPx >= box.left + box.width || left + width + gapPx <= box.left) return 0;
  if (top - gapPx >= box.top + box.height || top + height + gapPx <= box.top) return 0;
  return way > 0 ? box.top + box.height + gapPx - top : top + height + gapPx - box.top;
}

/** Rows that are no candidates sort last, whatever nonsense their priority holds. */
function sortKey(priority: number): number {
  return Number.isFinite(priority) ? priority : Infinity;
}
