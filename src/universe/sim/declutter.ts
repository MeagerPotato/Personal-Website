/**
 * WHICH LABELS MAY SHOW. Names over a crowded sky overlap, and overlapping names are worse than
 * missing ones. Greedy, by importance: the most important label is placed, then the next one that
 * does not touch anything placed so far, and so on. Pure, allocation-free, and steady from frame
 * to frame: a label that shows keeps showing until it really is in the way, and a hidden one only
 * appears when there is real room for it, so nothing flickers while things drift past each other.
 */

export interface LabelBoxes {
  count: number;
  /** Top-left corner and size of each label, in CSS px. */
  readonly left: Float64Array;
  readonly top: Float64Array;
  readonly width: Float64Array;
  readonly height: Float64Array;
  /** Lower is more important. Not finite (Infinity, NaN): this label is not a candidate at all. */
  readonly priority: Float64Array;
  /** In: whether each label showed last time. Out: whether it shows now. */
  readonly shown: Uint8Array;
  /** Scratch: the rows by priority. Kept from call to call, because it is nearly sorted already. */
  readonly order: Int32Array;
}

export function createLabelBoxes(capacity: number): LabelBoxes {
  const order = new Int32Array(capacity);
  for (let i = 0; i < capacity; i += 1) order[i] = i;
  return {
    count: 0,
    left: new Float64Array(capacity),
    top: new Float64Array(capacity),
    width: new Float64Array(capacity),
    height: new Float64Array(capacity),
    priority: new Float64Array(capacity).fill(Infinity),
    shown: new Uint8Array(capacity),
    order,
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

/** Decide `boxes.shown` for this frame. */
export function declutter(
  boxes: LabelBoxes,
  params: DeclutterParams,
  taken?: Readonly<TakenBoxes>,
): void {
  const { count, left, top, width, height, priority, shown, order } = boxes;

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

  let placed = 0;
  for (let k = 0; k < count; k += 1) {
    const row = order[k] ?? 0;
    if (!Number.isFinite(priority[row] ?? Infinity) || placed >= params.max) {
      shown[row] = 0;
      continue;
    }
    const pad = shown[row] ? params.gapPx - params.keepPx : params.gapPx;
    const l = (left[row] ?? 0) - pad;
    const t = (top[row] ?? 0) - pad;
    const r = (left[row] ?? 0) + (width[row] ?? 0) + pad;
    const b = (top[row] ?? 0) + (height[row] ?? 0) + pad;
    let free = true;
    // What was there first: the same gap, and the same patience with a label that shows already.
    for (let m = 0; m < (taken?.count ?? 0) && free; m += 1) {
      const box = taken?.boxes[m];
      if (!box) continue;
      free = !(l < box.left + box.width && r > box.left && t < box.top + box.height && b > box.top);
    }
    // Everything before it in the order that shows is already placed.
    for (let m = 0; m < k && free; m += 1) {
      const other = order[m] ?? 0;
      if (!shown[other]) continue;
      const ol = left[other] ?? 0;
      const ot = top[other] ?? 0;
      free = !(l < ol + (width[other] ?? 0) && r > ol && t < ot + (height[other] ?? 0) && b > ot);
    }
    shown[row] = free ? 1 : 0;
    if (free) placed += 1;
  }
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

/** Rows that are no candidates sort last, whatever nonsense their priority holds. */
function sortKey(priority: number): number {
  return Number.isFinite(priority) ? priority : Infinity;
}
