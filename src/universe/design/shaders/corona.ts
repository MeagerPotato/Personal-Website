/**
 * THE CORONA: the light round a sun ("Deep light", docs/DESIGN.md). One draw call of instanced
 * quads that face the camera, drawn after the solid world. A sun has two: its LIGHT, which lies
 * behind everything the sun wears (its brackets, its stopwatch), and its LENS, in front of its
 * ball. A plain sun (the Hardware gear ball: its gears are its surface) has only the first two
 * parts of the light.
 *
 *   the light   1 halo steps: flat rings of the family's base, each fainter than the one inside
 *               2 a soft glow, falling off through the family's three tones
 *               3 rays: thin beams from the limb, one in each tenth of the circle, each its own
 *                 length, width and lean (hashed from the sun's seed), breathing slowly. A beam
 *                 is light, so it has no edge: brightest along its middle, it fades to nothing
 *                 at the width a wedge would have had, and so comes to no corner at its tip
 *               4 prominences: loops that rise from the limb and come back to it
 *   the lens    5 the lit edge: a hairline of the hottest tone just inside the outline
 *               6 the glint: a four-point sparkle fixed on the screen, a lens artefact as the
 *                 hero stars' spikes are (shaders/sky.ts); its arms are short, so they fade
 *                 evenly to their tips where a star's long ones fall off fast
 *
 * Lengths are in radii of the sun AS IT IS SEEN: a ball's outline is a little wider than its
 * radius at its centre's depth, so the vertex shader measures the outline and r = 1 is exactly
 * it at any distance. On the star map (`uCalm` 1) only the halo steps are left.
 *
 * The parts are laid over each other as paint is, in DISPLAY space over the navy of the sky
 * (`uUnder`), which is how the look was designed; the result is then written so that the
 * blending of this tier (in linear light where post-processing reads the picture, after encoding
 * where it goes straight to the canvas) puts exactly that on a navy sky, and the same light on
 * whatever else is behind. Blended as premultiplied colour that leaves alpha as it found it
 * (materials.ts): the corona is never on the bloom guest list. The ball still blooms.
 *
 * Geometry: position (a corner of the quad, x and y each -1 or 1). Per instance: aCenter (the
 * sun's world position and its radius as drawn), aShade, aBase, aLight, aHot (its four tones, in
 * display space), aSun (its seed; its layer: 0 a plain sun's light, 1 a light, 2 a lens).
 * Uniforms: uTime (s; 0 holds everything still), uCalm (0 flying, 1 the star map), uFull (1: the
 * prominences and the glint are drawn; 0 on the low tier), uRayMask (bit i: ray i is drawn),
 * uReach (the half-extent of a light's quad and a lens's), uPull (how far each stands toward the
 * camera from the sun's centre, radii), uUnder (display space), uBloomMask (shared, see
 * materials.ts);
 * uSteps[] (inner, outer, alpha), uGlow (from, to) and uGlowStops[] (place 0 to 1, tone, alpha);
 * uRay (how many, how far a ray's light reaches, the share it breathes by, where its base is),
 * uRayShape (shortest, longest, narrowest and widest half-angle), uRaySec (slowest and fastest
 * breath) and uRayStops[]; uProm[] (angle, half-span, apex), uPromStroke[] (tone, alpha, width)
 * and uPromBreath (share, slowest, fastest); uEdge (from, alpha, width); uGlint (x, y, length,
 * alpha) and uGlintSize (the lines' width, the dot's radius).
 * A tone is 0 shade, 1 base, 2 light.
 */
export const CORONA_STEPS = 4;
export const CORONA_GLOW_STOPS = 4;
export const CORONA_RAY_STOPS = 3;
export const CORONA_PROMS = 3;

