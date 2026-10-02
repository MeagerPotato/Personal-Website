import { BufferAttribute, BufferGeometry, Mesh } from 'three';
import type { System } from '../core/Engine';
import { Scope } from '../core/scope';
import { createChartMaterial, type ChartDistrict, type ChartMaterial } from '../design/materials';
import { tuning } from '../design/tuning';

/** Half the plane's width (u): wider than any view of the map the camera can pull out to. */
const HALF = 7000;
/** Its four corners, lying flat, and its two triangles, which face up. */
const CORNERS = new Float32Array([-HALF, 0, -HALF, -HALF, 0, HALF, HALF, 0, -HALF, HALF, 0, HALF]);
const TRIANGLES = [0, 1, 2, 2, 1, 3];

export interface ChartOptions {
  /** A district for each system of the galaxy. */
  readonly districts: readonly ChartDistrict[];
  /** The star map (ui/StarMap.ts): how much of the picture is its, and its scale. */
  readonly map: { readonly weight: number; readonly unitsPerPx: number };
}

/**
 * THE CHART: the star map's ground, a dot grid and a district for each system (design/shaders/
 * chart.ts). One plane a little under the flight plane, drawn only while the map shows any of
 * itself and as much as it does; behind everything, and no part of picking: it is not a body.
 */
export class Chart implements System {
  readonly object: Mesh<BufferGeometry, ChartMaterial>;
  private readonly scope = new Scope();

  constructor(private readonly options: ChartOptions) {
    const geometry = this.scope.track(new BufferGeometry());
    geometry.setAttribute('position', new BufferAttribute(CORNERS, 3));
    geometry.setIndex(TRIANGLES);
    this.object = new Mesh(geometry, this.scope.track(createChartMaterial(options.districts)));
    this.object.name = 'chart';
    this.object.position.y = tuning.look.chart.planeY;
    this.object.frustumCulled = false;
    // After the sky, before the stars and every other see-through thing.
    this.object.renderOrder = -1.5;
    this.object.visible = false;
    this.scope.onDispose(() => this.object.removeFromParent());
  }

  frameUpdate(): void {
    const { weight, unitsPerPx } = this.options.map;
    this.object.visible = weight > 0.01;
    const { uniforms } = this.object.material;
    uniforms.uWeight.value = weight;
    uniforms.uUnitsPerPx.value = unitsPerPx;
  }

  dispose(): void {
    this.scope.dispose();
  }
}
