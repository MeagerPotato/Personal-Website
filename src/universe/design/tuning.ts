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
import type { InstrumentParams } from '../sim/instruments';
import type { MiniMapParams } from '../sim/minimap';
import type { PlanetLook } from '../sim/planet';
import type { FlightParams } from '../sim/types';
import type { Terrain, TerrainName } from '../sim/world/ground';
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
    /** The stars dim to this share of themselves, and the dust is put away: a map is a calm thing. */
    starOpacity: 0.3,
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
   * THE FLIGHT DECK (ui/FlightDeck.ts, sim/instruments.ts): the cluster of instruments at the
   * bottom of the view, laid out as Kerbal Space Program's. It only READS the simulation. How it
   * LOOKS, and where it sits, is CSS (`.flight-deck`); these decide when it has room and what
   * its gauges count as full.
   */
  instruments: {
    /**
     * The free view (the viewport less the info panel) has to be this big, in rem [width,
     * height], for the whole cluster: 768 by 576 px at the usual type size...
     */
    fullMinRem: [48, 36],
    /** ...and this big for the strip in the Map button's row (296 by 320 px). Less: no deck. */
    stripMinRem: [18.5, 20],
    /**
     * The ship is IN a system from this many of its radii from its centre, and until it is this
     * many out: the horizon of the ball wears that system's family (and `ink.low` between them).
     */
    enterRadii: 1,
    leaveRadii: 1.3,
    /** u/s. Slower than this the prograde mark is put away: a ship at rest is going nowhere. */
    progradeMinSpeed: 2,
    /** u/s² that read as one g: a unit is a metre, so the Earth's own. */
    gUnit: 9.81,
    /**
     * The g arc is full at this many g, and past it the peg lights. By hand the ship pulls 3.5 g
     * from rest, 6.6 boosting and up to 12.3 in a full turn at a boosting pilot's top speed; the
     * autopilot pulls about 60: playful, and true.
     */
    gFull: 15,
    /** 1/s. How quickly the g arc follows; the throttle arc follows at the flame's own rate. */
    gOmega: 10,
    throttleOmega: 14,
    /** ASSIST lights once the orbit assist does more than this share of the flying (0 to 1). */
    assistOn: 0.05,
    /**
     * u/s. One, two and three chevrons beside the speed from these on. A boosting pilot's best
     * is 81, so a chevron always means the autopilot has the ship.
     */
    warpTiers: [82, 300, 600],
    /** The digits change at most this often a second; under reduced motion, this often. */
    digitsHz: 10,
    digitsHzReduced: 4,
  } satisfies InstrumentParams,

  /**
   * THE MINIMAP (ui/MiniMap.ts, sim/minimap.ts): the star map at another size, beside the flight
   * deck. It looks at the whole galaxy, or at the system the ship is in; a press on a mark flies
   * there. How it LOOKS is CSS (`.minimap`); these are the star map's own knobs (`map`, above)
   * at its scale, and what is its own.
   */
  minimap: {
    /**
     * The view: fitted to the galaxy or to one system (and the ship, wherever it is), fitMargin
     * times the room that needs plus fitPadPx on every side (CSS px: no names here, only room
     * for a mark at the edge to be whole), and never closer than spanMin world units across.
     */
    spanMin: 100,
    zoomOutPastFit: 1,
    fitMargin: 1.05,
    fitPadPx: 8,
    /** 1/s. How quickly the view eases from one scope to the other. A cut under reduced motion. */
    viewOmega: 8,
    /**
     * No mark is smaller than this (radius, CSS px), by kind. From the galaxy only the suns and
     * home are worth a mark (0: true size, which is nothing there); inside a system its planets,
     * docks and moons are too. A relay is never a mark: nothing docks at it.
     */
    minRadiusPx: {
      galaxy: { sun: 5.5, home: 5.5, planet: 0, moon: 0, station: 0, satellite: 0, link: 0 },
      system: { sun: 5.5, home: 5.5, planet: 2.5, moon: 1.75, station: 2, satellite: 2, link: 0 },
    },
    /** A body that circles another shows once their marks are this far apart (CSS px)... */
    clearPx: 1,
    /** ...and no mark under this (radius, CSS px) is drawn at all. */
    minVisiblePx: 1.5,
    /**
     * A system off the frame is a mark at the rim, rimInsetPx inside the edge in its direction
     * and rimRadiusPx in radius: always one press away. (Keep rimInsetPx under fitPadPx, or a
     * system at the edge of the galaxy is pinned on the view that shows all of it.)
     */
    rimInsetPx: 7,
    rimRadiusPx: 4.5,
    /** CSS px. A finger near two marks aims at one only if the other is this much further off. */
    ambiguityPx: 8,
    /** A journey's line goes through at most this many points of the autopilot's path. */
    routePoints: 32,
    /** The marks are put in place this often a second; the ship, every frame. */
    bodiesHz: 5,
    /** CSS px. The ship's chevron, tip to tail. */
    shipPx: 10,
  } satisfies MiniMapParams,

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
    /** Each facet's colour is nudged by up to this share: flat areas look hand-made. */
    colorJitter: 0.03,
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
        reliefShare: 0.045,
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
        reliefShare: 0.03,
        frequency: 0.95,
        octaves: 3,
        seaLevel: -0.5,
        peakAt: 0.55,
        terraces: 2,
        terraceStrength: 0.85,
        bandStops: [0.08, 0.5, 0.86],
      },
    },
    /** Small islands in a sea. */
    isles: {
      look: {
        reliefShare: 0.04,
        frequency: 2.3,
        octaves: 3,
        seaLevel: 0.12,
        peakAt: 0.6,
        terraces: 3,
        terraceStrength: 0.8,
        bandStops: [0.12, 0.5, 0.85],
      },
    },
    /**
     * Planned work: unfired clay, rougher than any built world (the note on `planet.reliefShare`:
     * above 0.07 the outline turns lumpy, which is the point).
     */
    lumpy: {
      look: {
        reliefShare: 0.07,
        frequency: 1.5,
        octaves: 3,
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
    /** A sun's smooth ball: mostly its base, with lighter and darker patches, and no nudge at all. */
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
    detailMoon: 3,
    detailSun: 4,
    /**
     * Planned work, not built yet: an unpainted maquette in its family's pale colours, as coarse
     * as a model before the detail goes on (1 is 80 facets), with no close-up (world/looks.ts).
     */
    detailPlanned: 1,
    /**
     * The worlds of their own (sim/world, design/worlds): a planned body there is a maquette of
     * primer clay that does not sharpen up close, coarser than a built world but not a sketch
     * (980 facets for a planet, 320 for a moon). `detailPlanned` above is today's placeholder
     * look, which the worlds replace body by body.
     */
    detailMaquettePlanet: 6,
    detailMaquetteMoon: 3,
    /**
     * A planned world is drawn at this share of its finished size, rows and all: a maquette of
     * primer clay inside the dashed ring its rows draw at the finished size (about 1 radius at
     * this scale: vocabulary.md, section 6). Its declared reach (design/worlds/reach.ts) is
     * measured at this scale, so tests/world-reach.test.ts follows a change here.
     */
    plannedScale: 0.7,
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
