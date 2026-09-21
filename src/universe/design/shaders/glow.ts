/**
 * GLOW: things that ARE light and so take none (the engine flame; later suns and beacons). The
 * facet shows its own colour times `uIntensity`, untouched by any sun.
 *
 * Intensity is 1 until post-processing exists. Bloom will key on values above 1, so raising it
 * then makes the flame glow while the pastel world, which never exceeds 1, stays crisp
 * (docs/PLAN.md §5.5).
 *
 * Uniforms: uIntensity. Defines: USE_COLOR (vertex colours; without it the glow is white).
 */
export const glow = {
  vertexShader: /* glsl */ `
    flat varying vec3 vColor;

    void main() {
      vColor = vec3(1.0);
      #ifdef USE_COLOR
        vColor = color;
      #endif
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform float uIntensity;
    flat varying vec3 vColor;

    void main() {
      gl_FragColor = vec4(vColor * uIntensity, 1.0);
      #include <colorspace_fragment>
    }
  `,
};
