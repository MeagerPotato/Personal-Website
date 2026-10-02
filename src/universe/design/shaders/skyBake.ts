import { fullscreenVertex } from './post';

/**
 * THE SKY'S BAKE: what one texel of the sky's panorama holds (world/SkyBake.ts draws it once,
 * after the first frame, a band of rows a frame; shaders/sky.ts then reads it every frame).
 *
 * The panorama is an equal-area cylinder: u is the azimuth (atan(x, z)) over a full turn plus a
 * half, v is (y + 1) / 2. RGB is the light the sky ADDS to the navy; alpha is how much of a star
 * survives behind the gas there (1 = clear sky). The picture: below the horizon each system has a
 * MASSIF of gas, three flat ridgelines receding (far = hazy and light, near = dark and crisp), a
 * thin lit line on each crest and, behind the far one, a glow in flat steps in the system's
 * colour. Across the sky a Milky Way with a dark lane, far galaxies, old blast arcs and knots of
 * gas. Depth is layering: this noise is only ever baked, limited (a ceiling on luminance, a calm
 * strip along the horizon) and lit, never run per frame.
 *
 * sim/skyOracle.ts is this program on the CPU, expression for expression: the tests hold the sky
 * to its gates with it, and the lab compares the two texel by texel. CHANGE THEM TOGETHER. The
 * noise hashes integers, so every driver computes the same lattice.
 *
 * `constants` (design/skyRecipe.ts) is `tuning.look.sky` as GLSL: the numbers, the tables (RA, RB,
 * RK the ridges; PA, PB, PF the pools; G* the galaxies; A* the arcs; K* the knots) and a tier's
 * `#define`s: SEC_MASSIF, SEC_BAND, SEC_FAR (galaxies, arcs, knots) keep a section; NO_RELIEF,
 * NO_WISP, NO_RAG2 leave a detail of the massifs out.
 *
 * Uniforms: uDeep, uHorizon (linear: the navy's two ends) and uFalloff (backdrop.horizonFalloff);
 * uRamp[24] (linear: six families of gas, four tones each: deep, mid, lit, rim); uStar[4]
 * (linear: cool, warm, hot, amber); uLoop[5] (how many galaxies, arcs, knots, ridges and pools:
 * uniforms, because with constant counts Direct3D's compiler unrolls the loops and takes seconds
 * longer). Geometry: the one triangle that covers the target (shaders/post.ts).
 */
