/**
 * THE CHART: the star map's ground ("Deep light", docs/DESIGN.md). One plane under the flight
 * plane, drawn only while the map shows, after the sky and before the stars and everything else:
 *
 *   1 a grid of dots, about uGrid.x CSS px apart whatever the zoom: the spacing in world units
 *     is 1, 2 or 5 times a power of ten, so a dot stays where it is while the map zooms and
 *     only every second (or fifth) one comes or goes
 *   2 a district for each system: a disc out past its reach and a disc at its reach, two flat
 *     steps of its family's gas, and a DASHED ring at its reach (a solid one reads as an
 *     orbit). The dashes are a whole number round the ring, so there is no seam
 *
 * Flat: every edge is one pixel soft and nothing is a gradient. The parts are laid over each
 * other as paint is, in DISPLAY space over the sky straight down (`uUnder`), which is how the
 * look was designed; the result is written as the corona's is (shaders/corona.ts), so that this
 * tier's blending puts exactly that on that sky. Premultiplied colour that leaves alpha as it
 * found it (materials.ts): never on the bloom guest list.
 *
 * Defines: DISTRICTS (how many systems, at least 1).
 * Uniforms: uWeight (the map's: 0 flying, 1 on the map; every part is that much there), uUnitsPerPx (world units a CSS px on
 * the map), uUnder and uDot (display space), uGrid (spacing px, a dot's radius px, alpha),
 * uDisc[] (a system's x, z and reach), uOuter[], uInner[] and uRing[] (its three colours,
 * display space), uDistrict (the outer disc's radius in reaches, its alpha, the inner disc's,
 * the ring's), uDash (the ring's width, a dash and a gap, px), uBloomMask (shared, see
 * materials.ts).
 */
export const chart = {
  vertexShader: /* glsl */ `
    varying vec2 vW;

    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vW = world.xz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,

  fragmentShader: /* glsl */ `
    uniform float uWeight;
    uniform float uUnitsPerPx;
    uniform float uBloomMask;
    uniform vec3 uUnder;
    uniform vec3 uDot;
    uniform vec3 uGrid;
    uniform vec3 uDisc[DISTRICTS];
    uniform vec3 uOuter[DISTRICTS];
    uniform vec3 uInner[DISTRICTS];
    uniform vec3 uRing[DISTRICTS];
    uniform vec4 uDistrict;
    uniform vec3 uDash;

    varying vec2 vW;

    const float TURN = 6.2831853;

    vec3 paint;
    float keep = 1.0;

    void over(vec3 color, float alpha) {
      paint = mix(paint, color, alpha);
      keep *= 1.0 - alpha;
    }

    // How much of a pixel lies within reach of an edge dist away, both in pixels.
    float cover(float reach, float dist) {
      return clamp(reach - dist + 0.5, 0.0, 1.0);
    }

    void main() {
      paint = uUnder;
      float px = uUnitsPerPx;

      float spacing = px * uGrid.x;
      float decade = pow(10.0, floor(log(spacing) / 2.302585));
      float m = spacing / decade;
      float cell = decade * (m < 1.5 ? 1.0 : m < 3.5 ? 2.0 : m < 7.5 ? 5.0 : 10.0);
      vec2 toDot = (fract(vW / cell + 0.5) - 0.5) * cell / px;
      over(uDot, uWeight * uGrid.z * cover(uGrid.y, length(toDot)));

      for (int i = 0; i < DISTRICTS; i += 1) {
        vec2 from = vW - uDisc[i].xy;
        float r = length(from) / px;
        float reach = uDisc[i].z / px;
        vec3 alpha = uWeight * uDistrict.yzw;
        over(uOuter[i], alpha.x * cover(reach * uDistrict.x, r));
        over(uInner[i], alpha.y * cover(reach, r));
        // A whole number of dashes round the ring, each as near its length as that allows.
        float dashes = max(1.0, floor(TURN * reach / (uDash.y + uDash.z) + 0.5));
        float along = abs(fract(atan(from.x, from.y + 1e-5) / TURN * dashes) - 0.5) * TURN * reach / dashes;
        over(
          uRing[i],
          alpha.z * cover(0.5 * uDash.x, abs(r - reach)) * cover(0.5 * uDash.y, along)
        );
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
