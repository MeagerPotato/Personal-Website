import { BufferAttribute, BufferGeometry, Mesh, type Color, type ShaderMaterial } from 'three';
import type { System } from '../core/Engine';
import { Scope } from '../core/scope';
import {
  chartPaints,
  createChartMaterial,
  createChartParts,
  drawsToCanvas,
  type ChartDistrict,
  type ChartMaterial,
} from '../design/materials';
import { tuning } from '../design/tuning';
import { discMesh, gridCell, ringMesh, type ChartPartMesh } from '../sim/chartMesh';

/** Half the plane's width (u): wider than any view of the map the camera can pull out to. */
const HALF = 7000;
/** Its four corners, lying flat, and its two triangles, which face up. */
const CORNERS = new Float32Array([-HALF, 0, -HALF, -HALF, 0, HALF, HALF, 0, -HALF, HALF, 0, HALF]);
const TRIANGLES = [0, 1, 2, 2, 1, 3];
/** After the sky (-2), before the stars (-1) and every other see-through thing. */
const ORDER = -1.5;
/** The parts that are drawn on their own, in the order the paint is laid: after the plane's. */
const PART_ORDER = { discs: ORDER + 0.1, rings: ORDER + 0.2 };

export interface ChartOptions {
  /** A district for each system of the galaxy. */
  readonly districts: readonly ChartDistrict[];
  /** The star map (ui/StarMap.ts): how much of the picture is its, and its scale. */
  readonly map: { readonly weight: number; readonly unitsPerPx: number };
}

/**
 * THE CHART: the star map's ground, a dot grid and a district for each system (design/shaders/
 * chart.ts). A little under the flight plane, drawn only while the map shows any of itself and
 * as much as it does; behind everything, and no part of picking: it is not a body.
 *
 * `object` is one plane. With post-processing it is the whole chart. Straight to the canvas it
 * is the dots, and the districts' discs and their rings are two meshes more, its children,
 * each holding only its part (shaders/chart.ts says why, sim/chartMesh.ts makes them).
 */
export class Chart implements System {
  readonly object: Mesh<BufferGeometry, ChartMaterial>;
  private readonly scope = new Scope();

  constructor(private readonly options: ChartOptions) {
    const { districts } = options;
    const plane = this.scope.track(new BufferGeometry());
    plane.setAttribute('position', new BufferAttribute(CORNERS, 3));
    plane.setIndex(TRIANGLES);
    const parts = drawsToCanvas() ? createChartParts() : null;
    this.object = new Mesh(
      plane,
      this.scope.track(parts ? parts.dots : createChartMaterial(districts)),
    );
    this.object.name = 'chart';
    this.object.position.y = tuning.look.chart.planeY;
    this.object.frustumCulled = false;
    this.object.renderOrder = ORDER;
    this.object.visible = false;
    this.scope.onDispose(() => this.object.removeFromParent());

    if (parts) {
      const paints = districts.map(({ family }) => chartPaints(family));
      this.part('discs', parts.discs, discMesh(districts, tuning.look.chart.districtOuter), {
        aOuter: paints.map(({ outer }) => outer),
        aInner: paints.map(({ inner }) => inner),
      });
      this.part('rings', parts.rings, ringMesh(districts), {
        aRing: paints.map(({ ring }) => ring),
      });
    }
  }

  frameUpdate(): void {
    const { weight, unitsPerPx } = this.options.map;
    // (Its children show and hide with it.)
    this.object.visible = weight > 0.01;
    const { uniforms } = this.object.material;
    uniforms.uWeight.value = weight;
    uniforms.uUnitsPerPx.value = unitsPerPx;
    uniforms.uCell.value = gridCell(unitsPerPx, tuning.look.chart.dotSpacingPx);
  }

  dispose(): void {
    this.scope.dispose();
  }

  /**
   * A part with a mesh of its own, as its program reads it: every vertex knows its district
   * (where it is, how far it reaches) and that district's paints.
   */
  private part(
    name: keyof typeof PART_ORDER,
    material: ShaderMaterial,
    mesh: ChartPartMesh,
    paints: Readonly<Record<string, readonly Color[]>>,
  ): void {
    this.scope.track(material);
    // A galaxy with no system at all has dots and nothing else.
    if (mesh.indices.length === 0) return;
    const { districts } = this.options;
    const geometry = this.scope.track(new BufferGeometry());
    geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    geometry.setAttribute('aPad', new BufferAttribute(mesh.pads, 3));
    geometry.setIndex(new BufferAttribute(mesh.indices, 1));
    const perVertex = (of: (district: number) => readonly number[]): BufferAttribute => {
      const array = new Float32Array(mesh.owners.length * 3);
      mesh.owners.forEach((owner, vertex) => array.set(of(owner), vertex * 3));
      return new BufferAttribute(array, 3);
    };
    geometry.setAttribute(
      'aDisc',
      perVertex((owner) => {
        const { x = 0, z = 0, radius = 0 } = districts[owner] ?? {};
        return [x, z, radius];
      }),
    );
    for (const [attribute, colors] of Object.entries(paints)) {
      geometry.setAttribute(
        attribute,
        perVertex((owner) => colors[owner]?.toArray() ?? [0, 0, 0]),
      );
    }
    const part = new Mesh(geometry, material);
    part.name = `chart-${name}`;
    // Its vertices step out as the map zooms (aPad): where they were made says nothing.
    part.frustumCulled = false;
    part.renderOrder = PART_ORDER[name];
    this.object.add(part);
    this.scope.onDispose(() => part.removeFromParent());
  }
}