export const skyBake = {
  vertexShader: fullscreenVertex,
  fragmentShader: (constants: string): string => /* glsl */ `
    uniform vec3 uDeep;
    uniform vec3 uHorizon;
    uniform float uFalloff;
    uniform vec3 uRamp[24];
    uniform vec3 uStar[4];
    uniform int uLoop[5];
    varying vec2 vUv;

    ${constants}

    const float RAD = 0.017453292519943295;
    // The 12 edge midpoints of a cube: the gradients.
    const vec3 G12[12] = vec3[12](vec3(1,1,0), vec3(-1,1,0), vec3(1,-1,0), vec3(-1,-1,0), vec3(1,0,1), vec3(-1,0,1), vec3(1,0,-1), vec3(-1,0,-1), vec3(0,1,1), vec3(0,-1,1), vec3(0,1,-1), vec3(0,-1,-1));

    // pcg3d, its first output: three integers to one well-mixed one.
    uint pcg(uvec3 v) {
      v = v * 1664525u + 1013904223u;
      v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
      v ^= v >> 16u;
      v.x += v.y * v.z;
      return v.x;
    }
    float grad(ivec3 i, vec3 f) { return dot(G12[pcg(uvec3(i + 4096)) % 12u], f); }
    // Gradient noise in about -1 to 1, quintic fade.
    float noise3(vec3 p) {
      vec3 ip = floor(p), f = p - ip, u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
      ivec3 i = ivec3(ip);
      ivec2 o = ivec2(0, 1);
      vec2 w = vec2(o);
      return mix(
        mix(mix(grad(i, f), grad(i + o.yxx, f - w.yxx), u.x), mix(grad(i + o.xyx, f - w.xyx), grad(i + o.yyx, f - w.yyx), u.x), u.y),
        mix(mix(grad(i + o.xxy, f - w.xxy), grad(i + o.yxy, f - w.yxy), u.x), mix(grad(i + o.xyy, f - w.xyy), grad(i + 1, f - 1.0), u.x), u.y),
        u.z) * 1.15;
    }
    // A fractal sum in about 0 to 1: each octave twice as fine, half as strong, and turned.
    float fbm(vec3 p, int oct, float off) {
      vec3 q = p + off * vec3(7.31, 3.17, 5.59);
      float a = 0.5, sum = 0.0, nrm = 0.0;
      for (int i = 0; i < 6; i++) {
        if (i >= oct) break;
        sum += a * noise3(q); nrm += a;
        q = vec3((0.8 * q.x - 0.6 * q.z + 11.3) * 2.03, q.y * 2.03 + 3.7, (0.6 * q.x + 0.8 * q.z - 7.1) * 2.03);
        a *= 0.5;
      }
      return 0.5 + 0.5 * sum / nrm;
    }
    // The same sum at d scaled by s (x, y, z) and moved by o.
    float fbm(vec3 d, vec3 s, vec3 o, int oct, float off) { return fbm(d * s + o, oct, off); }
    float ss(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
    // steps flat levels, with edges soft wide (0 hard, 1 smooth).
    float post(float d, float steps, float soft) {
      float s = clamp(d, 0.0, 1.0) * steps, k = floor(s), w = 0.04 + 0.46 * soft;
      return min((k + ss(0.5 - w, 0.5 + w, s - k)) / steps, 1.0);
    }
    float wrap180(float a) { return mod(a + 180.0, 360.0) - 180.0; }
    vec3 ramp(int fam, int tone) { return uRamp[fam * 4 + tone]; }
    float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    float sq(float x) { return x * x; }

    vec4 bake(vec3 d) {
      float az = atan(d.x, d.z) / RAD, el = asin(clamp(d.y, -1.0, 1.0)) / RAD;
      vec3 navy = mix(uDeep, uHorizon, exp(-abs(d.y) * uFalloff)), tot = navy;
      float occ = 1.0;

      #ifdef SEC_MASSIF
      if (el < 4.0 && el > -62.0) {
        float ce = max(0.35, cos(el * RAD));
        float wAz = (fbm(d, vec3(WARP_FREQ, 0.4, WARP_FREQ), vec3(1.7, 8.3, 2.9), 2, 0.0) - 0.5) * 2.0 * WARP_AZ;
        // A ragged push sideways on top of the slow one, for whose gas a texel is and how much
        // of it: without it a massif ends, and its glow with it, along one azimuth, straight up
        // the sky. (Not for the crests: a crest is a height by azimuth, and this would fold it.)
        float ragAz = RAG_AZ > 0.0 ? (fbm(d, vec3(RAG_AZ_FREQ), vec3(6.3, 9.4, 2.6), 3, 4.0) - 0.5) * 2.0 * RAG_AZ : 0.0;
        float best = 0.0, second = 0.0, oU = 0.0;
        int owner = -1;
        for (int j = 0; j < uLoop[4]; j++) {
          float u = wrap180(az + wAz + ragAz - PA[j].x) * ce / PA[j].z;
          float inf = exp(-u * u * POOL_FALL) * PA[j].w;
          if (inf > best) { second = best; best = inf; owner = j; oU = u; } else if (inf > second) second = inf;
        }
        float body = clamp(best - second * SEAM, 0.0, 1.0);
        if (body > 0.004 && owner >= 0) {
          vec4 pa = PA[owner], pb = PB[owner];
          ivec2 pf = PF[owner];
          // The pool's family, with its second one blotched in.
          float alt = ss(0.66 - pb.z * 0.6, 0.74, fbm(d, vec3(2.4), vec3(9.1, 2.2, 4.4), 2, 0.0));
          vec3 deep = mix(ramp(pf.x, 0), ramp(pf.y, 0), alt), mid = mix(ramp(pf.x, 1), ramp(pf.y, 1), alt);
          vec3 lit = mix(ramp(pf.x, 2), ramp(pf.y, 2), alt), rim = mix(ramp(pf.x, 3), ramp(pf.y, 3), alt);
          // Ragged detail on every crest, in degrees of elevation.
          float e = el + (fbm(d, vec3(RAG_FREQ, RAG_FREQ * 1.6, RAG_FREQ), vec3(4.4, 1.2, 9.9), 3, 0.0) - 0.5) * 2.0 * RAG;
          #ifndef NO_RAG2
          e += (fbm(d, vec3(RAG2_FREQ, RAG2_FREQ * 1.5, RAG2_FREQ), vec3(8.8, 3.2, 1.9), 2, 1.0) - 0.5) * 2.0 * RAG2;
          #endif
          // The massif sinks away at its ends.
          float a = (az + wAz) * RAD, ca = cos(a), sa = sin(a), sink = (1.0 - body) * DROP;
          float top[3];
          for (int k = 0; k < uLoop[3]; k++) {
            float fq = RA[k].z, fk = float(k);
            float n1 = fbm(vec3(ca * fq + pb.x * (1.0 + fk * 0.37), sa * fq + pb.x * 0.61, 2.7 + fk * 3.1), 5, fk);
            float rid = 1.0 - abs(2.0 * fbm(vec3(ca * fq * 1.7 + pb.x, sa * fq * 1.7 + 4.1 * fk, 7.3 + fk), 3, 1.0) - 1.0);
            top[k] = pa.y + RA[k].x * pb.y + RA[k].y * pb.y * ((0.7 * n1 + 0.3 * rid * rid - 0.4) * 2.0) - sink;
          }

          // The glow above the far crest: brightest just above it, in flat steps.
          float dA = e - top[0], up = max(dA, 0.0);
          float fil = 1.0 - GLOW_FIL + GLOW_FIL * (fbm(d, vec3(6.5, 1.3, 6.5), vec3(3.3, 1.1, 6.1), 3, 0.0) * 1.7 - 0.25);
          float heart = HEART * exp(-(oU * oU) / 0.06) * exp(-up / (GLOW_H * 1.6));
          float g0 = clamp((body * exp(-oU * oU * GLOW_LAT * 1.6) * exp(-up / GLOW_H) * fil + heart * body) * GLOW_GAIN * 1.15, 0.0, 1.0) * ss(-1.5, 1.2, dA);
          float gq = post(g0, GLOW_STEPS, GLOW_SOFT);
          float wsp = 0.0;
          #ifndef NO_WISP
          // Steam off the far crest: ridged noise stretched upward.
          wsp = ss(0.8, 0.95, 1.0 - abs(2.0 * fbm(d, vec3(15.0, 2.1, 15.0), vec3(2.2, 7.7, 5.1), 3, 3.0) - 1.0)) * exp(-up / 3.4) * ss(-0.3, 0.6, dA) * body * WISP;
          #endif
          vec3 gc = mix(mix(deep, mid, ss(0.1, 0.5, gq)), lit, ss(0.55, 0.95, gq));
          // The pinprick of heat at the pool's heart, in a star tint.
          gc = mix(gc, uStar[pf.x == 0 ? 2 : 3] * 0.5, clamp(heart * body * 2.4, 0.0, 1.0) * ss(0.45, 0.9, gq) * HEART_MIX);
          gc = mix(gc, lit, wsp);
          float glow = ss(0.02, 0.2, g0);
          vec3 acc = mix(navy, gc, max(glow, wsp * 0.9));

          // The three ridges, far to near: a flat body, a lit crest, a soft light under it.
          float dmax = 0.0, lumps = 0.0;
          #ifndef NO_RELIEF
          // Lumps inside the bodies, lit on their upper side: one noise against itself a tap higher.
          vec3 rs = vec3(RELIEF_FREQ, RELIEF_FREQ * 1.35, RELIEF_FREQ), ro = vec3(3.9, 6.2, 7.4);
          lumps = clamp((fbm(d, rs, ro, RELIEF_OCT, 2.0) - fbm(d + vec3(0.0, RELIEF_TAP, 0.0), rs, ro, RELIEF_OCT, 2.0)) * 22.0, 0.0, 1.0);
          #endif
          for (int k = 0; k < uLoop[3]; k++) {
            float dr = top[k] - e, m = ss(-RA[k].w, RA[k].w, dr), fk = float(k);
            if (m <= 0.001) continue;
            vec3 first = k == 0 ? vec3(1.0) : vec3(0.0);
            // Darker with each step nearer; the far one takes a little of the glow behind it.
            vec3 bc = navy * (0.8 - 0.1 * fk) + mix(deep * RB[k].z, mid * RB[k].z * 0.55 + deep * RB[k].z * 0.6, first);
            acc = mix(acc, bc + acc * (0.34 - 0.12 * fk) * first, m);
            acc = mix(acc, mix(mid, lit, 0.6), (1.0 - ss(0.0, RB[k].y, dr)) * m * SOFT_RIM * RK[k] * 0.8);
            acc = mix(acc, mix(lit, rim, RB[k].w), clamp((1.0 - ss(0.0, RB[k].x, dr)) * m * RIM_GAIN * (0.45 + 0.55 * RK[k]) * (0.4 + 0.6 * body), 0.0, 1.0));
            acc = mix(acc, mix(mid, lit, 0.5), lumps * ss(0.2, 1.4, dr) * (1.0 - ss(3.0, 11.0, dr)) * RK[k] * RELIEF * m);
            dmax = max(dmax, m);
          }
          // A family's loudness (mint is the brightest, so it is turned down).
          tot = mix(tot, navy + (acc - navy) * pb.w, max(glow, dmax));
          occ = 1.0 - 0.95 * dmax - 0.3 * ss(0.1, 0.6, g0) * (1.0 - dmax);
        }
      }
      #endif

      #ifdef SEC_BAND
      {
        // The Milky Way: a great circle of haze, a dark lane meandering through it, a warm bulge.
        float t = BAND_A.x * RAD, pa = BAND_A.y * RAD;
        vec3 pole = vec3(sin(t) * sin(pa), cos(t), sin(t) * cos(pa));
        float sb = dot(d, pole), lb = asin(clamp(sb, -1.0, 1.0)) / RAD;
        if (abs(lb) < BAND_A.z * 3.0) {
          vec3 pr = d - pole * sb;
          float lon = wrap180(atan(pr.x, pr.z) / RAD - BAND_A.w);
          float clump = fbm(d, vec3(3.1, 4.4, 3.1), vec3(5.5, 1.5, 8.1), 4, 0.0);
          float lc = 1.2 + (fbm(d, vec3(1.7, 2.4, 1.7), vec3(2.5, 4.5, 0.5), 2, 0.0) - 0.5) * 7.0;
          float lw = 1.6 + 1.3 * fbm(d, vec3(2.8, 3.8, 2.8), vec3(8.5, 7.5, 2.5), 2, 1.0);
          float lane = exp(-sq((lb - lc) / lw));
          float bd = clamp(exp(-sq(lb / BAND_A.z)) * (0.18 + 1.2 * clump) * BAND_GAIN, 0.0, 1.0), bq = post(bd, 4.0, BAND_SOFT);
          vec3 v = mix(ramp(5, 0), ramp(5, 1), ss(0.05, 0.5, bq));
          v = mix(v, ramp(5, 2), ss(0.45, 0.85, bq) * 0.5);
          v = mix(v, ramp(5, 3), exp(-sq(lon / BAND_CORE)) * 0.35 * ss(0.6, 1.0, bq));
          v *= 1.0 - 0.82 * lane * ss(0.1, 0.4, bq);
          float bcover = ss(0.0, 0.25, bd) * 0.95;
          tot = mix(tot, max(tot, v), bcover);
          occ = min(occ, 1.0 - 0.55 * bcover * lane);
        }
      }
      #endif

      #ifdef SEC_FAR
      // Far galaxies: small ellipses in star tints; a lens has a dark lane, a spiral two arms.
      for (int i = 0; i < uLoop[0]; i++) {
        float cd = dot(d, GC[i]);
        if (cd < GK[i].y) continue;
        vec3 pp = d - GC[i] * cd;
        float uu = dot(pp, GE1[i]) / RAD, vv = dot(pp, GE2[i]) / RAD;
        float x = uu * GP[i].z + vv * GP[i].w, y = -uu * GP[i].w + vv * GP[i].z;
        float ga = GP[i].x, gb = GP[i].x * GP[i].y, r2 = sq(x / ga) + sq(y / gb);
        if (r2 > 6.0) continue;
        float o = 0.55 * exp(-r2 * 1.1) + 0.9 * exp(-r2 * 9.0);
        if (GK[i].x == 1.0) o *= 1.0 - 0.8 * exp(-sq(y / (gb * 0.16))) * ss(0.05, 0.6, 1.0 - min(1.0, r2 / 1.2));
        else if (GK[i].x == 2.0) { float rr = sqrt(r2); o *= 0.55 + 0.7 * (0.5 + 0.5 * cos(2.0 * atan(y / gb, x / ga) - 5.5 * log(rr + 0.15))) * ss(0.0, 0.5, rr); }
        o = min(o, 1.3);
        if (o > 0.002) tot += mix(uStar[0], uStar[1], pow(o, 1.4)) * o * 0.5;
      }
      // Arcs: thin bright rings, bent and broken along their length.
      for (int i = 0; i < uLoop[1]; i++) {
        float w = AP[i].w, off = acos(clamp(dot(d, AC[i]), -1.0, 1.0)) / RAD - AP[i].x;
        if (abs(off) > w * 7.0) continue;
        float th = mod(atan(dot(d, AE2[i]), dot(d, AE1[i])) / RAD + 360.0, 360.0);
        float span = ss(AP[i].y, AP[i].y + 14.0, th) * (1.0 - ss(AP[i].z - 14.0, AP[i].z, th));
        if (span <= 0.002) continue;
        float sd = AQ[i].y;
        float o2 = off + (fbm(d, vec3(5.0), vec3(sd, 2.1, 1.7), 3, 0.0) - 0.5) * w * 3.0;
        float line = exp(-sq(o2 / w)) + 0.28 * exp(-sq(o2 / (w * 4.2)));
        float brk = ss(0.28, 0.6, fbm(d, vec3(9.0), vec3(sd, 5.5, 0.0), 3, 1.0));
        int fm = int(AQ[i].z + 0.5);
        tot += mix(ramp(fm, 2), ramp(fm, 3), 0.5) * (line * span * brk * AQ[i].x * ARC_AMT * 3.2);
      }
      // Knots: a ragged clump in flat steps, and a point of heat.
      for (int i = 0; i < uLoop[2]; i++) {
        float kd = dot(d, KC[i]);
        if (kd < cos(KP[i].x * 2.4 * RAD)) continue;
        float kang = acos(clamp(kd, -1.0, 1.0)) / RAD / KP[i].x;
        float kv = clamp(1.0 - (kang + (fbm(d, vec3(14.0), vec3(KP[i].y, 1.9, 4.3), 3, 0.0) - 0.5) * 0.9) / 1.7, 0.0, 1.0), kq = post(kv, 3.0, 0.35);
        int fm = int(KP[i].z + 0.5);
        vec3 kc = mix(mix(ramp(fm, 0), ramp(fm, 1), ss(0.1, 0.5, kq)), ramp(fm, 2), ss(0.55, 0.95, kq));
        kc = mix(kc, ramp(fm, 3), exp(-kang * kang * 14.0) * 0.7);
        tot = mix(tot, max(tot, kc), ss(0.02, 0.2, kv) * 0.9);
      }
      #endif

      // Added light = total - navy, faded toward the horizon (an edge that is not a ruler), then
      // a soft knee at the ceiling.
      vec3 add = max(tot - navy, 0.0);
      add *= ss(STRIP0, STRIP1, abs(el) + (fbm(d, vec3(2.2, 0.6, 2.2), vec3(12.1, 0.0, 3.3), 2, 0.0) - 0.5) * 9.0);
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
