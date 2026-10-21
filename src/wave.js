/**
 * Analytic barrel cross-section shared by the GPU mesh and the gameplay.
 *
 * Coordinates (the surfer travels toward -Z):
 *   +Y up
 *   +X trough / open face (right arrow, screen-right)
 *   -X wall / lip        (left arrow, screen-left)
 *   d = z - peel. Negative d is still ahead of the breaking section.
 *
 * The section is one continuous curve: channel flats, inner face, lip cap,
 * back of the lip, then the back of the wave. Air is the positive-normal side.
 * Keep the GLSL mirror in WAVE_GLSL in lockstep with the JS below.
 */

export const LP = 38;
export const LC = 12;
export const XF = 70;
export const XB = 70;
const PI = Math.PI;

export function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
export function lerp(a, b, t) {
  return a + (b - a) * t;
}
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Low-frequency lip irregularity, about -1.2..1.2, shared with the shader. */
export function lipBump(d, time) {
  return (
    Math.sin(d * 0.31 + time * 0.33) * 0.55 +
    Math.sin(d * 0.13 + 1.7) * 0.3 +
    Math.sin(d * 0.67 - time * 0.21 + 0.4) * 0.22 +
    Math.sin(d * 1.15 + 2.2) * 0.12
  );
}

export function extraCloseout(worldZ, zones) {
  if (!zones || !zones.length) return 0;
  let c = 0;
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    const lo = Math.min(z.z0, z.z1);
    const hi = Math.max(z.z0, z.z1);
    const enter = smoothstep(lo, lo + 8, worldZ);
    const exit = 1 - smoothstep(hi - 8, hi, worldZ);
    c = Math.max(c, (z.power || 0) * enter * exit);
  }
  return clamp(c, 0, 1);
}

export function waveParams(d, heightScale, curl, tight, time, extraC = 0) {
  const p = clamp(1 + d / LP, 0, 1);
  const c = clamp(clamp(d / LC, 0, 1) + extraC, 0, 1);
  const amp = smoothstep(-190, -95, d) * heightScale;
  const pw = smoothstep(0.12, 1, p) * curl;
  let S = lerp(0.62, 5.72, pw) + 0.35 * c;
  const bump = lipBump(d, time);
  const throwScale = smoothstep(0.18, 0.7, p) * (1 - c * 0.25);
  S += bump * 0.42 * throwScale;
  S = clamp(S, 0.5, 6.05);
  let H = lerp(1.9, 4.4, smoothstep(0, 0.62, p)) * amp * (1 - 0.38 * c);
  H = Math.max(H * (1 + bump * 0.07 * throwScale), 0.02);
  let r0 = H / (1 - Math.cos(Math.min(S, PI)));
  r0 *= lerp(1, 0.74, clamp(tight, 0, 1));
  return { S, r0, H, p, c, amp, bump, tight: clamp(tight, 0, 1) };
}

function wRadius(r0, s) {
  return r0 * (1 - 0.17 * clamp(s - PI, 0, 2.5) / PI);
}

function lipT(P, s) {
  const edge = Math.max(P.S, 0.05);
  let t = lerp(1.6, 0.32, smoothstep(PI * 0.7, edge, s)) * Math.min(1, P.H / 3) + 0.05;
  const lump = 1 + 0.55 * Math.sin(s * 2.7 + P.bump * 3.4) * smoothstep(PI * 0.5, edge, s);
  return t * Math.max(0.4, lump);
}

function wCurve(P, s, off) {
  const r = wRadius(P.r0, s) + off;
  let x = -Math.sin(s) * r;
  let y = P.r0 - Math.cos(s) * r;
  x *= 1 + 0.42 * smoothstep(PI, 1.55 * PI, s);
  y *= 1.06;
  const ledge = P.bump * smoothstep(PI * 0.45, Math.max(P.S - 0.2, 0.5), s) * 0.28 * Math.min(P.H, 5);
  x += Math.cos(s) * ledge;
  y += Math.sin(s) * ledge * 0.35;
  return [x, y];
}

/** Point on the inner face the rider actually stands on (matches the mesh). */
export function facePoint(P, s) {
  const q = wCurve(P, s, 0);
  q[1] += -0.22 * P.H / 4.4 * Math.exp(-Math.abs(q[0]) * 0.35) * (1 - smoothstep(0, 1.2, s));
  return q;
}

