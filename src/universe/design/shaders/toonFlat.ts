import { gradientNoise } from './noise';

/**
 * TOON FLAT: the one lit material of the universe (docs/PLAN.md §5.5).
 *
 * There are no three.js lights. Each place on a surface compares its normal with the direction
 * to ITS sun and lands in one of three bands: lit, middle, shade. A lit place is exactly the
 * colour it was given (so with no tone mapping it is exactly the token hex, and 3D matches the
 * DOM); the shade side is the same colour multiplied by a cool tint, never black.
 *
 * FLAT COLOUR, ROUND LIGHT ("Deep light", docs/DESIGN.md). The colour is `flat`: the whole
 * triangle takes one vertex's value, so a face is one colour edge to edge and never a gradient.
 * The light is decided for every PIXEL, from the normal its vertices hand down (the normal itself
 * is carried across the face, and compared with the light at the pixel): where a mesh says its
 * faces are one curved surface (a lathe's, a ring's wall: sim/meshBuilder.ts and sim/world/kit.ts
 * say which things are round; a generated ground's are its ball's) the three bands meet along
 * round lines, whatever the facets under them; where it says a face is flat (a box, a cog's tooth)
 * the face is one band, as it always was. The line between two bands is a pixel soft:
 * anti-aliased, not blurred.
 *
 * MORE COLOURS THAN ONE IN A FACE (`aSide`, `aOver`: sim/planet.ts): a facet that a coast, a band
 * of height or an edge of paint runs through carries a second colour (its side) and, at each
 * vertex, where it stands on the line between the two: below a half it is the first colour,
 * above it the second, so the outline runs straight through the facet, a pixel soft, and from
 * facet to facet it is a curve. A third colour (its over) is laid over both the same way, for a
 * stripe or a place where three meet. Zeros: one colour, as everything else is. And the line may
 * BEND inside the facet (`aBend`: for each of the two lines, how far along it the vertex stands,
 * and the bend): it is drawn where `k + bend * t * (1 - t)` passes a half, an arc through the
 * place the true outline has halfway, so a coast is round however few facets it crosses.
 *
 * HOW EACH VERTEX IS LIT, `aUnlit` (the emblem worlds, sim/world/glue.ts): 0 lit by its sun as
 * above; 1 FLAT, its colour as it is, lit or not, like a painted sign; 2 GLOW, its colour as
 * light, blooming as a sun does (shaders/glow.ts writes alpha the same way). So a lamp, a flame or
 * a sun's ball rides in the same buffer as the lit parts round it, and a body is one draw call and
 * not three. Every geometry carries it (core/geometry.ts), 0 where nobody set it: lit, as
 * everything was before the worlds. (Not a default: a missing attribute reads WebGL's generic
 * value at its location, which any program may change.)
 *
 * A DECAL vertex (`aDecal` 1: a grid or a number painted on the ground) is pulled toward the
 * camera by `uDecalPull` of its distance, along its own line of sight: a depth bias that moves
 * nothing on screen and holds at every distance, where the few thousandths of a radius it stands
 * off the ground would not, from the star map. Everywhere else, 0: nothing moves.
 *
 * A SUN (the SUN variant: a sun's own material) is a living surface, and a sun is light, so all
 * of it is round. The facets of its ball say so in `aUnlit` (sim/sunSurface.ts, `sunFlag`: above
 * 4, and how far above 6 is the sun's own number), and on them the surface is DRAWN, pixel by
 * pixel: two layers of smooth noise on the ball (shaders/noise.ts; its twin on the CPU is
 * sim/sunGrain.ts, which the tests hold to its shares) cut by three thresholds into four tones
 * of a ladder of six, darkest first: shade, base, light, hot, then a spot's ring and core. The
 * tones are round cells with a soft edge (`uSunGrain.w`, never thinner than a pixel). Toward the
 * LIMB the tones step down the ladder (one where the ball is turned more than `uSunLimb.y` from
 * the camera, two past `uSunLimb.x`): limb darkening in two round bands; the spots, at fixed
 * places on the ball, keep their shades. `uFlatness` takes all of it back to the base: on the
 * star map a sun is a flat disc of its token. A glowing vertex with no such flag (a plain 2: a
 * lamp, a gear) is untouched.
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
 *   SUN only: uSunTone[6] the ladder (linear); uSunGrain (the coarse layer's frequency, its
 *   weight, the fine layer's frequency, half the soft edge of a tone); uSunCut the three
 *   thresholds; uSunLimb (the two facings of the limb, x < y, half the soft edge of a limb band,
 *   half the soft rim of a spot in radians); uSunSpot[3] (a spot's unit normal on the ball, and
 *   its radius in radians)
 * Attributes: position (bound to location 0), normal, color (USE_COLOR), aSide and aOver (each a
 *   further colour, and where the vertex stands on its line), aBend (how those two lines bend),
 *   aUnlit (0 lit, 1 flat, 2 glow,
 *   above 4 a sun's surface), aDecal (1 on a decal): every geometry carries all five.
 * Defines: USE_COLOR (vertex colours), USE_INSTANCING / USE_INSTANCING_COLOR (set by three),
 *   INSTANCED_SUN (each instance carries its own `aSunPosition`: the galaxy-wide far bodies),
 *   SUN (a sun's living surface).
 */
