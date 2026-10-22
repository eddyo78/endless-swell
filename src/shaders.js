import { WAVE_GLSL } from "./wave.js";

export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uZen;
uniform vec3 uMid;
uniform vec3 uHor;
uniform float uGlare;
vec3 skyCol(vec3 dir){
  float y = dir.y;
  float yy = max(y, 0.0);
  vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.18, yy));
  col = mix(col, uZen, smoothstep(0.15, 0.9, yy));
  float sd = max(dot(dir, uSunDir), 0.0);
  col += vec3(0.55, 0.72, 1.0) * (pow(sd, 8.0) * 0.04 + pow(sd, 40.0) * 0.055) * uGlare;
  col += uSunCol * pow(sd, 220.0) * 0.42 * uGlare;
  col = mix(col, uHor * 0.35 + vec3(0.01, 0.03, 0.05), smoothstep(0.0, -0.08, y));
  return col;
}
vec3 hazeCol(vec3 dir){
  vec3 d = normalize(vec3(dir.x, max(dir.y, 0.0) * 0.4 + 0.015, dir.z));
  return skyCol(d) * 0.92;
}
`;

const FBM = /* glsl */ `
float hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

export const skyDome = {
  vertex: /* glsl */ `
    varying vec3 vDir;
    void main(){
      vDir = normalize(position);
      vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position = p.xyww;
    }`,
  fragment: /* glsl */ `
    ${SKY_GLSL}
    varying vec3 vDir;
    void main(){ gl_FragColor = vec4(min(skyCol(normalize(vDir)), vec3(8.0)), 1.0); }
  `,
};

