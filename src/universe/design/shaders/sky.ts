/**
 * THE SKY: the backdrop behind everything, and the stars on it.
 *
 * Both are "infinitely far". Their vertex shaders drop the camera's translation (only its
 * rotation is used), so flying never brings a star closer, and they write depth = 1.0 exactly
 * (`z = w`), so every planet, however distant, is drawn in front of them whatever the far plane.
 */

/**
 * Backdrop: navy that is a little lighter along the horizon (the galactic plane), plus THE BAKED
 * SKY: the light of a panorama that was painted once (shaders/skyBake.ts says what is in it, and
 * how it is laid out), added to the navy. One texture fetch a pixel. Noise is only ever baked,
 * limited and lit: run live on a calm dark sky it reads as mud, and the eye finds its lattice.
 * Dark gradients band badly in 8 bits, so the end adds half a code value of noise in display
 * space.
 *
 * Until the panorama is there (it is baked after the first frame), and wherever it cannot be
 * baked at all, the sky is the navy and a few very large, very soft glows of colour at fixed
 * places; they leave as the baked sky arrives (uReveal).
 *
 * Uniforms: uBloomMask (shared, see materials.ts), uDeep, uHorizon (linear colours),
 * uHorizonFalloff; uPano (the panorama: rgb the added light, alpha the star occlusion),
 * uExposure (how much of its light shows: the reveal, less while docked and on the star map) and
 * uReveal (0 the old glows, 1 the baked sky), all three shared with the stars; and per glow
 * (GLOW_COUNT of them) uGlowDirection (unit vector), uGlowColor (linear, already scaled by its
 * strength) and uGlowTightness (higher = smaller).
 */
export const GLOW_COUNT = 4;

export const backdrop = {
  vertexShader: /* glsl */ `
    varying vec3 vDirection;

    void main() {
      vDirection = position;
      vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
      clip.z = clip.w;
      gl_Position = clip;
    }
  `,

  fragmentShader: /* glsl */ `
    #define GLOW_COUNT ${GLOW_COUNT}

    uniform float uBloomMask;
    uniform vec3 uDeep;
    uniform vec3 uHorizon;
    uniform float uHorizonFalloff;
    uniform vec3 uGlowDirection[GLOW_COUNT];
    uniform vec3 uGlowColor[GLOW_COUNT];
    uniform float uGlowTightness[GLOW_COUNT];
    uniform sampler2D uPano;
    uniform float uExposure;
    uniform float uReveal;

    varying vec3 vDirection;

    float hash12(vec2 p) {
      vec3 q = fract(vec3(p.xyx) * 0.1031);
      q += dot(q, q.yzx + 33.33);
      return fract((q.x + q.y) * q.z);
    }

    void main() {
      vec3 direction = normalize(vDirection);
      vec3 color = mix(uDeep, uHorizon, exp(-abs(direction.y) * uHorizonFalloff));

      // The panorama is an equal-area cylinder: azimuth across, the direction's y up.
      vec2 at = vec2(atan(direction.x, direction.z) * 0.15915494 + 0.5, direction.y * 0.5 + 0.5);
      // The azimuth jumps a whole turn at the seam: no derivative of it may pick a level.
      color += textureLod(uPano, at, 0.0).rgb * uExposure;
      if (uReveal < 1.0) {
        for (int i = 0; i < GLOW_COUNT; i += 1) {
          float facing = max(dot(direction, uGlowDirection[i]), 0.0);
          color += uGlowColor[i] * pow(facing, uGlowTightness[i]) * (1.0 - uReveal);
        }
      }

      // Half a step of noise against banding. It has to be added in DISPLAY space, and this
      // shader does not know who encodes for the display: itself (straight to the canvas) or an
      // sRGB render target (post-processing). So: encode, add the noise, decode, and let the
      // usual last line do whatever it does here. The sky is not on the bloom guest list.
      vec4 shown = sRGBTransferOETF(vec4(color, 1.0 - uBloomMask));
      shown.rgb += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
      gl_FragColor = sRGBTransferEOTF(max(shown, 0.0));
      #include <colorspace_fragment>
    }
  `,
};

/** How many kinds of star there are (sim/starList.ts, STAR_KINDS): the length of the tables below. */
export const STAR_KIND_COUNT = 5;

/**
 * Stars: one draw call of instanced quads, a quad a star. Points cannot do this: a point's size
 * is capped by the GPU and a point has no angle, and a hero star has six diffraction spikes.
 *
 * A star is a Gaussian core, up to two wider and fainter halos, and (the mid and hero kinds)
 * spikes: a line through the star whose light falls off along it as
 * (1 - t)^exponent / (1 + taper t), t from 0 at the star to 1 at the tip. The long thin tail is
 * what reads as diffraction and not as a plus sign. A mid star has two such lines (a plus); a
 * hero has three, 60 degrees apart with one upright (six arms, as a hexagonal mirror gives), and
 * a short faint one across (the mirror's struts). All sizes are CSS px; light is ADDED, and the
 * stars are not on the bloom guest list (materials.ts leaves alpha as it was).
 *
 * Geometry: position (a corner of the quad, x and y each -1 or 1). Per instance: aDir (unit
 * direction), aColor (linear, brightness baked in), aStar (kind as in STAR_KINDS, size 0 to 1,
 * phase 0 to 1, twinkle 0 or 1).
 * Uniforms: uTime (s), uView (the view in CSS px), uScale (how much the px sizes below are
 * scaled in this view: x halos and spikes, y cores), uTwinkleDepth, uOpacity, uSpikes (1 flying,
 * 0 on the star map), uBreath (the share by which a hero breathes) and uBreathSec (the slowest
 * and fastest period of that); by kind, uCore (the core's sigma, px), uHalo (sigma and gain of
 * two halos), uArm (length and gain of the spikes, length and gain of the line across) and
 * uThick (the sigma across a spike, and across the line across); uProfile (exponent, taper);
 * uBloomMask (shared, see materials.ts) and uUnder (linear: the navy the stars are added to);
 * uPano and uReveal (shared with the backdrop): a star behind the sky's gas is dimmed by the
 * panorama's alpha there, and one behind a dust body is gone.
 *
 * Light adds up in LINEAR light, and where the picture goes straight to the canvas (no
 * post-processing: uBloomMask 0) the blend happens after encoding, which would make every faint
 * tail a third brighter and every star fatter. There the shader adds the star to the navy it
 * expects under it, encodes, and takes the encoded navy off again: the sum on the screen is
 * then the right one wherever the sky is near that navy.
 */