export function faceFrame(P, s) {
  const a = facePoint(P, s + 0.02);
  const b = facePoint(P, Math.max(0, s - 0.02));
  let tx = a[0] - b[0];
  let ty = a[1] - b[1];
  const L = Math.hypot(tx, ty) || 1;
  tx /= L;
  ty /= L;
  return { x: facePoint(P, s)[0], y: facePoint(P, s)[1], tx, ty, nx: ty, ny: -tx };
}

export function profile(v, d, heightScale, curl, tight, time, extraC = 0) {
  const P = waveParams(d, heightScale, curl, tight, time, extraC);
  let x;
  let y;
  let thick;
  let seg;
  if (v < 0.14) {
    const u = 1 - v / 0.14;
    x = XF * u * u;
    y = -0.22 * P.H / 4.4 * Math.exp(-x * 0.35) - smoothstep(0.85, 1, u) * 0.8;
    thick = 6;
    seg = 0;
  } else if (v < 0.62) {
    const s = ((v - 0.14) / 0.48) * P.S;
    const q = wCurve(P, s, 0);
    x = q[0];
    y = q[1] + -0.22 * P.H / 4.4 * Math.exp(-Math.abs(q[0]) * 0.35) * (1 - smoothstep(0, 1.2, s));
    thick = lerp(5, lipT(P, s), smoothstep(0, PI * 0.95, s));
    seg = 1 + s / 10;
  } else if (v < 0.66) {
    const a = ((v - 0.62) / 0.04) * PI;
    const t = lipT(P, P.S);
    const pi = wCurve(P, P.S, 0);
    const po = wCurve(P, P.S, t);
    const p1 = wCurve(P, P.S + 0.02, t * 0.5);
    const p0 = wCurve(P, P.S - 0.02, t * 0.5);
    let tx = p1[0] - p0[0];
    let ty = p1[1] - p0[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const mx = (pi[0] + po[0]) * 0.5;
    const my = (pi[1] + po[1]) * 0.5;
    const hx = pi[0] - mx;
    const hy = pi[1] - my;
    const hlen = Math.hypot(hx, hy);
    x = mx + Math.cos(a) * hx + Math.sin(a) * tx * hlen;
    y = my + Math.cos(a) * hy + Math.sin(a) * ty * hlen;
    thick = t;
    seg = 2;
  } else if (v < 0.82) {
    const sTop = Math.min(P.S, PI * 0.97);
    const s = lerp(P.S, sTop, (v - 0.66) / 0.16);
    const q = wCurve(P, s, lipT(P, s));
    x = q[0];
    y = q[1];
    thick = lipT(P, s);
    seg = 3;
  } else {
    const sTop = Math.min(P.S, PI * 0.97);
    const c0 = wCurve(P, sTop, lipT(P, sTop));
    const u = Math.pow(Math.min(1, (v - 0.82) / 0.18), 1.6);
    x = lerp(c0[0], -XB, u);
    y = c0[1] * Math.pow(Math.max(1 - u, 0), 2.4) - smoothstep(0.9, 1, u) * 0.8;
    thick = 6;
    seg = 4;
  }
  return { x, y, thick, seg, P };
}

const PTS = new Float32Array(130 * 2);
const NRM = new Float32Array(130 * 2);
let PTN = 0;

export function sampleProfile(d, heightScale, curl, tight, time, extraC, n = 88) {
  PTN = n;
  for (let i = 0; i <= n; i++) {
    const pr = profile(i / n, d, heightScale, curl, tight, time, extraC);
    PTS[i * 2] = pr.x;
    PTS[i * 2 + 1] = pr.y;
  }
  for (let i = 0; i <= n; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n, i + 1);
    let tx = PTS[i1 * 2] - PTS[i0 * 2];
    let ty = PTS[i1 * 2 + 1] - PTS[i0 * 2 + 1];
    const L = Math.hypot(tx, ty) || 1;
    NRM[i * 2] = ty / L;
    NRM[i * 2 + 1] = -tx / L;
  }
  return n;
}

