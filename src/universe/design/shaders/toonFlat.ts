/**
 * TOON FLAT: the one lit material of the universe (docs/PLAN.md §5.5).
 *
 * There are no three.js lights. Each facet compares its normal with the direction to ITS sun and
 * lands in one of three bands: lit, middle, shade. A lit facet is exactly the colour it was given
 * (so with no tone mapping it is exactly the token hex, and 3D matches the DOM); the shade side is
 * the same colour multiplied by a cool tint, never black.
 *
 * `flat` makes the whole triangle take one vertex's value, so a facet is one colour edge to edge
 * instead of a gradient. Geometry must be non-indexed with per-face normals.
 *
 * Uniforms (names are the contract with design/materials.ts):
 *   uSunPosition  world position of the light            uShadowTint  linear multiplier for shade
 *   uTint         linear colour, multiplies vertex colour uBandEdges   facing thresholds (x < y)
 *   uMidLevel     how lit the middle band is, 0..1      uBloomMask   shared: 1 while post-processing
 *                                                       reads alpha as the bloom guest list
 * Defines: USE_COLOR (vertex colours), USE_INSTANCING / USE_INSTANCING_COLOR (set by three),
 *   INSTANCED_SUN (each instance carries its own `aSunPosition`: the galaxy-wide far bodies).
 */
export const toonFlat = {
  vertexShader: /* glsl */ `
    uniform vec3 uSunPosition;
    uniform vec3 uShadowTint;
    uniform vec3 uTint;
    uniform vec2 uBandEdges;
    uniform float uMidLevel;

    #ifdef INSTANCED_SUN
      attribute vec3 aSunPosition;
    #endif

    flat varying vec3 vColor;

    void main() {
      mat4 world = modelMatrix;
      #ifdef USE_INSTANCING
        world = modelMatrix * instanceMatrix;
      #endif
      vec4 worldPosition = world * vec4(position, 1.0);
      // Uniform scale only (true for everything we draw), so no inverse-transpose is needed.
      vec3 worldNormal = normalize(mat3(world) * normal);

      #ifdef INSTANCED_SUN
        vec3 sun = aSunPosition;
      #else
        vec3 sun = uSunPosition;
      #endif
      float facing = dot(worldNormal, normalize(sun - worldPosition.xyz));
      float level = facing > uBandEdges.y ? 1.0 : (facing > uBandEdges.x ? uMidLevel : 0.0);

      vec3 base = uTint;
      #ifdef USE_COLOR
        base *= color;
      #endif
      #ifdef USE_INSTANCING_COLOR
        base *= instanceColor;
      #endif

      vColor = mix(base * uShadowTint, base, level);
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `,

  fragmentShader: /* glsl */ `
    uniform float uBloomMask;
    flat varying vec3 vColor;

    void main() {
      // Alpha is the bloom guest list (shaders/post.ts), and a lit surface is not on it: 0 when
      // somebody reads the list, plain opaque 1 when the picture goes straight to the canvas.
      gl_FragColor = vec4(vColor, 1.0 - uBloomMask);
      #include <colorspace_fragment>
    }
  `,
};
