/**
 * THE CHART: the star map's ground ("Deep light", docs/DESIGN.md). It lies a little under the
 * flight plane and is drawn only while the map shows, after the sky and before the stars and
 * everything else:
 *
 *   1 a grid of dots, about uGrid.x CSS px apart whatever the zoom: the spacing in world units
 *     is 1, 2 or 5 times a power of ten (uCell: sim/chartMesh.ts, gridCell), so a dot stays
 *     where it is while the map zooms and only every second (or fifth) one comes or goes
 *   2 a district for each system: a disc out past its reach and a disc at its reach, two flat
 *     steps of its family's dim tones, and a DASHED ring at its reach (a solid one reads as
 *     an orbit). The dashes are a whole number round the ring, so there is no seam
 *
 * Flat: every edge is one pixel soft and nothing is a gradient. The parts are laid over each
 * other as paint is, in DISPLAY space over the sky straight down, which is how the look was
 * designed. Premultiplied colour that leaves alpha as it found it (materials.ts): never on the
 * bloom guest list.
 *
 * WHO LAYS THE PAINT depends on where the picture goes (materials.ts, `drawsToCanvas`):
 *
 *   WITH POST-PROCESSING the picture is linear light, where a blend is not paint. One program,
 *   `chart`, on one plane, lays every part over the next itself and writes the sum as the
 *   corona does (shaders/corona.ts), so that the blend puts exactly that on that sky (`uUnder`).
 *
 *   STRAIGHT TO THE CANVAS the picture is display space already: the canvas's own blending IS
 *   the paint. So each part is a program and a mesh of its own, drawn only WHERE THE PART IS:
 *   the dots on the plane (`chartDots`), every district's two discs on a polygon round them
 *   (`chartDiscs`), every ring on a strip along it (`chartRings`), in that order
 *   (sim/chartMesh.ts makes the meshes). The same picture to within a step of 8 bits (each
 *   blend rounds once) for a fraction of the sums, and that is the point: this is the tier of
 *   a device with no GPU to speak of, and of CI, which draws on the CPU. There the one program
 *   took 24 ms of every frame of the map, each pixel working out every district's discs and
 *   the angle round every ring; the parts take 4, the dots 3 of them. (Chromium's SwiftShader,
 *   four cores, 759 x 474 px, 2026-10-03. A software renderer runs both sides of an `if` for
 *   every pixel, so only geometry keeps work away from a pixel.)
 *
 *   One thing differs: the rings come after ALL the discs, where the one program finishes a
 *   district before it starts the next. That could only show where one district's disc lies
 *   under another's ring, and the galaxy's layout leaves no such place (world/Chart.test.ts
 *   holds the numbers that say so).
 *
 * `chart`. Defines: DISTRICTS (how many systems, at least 1).
 * Uniforms: uWeight (the map's: 0 flying, 1 on the map; every part is that much there),
 * uUnitsPerPx (world units a CSS px on the map), uCell (the grid's spacing, world units),
 * uUnder and uDot (display space), uGrid (spacing px, a dot's radius px, alpha), uDisc[] (a
 * system's x, z and reach), uOuter[], uInner[] and uRing[] (its three colours, display space),
 * uDistrict (the outer disc's radius in reaches, its alpha, the inner disc's, the ring's),
 * uDash (the ring's width, a dash and a gap, px).
 *
 * `chartDots`: uWeight, uUnitsPerPx, uCell, uDot and uGrid, as above.
 * `chartDiscs` and `chartRings`. Geometry: position (a vertex on its part's own edge), aPad
 * (x and z of its step for a world unit of room, and the most units it may step), aDisc (its
 * district's x, z and reach), and the district's colours in display space: aOuter and aInner
 * (discs), aRing (rings). Uniforms: uWeight, uUnitsPerPx and uDistrict, as above; uRoom (the
 * room round a part, CSS px: its soft edge, and a pixel of the picture, which may be two of
 * those); uDash (rings).
 */

/** How much of a pixel lies within reach of an edge dist away, both in pixels. */
const COVER = /* glsl */ `
    float cover(float reach, float dist) {
      return clamp(reach - dist + 0.5, 0.0, 1.0);
    }
`;

/** The grid: how much of a pixel a dot covers, on a map where a pixel is px world units. */
const DOTS = /* glsl */ `
    float dotCover(vec2 w, float cell, float px, float radius) {
      vec2 toDot = (fract(w / cell + 0.5) - 0.5) * cell / px;
      return cover(radius, length(toDot));
    }
`;

/**
 * A district's ring, r px from its middle (`from`, world units) where the ring is reach px
 * out: a whole number of dashes round it, each as near its length as that allows. `dash`: the
 * ring's width, a dash and a gap, px.
 */
const DASHES = /* glsl */ `
    const float TURN = 6.2831853;

    float dashAlpha(vec2 from, float r, float reach, vec3 dash, float alpha) {
      float dashes = max(1.0, floor(TURN * reach / (dash.y + dash.z) + 0.5));
      float along = abs(fract(atan(from.x, from.y + 1e-5) / TURN * dashes) - 0.5) * TURN * reach / dashes;
      return alpha * cover(0.5 * dash.x, abs(r - reach)) * cover(0.5 * dash.y, along);
    }
`;

/** The plane: where on the world's ground a pixel is. */
const PLANE = /* glsl */ `
    varying vec2 vW;

    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vW = world.xz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
`;

