/**
 * EDGE: the lines of a blueprint (the emblem worlds' ghost parts, sim/world/glue.ts `wire`): a
 * part still to come is drawn as its feature edges in its family's colour over a navy fill.
 *
 * The lines lie exactly on the edges of the triangles they outline, where a line and a triangle
 * would fight over the same depth, so every vertex is pulled toward the camera along its own
 * line of sight by twice a decal's pull (shaders/toonFlat.ts): drawn over its own fill, and over
 * a fill that is itself a decal, at every distance, and moved nowhere on screen.
 *
 * The material is see-through as far as the bloom guest list goes (design/materials.ts,
 * `keepBloomMask`): the lines are opaque colour and leave alpha as they found it, so they never
 * bloom.
 *
 * Uniforms (names are the contract with design/materials.ts): uColor (linear), uDecalPull
 * (shared with toonFlat).
 */
export const edge = {
  vertexShader: /* glsl */ `
    uniform float uDecalPull;

    void main() {
      vec4 view = modelViewMatrix * vec4(position, 1.0);
      view.xyz *= 1.0 - 2.0 * uDecalPull;
      gl_Position = projectionMatrix * view;
    }
  `,

  fragmentShader: /* glsl */ `
    uniform vec3 uColor;

    void main() {
      gl_FragColor = vec4(uColor, 1.0);
      #include <colorspace_fragment>
    }
  `,
};