export const stars = {
  vertexShader: /* glsl */ `
    #define KINDS ${STAR_KIND_COUNT}

    attribute vec3 aDir;
    attribute vec3 aColor;
    attribute vec4 aStar;

    uniform float uTime;
    uniform vec2 uView;
    uniform vec2 uScale;
    uniform float uTwinkleDepth;
    uniform float uOpacity;
    uniform float uSpikes;
    uniform float uBreath;
    uniform vec2 uBreathSec;
    uniform float uCore[KINDS];
    uniform vec4 uHalo[KINDS];
    uniform vec4 uArm[KINDS];
    uniform vec2 uThick[KINDS];
    uniform sampler2D uPano;
    uniform float uReveal;

    varying vec3 vColor;
    varying vec2 vPx;
    varying float vCore;
    varying vec4 vHalo;
    varying vec4 vArm;
    varying vec3 vThick;

    void main() {
      int kind = int(aStar.x + 0.5);
      float hero = step(float(KINDS) - 1.5, aStar.x);
      float turn = aStar.z * 6.2831853;

      float wave = 0.5 + 0.5 * sin(uTime * (0.7 + aStar.z * 1.3) + turn);
      // A hero breathes: its light and the length of its spikes, each star at its own pace.
      float pace = mix(uBreathSec.x, uBreathSec.y, aStar.z);
      float breath = 1.0 + hero * uBreath * sin(uTime * 6.2831853 / pace + turn);
      // The model matrix carries the slow drift of the whole sky; the view matrix only turns.
      vec3 world = mat3(modelMatrix) * aDir;
      // How much of the star the gas in front of it lets through (1 until the sky is baked).
      float clear = mix(1.0, textureLod(uPano, vec2(atan(world.x, world.z) * 0.15915494 + 0.5, world.y * 0.5 + 0.5), 0.0).a, uReveal);
      float seen = (0.65 + 0.35 * clear) * clear * (0.75 + 0.25 * clear);
      vColor = aColor * ((1.0 - aStar.w * uTwinkleDepth * wave) * uOpacity * breath * seen);

      float core = uCore[kind] * uScale.y;
      vec4 halo = uHalo[kind];
      halo.xz *= uScale.x;
      vec4 arm = uArm[kind];
      arm.xz *= uScale.x * aStar.y * breath;
      arm.yw *= uSpikes;

      // Everything past 3.2 sigma (under 0.6 percent of the peak) is left out, and a pixel and a
      // half is added so that no edge of the quad cuts a star.
      float reach = max(max(core, max(halo.x, halo.z)) * 3.2, arm.x) + 1.5;
      vPx = position.xy * reach;
      vCore = 0.5 / (core * core);
      vHalo = vec4(0.5 / (halo.x * halo.x), halo.y, 0.5 / (halo.z * halo.z), halo.w);
      vArm = arm;
      vThick = vec3(0.5 / (uThick[kind] * uThick[kind]), hero);

      vec3 direction = mat3(viewMatrix) * world;
      vec4 clip = projectionMatrix * vec4(direction, 1.0);
      clip.z = clip.w;
      clip.xy += vPx * 2.0 / uView * clip.w;
      gl_Position = clip;
    }
  `,

  fragmentShader: /* glsl */ `
    uniform vec2 uProfile;
    uniform float uBloomMask;
    uniform vec3 uUnder;

    varying vec3 vColor;
    varying vec2 vPx;
    varying float vCore;
    varying vec4 vHalo;
    varying vec4 vArm;
    varying vec3 vThick;

    // One line through the star along a unit vector, reaching len px each way.
    float spike(vec2 axis, float len, float across) {
      float t = min(abs(dot(vPx, axis)) / len, 1.0);
      float off = vPx.x * axis.y - vPx.y * axis.x;
      return pow(1.0 - t, uProfile.x) / (1.0 + uProfile.y * t) * 0.5 * exp(-off * off * across);
    }

    void main() {
      float r2 = dot(vPx, vPx);
      float light = exp(-r2 * vCore) + vHalo.y * exp(-r2 * vHalo.x) + vHalo.w * exp(-r2 * vHalo.z);
      if (vArm.y + vArm.w > 0.0) {
        float arms = spike(vec2(0.0, 1.0), vArm.x, vThick.x);
        if (vThick.z > 0.5) {
          arms += spike(vec2(0.8660254, 0.5), vArm.x, vThick.x);
          arms += spike(vec2(-0.8660254, 0.5), vArm.x, vThick.x);
        }
        light += vArm.y * arms + vArm.w * spike(vec2(1.0, 0.0), vArm.z, vThick.y);
      }
      vec4 under = vec4(uUnder * (1.0 - uBloomMask), 0.0);
      gl_FragColor = vec4(vColor * light, 1.0) + under;
      #include <colorspace_fragment>
      gl_FragColor.rgb -= sRGBTransferOETF(under).rgb;
    }
  `,
};
