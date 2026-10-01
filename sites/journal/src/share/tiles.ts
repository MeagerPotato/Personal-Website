/**
 * Where the month snapshot's photos go (share/snapshot.ts): side by side in one row or, for two to
 * four of them, in two rows: two stacked, four in a grid, three as one large (the first) beside
 * two small. Each arrangement takes the room the snapshot gives it and grows towards the
 * photos' own shape, a tile never taller than 3:4; then the one that shows them best is drawn.
 * Each tile counts its area times the square of the share of its photo it shows, so a photo cut
 * in half is worth a quarter of its tile: landscape photos take two rows when that lets them grow,
 * portrait ones only when one row would leave most of the room empty.
 */

/** A photo's place, from the top left corner of the photos' block. */
export interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PhotoBlock {
  height: number;
  /** One per photo, in their order. */
  tiles: Tile[];
}

/** No tile is taller than 3:4 (height over width): past that, a photo is a sliver. */
const TALLEST = 4 / 3;

/** A photo's tile before the row height is chosen. */
interface Slot {
  /** The photo's width over its height. */
  aspect: number;
  x: number;
  w: number;
  row: number;
  /** Both rows and the gap between them (the large one of three). */
  tall: boolean;
}

function slots(aspects: readonly number[], rows: 1 | 2, width: number, gap: number): Slot[] {
  const count = aspects.length;
  const half = (width - gap) / 2;
  const large = Math.round(((width - gap) * 2) / 3);
  return aspects.map((aspect, i) => {
    if (rows === 1) {
      const w = (width - gap * (count - 1)) / count;
      return { aspect, x: i * (w + gap), w, row: 0, tall: false };
    }
    if (count === 2) return { aspect, x: 0, w: width, row: i, tall: false };
    if (count === 3) {
      return i === 0
        ? { aspect, x: 0, w: large, row: 0, tall: true }
        : { aspect, x: large + gap, w: width - large - gap, row: i - 1, tall: false };
    }
    return { aspect, x: (i % 2) * (half + gap), w: half, row: Math.floor(i / 2), tall: false };
  });
}

/**
 * Arranges photos, given as their widths over their heights, in a block `width` wide and between
 * `least` (the room the snapshot kept for them) and `most` (all the room there is) tall.
 */
export function arrangePhotos(
  aspects: readonly number[],
  width: number,
  gap: number,
  least: number,
  most: number,
): PhotoBlock {
  const count = aspects.length;
  if (count === 0) return { height: 0, tiles: [] };
  const choices: (1 | 2)[] = count >= 2 && count <= 4 ? [1, 2] : [1];
  const arranged = choices.map((rows) => {
    const layout = slots(aspects, rows, width, gap);
    // The row height at which a slot is `ratio` times as tall as it is wide, and the row height
    // a block of `height` has.
    const rowAt = (slot: Slot, ratio: number) =>
      slot.tall ? (slot.w * ratio - gap) / 2 : slot.w * ratio;
    const rowOf = (height: number) => (height - gap * (rows - 1)) / rows;
    // As tall as the photos' own shapes on average, as far as the room and 3:4 allow, and never
    // shorter than the room kept.
    const natural = layout.reduce((sum, slot) => sum + rowAt(slot, 1 / slot.aspect), 0) / count;
    const tallest = Math.min(...layout.map((slot) => rowAt(slot, TALLEST)));
    const row = Math.max(
      0,
      Math.floor(Math.max(rowOf(least), Math.min(rowOf(most), natural, tallest))),
    );
    let score = 0;
    const tiles = layout.map((slot) => {
      const tile = {
        x: slot.x,
        y: slot.row * (row + gap),
        w: slot.w,
        h: slot.tall ? row * 2 + gap : row,
      };
      const shape = tile.w / tile.h / slot.aspect;
      const shown = Math.min(shape, 1 / shape);
      score += tile.w * tile.h * shown * shown;
      return tile;
    });
    return { block: { height: row * rows + gap * (rows - 1), tiles }, score };
  });
  return arranged.reduce((best, next) => (next.score > best.score ? next : best)).block;
}
