import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { skyDome, cloud as cloudShader, waterVertex, waterFragment, oceanVertex, grade } from "./shaders.js";
import { makeNormalTexture, makeFoamTexture, makeDropTexture } from "./textures.js";
import { createSurfer } from "./surfer.js";
import { buildIsland } from "./island.js";
import { Spray, Wake } from "./particles.js";

export const LOOKS = {
  day: {
    zen: [0.003, 0.03, 0.22], mid: [0.03, 0.17, 0.62], hor: [0.3, 0.52, 0.85],
    sun: [1, 0.96, 0.9], glare: 1, elev: 31, az: 9, exposure: 0.9, fog: 0.00016, hemi: 0.25,
  },
  golden: {
    zen: [0.06, 0.08, 0.22], mid: [0.45, 0.28, 0.22], hor: [0.95, 0.58, 0.28],
    sun: [1, 0.72, 0.4], glare: 0.85, elev: 14, az: 18, exposure: 0.98, fog: 0.0002, hemi: 0.3,
  },
  night: {
    zen: [0.0, 0.002, 0.02], mid: [0.01, 0.02, 0.06], hor: [0.03, 0.05, 0.1],
    sun: [0.65, 0.75, 1], glare: 0.22, elev: 22, az: -20, exposure: 0.62, fog: 0.00022, hemi: 0.08,
  },
  storm: {
    zen: [0.01, 0.012, 0.015], mid: [0.05, 0.055, 0.06], hor: [0.16, 0.17, 0.18],
    sun: [0.75, 0.78, 0.8], glare: 0.28, elev: 10, az: 6, exposure: 0.72, fog: 0.00038, hemi: 0.12,
  },
};

function sunVector(elevDeg, azDeg, target) {
  const elev = THREE.MathUtils.degToRad(elevDeg);
  const az = THREE.MathUtils.degToRad(azDeg);
  return target.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev)).normalize();
}

class GradePass extends Pass {
  constructor(drops) {
    super();
    this.uniforms = {
      tDiffuse: { value: null },
      tDrops: { value: drops },
      uDistort: { value: 0.2 },
      uAspect: { value: 1 },
      uSun: { value: new THREE.Vector2(0.5, 0.8) },
      uSunDraw: { value: new THREE.Vector2(0.5, 0.8) },
      uSunOn: { value: 0 },
      uWhite: { value: 0 },
      uDrops: { value: 0 },
      uTime: { value: 0 },
      uChroma: { value: 1 },
      uFlare: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: grade.vertex,
      fragmentShader: grade.fragment,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    if (this.renderToScreen) renderer.setRenderTarget(null);
    else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }
    this.fsQuad.render(renderer);
  }
  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}

function mulberry(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function buildClouds(uniforms) {
  const group = new THREE.Group();
  const rand = mulberry(5);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: uniforms.uSunDir,
      uSunCol: uniforms.uSunCol,
      uZen: uniforms.uZen,
      uMid: uniforms.uMid,
      uHor: uniforms.uHor,
      uGlare: uniforms.uGlare,
      uTime: uniforms.uTime,
    },
    vertexShader: cloudShader.vertex,
    fragmentShader: cloudShader.fragment,
    transparent: true,
    depthWrite: false,
  });
  for (let i = 0; i < 14; i++) {
    const w = 500 + rand() * 900;
    const h = w * (0.35 + rand() * 0.2);
    const geo = new THREE.PlaneGeometry(w, h);
    const seed = rand();
    geo.setAttribute("seed", new THREE.Float32BufferAttribute([seed, seed, seed, seed], 1));
    const mesh = new THREE.Mesh(geo, mat);
    const x = (i / 13 - 0.5) * 7000 + (rand() - 0.5) * 600;
    const z = -(2200 + rand() * 1800);
    mesh.position.set(x, h * 0.45 + 220 + rand() * 160, z);
    mesh.lookAt(0, mesh.position.y, 0);
    group.add(mesh);
  }
  group.userData.mat = mat;
  return group;
}

