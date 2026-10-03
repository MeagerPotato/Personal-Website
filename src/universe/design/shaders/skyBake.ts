import { fullscreenVertex } from './post';

/**
 * THE SKY'S BAKE: what one texel of the sky's panorama holds (world/SkyBake.ts draws it once,
 * after the first frame, a band of rows a frame; shaders/sky.ts then reads it every frame).
 *
 * The panorama is an equal-area cylinder: u is the azimuth (atan(x, z)) over a full turn plus a
 * half, v is (y + 1) / 2. RGB is the light the sky ADDS to the navy; alpha is how much of a star
 * shows there (1 = clear sky; less in the Milky Way's dark lane).
 *
 * The picture is two things and no more: THE MILKY WAY, a faint smooth haze along a great circle
 * with a dark lane through it and a cream bulge, under the river of stars that the star list
 * lays along the same circle; and FAR GALAXIES, small ellipses in star tints. No gas, no clouds:
 * nothing here is noise and nothing is cut into levels, so nothing has an edge. Every term is a
 * Gaussian or a sine of where the texel is. The light is then limited (a ceiling on luminance,
 * a calm strip along the horizon).
 *
 * sim/skyOracle.ts is this program on the CPU, expression for expression (with sim/milkyWay.ts,
 * which the star list shares): the tests hold the sky to its gates with it, and the lab compares
 * the two texel by texel. CHANGE THEM TOGETHER.
 *
 * `constants` (design/skyRecipe.ts) is `tuning.look.sky` as GLSL: the Milky Way's frame (BAND_P
 * its pole, BAND_B1 and BAND_B2 the vectors its longitude is measured from) and numbers, the
 * table of its clumps (CLUMP: longitude, sigma, weight) and of the galaxies (GC, GE1, GE2 a
 * galaxy's frame; GP its semi-major axis, axis ratio, and the cosine and sine of its turn; GK
 * its kind, the cosine of the angle past which it is not looked at, its gain; GT the star tints
 * of its disc and its nucleus). The same program on every tier.
 *
 * Uniforms: uDeep, uHorizon (linear: the navy's two ends) and uFalloff (backdrop.horizonFalloff);
 * uBand[4] (linear: the haze's ramp: deep, mid, lit, rim); uStar[6] (linear: the star tints, in
 * the tokens' order); uLoop[2] (how many galaxies and clumps: uniforms, because with constant
 * counts Direct3D's compiler unrolls the loops and takes longer over it). Geometry: the one
 * triangle that covers the target (shaders/post.ts).
 */
