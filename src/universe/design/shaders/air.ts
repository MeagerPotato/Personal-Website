import { gradientNoise } from './noise';

/**
 * AIR: what is round a world with air and is not the world ("Deep light", docs/DESIGN.md). Two
 * draw calls for every such world together, both after the solid world, neither on the bloom
 * guest list (materials.ts blends them so that alpha stays as it was):
 *
 * THE SHELL (`airShell`): instanced quads that face the camera, one a world.
 *   1 the shell: flat rings of the air's colour outside the world's outline, each fainter than
 *     the one inside, bright toward the world's light and faint on its night side
 *   2 the hairline: a thin line on the outline itself, whose colour runs round the limb from
 *     the pale air where the light comes from, through a warm dusk where day meets night, to
 *     almost nothing at midnight
 * Lengths are in radii of the world AS IT IS SEEN, as the suns' corona measures them
 * (shaders/corona.ts): r = 1 is exactly its outline at any distance. Round the limb, a place is
 * `the angle between it and the light`, both as the camera sees them: with the light behind the
 * world or behind the camera, the whole limb is the terminator. The parts are laid over each
 * other as paint is, in display space over the navy of the sky, and written as the corona writes
 * its own, so that the picture is the same on every tier.
 *
 * THE CLOUDS (`airCloud`): one ball a world, a little bigger than the world, on which the clouds
 * are DRAWN, pixel by pixel: a fractal noise on the ball (shaders/noise.ts; the twin on the CPU
 * is sim/clouds.ts, which the tests hold to its shares), cut at the world's own threshold into
 * flat shapes with round, pixel-soft outlines, a thin edge and a body. A cloud takes the same
 * three bands of light as the ground under it: its colour, a warm dusk, a cool night. The ball
 * turns slowly about the world's axis.
 *
 * On the star map (`uCalm` 1) there is neither.
 *
 * The shell. Geometry: position (a corner of the quad, x and y each -1 or 1). Per instance:
 * aCenter (the world's position and its radius as drawn), aAir (its air, display space), aLight
 * (where its light is, world space).
 * Uniforms: uCalm (0 flying, 1 the star map), uReach (the quad's half-extent, and how far it
 * stands toward the camera from the world's centre, both in radii), uUnder (the navy, display
 * space), uBloomMask (shared, see materials.ts); uRings[] (inner, outer, alpha) and uRingCount
 * (how many of them are drawn); uMask[] (degrees from the light, value); uRim (radius, width in
 * pixels, width in radii), uRimStops[] (degrees from the light, tone, alpha: a tone is 0 the
 * air, 1 the air toward white, 2 the dusk), uRimMix (how far tone 1 is toward white, how far
 * tone 2 is from the dusk toward the air), uDusk (display space).
 *
 * The clouds. Geometry: position (a unit ball). Per instance: aCenter (as above), aLight, aCloud
 * (the cloud's lit colour, linear), aSky (the world's place in the noise, its threshold, the
 * turn it starts at).
 * Uniforms: uTime (s; 0 holds the clouds still), uCalm, uSkin (the ball's radius in world radii,
 * and how fast it turns, rad/s), uField (the noise's weight, the band's weight, the band's
 * frequency, how far into the field a cloud's body starts), uFreq (the noise's frequencies),
 * uSoft (half the soft edge of a cloud, in the field), uAlpha (the edge's and the body's),
 * uDusk and uNight (the multipliers of the middle and the shade band, linear), uBandEdges (the
 * toon bands' two facings: shared with the toon material).
 */
export const AIR_RINGS = 4;
export const AIR_MASK_STOPS = 3;
export const AIR_RIM_STOPS = 5;
/** The most layers the clouds' noise has (design/tuning.ts, `look.air.cloud.octaves`). */
export const CLOUD_OCTAVES = 4;

