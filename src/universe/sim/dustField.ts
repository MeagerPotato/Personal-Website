/** A point, or a place in the dust field: plain numbers, so that a three.js Vector3 will do. */
export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/**
 * WHERE IN THE DUST THE VIEWER IS (design/shaders/dust.ts). The field moves with the viewer's
 * step from `from` to `to` exactly, so that every mote stays where it is in the world, until the
 * viewer goes faster than `maxSpeed` (u/s, at `speed`); beyond that it moves only that share of the
 * step. The autopilot's 700 u/s moves the ship 12 u a frame (23 u at 30 fps), and a mote a few
 * units from the camera that jumps that far between two frames reads as noise, not as speed:
 * capped, the dust still streams past as fast as it can be SEEN to, and the rest of the speed
 * shows in the lens and the planets.
 *
 * Each axis of `field` is kept inside [0, box), which is the same field to the shader (it wraps
 * by the box) and keeps float precision for an hour of flying. Returns the share of the step
 * taken, which is also the share of the velocity the streaks should show.
 */
export function slideField(
  field: Point3,
  from: Readonly<Point3>,
  to: Readonly<Point3>,
  speed: number,
  maxSpeed: number,
  box: readonly [number, number, number],
): number {
  const share = speed > maxSpeed && speed > 0 ? Math.max(0, maxSpeed) / speed : 1;
  field.x = wrap(field.x + (to.x - from.x) * share, box[0]);
  field.y = wrap(field.y + (to.y - from.y) * share, box[1]);
  field.z = wrap(field.z + (to.z - from.z) * share, box[2]);
  return share;
}

function wrap(value: number, size: number): number {
  return size > 0 ? value - size * Math.floor(value / size) : value;
}
