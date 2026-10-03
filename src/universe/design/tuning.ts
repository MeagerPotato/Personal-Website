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
import type { Terrain, TerrainName } from '../sim/world/ground';
import type { LabelsParams } from '../ui/Labels';
import type { PickerParams } from '../ui/Picker';
import type { StarMapParams } from '../ui/StarMap';
import type { MapLookParams } from '../world/Galaxy';
import type {
  AirWorld,
  HeroStar,
  LampToken,
  RimTone,
  SkyLook,
  StarBulge,
  StarClass,
  StarCluster,
  StarClusterLook,
  StarPairs,
  StarPalette,
  SunTone,
} from './lookTypes';

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
   * THE AUTOPILOT (sim/autopilot.ts): flies the ship to a body that is out of reach, and has it
   * taken into orbit beside that body's ring (sim/docking.ts, arrive). It flies the ordinary
   * flight model with a stronger DRIVE, so a trip between systems takes seconds while the pilot's
   * own top speed stays what it is.
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
    /**
     * u/s². ...but it never brakes harder than this for the plan (a replan that finds a bend
     * close ahead asked for 2,200 in one step): a little more than `far.decel`. Braking for the
     * ship's own course (sim/reflex.ts) is not held to it.
     */
    comfortDecel: 700,
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
     * Names keep gapPx apart; one that shows already may stay until it is keepPx closer than that,
     * and one that waits needs the whole gap, so names do not blink while bodies drift past each
     * other (on the map, a place a name is not at needs keepPx to spare from the edges of the view
     * too); never more than max at once.
     */
    gapPx: 4,
    keepPx: 8,
    max: 14,
    /**
     * On the map, a name that has just appeared, hidden or moved makes no other change of its own
     * accord for this long (s); it still makes way where it must (tests/map-names/).
     */
    dwellSec: 1,
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
    /**
     * Lean into a turn: this many radians at the pilot's full turn rate (never more, however fast
     * the autopilot turns), fading in up to bankFullSpeed, and eased at bankOmega (rad/s).
     */
    bankRad: 0.6,
    bankFullSpeed: 15,
    bankOmega: 9,
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
     * ...but never further than this (u): the autopilot flies at up to 700 u/s, and 140 u ahead
     * from 4.4 u up lays the view flat along the plane (a pitch of 1.5 degrees; 3.2 at 60 u,
     * where a pilot's own top speed has 5.8 and a ship at rest 10).
     */
    lookAheadMax: 60,
    /**
     * Springs, rad/s: higher = stiffer. The camera trails the ship by 2 * speed / positionOmega
     * units, easing into a limit of maxTrail (so about 4.4 u at cruise and 5.3 u under boost), and
     * its swing trails a turn by 2 * turnRate / yawOmega radians. That slack is what lets you SEE
     * the ship turn and pull away.
     */
    positionOmega: 14,
    maxTrail: 5.5,
    yawOmega: 12,
    /**
     * rad/s. The view never swings round faster than this (about 195 degrees a second), and under
     * reduced motion never faster than the pilot's own turn (flight.yawRateSlow). The autopilot
     * turns at up to 7: the ship comes round in the frame, and the view follows it.
     */
    maxYawRate: 3.4,
    /** The view widens with speed: +fovBoostDegrees between these two speeds. Not under reduced motion. */
    fovBoostDegrees: 13,
    fovBoostSpeeds: [35, 80],
    /**
     * rad/s. How quickly the lens widens (and the look ahead grows) when the speed changes: the
     * autopilot reaches 700 u/s in about a second, and a lens that kept up swung 13 degrees in five
     * frames. At 5 it is two thirds of the way there in 0.43 s, never more than 0.4 degrees a frame.
     */
    fovOmega: 5,
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
    /**
     * Where only a strip of the view is free (a phone with the sheet up: between the solid top
     * bar and the sheet), that strip must still see this much, top to bottom, in degrees: from
     * the top of a planet on the horizon to the ship's tail, with some sky round them. The lens
     * widens to make it so, but by no more than maxFitWiden (in the tangent of its half-angle),
     * so that a sliver of a strip gets a smaller picture, not a fisheye.
     */
    fitDegrees: 34,
    maxFitWiden: 1.45,
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
     * How close the map zooms: world units across the SHORTER side of the free view. 200 lets a
     * phone part the names of close neighbours (Corgi Hackathon's and its neighbours', Canadian
     * Fish's moons'), which at 400 left one of them unnamed now and then, for up to half a minute
     * whatever the view, and at 300 still did at up to 5% of moments for a visitor zooming in step
     * by step (docs/PLAN.md §5.4); a laptop zooms closer too. It opens on everything (the galaxy,
     * and the ship if it is out beyond it), snugly: fitMargin times the room that needs, plus
     * fitPadPx (CSS px) on every side for the names of the bodies at the edge. It zooms out no
     * further than zoomOutPastFit times that view (1: not at all), and the galaxy is never dragged
     * off: zoomed in, the view stays on it (to within fitPadPx of its edge); further out, all of it
     * stays in view. Past it is only empty space.
     */
    spanMin: 200,
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
    /**
     * The stars dim to this share of themselves, and the dust is put away: a map is a calm thing.
     * A faint star then peaks at about 0.05, under the chart's grid dots.
     */
    starOpacity: 0.2,
    /**
     * No body looks smaller than this on the map (radius, CSS px), by kind: the galaxy is a few
     * pixels per hundred units, and a planet at its true size would be a speck. The size of ALL
     * that is drawn of it (an emblem world's rays, rings and signs with its ball: its solid
     * extent), which is also the disc its name keeps off and the pointer finds: a sun with a long
     * reach is no bigger than one that is all ball, its ball smaller in proportion.
     */
    minRadiusPx: { sun: 9, home: 8, planet: 6, moon: 3.5, station: 4, satellite: 4, link: 3.5 },
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
    /**
     * How much of it is kept off the very thing that glows (0 to 1): at 0 a sun's ball is its
     * colour plus its own blur, clipped to near white; at 1 exactly its token, with the glow all
     * round it. A little is left on, so that what glows is a shade brighter than what does not.
     */
    selfBloom: 0.85,
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
    /**
     * Each facet's colour is nudged by up to this share. None: it was 0.03, which made every
     * flat area a mosaic of triangles, and a world is round now ("Deep light": light falls
     * across the ball, and an outline runs through its facets, not along them).
     */
    colorJitter: 0,
  } satisfies PlanetLook,

  /**
   * The terrains of the worlds of their own (sim/world/ground.ts; vocabulary.md, 3.1): how a
   * body's ground shapes the noise, as overrides of `planet` above. A body's rows name one.
   */
  terrain: {
    /**
     * The home planet: few, large continents in three terraces. The cream peak is only the middle
     * of the top terrace (`peakAt` and the last stop), a summit as in the concept art: lower, and
     * the close-up's finer facets turned the whole plateau into a white blot.
     */
    continents: {
      look: {
        reliefShare: 0.018,
        frequency: 1.0,
        octaves: 3,
        seaLevel: 0.02,
        peakAt: 0.6,
        terraces: 3,
        terraceStrength: 0.7,
        bandStops: [0.12, 0.5, 0.92],
      },
    },
    /** Rolling ground with few peaks and little sea. */
    calm: {
      look: {
        reliefShare: 0.012,
        frequency: 0.95,
        octaves: 3,
        seaLevel: -0.5,
        peakAt: 0.55,
        terraces: 2,
        terraceStrength: 0.85,
        bandStops: [0.08, 0.5, 0.86],
      },
    },
    /**
     * Small islands in a sea. Two octaves, not three: at this frequency a third is finer than a
     * facet (4 to 7 degrees), and a coast is only as round as what its facets can hold.
     */
    isles: {
      look: {
        reliefShare: 0.014,
        frequency: 2.3,
        octaves: 2,
        seaLevel: 0.12,
        peakAt: 0.6,
        terraces: 3,
        terraceStrength: 0.8,
        bandStops: [0.12, 0.5, 0.85],
      },
    },
    /**
     * Planned work: unfired clay, rougher than any built world (the note on `planet.reliefShare`:
     * above 0.07 the outline turns lumpy, which is the point). Since the worlds were made round
     * ("Deep light", step 2c) its lumps are round ones: lower (0.045; it was 0.07, whose lumps had
     * corners on the outline) and of two octaves, not three (a third is finer than a facet, and
     * its patches cannot be drawn round: the note on `isles`).
     */
    lumpy: {
      look: {
        reliefShare: 0.045,
        frequency: 1.5,
        octaves: 2,
        seaLevel: -0.6,
        peakAt: 0.55,
        terraces: 2,
        terraceStrength: 0.6,
        bandStops: [0.1, 0.5, 0.86],
      },
    },
    /**
     * A smooth ball, every facet at one level (0.3: the low band), so that ALL the character is
     * paint and props. Its stops are pinned here rather than read from `planet`: a level was
     * chosen for the band it falls in (-1 the sea, 0.3 low, 0.5 to 0.7 high), and a retune of the
     * generated planets must not repaint these worlds.
     */
    flat: { look: { bandStops: [0.1, 0.46, 0.8] }, flat: 0.3 },
    /**
     * A sun's smooth ball, with no nudge at all. A living sun's tones are `look.sun`'s; this is
     * what is left for a sun that is painted over (the Hardware sun's frame ball).
     */
    sun: {
      look: {
        reliefShare: 0,
        frequency: 1.3,
        octaves: 3,
        seaLevel: -0.9,
        peakAt: 0.55,
        terraces: 3,
        terraceStrength: 0.7,
        bandStops: [0.36, 0.6, 0.78],
        colorJitter: 0,
      },
    },
  } satisfies Record<TerrainName, Terrain>,

  /** How the galaxy is drawn (world/Galaxy.ts). */
  world: {
    /** Mesh detail: a body has 20 * (detail + 1)^2 facets. NEAR replaces PLANET when the ship is close. */
    detailPlanet: 8,
    detailNear: 14,
    /**
     * A moon: 1280 facets. It was 3 (320), a ball of twenty sides against the sky; light falls
     * round on every ball now (shaders/toonFlat.ts), and its outline has to be round too.
     */
    detailMoon: 7,
    /**
     * A sun's ball: 2000 facets, fine enough for its granulation (`look.sun`; the low tier:
     * `detailLow`). The look was drawn at 11 (2880), which the worlds' budget has no room for:
     * a body is at most 2800 triangles every day, its signs included (tests/world-bodies.test.ts).
     */
    detailSun: 9,
    /**
     * Planned work, not built yet: an unpainted maquette in its family's pale colours, as coarse
     * as a model before the detail goes on (1 is 80 facets), with no close-up (world/looks.ts).
     */
    detailPlanned: 1,
    /**
     * The worlds of their own (sim/world, design/worlds): a planned body there is a maquette of
     * primer clay that does not sharpen up close, coarser than a built world but not a sketch
     * (it was 980 facets for a planet, 320 for a moon: balls of straight sides against the sky;
     * round and smooth is for clay too, so a maquette is as fine as a built world is every day,
     * 1620 and 1280). `detailPlanned` above is today's placeholder look, which the worlds replace
     * body by body.
     */
    detailMaquettePlanet: 8,
    detailMaquetteMoon: 7,
    /**
     * A planned world is drawn at this share of its finished size, rows and all: a maquette of
     * primer clay inside the dashed ring its rows draw at the finished size (about 1 radius at
     * this scale: vocabulary.md, section 6). Its declared reach (design/worlds/reach.ts) is
     * measured at this scale, so tests/world-reach.test.ts follows a change here.
     */
    plannedScale: 0.7,
    /**
     * HOW ROUND a round thing is built ("Deep light": round and smooth). The rows sketch a wheel
     * with eight sides; it is built with as many as keep the middle of a side within `sag` of
     * the true circle (sim/world/kit.ts, `sidesFor`), in radii of its body: a third of a pixel
     * on a body 55 px in radius every day, and half a pixel on one 200 px in radius up close. A
     * wheel a third of its world across gets 16 sides every day and 24 up close, a mast 7 and
     * 10, a bead a ball of 8 to 14. The low tier allows `sagLowTimes` as much; nothing gets more
     * than `maxSides`. Light does not depend on it (a round thing is lit by its true normals):
     * this is its outline only.
     */
    round: { sagEveryday: 0.006, sagNear: 0.0025, sagLowTimes: 2, maxSides: 64 },
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
    /**
     * The thin circles that show where things orbit. Judged against 0.26 (and 0.13 for the track)
     * in the lab's `orbits` subject while the sky still had gas behind them: the stronger pair
     * was no easier to see there and louder everywhere else, so these stay. The sky behind them
     * is only calmer now (docs/DESIGN.md, "Deep light").
     */
    orbitLineOpacity: 0.2,
    /** A binary's suns' own path round the pair's centre: half as strong, not one more orbit. */
    sunTrackOpacity: 0.1,
    orbitLineSegments: 128,
    /**
     * Away from every body, the ship is lit by the sun whose family it is in: fully inside
     * `shipLightFullRadii` of that family's reach (a sun, its planets and their moons: for a
     * system with one sun, the system's radius), fading to the distant key light by
     * `shipLightFadeRadii` (world/Galaxy.ts, lightAt).
     */
    shipLightFullRadii: 1.2,
    shipLightFadeRadii: 2,
    /**
     * Near a body, the ship is lit by that body's own light: fully from its docking ring inward,
     * letting go by this many ring radii (sim/shipLight.ts), a little past the orbit assist's
     * sphere (assist.soiRadii). Judged in the Projects binary (2026-09-30): from the ring out to
     * 2 rings the light turned least of the reaches tried (1.8, 2, 2.2 and 2.4; from 1.1 and 1.2
     * rings too) for a ship leaving or diving at a planet by the gap (Robotics, straight out on
     * the gap side at a boosting pilot's 81 u/s: 24 degrees in a frame at worst, 27 at 1.8), and
     * added no frame over 30 to any journey; wider, the spheres reach so far into the gap that
     * crossing it turns sharper.
     */
    shipLightClaimRadii: 2,
    /**
     * Between two suns of about equal pull (a binary's gap), their directions all but cancel, and
     * the key light, from above the plane, takes up to this share more (0 to 1): the ship's light
     * swings over the top from one sun to the other instead of flipping round. Larger is a wider,
     * slower swing, and a wider lean toward the key light where two families are close: near
     * the gap, every sun's outermost planets. Judged in the Projects binary (2026-09-30), over
     * every journey into, out of and across it (320, at up to 430 u/s): at 0.05 the light turned
     * up to 97 degrees in one frame (8 frames over 60); at 0.2, 54 at most and none over 60; 0.5
     * would bring it to 41. Since the ship takes the light of the body it is near, the lean costs
     * nothing on a ring, and the swing is all that is left to judge: the gap lies outside every
     * body's sphere, so the turns there are what they were (0.05 still 97 degrees, 0.2 54, 0.5
     * 41), and 0.5 would light a ship flying free among Hardware's outer planets from beyond its
     * own sun's side (up to 104 degrees off it, where 0.2 leans up to 57). What the blend leans
     * where each body lets go is pinned by tests/ship-light.test.ts.
     */
    shipLightTiebreak: 0.2,
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
    /**
     * A decal (a grid or a number painted on a world's ground: sim/world/glue.ts) is drawn this
     * share of its distance nearer the camera, along its own line of sight (shaders/toonFlat.ts):
     * a depth bias that moves nothing on screen and keeps it over the ground it hugs, from the
     * star map as from orbit, where a 24-bit depth buffer tells apart about 3e-6 of the distance.
     * The ghost lines of planned work take twice it (shaders/edge.ts).
     */
    decalPull: 2e-4,
  },

  /**
   * The backdrop behind the stars (world/Backdrop.ts): navy, a little lighter along the horizon.
   * What the sky adds to it (the Milky Way's haze, far galaxies) is `look.sky` below.
   */
  backdrop: {
    /** Higher = a thinner, sharper glow along the horizon. */
    horizonFalloff: 3.2,
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
    /**
     * u/s. The dust slides past no faster than this, however fast the ship goes: at the
     * autopilot's 700 u/s the motes would cross the box in a third of a second and strobe instead
     * of streaking. Above it the lens and the planets rushing by say how fast (sim/dustField.ts).
     */
    maxFieldSpeed: 300,
  },

  starfield: {
    /** Changing the seed reshuffles the whole sky; keep it stable so screenshots stay comparable. */
    seed: 'allenkh-starfield',
    /**
     * How many of the faintest stars (the dust class, below) there are, with a mouse and with a
     * finger. Every other class follows in proportion, and the low tier draws half of each.
     */
    count: 6400,
    countCoarse: 3200,
    /**
     * Six temperatures: [token name under color.star, share of the stars]. A class with a
     * `palette` of its own (below) is drawn from that instead.
     */
    palette: [
      ['white', 0.3],
      ['cool', 0.2],
      ['hot', 0.17],
      ['warm', 0.15],
      ['amber', 0.12],
      ['ember', 0.06],
    ] satisfies StarPalette,
    /**
     * This share of the dust, field and bright stars dims and comes back, by up to twinkleDepth:
     * about a thousand stars, as many as shimmered when the sky held 5,000 (the bulge's stars
     * and the clusters' twinkle as often: about 1,100 in all).
     */
    twinkleShare: 0.12,
    twinkleDepth: 0.55,
    /**
     * Whole-sky drift, radians per second. 0 since the sky is baked: the stars lie where the
     * Milky Way's haze is and thin out in its dark lane, and are dimmed by the panorama at fixed
     * directions. A sky that drifted would slide them off both.
     */
    driftRadPerSec: 0,

    // --- "Deep light" (docs/DESIGN.md): the star classes. sim/starList.ts makes the list of
    // stars from these, design/shaders/sky.ts draws it. ---
    /**
     * Five kinds of star, faintest to brightest: dust, field, bright, mid, and the eight heroes
     * below. `yRange` is the peak brightness (linear luminance) and `yExp` how it is spread
     * across the range (higher = more faint ones); `sigmaPx` the Gaussian core (at `coreGain` of
     * that brightness, 1 when left out), `haloSigmaPx` and `haloGain` a wider, fainter one round
     * it, `spikeLenPx`, `spikeGain` and `spikeThicknessPx` six small spikes (mid only: a small
     * hero), each star's `sizeRange` of that length long; every size is CSS px in a view
     * `scaleRows` high. `bandShare` is the share of the class laid along the Milky Way, where
     * its haze is. `palette`: the class's own tints. Dust is whiter and cooler than the rest (a
     * faint star looks white) and the bright ones carry the colour. Dust has no count of its
     * own: it takes `count` (and `countCoarse`) above. Its range is WIDE and most of it is
     * faint: dust of one brightness and one size read as grain, as a texture laid on the sky,
     * and a river of it as a stripe; from barely there to as bright as a field star, it reads
     * as stars at every distance.
     */
    classes: {
      dust: {
        yRange: [0.07, 0.56],
        yExp: 2.6,
        sigmaPx: 0.62,
        coreGain: 0.9,
        bandShare: 0.7,
        palette: [
          ['white', 0.34],
          ['cool', 0.22],
          ['hot', 0.12],
          ['warm', 0.2],
          ['amber', 0.09],
          ['ember', 0.03],
        ],
      },
      field: {
        count: 1500,
        yRange: [0.38, 0.78],
        yExp: 1.6,
        sigmaPx: 0.85,
        coreGain: 0.9,
        bandShare: 0.5,
      },
      bright: {
        count: 260,
        yRange: [0.75, 1],
        yExp: 1.2,
        sigmaPx: 1.05,
        haloSigmaPx: 3.4,
        haloGain: 0.18,
        bandShare: 0.35,
        palette: [
          ['white', 0.22],
          ['cool', 0.12],
          ['hot', 0.24],
          ['warm', 0.14],
          ['amber', 0.18],
          ['ember', 0.1],
        ],
      },
      mid: {
        count: 64,
        yRange: [0.9, 1],
        yExp: 1,
        sigmaPx: 1.2,
        haloSigmaPx: 4.4,
        haloGain: 0.24,
        spikeLenPx: 26,
        spikeGain: 0.55,
        spikeThicknessPx: 0.6,
        sizeRange: [0.55, 1],
        bandShare: 0.2,
        palette: [
          ['white', 0.18],
          ['cool', 0.08],
          ['hot', 0.3],
          ['warm', 0.12],
          ['amber', 0.22],
          ['ember', 0.1],
        ],
      },
    } satisfies Record<string, StarClass>,
    /**
     * A hero star: a core, two halos ([sigma in px, gain]), six spikes of `spikeLenPx` (in a
     * view `scaleRows` high, times the hero's own size) and a faint cross between them
     * (`crossLen` of an arm, at `crossGain`). It breathes by `breath` of itself, over a period
     * drawn from `breathSec` (seconds). Still under reduced motion.
     */
    hero: {
      sigmaPx: 1.5,
      halos: [
        [3.85, 0.28],
        [11.2, 0.1],
      ],
      spikeLenPx: 78,
      spikeGain: 0.8,
      spikeThicknessPx: 0.75,
      crossLen: 0.3,
      crossGain: 0.3,
      breath: 0.06,
      breathSec: [5, 9],
    },
    /**
     * The eight heroes, at fixed places: azimuth = atan2(x, z) and elevation in degrees, a size
     * from 0 to 1, and a tint (a key of color.star). Eight on every tier: a hero costs one quad.
     * Every view the sky is judged from (sim/skyDirections.ts) has one, and none sits behind the
     * top bar's chips: three in the first frame at home (upper right, above the home planet,
     * and low on the left, where the frame is emptiest), one beside a docked body clear of its
     * panel, one or two toward each system. All six temperatures.
     */
    heroes: [
      { azDeg: -55, elDeg: 8, size: 1, tint: 'hot' },
      { azDeg: -33, elDeg: 7, size: 0.8, tint: 'amber' },
      { azDeg: -12, elDeg: -14, size: 0.85, tint: 'white' },
      { azDeg: 40, elDeg: -10, size: 0.9, tint: 'warm' },
      { azDeg: 75, elDeg: 8, size: 0.85, tint: 'cool' },
      { azDeg: 195, elDeg: 9, size: 1, tint: 'hot' },
      { azDeg: -102, elDeg: 12, size: 0.9, tint: 'white' },
      { azDeg: 222, elDeg: -11, size: 0.8, tint: 'ember' },
    ] satisfies readonly HeroStar[],
    /**
     * Six Gaussian clusters of stars: where, how wide (degrees), how many, and their tint. The
     * first three mark nothing, and stand clear of the Milky Way (the first is 12 degrees above
     * the river's middle: nearer, it had the river's haze behind it). The last three are THE
     * SKY'S COMPASS: one at the bearing FROM HOME of each system (azimuth =
     * 90 - the layout's bearing; `system` says whose), 20 degrees under the horizon, where the
     * sky is emptiest. The sky is at infinity, so a bearing is right from home and the same from
     * everywhere. Each wears the star temperature nearest its family (there is no green star and
     * no violet one, and no star wears a family's colour); Hardware shares the bearing of its
     * binary, and home has none: home is where the viewer stands. A cluster is separate stars
     * and nothing else: no light under it, no halo. `system` is a note for the reader (and for
     * tests/look.test.ts, which holds each azimuth to the layout): nothing in the engine reads
     * it, `azDeg` is what places the cluster.
     */
    clusters: [
      { azDeg: -88, elDeg: 27, sigmaDeg: 1.1, count: 70, tint: 'hot' },
      { azDeg: 146, elDeg: 20, sigmaDeg: 0.9, count: 55, tint: 'amber' },
      { azDeg: 30, elDeg: 9, sigmaDeg: 1.3, count: 80, tint: 'white' },
      { azDeg: -45, elDeg: -20, sigmaDeg: 1.2, count: 60, tint: 'hot', system: 'projects' },
      { azDeg: 195, elDeg: -20, sigmaDeg: 1.2, count: 60, tint: 'white', system: 'research' },
      { azDeg: 75, elDeg: -20, sigmaDeg: 1.2, count: 60, tint: 'cool', system: 'hackathons' },
    ] satisfies readonly StarCluster[],
    /**
     * How a cluster is made. It has a HEART: its first `brightCount` stars are bright ones (the
     * bright class's range of brightness) within `heart` of its width, the next `fieldCount`
     * are field stars within twice that, and the rest are dust across its whole width, of
     * brightness yBase + yGain * random^yExp * exp(-falloff * r), r the distance from the
     * middle in sigmas. `tintShare` of them wear the cluster's tint, the rest any. Sixty faint
     * dots of one size read as a patch of grain; two or three bright stars with the faint ones
     * falling away round them read as a cluster.
     */
    cluster: {
      yBase: 0.14,
      yGain: 0.6,
      yExp: 1.3,
      falloff: 1.1,
      tintShare: 0.6,
      fieldCount: 7,
      brightCount: 3,
      heart: 0.4,
    } satisfies StarClusterLook,
    /**
     * THE MILKY WAY'S BULGE, in stars: where the river is thickest (`look.sky.band.core` says
     * where, and how wide the oval is) it gains this many more of each plain class, in these
     * warm tints (halved with a finger and on the low tier, as every class is). This is the
     * whole of the bulge's light and of its warmth: the haze only swells there, in its own
     * blue (a cream haze with no more stars in it than the river beside it read as a smear,
     * and off the palette). The dark lane runs through it as through the rest of the river.
     */
    bulge: {
      counts: { dust: 520, field: 130, bright: 16 },
      palette: [
        ['warm', 0.5],
        ['amber', 0.28],
        ['ember', 0.07],
        ['white', 0.15],
      ],
    } satisfies StarBulge,
    /**
     * Double stars, anywhere in the sky: a bright primary and a fainter companion `sepDeg` away
     * (seven to ten pixels: found by looking, never noise), drawn as a bright and a field star,
     * in one of these pairs of tints. As many on every tier: a double costs two quads.
     */
    pairs: {
      count: 14,
      sepDeg: [0.42, 0.72],
      primaryY: [0.8, 1],
      companionY: [0.45, 0.65],
      tints: [
        ['hot', 'amber'],
        ['white', 'cool'],
      ],
    } satisfies StarPairs,
    /** The profile along a spike, t from 0 at the star to 1 at its tip: (1 - t)^exponent / (1 + taper t). */
    spike: { exponent: 2.4, taper: 5 },
    /** The view height, CSS px, the pixel sizes above are written for... */
    scaleRows: 1080,
    /** ...and how far a shorter or a taller view may scale them: [least, most]. */
    scaleRange: [0.6, 1.2],
    /** A star's core never scales below this, or the faintest would fall between the pixels. */
    coreScaleMin: 0.8,
  },

  /**
   * "FLAT WORLDS, DEEP LIGHT" (docs/DESIGN.md, "Deep light"): the look pass that gives the sky
   * a Milky Way and far galaxies, the suns a surface, the worlds air. Matter stays flat and
   * token-exact; light and air get structure. Every colour is a token key (a star tint, an
   * air, a biome), never a number; design/lookTypes.ts holds the shapes of the tables.
   */
  look: {
    /**
     * The baked sky: a panorama of the light the sky ADDS to the navy, painted once on the GPU
     * after the first frame: the Milky Way's haze and the far galaxies, and nothing else. No
     * gas, no clouds (Allen, 2026-10-03: "No clouds, rich stars"): the stars carry the sky
     * (`starfield`, above). Everything here but the three exposure keys and `revealSec` is
     * baked: changing it means baking again.
     */
    sky: {
      /** Scales the added light, after the ceiling has held it: never above 1. */
      intensity: 0.9,
      /** Seconds over which the baked sky's light comes in. A cut under reduced motion. */
      revealSec: 0.8,
      /** The sky is this much of itself while docked: the view is closer and the panel wants quiet. */
      exposureDocked: 0.5,
      /** ...and this much on the star map (by its calm), which looks straight down anyway. */
      exposureMap: 0.28,
      /** 1/s: how fast the exposure eases to its target. A cut under reduced motion. */
      exposureOmega: 3,
      /**
       * The panorama is painted a band of rows a frame (tiers.bandRows); once a frame took this
       * many ms or longer, only every second frame paints one (sim/skySchedule.ts).
       */
      bandSlowMs: 22,
      /**
       * The horizon strip, where planets and orbit lines sit: no added light at the first
       * elevation, all of it from the second, degrees, rising smoothly between. It is long on
       * purpose: a taper a few degrees long drew a ruler-straight edge along the sky.
       */
      stripDeg: [0, 12],
      /**
       * The ceiling of the sky's total luminance (linear Y), held by a soft knee. At 0.19 the
       * butter focus ring still reads 3.19:1 over the brightest pixel the sky can paint.
       */
      ceilingY: 0.19,
      /**
       * The Milky Way: a river of stars along a great circle, and a faint haze under them
       * (sim/milkyWay.ts says what each number does; the stars are laid from these too). Its
       * pole is tilted `tiltDeg` from straight up, toward azimuth `poleAzDeg`: the river is
       * highest (`tiltDeg` up) at the azimuth opposite, -62, crosses the horizon a quarter turn
       * to either side, and in the first frame climbs about ten degrees, from the left edge
       * until it leaves through the top. Across it: a narrow bank and a wide one (`banks`:
       * [sigma in degrees, weight]). Along it: `base` everywhere and twelve `clumps`
       * ([longitude, sigma, weight], degrees), its middle wandering by `meanderDeg`. `core`:
       * the bulge, an oval on the river (`sigmaDeg`: along it and across it) where the haze
       * swells by `glow`. `lane`: the dark rift.
       *
       * What these numbers hold, each of which was tried the other way:
       *  - THE HAZE HAS ONE FAMILY OF TONES, the navy's own blue. The bulge is made of stars
       *    (`starfield.bulge`); a cream haze there, with no more stars in it than the river
       *    beside it, read as a grey smear.
       *  - THE LANE IS MISSING STARS AND NO PAINT. A lane darkened in the haze drew faint
       *    streaks along the river, which read as layers. `hide` 0.8 acts twice: four fifths
       *    of the river's and the bulge's own stars are left out where it runs, and whatever
       *    star is left there, of any class, is dimmed through the panorama's alpha, at the
       *    lane's middle to a ninth of its light.
       *  - THE RIVER CROSSES THE FIRST FRAME AS A DIAGONAL (tests/look.test.ts holds its
       *    climb), and its haze has no lower edge: at `gain` 0.5 it rises to its full cover
       *    only where the river is brightest. Lying level across the first frame, at 0.65, it
       *    read as a bar of blue fog.
       *  - IT STAYS CLEAR OF THE CLUSTERS (`starfield.clusters`): the river's middle comes no
       *    nearer one than 8 degrees, and no haze lies within two sigmas of any. The nearest
       *    are the compass cluster of Hackathons (azimuth 75, 20 degrees under the horizon,
       *    where the river is at -11: the clump above it, at longitude 238, is the weakest of
       *    the twelve for that reason) and the white one at azimuth 30. More tilt, or a pole
       *    nearer azimuth 110, lays the river's haze under the first; a pole nearer 125, under
       *    the second, and the river level across the first frame again.
       *  - Nothing here is cut into levels or run through noise: a level's edge that follows
       *    noise is a contour line, and contour lines read as waves.
       */
      band: {
        tiltDeg: 16,
        poleAzDeg: 118,
        gain: 0.5,
        banks: [
          [2.8, 0.5],
          [7.5, 0.5],
        ],
        meanderDeg: [1.4, 0.9, 0.6, 2.3],
        base: 0.3,
        clumps: [
          [28, 10, 0.5],
          [52, 9, 0.9],
          [74, 14, 1],
          [98, 8, 0.7],
          [118, 11, 0.85],
          [146, 9, 0.5],
          [172, 12, 0.6],
          [205, 14, 0.8],
          [238, 10, 0.4],
          [262, 13, 0.6],
          [300, 16, 0.9],
          [336, 10, 0.6],
        ],
        core: { lonDeg: 120, sigmaDeg: [9, 5.5], glow: 0.9 },
        lane: { offsetDeg: [1.2, 1.6, 0.8], widthDeg: [1.4, 0.5], hide: 0.8 },
      },
      /**
       * Fifteen far galaxies, the same on every tier: where, how large (`radiusDeg`: the
       * semi-major axis; `axisRatio`: minor over major; `angleDeg`: turned from level), which
       * kind, the star tints of its disc and of its nucleus, and how loud. The first four are
       * showpieces, one toward the first frame and one toward each system; the rest are small.
       * No galaxy is amber or ember (on navy they read brown), every nucleus is 7 degrees or
       * more off the horizon (the strip is kept calm), and every sixth of the sky's round
       * holds three or more of galaxy, hero star and cluster: a slow look round always finds
       * something (tests/look.test.ts).
       */
      galaxies: [
        {
          azDeg: -10,
          elDeg: 12,
          radiusDeg: 2.6,
          axisRatio: 0.8,
          angleDeg: 25,
          kind: 'spiral',
          disc: 'hot',
          core: 'warm',
          gain: 1,
        },
        {
          azDeg: 96,
          elDeg: 8,
          radiusDeg: 2.2,
          axisRatio: 0.26,
          angleDeg: -18,
          kind: 'lens',
          disc: 'warm',
          core: 'white',
          gain: 1,
        },
        {
          azDeg: 186,
          elDeg: 8,
          radiusDeg: 1.8,
          axisRatio: 0.86,
          angleDeg: 0,
          kind: 'ellipse',
          disc: 'warm',
          core: 'white',
          gain: 0.9,
        },
        {
          azDeg: -64,
          elDeg: 7,
          radiusDeg: 1.6,
          axisRatio: 0.7,
          angleDeg: -35,
          kind: 'spiral',
          disc: 'cool',
          core: 'warm',
          gain: 1,
        },
        {
          azDeg: 18,
          elDeg: 14,
          radiusDeg: 1.2,
          axisRatio: 0.3,
          angleDeg: 24,
          kind: 'lens',
          disc: 'warm',
          core: 'white',
          gain: 0.9,
        },
        {
          azDeg: 152,
          elDeg: 9,
          radiusDeg: 1,
          axisRatio: 0.4,
          angleDeg: -40,
          kind: 'ellipse',
          disc: 'warm',
          core: 'white',
          gain: 0.8,
        },
        {
          azDeg: 96,
          elDeg: 31,
          radiusDeg: 1.1,
          axisRatio: 0.5,
          angleDeg: -62,
          kind: 'spiral',
          disc: 'hot',
          core: 'warm',
          gain: 0.9,
        },
        {
          azDeg: -32,
          elDeg: 26,
          radiusDeg: 0.9,
          axisRatio: 0.7,
          angleDeg: -25,
          kind: 'spiral',
          disc: 'cool',
          core: 'warm',
          gain: 0.8,
        },
        {
          azDeg: 41,
          elDeg: 27,
          radiusDeg: 0.6,
          axisRatio: 0.9,
          angleDeg: 0,
          kind: 'ellipse',
          disc: 'warm',
          core: 'white',
          gain: 0.8,
        },
        {
          azDeg: 231,
          elDeg: 24,
          radiusDeg: 0.6,
          axisRatio: 0.4,
          angleDeg: 55,
          kind: 'ellipse',
          disc: 'warm',
          core: 'white',
          gain: 0.8,
        },
        {
          azDeg: -48,
          elDeg: 31,
          radiusDeg: 0.6,
          axisRatio: 0.75,
          angleDeg: 0,
          kind: 'spiral',
          disc: 'cool',
          core: 'warm',
          gain: 0.8,
        },
        {
          azDeg: 172,
          elDeg: -28,
          radiusDeg: 0.7,
          axisRatio: 0.5,
          angleDeg: 30,
          kind: 'ellipse',
          disc: 'warm',
          core: 'white',
          gain: 0.8,
        },
        {
          azDeg: -112,
          elDeg: -19,
          radiusDeg: 0.7,
          axisRatio: 0.3,
          angleDeg: -8,
          kind: 'lens',
          disc: 'warm',
          core: 'white',
          gain: 0.8,
        },
        {
          azDeg: -124,
          elDeg: 8,
          radiusDeg: 0.5,
          axisRatio: 0.6,
          angleDeg: 10,
          kind: 'spiral',
          disc: 'cool',
          core: 'warm',
          gain: 0.7,
        },
        {
          azDeg: 4,
          elDeg: -22,
          radiusDeg: 0.9,
          axisRatio: 0.6,
          angleDeg: 20,
          kind: 'spiral',
          disc: 'hot',
          core: 'warm',
          gain: 0.9,
        },
      ],
      /**
       * What each quality tier bakes: the panorama in texels (4.5 MiB on low, 8 MiB otherwise)
       * and how many of its rows are drawn in one frame. Every tier paints the same sky: a tier
       * is only a size. (Not 1024 x 512 on low: on a phone one of its texels is 13 pixels wide,
       * and a far galaxy would be four of them.)
       */
      tiers: {
        low: { panoWidth: 1536, panoHeight: 768, bandRows: 64 },
        medium: { panoWidth: 2048, panoHeight: 1024, bandRows: 64 },
        high: { panoWidth: 2048, panoHeight: 1024, bandRows: 64 },
      },
    } satisfies SkyLook,

    /** A living sun: a surface of four tones in its family's colour, and a corona round it. */
    sun: {
      /** The low tier's detail (1280 facets). The other tiers use world.detailSun. */
      detailLow: 7,
      /** The hottest tone is the family's light mixed this far toward white. */
      hotMix: 0.55,
      /**
       * Granulation, drawn per pixel by the sun's shader (shaders/toonFlat.ts, SUN): two layers
       * of smooth noise at these frequencies on the unit sphere, the weight of the coarse one,
       * and the three thresholds that cut the sum into four tones (about 15 / 45 / 30 / 10
       * percent, so that the middle of the ball is the family's base). The thresholds are the
       * 15th, 60th and 90th percentiles of THIS noise (sim/gradientNoise.ts, about -1 to 1),
       * measured over seven suns: a change to the frequencies or the weight wants them measured
       * again (sim/sunGrain.test.ts holds the shares). The frequencies are low on purpose: a
       * tone lies in round CELLS a fifth to a third of the ball across, and the fine layer only
       * bends their outlines. `soft`: half the width of the soft edge between two tones, in the
       * noise's units (never thinner than a pixel).
       */
      granulation: {
        freq: 2.6,
        weight: 0.9,
        freq2: 5,
        thresholds: [-0.331, 0.038, 0.338],
        soft: 0.02,
      },
      /**
       * Limb darkening: where the ball is turned this far from the camera (0 edge on, 1 face on)
       * it is two, then one, tone darker: two round bands. `softLimb`: half the width of a
       * band's soft edge, in the same measure.
       */
      limbNz: [0.2, 0.42],
      softLimb: 0.012,
      /** Half the width of the soft rim of a spot's core and of its ring, radians. */
      softSpotRad: 0.008,
      /** Three spots: unit normals in the sun's own space, and angular radii in radians. */
      spots: [
        { normal: [0.35, 0.2, 0.9], radius: 0.16 },
        { normal: [-0.5, -0.25, 0.8], radius: 0.1 },
        { normal: [0.1, -0.5, 0.86], radius: 0.08 },
      ],
      /**
       * The corona, one billboard a sun. Lengths are in sun radii, angles in radians, and a
       * tone is one of the family's three (light, base, shade). `half`: the quad's half-extent.
       * `steps`: flat rings of the base, [inner, outer, alpha]. `glow`: a soft fall from `from`
       * to `to` through stops [position, tone, alpha]. `rays`: how many, how long, how wide
       * (half-angle), how far they may reach, their stops along the length, and which of them
       * the low tier keeps. `prominences`: loops on the limb, at these angles, this wide
       * (half-span), their control point this far out, drawn as strokes [tone, alpha, width].
       * `glint`: a four-point sparkle fixed on the screen. `edge`: the hot hairline of the limb.
       * The corona is two layers (shaders/corona.ts): the LIGHT (steps, glow, rays, prominences)
       * and the LENS (edge, glint). `pull`: how far each stands toward the camera from the sun's
       * centre, [light, lens]: the light behind everything a sun wears (its signs reach 1.7
       * radii), the lens just in front of its ball. `lensHalf`: the half-extent of the lens's
       * quad. `rayBase`: where a ray's base is, just under the limb.
       */
      corona: {
        half: 3.4,
        lensHalf: 1.08,
        pull: [-1.8, 1.01],
        rayBase: 0.98,
        steps: [
          [1, 1.1, 0.4],
          [1.1, 1.28, 0.2],
          [1.28, 1.62, 0.09],
          [1.62, 2.1, 0.04],
        ],
        glow: {
          from: 0.9,
          to: 3.4,
          stops: [
            [0, 'light', 0.34],
            [0.18, 'base', 0.14],
            [0.55, 'shade', 0.05],
            [1, 'shade', 0],
          ] satisfies ReadonlyArray<readonly [number, SunTone, number]>,
        },
        rays: {
          count: 10,
          length: [1.5, 2.5],
          halfAngle: [0.035, 0.06],
          reach: 3.3,
          alphas: [
            [0, 'light', 0.36],
            [0.3, 'base', 0.14],
            [1, 'base', 0],
          ] satisfies ReadonlyArray<readonly [number, SunTone, number]>,
          lowIndices: [0, 2, 3, 5, 7, 8],
        },
        prominences: {
          angles: [0.5, 2.6, 4.4],
          halfSpan: [0.16, 0.21, 0.26],
          control: [1.42, 1.49, 1.56],
          strokes: [
            ['base', 0.5, 0.04],
            ['light', 0.7, 0.012],
          ] satisfies ReadonlyArray<readonly [SunTone, number, number]>,
        },
        glint: { at: [-0.62, -0.62], length: 0.34, widthR: 0.018, dotR: 0.022, alpha: 0.95 },
        edge: { from: 0.985, alpha: 0.55, widthR: 0.012 },
      },
      /** The rays breathe by this share of their length, over a period from this range, seconds. */
      rayBreath: 0.12,
      rayBreathSec: [9, 14],
      /** ...and the prominences by this share of their height. Both hold still under reduced motion. */
      promBreath: 0.1,
      promBreathSec: [11, 17],
    },

    /**
     * Air: a tint on the limb, a shell, a hairline of sunset, clouds and (on home) lamps, on the
     * worlds that have a sea. Air is light, so all of it is round and none of it is on the bloom
     * guest list; on the star map all of it is gone.
     */
    air: {
      /**
       * A world with air multiplies its shade band by shading.night times `night`, and its middle
       * band by shading.dusk times `dusk`, as far as `duskShare` says (1: all of it, a deep sunset
       * belt; 0: the middle band is as lit as the day).
       */
      bands: { dusk: 0.95, night: 0.9, duskShare: 0.6 },
      /**
       * The tint toward the air's colour near the limb (shaders/toonFlat.ts, AIR; its twin is
       * sim/air.ts): limb = (1 - nz)^power, where nz is how squarely the BALL faces the camera
       * there (1 in the middle of the disc, 0 on its outline), cut into `steps` flat levels; its
       * amount is that * (lit * smoothstep(litEdges, how the ball faces its light) + always).
       * What stands on the world is in its air too, fading out between `topRadii` (world radii
       * from the centre): the top of a tower is above it.
       */
      limb: {
        power: 3.2,
        lit: 0.62,
        always: 0.07,
        litEdges: [-0.25, 0.45],
        steps: 3,
        topRadii: [1.04, 1.24],
      },
      /**
       * The shell, a billboard `half` world radii across, standing `pull` world radii toward the
       * camera from the world's centre (in front of its outline and whatever rises on it, behind
       * what stands out toward the camera: a ring road's near side): flat rings
       * [inner, outer, alpha] in world radii (the low tier keeps the first `lowRings`), dimmed
       * toward the night by `mask`, [degrees from the light, value].
       */
      shell: {
        half: 1.4,
        pull: 0.5,
        rings: [
          [1, 1.05, 0.5],
          [1.05, 1.1, 0.26],
          [1.1, 1.18, 0.12],
          [1.18, 1.3, 0.05],
        ],
        lowRings: 3,
        mask: [
          [0, 1],
          [72, 0.85],
          [180, 0.16],
        ],
      },
      /**
       * The hairline where the air ends: its radius (world radii), its width (px, and in world
       * radii where that is wider), and its colour round the limb as stops
       * [degrees from the light, colour, alpha]. The dusk sits at 90 degrees: the terminator.
       * `whiten`: how far 'airLight' is from the air toward white; `duskAir`: how far 'dusk' is
       * from shading.dusk toward the air.
       */
      rim: {
        radius: 1.006,
        widthPx: 1.4,
        widthR: 0.016,
        whiten: 0.4,
        duskAir: 0.2,
        stops: [
          [0, 'airLight', 0.95],
          [61, 'airLight', 0.8],
          [90, 'dusk', 0.9],
          [119, 'air', 0.28],
          [180, 'air', 0.1],
        ] satisfies ReadonlyArray<readonly [number, RimTone, number]>,
      },
      /**
       * Clouds: a round skin at `skin` world radii on which the clouds are DRAWN, pixel by pixel
       * (shaders/air.ts; the twin is sim/clouds.ts). A place is cloud where a field passes
       * `threshold - shareGain * share`: the field is `noiseWeight` of a fractal noise (`octaves`
       * layers, frequencies `freq` on the unit ball: stretched along the latitudes) plus
       * `bandWeight` of a latitude band of frequency `bandFreq`. A cloud is a flat shape with a
       * round outline, `softness` soft (in the field, never thinner than a pixel), in two flat
       * levels: its thin edge at alpha[0], and its body, `core` further into the field, at
       * alpha[1]. Its colour is the world's peak at `tone`, mixed `mix` toward its air, in the
       * same three bands of light as the ground. The whole skin turns `driftRadPerSec` (rad/s;
       * still under reduced motion). `detail`: the skin's ball has 20 * (detail + 1)^2 facets.
       */
      cloud: {
        skin: 1.018,
        threshold: 0.66,
        shareGain: 0.1,
        mix: 0.16,
        tone: 0.9,
        bandFreq: 9,
        freq: [2.3, 6.2, 2.3],
        bandWeight: 0.18,
        noiseWeight: 0.8,
        octaves: 4,
        softness: 0.006,
        core: 0.03,
        alpha: [0.55, 0.94],
        driftRadPerSec: 0.012,
        detail: 8,
      },
      /**
       * Lit windows on a night side, up close: lamps on the land between heights `h` (0 the
       * sea's edge, 1 the highest peak), the `most` places that a noise of frequency `qFreq`
       * favours most (so they gather into towns, and a world never has more). A lamp is a small round dot lying on the ground, `sizeR` across
       * (radius in world radii: the faintest and the brightest), `lift` above it, in
       * color.window, shown where the ball faces its light less than `night`. Never on the bloom
       * guest list: a window is lit, it is not a light.
       */
      windows: {
        h: [0.02, 0.55],
        qFreq: 7.1,
        night: -0.16,
        most: 150,
        sizeR: [0.006, 0.012],
        lift: 0.002,
      },
      /** Which worlds wear their clouds, by quality tier: none, home alone, or every one with air. */
      cloudTiers: { low: 'none', medium: 'home', high: 'all' } satisfies Record<
        QualityTier,
        'none' | 'home' | 'all'
      >,
      /**
       * Which worlds have air, by manifest id: the five globes with a sea. `air` is a key of
       * color.air; `cloud.share` how much of the sky is cloud and `cloud.peak` the biome whose
       * peak colours it. (tests/worlds.test.ts checks that every key names a body.)
       */
      worlds: {
        'page/about': { air: 'terra', cloud: { share: 0.8, peak: 'frost' }, windows: true },
        'project/cyberpatriot': { air: 'frost', cloud: { share: 0.55, peak: 'frost' } },
        'project/robotics': { air: 'dune', cloud: { share: 0.3, peak: 'frost' } },
        'project/hackgt-13': { air: 'tide', cloud: { share: 0.55, peak: 'frost' } },
        'project/cal-hacks-13': { air: 'bloom', cloud: { share: 0.7, peak: 'bloom' } },
      } satisfies Record<string, AirWorld>,
    },

    /**
     * Traffic: two dots on every orbit line of at least `minOrbitRadiusU`, moving along it at
     * `speedUPerSec` (u/s), `sizesPx` across (CSS px), in the system's light. They rest where
     * they start under reduced motion. `seed` places them, with each orbit's own id (sim/traffic.ts).
     */
    traffic: {
      minOrbitRadiusU: 18,
      speedUPerSec: 7,
      sizesPx: [3.4, 2.6],
      opacity: 0.95,
      seed: 'allenkh-traffic',
    },

    /**
     * The chart under the star map: a grid of dots (`dotSpacingPx` apart, `dotRadiusPx` across,
     * CSS px) on a plane at `planeY` (u), and for each system a district: a disc in two flat
     * steps of its family's dim tones (color.nebula), out to `districtOuter` of the system's
     * reach, and a dashed ring (`ringDashPx`: dash and gap) in its base.
     */
    chart: {
      dotSpacingPx: 34,
      dotRadiusPx: 1.3,
      dotAlpha: 0.2,
      districtOuter: 1.18,
      districtOuterAlpha: 0.46,
      districtInnerAlpha: 0.26,
      ringAlpha: 0.55,
      ringWidthPx: 1.2,
      ringDashPx: [3, 5],
      planeY: -2.5,
    },

    /**
     * Lamps on the emblem worlds (design/worlds/shared.ts): a lit window's token and a beacon's
     * (paths under color), and the beacon's radius in the rows' own unit (its body's radius is 1).
     */
    lamps: {
      windowToken: 'window',
      beaconToken: 'star.hot',
      beaconRadius: 0.04,
    } satisfies { windowToken: LampToken; beaconToken: LampToken; beaconRadius: number },
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
     * minSystemGap + 1 = 1071), homeRoom for one beside the home system as it really is (its
     * reach, 66.2 u today, + maxSystemRadius + minSystemGap + 1 = 677.2): 690 lets the home
     * system grow to 79 u (690 - 460 - 151), so a design edit that makes it bigger (dockMin 7,
     * a home planet of 16 and a station of 3 reach 75.6 u) still moves nothing. Moved once, on
     * 2026-09-30, from 610 and 911, to make room for the Projects binary (maxSystemRadius).
     */
    clusterAxisDeg: 135,
    homeRoom: 690,
    slotRoom: 1071,

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
     * 460 is the Projects binary of Allen's tree (Software and Hardware, 401.6 u from their
     * centre) and room for one more planet or moon of any size under either sun: a moon adds
     * 36.8 to 42 u, a planet 30 to 53.6 (size l). Any second addition trips it, and the build says
     * which families to move (data/build.test.ts holds both). (It was 380, which the binary alone
     * outgrows.)
     */
    maxSystemRadius: 460,
    minSystemGap: 150,
    /**
     * A binary star (two suns sharing one slot, systems/<id>.md with `suns`): each sun's family is
     * laid out round it as a system's is, and the two circle their common centre this far apart
     * where they come closest, u. Enough to fly between and to read as two families on the map.
     * One period for both, orbitPeriod(separation), so they stay opposite (layout.ts, binaryOrbits).
     */
    binaryGap: 40,
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
      /**
       * A relay (a profile elsewhere: GitHub, LinkedIn) shares the satellite's ring, so its
       * docking footprint must stay within the satellite's (the build checks): then the home
       * system reaches as far as it did, and a new profile moves nothing.
       */
      relayRadius: 1.4,
    },
  },
} as const;

export type Tuning = typeof tuning;