export const cloud = {
  vertex: /* glsl */ `
    varying vec2 vUv; varying vec3 vW; attribute float seed; varying float vSeed;
    void main(){
      vUv = uv; vSeed = seed;
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragment: /* glsl */ `
    ${SKY_GLSL}
    ${FBM}
    varying vec2 vUv; varying vec3 vW; varying float vSeed; uniform float uTime;
    void main(){
      vec2 q = vUv * 2.0 - 1.0;
      vec3 p = vec3(q.x * 3.2, q.y * 1.6, vSeed * 7.0 + uTime * 0.012);
      float shape = 1.0 - length(vec2(q.x, max(q.y + 0.15, 0.0) * 1.6));
      shape *= smoothstep(-0.95, -0.55, q.y);
      float n = fbm(p * 1.3);
      float n2 = fbm(p * 4.0 + 3.0);
      float dens = shape + (n - 0.5) * 0.9 + (n2 - 0.5) * 0.35;
      float a = smoothstep(0.05, 0.25, dens);
      if (a < 0.01) discard;
      float lit = smoothstep(-0.7, 0.6, q.y + (n2 - 0.5) * 0.6);
      vec3 base = vec3(0.42, 0.50, 0.62) * 1.15;
      vec3 top = vec3(1.0, 0.99, 0.97) * 1.55;
      vec3 col = mix(base, top, lit);
      col += uSunCol * 0.12 * (1.0 - smoothstep(0.05, 0.35, dens)) * uGlare;
      vec3 dir = normalize(vW - cameraPosition);
      col = mix(col, hazeCol(dir), 0.28);
      gl_FragColor = vec4(col, a * (0.55 + 0.45 * uGlare));
    }`,
};

const WATER_UNIFORMS_GLSL = /* glsl */ `
uniform float uTime;
uniform float uHeight;
uniform float uCurl;
uniform float uTight;
uniform float uPeel;
uniform vec4 uC0;
uniform vec4 uC1;
uniform vec4 uCp;
uniform float uSpit;
uniform float uDetail;
uniform float uWind;
uniform sampler2D tNormal;
uniform sampler2D tFoam;
`;

export const waterVertex = /* glsl */ `
${WATER_UNIFORMS_GLSL}
${WAVE_GLSL}
attribute vec2 grid;
varying vec3 vWorld;
varying vec3 vN;
varying float vThick;
varying float vFoam;
varying float vTube;
varying float vArc;
varying float vCeil;
varying float vY;
void main(){
  float v = grid.x;
  float d = grid.y;
  vec4 P4 = profile(v, d);
  float ev = 0.0012;
  float ed = 0.2;
  vec4 Pv = v < 0.995 ? profile(v + ev, d) : profile(v - ev, d);
  vec4 Pd = profile(v, d + ed);
  vec3 p0 = vec3(P4.xy, d);
  vec3 tv = (vec3(Pv.xy, d) - p0) * (v < 0.995 ? 1.0 : -1.0);
  vec3 td = vec3(Pd.xy, d + ed) - p0;
  vec3 n = normalize(cross(tv, td) + vec3(0.0, 1e-6, 0.0));
  WP W = waveParams(d);
  float seg = P4.w;
  float isInner = step(0.99, seg) * step(seg, 1.9);
  float s = isInner > 0.5 ? (seg - 1.0) * 10.0 : 0.0;
  float sN = s / max(W.S, 0.001);
  vec3 wp0 = (modelMatrix * vec4(p0, 1.0)).xyz;
  float chop = (0.55 + uWind);
  float rip = sin(wp0.z * 0.9 + uTime * 1.3 + P4.y * 1.7) * 0.5 + sin(wp0.z * 2.3 - uTime * 2.1 + P4.x) * 0.3;
  p0 += n * rip * 0.04 * chop * (1.0 - step(3.5, seg));
  float behind = smoothstep(-2.5, 4.0, d);
  float nearW = 1.0 - smoothstep(2.2 + max(d, 0.0) * 0.45, 8.0 + max(d, 0.0) * 1.2, P4.x);
  float foam = behind * nearW * (0.85 + 0.25 * step(seg, 3.5));
  foam += behind * smoothstep(0.0, 10.0, d) * 0.55 * (1.0 - smoothstep(6.0, 36.0, P4.x));
  float lipZone = isInner * smoothstep(0.78, 1.0, sN) + step(1.95, seg) * step(seg, 2.05) + step(2.95, seg) * step(seg, 3.05) * 0.65;
  foam += lipZone * smoothstep(0.28, 0.8, W.p) * 1.05;
  float tipX = wCurve(W, W.S, 0.0).x;
  foam += step(seg, 0.5) * smoothstep(-8.0, -0.4, d) * (1.0 - smoothstep(0.0, 5.5, abs(P4.x - tipX))) * 1.15;
  foam += uSpit * isInner * smoothstep(0.0, 4.0, d + 2.0) * 0.45;
  foam += lipZone * (0.35 + 0.65 * abs(W.bump));
  vFoam = clamp(foam, 0.0, 1.0);
  vThick = P4.z;
  float tubeness = smoothstep(3.35, 5.05, W.S) * (1.0 - behind * 0.35);
  vTube = isInner * tubeness * (0.45 + 0.55 * smoothstep(0.02, 0.28, sN));
  float underLip = step(seg, 0.5) * (1.0 - smoothstep(tipX + 0.4, tipX + 4.5, P4.x)) * tubeness;
  vTube = max(vTube, underLip * 0.9);
  vCeil = isInner * smoothstep(0.32, 0.78, sN) + step(1.9, seg) * step(seg, 2.2) * 0.85;
  vArc = v * 30.0;
  vec4 w = modelMatrix * vec4(p0, 1.0);
  vWorld = w.xyz;
  vY = p0.y;
  vN = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const waterFragment = /* glsl */ `
${SKY_GLSL}
uniform sampler2D tNormal;
uniform sampler2D tFoam;
uniform float uTime;
uniform float uDetail;
varying vec3 vWorld;
varying vec3 vN;
varying float vThick;
varying float vFoam;
varying float vTube;
varying float vArc;
varying float vCeil;
varying float vY;
vec3 nmap(vec2 uv){ return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float facing = dot(N, V);
  if (facing < 0.0) discard;
  float dist = length(cameraPosition - vWorld);
  float flat_ = smoothstep(0.55, 0.9, abs(N.y));
  vec2 uvF = vWorld.xz;
  vec2 uvW = vec2(vWorld.z, vArc);
  vec3 t1 = nmap(uvF * 0.045 + vec2(0.012, 0.02) * uTime) * 0.22 + nmap(uvF * 0.16 + vec2(-0.03, 0.028) * uTime) * 0.5 + nmap(uvF * 0.55 + vec2(0.05, -0.04) * uTime) * 0.62 + nmap(uvF * 1.9 + vec2(-0.07, 0.05) * uTime) * 0.4;
  vec3 t2 = nmap(uvW * vec2(0.12, 0.05) + vec2(0.0, -0.08) * uTime) + nmap(uvW * vec2(0.35, 0.16) + vec2(0.015, -0.16) * uTime) * 0.7 + nmap(uvW * vec2(1.1, 0.5) + vec2(0.0, -0.35) * uTime) * 0.3;
  vec3 tn = mix(t2 * vec3(0.55, 0.55, 1.0), t1, flat_);
  float fade = uDetail / (1.0 + dist * 0.012);
  vec3 Tf = cross(vec3(0.0, 1.0, 0.001), N);
  Tf = length(Tf) > 1e-3 ? normalize(Tf) : vec3(0.0, 0.0, 1.0);
  vec3 T = normalize(mix(Tf, vec3(1.0, 0.0, 0.0) * sign(Tf.x + 1e-4), flat_) + vec3(1e-4));
  vec3 B = normalize(cross(N, T));
  vec3 Nd = normalize(N + (T * tn.x + B * tn.y) * 0.32 * fade);
  float NdV = clamp(dot(Nd, V), 0.0, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, Nd);
  R.y = abs(R.y) * 0.85 + 0.02;
  vec3 refl = skyCol(normalize(R));
  float axial = smoothstep(0.65, 0.97, abs(R.z));
  vec3 tubeRefl = mix(vec3(0.0, 0.045, 0.07), vec3(0.05, 0.62, 0.55), clamp(vCeil, 0.0, 1.0));
  refl = mix(refl, tubeRefl, vTube * (1.0 - axial) * 0.92);
  vec3 L = uSunDir;
  float shadow = 1.0 - vTube * 0.84;
  float thin = exp(-vThick * 0.85);
  float low = 1.0 - clamp(vCeil, 0.0, 1.0);
  vec3 navy = vec3(0.0, 0.015, 0.05);
  vec3 deep = vec3(0.0, 0.035, 0.085);
  vec3 face = vec3(0.0, 0.15, 0.19);
  vec3 glow = vec3(0.03, 0.42, 0.40);
  float thickMix = smoothstep(6.0, 1.15, vThick);
  vec3 body = mix(navy, deep, thickMix);
  body = mix(body, face, thickMix * (1.0 - low * 0.72));
  body = mix(body, glow, clamp(vCeil, 0.0, 1.0) * smoothstep(2.4, 0.35, vThick));
  body = mix(body, navy, smoothstep(2.6, 0.15, vY) * 0.55 * (0.4 + 0.6 * vTube));
  float shoreX = smoothstep(52.0, 6.0, vWorld.x) * smoothstep(-2.0, 3.0, vWorld.x);
  vec2 reefUv = vWorld.xz;
  float reefN = texture2D(tFoam, reefUv * 0.018 + 0.31).r * 0.55 + texture2D(tFoam, reefUv * 0.06 + 0.7).r * 0.45;
  float coral = smoothstep(0.52, 0.64, reefN);
  float sandy = smoothstep(0.46, 0.34, reefN);
  vec3 reefCol = mix(mix(vec3(0.015, 0.2, 0.26), vec3(0.06, 0.44, 0.44), sandy), vec3(0.012, 0.085, 0.08), coral);
  body = mix(body, reefCol * (0.3 + 0.7 * uGlare), shoreX * flat_ * (1.0 - vTube * 0.7) * 0.9);
  body *= 0.4 + 0.6 * shadow;
  float back = pow(clamp(dot(-V, L), 0.0, 1.0), 3.0);
  float wrap = clamp(dot(-N, L) * 0.5 + 0.5, 0.0, 1.0);
  vec3 sssCol = mix(vec3(0.0, 0.45, 0.55), vec3(0.15, 1.0, 0.82), thin);
  vec3 sss = sssCol * uSunCol * thin * (0.1 + 0.55 * back + 0.18 * wrap) * (0.25 + 0.75 * uGlare) * 0.55;
  sss += vec3(0.0, 0.34, 0.38) * smoothstep(3.2, 0.55, vThick) * 0.1 * (0.35 + back) * clamp(vCeil, 0.0, 1.0);
  float rim = smoothstep(1.1, 0.15, vThick) * clamp(vCeil, 0.0, 1.0);
  sss += vec3(0.25, 1.0, 0.8) * uSunCol * rim * (0.22 + 0.9 * back) * (0.3 + 0.7 * uGlare) * 0.8;
  vec3 col = mix(body + sss, refl, F);
  float rl = max(dot(normalize(R), L), 0.0);
  col += uSunCol * (pow(rl, 640.0) * 1.35 + pow(rl, 48.0) * 0.1) * shadow * uGlare * (0.3 + 0.7 * clamp(F * 3.0, 0.0, 1.0));
  if (flat_ > 0.2 && dist < 500.0) {
    vec3 tg = nmap(uvF * 2.6 + vec2(0.09, -0.06) * uTime) + nmap(uvF * 5.3 + vec2(-0.11, 0.08) * uTime) * 0.7;
    vec3 Ng = normalize(N + (T * tg.x + B * tg.y) * 0.55);
    float gl = max(dot(reflect(-V, Ng), L), 0.0);
    float gFade = 1.0 - smoothstep(120.0, 500.0, dist);
    col += uSunCol * pow(gl, 1400.0) * 9.0 * flat_ * gFade * uGlare * (1.0 - vTube);
  }
  float fm = vFoam;
  if (fm > 0.001) {
    vec2 flow = vec2(0.0, -0.11) * uTime;
    float close = smoothstep(0.28, 1.55, dist);
    float detail = mix(4.2, 1.0, smoothstep(0.7, 6.0, dist));
    vec2 fuv = mix(uvW * vec2(0.22, 0.14), uvF * 0.12, flat_) * detail;
    vec4 f1 = texture2D(tFoam, fuv + flow);
    vec4 f2 = texture2D(tFoam, fuv * 2.8 + flow * 1.7 + vec2(0.02, 0.0));
    vec4 f3 = texture2D(tFoam, fuv * 6.4 + vec2(0.0, -0.27) * uTime);
    float n = f1.r * 0.42 + f2.r * 0.34 + f3.r * 0.24;
    float cells = f2.g * 0.55 + f3.g * 0.45;
    float broken = smoothstep(0.4, 0.74, n * 0.6 + cells * 0.58);
    float dif = clamp(dot(Nd, L) * 0.45 + 0.55, 0.0, 1.0);
    vec3 fc = vec3(0.93, 0.98, 1.0) * (0.38 + 0.85 * dif * shadow);
    fc = mix(fc, fc * vec3(0.72, 0.92, 0.95), vTube * 0.45);
    float cover = broken * close * clamp(fm, 0.0, 0.72) * (0.42 + 0.58 * cells);
    col = mix(col, fc, cover);
  }
  float fogA = 1.0 - exp(-dist * 0.00028);
  col = mix(col, hazeCol(-V), fogA);
  gl_FragColor = vec4(min(col, vec3(6.0)), 1.0);
}
`;

export const oceanVertex = /* glsl */ `
varying vec3 vWorld; varying vec3 vN; varying float vThick; varying float vFoam;
varying float vTube; varying float vArc; varying float vCeil; varying float vY;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz; vN = vec3(0.0, 1.0, 0.0);
  vThick = 8.0; vFoam = 0.0; vTube = 0.0; vArc = 0.0; vCeil = 0.0; vY = 0.0;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const spray = {
  vertex: /* glsl */ `
    attribute float aSize; attribute float aAlpha; attribute float aBright; attribute float aSeed;
    uniform float uScale;
    varying float vA; varying float vB; varying float vSoft; varying float vSeed;
    void main(){
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      float ps = aSize * uScale / max(-mv.z, 0.45);
      vSoft = clamp(aSize * 3.0, 0.0, 1.0);
      // anything this close to the lens would draw as a giant out-of-focus ball: fade it out before it gets there
      float near = mix(smoothstep(0.25, 0.8, -mv.z), smoothstep(0.8, 2.4, -mv.z), vSoft);
      vA = aAlpha * near;
      vB = aBright;
      vA *= 1.0 - smoothstep(70.0, 140.0, ps);
      vSeed = aSeed;
      gl_PointSize = min(ps, 96.0);
    }`,
  fragment: /* glsl */ `
    uniform sampler2D tFoam;
    varying float vA; varying float vB; varying float vSoft; varying float vSeed;
    void main(){
      vec2 q = gl_PointCoord * 2.0 - 1.0;
      float r2 = dot(q, q);
      if (r2 > 1.0) discard;
      // drops: a small hard bead with a bright top-left glint
      float bead = smoothstep(1.0, 0.45, r2);
      float glint = smoothstep(0.55, 0.0, length(q - vec2(-0.3, 0.3)));
      float hard = bead * 0.8 + glint * 0.5;
      // mist: a ragged wisp cut from the foam noise, rotated per particle, not a smooth disc
      float ca = cos(vSeed * 6.2832), sa = sin(vSeed * 6.2832);
      vec2 w = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y) * 0.5 + 0.5;
      float n = texture2D(tFoam, w * 0.55 + vec2(vSeed * 3.7, vSeed * 1.9)).r;
      float body = (1.0 - r2);
      float soft = smoothstep(0.3, 0.85, n * 0.95 + body * 0.55 - 0.18) * body;
      float a = mix(hard, min(soft * 1.5, 1.0), vSoft) * vA;
      gl_FragColor = vec4(vec3(0.94, 0.98, 1.0) * vB, a);
    }`,
};

export const wake = {
  vertex: /* glsl */ `
    attribute float aAge; varying vec2 vUv; varying float vAge; varying float vView;
    void main(){
      vUv = uv; vAge = aAge;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vView = -mv.z;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragment: /* glsl */ `
    uniform sampler2D tFoam; uniform float uLight;
    varying vec2 vUv; varying float vAge; varying float vView;
    void main(){
      float across = abs(vUv.x * 2.0 - 1.0);
      float warp = texture2D(tFoam, vec2(vUv.x * 0.7 + 0.13, vUv.y * 0.9)).r - 0.5;
      vec2 wuv = vec2(vUv.x + warp * 0.45, vUv.y);
      float n1 = texture2D(tFoam, vec2(wuv.x * 2.2, wuv.y * 0.55)).r;
      float n2 = texture2D(tFoam, vec2(wuv.x * 5.1 + 0.37, wuv.y * 1.6)).r;
      float c = texture2D(tFoam, vec2(vUv.x * 3.5, vUv.y * 2.2)).g;
      float n = (n1 * 0.55 + n2 * 0.45) * (0.75 + 0.35 * c);
      float band = smoothstep(0.12, 0.45, across) * (1.0 - smoothstep(0.82, 1.0, across));
      float coreNear = (1.0 - smoothstep(0.0, 0.12, vAge)) * (1.0 - smoothstep(0.0, 0.45, across));
      float thr = mix(0.18, 0.5, vAge) + (1.0 - max(band, coreNear)) * 0.16;
      float a = smoothstep(thr - 0.05, thr + 0.2, n) * (1.0 - vAge * vAge) * smoothstep(0.0, 0.015, vAge);
      a = max(a, 0.07 * band * c * (1.0 - vAge) * smoothstep(0.0, 0.015, vAge));
      a *= 1.0 - smoothstep(0.72, 1.0, across);
      a *= smoothstep(2.4, 6.0, vView);
      gl_FragColor = vec4(vec3(0.95, 0.98, 1.0) * (1.15 * uLight), a * 0.62);
    }`,
};

export const grade = {
  vertex: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragment: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDrops;
    uniform float uDistort;
    uniform float uAspect;
    uniform vec2 uSun;
    uniform vec2 uSunDraw;
    uniform float uSunOn;
    uniform float uWhite;
    uniform float uDrops;
    uniform float uTime;
    uniform float uChroma;
    uniform float uFlare;
    varying vec2 vUv;
    vec2 distort(vec2 uv, float k){
      vec2 c = uv - 0.5; c.x *= uAspect;
      float r2 = dot(c, c);
      float rmax = 0.25 * (uAspect * uAspect + 1.0);
      c *= (1.0 + k * r2) / (1.0 + k * rmax);
      c.x /= uAspect;
      return c + 0.5;
    }
    float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    void main(){
      vec2 uv = vUv;
      vec4 dr = texture2D(tDrops, uv * vec2(uAspect, 1.0) * 0.9 + vec2(0.0, uTime * 0.01));
      uv += (dr.xy - 0.5) * 0.08 * uDrops * dr.z;
      vec2 uvR = distort(uv, uDistort * (1.0 + 0.018 * uChroma));
      vec2 uvG = distort(uv, uDistort);
      vec2 uvB = distort(uv, uDistort * (1.0 - 0.018 * uChroma));
      vec3 col = vec3(texture2D(tDiffuse, uvR).r, texture2D(tDiffuse, uvG).g, texture2D(tDiffuse, uvB).b);
      col *= 1.0 + dr.z * uDrops * 0.22;
      if (uSunOn > 0.0 && uFlare > 0.0) {
        float vis = 0.0;
        for (int i = 0; i < 5; i++) {
          vec2 o = vec2(float(i - 2) * 0.004, float((i * 7) % 5 - 2) * 0.004);
          vis += smoothstep(1.6, 8.0, lum(texture2D(tDiffuse, uSun + o).rgb));
        }
        vis = vis / 5.0 * uSunOn * uFlare;
        vec2 sp = uSunDraw;
        vec2 toC = vec2(0.5) - sp;
        vec2 p = (uv - sp) * vec2(uAspect, 1.0);
        float r = length(p);
        float ang = atan(p.y, p.x);
        float rays = pow(abs(sin(ang * 3.0 + 0.4)), 40.0) + pow(abs(sin(ang * 4.0 + 1.1)), 60.0) * 0.5;
        col += vec3(1.0, 0.96, 0.88) * vis * (rays * 0.045 * exp(-r * 16.0) + exp(-r * 48.0) * 0.45 + exp(-r * 7.0) * 0.03);
      }
      vec2 c = vUv - 0.5;
      float edge = 0.35 + 0.7 * vUv.y + 0.4 * dot(c, c);
      col = mix(col, vec3(1.45, 1.5, 1.52) + col * 0.25, clamp(uWhite * edge, 0.0, 0.96));
      col *= 1.0 - 0.34 * smoothstep(0.32, 0.98, length(c * vec2(uAspect, 1.0)) / max(uAspect, 1.0) * 1.25);
      gl_FragColor = vec4(col, 1.0);
    }`,
};