/** Signed distance against the most recent sampleProfile(). Positive is air. */
export function closestOnSample(x, y) {
  let best = 1e9;
  let sd = 10;
  let nx = 0;
  let ny = 1;
  const n = PTN;
  for (let i = 0; i < n; i++) {
    const ax = PTS[i * 2];
    const ay = PTS[i * 2 + 1];
    const bx = PTS[(i + 1) * 2];
    const by = PTS[(i + 1) * 2 + 1];
    let vx = bx - ax;
    let vy = by - ay;
    const L2 = vx * vx + vy * vy || 1;
    let t = ((x - ax) * vx + (y - ay) * vy) / L2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = ax + vx * t;
    const cy = ay + vy * t;
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < best) {
      best = dist;
      const nnx = NRM[i * 2] * (1 - t) + NRM[(i + 1) * 2] * t;
      const nny = NRM[i * 2 + 1] * (1 - t) + NRM[(i + 1) * 2 + 1] * t;
      const nL = Math.hypot(nnx, nny) || 1;
      const sign = dx * nnx + dy * nny >= 0 ? 1 : -1;
      sd = sign * dist;
      nx = nnx / nL;
      ny = nny / nL;
    }
  }
  return { sd, nx, ny, dist: best };
}

/**
 * Push a world-space point back onto the air side of the wave.
 * Samples the section at the point and just ahead/behind so a fast move
 * cannot tunnel through the lip.
 */
export function pushOutOfWater(pos, peel, cond, time, margin = 0.4) {
  const slices = [0, -1.4, 1.4];
  for (let iter = 0; iter < 4; iter++) {
    let worst = null;
    for (let s = 0; s < slices.length; s++) {
      const z = pos.z + slices[s];
      const d = z - peel;
      const extra = extraCloseout(z, cond.zones);
      sampleProfile(d, cond.height, cond.curl, cond.tight, time, extra, 80);
      const hit = closestOnSample(pos.x, pos.y);
      if (!worst || hit.sd < worst.sd) worst = hit;
    }
    if (!worst || worst.sd >= margin) break;
    const push = margin - worst.sd;
    pos.x += worst.nx * push;
    pos.y += worst.ny * push;
  }
  if (pos.y < 0.28) {
    const d = pos.z - peel;
    const extra = extraCloseout(pos.z, cond.zones);
    sampleProfile(d, cond.height, cond.curl, cond.tight, time, extra, 48);
    const hit = closestOnSample(pos.x, 0.28);
    if (hit.sd > 0.2) pos.y = 0.28;
  }
  return pos;
}

export function tubeFactor(x, y, z, peel, cond, time) {
  const d = z - peel;
  const extra = extraCloseout(z, cond.zones);
  const P = waveParams(d, cond.height, cond.curl, cond.tight, time, extra);
  if (P.S < 3.45) return 0;
  const inside = Math.hypot(x, y - P.r0) < P.r0 * 1.18 ? 1 : 0;
  return inside * smoothstep(3.45, 5.15, P.S) * (1 - smoothstep(1, 4, d) * 0.4);
}