/** With post-processing: the whole chart, laid in display space by one program. */
export const chart = {
  vertexShader: PLANE,

  fragmentShader: /* glsl */ `
    uniform float uWeight;
    uniform float uUnitsPerPx;
    uniform float uCell;
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

    ${COVER}
    ${DOTS}
    ${DASHES}

    vec3 paint;
    float keep = 1.0;

    void over(vec3 color, float alpha) {
      paint = mix(paint, color, alpha);
      keep *= 1.0 - alpha;
    }

    void main() {
      paint = uUnder;
      float px = uUnitsPerPx;
      over(uDot, uWeight * uGrid.z * dotCover(vW, uCell, px, uGrid.y));

      for (int i = 0; i < DISTRICTS; i += 1) {
        vec2 from = vW - uDisc[i].xy;
        float r = length(from) / px;
        float reach = uDisc[i].z / px;
        vec3 alpha = uWeight * uDistrict.yzw;
        over(uOuter[i], alpha.x * cover(reach * uDistrict.x, r));
        over(uInner[i], alpha.y * cover(reach, r));
        // Only the pixels within reach of the ring work out where on it they are.
        if (abs(r - reach) < 0.5 * uDash.x + 1.0) {
          over(uRing[i], dashAlpha(from, r, reach, uDash, alpha.z));
        }
      }

      // Linear light which, blended over the sky under it, is that paint on that sky.
      vec3 under = sRGBTransferEOTF(vec4(uUnder, 1.0)).rgb;
      vec3 light = sRGBTransferEOTF(vec4(paint, 1.0)).rgb - keep * under;
      gl_FragColor = vec4(max(light, 0.0), 1.0 - keep);
      #include <colorspace_fragment>
    }
  `,
};

/**
 * Straight to the canvas, the first part: the dots, on the plane. Between the dots there is
 * nothing to blend (99 pixels in 100), and those are left alone.
 */
export const chartDots = {
  vertexShader: PLANE,

  fragmentShader: /* glsl */ `
    uniform float uWeight;
    uniform float uUnitsPerPx;
    uniform float uCell;
    uniform vec3 uDot;
    uniform vec3 uGrid;

    varying vec2 vW;

    ${COVER}
    ${DOTS}

    void main() {
      float alpha = uWeight * uGrid.z * dotCover(vW, uCell, uUnitsPerPx, uGrid.y);
      if (alpha <= 0.0) discard;
      gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
      #include <colorspace_fragment>
      // The canvas is display space, and so is this paint: it is written as it is.
      gl_FragColor.rgb = uDot * alpha;
    }
  `,
};

/** The second part: every district's two discs, the inner over the outer, in one go. */
export const chartDiscs = {
  vertexShader: /* glsl */ `
    attribute vec3 aPad;
    attribute vec3 aDisc;
    attribute vec3 aOuter;
    attribute vec3 aInner;

    uniform float uUnitsPerPx;
    uniform float uRoom;

    varying vec2 vW;
    flat varying vec3 vDisc;
    flat varying vec3 vOuter;
    flat varying vec3 vInner;

    void main() {
      float room = min(uRoom * uUnitsPerPx, aPad.z);
      vec3 at = vec3(position.x + aPad.x * room, position.y, position.z + aPad.y * room);
      vec4 world = modelMatrix * vec4(at, 1.0);
      vW = world.xz;
      vDisc = aDisc;
      vOuter = aOuter;
      vInner = aInner;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,

  fragmentShader: /* glsl */ `
    uniform float uWeight;
    uniform float uUnitsPerPx;
    uniform vec4 uDistrict;

    varying vec2 vW;
    flat varying vec3 vDisc;
    flat varying vec3 vOuter;
    flat varying vec3 vInner;

    ${COVER}

    void main() {
      float r = length(vW - vDisc.xy) / uUnitsPerPx;
      float reach = vDisc.z / uUnitsPerPx;
      vec2 alpha = uWeight * uDistrict.yz * vec2(cover(reach * uDistrict.x, r), cover(reach, r));
      // The polygon's corners, outside the outer disc (the inner one lies within it).
      if (alpha.x <= 0.0) discard;
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0 - (1.0 - alpha.x) * (1.0 - alpha.y));
      #include <colorspace_fragment>
      gl_FragColor.rgb = vOuter * (alpha.x * (1.0 - alpha.y)) + vInner * alpha.y;
    }
  `,
};

/** The third part: every district's dashed ring. */
export const chartRings = {
  vertexShader: /* glsl */ `
    attribute vec3 aPad;
    attribute vec3 aDisc;
    attribute vec3 aRing;

    uniform float uUnitsPerPx;
    uniform float uRoom;

    varying vec2 vW;
    flat varying vec3 vDisc;
    flat varying vec3 vRing;

    void main() {
      float room = min(uRoom * uUnitsPerPx, aPad.z);
      vec3 at = vec3(position.x + aPad.x * room, position.y, position.z + aPad.y * room);
      vec4 world = modelMatrix * vec4(at, 1.0);
      vW = world.xz;
      vDisc = aDisc;
      vRing = aRing;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,

  fragmentShader: /* glsl */ `
    uniform float uWeight;
    uniform float uUnitsPerPx;
    uniform vec4 uDistrict;
    uniform vec3 uDash;

    varying vec2 vW;
    flat varying vec3 vDisc;
    flat varying vec3 vRing;

    ${COVER}
    ${DASHES}

    void main() {
      vec2 from = vW - vDisc.xy;
      float r = length(from) / uUnitsPerPx;
      float reach = vDisc.z / uUnitsPerPx;
      float alpha = dashAlpha(from, r, reach, uDash, uWeight * uDistrict.w);
      if (alpha <= 0.0) discard;
      gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
      #include <colorspace_fragment>
      gl_FragColor.rgb = vRing * alpha;
    }
  `,
};
