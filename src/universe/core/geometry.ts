import { BufferAttribute, BufferGeometry } from 'three';
import { DECAL_ATTRIBUTE, UNLIT_ATTRIBUTE } from '../design/materials';
import type { MeshData } from '../sim/meshBuilder';

/**
 * Per-vertex flags of the emblem worlds (sim/world/glue.ts, `Packed`): how each vertex is lit (0
 * lit, 1 flat, 2 glow) and whether it is a decal (1). The toon shader reads both
 * (shaders/toonFlat.ts); geometry without them is lit and no decal.
 */
export interface VertexFlags {
  readonly unlit?: Float32Array;
  readonly decal?: Uint8Array;
}

/**
 * Generated mesh data (sim/meshBuilder.ts: plain arrays, testable headless) -> a three.js geometry.
 * Non-indexed with per-face normals and colours, which is what the toon shader expects. The arrays
 * are handed over, not copied. The caller owns the geometry: track it in a Scope.
 *
 * A flag that is all zeros is left out: the material's default says the same, for nothing.
 */
export function geometryFrom(mesh: MeshData & VertexFlags): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('color', new BufferAttribute(mesh.colors, 3));
  if (mesh.unlit?.some((value) => value !== 0)) {
    geometry.setAttribute(UNLIT_ATTRIBUTE, new BufferAttribute(mesh.unlit, 1));
  }
  if (mesh.decal?.some((value) => value !== 0)) {
    geometry.setAttribute(DECAL_ATTRIBUTE, new BufferAttribute(mesh.decal, 1));
  }
  geometry.computeBoundingSphere();
  return geometry;
}
