import * as THREE from "three";
import { spray as sprayShader, wake as wakeShader } from "./shaders.js";
import { facePoint, waveParams } from "./wave.js";

const Dynamic = THREE.DynamicDrawUsage;

export class Spray {
  constructor(max, foamBright = () => 1) {
    this.max = max;
    this.brightFn = foamBright;
    this.head = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.aSize = new Float32Array(max);
    this.aAlpha = new Float32Array(max);
    this.aBright = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(Dynamic));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.aSize, 1).setUsage(Dynamic));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.aAlpha, 1).setUsage(Dynamic));
    geo.setAttribute("aBright", new THREE.BufferAttribute(this.aBright, 1).setUsage(Dynamic));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.uniforms = { uScale: { value: 800 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: sprayShader.vertex,
      fragmentShader: sprayShader.fragment,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(x, y, z, vx, vy, vz, size, life, opt = {}) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size;
    this.grow[i] = opt.grow ?? 0.3;
    this.drag[i] = opt.drag ?? 0.6;
    this.alpha0[i] = opt.alpha ?? 0.9;
    this.grav[i] = opt.grav ?? 9.8;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.aAlpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const damp = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= damp;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * damp - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= damp;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < -0.3 && this.grav[i] > 1) this.life[i] = 0;
      const u = 1 - this.life[i] / this.maxLife[i];
      this.aSize[i] = this.size0[i] * (1 + this.grow[i] * u * 4);
      this.aAlpha[i] = this.alpha0[i] * Math.min(1, u * 8) * (1 - u) * (1 - u * 0.3);
      this.aBright[i] = this.brightFn(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aBright.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.aAlpha.fill(0);
  }
}

export class Wake {
  constructor(n, foamTex) {
    this.n = n;
    this.pts = [];
    const count = n * 2;
    this.pos = new Float32Array(count * 3);
    this.uv = new Float32Array(count * 2);
    this.age = new Float32Array(count);
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(Dynamic));
    geo.setAttribute("uv", new THREE.BufferAttribute(this.uv, 2).setUsage(Dynamic));
    geo.setAttribute("aAge", new THREE.BufferAttribute(this.age, 1).setUsage(Dynamic));
    geo.setIndex(idx);
    this.uniforms = { tFoam: { value: foamTex }, uLight: { value: 1 } };
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        vertexShader: wakeShader.vertex,
        fragmentShader: wakeShader.fragment,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  push(z, s, time) {
    this.pts.unshift({ z, s, t: time });
    if (this.pts.length > this.n) this.pts.pop();
  }

  update(time, peel, cond, life) {
    for (let i = 0; i < this.n; i++) {
      const p = this.pts[Math.min(i, this.pts.length - 1)];
      if (!p) return;
      const d = p.z - peel;
      const P = waveParams(d, cond.height, cond.curl, cond.tight, time, 0);
      const age = Math.min(1, (time - p.t) / life);
      const spread = (0.07 + Math.sqrt(age) * 2.9) / Math.max(P.r0, 1);
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? -1 : 1;
        const s = Math.max(0, p.s + sign * spread);
        const q = facePoint(P, s);
        const cx = 0 - q[0];
        const cy = P.r0 - q[1];
        const L = Math.hypot(cx, cy) || 1;
        const k = i * 2 + side;
        this.pos[k * 3] = q[0] + (cx / L) * 0.04;
        this.pos[k * 3 + 1] = q[1] + (cy / L) * 0.04 + (s < 0.12 ? 0.02 : 0);
        this.pos[k * 3 + 2] = p.z;
        this.uv[k * 2] = side;
        this.uv[k * 2 + 1] = p.z * 0.25;
        this.age[k] = i >= this.pts.length ? 1 : age;
      }
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.uv.needsUpdate = true;
    g.attributes.aAge.needsUpdate = true;
  }

  clear() {
    this.pts.length = 0;
  }
}
