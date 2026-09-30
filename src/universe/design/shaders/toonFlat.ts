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
 * HOW EACH VERTEX IS LIT, `aUnlit` (the emblem worlds, sim/world/glue.ts): 0 lit by its sun as
 * above; 1 FLAT, its colour as it is, lit or not, like a painted sign; 2 GLOW, its colour as
 * light, blooming as a sun does (shaders/glow.ts writes alpha the same way). So a lamp, a flame or
 * a sun's ball rides in the same buffer as the lit parts round it, and a body is one draw call and
 * not three. Geometry without the attribute reads its default, 0 (design/materials.ts sets it: a
 * missing attribute is otherwise whatever an earlier program left at that location): lit, as
 * everything was before the worlds.
 *
 * A DECAL vertex (`aDecal` 1: a grid or a number painted on the ground) is pulled toward the
 * camera by `uDecalPull` of its distance, along its own line of sight: a depth bias that moves
 * nothing on screen and holds at every distance, where the few thousandths of a radius it stands
 * off the ground would not, from the star map. Without the attribute, 0: nothing moves.
 *
 * Alpha is the bloom guest list (shaders/post.ts): a lit or flat surface is not on it
 * (`1 - uBloomMask`), a glowing one is, as much as `uGlowBloom` says (`mix(1, uGlowBloom,
 * uBloomMask)`, as shaders/glow.ts).
 *
 * Uniforms (names are the contract with design/materials.ts):
 *   uSunPosition  world position of the light            uShadowTint  linear multiplier for shade
 *   uTint         linear colour, multiplies vertex colour uBandEdges   facing thresholds (x < y)
 *   uMidLevel     how lit the middle band is, 0..1      uBloomMask   shared: 1 while post-processing
 *   uFlatness     shared: how much of the shading is    reads alpha as the bloom guest list
 *                 taken out, 0..1 (the star map: 1 is a uGlowBloom   shared: how much a glowing
 *                 flat disc of pure colour)             vertex blooms, 0..1
 *   uDecalPull    shared: a decal's pull toward the camera, a share of its distance
 * Attributes: position, normal, color (USE_COLOR), aUnlit (0 lit, 1 flat, 2 glow; default 0),
 *   aDecal (1 on a decal; default 0).
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
    uniform float uFlatness;
    uniform float uDecalPull;

    attribute float aUnlit;
    attribute float aDecal;

    #ifdef INSTANCED_SUN
      attribute vec3 aSunPosition;
    #endif

    flat varying vec3 vColor;
    flat varying float vGlow;

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
      // On the star map every facet is lit: a map shows what is where, not what time of day it is.
      level = mix(level, 1.0, uFlatness);
      // A flat or glowing vertex takes no light: it is its colour. (The tests are halfway between
      // the whole numbers the attribute holds.)
      if (aUnlit > 0.5) level = 1.0;

      vec3 base = uTint;
      #ifdef USE_COLOR
        base *= color;
      #endif
      #ifdef USE_INSTANCING_COLOR
        base *= instanceColor;
      #endif

      vColor = mix(base * uShadowTint, base, level);
      vGlow = aUnlit > 1.5 ? 1.0 : 0.0;
      vec4 view = viewMatrix * worldPosition;
      view.xyz *= 1.0 - uDecalPull * aDecal;
      gl_Position = projectionMatrix * view;
    }
  `,

  fragmentShader: /* glsl */ `
    uniform float uBloomMask;
    uniform float uGlowBloom;
    flat varying vec3 vColor;
    flat varying float vGlow;

    void main() {
      // Alpha is the bloom guest list (shaders/post.ts), and a lit surface is not on it: 0 when
      // somebody reads the list, plain opaque 1 when the picture goes straight to the canvas. A
      // glowing one is, as shaders/glow.ts writes it.
      float bloom = mix(0.0, uGlowBloom, vGlow);
      gl_FragColor = vec4(vColor, mix(1.0, bloom, uBloomMask));
      #include <colorspace_fragment>
    }
  `,
};