function buildBoats() {
  const group = new THREE.Group();
  const rand = mulberry(77);
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 });
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.6 });
  const colors = [0x3a2418, 0xcc3333, 0x2c5fa8, 0xeeeeee].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }));
  const boat = (len) => {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(len * 0.36, len * 0.14, len), hullMat);
    const p = hull.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getZ(i) < 0) p.setX(i, p.getX(i) * (0.35 + 0.65 * (1 + p.getZ(i) / (len / 2))));
      if (p.getY(i) < 0) p.setX(i, p.getX(i) * 0.8);
    }
    hull.geometry.computeVertexNormals();
    hull.position.y = len * 0.05;
    g.add(hull);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(len * 0.365, len * 0.02, len * 0.7), cabinMat);
    stripe.position.set(0, len * 0.08, len * 0.1);
    g.add(stripe);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(len * 0.26, len * 0.14, len * 0.25), hullMat);
    cabin.position.set(0, len * 0.18, len * 0.05);
    g.add(cabin);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len * 0.3, len * 0.015, len * 0.35), hullMat);
    roof.position.set(0, len * 0.3, len * 0.08);
    g.add(roof);
    const n = 2 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const person = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.9, 5), colors[Math.floor(rand() * 4)]);
      person.position.set((rand() - 0.5) * len * 0.2, len * 0.12 + 0.45, len * (0.05 + rand() * 0.25));
      g.add(person);
    }
    return g;
  };
  const ski = () => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 3.2), new THREE.MeshStandardMaterial({ color: rand() < 0.5 ? 0xf4f4f4 : 0xd9e021, roughness: 0.4 }));
    body.position.y = 0.2;
    g.add(body);
    const rider = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.8, 5), colors[Math.floor(rand() * 4)]);
    rider.position.set(0, 1, 0.3);
    g.add(rider);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 1.6), new THREE.MeshStandardMaterial({ color: 0xff7a00, roughness: 0.6 }));
    deck.position.set(0, 0.06, 2.2);
    g.add(deck);
    return g;
  };
  for (let i = 0; i < 6; i++) {
    const b = boat(10 + rand() * 8);
    b.position.set(-90 - rand() * 80, 0, -260 - rand() * 180);
    b.rotation.y = rand() * Math.PI * 2;
    group.add(b);
  }
  for (let i = 0; i < 3; i++) {
    const b = ski();
    b.position.set(-70 - rand() * 40, 0, -240 - rand() * 120);
    b.rotation.y = rand() * 0.6;
    group.add(b);
  }
  return group;
}

function buildWaveMesh(uniforms, quality) {
  const step = quality === "low" ? 2 : 1;
  const ds = [];
  for (let d = -200; d < -60; d += 2.5 * step) ds.push(d);
  for (let d = -60; d < 12; d += 0.3 * step) ds.push(d);
  for (let d = 12; d <= 46; d += 1.2 * step) ds.push(d);
  const segV = quality === "low" ? 150 : 280;
  const cols = segV + 1;
  const rows = ds.length;
  const grid = new Float32Array(cols * rows * 2);
  const pos = new Float32Array(cols * rows * 3);
  const index = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      grid[i * 2] = c / segV;
      grid[i * 2 + 1] = ds[r];
      pos[i * 3 + 2] = ds[r];
      if (c < segV && r < rows - 1) {
        const a = i;
        const b = i + 1;
        const d = i + cols;
        const e = d + 1;
        index.push(a, d, b, b, d, e);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("grid", new THREE.BufferAttribute(grid, 2));
  geo.setIndex(index);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -80), 400);
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: waterVertex,
    fragmentShader: waterFragment,
  }));
  mesh.frustumCulled = false;
  return mesh;
}

function makeFin() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x1a242c, roughness: 0.45, metalness: 0.05 });
  const blade = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.78, 5), mat);
  blade.position.y = 0.42;
  g.add(blade);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), new THREE.MeshStandardMaterial({ color: 0x12181e, roughness: 0.6 }));
  body.scale.set(0.7, 0.45, 1.6);
  body.position.y = -0.15;
  g.add(body);
  return g;
}

