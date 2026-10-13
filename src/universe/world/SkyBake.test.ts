import type { WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import type { Frame } from '../core/Engine';
import { createBackdropMaterial } from '../design/materials';
import { tuning } from '../design/tuning';
import { bandCount } from '../sim/skySchedule';
import { SkyBake, type SkyState } from './SkyBake';

const tier = tuning.look.sky.tiers.low;
const bands = bandCount(tier.panoHeight, tier.bandRows);
const frame: Frame = { elapsed: 0, dt: 1 / 60, alpha: 1, simTime: 0 };

/** A renderer that draws nothing, and whose programs arrive (or fail) when the test says. */
function fakeRenderer() {
  const compiles: Array<{ resolve(): void; reject(): void }> = [];
  let draws = 0;
  let target: unknown = null;
  const renderer = {
    setRenderTarget: (to: unknown) => void (target = to),
    compileAsync: () =>
      new Promise<void>((resolve, reject) => {
        compiles.push({ resolve: () => resolve(), reject: () => reject(new Error('no program')) });
      }),
    render: () => void (draws += 1),
    properties: { get: () => ({}) },
  };
  return {
    renderer: renderer as unknown as WebGLRenderer,
    compiles,
    get draws() {
      return draws;
    },
    get target() {
      return target;
    },
  };
}

function bake(options: { seen?: boolean; reducedMotion?: boolean } = {}) {
  const gpu = fakeRenderer();
  const said: SkyState[] = [];
  let excused = 0;
  const sky = new SkyBake({
    renderer: gpu.renderer,
    tier,
    seen: options.seen ?? false,
    reducedMotion: options.reducedMotion ?? false,
    onState: (state) => said.push(state),
    onBand: () => void (excused += 1),
  });
  return {
    gpu,
    sky,
    said,
    get excused() {
      return excused;
    },
  };
}

/** Let the promise of a program that was just settled run its handlers. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('the baked sky', () => {
  it('says baking, paints a band a frame once its program is there, then says ready', async () => {
    const run = bake();
    const { gpu, sky, said } = run;
    sky.frameUpdate(frame);
    sky.frameUpdate(frame);
    // No program yet: nothing is drawn, and no frame is excused.
    expect([said, gpu.draws, run.excused, sky.seen]).toEqual([['baking'], 0, 0, false]);

    gpu.compiles[0]?.resolve();
    await settled();
    for (let i = 0; i < bands - 1; i += 1) sky.frameUpdate(frame);
    expect([gpu.draws, sky.seen]).toEqual([bands - 1, false]);
    sky.frameUpdate(frame);
    expect([gpu.draws, run.excused, sky.seen]).toEqual([bands, bands, true]);
    expect(said).toEqual(['baking', 'ready']);
    // Whatever it drew into, the screen is the target again.
    expect(gpu.target).toBeNull();

    // Painted once: no frame after draws it again.
    sky.frameUpdate(frame);
    expect(gpu.draws).toBe(bands);
    sky.dispose();
  });

  it('paints two bands a frame for a visitor who has seen it', async () => {
    const { gpu, sky } = bake({ seen: true });
    gpu.compiles[0]?.resolve();
    await settled();
    for (let i = 0; i < Math.ceil(bands / 2); i += 1) sky.frameUpdate(frame);
    expect(sky.seen).toBe(true);
    sky.dispose();
  });

  it('is off, and says so, where its program cannot be had', async () => {
    const { gpu, sky, said } = bake();
    sky.frameUpdate(frame);
    gpu.compiles[0]?.reject();
    await settled();
    sky.frameUpdate(frame);
    expect([said, gpu.draws, sky.seen]).toEqual([['baking', 'off'], 0, false]);
    sky.dispose();
  });

  it('leaves a repainted sky alone when the program of the painting before it fails', async () => {
    const { gpu, sky, said } = bake();
    sky.paint(true);
    // The first painting's program fails late; the second's arrives.
    gpu.compiles[0]?.reject();
    gpu.compiles[1]?.resolve();
    await settled();
    for (let i = 0; i < bands; i += 1) sky.frameUpdate(frame);
    expect([said, sky.seen]).toEqual([['baking', 'ready'], true]);
    sky.dispose();
  });

  it('does nothing once it is disposed, whenever its program arrives', async () => {
    const { gpu, sky, said } = bake();
    sky.dispose();
    gpu.compiles[0]?.resolve();
    await settled();
    expect([said, gpu.draws]).toEqual([[], 0]);
  });

  it('dims its light under a jump with the stars, frame for frame, and gives it all back', async () => {
    // (Seen, and with less motion: its light is all there at once, and the view's share is a cut.)
    const { gpu, sky } = bake({ seen: true, reducedMotion: true });
    gpu.compiles[0]?.resolve();
    await settled();
    for (let i = 0; i < bands; i += 1) sky.frameUpdate(frame);
    expect(sky.seen).toBe(true);
    const backdrop = createBackdropMaterial();
    /** How much of the panorama's light the backdrop adds: what the sky last handed it. */
    const light = (): number => {
      sky.frameUpdate(frame);
      return backdrop.uniforms.uExposure?.value as number;
    };
    expect(light()).toBe(1);

    // In the tunnel the stars are at their share (tuning.hyper.starOpacity), and so is the sky:
    // in the very next frame, not eased after it.
    const { starOpacity } = tuning.hyper;
    sky.setJump(1, starOpacity);
    expect(light()).toBeCloseTo(starOpacity, 12);
    // Part of the way in or out, that part of the way; and never past either end.
    sky.setJump(0.3, starOpacity);
    expect(light()).toBeCloseTo(1 - 0.3 * (1 - starOpacity), 12);
    sky.setJump(7, starOpacity);
    expect(light()).toBeCloseTo(starOpacity, 12);
    sky.setJump(-1, starOpacity);
    expect(light()).toBe(1);

    // It is a share of what the view shows of the sky, whatever that is: a jump taken out of an
    // orbit has the wind-up's part of the half a docked view has.
    sky.setView(true, 0);
    sky.setJump(0.3, starOpacity);
    const { exposureDocked } = tuning.look.sky;
    expect(light()).toBeCloseTo(exposureDocked * (1 - 0.3 * (1 - starOpacity)), 12);
    sky.setView(false, 0);
    sky.setJump(0, starOpacity);
    expect(light()).toBe(1);

    backdrop.dispose();
    sky.dispose();
  });
});
