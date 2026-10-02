import { BufferAttribute, BufferGeometry } from 'three';
import {
  DECAL_ATTRIBUTE,
  OVER_ATTRIBUTE,
  SIDE_ATTRIBUTE,
  UNLIT_ATTRIBUTE,
} from '../design/materials';
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
 * Non-indexed, a colour a face and a normal a vertex, which is what the toon shader expects. The
 * arrays are handed over, not copied. The caller owns the geometry: track it in a Scope.
 *
 * Both flags and a face's other colours (`sides`: the side and the over, an attribute each) are
 * always there, zeros (a byte each) where nobody set them: a model, a part with one colour a face. An attribute a geometry left out would read WebGL's generic value at its location,
 * which is the context's, not the geometry's: three writes the material's default there only when
 * it first sets up that geometry's vertex array, and any program drawn after may write another
 * there that nothing puts back (a 1 would draw a planet flat, or pull it toward the camera).
 */
export function geometryFrom(mesh: MeshData & VertexFlags): BufferGeometry {
  const geometry = new BufferGeometry();
  const count = mesh.positions.length / 3;
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('color', new BufferAttribute(mesh.colors, 3));
  geometry.setAttribute(
    UNLIT_ATTRIBUTE,
    new BufferAttribute(mesh.unlit ?? new Uint8Array(count), 1),
  );
  [SIDE_ATTRIBUTE, OVER_ATTRIBUTE].forEach((name, which) => {
    const { sides } = mesh;
    // Eight numbers a vertex in the mesh: the side's four, then the over's.
    const values = sides
      ? Float32Array.from({ length: count * 4 }, (_, i) => sides[i * 2 - (i % 4) + which * 4] ?? 0)
      : new Uint8Array(count * 4);
    geometry.setAttribute(name, new BufferAttribute(values, 4));
  });
  geometry.setAttribute(
    DECAL_ATTRIBUTE,
    new BufferAttribute(mesh.decal ?? new Uint8Array(count), 1),
  );
  geometry.computeBoundingSphere();
  return geometry;
}
