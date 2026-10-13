/**
 * NOISE for the shaders that draw light with structure ("Deep light", docs/DESIGN.md): gradient
 * noise on an integer lattice, hashed with pcg3d. Integer hashing gives the same lattice on
 * every driver, so the CPU twin (sim/gradientNoise.ts, `noise3`: the same function, to the last
 * constant) says what the GPU draws, and a test can hold the picture to its numbers.
 *
 * A chunk, not a shader: a fragment shader brings it in on a line of its own and calls
 * `noise3(vec3)`: about -1 to 1, smooth, with features one unit across.
 */
export const gradientNoise = /* glsl */ `
  const vec3 NOISE_GRAD[12] = vec3[12](
    vec3(1, 1, 0), vec3(-1, 1, 0), vec3(1, -1, 0), vec3(-1, -1, 0),
    vec3(1, 0, 1), vec3(-1, 0, 1), vec3(1, 0, -1), vec3(-1, 0, -1),
    vec3(0, 1, 1), vec3(0, -1, 1), vec3(0, 1, -1), vec3(0, -1, -1)
  );

  uint pcg3d(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z;
    return v.x;
  }

  float noiseGrad(ivec3 i, vec3 f) {
    return dot(NOISE_GRAD[pcg3d(uvec3(i + 4096)) % 12u], f);
  }

  float noise3(vec3 p) {
    vec3 ip = floor(p);
    vec3 f = p - ip;
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    ivec3 i = ivec3(ip);
    float a = noiseGrad(i, f);
    float b = noiseGrad(i + ivec3(1, 0, 0), f - vec3(1, 0, 0));
    float c = noiseGrad(i + ivec3(0, 1, 0), f - vec3(0, 1, 0));
    float d = noiseGrad(i + ivec3(1, 1, 0), f - vec3(1, 1, 0));
    float e = noiseGrad(i + ivec3(0, 0, 1), f - vec3(0, 0, 1));
    float g = noiseGrad(i + ivec3(1, 0, 1), f - vec3(1, 0, 1));
    float h = noiseGrad(i + ivec3(0, 1, 1), f - vec3(0, 1, 1));
    float k = noiseGrad(i + ivec3(1, 1, 1), f - vec3(1, 1, 1));
    return mix(
      mix(mix(a, b, u.x), mix(c, d, u.x), u.y),
      mix(mix(e, g, u.x), mix(h, k, u.x), u.y),
      u.z
    ) * 1.15;
  }
`;
