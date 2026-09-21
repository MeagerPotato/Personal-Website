import { Euler } from 'three';
import type { CameraMode, Pose, ViewShape } from '../camera/CameraRig';
import type { Frame } from '../core/Engine';
import { clamp } from '../sim/math';

const FOV_DEGREES = 40;
const MAX_PITCH = 1.45;
const RAD_PER_PX = 0.006;
const ZOOM_PER_WHEEL_PX = 0.0012;
/** Closest and farthest, in radii of whatever is on the table. */
const ZOOM_RADII: readonly [near: number, far: number] = [1.3, 12];
/** How much of the view's smaller side the subject fills when it is first shown. */
const FILL = 0.62;

/**
 * DEV ONLY (the lab). The subject sits on a turntable at the origin: drag to look around it, wheel
 * to move in and out, and left alone it turns slowly. Speaks the same Pose as every other camera
 * mode (camera/CameraRig.ts).
 */
export class TurntableCam implements CameraMode {
  yaw = 0.6;
  pitch = 0.35;
  /** Radians per second while nobody drags. */
  turnRate = 0.25;

  private radius = 1;
  private distanceRadii = 4;
  private aspect = 1;
  private dragging = false;
  private readonly euler = new Euler(0, 0, 0, 'YXZ');

  constructor(private readonly surface: HTMLElement) {
    surface.addEventListener('pointerdown', this.onDown);
    surface.addEventListener('pointermove', this.onMove);
    surface.addEventListener('pointerup', this.onUp);
    surface.addEventListener('pointercancel', this.onUp);
    surface.addEventListener('wheel', this.onWheel, { passive: false });
  }

  /** Put something of this radius on the table, and step back far enough to see all of it. */
  frame(radius: number): void {
    this.radius = radius;
    this.distanceRadii = clamp(this.fitRadii(), ...ZOOM_RADII);
  }

  drag(dxPx: number, dyPx: number): void {
    this.yaw -= dxPx * RAD_PER_PX;
    this.pitch = clamp(this.pitch + dyPx * RAD_PER_PX, -MAX_PITCH, MAX_PITCH);
  }

  zoom(wheelPx: number): void {
    this.distanceRadii = clamp(
      this.distanceRadii * Math.exp(wheelPx * ZOOM_PER_WHEEL_PX),
      ...ZOOM_RADII,
    );
  }

  update(frame: Frame, view: ViewShape, out: Pose): void {
    const { aspect } = view;
    if (aspect !== this.aspect) {
      // A different window shape: keep the subject the same size on the smaller side.
      const before = this.fitRadii();
      this.aspect = aspect;
      this.distanceRadii = clamp((this.distanceRadii * this.fitRadii()) / before, ...ZOOM_RADII);
    }
    if (!this.dragging) this.yaw += this.turnRate * frame.dt;

    out.focus.set(0, 0, 0);
    out.quaternion.setFromEuler(this.euler.set(-this.pitch, this.yaw, 0));
    out.distance = this.distanceRadii * this.radius;
    out.fov = FOV_DEGREES;
  }

  dispose(): void {
    const { surface } = this;
    surface.removeEventListener('pointerdown', this.onDown);
    surface.removeEventListener('pointermove', this.onMove);
    surface.removeEventListener('pointerup', this.onUp);
    surface.removeEventListener('pointercancel', this.onUp);
    surface.removeEventListener('wheel', this.onWheel);
  }

  /** Distance, in radii, at which a ball fills FILL of the view's smaller side. */
  private fitRadii(): number {
    const halfVertical = (FOV_DEGREES * Math.PI) / 360;
    const halfSmaller = Math.atan(Math.tan(halfVertical) * Math.min(1, this.aspect));
    return 1 / Math.sin(halfSmaller * FILL);
  }

  private readonly onDown = (event: PointerEvent): void => {
    this.dragging = true;
    this.surface.setPointerCapture(event.pointerId);
  };

  private readonly onMove = (event: PointerEvent): void => {
    if (this.dragging) this.drag(event.movementX, event.movementY);
  };

  private readonly onUp = (): void => {
    this.dragging = false;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.zoom(event.deltaY);
  };
}
