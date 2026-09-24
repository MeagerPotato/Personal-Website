import type { RigParams } from '../camera/CameraRig';
import type { ChaseCamParams } from '../camera/ChaseCam';
import type { MapCamParams } from '../camera/MapCam';
import type { CruiseParams } from '../sim/autopilot';
import type { OrbitCamParams } from '../camera/OrbitCam';
import type { PointerSteerParams } from '../core/input/PointerSteer';
import type { TouchParams } from '../core/input/TouchControls';
import type { JobBudget } from '../core/jobs';
import type { GovernorParams } from '../core/quality/governor';
import type { QualityTier, TierSettings } from '../core/quality/tiers';
import type { PostParams } from '../fx/PostFX';
import type { ShipLookParams } from '../ship/ShipSystem';
import type { AssistParams } from '../sim/assist';
import type { CushionParams, EdgeParams } from '../sim/collide';
import type { DockParams } from '../sim/docking';
import type { PlanetLook } from '../sim/planet';
import type { FlightParams } from '../sim/types';
import type { LabelsParams } from '../ui/Labels';
import type { PickerParams } from '../ui/Picker';
import type { StarMapParams } from '../ui/StarMap';
import type { MapLookParams } from '../world/Galaxy';

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

  /**
   * THE AUTOPILOT (sim/autopilot.ts): flies the ship to a body that is out of reach, then hands
   * over to the docking approach. It flies the ordinary flight model with a stronger DRIVE, so a
   * trip between systems takes seconds while the pilot's own top speed stays what it is.
   */
  cruise: {
    flight: {
      /**
       * Top speed is thrustAccel / forwardDrag = 3,200 u/s, and at the `far` profile's cruising
       * speed there is still thrustAccel - forwardDrag * cruiseSpeed = 600 u/s² to spare: the
       * profile is what the ship can really do. The brake is retro-thrusters: strong, so arriving
       * is quick. Far nimbler than the pilot's own engine, and gripping the way it points: a
       * journey starts with a snap turn, and goes round a planet in the way without a skid. (How
       * fast it turns decides more of a journey's time than how fast it goes: most of a journey
       * is spent leaving one crowded system and arriving in another.)
       */
      thrustAccel: 800,
      boostFactor: 1,
      forwardDrag: 0.25,
      brakeDrag: 6,
      lateralGrip: 12,
      yawRateSlow: 7,
      yawRateFast: 4,
      yawRateFastSpeed: 150,
      yawResponseSec: 0.06,
    } satisfies FlightParams,
    path: {
      /** u between the points of a planned path. */
      sampleStep: 4,
      /** A way round a body passes this many keep-out radii from its centre. */
      clearance: 1.15,
      /** A moving ship's path begins the way it is going, for this many seconds' worth of travel. */
      leadSec: 0.5,
      /** No gap between two bodies is ever planned shut: their keep-outs shrink to leave this, u ... */
      corridor: 6,
      /** ... but never to less than this share of themselves. */
      squeeze: 0.8,
    },
    /** Journeys shorter than shortLeg (u) are flown by `near`, longer than longLeg by `far`, and in between by a blend. */
    shortLeg: 150,
    longLeg: 600,
    /**
     * Inside a system: brisk, and gentle in the bends. u/s and u/s². `brakeRate` (1/s) is what the
     * ship's brake really does at low speed: keep it below flight.brakeDrag + flight.forwardDrag.
     */
    near: {
      cruiseSpeed: 200,
      accel: 350,
      decel: 350,
      lateralAccel: 300,
      brakeRate: 5,
      /** rad/s at speed: 0.9 of flight.yawRateFast (slower, the profile counts on more). */
      yawRate: 3.6,
      minSpeed: 6,
    },
    /** Between systems. */
    far: {
      cruiseSpeed: 700,
      accel: 550,
      decel: 600,
      lateralAccel: 500,
      brakeRate: 5,
      yawRate: 3.6,
      minSpeed: 6,
    },
    /** Every body is kept clear of by its docking ring plus this, u. */
    keepOut: 4,
    /** A planet with its moons is gone round as one disc when that disc is no bigger than this, u. */
    familyReach: 120,
    /** The journey ends this many ring radii out (inside assist.soiRadii), and is taken into orbit there. */
    handOffRadii: 1.3,
    /** Seconds between plans: bodies move, and no ship follows a path exactly. */
    replanSec: 0.5,
    /** Steer at the point this many seconds ahead on the path, within these distances (u)... */
    lookAheadSec: 0.5,
    lookAhead: [6, 900],
    /** ...but never so far ahead that a bend is cut short by more than this, u. */
    cornerCut: 2.5,
    /** 1/s: how hard the throttle chases the profile's speed. */
    speedGain: 6,
    /** u/s. Inside a keep-out (leaving a ring, arriving beside a moon): no faster than this... */
    keepOutSpeed: 50,
    /** ...and outside, this much more (1/s) for each unit of room from the nearest one... */
    openSpaceGain: 5,
    /** ...counting only the speed TOWARD it, but at least this share of the whole speed. */
    passShare: 0.3,
    /** s. No journey is quicker, however near the next moon: a hop still reads as a journey. */
    minJourneySec: 1.5,
    /**
     * 1/s. A journey handed back at speed (Stop, or a touch of the controls) loses what the
     * pilot's own drive could never make at this rate: from 700 u/s the ship is back to its own
     * top speed within 0.7 s and 160 u, instead of coasting on for 875 u.
     */
    dropOutPerSec: 5,
  } satisfies CruiseParams,

  /**
   * ORBIT ASSIST (sim/assist.ts): let go of the controls near a planet and the ship eases onto a
   * ring around it. A virtual pilot does it with the ordinary stick and throttle, and the real
   * pilot always wins. The ring of each body is its `dockRadius` in the manifest.
   */
  assist: {
    /** Pace on the ring, u/s, but never more than orbitMaxRate rad/s: small moons are circled calmly. */
    orbitSpeed: 14,
    orbitMaxRate: 0.55,
    /** The assist starts soiRadii ring radii out and is at full strength inside fullRadii. */
    soiRadii: 1.8,
    fullRadii: 1.2,
    /** How steeply the ship is led back to the ring (1 = 45 degrees), reached inwardReach ring radii off it. */
    inwardGain: 1.2,
    inwardReach: 0.6,
    /** Share of the assist that full thrust switches off. 1 = thrust always means "leave me alone". */
    thrustFade: 0.85,
    /** Ships passing faster than this (u/s) are left alone: fades out between the two speeds. */
    freeSpeeds: [30, 55],
    /** Full stick per radian of heading error, and how hard the pace is chased (1/s). */
    steerGain: 1.6,
    speedGain: 2,
    /** How much harder another body must pull before the assist changes its mind (0 to 1). */
    switchMargin: 0.15,
    /** Fly the other way round at this speed (u/s) and the assist follows suit. */
    spinFlipSpeed: 6,
    /**
     * Diving at a surface: the assist swings the nose along it, so the ship sweeps round a planet
     * instead of ramming it. By time to impact: nothing with deflectSec[1] seconds to spare,
     * everything at deflectSec[0]. "Impact" is deflectGap u above the surface; ships closing
     * slower than deflectSpeed u/s are left to settle on the cushion.
     */
    deflectSec: [0.5, 1.5],
    deflectGap: 2,
    deflectSpeed: 10,
  } satisfies AssistParams,

  /**
   * You cannot crash (sim/collide.ts): a damped cushion above every surface, and under it a shell
   * nothing passes. `accel` is the push where the cushion meets the shell; keep it well above the
   * boosted thrust (thrustAccel x boostFactor), or a boosting ship rides the shell.
   */
  cushion: {
    depth: 4,
    shellGap: 1,
    accel: 130,
    damping: 9,
    restitution: 0.2,
  } satisfies CushionParams,

  /**
   * You cannot get lost: past the edge of the world (the outermost system plus `margin` u) a pull
   * toward home grows by pullPerUnit u/s² for every unit travelled. No wall: at 0.08, a boosting
   * ship stalls about 800 u out, and a ship left alone drifts back.
   */
  edge: {
    margin: 500,
    pullPerUnit: 0.08,
  } satisfies EdgeParams,

  /**
   * Docking (sim/docking.ts). Asked to dock, the orbit assist's virtual pilot flies the ship onto
   * the ring by itself; on the ring the ship is carried round the body instead of being flown.
   */
  dock: {
    /** Carried from here on: this close to the ring (u), crossing it slower than this (u/s). */
    captureDistance: 0.5,
    captureRadialSpeed: 2,
    /**
     * The approach flies onto the ring at this pace (u/s), but never more than approachMaxRate
     * rad/s round the body, with the autopilot's drive: the ship arrives briskly, and the dock's
     * springs (settleOmega) slow it to the docked pace.
     */
    approachSpeed: 30,
    approachMaxRate: 1.5,
    /** The approach flies this much faster (u/s) for every unit it is still off the ring. */
    hurryPerUnit: 1,
    /** An approach that is still not on the ring after this long (s) is captured where it is. */
    approachTimeoutSec: 12,
    /** Docked: radians per second round the body, but never faster than maxSpeed u/s. */
    orbitRate: 0.35,
    maxSpeed: 14,
    /**
     * 1/s. How quickly the leftovers of a capture settle: higher is snappier. A journey is taken
     * into orbit beside the ring, not on it (sim/docking.ts, arrive): this is what brings it on.
     */
    settleOmega: 5,
    /** Steering beyond this leaves an approach or a dock (once the controls were let go of). */
    leaveDeadZone: 0.25,
  } satisfies DockParams,

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

  /** Pointing at a planet to go there (ui/Picker.ts, sim/screen.ts). */
  picking: {
    /** A press that travels further (CSS px) or lasts longer than this is steering, not pointing. */
    tapMaxPx: 10,
    tapMaxSec: 0.4,
    /**
     * However small a body looks, it can be hit within minTargetPx of its middle (a finger gets
     * the usual 44 px across); one that looks smaller than minVisiblePx (radius, CSS px) cannot be
     * picked at all, because nobody can see it.
     */
    mouse: { minTargetPx: 12, minVisiblePx: 1.5 },
    touch: { minTargetPx: 22, minVisiblePx: 1.5 },
  } satisfies PickerParams,

  /**
   * The names over the bodies (ui/Labels.ts, sim/declutter.ts). How they LOOK is CSS
   * (`.body-label`); these decide where they sit and which of them may show at once.
   */
  labels: {
    /** A name sits this far below the edge of its body (CSS px). */
    offsetPx: 2,
    /** A body that looks smaller than this (radius, CSS px) gets no name. */
    minVisiblePx: 1.5,
    /** Names keep this far from the sides and the bottom of the free view, and from the top bar. */
    edgePx: 8,
    /**
     * No name starts higher than this. The shell measures how far down the top bar's links really
     * reach (two rows on a phone) and names keep edgePx below that; this is the floor under it.
     */
    topPx: 84,
    /**
     * Names keep gapPx apart; one that shows already may stay until it is keepPx closer than that
     * (so nothing flickers while bodies drift past each other); never more than max at once.
     */
    gapPx: 4,
    keepPx: 8,
    max: 14,
  } satisfies LabelsParams,

  /**
   * How the ship LOOKS while it flies (ship/ShipSystem.ts). None of this reaches the flight model:
   * the lean, the nod and the bob are worn by the model only, and the camera ignores them.
   */
  ship: {
    /**
     * A new visitor starts this far from the home planet, facing it, on the side away from the
     * nearest other system and swung round by swingDeg, so that the first thing they see is home
     * with that system's sun beside it (sim/spawn.ts). The swing is about how far from the middle
     * of the view that sun sits: a phone held upright only sees 20 degrees to each side.
     */
    spawn: { distance: 118, swingDeg: 17 },
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
      /** Brightness of the flame's own colours (1 = exactly the tokens) ... */
      intensity: 1,
      /** ... and how much of it bleeds into the picture as bloom, 0 to 1 (shaders/glow.ts). */
      bloom: 1,
    },
  } satisfies ShipLookParams,

  /** The camera that follows the ship (camera/ChaseCam.ts). It never rolls. */
  chaseCam: {
    /** Where the camera sits, relative to the point it trails behind the ship (u). */
    back: 11,
    up: 4.4,
    /**
     * It looks this far ahead of that point: base + perSpeed * speed. Faster = further ahead.
     * Together with `up` this sets where the HORIZON sits on screen, and the horizon is where
     * every planet is: looking 14 u ahead from 4.4 u up puts it a third of the way down, clear of
     * the HUD, with the ship at about 70%. (Looking only 4 u ahead pushed the planets up under
     * the top bar and left the lower three quarters of the screen empty.)
     */
    lookAheadBase: 14,
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

  /** The camera of a docked ship: the body is the subject, the ship circles through the picture. */
  orbitCam: {
    fovDegrees: 40,
    /** Looking down from this far above the flight plane. */
    elevationDeg: 25,
    /** Standing this far round from where the light comes from: mostly day side, some night. */
    sunwardOffsetDeg: 35,
    /** What has to fit into the part of the view the panel leaves free, in docking-ring radii. */
    fitRingRadii: 1.15,
    /** The view wanders round the body, slowly. Off under reduced motion. */
    driftRadPerSec: 0.03,
  } satisfies OrbitCamParams,

  /** Changing between cameras, and making room for the info panel (camera/CameraRig.ts). */
  cameraRig: {
    /** Seconds from the chase view to the orbit view and back. A page opened on a planet cuts. */
    dockBlendSec: 1.2,
    /** 1/s. How quickly the view slides over when the panel opens, closes or changes size. */
    insetOmega: 7,
    /**
     * The depth range follows the camera out to the map: nothing is drawn nearer than nearShare of
     * the distance to what the camera looks at, and the far end is at least farShare times that
     * distance. Never tighter than `camera.near` and `camera.far` below, which is what flying gets.
     */
    nearShare: 0.02,
    farShare: 2,
  } satisfies RigParams & { dockBlendSec: number },

  /**
   * THE STAR MAP (ui/StarMap.ts, camera/MapCam.ts, sim/mapView.ts): the galaxy from straight
   * above, north up. M, the Map button or scrolling out opens it; pointing at a body flies there.
   */
  map: {
    /** A long lens from far away, so that a planet at the edge is as round as one in the middle. */
    fovDegrees: 12,
    /** Seconds from the flight view up to the map, and back down. A cut under reduced motion. */
    blendSec: 0.9,
    /**
     * How close the map zooms: world units across the SHORTER side of the free view. It opens on
     * everything (the galaxy, and the ship if it is out beyond it), snugly: fitMargin times the
     * room that needs, plus fitPadPx (CSS px) on every side for the names of the bodies at the
     * edge. It zooms out no further than zoomOutPastFit times that view (1: not at all), and the
     * galaxy is never dragged off: zoomed in, the view stays on it (to within fitPadPx of its
     * edge); further out, all of it stays in view. Past it is only empty space.
     */
    spanMin: 400,
    zoomOutPastFit: 1,
    fitMargin: 1.05,
    fitPadPx: 44,
    /** 1/s. How quickly the map settles after a step of the wheel or a key. */
    viewOmega: 12,
    /** Each CSS px of wheel zooms by e to this power: 0.0015 is about 16% a notch. */
    wheelZoomPerPx: 0.0015,
    /** Scrolling OUT this far (CSS px) in one go, while flying, opens the map: one firm notch. */
    wheelOpenPx: 100,
    /** The arrow keys move the map this fast (CSS px per second); + and - zoom by keyZoomStep. */
    keyPanPxPerSec: 700,
    keyZoomStep: 1.4,

    /**
     * HOW THE MAP LOOKS. `flatness`: how much of the sun's shading is taken out of every lit
     * surface, 0 (as in flight) to 1 (flat discs of pure token colour, Mini Motorways style).
     */
    flatness: 1,
    /** The stars dim to this share of themselves, and the dust is put away: a map is a calm thing. */
    starOpacity: 0.3,
    /**
     * No body looks smaller than this on the map (radius, CSS px), by kind: the galaxy is a few
     * pixels per hundred units, and a planet at its true size would be a speck.
     */
    minRadiusPx: { sun: 9, home: 8, planet: 6, moon: 3.5, station: 4, satellite: 4 },
    /**
     * A body that circles another shows once their two discs are apart, and is full size once they
     * are this far apart (CSS px): from far out a system is its sun, and its moons come last.
     */
    clearPx: 4,
    /** The ship is a marker: never shorter than twice this (CSS px). */
    shipRadiusPx: 9,
  } satisfies StarMapParams & MapCamParams & MapLookParams,

  /**
   * QUALITY (core/quality/). On a phone the budget is pixels, so a tier is mostly "how many
   * pixels, and what is done to them". Desktops start HIGH and phones MEDIUM; a probe in the
   * first seconds may demote once; nothing ever promotes. `?q=low|medium|high` forces a tier.
   */
  quality: {
    /** Never render below this pixel ratio, whatever the caps and the governor say. */
    minPixelRatio: 0.5,
    tiers: {
      /** Straight to the canvas, anti-aliased by the canvas itself. Phones are held to 30 fps. */
      low: { maxPixelRatio: 1.25, maxMegapixels: 1, post: false, msaaSamples: 4, maxFpsCoarse: 30 },
      medium: {
        maxPixelRatio: 1.5,
        maxMegapixels: 2.2,
        post: true,
        msaaSamples: 2,
        maxFpsCoarse: 0,
      },
      high: { maxPixelRatio: 2, maxMegapixels: 4, post: true, msaaSamples: 4, maxFpsCoarse: 0 },
    } satisfies Record<QualityTier, TierSettings>,
    /** The probe and the dynamic resolution (core/quality/governor.ts). Times in seconds. */
    governor: {
      warmupSec: 1.5,
      probeSec: 2,
      demoteBelowFps: 42,
      slowFactor: 1.15,
      scaleDown: 0.1,
      minScale: 0.6,
      scaleUp: 0.05,
      cleanSec: 5,
      holdSec: 2,
      cappedJitterMs: 2,
      cappedJsMs: 8,
    } satisfies GovernorParams,
  },

  /**
   * POST-PROCESSING (fx/PostFX.ts, shaders/post.ts), on the tiers that have it. Only things that
   * ask for it bloom (suns, the flame, a planet's ring: each has a `bloom` knob of its own), so
   * the pastel world stays crisp however strong the bloom is.
   */
  post: {
    /** How much of the blurred glow is added back, and how far it spreads (0 to 1). */
    bloomStrength: 0.9,
    bloomRadius: 0.72,
    /** Halvings of the picture that are blurred and summed: more = a wider, softer glow. */
    bloomLevels: 5,
    /** How much the corners darken (0 = not at all), from and to which distance from the middle
     * (0.5 is the middle of an edge, 0.71 a corner). */
    vignette: 0.2,
    vignetteRange: [0.35, 0.9],
  } satisfies PostParams,

  camera: {
    fovDegrees: 55,
    /**
     * Nothing comes closer to the camera than a few units, and a far-away system must still draw,
     * so the depth range is pushed out at both ends. (The sky ignores it: see shaders/sky.ts.)
     */
    near: 0.5,
    far: 12000,
  },

  /**
   * How a planet is shaped and painted (sim/planet.ts). Colours come from `tokens.color.biome`.
   * Changing anything here reshapes EVERY planet; a planet's own `seed` only picks which one it is.
   */
  planet: {
    /** Height of the highest peak as a share of the radius. Above 0.07 the outline turns lumpy. */
    reliefShare: 0.05,
    /** Continents across a planet: 1 = one or two big ones, 3 = an archipelago. */
    frequency: 1.45,
    octaves: 4,
    /** Noise below this is sea. 0 floods about half; lower = drier. */
    seaLevel: -0.04,
    peakAt: 0.5,
    /** Land rises in this many steps, this much of the way from smooth slopes to hard steps. */
    terraces: 4,
    terraceStrength: 0.6,
    /** Land height (0 to 1) where the colour changes: shore|low, low|high, high|peak. */
    bandStops: [0.1, 0.46, 0.8],
    /** Each facet's colour is nudged by up to this share: flat areas look hand-made. */
    colorJitter: 0.03,
  } satisfies PlanetLook,

  /** How the galaxy is drawn (world/Galaxy.ts). */
  world: {
    /** Mesh detail: a body has 20 * (detail + 1)^2 facets. NEAR replaces PLANET when the ship is close. */
    detailPlanet: 8,
    detailNear: 14,
    detailMoon: 3,
    detailSun: 4,
    /** The near mesh is built inside this many radii, and dropped after lingering outside the exit. */
    nearEnterRadii: 8,
    nearExitRadii: 10,
    nearLingerSec: 10,
    /**
     * What generating meshes may take out of a frame (core/jobs.ts): this share of the time the
     * last frame took, within these limits. 4 ms at 60 fps; more only where frames are long anyway.
     */
    jobBudget: { share: 0.25, minMs: 4, maxMs: 16 } satisfies JobBudget,
    /** Planets turn on their axis, slowly. Off under reduced motion. */
    spinRadPerSec: 0.04,
    /**
     * A ringed planet: the ring's inner and outer edge in planet radii, and how far it tips. The
     * outer edge stays INSIDE the docking orbit (1.9 radii or more, data/layout.ts): a wider ring
     * has the docked ship flying through it, and from the chase camera, which then sits right on
     * its plane, it is a wall of pale blue across the whole view.
     */
    ringInnerRadii: 1.35,
    ringOuterRadii: 1.8,
    ringTiltDeg: 16,
    /** How much a sun and a planet's ring bleed into the picture as bloom, 0 to 1. */
    sunBloom: 1,
    ringBloom: 0.18,
    /** The thin circles that show where things orbit. */
    orbitLineOpacity: 0.2,
    orbitLineSegments: 128,
    /**
     * The ship is lit by the sun of the system it is in: fully inside `shipLightFullRadii` system
     * radii, fading to the distant key light by `shipLightFadeRadii`.
     */
    shipLightFullRadii: 1.2,
    shipLightFadeRadii: 2,
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
    /**
     * WHERE THE SYSTEMS ARE: these three, and each system's `order`, alone (data/layout.ts,
     * slotPosition). Systems pack round home like a honeycomb: every one sits homeRoom u from
     * home (centre to centre), or further, and slotRoom u from any other, or further. Slot 1
     * stands clusterAxisDeg from home (degrees from +x toward +z) and the galaxy grows
     * symmetrically about that line: on a diagonal (45, 135...) a galaxy with an even number of
     * systems frames as a square on the star map. CHANGING ANY OF THE THREE MOVES EVERY SYSTEM
     * (a test pins where they are; galaxy.lock.json will). The build checks that they leave room
     * for the tripwires below: slotRoom for two full-size systems (2 x maxSystemRadius +
     * minSystemGap + 1), homeRoom for one beside the home system as it really is (its reach,
     * 66.2 u today, + maxSystemRadius + minSystemGap + 1): the home system may grow to 79 u.
     */
    clusterAxisDeg: 135,
    homeRoom: 610,
    slotRoom: 911,

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
    /**
     * Tripwires: a system that outgrows its radius, or sits this close to a neighbour, fails the
     * build. They move nothing: a slot's room (homeRoom, slotRoom above) must be enough for them.
     */
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