export const skyBake = {
  vertexShader: fullscreenVertex,
  fragmentShader: (constants: string): string => /* glsl */ `
    uniform vec3 uDeep;
    uniform vec3 uHorizon;
    uniform float uFalloff;
    uniform vec3 uBand[4];
    uniform vec3 uStar[6];
    uniform int uLoop[2];
    varying vec2 vUv;

    ${constants}

    const float RAD = 0.017453292519943295;

    float ss(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
    float wrap180(float a) { return mod(a + 180.0, 360.0) - 180.0; }
    float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    float sq(float x) { return x * x; }

    vec4 bake(vec3 d) {
      float el = asin(clamp(d.y, -1.0, 1.0)) / RAD;
      vec3 navy = mix(uDeep, uHorizon, exp(-abs(d.y) * uFalloff)), add = vec3(0.0);
      float occ = 1.0;

      // The Milky Way. lb: degrees off its great circle; phi: the longitude round it.
      float lb = asin(clamp(dot(d, BAND_P), -1.0, 1.0)) / RAD;
      if (abs(lb) < 40.0) {
        float phi = atan(dot(d, BAND_B2), dot(d, BAND_B1)), lon = phi / RAD;
        // Degrees off the river's middle, which wanders about the circle.
        float yy = lb - (MEANDER.x * sin(2.0 * phi + MEANDER.y) + MEANDER.z * sin(5.0 * phi + MEANDER.w));
        // Across: a narrow bank and a wide one. Along: a base, and the clumps.
        float prof = BANKS.y * exp(-sq(yy / BANKS.x)) + BANKS.w * exp(-sq(yy / BANKS.z));
        float clump = BAND_BASE;
        for (int i = 0; i < uLoop[1]; i++) clump += CLUMP[i].z * exp(-sq(wrap180(lon - CLUMP[i].x) / CLUMP[i].y));
        float lane = exp(-sq((yy - (LANE_OFF.x + LANE_OFF.y * sin(3.0 * phi + 0.7) + LANE_OFF.z * sin(7.0 * phi + 2.1))) / (LANE_W.x + LANE_W.y * sin(4.0 * phi + 1.3))));
        float bq = clamp(prof * clump * BAND_GAIN, 0.0, 1.0);
        vec3 v = mix(uBand[0], uBand[1], ss(0.04, 0.55, bq));
        v = mix(v, uBand[2], 0.45 * ss(0.5, 1.0, bq));
        // The cream bulge, and the lane: a little darker, and most of its stars hidden.
        v = mix(v, uBand[3], exp(-sq(wrap180(lon - CORE.x) / CORE.y)) * CORE.z * ss(0.4, 1.0, bq));
        v *= 1.0 - LANE.x * lane * ss(0.05, 0.35, bq);
        add = 0.95 * ss(0.0, 0.22, bq) * max(v - navy, 0.0);
        occ = 1.0 - LANE.y * lane * ss(0.0, 0.25, bq);
      }

      // Far galaxies: a disc with a soft rim and a tight nucleus, in two star tints. A spiral's
      // disc is two arms; a lens (edge on) has a dark lane along it.
      for (int i = 0; i < uLoop[0]; i++) {
        float cd = dot(d, GC[i]);
        if (cd < GK[i].y) continue;
        vec3 pp = d - GC[i] * cd;
        float uu = dot(pp, GE1[i]) / RAD, vv = dot(pp, GE2[i]) / RAD;
        float x = uu * GP[i].z + vv * GP[i].w, y = -uu * GP[i].w + vv * GP[i].z;
        float ga = GP[i].x, gb = GP[i].x * GP[i].y, r2 = sq(x / ga) + sq(y / gb);
        if (r2 > 4.0) continue;
        float r = sqrt(r2), disc = exp(-2.6 * r) * (1.0 - ss(0.82, 1.18, r)), core = exp(-28.0 * r2);
        if (GK[i].x == 2.0) disc *= 0.45 + 0.9 * (0.5 + 0.5 * cos(2.0 * atan(y / gb, x / ga) - 6.2 * log(r + 0.12))) * ss(0.08, 0.5, r);
        else if (GK[i].x == 1.0) {
          float dark = exp(-sq(y / (0.2 * gb))) * ss(0.05, 0.5, 1.0 - min(1.0, r2 / 1.1));
          disc *= 1.0 - 0.6 * dark;
          core *= 1.0 - 0.3 * dark;
        }
        float o = 0.55 * disc + 0.9 * core;
        add += mix(uStar[GT[i].x], uStar[GT[i].y], clamp(0.9 * core / max(o, 1e-6), 0.0, 1.0)) * (o * 0.42 * GK[i].z);
      }

      // Faded toward the horizon, then a soft knee at the ceiling.
      add *= ss(STRIP0, STRIP1, abs(el));
      float ya = lum(add);
      if (ya > 1e-9) { float room = max(CAP_ABOVE - lum(navy), 1e-5); add *= room * tanh(ya / room) / ya; }
      return vec4(add * INTENSITY, occ);
    }

    float hash12(vec2 p) {
      vec3 q = fract(vec3(p.xyx) * 0.1031);
      q += dot(q, q.yzx + 33.33);
      return fract((q.x + q.y) * q.z);
    }

    void main() {
      // One fragment a texel: the inverse of the sample's mapping (shaders/sky.ts).
      float az = (vUv.x - 0.5) * 6.283185307179586, y = vUv.y * 2.0 - 1.0, r = sqrt(max(1.0 - y * y, 0.0));
      vec4 shown = sRGBTransferOETF(bake(vec3(r * sin(az), y, r * cos(az))));
      // Half a code of dither in display space; the target encodes it again to this very value.
      shown.rgb += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
      gl_FragColor = sRGBTransferEOTF(max(shown, 0.0));
    }
  `,
};
