import { BufferAttribute, BufferGeometry, Color, Mesh } from 'three';
import type { Frame, System, Viewport } from '../core/Engine';
import { Scope } from '../core/scope';
import type { StarClass } from '../design/lookTypes';
import { createStarMaterial, type StarMaterial } from '../design/materials';
import { tokens, type StarKey } from '../design/tokens';
import { tuning } from '../design/tuning';
import { buildStarList, type StarList } from '../sim/starList';

export interface StarfieldOptions {
  coarsePointer: boolean;
  reducedMotion: boolean;
  /** The low quality tier: half the stars, and no mid class (the small spiked ones). */
  low: boolean;
}

/** The corners of a quad, two triangles: the shader puts it where its star is. */
const CORNERS = [-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0];
const TRIANGLES = [0, 1, 2, 2, 1, 3];
const QUAD = 4;
/** Per star: a direction, a colour, and (kind, size, phase, twinkle). */
const DIR = 3;
const COLOR = 3;
const STAR = 4;

/**
 * The stars: one draw call of quads, a quad a star. Fully deterministic (seeded), so the same
 * sky appears on every visit and in every screenshot: sim/starList.ts makes the list, and
 * nothing about it is state. A star is only a DIRECTION: the shader ignores where the camera is
 * (design/shaders/sky.ts), so no amount of flying brings one closer.
 */
export class Starfield implements System {
  readonly object: Mesh<BufferGeometry, StarMaterial>;
  private readonly scope = new Scope();
  private readonly drift: number;
  private calm = 0;
  /**
   * Draw the stars as a view this many CSS px high would (their sizes follow the view's height),
   * or, null, as this view does. The lab's (a hero's spikes at three view heights): it sets
   * this, or swaps the geometry for a sheet of one class (`starGeometry`), and calls `resize`.
   */
  rows: number | null = null;

  constructor(options: StarfieldOptions) {
    const material = this.scope.track(createStarMaterial({ motion: !options.reducedMotion }));
    const list = buildStarList(tuning.starfield, tuning.look.sky.band, {
      coarse: options.coarsePointer,
      low: options.low,
    });
    this.object = new Mesh(starGeometry(list), material);
    this.object.frustumCulled = false; // the sky surrounds the camera: always visible
    this.object.renderOrder = -1;
    this.scope.onDispose(() => {
      this.object.geometry.dispose();
      this.object.removeFromParent();
    });
    this.drift = options.reducedMotion ? 0 : tuning.starfield.driftRadPerSec;
  }

  /**
   * The star map is a calm thing (0 = flying, 1 = on the map): the stars dim to `opacity` and
   * lose their spikes, and the sky stops drifting, which through the map's long lens would look
   * like the galaxy turning.
   */
  setCalm(calm: number, opacity: number): void {
    this.calm = calm;
    const { uniforms } = this.object.material;
    uniforms.uOpacity.value = 1 + (opacity - 1) * calm;
    uniforms.uSpikes.value = 1 - calm;
  }

  frameUpdate(frame: Frame): void {
    this.object.material.uniforms.uTime.value = frame.elapsed;
    this.object.rotation.y += this.drift * (1 - this.calm) * frame.dt;
  }

  resize(viewport: Viewport): void {
    // CSS px: a star is as large on a dense screen as on a plain one, only finer.
    const { uView, uScale } = this.object.material.uniforms;
    uView.value.set(viewport.width, viewport.height);
    const { scaleRows, scaleRange, coreScaleMin } = tuning.starfield;
    const scale = Math.min(
      scaleRange[1],
      Math.max(scaleRange[0], (this.rows ?? viewport.height) / scaleRows),
    );
    uScale.value.set(scale, Math.max(scale, coreScaleMin));
  }

  dispose(): void {
    this.scope.dispose();
  }
}

/**
 * The list as the shader reads it: a quad a star, FOUR VERTICES OF ITS OWN, each with one corner
 * and the star's direction, colour and numbers.
 *
 * Not one quad drawn once a star (instancing), which would store each star once and not four
 * times (about 2 MB for the fullest sky here, against 0.4): a software renderer runs every
 * instance as a draw of its own. CI has no GPU, and there the 4,642 stars of the low tier took
 * 20.6 ms of every frame as instances and 3.8 ms as plain triangles (Chromium's SwiftShader on
 * four cores, 2026-10-03), the same picture to the pixel. A GPU does not care either way.
 */
export function starGeometry(list: StarList<StarKey>): BufferGeometry {
  const { classes } = tuning.starfield;
  // How bright a star's core is, of its brightness, by kind (STAR_KINDS; a hero's is all of it).
  const kinds: readonly StarClass[] = [classes.dust, classes.field, classes.bright, classes.mid];
  const coreGain = kinds.map((kind) => kind.coreGain ?? 1);
  // new Color(hex) converts sRGB -> linear working space; the shader converts back on output.
  const linear = new Map<StarKey, Color>();
  const vertices = list.count * QUAD;
  const corners = new Float32Array(vertices * 3);
  const directions = new Float32Array(vertices * DIR);
  const colors = new Float32Array(vertices * COLOR);
  const stars = new Float32Array(vertices * STAR);
  // Two bytes an index for as long as they reach every vertex: 16,383 stars.
  const indices =
    vertices > 0xffff
      ? new Uint32Array(list.count * TRIANGLES.length)
      : new Uint16Array(list.count * TRIANGLES.length);
  for (let i = 0; i < list.count; i += 1) {
    const tint = list.tints[i] ?? 'white';
    let color = linear.get(tint);
    if (!color) linear.set(tint, (color = new Color(tokens.color.star[tint])));
    const kind = list.kinds[i] ?? 0;
    const y = (list.brightness[i] ?? 0) * (coreGain[kind] ?? 1);
    for (let corner = 0; corner < QUAD; corner += 1) {
      const vertex = i * QUAD + corner;
      for (let k = 0; k < 3; k += 1) {
        corners[vertex * 3 + k] = CORNERS[corner * 3 + k] ?? 0;
        directions[vertex * DIR + k] = list.directions[i * DIR + k] ?? 0;
      }
      colors[vertex * COLOR] = color.r * y;
      colors[vertex * COLOR + 1] = color.g * y;
      colors[vertex * COLOR + 2] = color.b * y;
      stars[vertex * STAR] = kind;
      stars[vertex * STAR + 1] = list.sizes[i] ?? 1;
      stars[vertex * STAR + 2] = list.phases[i] ?? 0;
      stars[vertex * STAR + 3] = list.twinkles[i] ?? 0;
    }
    TRIANGLES.forEach((corner, k) => {
      indices[i * TRIANGLES.length + k] = i * QUAD + corner;
    });
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(corners, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.setAttribute('aDir', new BufferAttribute(directions, DIR));
  geometry.setAttribute('aColor', new BufferAttribute(colors, COLOR));
  geometry.setAttribute('aStar', new BufferAttribute(stars, STAR));
  return geometry;
}

/** How many stars a geometry made by `starGeometry` draws. */
export function starCount(geometry: BufferGeometry): number {
  return (geometry.getIndex()?.count ?? 0) / TRIANGLES.length;
}