export const corona = {
  vertexShader: /* glsl */ `
    attribute vec4 aCenter;
    attribute vec3 aShade;
    attribute vec3 aBase;
    attribute vec3 aLight;
    attribute vec3 aHot;
    attribute vec2 aSun;

    uniform vec2 uReach;
    uniform vec2 uPull;

    varying vec2 vP;
    flat varying vec3 vShade;
    flat varying vec3 vBase;
    flat varying vec3 vLight;
    flat varying vec3 vHot;
    flat varying vec2 vSun;

    void main() {
      float lens = step(1.5, aSun.y);
      vec4 center = viewMatrix * vec4(aCenter.xyz, 1.0);
      float radius = aCenter.w;
      float far2 = dot(center.xyz, center.xyz);
      // The outline of a ball, at its centre's depth: wider than its radius, the nearer the more.
      float seen = radius * sqrt(far2 / max(far2 - radius * radius, far2 * 0.01));
      vP = position.xy * mix(uReach.x, uReach.y, lens);
      vec4 clip = projectionMatrix * vec4(center.xy + vP * seen, center.z, 1.0);
      // Where it is on the screen is the sun's; how deep it lies is its layer's.
      float pull = mix(uPull.x, uPull.y, lens) * radius / sqrt(far2);
      vec4 deep = projectionMatrix * vec4(center.xyz * (1.0 - pull), 1.0);
      clip.z = deep.z / deep.w * clip.w;
      gl_Position = clip;

      vShade = aShade;
      vBase = aBase;
      vLight = aLight;
      vHot = aHot;
      vSun = aSun;
    }
  `,

  fragmentShader: /* glsl */ `
    #define STEPS ${CORONA_STEPS}
    #define GLOW_STOPS ${CORONA_GLOW_STOPS}
    #define RAY_STOPS ${CORONA_RAY_STOPS}
    #define PROMS ${CORONA_PROMS}
    #define TURN 6.2831853

    uniform float uTime;
    uniform float uCalm;
    uniform float uFull;
    uniform int uRayMask;
    uniform float uBloomMask;
    uniform vec3 uUnder;
    uniform vec3 uSteps[STEPS];
    uniform vec2 uGlow;
    uniform vec3 uGlowStops[GLOW_STOPS];
    uniform vec4 uRay;
    uniform vec4 uRayShape;
    uniform vec2 uRaySec;
    uniform vec3 uRayStops[RAY_STOPS];
    uniform vec3 uProm[PROMS];
    uniform vec3 uPromStroke[2];
    uniform vec3 uPromBreath;
    uniform vec3 uEdge;
    uniform vec4 uGlint;
    uniform vec2 uGlintSize;

    varying vec2 vP;
    flat varying vec3 vShade;
    flat varying vec3 vBase;
    flat varying vec3 vLight;
    flat varying vec3 vHot;
    flat varying vec2 vSun;

    // The picture so far, and how much of what is behind it still shows.
    vec3 paint;
    float keep = 1.0;

    void over(vec3 color, float alpha) {
      paint = mix(paint, color, alpha);
      keep *= 1.0 - alpha;
    }

    vec3 tone(float which) {
      return which < 0.5 ? vShade : (which < 1.5 ? vBase : vLight);
    }

    // How much of a pixel lies within reach of an edge dist away: a line one pixel soft.
    float cover(float reach, float dist, float px) {
      return clamp((reach - dist) / px + 0.5, 0.0, 1.0);
    }

    float wrap(float angle) {
      return angle - TURN * floor(angle / TURN + 0.5);
    }

    void main() {
      paint = uUnder;
      float r = length(vP);
      // One pixel, in radii: the quad faces the screen, so this is the same everywhere on it.
      float px = abs(dFdx(vP.x));
      float seed = vSun.x;
      float live = 1.0 - uCalm;

      if (vSun.y < 1.5) {
        float halo = 0.0;
        for (int i = 0; i < STEPS; i += 1) {
          vec3 ring = uSteps[i];
          halo += ring.z * (cover(ring.y, r, px) - cover(ring.x, r, px));
        }
        over(vBase, halo);

        float t = (r - uGlow.x) / (uGlow.y - uGlow.x);
        for (int i = 1; i < GLOW_STOPS; i += 1) {
          vec3 a = uGlowStops[i - 1];
          vec3 b = uGlowStops[i];
          if (t >= a.x && t < b.x) {
            float k = (t - a.x) / (b.x - a.x);
            over(mix(tone(a.y), tone(b.y), k), mix(a.z, b.z, k) * live);
          }
        }

        float full = live * step(0.5, vSun.y);
        float angle = atan(vP.y, vP.x);

        // The one ray whose tenth of the circle this is (a ray never leans out of its own).
        float i = mod(floor((angle - 0.2) / TURN * uRay.x + 0.5), uRay.x);
        float pace = abs(sin(37.7 * i + seed));
        float lean = wrap(angle - (TURN * i / uRay.x + 0.2 + sin(12.9898 * i + seed) * 0.08));
        float tip = mix(uRayShape.x, uRayShape.y, abs(sin(78.233 * i + 3.1 * seed)));
        tip *= 1.0 + uRay.z * sin(uTime * TURN / mix(uRaySec.x, uRaySec.y, pace));
        float wide = mix(uRayShape.z, uRayShape.w, pace);
        float along = r * cos(lean);
        float width = uRay.w * sin(wide) * (tip - along) / (tip - uRay.w * cos(wide));
        float ray = (1.0 - smoothstep(0.0, max(width, px), abs(r * sin(lean))))
          * clamp(width / px + 0.5, 0.0, 1.0) * float((uRayMask >> int(i)) & 1);
        float s = clamp((r - 1.0) / (uRay.y - 1.0), 0.0, 1.0);
        for (int j = 1; j < RAY_STOPS; j += 1) {
          vec3 a = uRayStops[j - 1];
          vec3 b = uRayStops[j];
          if (s >= a.x && s <= b.x) {
            float k = (s - a.x) / (b.x - a.x);
            over(mix(tone(a.y), tone(b.y), k), mix(a.z, b.z, k) * ray * full);
            break;
          }
        }

        if (uFull > 0.5) {
          for (int j = 0; j < PROMS; j += 1) {
            vec3 loop = uProm[j];
            float u = wrap(angle - loop.x - 0.3 * seed) / loop.y;
            if (abs(u) < 1.0) {
              float sec = mix(uPromBreath.y, uPromBreath.z, float(j) / float(PROMS - 1));
              float rise = (loop.z - 1.0) * (1.0 + uPromBreath.x * sin(uTime * TURN / sec));
              // How far from the arch, across it: the arch is steep at its feet.
              float slope = 2.0 * rise * u / (loop.y * r);
              float off = abs(r - 1.0 - rise * (1.0 - u * u)) / sqrt(1.0 + slope * slope);
              for (int k = 0; k < 2; k += 1) {
                vec3 stroke = uPromStroke[k];
                over(tone(stroke.x), stroke.y * cover(max(stroke.z, px) * 0.5, off, px) * full);
              }
            }
          }
        }
      } else {
        float wide = max(uEdge.z, px);
        over(vHot, uEdge.y * cover(wide * 0.5, abs(r - (uEdge.x + 1.0) * 0.5), px) * live);

        if (uFull > 0.5) {
          vec2 g = abs(vP - uGlint.xy);
          vec2 fall = 1.0 - min(g / uGlint.z, 1.0);
          float line = max(uGlintSize.x, px) * 0.5;
          float spark = max(fall.x * cover(line, g.y, px), fall.y * cover(line, g.x, px));
          spark = max(spark, cover(max(uGlintSize.y, 1.2 * px), length(g), px));
          over(vHot, uGlint.w * spark * live);
        }
      }

      vec3 under = sRGBTransferEOTF(vec4(uUnder, 1.0)).rgb;
      vec3 light = uBloomMask > 0.5
        ? sRGBTransferEOTF(vec4(paint, 1.0)).rgb - keep * under
        : sRGBTransferEOTF(vec4(max(paint - keep * uUnder, 0.0), 1.0)).rgb;
      gl_FragColor = vec4(max(light, 0.0), 1.0 - keep);
      #include <colorspace_fragment>
    }
  `,
};
