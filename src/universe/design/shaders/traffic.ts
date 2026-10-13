/**
 * TRAFFIC: the dots that go round the orbit lines, two a line, one each way ("Deep light",
 * docs/DESIGN.md). One draw call of instanced quads that face the screen, each a small round dot
 * of a constant size on it: flat, its rim soft only as far as a pixel needs. Paint over what is
 * behind it, tested against the solid world (a dot goes behind a planet), and never on the bloom
 * guest list (materials.ts, keepBloomMask).
 *
 * Geometry: position (a corner of the quad, x and y each -1 or 1). Per instance: aDot (x: where
 * the dot is on its plane, the flight plane, which is y = 0; y: NOT A HEIGHT but how large the dot is
 * drawn, CSS px, 0 for none; z: where it is. sim/traffic.ts writes all three each frame),
 * aColor (linear).
 * Uniforms: uView (the drawing buffer's width and height in its own pixels, and how many of
 * them a CSS px is), uOpacity.
 */
export const traffic = {
  vertexShader: /* glsl */ `
    attribute vec3 aDot;
    attribute vec3 aColor;

    uniform vec3 uView;

    varying vec3 vColor;
    varying vec3 vDot;

    void main() {
      vColor = aColor;
      // In pixels: the dot's radius, and this corner, half a pixel out for the soft rim.
      float radius = 0.5 * aDot.y * uView.z;
      vDot = vec3(position.xy * (radius + 0.5), radius);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(aDot.x, 0.0, aDot.z, 1.0);
      gl_Position.xy += 2.0 * vDot.xy / uView.xy * gl_Position.w * step(0.01, radius);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform float uOpacity;

    varying vec3 vColor;
    varying vec3 vDot;

    void main() {
      gl_FragColor = vec4(vColor, clamp(vDot.z - length(vDot.xy) + 0.5, 0.0, 1.0) * uOpacity);
      #include <colorspace_fragment>
    }
  `,
};
