/**
 * GLOW: things that ARE light and so take none (the engine flame; later suns and beacons). The
 * facet shows its own colour times `uIntensity`, untouched by any sun.
 *
 * Whether it BLOOMS is a separate question, answered in the alpha channel: `uBloom` (0 to 1) is
 * how much of this surface bleeds into the picture around it. Everything else in the world writes
 * 0 there, which is why the pastel world stays crisp (shaders/post.ts explains the scheme).
 *
 * Uniforms: uIntensity, uBloom, uBloomMask (shared: is anybody reading the alpha channel?),
 * uTint (linear colour, multiplies the vertex colour). Defines:
 * USE_COLOR (vertex colours; without it the glow is the tint alone).
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
    uniform float uBloom;
    uniform float uBloomMask;
    uniform vec3 uTint;
    flat varying vec3 vColor;

    void main() {
      gl_FragColor = vec4(vColor * uTint * uIntensity, mix(1.0, uBloom, uBloomMask));
      #include <colorspace_fragment>
    }
  `,
};