export const airShell = {
  vertexShader: /* glsl */ `
    attribute vec4 aCenter;
    attribute vec3 aAir;
    attribute vec3 aLight;

    uniform vec2 uReach;

    varying vec2 vP;
    flat varying vec3 vAir;
    flat varying vec3 vToward;

    void main() {
      vec4 center = viewMatrix * vec4(aCenter.xyz, 1.0);
      float radius = aCenter.w;
      float far2 = dot(center.xyz, center.xyz);
      // The outline of a ball, at its centre's depth: wider than its radius, the nearer the more.
      float seen = radius * sqrt(far2 / max(far2 - radius * radius, far2 * 0.01));
      vP = position.xy * uReach.x;
      vec4 clip = projectionMatrix * vec4(center.xy + vP * seen, center.z, 1.0);
      // Where it is on the screen is the world's; how deep it lies is the shell's.
      vec4 deep = projectionMatrix * vec4(center.xyz * (1.0 - uReach.y * radius / sqrt(far2)), 1.0);
      clip.z = deep.z / deep.w * clip.w;
      gl_Position = clip;

      vAir = aAir;
      // Where the light is from the world, as the camera sees it.
      vToward = normalize((viewMatrix * vec4(aLight - aCenter.xyz, 0.0)).xyz);
    }
  `,

  fragmentShader: /* glsl */ `
    #define RINGS ${AIR_RINGS}
    #define MASK_STOPS ${AIR_MASK_STOPS}
    #define RIM_STOPS ${AIR_RIM_STOPS}

    uniform float uCalm;
    uniform float uBloomMask;
    uniform vec3 uUnder;
    uniform vec3 uRings[RINGS];
    uniform float uRingCount;
    uniform vec2 uMask[MASK_STOPS];
    uniform vec3 uRim;
    uniform vec3 uRimStops[RIM_STOPS];
    uniform vec2 uRimMix;
    uniform vec3 uDusk;

    varying vec2 vP;
    flat varying vec3 vAir;
    flat varying vec3 vToward;

    // The picture so far, and how much of what is behind it still shows.
    vec3 paint;
    float keep = 1.0;

    void over(vec3 color, float alpha) {
      paint = mix(paint, color, alpha);
      keep *= 1.0 - alpha;
    }

    // How much of a pixel lies within reach of an edge dist away: a line one pixel soft.
    float cover(float reach, float dist, float px) {
      return clamp((reach - dist) / px + 0.5, 0.0, 1.0);
    }

    vec3 tone(float which) {
      return which < 0.5
        ? vAir
        : (which < 1.5 ? mix(vAir, vec3(1.0), uRimMix.x) : mix(uDusk, vAir, uRimMix.y));
    }

    void main() {
      paint = uUnder;
      float r = length(vP);
      // One pixel, in radii: the quad faces the screen, so this is the same everywhere on it.
      float px = abs(dFdx(vP.x));
      float live = 1.0 - uCalm;
      // How far round the limb from where the light comes from, in degrees.
      float deg = degrees(acos(clamp(dot(vP / max(r, 1e-4), vToward.xy), -1.0, 1.0)));

      float mask = uMask[MASK_STOPS - 1].y;
      for (int i = MASK_STOPS - 1; i > 0; i -= 1) {
        vec2 a = uMask[i - 1];
        vec2 b = uMask[i];
        if (deg <= b.x) mask = mix(a.y, b.y, clamp((deg - a.x) / (b.x - a.x), 0.0, 1.0));
      }
      float shell = 0.0;
      for (int i = 0; i < RINGS; i += 1) {
        vec3 ring = uRings[i];
        if (float(i) < uRingCount) shell += ring.z * (cover(ring.y, r, px) - cover(ring.x, r, px));
      }
      over(vAir, shell * mask * live);

      vec3 line = tone(uRimStops[RIM_STOPS - 1].y);
      float alpha = uRimStops[RIM_STOPS - 1].z;
      for (int i = RIM_STOPS - 1; i > 0; i -= 1) {
        vec3 a = uRimStops[i - 1];
        vec3 b = uRimStops[i];
        if (deg <= b.x) {
          float k = clamp((deg - a.x) / (b.x - a.x), 0.0, 1.0);
          line = mix(tone(a.y), tone(b.y), k);
          alpha = mix(a.z, b.z, k);
        }
      }
      float wide = max(uRim.z, uRim.y * px);
      over(line, alpha * cover(wide * 0.5, abs(r - uRim.x), px) * live);

      vec3 under = sRGBTransferEOTF(vec4(uUnder, 1.0)).rgb;
      vec3 light = uBloomMask > 0.5
        ? sRGBTransferEOTF(vec4(paint, 1.0)).rgb - keep * under
        : sRGBTransferEOTF(vec4(max(paint - keep * uUnder, 0.0), 1.0)).rgb;
      gl_FragColor = vec4(max(light, 0.0), 1.0 - keep);
      #include <colorspace_fragment>
    }
  `,
};

