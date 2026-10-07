/**
 * HYPERSPACE: a journey's fast stretch, shown as a jump (world/Hyperspace.ts draws these; the
 * flight under them is the same flight). Two draws, both SKY by the backdrop's rule
 * (shaders/sky.ts): directions only, turned by the view and never moved by it, at the far plane
 * (`z = w`). They come after the stars and before everything else, so every planet, the ship,
 * the dust and the orbit lines are in front, and the destination is never smeared.
 *
 * Flat colour and hard edges, like the rest of the world: no blur, no flash, no gradient. Neither
 * blooms: both blend their colour and leave the picture's alpha, the bloom guest list, alone
 * (materials.ts, keepBloomMask).
 */

/**
 * THE TUBE: the walls of the tunnel, round the course. A sphere seen from inside. `rho` is the
 * angle off the course; the walls are bands at equal RATIOS of it (`log(rho) * uBands`), which is
 * what rings at equal distances down a tunnel look like, and `uFlow` slides them outward. In the
 * middle is the eye: the dark the destination grows out of.
 *
 * All of it sits inside an iris that opens from the eye outward with `uOpen`, and shows at
 * `uOpen` of its alpha. Two thin rings are drawn besides: one racing out from the eye
 * (`uPunch`), one closing onto the destination (`uDrop`).
 *
 * Uniforms: uAxis (the course) and uTarget (where the destination is), unit vectors in world
 * space; uOpen (0 to 1: the look's veil); uFlow; uPunch and uDrop (0 to 1 on their way, below 0
 * for none); uBands; uEye (rad); uRibs (0 or 1: the thin line at each band's edge); uWash (the
 * wash's alpha, on every other band); uRibAlpha; uRingAlpha (the rings', already fading);
 * and the linear colours uGround (the eye), uShade (the wash), uLine (the ribs), uInk (the rings).
 */
