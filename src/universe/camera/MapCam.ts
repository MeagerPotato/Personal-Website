import { Euler, Quaternion } from 'three';
import type { Frame } from '../core/Engine';
import { tuning } from '../design/tuning';
import type { CameraMode, Pose, ViewShape } from './CameraRig';

export interface MapCamParams {
  /**
   * A long lens from far away: everything is seen from almost the same angle, so a planet at the
   * edge of the map is as round as one in the middle. It is still the ONE perspective camera,
   * which is what lets the view pull out of the chase camera and into the map with no pop.
   */
  readonly fovDegrees: number;
}

/** What the map shows right now (ui/StarMap.ts eases it; sim/mapView.ts explains the numbers). */
export interface MapSight {
  /** The point on the flight plane in the middle of the free view. */
  readonly x: number;
  readonly z: number;
  /** World units covered by one CSS px. */
  readonly unitsPerPx: number;
  /** Height of the WHOLE viewport, CSS px: the lens is `fov` tall over all of it. */
  readonly viewportHeight: number;
  /**
   * How far BELOW the middle of the free view the middle of the map belongs, CSS px. The rig puts
   * what a camera looks at in the middle of what the info panel leaves free; the map also keeps
   * clear of the page's top bar, which to a flying camera is only sky with words on it.
   */
  readonly dropPx: number;
}

const RAD_PER_DEG = Math.PI / 180;

/**
 * Straight down, north up: +Z is up the screen. Turned half round first, because a camera left
 * alone has -Z up its screen once it looks down. It is the chase camera of a ship heading along
 * +Z, tipped forward until it looks at its own feet, so pulling out from that heading is a pure
 * tilt, and from any other the view also swings round to north on the way up.
 */
const TOP_DOWN = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, Math.PI, 0, 'YXZ'));

/**
 * THE MAP'S CAMERA: the flight plane from straight above. It only turns what ui/StarMap.ts says
 * is in sight into a pose; the rig blends it with the others and slides it into the free part of
 * the view, exactly as it does for them.
 */
export class MapCam implements CameraMode {
  constructor(
    private readonly sight: MapSight,
    private readonly params: MapCamParams = tuning.map,
  ) {}

  update(_frame: Frame, _view: ViewShape, out: Pose): void {
    const { sight, params } = this;
    const tall = sight.unitsPerPx * sight.viewportHeight;
    // North is up: looking at a point further NORTH puts the middle of the map lower on screen.
    out.focus.set(sight.x, 0, sight.z + sight.dropPx * sight.unitsPerPx);
    out.quaternion.copy(TOP_DOWN);
    out.fov = params.fovDegrees;
    out.distance = tall / 2 / Math.tan((params.fovDegrees / 2) * RAD_PER_DEG);
  }
}
