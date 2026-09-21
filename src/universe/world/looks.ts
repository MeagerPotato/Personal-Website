import { tokens, type BiomeKey, type ThemeKey } from '../design/tokens';
import { tuning } from '../design/tuning';
import { hexToLinear } from '../sim/color';
import type { PlanetBands, PlanetLook } from '../sim/planet';

/** A planet's five colours, from its biome's tokens, in the linear space the generator paints in. */
export function biomeBands(biome: BiomeKey): PlanetBands {
  const colors = tokens.color.biome[biome];
  return {
    sea: hexToLinear(colors.sea),
    shore: hexToLinear(colors.shore),
    low: hexToLinear(colors.low),
    high: hexToLinear(colors.high),
    peak: hexToLinear(colors.peak),
  };
}

/** A sun in its system's colour family: mostly `base`, with lighter and darker patches. */
export function sunBands(theme: ThemeKey): PlanetBands {
  const colors = tokens.color.system[theme];
  const base = hexToLinear(colors.base);
  return {
    sea: base,
    shore: hexToLinear(colors.light),
    low: base,
    high: base,
    peak: hexToLinear(colors.shade),
  };
}

/** A sun is a smooth ball whose "heights" only choose between its colours. */
export function sunLook(): PlanetLook {
  return { ...tuning.planet, reliefShare: 0, seaLevel: -2 };
}
