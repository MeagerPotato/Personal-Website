import type { ChaseCamParams } from '../camera/ChaseCam';
import type { PointerSteerParams } from '../core/input/PointerSteer';
import type { TouchParams } from '../core/input/TouchControls';
import type { ShipLookParams } from '../ship/ShipSystem';
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

  /** How fingers and the mouse become flight (core/input/). The keyboard has nothing to tune. */
  input: {
    /** The touch stick: how far the knob travels (CSS px), and the dead middle as a share of that. */
    stickRadiusPx: 56,
    stickDeadZone: 0.14,
    /** Degrees off "straight up" at which the turn is full. Smaller = twitchier. */
    stickFullTurnDeg: 65,
    /** Half-angle of the cone around "straight down" that means brake. */
    stickBrakeConeDeg: 30,
    /** EXPERIMENT, for the playtest to decide: hold the mouse button to fly toward the cursor. */
    pointerSteer: false,
    pointerFullTurnShare: 0.6,
  } satisfies TouchParams & PointerSteerParams,

  /**
   * How the ship LOOKS while it flies (ship/ShipSystem.ts). None of this reaches the flight model:
   * the lean, the nod and the bob are worn by the model only, and the camera ignores them.
   */
  ship: {
    /** Where a new visitor starts, and which way they face (degrees, counter-clockwise from +Z). */
    spawn: { x: 12, z: -52, headingDeg: 20 },
    /** Lean into a turn: this many radians at the full turn rate, fading in up to bankFullSpeed. */
    bankRad: 0.6,
    bankFullSpeed: 15,
    /** Nose up under boost, nose down under the brake. pitchOmega is how fast it nods (rad/s). */
    pitchBoostDeg: 5,
    pitchBrakeDeg: 4,
    pitchOmega: 8,
    /** A slow hover so a parked ship still looks alive. Off under reduced motion. */
    bobAmplitude: 0.25,
    bobHz: 0.4,
    flame: {
      /** Radius of the flame at its widest, and its length at full thrust and under boost (u). */
      width: 0.23,
      lengthCruise: 1.15,
      lengthBoost: 2.2,
      boostWidthFactor: 1.3,
      /** 1/s. How quickly the flame follows the throttle. */
      responsePerSec: 14,
      /** Share of the length that flickers. Off under reduced motion. */
      flicker: 0.14,
      /** 1 until bloom exists; above 1 it will glow (shaders/glow.ts). */
      intensity: 1,
    },
  } satisfies ShipLookParams,

  /** The camera that follows the ship (camera/ChaseCam.ts). It never rolls. */
  chaseCam: {
    /** Where the camera sits, relative to the point it trails behind the ship (u). */
    back: 11,
    up: 5.5,
    /** It looks this far ahead of that point: base + perSpeed * speed. Faster = further ahead. */
    lookAheadBase: 4,
    lookAheadPerSpeed: 0.18,
    /**
     * Springs, rad/s: higher = stiffer. The camera trails the ship by 2 * speed / positionOmega
     * units, easing into a limit of maxTrail (so about 4.4 u at cruise and 5.3 u under boost), and
     * its swing trails a turn by 2 * turnRate / yawOmega radians. That slack is what lets you SEE
     * the ship turn and pull away.
     */
    positionOmega: 14,
    maxTrail: 5.5,
    yawOmega: 12,
    /** The view widens with speed: +fovBoostDegrees between these two speeds. Not under reduced motion. */
    fovBoostDegrees: 13,
    fovBoostSpeeds: [35, 80],
    /**
     * A wider lens shrinks the ship. 0 = let it; 1 = move in exactly enough to keep its size, while
     * the sky still stretches (a dolly zoom).
     */
    fovDolly: 0.5,
    /**
     * Tall screens: never let the HORIZONTAL view get narrower than this (the vertical one grows
     * instead, up to maxFovDegrees), and back the camera off by up to portraitDistanceScale.
     */
    minHorizontalFovDegrees: 40,
    maxFovDegrees: 95,
    portraitDistanceScale: 1.3,
  } satisfies ChaseCamParams,

  viewport: {
    /** Pixels are the budget on phones. Cap the ratio AND the absolute pixel count. */
    maxPixelRatio: 2,
    maxPixelRatioCoarse: 1.5,
    maxMegapixels: 4,
    minPixelRatio: 0.5,
  },

  camera: {
    fovDegrees: 55,
    /**
     * Nothing comes closer to the camera than a few units, and a far-away system must still draw,
     * so the depth range is pushed out at both ends. (The sky ignores it: see shaders/sky.ts.)
     */
    near: 0.5,
    far: 12000,
  },

  /** The three bands of the toon shader (shaders/toonFlat.ts). */
  shading: {
    /**
     * A facet's "facing" is the cosine of the angle between its normal and the direction to the
     * sun: 1 faces it, 0 is edge-on, -1 faces away. Below the first edge a facet is in shade;
     * above the second it is fully lit; between them it is the middle band.
     */
    bandEdges: [-0.12, 0.38],
    /** How lit the middle band is: 0 = same as shade, 1 = same as lit. */
    midLevel: 0.55,
  },

  /** The backdrop behind the stars (world/Backdrop.ts). */
  backdrop: {
    /** Higher = a thinner, sharper glow along the horizon. */
    horizonFalloff: 3.2,
    /**
     * Up to four huge, soft glows of colour at fixed places in the sky. `theme` picks a colour
     * family from tokens (its shade); `direction` is [x, y, z] and need not be normalised (y is
     * up: the chase camera looks down, so the sky from 45 degrees BELOW the horizon to 10 above is
     * what is seen the most); `tightness` is how small the glow is (4 = a third of the sky, 12 = a
     * patch); `strength` is how much colour is added at its centre. Keep them whisper-quiet, and
     * keep warm colours small and high: on navy a big warm glow reads as brown.
     */
    glows: [
      { theme: 'lilac', direction: [-0.7, -0.35, -0.6], tightness: 5, strength: 0.075 },
      { theme: 'sky', direction: [0.8, -0.15, -0.55], tightness: 7, strength: 0.065 },
      { theme: 'mint', direction: [0.3, -0.45, 0.85], tightness: 7, strength: 0.04 },
      { theme: 'coral', direction: [-0.65, 0.4, 0.6], tightness: 12, strength: 0.03 },
    ],
  },

  /** Space dust: the motes that slide past and tell you that you are moving (world/SpaceDust.ts). */
  dust: {
    seed: 'allenkh-dust',
    count: 520,
    countCoarse: 260,
    /** The motes live in a box this size (x, y, z in units) that follows the ship. */
    box: [260, 70, 260],
    /** World radius of an average mote, in units, and how much sizes vary around it. */
    radius: 0.075,
    sizeVariation: 0.6,
    brightnessMin: 0.25,
    opacity: 0.6,
    /** A streak shows this many seconds of motion. 0 under reduced motion. */
    streakSec: 0.045,
  },

  starfield: {
    /** Changing the seed reshuffles the whole sky; keep it stable so screenshots stay comparable. */
    seed: 'allenkh-starfield',
    count: 4000,
    countCoarse: 2000,
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