/** GLSL twin of the functions above. Uses uniforms declared by the caller. */
export const WAVE_GLSL = /* glsl */ `
#define PI 3.14159265
const float LP = 38.0;
const float LC = 12.0;
const float XF = 70.0;
const float XB = 70.0;

float lipBump(float d){
  return sin(d * 0.31 + uTime * 0.33) * 0.55
       + sin(d * 0.13 + 1.7) * 0.30
       + sin(d * 0.67 - uTime * 0.21 + 0.4) * 0.22
       + sin(d * 1.15 + 2.2) * 0.12;
}
float bandC(float z, float a, float b, float p){
  float lo = min(a, b);
  float hi = max(a, b);
  float enter = smoothstep(lo, lo + 8.0, z);
  float exit = 1.0 - smoothstep(hi - 8.0, hi, z);
  return p * enter * exit;
}
float extraC(float worldZ){
  float c = 0.0;
  c = max(c, bandC(worldZ, uC0.x, uC1.x, uCp.x));
  c = max(c, bandC(worldZ, uC0.y, uC1.y, uCp.y));
  c = max(c, bandC(worldZ, uC0.z, uC1.z, uCp.z));
  c = max(c, bandC(worldZ, uC0.w, uC1.w, uCp.w));
  return clamp(c, 0.0, 1.0);
}
struct WP { float S; float r0; float H; float p; float c; float amp; float bump; };
WP waveParams(float d){
  WP P;
  P.p = clamp(1.0 + d / LP, 0.0, 1.0);
  P.c = clamp(clamp(d / LC, 0.0, 1.0) + extraC(d + uPeel), 0.0, 1.0);
  P.amp = smoothstep(-190.0, -95.0, d) * uHeight;
  float pw = smoothstep(0.12, 1.0, P.p) * uCurl;
  P.bump = lipBump(d);
  float throwScale = smoothstep(0.18, 0.7, P.p) * (1.0 - P.c * 0.25);
  P.S = mix(0.62, 5.72, pw) + 0.35 * P.c + P.bump * 0.42 * throwScale;
  P.S = clamp(P.S, 0.5, 6.05);
  P.H = max(mix(1.9, 4.4, smoothstep(0.0, 0.62, P.p)) * P.amp * (1.0 - 0.38 * P.c) * (1.0 + P.bump * 0.07 * throwScale), 0.02);
  P.r0 = P.H / (1.0 - cos(min(P.S, PI)));
  P.r0 *= mix(1.0, 0.74, clamp(uTight, 0.0, 1.0));
  return P;
}
float wRadius(float r0, float s){ return r0 * (1.0 - 0.17 * clamp(s - PI, 0.0, 2.5) / PI); }
float lipT(WP P, float s){
  float edge = max(P.S, 0.05);
  float t = mix(1.6, 0.32, smoothstep(PI * 0.7, edge, s)) * min(1.0, P.H / 3.0) + 0.05;
  float lump = 1.0 + 0.55 * sin(s * 2.7 + P.bump * 3.4) * smoothstep(PI * 0.5, edge, s);
  return t * max(0.4, lump);
}
vec2 wCurve(WP P, float s, float off){
  float r = wRadius(P.r0, s) + off;
  vec2 q = vec2(-sin(s) * r, P.r0 - cos(s) * r);
  q.x *= 1.0 + 0.42 * smoothstep(PI, 1.55 * PI, s);
  q.y *= 1.06;
  float ledge = P.bump * smoothstep(PI * 0.45, max(P.S - 0.2, 0.5), s) * 0.28 * min(P.H, 5.0);
  q.x += cos(s) * ledge;
  q.y += sin(s) * ledge * 0.35;
  return q;
}
vec4 profile(float v, float d){
  WP P = waveParams(d);
  vec2 q; float thick; float seg;
  if (v < 0.14) {
    float u = 1.0 - v / 0.14;
    q.x = XF * u * u;
    q.y = -0.22 * P.H / 4.4 * exp(-q.x * 0.35) - smoothstep(0.85, 1.0, u) * 0.8;
    thick = 6.0; seg = 0.0;
  } else if (v < 0.62) {
    float s = (v - 0.14) / 0.48 * P.S;
    q = wCurve(P, s, 0.0);
    q.y += -0.22 * P.H / 4.4 * exp(-abs(q.x) * 0.35) * (1.0 - smoothstep(0.0, 1.2, s));
    thick = mix(5.0, lipT(P, s), smoothstep(0.0, PI * 0.95, s));
    seg = 1.0 + s / 10.0;
  } else if (v < 0.66) {
    float a = (v - 0.62) / 0.04 * PI;
    float t = lipT(P, P.S);
    vec2 pi = wCurve(P, P.S, 0.0);
    vec2 po = wCurve(P, P.S, t);
    vec2 tg = normalize(wCurve(P, P.S + 0.02, t * 0.5) - wCurve(P, P.S - 0.02, t * 0.5));
    vec2 m = (pi + po) * 0.5;
    vec2 h = pi - m;
    q = m + cos(a) * h + sin(a) * tg * length(h);
    thick = t; seg = 2.0;
  } else if (v < 0.82) {
    float sTop = min(P.S, PI * 0.97);
    float s = mix(P.S, sTop, (v - 0.66) / 0.16);
    q = wCurve(P, s, lipT(P, s));
    thick = lipT(P, s); seg = 3.0;
  } else {
    float sTop = min(P.S, PI * 0.97);
    vec2 c0 = wCurve(P, sTop, lipT(P, sTop));
    float u = pow(min(1.0, (v - 0.82) / 0.18), 1.6);
    q.x = mix(c0.x, -XB, u);
    q.y = c0.y * pow(max(1.0 - u, 0.0), 2.4) - smoothstep(0.9, 1.0, u) * 0.8;
    thick = 6.0; seg = 4.0;
  }
  return vec4(q, thick, seg);
}
`;