export const airCloud = {
  vertexShader: /* glsl */ `
    attribute vec4 aCenter;
    attribute vec3 aLight;
    attribute vec3 aCloud;
    attribute vec3 aSky;

    uniform float uTime;
    uniform vec2 uSkin;

    varying vec3 vBall;
    varying vec3 vNormal;
    varying vec3 vToSun;
    flat varying vec3 vCloud;
    flat varying vec2 vSky;

    void main() {
      // The ball turns about the world's axis; the clouds are drawn where they are on the ball.
      float turn = aSky.z + uTime * uSkin.y;
      float c = cos(turn);
      float s = sin(turn);
      vec3 normal = vec3(c * position.x + s * position.z, position.y, c * position.z - s * position.x);
      vec3 world = aCenter.xyz + normal * aCenter.w * uSkin.x;
      vBall = position;
      vNormal = normal;
      vToSun = aLight - world;
      vCloud = aCloud;
      vSky = aSky.xy;
      gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform float uCalm;
    uniform vec4 uField;
    uniform vec3 uFreq;
    uniform float uSoft;
    uniform vec2 uAlpha;
    uniform vec3 uDusk;
    uniform vec3 uNight;
    uniform vec2 uBandEdges;
    uniform int uOctaves;

    varying vec3 vBall;
    varying vec3 vNormal;
    varying vec3 vToSun;
    flat varying vec3 vCloud;
    flat varying vec2 vSky;

    ${gradientNoise}

    // The fractal sum of sim/skyNoise.ts (fbm3), to the last constant, moved by its offset 1.
    float fbm(vec3 q) {
      q += vec3(7.31, 3.17, 5.59);
      float amplitude = 0.5;
      float sum = 0.0;
      float total = 0.0;
      for (int i = 0; i < ${CLOUD_OCTAVES}; i += 1) {
        if (i >= uOctaves) break;
        sum += amplitude * noise3(q);
        total += amplitude;
        q = vec3(
          (0.8 * q.x - 0.6 * q.z + 11.3) * 2.03,
          q.y * 2.03 + 3.7,
          (0.6 * q.x + 0.8 * q.z - 7.1) * 2.03
        );
        amplitude *= 0.5;
      }
      return 0.5 + 0.5 * sum / total;
    }

    // An edge that is soft on purpose: never thinner than a pixel.
    float soft(float value, float edge) {
      float reach = max(uSoft, fwidth(value));
      return smoothstep(edge - reach, edge + reach, value);
    }

    float past(float value, float edge) {
      return clamp((value - edge) / max(fwidth(value), 1e-6) + 0.5, 0.0, 1.0);
    }

    void main() {
      vec3 n = normalize(vBall);
      float seed = vSky.x;
      float field = uField.x * fbm(n * uFreq + seed * vec3(1.0, 0.4, 0.9))
        + uField.y * (0.5 + 0.5 * cos(uField.z * n.y + seed));
      float alpha = mix(uAlpha.x * soft(field, vSky.y), uAlpha.y, soft(field, vSky.y + uField.w));

      // The same three bands as the ground under it.
      float facing = dot(normalize(vNormal), normalize(vToSun));
      vec3 color = mix(
        mix(vCloud * uNight, vCloud * uDusk, past(facing, uBandEdges.x)),
        vCloud,
        past(facing, uBandEdges.y)
      );
      gl_FragColor = vec4(color, alpha * (1.0 - uCalm));
      #include <colorspace_fragment>
    }
  `,
};
