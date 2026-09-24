/**
 * SPACE DUST: the only thing that tells you that you are moving. Stars are infinitely far, so
 * flying past them changes nothing on screen; these motes are close, so they slide by, and at
 * speed they stretch into streaks.
 *
 * An endless field for free: every mote has a fixed seed inside a box, and the shader wraps it
 * around `uCenter` (the ship). Fly for an hour and the same few hundred motes are always around
 * you. They fade toward the faces of the box, so a mote that wraps never pops.
 *
 * Where in the field the ship is, is `uField`, not `uCenter`: the two move together up to a
 * speed (tuning.dust.maxFieldSpeed), and beyond it the field slides by no faster than that
 * (sim/dustField.ts, fed by world/SpaceDust.ts). At the autopilot's 700 u/s a real field would
 * move 12 u every frame, 23 u on a phone held to 30 fps, and a mote a few units from the camera
 * that jumps that far between two frames is noise, not motion. `uField` is part of this
 * shader's contract: a rewrite of it keeps the wrap round uField and the head at uCenter.
 *
 * A streak is the mote smeared over where it was, relative to the viewer, during the last
 * `uStreakSec`: the segment from its position to position + uVelocity * uStreakSec (the velocity
 * the field slides by), drawn as a soft capsule in view space. At rest the capsule is a round dot.
 * Real view-space positions go to the GPU, so motes behind the camera are clipped for free.
 *
 * Geometry: one quad (position.xy in -1..1), instanced. Instanced attributes: aSeed (0..1 cube),
 * aStyle (x = size factor, y = brightness). Uniforms: uCenter, uField, uBox, uVelocity,
 * uStreakSec, uRadius, uColor, uOpacity.
 */
export const dust = {
  vertexShader: /* glsl */ `
    attribute vec3 aSeed;
    attribute vec2 aStyle;

    uniform vec3 uCenter;
    uniform vec3 uField;
    uniform vec3 uBox;
    uniform vec3 uVelocity;
    uniform float uStreakSec;
    uniform float uRadius;
    uniform float uOpacity;

    varying vec2 vCapsule;
    varying float vHalfLength;
    varying float vAlpha;

    void main() {
      vec3 offset = mod(aSeed * uBox - uField, uBox) - 0.5 * uBox;
      vec3 head = uCenter + offset;
      vec3 a = (viewMatrix * vec4(head, 1.0)).xyz;
      vec3 b = (viewMatrix * vec4(head + uVelocity * uStreakSec, 1.0)).xyz;

      vec2 along = b.xy - a.xy;
      float span = length(along);
      vec2 direction = span > 1e-5 ? along / span : vec2(1.0, 0.0);
      vec2 side = vec2(-direction.y, direction.x);

      float radius = uRadius * aStyle.x;
      vec3 corner = position.x < 0.0 ? a : b;
      corner.xy += (direction * position.x + side * position.y) * radius;
      gl_Position = projectionMatrix * vec4(corner, 1.0);

      // Capsule coordinates in units of the radius: x runs along the streak, y across it.
      vHalfLength = 0.5 * span / radius;
      vCapsule = vec2(position.x * (vHalfLength + 1.0), position.y);

      vec3 edge = abs(offset) / (0.5 * uBox);
      float inside = 1.0 - smoothstep(0.7, 1.0, max(edge.x, max(edge.y, edge.z)));
      // The same light over a longer streak: dimmer, or fast flight would whiten the screen.
      vAlpha = aStyle.y * inside * uOpacity / (1.0 + 0.35 * vHalfLength);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform vec3 uColor;

    varying vec2 vCapsule;
    varying float vHalfLength;
    varying float vAlpha;

    void main() {
      float beyond = max(abs(vCapsule.x) - vHalfLength, 0.0);
      float reach = length(vec2(beyond, vCapsule.y));
      float soft = smoothstep(1.0, 0.25, reach);
      gl_FragColor = vec4(uColor, soft * vAlpha);
      #include <colorspace_fragment>
    }
  `,
};
