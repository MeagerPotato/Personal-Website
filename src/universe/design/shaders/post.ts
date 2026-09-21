/**
 * POST-PROCESSING: what happens to the finished picture (fx/PostFX.ts runs these).
 *
 * BLOOM BY INVITATION. The usual bloom keys on brightness, which needs a floating-point picture
 * and makes every pale pastel bleed. Here the scene's ALPHA channel is a guest list instead:
 * opaque things write how much they glow into it (shaders/glow.ts: suns, the flame), everything
 * else writes 0, and see-through things leave it alone (materials.ts, `keepBloomMask`). So the
 * picture stays 8 bits per channel, which every phone can do, and only what is invited blooms.
 *
 * The blur is the one from Call of Duty: Advanced Warfare (Jimenez 2014): halve the picture a
 * few times with a 13-tap filter that does not flicker, then walk back up with a 3x3 tent,
 * mixing each level into the next. Wide, soft, and cheap, because most of it happens on tiny
 * pictures.
 *
 * Every pass draws one triangle that covers the screen. Uniform names are the contract with
 * logic: tInput, uTexel (one texel of tInput), tBase, uRadius, tScene, tBloom, uBloomStrength,
 * uVignette, uVignetteRange. Define MASKED: multiply by the guest list.
 */
const fullscreenVertex = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const bloomDown = {
  vertexShader: fullscreenVertex,
  fragmentShader: /* glsl */ `
    uniform sampler2D tInput;
    uniform vec2 uTexel;
    varying vec2 vUv;

    vec3 tap(float x, float y) {
      vec4 texel = texture2D(tInput, vUv + uTexel * vec2(x, y));
      #ifdef MASKED
        return texel.rgb * texel.a;
      #else
        return texel.rgb;
      #endif
    }

    void main() {
      vec3 center = tap(0.0, 0.0);
      vec3 inner = tap(-1.0, 1.0) + tap(1.0, 1.0) + tap(-1.0, -1.0) + tap(1.0, -1.0);
      vec3 edges = tap(0.0, 2.0) + tap(-2.0, 0.0) + tap(2.0, 0.0) + tap(0.0, -2.0);
      vec3 corners = tap(-2.0, 2.0) + tap(2.0, 2.0) + tap(-2.0, -2.0) + tap(2.0, -2.0);
      gl_FragColor = vec4(center * 0.125 + inner * 0.125 + edges * 0.0625 + corners * 0.03125, 1.0);
      #include <colorspace_fragment>
    }
  `,
};

export const bloomUp = {
  vertexShader: fullscreenVertex,
  fragmentShader: /* glsl */ `
    uniform sampler2D tInput;
    uniform sampler2D tBase;
    uniform vec2 uTexel;
    uniform float uRadius;
    varying vec2 vUv;

    vec3 tap(float x, float y) {
      return texture2D(tInput, vUv + uTexel * vec2(x, y)).rgb;
    }

    void main() {
      vec3 blurred =
        tap(0.0, 0.0) * 4.0 +
        (tap(0.0, 1.0) + tap(-1.0, 0.0) + tap(1.0, 0.0) + tap(0.0, -1.0)) * 2.0 +
        (tap(-1.0, 1.0) + tap(1.0, 1.0) + tap(-1.0, -1.0) + tap(1.0, -1.0));
      vec3 base = texture2D(tBase, vUv).rgb;
      gl_FragColor = vec4(mix(base, blurred / 16.0, uRadius), 1.0);
      #include <colorspace_fragment>
    }
  `,
};

export const composite = {
  vertexShader: fullscreenVertex,
  fragmentShader: /* glsl */ `
    uniform sampler2D tScene;
    uniform sampler2D tBloom;
    uniform float uBloomStrength;
    uniform float uVignette;
    uniform vec2 uVignetteRange;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 q = fract(vec3(p.xyx) * 0.1031);
      q += dot(q, q.yzx + 33.33);
      return fract((q.x + q.y) * q.z);
    }

    void main() {
      vec3 color = texture2D(tScene, vUv).rgb + texture2D(tBloom, vUv).rgb * uBloomStrength;

      // Measured in screen shares, so the vignette has the shape of the screen: the middle of
      // an edge is 0.5 away, a corner 0.71, on a phone as on a cinema display.
      float shade = smoothstep(uVignetteRange.x, uVignetteRange.y, length(vUv - 0.5));
      color *= 1.0 - uVignette * shade;

      gl_FragColor = vec4(color, 1.0);
      #include <colorspace_fragment>
      // Half a step of noise, in display space: no bands in the glow or the corners.
      gl_FragColor.rgb += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
    }
  `,
};
