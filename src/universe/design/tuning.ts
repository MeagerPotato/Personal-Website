import type { FlightParams } from '../sim/types';

/**
 * TUNING: every number that shapes how the universe FEELS. Engine timings are in seconds,
 * distances in world units (1 u is about 1 m at toy scale).
 *
 * DESIGN SURFACE (docs/PLAN.md §5.6): values are free to change; shapes are owned by the logic
 * that consumes them. A block that ends in `satisfies <Params>` is checked against that logic's
 * contract, so an edit that breaks it is a type error, not a runtime surprise. (Type imports
 * only: tuning never imports logic.)
 */
export const tuning = {
  /**
   * The simulation clock (core/loop.ts). Flight constants are tuned AT this step rate: changing
   * stepHz changes how the ship feels, slightly, and invalidates recorded replays.
   */
  loop: {
    stepHz: 60,
    /** Longest frame that counts. After a stall (tab switch, GC pause) the rest never happened. */
    maxFrameSec: 0.1,
    /** Past this many steps in one frame the backlog is dropped: the world runs slow instead. */
    maxStepsPerFrame: 5,
  },

  /**
   * How the ship flies (sim/flight.ts). Top speed is thrustAccel / forwardDrag = 42.5 u/s, and
   * boostFactor times that with boost, about 81 u/s.
   */
  flight: {
    thrustAccel: 34,
    boostFactor: 1.9,
    /** 1/s. Also how quickly the ship coasts to a stop: about 1/forwardDrag seconds. */
    forwardDrag: 0.8,
    brakeDrag: 2.5,
    /** 1/s. Higher = goes where it points; lower = drifts through turns. */
    lateralGrip: 4,
    /** rad/s. Nimble at a standstill, wider at speed. */
    yawRateSlow: 2.6,
    yawRateFast: 1.5,
    yawRateFastSpeed: 80,
    /** Seconds for the turn rate to follow the stick. Below 0.08 feels twitchy, above 0.2 heavy. */
    yawResponseSec: 0.12,
  } satisfies FlightParams,

  viewport: {
    /** Pixels are the budget on phones. Cap the ratio AND the absolute pixel count. */
    maxPixelRatio: 2,
    maxPixelRatioCoarse: 1.5,
    maxMegapixels: 4,
    minPixelRatio: 0.5,
  },

  camera: {
    fovDegrees: 55,
    near: 0.1,
    far: 2000,
  },

  starfield: {
    /** Changing the seed reshuffles the whole sky; keep it stable so screenshots stay comparable. */
    seed: 'allenkh-starfield',
    count: 4000,
    countCoarse: 2000,
    /** Stars live on a thick shell around the camera, far enough to read as "infinitely far". */
    radiusMin: 400,
    radiusMax: 1000,
    /** Point size in CSS px. Sizes are cubed-random: many small stars, few large ones. */
    sizeMin: 1.1,
    sizeMax: 3.4,
    /** Palette weights: [token name under color.star, share]. */
    palette: [
      ['white', 0.6],
      ['cool', 0.25],
      ['warm', 0.15],
    ],
    brightnessMin: 0.45,
    twinkleShare: 0.2,
    twinkleDepth: 0.55,
    /** Whole-sky drift, radians per second. Off under reduced motion. */
    driftRadPerSec: 0.004,
  },

  /**
   * Where things sit. Read at BUILD time by data/layout.ts, which bakes positions into
   * /universe.json: changing a value here rearranges the galaxy on the next build.
   */
  layout: {
    /** Systems sit on a sunflower spiral: slot k is slotDistance * sqrt(k) out, k golden angles round. */
    slotDistance: 1000,
    goldenAngleDeg: 137.5,
    /** Each system is nudged off its slot by up to this much, seeded by its id, so the spiral never looks mechanical. */
    slotJitter: 100,

    sunRadius: 20,
    /** Nothing orbits closer to a sun's surface than this (the autopilot's keep-out, plus headroom). */
    sunClearance: 25,
    /** Radius by the `planet.size` a project chooses. Moons are projects too, just smaller. */
    planetRadius: { s: 5, m: 8, l: 12 },
    moonRadius: { s: 1.2, m: 1.8, l: 2.5 },
    /** Docking orbit around a body of radius R: R + max(dockMin, dockScale * R). */
    dockMin: 6,
    dockScale: 0.9,

    /** The first ring is at least this far from the sun's centre; rings then clear each other by orbitGap. */
    orbitStart: 60,
    orbitGap: 8,
    /** Moons (and the home system's station and satellite) pack tighter than planets do. */
    moonGap: 4,
    /** Tripwires: a system that outgrows its radius, or sits this close to a neighbour, fails the build. */
    maxSystemRadius: 380,
    minSystemGap: 150,
    /** Orbital period in seconds: periodAtStartSec * (r / orbitStart) ^ periodExponent. */
    periodAtStartSec: 240,
    periodExponent: 1.5,

    /** The home system has no sun: the home planet sits at its centre and the rest orbits it. */
    home: {
      theme: 'butter',
      biome: 'terra',
      planetRadius: 14,
      stationRadius: 2.2,
      satelliteRadius: 1.6,
    },
  },
} as const;

export type Tuning = typeof tuning;
