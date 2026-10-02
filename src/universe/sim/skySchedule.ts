/**
 * WHEN THE SKY IS PAINTED. The sky's panorama (world/SkyBake.ts) is drawn once, after the first
 * frame, in horizontal bands of rows, so that no frame carries the whole of it: a desktop paints
 * a band in a tenth of a millisecond, a phone in several.
 *
 * The rule: one band a frame while frames are quick; one band every second frame once the frame
 * before took `slowMs` or longer (the device is busy: the planets are being built in those same
 * frames); and two bands a frame for a visitor who has seen the sky already (an engine rebuilt
 * after a lost context), who is waiting for it to come back.
 *
 * Pure: it is told how long the last frame took and says how many bands this one draws.
 */
export interface SkySchedule {
  /** Bands still to draw. */
  readonly left: number;
  /** How many bands to draw in this frame (0, 1 or 2), given how long the frame before took. */
  next(lastFrameMs: number): number;
}

/** The number of bands that cover `rows` rows, `bandRows` at a time. */
export function bandCount(rows: number, bandRows: number): number {
  return Math.ceil(rows / Math.max(1, bandRows));
}

export function createSkySchedule(bands: number, slowMs: number, hurry: boolean): SkySchedule {
  let left = Math.max(0, Math.floor(bands));
  let rested = true;
  return {
    get left() {
      return left;
    },
    next(lastFrameMs) {
      // A slow frame that drew a band is followed by one that draws none.
      const draw = hurry ? 2 : lastFrameMs < slowMs || rested ? 1 : 0;
      rested = draw === 0;
      const drawn = Math.min(draw, left);
      left -= drawn;
      return drawn;
    },
  };
}
