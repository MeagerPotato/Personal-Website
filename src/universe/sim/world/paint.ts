import { TAU } from '../math';
import type { Rgb } from '../meshBuilder';
import type { FacetPainter, FacetPlace } from '../planet';
import { colorOf, type ColorPath } from './palette';

/**
 * PAINT OPS: a ground's facets recoloured by where they are, over the bands its heights chose.
 * Three ops do the work: a cap, a belt, a pie, a checker, a set of stripes and a spot are each
 * one of them with other arguments. Ops run in order and the last word wins; a facet no op
 * answers for keeps its band (and its nudge).
 *
 *   ['band', c0, c1, colour]                           facets between two colatitudes (0 is the
 *                                                     north pole, 1 the south): a cap when c0 is 0
 *   ['grid', rings, sectors, colours, c0, c1, phase?] rings x sectors between two colatitudes,
 *                                                     through the colours in turn (null: leave it)
 *   ['where', test, colour?]                          facets where `test(place)` holds: that colour,
 *                                                     or the colour the test itself answers
 */

/** A colour as the rows name it, or one already resolved (a stripe's colours, chosen by a test). */
export type PaintColor = ColorPath | Rgb;

export type PaintOp =
  | readonly ['band', c0: number, c1: number, color: PaintColor]
  | readonly [
      'grid',
      rings: number,
      sectors: number,
      colors: readonly (PaintColor | null)[],
      c0: number,
      c1: number,
      phase?: number,
    ]
  | readonly ['where', test: (place: FacetPlace) => boolean | Rgb | undefined, color?: PaintColor];

const resolve = (color: PaintColor): Rgb => (typeof color === 'string' ? colorOf(color) : color);

type Op = (place: FacetPlace) => Rgb | undefined;

function compile(op: PaintOp): Op {
  switch (op[0]) {
    case 'band': {
      const [, c0, c1, color] = op;
      const rgb = resolve(color);
      return ({ colat }) => (colat >= c0 && colat < c1 ? rgb : undefined);
    }
    case 'grid': {
      const [, rings, sectors, colors, c0, c1, phase = 0] = op;
      const rgbs = colors.map((color) => (color === null ? undefined : resolve(color)));
      return ({ colat, az }) => {
        if (!(colat >= c0 && colat < c1)) return undefined;
        const ring = Math.floor(((colat - c0) / (c1 - c0)) * rings);
        const sector = Math.floor((((az + phase) / TAU + 1) % 1) * sectors);
        return rgbs[(ring + sector) % rgbs.length];
      };
    }
    case 'where': {
      const [, test, color] = op;
      const rgb = color === undefined ? undefined : resolve(color);
      return (place) => {
        const answer = test(place);
        if (!answer) return undefined;
        return rgb ?? (answer === true ? undefined : answer);
      };
    }
  }
}

/** The ops as one painter for the planet generator (sim/planet.ts, `paint`). */
export function painterOf(ops: readonly PaintOp[]): FacetPainter {
  const compiled = ops.map(compile);
  return (place) => {
    let color: Rgb | undefined;
    for (const op of compiled) color = op(place) ?? color;
    return color;
  };
}