export const hyperTube = {
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
    uniform vec3 uAxis;
    uniform vec3 uTarget;
    uniform float uOpen;
    uniform float uFlow;
    uniform float uPunch;
    uniform float uDrop;
    uniform float uBands;
    uniform float uEye;
    uniform float uRibs;
    uniform vec2 uWash;
    uniform float uRibAlpha;
    uniform vec2 uRingAlpha;
    uniform vec3 uGround;
    uniform vec3 uShade;
    uniform vec3 uLine;
    uniform vec3 uInk;

    varying vec3 vDirection;

    // How much of a line 'width' px wide a pixel 'px' pixels from its middle is inside.
    float stroke(float px, float width) {
      return 1.0 - smoothstep(0.5 * width - 0.5, 0.5 * width + 0.5, px);
    }

    // The angle between two unit vectors, exact near 0 too (acos of their dot is not).
    float angle(vec3 a, vec3 b) {
      return atan(length(cross(a, b)), dot(a, b));
    }

    void main() {
      vec3 direction = normalize(vDirection);
      float rho = angle(direction, uAxis);
      float pixel = max(fwidth(rho), 1e-6);

      // Bands: a triangle wave over two of them, cut at its middle, one pixel soft.
      float t = log(max(rho, 0.02)) * uBands - uFlow;
      float wave = abs(fract(0.5 * t) - 0.5) * 2.0;
      float soft = max(fwidth(t), 1e-6);
      float cut = (wave - 0.5) / soft;
      float wash = mix(uWash.x, uWash.y, clamp(cut + 0.5, 0.0, 1.0));
      float rib = uRibs * uRibAlpha * stroke(abs(cut), 1.5);

      // The wall: the wash, and the rib over it. (Premultiplied while it is put together.)
      vec4 wall = vec4(uShade * wash, wash);
      wall = vec4(uLine * rib, rib) + wall * (1.0 - rib);
      // The eye covers it, and the iris holds all of it.
      float eye = clamp((uEye - rho) / pixel + 0.5, 0.0, 1.0);
      wall = mix(wall, vec4(uGround, 1.0), eye);
      float iris = clamp((uOpen * 3.2 - rho) / pixel + 0.5, 0.0, 1.0);
      wall *= uOpen * iris;

      // The rings, over everything: 2 px, round the course and round the destination.
      float punch = uPunch < 0.0 ? 0.0 : uRingAlpha.x * stroke(abs(rho - uPunch * 1.3) / pixel, 2.0);
      float toTarget = angle(direction, uTarget);
      float drop = uDrop < 0.0
        ? 0.0
        : uRingAlpha.y * stroke(abs(toTarget - (1.0 - uDrop) * 1.05) / max(fwidth(toTarget), 1e-6), 2.0);
      float ring = max(punch, drop);
      wall = vec4(uInk * ring, ring) + wall * (1.0 - ring);

      gl_FragColor = vec4(wall.a > 0.0 ? wall.rgb / wall.a : vec3(0.0), wall.a);
      #include <colorspace_fragment>
    }
  `,
};

/**
 * A dash runs from this far off the course (as a tangent: 4.6 degrees, just inside the rim of the
 * eye) out to this (69 degrees, past the corner of any screen).
 */
export const DASH_SPAN: readonly [inner: number, outer: number] = [0.08, 2.6];
/**
 * How a dash's place along its ray is bent (1: not at all). Under 1 it leaves the middle sooner:
 * unbent, a quarter of all the dashes would crowd the first tenth of the way out, and the middle
 * of the picture would be white.
 */
export const DASH_EASE = 0.6;

/** A number as GLSL wants a float written: never without its decimal point. */
const glsl = (value: number): string =>
  Number.isInteger(value) ? value.toFixed(1) : String(value);

/**
 * THE DASHES: dots over the stars that stretch into streaks, all pointing away from one spot,
 * and run. One mesh of plain quads, four vertices a dash, not instanced.
 *
 * Each dash lives on a ray in the plane that faces the course (a tangent plane: a point (x, y)
 * of it is the direction (x, y, 1)). Its place along the ray is p, 0 to 1, growing with uFlow at
 * its own rate and wrapping: the head stands DASH_SPAN[0] * (DASH_SPAN[1] / DASH_SPAN[0]) ^
 * (p ^ DASH_EASE) out from the middle, so it speeds up as it comes, as things passing do. The
 * tail reaches uStretch * uLength of the way back to the middle. At uStretch 0 the dash is a
 * round dot of its own width, a star: that is the whole of the wind-up and of the drop-out, and
 * why nothing here touches the real stars. Flat colour, a hard round-ended edge one pixel soft.
 * It comes up over the first fifth of its way (so the eye stays dark, and what the ship is flying
 * to stays clear in it) and goes over the last of it, so a dash that wraps never pops.
 *
 * Geometry: position = (the angle of its ray round the course, rad; its phase, 0 to 1; how bright
 * it is, 0 to 1). aDash = (which end: -1 the tail, +1 the head; which side: -1 or +1; its rate;
 * its tint, 0 to 4).
 * Uniforms: uFrame (mat3 of unit columns: right, up, the course), uFlow, uTwist (a number of the
 * destination's own: each has its own field), uStretch (0 to 1), uAlpha (0 to 1: the look's
 * dots), uLength, uWidth (the width, in the plane's units), uPixel (one device pixel in those
 * units: no dash is thinner), uTint (five linear colours).
 */
export const hyperDashes = {
  vertexShader: /* glsl */ `
    attribute vec4 aDash;

    uniform mat3 uFrame;
    uniform float uFlow;
    uniform float uTwist;
    uniform float uStretch;
    uniform float uAlpha;
    uniform float uLength;
    uniform float uWidth;
    uniform float uPixel;
    uniform vec3 uTint[5];

    varying vec2 vCapsule;
    varying float vHalfLength;
    varying float vAlpha;
    varying vec3 vColor;

    void main() {
      vec2 ray = vec2(cos(position.x), sin(position.x));
      vec2 side = vec2(-ray.y, ray.x);
      float p = fract(position.y + (uFlow + uTwist) * aDash.z);
      float head = ${glsl(DASH_SPAN[0])} * pow(${glsl(DASH_SPAN[1] / DASH_SPAN[0])}, pow(p, ${glsl(DASH_EASE)}));
      float tail = head * (1.0 - uStretch * uLength);
      float halfWidth = 0.5 * max(uWidth, uPixel);

      // Half a width past each end: room for the round caps.
      float along = aDash.x > 0.0 ? head + halfWidth : tail - halfWidth;
      vec2 at = ray * along + side * (aDash.y * halfWidth);
      vec3 direction = uFrame * normalize(vec3(at, 1.0));
      vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * direction, 1.0);
      clip.z = clip.w;
      gl_Position = clip;

      // Capsule coordinates in half widths: x runs along the dash from its middle, y across it.
      vHalfLength = 0.5 * (head - tail) / halfWidth;
      vCapsule = vec2(aDash.x * (vHalfLength + 1.0), aDash.y);
      vAlpha = uAlpha * position.z * smoothstep(0.0, 0.2, p) * (1.0 - smoothstep(0.85, 1.0, p));
      vColor = uTint[int(aDash.w + 0.5)];
    }
  `,

  fragmentShader: /* glsl */ `
    varying vec2 vCapsule;
    varying float vHalfLength;
    varying float vAlpha;
    varying vec3 vColor;

    void main() {
      float beyond = max(abs(vCapsule.x) - vHalfLength, 0.0);
      float reach = length(vec2(beyond, vCapsule.y));
      float soft = max(fwidth(reach), 1e-6);
      float inside = clamp((1.0 - reach) / soft, 0.0, 1.0);
      gl_FragColor = vec4(vColor, inside * vAlpha);
      #include <colorspace_fragment>
    }
  `,
};
