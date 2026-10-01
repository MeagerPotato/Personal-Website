/**
 * WHICH LABELS MAY SHOW, AND WHERE. Names over a crowded sky overlap, and overlapping names are
 * worse than missing ones. Greedy, by importance: the most important label is placed, then the
 * next one that does not touch anything placed so far, and so on. A label may offer more than one
 * PLACE (on the star map a name may sit below its body, above it, beside it, or slid along it:
 * ui/Labels.ts), tried in turn, those that lie on less (`covers`) before those that lie on more;
 * one that finds no room anywhere may move ONE label already placed to another of that label's
 * places, if that makes room for both (`makeRoom`); and the few that matter most (a system's
 * name, on the map) are placed TOGETHER, every way of placing them tried before one is left out
 * (`searchTogether`). Pure, and it allocates nothing: what it keeps from call to call, and its
 * scratch, are in `LabelBoxes`.
 *
 * STEADY. With the sky at rest (the same places, priorities and `young` labels), what it decides
 * it decides again. The changes it makes of its own accord each go one way only: a label appears
 * where nothing more important is, hiding only less important ones; a label that was missing is
 * placed by moving ONE other, which hides nothing; the group shows more of itself than it did; a
 * label that had been moved aside goes back to its first place, only where that is clear of
 * every label that shows, those still to be placed included, and lies on no more; a label that
 * lies on what it must not moves to a place that lies on less. None of them undoes another, so
 * nothing cycles (declutter.test.ts runs random skies until they settle). While things drift, a
 * label that shows keeps its place until it is `keepPx` closer than the gap to something, and one
 * appears only a whole gap clear, or goes back only a gap and a keep clear: nothing hops back and
 * forth on a pixel's difference. And a label that has only just changed (`young`: the caller keeps
 * the time) makes no change of its own accord until it has shown a while: it does not come back,
 * go back, nor move for another. What nothing can hold off is a change a label must make: its
 * place is gone (past the edge of the view), or something more important needs the room.
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
  /**
   * How much each place lies on what it had better not, by [row * places + k]: 0 nothing; 1
   * something it had better not (on the star map, another body: ui/Labels.ts), which a label
   * takes only where it has no place that lies on less and then keeps, whatever drifts under it;
   * 2 something it must not, but as a last resort (a system's name, on another system's sun),
   * which it also leaves once it may (not `young`), for a place that lies on less with room to
   * spare. A label goes back to its first place only if that lies on no more than where it is.
   */
  readonly covers: Uint8Array;
  /** The size of each label, wherever it goes. */
  readonly width: Float64Array;
  readonly height: Float64Array;
  /** Lower is more important. Not finite (Infinity, NaN): this label is not a candidate at all. */
  readonly priority: Float64Array;
  /** In: whether each label showed last time. Out: whether it shows now. */
  readonly shown: Uint8Array;
  /**
   * In: 1 for a label that appeared, hid or changed places too lately to make another change of
   * its own accord (the caller keeps the time). Such a label does not come back, go back to its
   * first place, nor move to make room for another; it still gives way, or moves, where it must.
   * A firm label (`DeclutterRules`) is never held back.
   */
  readonly young: Uint8Array;
  /**
   * In: at which of its places a label that showed last time showed, as its index this time
   * (the caller keeps track: places may come and go), or `NOWHERE` if that place is gone. Out:
   * where it shows now. Meaningless for a label that does not show.
   */
  readonly at: Uint8Array;
  /** Scratch: the rows by priority. Kept from call to call, because it is nearly sorted already. */
  readonly order: Int32Array;
  /**
   * Scratch: whether each label showed last time (`shown`, as it came in), and where (`at`, or
   * NOWHERE if it did not show, or its place is gone).
   */
  readonly before: Uint8Array;
  readonly was: Uint8Array;
  /** Scratch for `searchTogether`: the place tried, and the best found, by position in `order`. */
  readonly trial: Uint8Array;
  readonly best: Uint8Array;
  /** Scratch for `searchTogether`: how many places it has tried, and the most it has shown. */
  readonly tally: Int32Array;
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
    covers: new Uint8Array(capacity * count),
    width: new Float64Array(capacity),
    height: new Float64Array(capacity),
    priority: new Float64Array(capacity).fill(Infinity),
    shown: new Uint8Array(capacity),
    young: new Uint8Array(capacity),
    at: new Uint8Array(capacity),
    order,
    before: new Uint8Array(capacity),
    was: new Uint8Array(capacity),
    trial: new Uint8Array(capacity),
    best: new Uint8Array(capacity),
    tally: new Int32Array(2),
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
 * Who gives way to whom, beyond importance. Labels more important (by priority, lower) than
 * `firm` (the name of where the ship is going, the one under the keyboard) are placed first and
 * never moved, left out or held back (`young`) for another. The rest, as far as `together` (a
 * system's name, on the map), are placed together (`searchTogether`), and moved only for each
 * other. Everything after them is placed round them, and moves for its like, or for them only by
 * going back to its first place. With `keepSlots`, a label that shows and is `young` keeps its
 * place in `max`: one that did not show last time (and is not firm) shows only while that leaves a
 * place for every one of those, so that a label that has just come does not go again at once for
 * another. Past that, `max` goes by importance: a less important label that shows gives up its
 * place to a more important one that waits with room (a moon's name to a planet's). Of the same
 * importance, one that showed goes first anyway, where the caller orders them so (ui/Labels.ts:
 * `WAITING`).
 */
export interface DeclutterRules {
  readonly firm: number;
  readonly together: number;
  readonly keepSlots: boolean;
}

/** No group, no firm labels, and `max` goes by importance alone. */
const ONE_KIND: DeclutterRules = { firm: -Infinity, together: -Infinity, keepSlots: false };

/**
 * Decide `boxes.shown`, and `boxes.at`, for this frame. Each label, most important first:
 *
 * - one that showed last time goes back to its first place if that has room to spare (a gap and a
 *   keep) from everything that shows, those still to be placed where they showed last time
 *   included, and lies on nothing more than where it is (it was elsewhere only for want of room);
 *   or else stays where it was while it may (a keep closer than the gap), as a label with one
 *   place always has;
 * - otherwise it takes the first of its places with real room (a gap), of those that lie on
 *   least;
 * - and one that has room nowhere may move one label already placed to another of that label's
 *   places, where there is real room for it, if that alone makes room (`makeRoom`).
 *
 * The labels between `rules.firm` and `rules.together` are placed as one: should that leave one
 * of them out, every way of placing them is tried (`searchTogether`), the way that shows the most
 * of them wins, and everything after them is then placed round them as above. A `young` label
 * makes none of these changes of its own accord (it does not come back, nor go back to its first
 * place, nor move for another); and the whole is done again on its own answer, up to
 * `SETTLE_PASSES` times, until it stands.
 */
export function declutter(
  boxes: LabelBoxes,
  params: DeclutterParams,
  taken?: Readonly<TakenBoxes>,
  rules: DeclutterRules = ONE_KIND,
): void {
  const { count, places, priority, shown, order, at, before, was } = boxes;

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
  // Settle within the frame. One pass can leave a step for the next: room made by a label that
  // moved AFTER another looked for it. With the sky as it is, a pass decides again what it
  // decided (see the top of this file), so running it on its own answer until nothing changes
  // does in one frame what would otherwise take a few, and no name blinks out for a frame on its
  // way from one place to another.
  for (let pass = 0; pass < SETTLE_PASSES; pass += 1) {
    for (let row = 0; row < count; row += 1) {
      const last = at[row] ?? NOWHERE;
      before[row] = shown[row] ? 1 : 0;
      was[row] = shown[row] && last < places ? last : NOWHERE;
    }
    decide(boxes, params, taken, rules);
    let settled = true;
    for (let row = 0; row < count && settled; row += 1) {
      settled =
        shown[row] === before[row] && (shown[row] ? (at[row] ?? NOWHERE) : NOWHERE) === was[row];
    }
    if (settled) return;
  }
}

/** How many passes `declutter` makes at most in one frame, each on the answer of the one before. */
const SETTLE_PASSES = 3;

/** One pass of `declutter`, from `boxes.was`. */
function decide(
  boxes: LabelBoxes,
  params: DeclutterParams,
  taken: Readonly<TakenBoxes> | undefined,
  rules: DeclutterRules,
): void {
  const { count, places, priority, shown, young, order, at, before, best } = boxes;
  placeFrom(boxes, params, taken, rules, 0, 0);

  // The group placed together: after the firm, as far as they are that important. Only one that
  // is missing, and may show (not one that was hidden and is `young`), is worth a search.
  let from = 0;
  while (from < count && isBelow(priority[order[from] ?? 0], rules.firm)) from += 1;
  let group = from;
  let missing = 0;
  let showing = 0;
  while (
    group < count &&
    group < params.max &&
    isBelow(priority[order[group] ?? 0], rules.together)
  ) {
    const row = order[group] ?? 0;
    if (shown[row]) showing += 1;
    else if (!young[row] || before[row]) missing += 1;
    group += 1;
  }
  if (missing === 0 || places < 2) return;
  const most = searchTogether(boxes, params, taken, from, group);
  if (most <= showing) return;
  let placed = most;
  for (let g = 0; g < from; g += 1) placed += shown[order[g] ?? 0] ?? 0;
  for (let g = from; g < group; g += 1) {
    const row = order[g] ?? 0;
    const place = best[g] ?? NOWHERE;
    shown[row] = place === NOWHERE ? 0 : 1;
    if (place !== NOWHERE) at[row] = place;
  }
  placeFrom(boxes, params, taken, rules, group, placed);
}

/** The greedy pass of `declutter`, from position `start` in the order, `placed` placed already. */
function placeFrom(
  boxes: LabelBoxes,
  params: DeclutterParams,
  taken: Readonly<TakenBoxes> | undefined,
  rules: DeclutterRules,
  start: number,
  placed: number,
): void {
  const { count, places, priority, shown, young, order, at, before, was, covers } = boxes;
  const { gapPx, keepPx } = params;
  let done = placed;
  // With `keepSlots`, how many of the labels still to be placed showed last time and are young:
  // `max` keeps a place for each of them.
  let owed = 0;
  for (let k = start; rules.keepSlots && k < count; k += 1) {
    const row = order[k] ?? 0;
    if (before[row] && young[row] && Number.isFinite(priority[row] ?? Infinity)) owed += 1;
  }
  for (let k = start; k < count; k += 1) {
    const row = order[k] ?? 0;
    shown[row] = 0;
    if (!Number.isFinite(priority[row] ?? Infinity)) continue;
    const last = was[row] ?? NOWHERE;
    const showed = before[row] === 1;
    const firm = kindOf(priority[row], rules) === 0;
    if (showed && young[row] && owed > 0) owed -= 1;
    if (done >= params.max || (!showed && !firm && done + owed >= params.max)) continue;
    // Too soon after its last change to make another of its own accord: one that is hidden stays
    // hidden, and one that shows neither goes back to its first place nor moves for another.
    const settling = young[row] === 1 && !firm;
    if (settling && !showed) continue;
    const base = row * places;
    let place = -1;
    if (last !== NOWHERE) {
      if (
        !settling &&
        last !== 0 &&
        (covers[base] ?? 0) <= (covers[base + last] ?? 0) &&
        fits(boxes, row, 0, gapPx + keepPx, k, -1, taken) &&
        clearOfWaiting(boxes, row, 0, gapPx + keepPx, k)
      ) {
        place = 0;
      } else if (fits(boxes, row, last, gapPx - keepPx, k, -1, taken)) {
        place = last;
      }
      // Where it lies on what it must not (but as a last resort), it moves to the first of its
      // places that lies on less, where that has room to spare, as it would go back to its first.
      const lies = coverOf(covers[base + last]);
      for (
        let level = 0;
        place === last && !settling && lies >= MUST_NOT && level < lies;
        level += 1
      ) {
        for (let p = 0; place === last && p < places; p += 1) {
          if (
            p !== last &&
            coverOf(covers[base + p]) === level &&
            fits(boxes, row, p, gapPx + keepPx, k, -1, taken) &&
            clearOfWaiting(boxes, row, p, gapPx + keepPx, k)
          ) {
            place = p;
          }
        }
      }
    }
    // The first of its other places with real room, of those that lie on least.
    for (let pass = 0; place < 0 && pass < COVERS; pass += 1) {
      for (let p = 0; place < 0 && p < places; p += 1) {
        if (p === last || coverOf(covers[base + p]) !== pass) continue;
        if (fits(boxes, row, p, gapPx, k, -1, taken)) place = p;
      }
    }
    if (place < 0) place = makeRoom(boxes, row, k, params, taken, rules);
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

/**
 * Every way of placing the labels from position `from` to `group` in the order (each at one of its
 * places, or left out), the most important first, each where it was last time first, then at its
 * places by how much they lie on (`covers`); a `young` one only where it was, if it has room
 * there, and left out if it was. The first way found that shows the most of them goes into
 * `boxes.best`, by position in the order (NOWHERE: left out), and how many it shows is returned.
 * Only what was there first, and the firm labels before them, are in their way.
 */
function searchTogether(
  boxes: LabelBoxes,
  params: DeclutterParams,
  taken: Readonly<TakenBoxes> | undefined,
  from: number,
  group: number,
): number {
  const { tally } = boxes;
  tally[0] = 0;
  tally[1] = -1;
  dive(boxes, params, taken, from, group, from, 0);
  return tally[1] ?? -1;
}

function dive(
  boxes: LabelBoxes,
  params: DeclutterParams,
  taken: Readonly<TakenBoxes> | undefined,
  from: number,
  group: number,
  g: number,
  placed: number,
): void {
  const { places, order, before, was, young, trial, best, covers, tally } = boxes;
  if (g === group) {
    if (placed > (tally[1] ?? -1)) {
      tally[1] = placed;
      for (let m = from; m < group; m += 1) best[m] = trial[m] ?? NOWHERE;
    }
    return;
  }
  // Nothing down this way can beat what has been found, or time is up.
  if (placed + group - g <= (tally[1] ?? -1) || (tally[0] ?? 0) >= TOGETHER_TRIES) return;
  const row = order[g] ?? 0;
  const base = row * places;
  const last = was[row] ?? NOWHERE;
  const settling = young[row] === 1;
  // Where it was (i = -1), then its places that lie on nothing, on something, on more; a young
  // label that was hidden, none of them.
  for (let i = -1; i < COVERS * places && !(settling && !before[row]); i += 1) {
    const place = i < 0 ? last : i % places;
    if (place === NOWHERE) continue;
    if (i >= 0 && (place === last || coverOf(covers[base + place]) !== Math.floor(i / places))) {
      continue;
    }
    tally[0] = (tally[0] ?? 0) + 1;
    const pad = i < 0 ? params.gapPx - params.keepPx : params.gapPx;
    if (!clearOfTrial(boxes, row, place, pad, from, g, taken)) continue;
    trial[g] = place;
    dive(boxes, params, taken, from, group, g + 1, placed + 1);
    // All of them show, or a young label has stayed where it was: nothing else to try for it.
    if (tally[1] === group - from || (settling && i < 0)) return;
  }
  trial[g] = NOWHERE;
  dive(boxes, params, taken, from, group, g + 1, placed);
}

/**
 * Is place `p` of label `row` a place at all, and clear, `pad` round it, of what was there first,
 * of the firm labels before position `from` in the order that show, and of the labels from `from`
 * to position `g` as `searchTogether` has placed them so far?
 */
function clearOfTrial(
  boxes: LabelBoxes,
  row: number,
  p: number,
  pad: number,
  from: number,
  g: number,
  taken: Readonly<TakenBoxes> | undefined,
): boolean {
  const { places, left, top, width, height, shown, order, at, trial } = boxes;
  const pl = left[row * places + p] ?? Number.NaN;
  const pt = top[row * places + p] ?? Number.NaN;
  if (!Number.isFinite(pl) || !Number.isFinite(pt)) return false;
  const l = pl - pad;
  const t = pt - pad;
  const r = pl + (width[row] ?? 0) + pad;
  const b = pt + (height[row] ?? 0) + pad;
  if (!clearOfTaken(l, t, r, b, taken)) return false;
  for (let m = 0; m < g; m += 1) {
    const other = order[m] ?? 0;
    const place =
      m < from ? (shown[other] ? (at[other] ?? NOWHERE) : NOWHERE) : (trial[m] ?? NOWHERE);
    if (place === NOWHERE) continue;
    if (overlaps(boxes, other, place, l, t, r, b)) return false;
  }
  return true;
}

/**
 * Room for label `row` nowhere: is there a place of it where ONE label already placed is all that
 * is in the way, and can that one move to another of its own places, with real room there (a keep
 * closer, where it was last time), clear of this label and of every label still to be placed
 * where it showed last time? Then it moves, and this label takes that place. One of the same
 * kind (`DeclutterRules`) may go to any of its places; one of a more important kind (a system's
 * name, in the way of a planet's) only back to its first place, with room to spare there, as it
 * would by itself; a firm one, or a `young` one, nowhere. Nothing else moves, and nothing that
 * showed is hidden for it. Places that lie on less first, for both. The place, or -1.
 */
function makeRoom(
  boxes: LabelBoxes,
  row: number,
  k: number,
  params: DeclutterParams,
  taken: Readonly<TakenBoxes> | undefined,
  rules: DeclutterRules,
): number {
  const { places, left, top, width, height, priority, shown, young, order, at, was, covers } =
    boxes;
  const { gapPx, keepPx } = params;
  const kind = kindOf(priority[row], rules);
  if (kind === 0) return -1;
  const w = width[row] ?? 0;
  const h = height[row] ?? 0;
  for (let i = 0; i < COVERS * places; i += 1) {
    const p = i % places;
    if (coverOf(covers[row * places + p]) !== Math.floor(i / places)) continue;
    const pl = left[row * places + p] ?? Number.NaN;
    const pt = top[row * places + p] ?? Number.NaN;
    if (!Number.isFinite(pl) || !Number.isFinite(pt)) continue;
    const pad = p === was[row] ? gapPx - keepPx : gapPx;
    if (!clearOfTaken(pl - pad, pt - pad, pl + w + pad, pt + h + pad, taken)) continue;
    // Who is in the way: exactly one label, one that may move, or this place is no good.
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
    if (blockers !== 1 || young[blocker]) continue;
    const own = kindOf(priority[blocker], rules);
    if (own === 0) continue;
    // One of its own kind may go to any of its places. One of another (a system's name, in the
    // way of a planet's) only back to its first, as it would by itself had it room to spare.
    const firstOnly = own !== kind;
    const from = at[blocker] ?? 0;
    if (
      firstOnly &&
      (from === 0 || (covers[blocker * places] ?? 0) > (covers[blocker * places + from] ?? 0))
    ) {
      continue;
    }
    const bw = width[blocker] ?? 0;
    const bh = height[blocker] ?? 0;
    for (let j = 0; j < (firstOnly ? 1 : COVERS * places); j += 1) {
      const q = j % places;
      if (
        q === from ||
        (!firstOnly && coverOf(covers[blocker * places + q]) !== Math.floor(j / places))
      ) {
        continue;
      }
      const qPad = firstOnly ? gapPx + keepPx : q === was[blocker] ? gapPx - keepPx : gapPx;
      if (!fits(boxes, blocker, q, qPad, k, blocker, taken)) continue;
      if (!clearOfWaiting(boxes, blocker, q, qPad, k)) continue;
      // ...and clear of this label, in its new place.
      const ql = left[blocker * places + q] ?? 0;
      const qt = top[blocker * places + q] ?? 0;
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

/**
 * Is place `p` of label `row` clear, `pad` round it, of every label still to be placed (after
 * position `k` in the order) where that label showed last time? What a label that is only
 * moving for its own sake (back to its first place), or for another's (`makeRoom`), must not
 * take from one that shows.
 */
function clearOfWaiting(
  boxes: LabelBoxes,
  row: number,
  p: number,
  pad: number,
  k: number,
): boolean {
  const { count, places, left, top, width, height, priority, order, was } = boxes;
  const pl = left[row * places + p] ?? Number.NaN;
  const pt = top[row * places + p] ?? Number.NaN;
  const l = pl - pad;
  const t = pt - pad;
  const r = pl + (width[row] ?? 0) + pad;
  const b = pt + (height[row] ?? 0) + pad;
  for (let m = k + 1; m < count; m += 1) {
    const other = order[m] ?? 0;
    const place = was[other] ?? NOWHERE;
    if (place === NOWHERE || other === row || !Number.isFinite(priority[other] ?? Infinity)) {
      continue;
    }
    if (overlaps(boxes, other, place, l, t, r, b)) return false;
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
 * How much a place may lie on (`LabelBoxes.covers`): nothing (0); something it had better not
 * (1), which a label takes only where it has no place that lies on less, and keeps once it shows
 * there, whatever drifts under it; or something it must not, but as a last resort (`MUST_NOT`),
 * which it also leaves, once it may, for a place that lies on less.
 */
const COVERS = 3;
const MUST_NOT = 2;

/** How much a place lies on: 0 to `COVERS - 1`. */
function coverOf(level: number | undefined): number {
  return Math.min(level ?? 0, COVERS - 1);
}

/** Is this a candidate's priority, and below `limit`? */
function isBelow(priority: number | undefined, limit: number): boolean {
  return Number.isFinite(priority ?? Infinity) && (priority ?? Infinity) < limit;
}

/** 0: firm. 1: placed together. 2: the rest (`DeclutterRules`). */
function kindOf(priority: number | undefined, rules: DeclutterRules): number {
  if (isBelow(priority, rules.firm)) return 0;
  return isBelow(priority, rules.together) ? 1 : 2;
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
