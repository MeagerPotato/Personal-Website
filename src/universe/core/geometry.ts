import { BufferAttribute, BufferGeometry } from 'three';
import type { MeshData } from '../sim/meshBuilder';

/**
 * Generated mesh data (sim/meshBuilder.ts: plain arrays, testable headless) -> a three.js geometry.
 * Non-indexed with per-face normals and colours, which is what the toon shader expects. The arrays
 * are handed over, not copied. The caller owns the geometry: track it in a Scope.
 */
export function geometryFrom(mesh: MeshData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('color', new BufferAttribute(mesh.colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}