/** How many tones a sun's ladder has (sim/sunSurface.ts, SUN_TONE_COUNT: a test holds them equal). */
export const SUN_TONES = 6;
/** How many spots a sun has (design/tuning.ts, `look.sun.spots`: a test holds them equal). */
export const SUN_SPOTS = 3;

export const toonFlat = {
  vertexShader: /* glsl */ `
    uniform vec3 uSunPosition;
    uniform vec3 uTint;
    uniform float uDecalPull;

    attribute vec4 aSide;
    attribute vec4 aOver;
    attribute vec4 aBend;
    attribute float aUnlit;
    attribute float aDecal;

    #ifdef INSTANCED_SUN
      attribute vec3 aSunPosition;
    #endif

    flat varying vec3 vColor;
    flat varying vec3 vSide;
    flat varying vec3 vOver;
    flat varying float vUnlit;
    varying vec2 vEdge;
    varying vec4 vBend;
    varying vec3 vNormal;
    varying vec3 vToSun;
    #ifdef SUN
      varying vec3 vBall;
      varying float vLimb;
    #endif

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
      vNormal = worldNormal;
      vToSun = sun - worldPosition.xyz;

      vec3 tint = uTint;
      #ifdef USE_INSTANCING_COLOR
        tint *= instanceColor;
      #endif
      vColor = tint;
      #ifdef USE_COLOR
        vColor *= color;
      #endif
      vSide = tint * aSide.rgb;
      vOver = tint * aOver.rgb;
      vEdge = vec2(aSide.a, aOver.a);
      vBend = aBend;
      vUnlit = aUnlit;

      #ifdef SUN
        vBall = position;
        vLimb = dot(worldNormal, normalize(cameraPosition - worldPosition.xyz));
      #endif

      vec4 view = viewMatrix * worldPosition;
      view.xyz *= 1.0 - uDecalPull * aDecal;
      gl_Position = projectionMatrix * view;
    }
  `,

  fragmentShader: /* glsl */ `
    uniform vec3 uShadowTint;
    uniform vec2 uBandEdges;
    uniform float uMidLevel;
    uniform float uFlatness;
    uniform float uBloomMask;
    uniform float uGlowBloom;

    flat varying vec3 vColor;
    flat varying vec3 vSide;
    flat varying vec3 vOver;
    flat varying float vUnlit;
    varying vec2 vEdge;
    varying vec4 vBend;
    varying vec3 vNormal;
    varying vec3 vToSun;

    // How much of this pixel lies past an edge: a line one pixel soft, wherever it runs.
    float past(float value, float edge) {
      return clamp((value - edge) / max(fwidth(value), 1e-6) + 0.5, 0.0, 1.0);
    }

    // A line's bend at this pixel: none at its two ends, the most halfway along it.
    float arc(vec2 bend) {
      float along = clamp(bend.x, 0.0, 1.0);
      return bend.y * along * (1.0 - along);
    }

    #ifdef SUN
      uniform vec3 uTint;
      uniform vec3 uSunTone[${SUN_TONES}];
      uniform vec4 uSunGrain;
      uniform vec3 uSunCut;
      uniform vec4 uSunLimb;
      uniform vec4 uSunSpot[${SUN_SPOTS}];
      varying vec3 vBall;
      varying float vLimb;

      ${gradientNoise}

      // The same, with an edge that is soft on purpose: never thinner than a pixel.
      float soft(float value, float edge, float reach) {
        reach = max(reach, fwidth(value));
        return smoothstep(edge - reach, edge + reach, value);
      }

      vec3 sunSurface() {
        vec3 n = normalize(vBall);
        // The sun's own place in the noise: its number rides above the surface's flag.
        vec3 at = vec3(1.0, 0.4, 0.9) * (vUnlit - 6.0);
        float grain = uSunGrain.y * noise3(n * uSunGrain.x + at)
          + (1.0 - uSunGrain.y) * noise3(n * uSunGrain.z + at + vec3(2.2, 7.1, 1.3));
        float tone = soft(grain, uSunCut.x, uSunGrain.w)
          + soft(grain, uSunCut.y, uSunGrain.w)
          + soft(grain, uSunCut.z, uSunGrain.w);
        // The limb: two tones down past the first facing, one past the second, never under shade.
        tone = max(
          tone - 2.0 + soft(vLimb, uSunLimb.x, uSunLimb.z) + soft(vLimb, uSunLimb.y, uSunLimb.z),
          0.0
        );
        vec3 surface = tone < 1.0
          ? mix(uSunTone[0], uSunTone[1], tone)
          : (tone < 2.0
            ? mix(uSunTone[1], uSunTone[2], tone - 1.0)
            : mix(uSunTone[2], uSunTone[3], tone - 2.0));
        float ring = 0.0;
        float core = 0.0;
        for (int i = 0; i < ${SUN_SPOTS}; i += 1) {
          float angle = acos(clamp(dot(n, uSunSpot[i].xyz), -1.0, 1.0));
          ring = max(ring, 1.0 - soft(angle, uSunSpot[i].w * 1.5, uSunLimb.w));
          core = max(core, 1.0 - soft(angle, uSunSpot[i].w, uSunLimb.w));
        }
        surface = mix(mix(surface, uSunTone[4], ring), uSunTone[5], core);
        // On the star map: a flat disc of the family's base.
        return uTint * mix(surface, uSunTone[1], uFlatness);
      }
    #endif

    void main() {
      vec3 base = mix(
        mix(vColor, vSide, past(vEdge.x + arc(vBend.xy), 0.5)),
        vOver,
        past(vEdge.y + arc(vBend.zw), 0.5)
      );
      #ifdef SUN
        // Asked of every pixel (a derivative wants no branch round it), used on the ball's.
        vec3 surface = sunSurface();
        if (vUnlit > 4.0) base = surface;
      #endif

      // Asked of every pixel, from the normal of the curve at that pixel: between the corners of a
      // long facet the facing itself does not run straight, and a band's edge would show its corners.
      float facing = dot(normalize(vNormal), normalize(vToSun));
      float level = mix(uMidLevel * past(facing, uBandEdges.x), 1.0, past(facing, uBandEdges.y));
      // On the star map everything is lit: a map shows what is where, not what time of day it is.
      level = mix(level, 1.0, uFlatness);
      // A flat or glowing vertex takes no light: it is its colour. (The tests are halfway between
      // the whole numbers the attribute holds.)
      if (vUnlit > 0.5) level = 1.0;

      // Alpha is the bloom guest list (shaders/post.ts), and a lit surface is not on it: 0 when
      // somebody reads the list, plain opaque 1 when the picture goes straight to the canvas. A
      // glowing one is, as shaders/glow.ts writes it.
      float bloom = vUnlit > 1.5 ? uGlowBloom : 0.0;
      gl_FragColor = vec4(mix(base * uShadowTint, base, level), mix(1.0, bloom, uBloomMask));
      #include <colorspace_fragment>
    }
  `,
};
