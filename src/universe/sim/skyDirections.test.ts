import { describe, expect, it } from 'vitest';
import { tuning } from '../design/tuning';
import {
  azimuthBetween,
  azimuthDeg,
  directionOf,
  elevationDeg,
  pointOf,
  rayOf,
  SKY_POSE_NAMES,
  SKY_POSES,
  wrapDeg,
} from './skyDirections';

const length = (v: readonly number[]): number => Math.hypot(...v);

describe('directions in the sky', () => {
  it('puts azimuth 0 along +Z, 90 along +X, and elevation 90 straight up', () => {
    expect(directionOf(0, 0)).toEqual([0, 0, 1]);
    const east = directionOf(90, 0);
    expect(east[0]).toBeCloseTo(1, 12);
    expect(east[2]).toBeCloseTo(0, 12);
    expect(directionOf(37, 90)[1]).toBeCloseTo(1, 12);
  });

  it('gives unit vectors, and reads back the angles it was given', () => {
    for (const [az, el] of [
      [-45, -22],
      [195, -22],
      [75, 31],
      [-165, 4],
    ] as const) {
      const d = directionOf(az, el);
      expect(length(d)).toBeCloseTo(1, 12);
      expect(wrapDeg(azimuthDeg(d) - az)).toBeCloseTo(0, 9);
      expect(elevationDeg(d)).toBeCloseTo(el, 9);
    }
  });

  it('wraps a difference of angles to the short way round', () => {
    expect(wrapDeg(190)).toBe(-170);
    expect(wrapDeg(-190)).toBe(170);
    expect(wrapDeg(360)).toBe(0);
    expect(wrapDeg(180)).toBe(-180);
  });

  it('converts the layout’s bearings: azimuth is 90 minus the bearing', () => {
    // A point at bearing 135 (degrees from +X toward +Z) on the flight plane, [x, z].
    expect(azimuthBetween([0, 0], [-1, 1])).toBeCloseTo(90 - 135, 9);
    expect(azimuthBetween([0, 0], [1, 0])).toBeCloseTo(90, 9);
    expect(azimuthBetween([10, 10], [10, 20])).toBeCloseTo(0, 9);
  });
});

describe('the seven views', () => {
  it('are the seven the look is judged from', () => {
    expect(SKY_POSE_NAMES).toEqual(['first', 'cruise', 'docked', 'proj', 'hack', 'res', 'band']);
    // Only the docked view shows the sky at half strength.
    expect(SKY_POSE_NAMES.filter((name) => SKY_POSES[name].exposure !== 1)).toEqual(['docked']);
  });

  it('look where they say, through the middle of the picture', () => {
    for (const name of SKY_POSE_NAMES) {
      const pose = SKY_POSES[name];
      const centre = rayOf(pose, 0, 0, 1.6);
      expect(wrapDeg(azimuthDeg(centre) - pose.yawDeg), name).toBeCloseTo(0, 9);
      expect(elevationDeg(centre), name).toBeCloseTo(pose.pitchDeg, 9);
    }
  });

  it('have up at the top, and azimuth growing to the left', () => {
    const pose = SKY_POSES.proj;
    const centre = rayOf(pose, 0, 0, 1.6);
    expect(elevationDeg(rayOf(pose, 0, 1, 1.6))).toBeGreaterThan(elevationDeg(centre));
    expect(wrapDeg(azimuthDeg(rayOf(pose, 1, 0, 1.6)) - pose.yawDeg)).toBeLessThan(0);
    expect(wrapDeg(azimuthDeg(rayOf(pose, -1, 0, 1.6)) - pose.yawDeg)).toBeGreaterThan(0);
  });

  it('span the field of view they name, top to bottom', () => {
    const pose = SKY_POSES.first;
    const top = rayOf(pose, 0, 1, 1.6);
    const bottom = rayOf(pose, 0, -1, 1.6);
    const between = Math.acos(top[0] * bottom[0] + top[1] * bottom[1] + top[2] * bottom[2]);
    expect((between * 180) / Math.PI).toBeCloseTo(pose.fovDeg, 9);
    expect(length(top)).toBeCloseTo(1, 12);
  });

  it('find the point of the picture a direction falls on, the other way round', () => {
    for (const name of SKY_POSE_NAMES) {
      const pose = SKY_POSES[name];
      for (const [u, v] of [
        [0, 0],
        [0.7, -0.4],
        [-1, 1],
        [1.6, 0.2],
      ] as const) {
        const point = pointOf(pose, rayOf(pose, u, v, 1.6), 1.6);
        expect(point?.[0], name).toBeCloseTo(u, 9);
        expect(point?.[1], name).toBeCloseTo(v, 9);
      }
      // What lies behind the camera is in no picture.
      const ahead = rayOf(pose, 0, 0, 1.6);
      expect(pointOf(pose, [-ahead[0], -ahead[1], -ahead[2]], 1.6), name).toBeNull();
    }
  });

  it('start with the chase camera at rest: looking down by its own height over its reach', () => {
    // 4.4 u above the ship, looking at a point 11 + 14 u ahead of itself (tuning.chaseCam).
    const { back, up, lookAheadBase } = tuning.chaseCam;
    const pitch = (-Math.atan2(up, back + lookAheadBase) * 180) / Math.PI;
    expect(SKY_POSES.first.pitchDeg).toBeCloseTo(pitch, 1);
  });
});
