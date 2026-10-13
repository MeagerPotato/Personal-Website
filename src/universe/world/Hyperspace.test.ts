import { Group, Vector3, type Mesh, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import {
  HYPER_FAMILY_TINT,
  HYPER_TINT_SHARES,
  type HyperDashMaterial,
  type HyperTubeMaterial,
} from '../design/materials';
import { THEME_KEYS, tokens, type ThemeKey } from '../design/tokens';
import { tuning } from '../design/tuning';
import { hexToLinear } from '../sim/color';
import {
  HYPER_NONE,
  HYPER_OFFERED,
  HYPER_SPENT,
  HYPER_TUNNEL,
  HYPER_WINDUP,
  type Hyper,
} from '../sim/docking';
import { Hyperspace, dashBuffers } from './Hyperspace';

// How a jump is DRAWN (world/Hyperspace.ts). The GLSL only runs on a GPU; what is held here is
// everything round it: when it draws and how much, what it tells the shaders, and that it
// follows the simulation's two fields and nothing else. What a jump looks like at each moment is
// sim/hyper.ts (hyperLook), tested there.

const P = tuning.hyper;
const STEP = 1 / 60;

/** The draw calls of what is shown: every visible mesh and line under `root`. */
function drawCalls(root: Object3D): number {
  let calls = 0;
  root.traverseVisible((child) => {
    const drawn = child as Mesh;
    if (drawn.isMesh || (child as { isLine?: boolean }).isLine) calls += 1;
  });
  return calls;
}

function setup(over: { dashes?: number; ribs?: boolean } = {}) {
  const dock = { hyper: HYPER_NONE as Hyper, hyperSec: 0 };
  const ship = {
    position: new Vector3(),
    velocity: new Vector3(0, 0, 600),
    heading: 0,
    speed: 600,
  };
  const target = { id: 'project/fishai', theme: 'coral' as ThemeKey | undefined };
  const world = { headed: true, map: 0, fov: 55 };
  const camera = {
    get fov() {
      return world.fov;
    },
  };
  const view = new Hyperspace({
    dock,
    ship,
    target: () => (world.headed ? target : null),
    mapWeight: () => world.map,
    camera,
    dashes: over.dashes ?? 500,
    ribs: over.ribs ?? true,
  });
  view.resize({ width: 1280, height: 800, pixelRatio: 2 });
  const [tube, dashes] = view.object.children as [
    Mesh<never, HyperTubeMaterial>,
    Mesh<never, HyperDashMaterial>,
  ];
  let time = 0;
  /** One frame, a step of the simulation after the last: the dock's clock runs with it. */
  const frame = (dt = STEP): void => {
    time += dt;
    if (dock.hyper === HYPER_WINDUP || dock.hyper === HYPER_TUNNEL) dock.hyperSec += dt;
    view.frameUpdate({ elapsed: time, dt, alpha: 1, simTime: time });
  };
  const run = (seconds: number): void => {
    for (let k = Math.round(seconds / STEP); k > 0; k -= 1) frame();
  };
  const become = (hyper: Hyper): void => {
    dock.hyper = hyper;
    dock.hyperSec = 0;
  };
  /** Past the first frame, which is drawn at nothing. */
  const idle = (): void => {
    frame();
    frame();
  };
  return { view, dock, ship, target, world, tube, dashes, frame, run, become, idle };
}

describe('the dashes of hyperspace', () => {
  it('are one indexed mesh of quads: four vertices a dash, indices in 16 bits', () => {
    for (const count of Object.values(P.dashes)) {
      const { position, dash, index } = dashBuffers(count);
      expect(position.length).toBe(count * 4 * 3);
      expect(dash.length).toBe(count * 4 * 4);
      expect(index).toBeInstanceOf(Uint16Array);
      expect(index.length).toBe(count * 6);
      expect(Math.max(...index)).toBe(count * 4 - 1);
      // No tier asks for more than the budget: 1,400 dashes.
      expect(count * 4).toBeLessThanOrEqual(5600);
    }
    expect(() => dashBuffers(16385)).toThrow(/16 bits/);
  });

  it('are the same on every visit', () => {
    expect(dashBuffers(500)).toEqual(dashBuffers(500));
    // And a tier with fewer has the first of the same ones.
    const few = dashBuffers(500);
    const many = dashBuffers(1400);
    expect(many.position.slice(0, few.position.length)).toEqual(few.position);
    expect(many.dash.slice(0, few.dash.length)).toEqual(few.dash);
  });

  it('give every dash a ray, a phase, a brightness, a pace and a tint, the same at its four corners', () => {
    const count = 1400;
    const { position, dash } = dashBuffers(count);
    const tints = HYPER_TINT_SHARES.map(() => 0);
    const corners = new Set<string>();
    for (let i = 0; i < count; i += 1) {
      const at = (corner: number, k: number): number => position[(i * 4 + corner) * 3 + k] ?? NaN;
      const of = (corner: number, k: number): number => dash[(i * 4 + corner) * 4 + k] ?? NaN;
      // Round the course, somewhere along its ray, with a brightness of its own.
      expect(at(0, 0)).toBeGreaterThanOrEqual(0);
      expect(at(0, 0)).toBeLessThan(2 * Math.PI);
      expect(at(0, 1)).toBeGreaterThanOrEqual(0);
      expect(at(0, 1)).toBeLessThan(1);
      // A dash in a family's colour is never dim: a pastel at a fifth of itself is a grey.
      expect(at(0, 2)).toBeGreaterThanOrEqual(of(0, 3) < HYPER_FAMILY_TINT ? 0.2 : 0.5);
      expect(at(0, 2)).toBeLessThanOrEqual(1);
      expect(of(0, 2)).toBeGreaterThanOrEqual(0.6);
      expect(of(0, 2)).toBeLessThanOrEqual(1.4);
      for (let corner = 0; corner < 4; corner += 1) {
        for (const k of [0, 1, 2]) expect(at(corner, k)).toBe(at(0, k));
        for (const k of [2, 3]) expect(of(corner, k)).toBe(of(0, k));
        corners.add(`${of(corner, 0)},${of(corner, 1)}`);
      }
      tints[of(0, 3)] = (tints[of(0, 3)] ?? 0) + 1;
    }
    // The tail and the head, on either side.
    expect([...corners].sort()).toEqual(['-1,-1', '-1,1', '1,-1', '1,1']);
    // Half starlight and half the families' colours, the destination's own in the lead.
    tints.forEach((n, tint) => {
      expect(n / count, `tint ${tint}`).toBeCloseTo(HYPER_TINT_SHARES[tint] ?? NaN, 1);
    });
  });
});

describe('hyperspace, drawn', () => {
  it('is drawn once at nothing, so that its programs are ready, and then not at all', () => {
    const h = setup();
    h.frame();
    expect(drawCalls(h.view.object)).toBe(2);
    expect(h.tube.material.uniforms.uOpen.value).toBe(0);
    expect(h.dashes.material.uniforms.uAlpha.value).toBe(0);
    expect(h.tube.material.uniforms.uRing.value.toArray()).toEqual([0, 0]);

    h.frame();
    expect(h.view.object.visible).toBe(false);
    expect(drawCalls(h.view.object)).toBe(0);
    // An offer is nothing to draw, and neither is a journey whose jump is over.
    for (const hyper of [HYPER_OFFERED, HYPER_SPENT, HYPER_NONE] as const) {
      h.become(hyper);
      h.run(0.5);
      expect(drawCalls(h.view.object), String(hyper)).toBe(0);
      expect(h.view.look).toMatchObject({ dots: 0, veil: 0, calm: 0, surge: 0 });
    }
  });

  it('draws a jump in two calls at most, both sky: after the stars, before all else', () => {
    const h = setup();
    h.idle();
    h.become(HYPER_WINDUP);
    h.frame();
    // The first moment of a wind-up is the sky dimming round one spot: the dots are not up yet.
    expect(h.tube.visible).toBe(true);
    expect(h.dashes.visible).toBe(false);
    let most = 0;
    for (let k = 0; k < 30; k += 1) {
      h.frame();
      most = Math.max(most, drawCalls(h.view.object));
    }
    h.become(HYPER_TUNNEL);
    for (let k = 0; k < 90; k += 1) {
      h.frame();
      most = Math.max(most, drawCalls(h.view.object));
      expect(drawCalls(h.view.object)).toBe(2);
    }
    expect(most).toBe(2);
    for (const mesh of [h.tube, h.dashes]) {
      expect(mesh.frustumCulled).toBe(false);
      expect(mesh.renderOrder).toBeGreaterThan(-1);
      expect(mesh.renderOrder).toBeLessThan(0);
    }
    expect(h.tube.renderOrder).toBeLessThan(h.dashes.renderOrder);
  });

  it('tells the shaders the look of the frame, and others what they wear of it', () => {
    const h = setup();
    h.idle();
    h.become(HYPER_WINDUP);
    h.run(P.windupSec);
    const wound = h.view.look;
    expect(wound.veil).toBeCloseTo(0.15, 6);
    expect(wound.calm).toBeCloseTo(0.3, 6);
    expect(h.tube.material.uniforms.uOpen.value).toBe(wound.veil);
    expect(h.dashes.material.uniforms.uStretch.value).toBe(wound.stretch);
    expect(h.dashes.material.uniforms.uAlpha.value).toBe(wound.dots);

    h.become(HYPER_TUNNEL);
    h.frame();
    // The punch: its ring is on its way out from the eye, strongest at the start.
    const ring = h.tube.material.uniforms.uRing.value;
    expect(ring.x).toBeGreaterThan(0);
    expect(ring.x).toBeLessThan(P.eyeRad);
    expect(ring.y).toBeGreaterThan(0.8 * P.ringAlpha);
    expect(h.view.look.surge).toBe(1);
    h.run(1);
    expect(h.view.look).toEqual({
      stretch: 0.45 + (0.55 * 600) / tuning.cruise.far.cruiseSpeed,
      dots: 1,
      veil: 1,
      calm: 1,
      surge: 1,
      punch: -1,
      drop: -1,
    });
    expect(h.tube.material.uniforms.uOpen.value).toBe(1);
    expect(ring.toArray()).toEqual([0, 0]);
    // What tuning says of the tunnel reaches it every frame (the dev panel's sliders).
    expect(h.tube.material.uniforms.uBands.value).toBe(P.bands);
    expect(h.tube.material.uniforms.uEye.value).toBe(P.eyeRad);
    expect(h.tube.material.uniforms.uWash.value.toArray()).toEqual([...P.wash]);
    expect(h.dashes.material.uniforms.uLength.value).toBe(P.dashLength);
  });

  it('sizes a dash in pixels of the screen, whatever the lens, and never under one of the device', () => {
    const h = setup();
    h.idle();
    h.become(HYPER_TUNNEL);
    h.frame();
    const { uWidth, uPixel } = h.dashes.material.uniforms;
    const cssPixel = (2 * Math.tan((55 * Math.PI) / 360)) / 800;
    expect(uWidth.value).toBeCloseTo(P.dashWidthPx * cssPixel, 12);
    expect(uPixel.value).toBeCloseTo(cssPixel / 2, 12);
    // The lens opens in the tunnel (camera/ChaseCam.ts): the same pixels then span more.
    h.world.fov = 82;
    h.frame();
    expect(uWidth.value).toBeCloseTo(
      (P.dashWidthPx * 2 * Math.tan((82 * Math.PI) / 360)) / 800,
      12,
    );
    h.view.resize({ width: 390, height: 844, pixelRatio: 1 });
    h.frame();
    expect(uPixel.value).toBeCloseTo((2 * Math.tan((82 * Math.PI) / 360)) / 844, 12);
  });

  it('streams only in the tunnel, faster with the ship, and from the start at each jump', () => {
    const h = setup();
    h.idle();
    h.become(HYPER_WINDUP);
    h.run(0.35);
    // The wind-up pulls the dots out where they stand.
    expect(h.dashes.material.uniforms.uFlow.value).toBe(0);
    h.become(HYPER_TUNNEL);
    h.ship.speed = tuning.cruise.far.cruiseSpeed;
    h.run(1);
    const fast = h.dashes.material.uniforms.uFlow.value;
    expect(fast).toBeCloseTo(P.flowPerSec, 6);
    expect(h.tube.material.uniforms.uFlow.value).toBe(fast);
    // Half as fast: two thirds of the pace (it never stands still in there).
    h.ship.speed = tuning.cruise.far.cruiseSpeed / 2;
    h.run(1);
    expect(h.dashes.material.uniforms.uFlow.value - fast).toBeCloseTo(P.flowPerSec * 0.675, 6);
    // On its way out it stops where it is, and the dashes fall back into points there.
    h.become(HYPER_SPENT);
    const stopped = h.dashes.material.uniforms.uFlow.value;
    h.run(0.2);
    expect(h.dashes.material.uniforms.uFlow.value).toBe(stopped);
    // The next jump begins again.
    h.run(1);
    h.become(HYPER_WINDUP);
    h.frame();
    expect(h.dashes.material.uniforms.uFlow.value).toBe(0);
  });

  it('points the tunnel the way the ship is going, comes round to a new course, and never jumps', () => {
    const h = setup();
    h.idle();
    // From rest the ship has no course yet: where it points.
    h.ship.speed = 5;
    h.ship.velocity.set(5, 0, 0);
    h.ship.heading = Math.PI / 2;
    h.become(HYPER_WINDUP);
    h.frame();
    const axis = h.tube.material.uniforms.uAxis.value;
    expect(axis.x).toBeCloseTo(1, 9);
    expect(axis.z).toBeCloseTo(0, 9);
    // The plane the dashes lie in faces it: right, up, the course.
    expect(h.dashes.material.uniforms.uFrame.value.elements).toEqual(
      [0, 0, -1, 0, 1, 0, 1, 0, 0].map((value) => expect.closeTo(value, 9) as number),
    );

    // Under way, it is the way the ship is GOING, whichever way it points.
    h.ship.speed = 600;
    h.ship.velocity.set(0, 0, 600);
    let last = axis.clone();
    let swung = 0;
    for (let k = 0; k < 60; k += 1) {
      h.frame();
      expect(axis.length()).toBeCloseTo(1, 9);
      swung = Math.max(swung, axis.angleTo(last));
      last = axis.clone();
    }
    // A quarter turn asked for at once is taken over many frames, not one.
    expect(swung).toBeLessThan(0.3);
    expect(axis.z).toBeCloseTo(1, 3);
    // A course the other way round is still a course (half way between the two there is none).
    h.ship.velocity.set(0, 0, -600);
    h.run(1.5);
    expect(axis.length()).toBeCloseTo(1, 9);
    expect(axis.z).toBeCloseTo(-1, 3);
  });

  it('wears the family of where it is going, and keeps it on the way out', () => {
    const h = setup();
    h.idle();
    h.become(HYPER_TUNNEL);
    h.frame();
    const line = (): number[] => h.tube.material.uniforms.uLine.value.toArray();
    const wash = (): number[] => h.tube.material.uniforms.uShade.value.toArray();
    const close = (hex: string): number[] =>
      hexToLinear(hex).map((value) => expect.closeTo(value, 6) as number);
    const { coral, mint } = tokens.color.system;
    const others = (theme: ThemeKey): string[] =>
      THEME_KEYS.filter((key) => key !== theme).map((key) => tokens.color.system[key].base);
    const tints = (): number[][] =>
      h.dashes.material.uniforms.uTint.value.map((tint) => tint.toArray());
    const { white, cool, warm } = tokens.color.star;
    // The family is in the lines; the walls are deep space's navy whatever the family.
    expect(line()).toEqual(close(coral.base));
    expect(wash()).toEqual(close(tokens.color.space[700]));
    // Among the dashes it leads the colours, and the other families follow.
    expect(tints()).toEqual([white, cool, warm, coral.base, ...others('coral')].map(close));
    const twist = h.dashes.material.uniforms.uTwist.value;

    // Another destination while the jump lasts (the simulation ends the old one, and a visitor
    // who presses again is in the next): dressed again, a field of its own.
    h.target.id = 'system/research';
    h.target.theme = 'mint';
    h.frame();
    expect(line()).toEqual(close(mint.base));
    expect(wash()).toEqual(close(tokens.color.space[700]));
    expect(tints()).toEqual([white, cool, warm, mint.base, ...others('mint')].map(close));
    expect(h.dashes.material.uniforms.uTwist.value).not.toBe(twist);

    // On its way out it keeps what it wore, whatever the ship is told next, or nothing at all.
    h.become(HYPER_NONE);
    h.target.id = 'page/about';
    h.target.theme = 'butter';
    h.frame();
    expect(h.view.object.visible).toBe(true);
    expect(line()).toEqual(close(mint.base));
    expect(tints()[HYPER_FAMILY_TINT]).toEqual(close(mint.base));
    h.world.headed = false;
    h.frame();
    expect(line()).toEqual(close(mint.base));

    // A body the galaxy gives no family: the stars' cool white in the lines.
    const plain = setup();
    plain.target.theme = undefined;
    plain.idle();
    plain.become(HYPER_TUNNEL);
    plain.frame();
    expect(plain.tube.material.uniforms.uShade.value.toArray()).toEqual(
      close(tokens.color.space[700]),
    );
    expect(plain.tube.material.uniforms.uLine.value.toArray()).toEqual(
      close(tokens.color.star.cool),
    );
  });

  it('goes in dropoutSec whichever way the jump ended, with a ring only after the tunnel', () => {
    for (const from of [HYPER_TUNNEL, HYPER_WINDUP] as const) {
      // Arriving and Stop end in SPENT or NONE; a wind-up taken back is an offer again.
      for (const to of [HYPER_SPENT, HYPER_NONE, HYPER_OFFERED] as const) {
        const h = setup();
        h.idle();
        h.become(from);
        h.run(0.5);
        h.become(to);
        h.frame();
        const what = `${from} to ${to}`;
        expect(h.view.object.visible, what).toBe(true);
        // The lens is let go of at once (it eases back by itself).
        expect(h.view.look.surge, what).toBe(0);
        expect(h.view.look.drop >= 0, what).toBe(from === HYPER_TUNNEL);
        h.run(P.dropoutSec - 3 * STEP);
        expect(h.view.object.visible, what).toBe(true);
        h.run(3 * STEP);
        expect(h.view.object.visible, what).toBe(false);
        expect(drawCalls(h.view.object), what).toBe(0);
        expect(h.view.look, what).toEqual({
          stretch: 0,
          dots: 0,
          veil: 0,
          calm: 0,
          surge: 0,
          punch: -1,
          drop: -1,
        });
      }
    }
  });

  it('closes the tunnel with a ring round the course: faint while it is wide, gone as it gets to the eye', () => {
    const h = setup();
    h.idle();
    h.become(HYPER_TUNNEL);
    h.run(1);
    const ring = h.tube.material.uniforms.uRing.value;
    h.become(HYPER_SPENT);
    h.frame();
    // It begins past the corner of any screen, and all but unseen: never a sweep across the view.
    expect(ring.x).toBeGreaterThan(1);
    expect(ring.y).toBeLessThan(0.15 * P.ringAlpha);
    let last = ring.x;
    let most = 0;
    let mostAt = Number.NaN;
    let frames = 1;
    for (; h.view.look.drop >= 0; frames += 1) {
      h.frame();
      if (h.view.look.drop < 0) break;
      // Inward, every frame.
      expect(ring.x).toBeLessThan(last);
      last = ring.x;
      if (ring.y > most) [most, mostAt] = [ring.y, ring.x];
    }
    // At its clearest when it is small, round the eye; and it is gone before the dots are.
    expect(mostAt).toBeLessThan(0.35);
    expect(most).toBeGreaterThan(0.5 * P.ringAlpha);
    expect(most).toBeLessThanOrEqual(P.ringAlpha);
    expect(last).toBeLessThan(P.eyeRad);
    expect(frames * STEP).toBeLessThan(P.dropoutSec);
    expect(h.view.object.visible).toBe(true);
    expect(ring.toArray()).toEqual([0, 0]);
  });

  it('does not cut a picture that is still going when the next jump is taken', () => {
    // Twins: a jump ends (another destination was picked in the tunnel); one of the two takes
    // the next journey's jump a tenth of a second later, while the picture is still going.
    const again = setup();
    const gone = setup();
    for (const h of [again, gone]) {
      h.idle();
      h.become(HYPER_TUNNEL);
      h.run(1);
      h.become(HYPER_NONE);
      h.run(0.1);
    }
    expect(gone.view.look.dots).toBe(1);
    expect(gone.view.look.stretch).toBeGreaterThan(0.5);
    const flow = again.dashes.material.uniforms.uFlow.value;
    again.become(HYPER_WINDUP);
    const parts = ['stretch', 'dots', 'veil', 'calm'] as const;
    for (let k = 0; gone.view.object.visible; k += 1) {
      again.frame();
      gone.frame();
      const wound = Math.min(1, ((k + 1) * STEP) / P.windupSec);
      for (const part of parts) {
        // Never less than what was going.
        expect(again.view.look[part], `${part} ${k}`).toBeGreaterThanOrEqual(gone.view.look[part]);
      }
      // Nor less than the wind-up alone.
      expect(again.view.look.veil, `veil ${k}`).toBeGreaterThanOrEqual(0.15 * wound - 1e-12);
      // The ring that was closing goes on closing.
      expect(again.view.look.drop, `ring ${k}`).toBe(gone.view.look.drop);
      if (k === 0) {
        // The first frame of it is the picture that was there: no dash moved, none went out.
        for (const part of parts) {
          expect(again.view.look[part], part).toBeCloseTo(gone.view.look[part], 2);
        }
        expect(again.dashes.material.uniforms.uFlow.value).toBe(flow);
        expect(again.view.look.stretch).toBeGreaterThan(0.5);
      }
    }
    // Once the old one has gone it is the wind-up alone, where it would have been anyway.
    again.frame();
    const alone = setup();
    alone.idle();
    alone.become(HYPER_WINDUP);
    alone.run(again.dock.hyperSec);
    for (const part of [...parts, 'surge', 'punch', 'drop'] as const) {
      expect(again.view.look[part], part).toBeCloseTo(alone.view.look[part], 9);
    }
    // And it streams on from where it stood: a second jump is not a new field.
    again.become(HYPER_TUNNEL);
    again.frame();
    expect(again.dashes.material.uniforms.uFlow.value).toBeGreaterThan(flow);
  });

  it('shows no picture from the future when the clock is put back, as the lab does', () => {
    // The lab holds a jump at any moment of it: its slider is the simulation time, and goes
    // back as well as on. Held half way out, then put back into the wind-up.
    const tunnelEnds = 1.95;
    const hold = (h: ReturnType<typeof setup>, seconds: number): void => {
      const wound = seconds >= P.windupSec;
      h.dock.hyper = !wound ? HYPER_WINDUP : seconds < tunnelEnds ? HYPER_TUNNEL : HYPER_SPENT;
      h.dock.hyperSec = wound ? seconds - P.windupSec : seconds;
      h.view.frameUpdate({ elapsed: 0, dt: STEP, alpha: 1, simTime: seconds });
    };
    const held = setup();
    const first = setup();
    for (const h of [held, first]) h.idle();
    hold(held, tunnelEnds - STEP);
    hold(held, tunnelEnds + 0.5 * P.dropoutSec);
    expect(held.view.look.drop).toBeGreaterThan(0);
    expect(held.view.look.stretch).toBeGreaterThan(0.1);
    // The wind-up, as a jump that has only just been taken shows it: nothing of the tunnel.
    hold(held, 0.3);
    hold(first, 0.3);
    expect(held.view.look).toEqual(first.view.look);
    expect(held.view.look.veil).toBeLessThan(0.2);
    expect(held.view.look.drop).toBe(-1);
    // And held there, it stays that.
    hold(held, 0.3);
    expect(held.view.look).toEqual(first.view.look);
  });

  it('is hidden by the star map, as much as the map is there', () => {
    const h = setup();
    h.idle();
    h.become(HYPER_TUNNEL);
    h.run(1);
    const full = { ...h.view.look };
    h.world.map = 0.5;
    h.frame();
    for (const part of ['stretch', 'dots', 'veil', 'calm', 'surge'] as const) {
      expect(h.view.look[part], part).toBeCloseTo(full[part] / 2, 9);
    }
    h.world.map = 1;
    h.frame();
    expect(h.view.object.visible).toBe(false);
    expect(drawCalls(h.view.object)).toBe(0);
    expect(h.view.look).toMatchObject({ dots: 0, veil: 0, calm: 0, surge: 0, punch: -1, drop: -1 });
    // The jump goes on under it, and is there again when the map closes.
    h.world.map = 0;
    h.frame();
    expect(h.view.look.veil).toBe(1);
    expect(drawCalls(h.view.object)).toBe(2);
  });

  it('has no thin lines on the low tier', () => {
    const uniform = (ribs: boolean): unknown =>
      (setup({ ribs }).tube.material.uniforms as Record<string, { value: unknown }>).uRibs?.value;
    expect(uniform(true)).toBe(1);
    expect(uniform(false)).toBe(0);
  });

  it('disposes everything it made, and leaves the scene', () => {
    const h = setup();
    const scene = new Group();
    scene.add(h.view.object);
    const gone: string[] = [];
    for (const mesh of [h.tube, h.dashes]) {
      const { geometry, material } = mesh as unknown as {
        geometry: { addEventListener(type: 'dispose', listener: () => void): void };
        material: { name: string; addEventListener(type: 'dispose', listener: () => void): void };
      };
      geometry.addEventListener('dispose', () => gone.push(`${material.name} geometry`));
      material.addEventListener('dispose', () => gone.push(material.name));
    }
    h.view.dispose();
    expect(gone.sort()).toEqual([
      'hyperDashes',
      'hyperDashes geometry',
      'hyperTube',
      'hyperTube geometry',
    ]);
    expect(h.view.object.parent).toBeNull();
    expect(scene.children).toEqual([]);
    // Twice is once.
    h.view.dispose();
    expect(gone).toHaveLength(4);
  });
});
