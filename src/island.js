import * as THREE from "three";
import { SKY_GLSL } from "./shaders.js";

// The backdrop: a Tahitian headland seen from the lineup. Everything is generated here from a seed (no image files).
//
//   terrainHeight(x, z)  metres above sea level at local (x, z). Local +z faces the camera (the scene places the island group
//                        2400 m ahead of the camera and moves it with the camera along the wave, so it never gets closer).
//   buildIsland(uniforms) a Group: the terrain (one indexed grid mesh, shaded by a procedural shader), a row of palms along the
//                        shore (one merged mesh), both sharing the sky uniforms so the haze and the light follow the look.
//
// What it is made of, front to back (see terrainHeight): a wave-washed rock shelf with white water at sea level, a dark rock
// band, a steep fluted green wall (ridged noise stretched down the slope, so parallel ridges and gullies run from the crest to
// the shore), a jagged main crest of varied height, and a lower far range 5 km out that fades into the haze. The look (greens,
// rock, foam, light, haze) is computed per pixel in the shader from height, slope and noise.

export const ISLAND = {
  halfWidth: 4200,
  zBack: -3600,
  zShore: 760, // mean shoreline (local z)
  zFront: 760 + 90, // the mesh ends under the water
  columns: 260,
  rows: 64,
  offsetX: -420,
  seaY: -0.55, // the ocean plane's height
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export function mulberry(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// 2D value noise, 0..1
function noise2(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const noise1 = (x, seed) => noise2(x, 0.37, seed);
// 0..1 with a sharp crest where the noise passes 0.5: summits are cusps, valleys are rounded
const ridge = (n) => 1 - Math.abs(2 * n - 1);

// Ridged fractal along one axis: octaves of ridge(noise), each twice the frequency and half the weight. 0..1.
function ridged1(x, seed, octaves) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * ridge(noise1(x * f, seed + o * 7));
    norm += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return sum / norm;
}

/** The shoreline's local z at x: capes and bays. */
export function shorelineZ(x) {
  return ISLAND.zShore + 85 * (noise1(x * 0.0016, 3) - 0.5) * 2 + 35 * (noise1(x * 0.007, 4) - 0.5) * 2;
}

/** Height of the main crest line at x (m above sea level) and the z it runs along. */
export function crestAt(x) {
  const ax = Math.abs(x) / ISLAND.halfWidth;
  const L = 1 - smooth(0.42, 0.98, ax);
  const peaks = ridged1(x * 0.00095 + 4.7, 11, 3);
  const height = (300 + 640 * Math.pow(peaks, 1.25) + 140 * ridged1(x * 0.0035 + 9, 12, 2)) * (0.22 + 0.78 * L);
  const z = -700 + 380 * (noise1(x * 0.0006, 5) - 0.5) * 2;
  return { height, z };
}

/** Metres above sea level at local (x, z). Negative values are under water. */
export function terrainHeight(x, z) {
  const { halfWidth, zBack } = ISLAND;
  const ax = Math.abs(x) / halfWidth;
  const L = 1 - smooth(0.42, 0.98, ax);
  const s = shorelineZ(x) - z; // metres inland from the shoreline (negative: offshore)

  // shelf and rock band at the shore: a platform the surf washes (0 to 12 m over 100 m), then rock rising to about 70 m.
  // The camera sits a few metres above the sea, so a shore this far away is seen almost edge on: the foam and the rock are
  // given enough height to show as bands (12 m of foam at 1.7 km is about 4 pixels, the rock band about 20).
  const shelf = 12 * smooth(0, 100, s) + 60 * smooth(100, 380, s);

  // flutes: ridged noise stretched down the slope (long in z), domain-warped so the ridges curve and fork
  const warp = 2.2 * noise2(x * 0.002, z * 0.002, 21);
  const u = x * 0.0085 + warp;
  const v = z * 0.0007;
  const f1 = ridge(noise2(u, v, 22));
  const f2 = ridge(noise2(u * 2.7 + 5, v * 2.3, 23));
  const flute = 0.62 * f1 + 0.38 * f2;

  // the main mountain: height C at the crest, falling to the shore (front) and more gently away behind the crest
  const crest = crestAt(x);
  const t = clamp((z - crest.z) / (shorelineZ(x) - crest.z), 0, 1);
  let mountain;
  if (z >= crest.z) {
    const base = crest.height * Math.pow(1 - t, 0.95);
    const gullies = crest.height * 0.2 * Math.pow(1 - f1, 3) * (1 - t) * (1 - t);
    mountain = base * (0.74 + 0.5 * flute) - gullies;
  } else {
    mountain = crest.height * Math.exp(-(crest.z - z) / 520) * (0.78 + 0.44 * flute);
  }
  const inland = smooth(120, 760, s);
  let h = shelf + Math.max(0, mountain) * inland;

  // a lower far range, 5 km out, with its own jagged crest
  const farCrest = (230 + 420 * ridged1(x * 0.0011 + 33, 41, 3)) * (0.3 + 0.7 * L);
  const far = farCrest * Math.exp(-(((z + 2800) / 520) ** 2)) * (0.8 + 0.4 * f2);
  h = Math.max(h, far);

  // everything sinks under the sea at the ends and at the back, so no edge is ever seen
  const edge = Math.max(smooth(0.88, 1.0, ax), smooth(zBack + 700, zBack, z));
  h -= 450 * edge;
  // offshore of the shoreline: a slope down under the water (never coplanar with the sea)
  if (s < 0) h = -5 * smooth(0, 90, -s) + h * (1 - smooth(0, 30, -s));
  return h;
}

// ---------------------------------------------------------------------------------------------------------------------
// terrain mesh

function buildTerrainGeometry() {
  const { halfWidth, zBack, zFront, columns, rows } = ISLAND;
  const nx = columns + 1;
  const nz = rows + 1;
  const pos = new Float32Array(nx * nz * 3);
  const D = zFront - zBack;
  for (let j = 0; j < nz; j++) {
    // rows crowd toward the shore: spacing about 4 m at the waterline and 120 m at the far end
    const z = zFront - D * Math.pow(j / rows, 1.8);
    for (let i = 0; i < nx; i++) {
      const x = -halfWidth + (i / columns) * 2 * halfWidth;
      const o = (j * nx + i) * 3;
      pos[o] = x;
      pos[o + 1] = terrainHeight(x, z);
      pos[o + 2] = z;
    }
  }
  const index = new Uint32Array(columns * rows * 6);
  let k = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // counter-clockwise seen from above (+y): columns run along +x, rows from the front (large z) to the back
      index[k++] = a;
      index[k++] = b;
      index[k++] = c;
      index[k++] = b;
      index[k++] = d;
      index[k++] = c;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

const TERRAIN_VERTEX = /* glsl */ `
  varying vec3 vL;
  varying vec3 vN;
  varying vec3 vW;
  void main(){
    vL = position;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

// Colours are linear. Height vH (m above sea level) and slope decide rock, forest and meadow; noise at four scales breaks
// the canopy up; the sun lights what faces it (the camera looks toward the sun, so most of the island is backlit and gets
// sky light, with foliage glowing where light comes through it); distance and low altitude add haze toward the sky colour.
const TERRAIN_FRAGMENT = /* glsl */ `
  ${SKY_GLSL}
  varying vec3 vL;
  varying vec3 vN;
  varying vec3 vW;
  float h2(vec2 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * (p.x + p.y)); }
  float vn(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main(){
    vec3 N = normalize(vN);
    float H = vL.y;
    vec2 q = vL.xz;
    float n1 = vn(q * 0.011);
    float n2 = vn(q * 0.045 + 11.0);
    float n3 = vn(q * 0.19 + 3.0);
    float n4 = vn(q * 0.9 + 7.0);
    float canopy = n1 * 0.38 + n2 * 0.32 + n3 * 0.2 + n4 * 0.1;
    vec3 L = normalize(uSunDir);
    float ndl = dot(N, L);
    float slope = 1.0 - clamp(N.y, 0.0, 1.0); // 0 flat, 1 vertical

    // forest: deep green in the folds, brighter green on the lit crowns, yellow-green meadow on high gentle ground
    vec3 deep = vec3(0.004, 0.026, 0.010);
    vec3 mid = vec3(0.016, 0.075, 0.020);
    vec3 crown = vec3(0.060, 0.150, 0.030);
    vec3 grass = vec3(0.150, 0.230, 0.045);
    vec3 veg = mix(deep, mid, smoothstep(0.30, 0.62, canopy));
    float lit = clamp(ndl * 1.4 + 0.15, 0.0, 1.0);
    veg = mix(veg, crown, smoothstep(0.42, 0.78, canopy) * (0.35 + 0.65 * lit));
    float meadow = smoothstep(180.0, 520.0, H + (n2 - 0.5) * 220.0) * smoothstep(0.55, 0.85, n3 + n1 * 0.3) * (1.0 - smoothstep(0.35, 0.6, slope));
    veg = mix(veg, grass, meadow * (0.4 + 0.6 * lit));
    // fluting shows as light and dark bands down the slope: the gullies are darker
    veg *= 0.78 + 0.5 * smoothstep(0.25, 0.75, n1 + (n3 - 0.5) * 0.3);

    // bare rock on cliffs and on the crest
    float rockAmt = smoothstep(0.42, 0.66, slope + (n3 - 0.5) * 0.22 + (n4 - 0.5) * 0.1) + smoothstep(620.0, 900.0, H) * 0.5;
    vec3 rock = mix(vec3(0.050, 0.044, 0.038), vec3(0.120, 0.100, 0.082), n2);
    vec3 albedo = mix(veg, rock, clamp(rockAmt, 0.0, 1.0));

    // the shore: dark wet rock below about 45 m, white water on the shelf at sea level
    float shoreBand = 1.0 - smoothstep(55.0, 110.0, H + (n2 - 0.5) * 40.0);
    albedo = mix(albedo, vec3(0.020, 0.019, 0.018) + 0.02 * n3, shoreBand);
    float foam = 1.0 - smoothstep(6.0, 15.0, H + (n3 - 0.5) * 9.0 + (n4 - 0.5) * 3.0);
    float foamStreak = 0.65 + 0.35 * vn(vec2(q.x * 0.35, q.y * 0.05));
    foam *= foamStreak;

    // light: sky ambient from the hemisphere (blue above, dark green below), sun wrapped around the form, light through leaves
    vec3 amb = mix(vec3(0.006, 0.018, 0.010), uMid * 0.5 + uHor * 0.18, N.y * 0.5 + 0.5);
    vec3 sun = uSunCol * uGlare * 1.9;
    float wrap = clamp((ndl + 0.35) / 1.35, 0.0, 1.0);
    vec3 V = normalize(cameraPosition - vW);
    float toSun = pow(clamp(dot(-V, L), 0.0, 1.0), 3.0);
    float leaf = (1.0 - rockAmt) * (1.0 - shoreBand);
    vec3 col = albedo * (amb * 0.7 + sun * wrap * 0.85);
    col += albedo * vec3(1.0, 1.0, 0.45) * sun * toSun * leaf * (1.0 - clamp(ndl, 0.0, 1.0)) * 0.55;
    col = mix(col, vec3(1.0, 1.0, 0.98) * (0.55 + 0.7 * uGlare) * (0.8 + 0.2 * (uSunCol.r + uSunCol.g + uSunCol.b) / 3.0), foam);

    // haze: thickens with distance, thinner on the high ground, and thin at the waterline so the dark rock band reads
    vec3 toP = vW - cameraPosition;
    float dist = length(toP);
    vec3 dir = toP / dist;
    float hz = 1.0 - exp(-dist * 0.00017);
    hz *= (1.0 - 0.22 * smoothstep(0.0, 700.0, H)) * mix(0.6, 1.0, smoothstep(0.0, 140.0, H));
    hz = clamp(hz, 0.0, 0.9);
    gl_FragColor = vec4(min(mix(col, hazeCol(dir), hz), vec3(8.0)), 1.0);
  }`;

// ---------------------------------------------------------------------------------------------------------------------
// palms

// One palm: a curved tapered trunk and a crown of drooping fronds, as triangles in a flat position array.
function pushPalm(out, base, rand) {
  const height = 55 + rand() * 25; // about three times a real coconut palm (20 to 30 m): at 1.9 km they are 20 to 30 pixel silhouettes and must read
  const lean = (rand() - 0.5) * 0.45;
  const leanDir = rand() * Math.PI * 2;
  const trunkR = 1.3 + rand() * 0.6;
  const rings = 5;
  const sides = 5;
  const pts = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const bend = lean * height * t * t;
    pts.push([base[0] + Math.cos(leanDir) * bend, base[1] - 1.5 + t * (height + 1.5), base[2] + Math.sin(leanDir) * bend, trunkR * (1 - 0.45 * t)]);
  }
  const trunkCol = [0.020, 0.015, 0.010];
  for (let r = 0; r < rings; r++) {
    for (let k = 0; k < sides; k++) {
      const a0 = (k / sides) * Math.PI * 2;
      const a1 = ((k + 1) / sides) * Math.PI * 2;
      const p0 = pts[r];
      const p1 = pts[r + 1];
      const v = [
        [p0[0] + Math.cos(a0) * p0[3], p0[1], p0[2] + Math.sin(a0) * p0[3]],
        [p0[0] + Math.cos(a1) * p0[3], p0[1], p0[2] + Math.sin(a1) * p0[3]],
        [p1[0] + Math.cos(a0) * p1[3], p1[1], p1[2] + Math.sin(a0) * p1[3]],
        [p1[0] + Math.cos(a1) * p1[3], p1[1], p1[2] + Math.sin(a1) * p1[3]],
      ];
      for (const tri of [[0, 1, 2], [1, 3, 2]]) for (const i of tri) out.push(...v[i], ...trunkCol);
    }
  }
  const top = pts[rings];
  const fronds = 9 + Math.floor(rand() * 3);
  const segs = 4;
  for (let f = 0; f < fronds; f++) {
    const yaw = (f / fronds) * Math.PI * 2 + rand() * 0.4;
    const reach = 15 + rand() * 8;
    const drop = 8 + rand() * 9;
    const wid = 2.6 + rand() * 1.3;
    const shade = 0.75 + rand() * 0.5;
    const col = [0.020 * shade, 0.085 * shade, 0.022 * shade];
    const dx = Math.cos(yaw);
    const dz = Math.sin(yaw);
    // the strip's sideways axis: horizontal, perpendicular to the frond
    const sx = -dz;
    const sz = dx;
    const edge = [];
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      const along = reach * t;
      const w = wid * Math.sin(Math.PI * Math.pow(t, 0.7)) * 0.5 + 0.05;
      const cx = top[0] + dx * along;
      const cy = top[1] + 1.2 * Math.sin(t * Math.PI * 0.6) - drop * t * t;
      const cz = top[2] + dz * along;
      edge.push([[cx - sx * w, cy, cz - sz * w], [cx + sx * w, cy, cz + sz * w]]);
    }
    for (let k = 0; k < segs; k++) {
      const [l0, r0] = edge[k];
      const [l1, r1] = edge[k + 1];
      for (const tri of [[l0, r0, l1], [r0, r1, l1]]) for (const p of tri) out.push(...p, ...col);
    }
  }
}

const PALM_VERTEX = /* glsl */ `
  attribute vec3 aCol;
  varying vec3 vCol;
  varying vec3 vW;
  void main(){
    vCol = aCol;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const PALM_FRAGMENT = /* glsl */ `
  ${SKY_GLSL}
  varying vec3 vCol;
  varying vec3 vW;
  void main(){
    vec3 L = normalize(uSunDir);
    vec3 V = normalize(cameraPosition - vW);
    float toSun = pow(clamp(dot(-V, L), 0.0, 1.0), 3.0);
    // palms are mostly silhouettes: dark trunks, and fronds that glow yellow-green where the sun (ahead of the camera) comes through them
    vec3 col = vCol * (uMid * 0.7 + 0.25) + vCol * vec3(1.0, 1.0, 0.35) * uSunCol * uGlare * toSun * 10.0;
    vec3 toP = vW - cameraPosition;
    float dist = length(toP);
    float hz = clamp((1.0 - exp(-dist * 0.00017)) * 0.7, 0.0, 0.9);
    gl_FragColor = vec4(min(mix(col, hazeCol(toP / dist), hz), vec3(8.0)), 1.0);
  }`;

/**
 * Palm positions: clustered on the terrace above the surf and the rock, 200 to 340 m inland from the shoreline, where the
 * ground is 20 to 110 m above the sea (palms stand against the lighter, hazier forest behind them, not against the dark
 * rock). Returns [[x, y, z], ...] in local coordinates.
 */
export function palmSites(seed = 77) {
  const rand = mulberry(seed);
  const sites = [];
  let x = -3300;
  while (x < 3300) {
    const gap = 28 + rand() * 80;
    // clusters: a slow noise decides where palms grow thick and where the shore is bare
    const density = noise1(x * 0.0021, 61);
    x += gap * (density > 0.38 ? 1 : 3.2);
    const z = shorelineZ(x) - (200 + rand() * 140);
    const y = terrainHeight(x, z);
    if (y < 20 || y > 110) continue;
    sites.push([x, y, z]);
  }
  return sites;
}

function buildPalmGeometry() {
  const rand = mulberry(1234);
  const flat = [];
  for (const site of palmSites()) pushPalm(flat, site, rand);
  const n = flat.length / 6;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos.set(flat.slice(i * 6, i * 6 + 3), i * 3);
    col.set(flat.slice(i * 6 + 3, i * 6 + 6), i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aCol", new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * The island group. `uniforms` are the scene's shared sky uniforms (uSunDir, uSunCol, uZen, uMid, uHor, uGlare); the group
 * holds references, so applying a look changes the island's light and haze with the sky.
 */
export function buildIsland(uniforms) {
  const shared = {
    uSunDir: uniforms.uSunDir,
    uSunCol: uniforms.uSunCol,
    uZen: uniforms.uZen,
    uMid: uniforms.uMid,
    uHor: uniforms.uHor,
    uGlare: uniforms.uGlare,
  };
  const terrain = new THREE.Mesh(
    buildTerrainGeometry(),
    new THREE.ShaderMaterial({ uniforms: shared, vertexShader: TERRAIN_VERTEX, fragmentShader: TERRAIN_FRAGMENT, side: THREE.FrontSide }),
  );
  terrain.name = "island-terrain";
  const palms = new THREE.Mesh(
    buildPalmGeometry(),
    new THREE.ShaderMaterial({ uniforms: shared, vertexShader: PALM_VERTEX, fragmentShader: PALM_FRAGMENT, side: THREE.DoubleSide }),
  );
  palms.name = "island-palms";
  const group = new THREE.Group();
  group.name = "island";
  group.add(terrain, palms);
  group.position.set(ISLAND.offsetX, ISLAND.seaY, 0);
  return group;
}