export async function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: true,
    failIfMajorPerformanceCaveat: false,
  });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(new THREE.Color(0.36, 0.55, 0.78), 0.00016);
  const camera = new THREE.PerspectiveCamera(80, 1, 0.05, 20000);

  const normalTex = makeNormalTexture(256);
  const foamTex = makeFoamTexture(256);
  const dropTex = makeDropTexture(256);

  const sunDir = new THREE.Vector3();
  const sunCol = new THREE.Color();
  const uniforms = {
    uSunDir: { value: sunDir },
    uSunCol: { value: sunCol },
    uZen: { value: new THREE.Color() },
    uMid: { value: new THREE.Color() },
    uHor: { value: new THREE.Color() },
    uGlare: { value: 1 },
    uTime: { value: 0 },
    uHeight: { value: 1 },
    uCurl: { value: 1 },
    uTight: { value: 0 },
    uPeel: { value: 0 },
    uC0: { value: new THREE.Vector4(0, 0, 0, 0) },
    uC1: { value: new THREE.Vector4(1, 1, 1, 1) },
    uCp: { value: new THREE.Vector4(0, 0, 0, 0) },
    uSpit: { value: 0 },
    uDetail: { value: 1 },
    uWind: { value: 0.2 },
    tNormal: { value: normalTex },
    tFoam: { value: foamTex },
  };

  const skyMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: skyDome.vertex,
    fragmentShader: skyDome.fragment,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 16), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  const clouds = buildClouds(uniforms);
  scene.add(clouds);
  const island = buildIsland(uniforms);
  scene.add(island);
  const boats = buildBoats();
  scene.add(boats);

  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(24000, 24000, 40, 40),
    new THREE.ShaderMaterial({ uniforms, vertexShader: oceanVertex, fragmentShader: waterFragment, side: THREE.FrontSide }),
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = -0.55;
  ocean.frustumCulled = false;
  ocean.renderOrder = -5;
  scene.add(ocean);

  let quality = "high";
  let wave = buildWaveMesh(uniforms, quality);
  scene.add(wave);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(450000);
  const su = envSky.material.uniforms;
  su.turbidity.value = 2.2;
  su.rayleigh.value = 1.15;
  su.mieCoefficient.value = 0.0045;
  su.mieDirectionalG.value = 0.82;
  su.sunPosition.value.set(80, 40, -30);
  envScene.add(envSky);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(8000, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.0, 0.14, 0.18) }),
  );
  ground.position.y = -4;
  envScene.add(ground);
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  scene.environmentIntensity = 0.85;
  pmrem.dispose();

  const sun = new THREE.DirectionalLight(0xfff5e6, 3.0);
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0x339988, 0x005858, 0.2);
  scene.add(hemi);

  const surfer = await createSurfer();
  scene.add(surfer.holder);

  const spray = new Spray(7000, undefined, foamTex);
  scene.add(spray.points);
  const wake = new Wake(70, foamTex);
  scene.add(wake.mesh);

  const sharks = new THREE.Group();
  for (let i = 0; i < 4; i++) sharks.add(makeFin());
  scene.add(sharks);
  const reef = new THREE.Group();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x3a342c, roughness: 1 });
  for (let i = 0; i < 8; i++) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7 + (i % 3) * 0.35, 0), rockMat);
    rock.scale.y = 0.45;
    reef.add(rock);
  }
  scene.add(reef);
  const debris = new THREE.Group();
  const looseMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.45 });
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 1.7), looseMat);
    debris.add(b);
  }
  scene.add(debris);

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.12, 0.4, 2.4);
  composer.addPass(bloom);
  const gradePass = new GradePass(dropTex);
  composer.addPass(gradePass);
  composer.addPass(new OutputPass());

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, quality === "low" ? 1 : 1.5) * (quality === "low" ? 0.75 : 1);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    camera.aspect = w / Math.max(1, h);
    const hFov = THREE.MathUtils.degToRad(camera.aspect > 1 ? 112 : 104);
    let vFov = 2 * Math.atan(Math.tan(hFov / 2) / camera.aspect);
    vFov = Math.min(vFov, THREE.MathUtils.degToRad(120));
    camera.fov = THREE.MathUtils.radToDeg(vFov);
    camera.updateProjectionMatrix();
    gradePass.uniforms.uAspect.value = camera.aspect;
    spray.uniforms.uScale.value = (h * pr) / (2 * Math.tan(vFov / 2));
  }

  function setQuality(q) {
    quality = q === "low" ? "low" : "high";
    scene.remove(wave);
    wave.geometry.dispose();
    wave = buildWaveMesh(uniforms, quality);
    scene.add(wave);
    composer.renderTarget1.samples = composer.renderTarget2.samples = quality === "low" ? 0 : 4;
    bloom.enabled = quality !== "low";
    uniforms.uDetail.value = quality === "low" ? 0.65 : 1;
    gradePass.uniforms.uFlare.value = quality === "low" ? 0.45 : 0.8;
    resize();
  }

  function applyLook(name) {
    const look = LOOKS[name] || LOOKS.day;
    uniforms.uZen.value.setRGB(...look.zen);
    uniforms.uMid.value.setRGB(...look.mid);
    uniforms.uHor.value.setRGB(...look.hor);
    sunCol.setRGB(...look.sun);
    uniforms.uGlare.value = look.glare;
    sunVector(look.elev, look.az, sunDir);
    renderer.toneMappingExposure = look.exposure;
    scene.fog.density = look.fog;
    scene.fog.color.setRGB(look.hor[0] * 0.85, look.hor[1] * 0.9, look.hor[2]);
    hemi.intensity = look.hemi;
    sun.color.copy(sunCol);
    su.sunPosition.value.copy(sunDir).multiplyScalar(80);
    return look;
  }

  applyLook("day");
  resize();

  return {
    renderer, scene, camera, composer, uniforms, sun, hemi, sky, clouds, island, boats, ocean,
    get wave() { return wave; },
    surfer, spray, wake, sharks, reef, debris, gradePass, bloom,
    setQuality, resize, applyLook, get quality() { return quality; },
  };
}
