// How far apart two colours look, to an eye with normal colour vision and to one without: the
// CIEDE2000 difference, and the Vienot simulation of protanopia, deuteranopia and tritanopia.
// Beside ./contrast.ts, which answers "can it be read"; this answers "can it be told from that
// one". Only tests import it (design/tokens.test.ts), so no page and no engine chunk carries it.
//
// Pure: hex strings in, numbers out.

type Triple = readonly [number, number, number];
type Matrix = readonly [Triple, Triple, Triple];

/** The three kinds of dichromacy, as matrices on linear sRGB (Vienot, Brettel and Mollon 1999). */
export const DEFICIENCIES = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
} as const satisfies Record<string, Matrix>;

export type Deficiency = keyof typeof DEFICIENCIES;
export const DEFICIENCY_KEYS = Object.keys(DEFICIENCIES) as Deficiency[];

const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** A #rrggbb colour in linear light, each channel 0 to 1. */
function linearOf(hex: string): Triple {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const value = Number.parseInt(match[1], 16);
  return [
    toLinear(((value >> 16) & 0xff) / 255),
    toLinear(((value >> 8) & 0xff) / 255),
    toLinear((value & 0xff) / 255),
  ];
}

const dot = (row: Triple, v: Triple): number => row[0] * v[0] + row[1] * v[1] + row[2] * v[2];

/** Linear sRGB as that eye sees it (clamped into the gamut, as a screen would). */
function seenBy(linear: Triple, deficiency: Deficiency | undefined): Triple {
  if (!deficiency) return linear;
  const m = DEFICIENCIES[deficiency];
  return [clamp01(dot(m[0], linear)), clamp01(dot(m[1], linear)), clamp01(dot(m[2], linear))];
}

/** Linear sRGB to CIE L*a*b* (D65). */
function labOf(linear: Triple): Triple {
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(dot([0.4124564, 0.3575761, 0.1804375], linear) / 0.95047);
  const fy = f(dot([0.2126729, 0.7151522, 0.072175], linear));
  const fz = f(dot([0.0193339, 0.119192, 0.9503041], linear) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const RAD = Math.PI / 180;

/** CIEDE2000 between two L*a*b* colours: about 1 is the smallest difference an eye notices. */
function ciede2000([L1, a1, b1]: Triple, [L2, a2, b2]: Triple): number {
  const meanC = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(meanC ** 7 / (meanC ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1 = Math.hypot(a1p, b1);
  const C2 = Math.hypot(a2p, b2);
  const h1 = (Math.atan2(b1, a1p) / RAD + 360) % 360;
  const h2 = (Math.atan2(b2, a2p) / RAD + 360) % 360;
  const grey = C1 * C2 === 0;

  const dL = L2 - L1;
  const dC = C2 - C1;
  let dh = h2 - h1;
  if (grey) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh * RAD) / 2);

  const L = (L1 + L2) / 2;
  const C = (C1 + C2) / 2;
  let h = h1 + h2;
  if (!grey) h = Math.abs(h1 - h2) <= 180 ? h / 2 : (h + (h < 360 ? 360 : -360)) / 2;

  const T =
    1 -
    0.17 * Math.cos((h - 30) * RAD) +
    0.24 * Math.cos(2 * h * RAD) +
    0.32 * Math.cos((3 * h + 6) * RAD) -
    0.2 * Math.cos((4 * h - 63) * RAD);
  const Sl = 1 + (0.015 * (L - 50) ** 2) / Math.sqrt(20 + (L - 50) ** 2);
  const Sc = 1 + 0.045 * C;
  const Sh = 1 + 0.015 * C * T;
  const Rc = 2 * Math.sqrt(C ** 7 / (C ** 7 + 25 ** 7));
  const Rt = -Math.sin(60 * Math.exp(-(((h - 275) / 25) ** 2)) * RAD) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

/**
 * How different two colours look (CIEDE2000), to a normal eye or under a deficiency. Order does
 * not matter. As a rule of thumb: under 2 is "the same at a glance", 5 is plainly two colours,
 * 10 and more is two colours anyone would name differently.
 */
export function difference(a: string, b: string, deficiency?: Deficiency): number {
  return ciede2000(labOf(seenBy(linearOf(a), deficiency)), labOf(seenBy(linearOf(b), deficiency)));
}

/** The two colours of a named set that look most alike, and how different they still are. */
export function closestPair(
  colours: Readonly<Record<string, string>>,
  deficiency?: Deficiency,
): { difference: number; pair: readonly [string, string] } {
  const names = Object.keys(colours);
  let best: { difference: number; pair: readonly [string, string] } = {
    difference: Infinity,
    pair: ['', ''],
  };
  for (const [i, first] of names.entries()) {
    for (const second of names.slice(i + 1)) {
      const d = difference(colours[first] ?? '', colours[second] ?? '', deficiency);
      if (d < best.difference) best = { difference: d, pair: [first, second] };
    }
  }
  return best;
}
