/**
 * THE SKY: the backdrop behind everything, and the stars on it.
 *
 * Both are "infinitely far". Their vertex shaders drop the camera's translation (only its
 * rotation is used), so flying never brings a star closer, and they write depth = 1.0 exactly
 * (`z = w`), so every planet, however distant, is drawn in front of them whatever the far plane.
 */

/**
 * Backdrop: navy that is a little lighter along the horizon (the galactic plane), plus a few very
 * large, very soft glows of colour at fixed places in the sky. Glows, not noise clouds: on a
 * calm dark sky procedural noise reads as mud, and the eye finds its lattice at once. Dark
 * gradients band badly in 8 bits, so the end adds half a code value of noise in display space.
 *
 * Uniforms: uBloomMask (shared, see materials.ts), uDeep, uHorizon (linear colours),
 * uHorizonFalloff, and per glow (GLOW_COUNT of them)
 * uGlowDirection (unit vector), uGlowColor (linear, already scaled by its strength) and
 * uGlowTightness (higher = smaller).
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

    varying vec3 vDirection;

    float hash12(vec2 p) {
      vec3 q = fract(vec3(p.xyx) * 0.1031);
      q += dot(q, q.yzx + 33.33);
      return fract((q.x + q.y) * q.z);
    }

    void main() {
      vec3 direction = normalize(vDirection);
      vec3 color = mix(uDeep, uHorizon, exp(-abs(direction.y) * uHorizonFalloff));

      for (int i = 0; i < GLOW_COUNT; i += 1) {
        float facing = max(dot(direction, uGlowDirection[i]), 0.0);
        color += uGlowColor[i] * pow(facing, uGlowTightness[i]);
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

/**
 * Stars: one draw call of soft round points.
 *
 * Attributes: aSize (CSS px), aPhase, aTwinkle (0 or 1), aColor (linear, brightness baked in).
 * Uniforms: uTime, uPixelRatio, uTwinkleDepth, uOpacity.
 */
export const stars = {
  vertexShader: /* glsl */ `
    attribute float aSize;
    attribute float aPhase;
    attribute float aTwinkle;
    attribute vec3 aColor;

    uniform float uTime;
    uniform float uPixelRatio;
    uniform float uTwinkleDepth;
    uniform float uOpacity;

    varying vec3 vColor;
    varying float vAlpha;

    void main() {
      vColor = aColor;
      float wave = 0.5 + 0.5 * sin(uTime * (0.7 + aPhase * 1.3) + aPhase * 6.2831853);
      vAlpha = (1.0 - aTwinkle * uTwinkleDepth * wave) * uOpacity;

      // The model matrix carries the slow drift of the whole sky; the view matrix only turns.
      vec3 direction = mat3(viewMatrix) * (mat3(modelMatrix) * position);
      vec4 clip = projectionMatrix * vec4(direction, 1.0);
      clip.z = clip.w;
      gl_Position = clip;
      gl_PointSize = aSize * uPixelRatio;
    }
  `,

  fragmentShader: /* glsl */ `
    varying vec3 vColor;
    varying float vAlpha;

    void main() {
      float disc = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5));
      gl_FragColor = vec4(vColor, disc * vAlpha);
      #include <colorspace_fragment>
    }
  `,
};
