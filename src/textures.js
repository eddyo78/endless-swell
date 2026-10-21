import * as THREE from "three";

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise(size, rand) {
  const n = new Float32Array(size * size);
  for (let i = 0; i < n.length; i++) n[i] = rand();
  return (x, y) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const u = x - i;
    const v = y - j;
    const sx = u * u * (3 - 2 * u);
    const sy = v * v * (3 - 2 * v);
    const w = size;
    const m = (a) => ((a % w) + w) % w;
    const f = n[m(j) * w + m(i)];
    const g = n[m(j) * w + m(i + 1)];
    const h = n[m(j + 1) * w + m(i)];
    const k = n[m(j + 1) * w + m(i + 1)];
    return f + (g - f) * sx + (h - f) * sy + (f - g - h + k) * sx * sy;
  };
}

export function makeNormalTexture(size = 256) {
  const rand = mulberry32(7);
  const waves = [];
  for (let i = 0; i < 24; i++) {
    const a = Math.round((rand() * 2 - 1) * (2 + i * 0.7)) || 1;
    const b = Math.round((rand() * 2 - 1) * (2 + i * 0.7)) || 1;
    waves.push([a, b, rand() * Math.PI * 2, 1 / Math.hypot(a, b) ** 1.25]);
  }
  const n1 = valueNoise(32, rand);
  const n2 = valueNoise(64, rand);
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let h = 0;
      for (const [a, b, ph, amp] of waves) h += amp * Math.sin(Math.PI * 2 * (a * u + b * v) + ph);
      h += 0.35 * n1(u * 32, v * 32) + 0.15 * n2(u * 64, v * 64);
      field[y * size + x] = h;
    }
  }
  const data = new Uint8Array(size * size * 4);
  const at = (x, y) => field[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.2;
      const L = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = (-dx / L * 0.5 + 0.5) * 255;
      data[i + 1] = (-dy / L * 0.5 + 0.5) * 255;
      data[i + 2] = (1 / L * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export function makeFoamTexture(size = 256) {
  const rand = mulberry32(13);
  const oct = [valueNoise(8, rand), valueNoise(16, rand), valueNoise(32, rand), valueNoise(64, rand)];
  const seeds = [];
  for (let i = 0; i < 48; i++) seeds.push([rand(), rand()]);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let h = 0;
      let amp = 0.5;
      let f = 8;
      for (let o = 0; o < 4; o++) {
        h += amp * oct[o](u * f, v * f);
        amp *= 0.5;
        f *= 2;
      }
      let d0 = 9;
      let d1 = 9;
      for (const [sx, sy] of seeds) {
        let dx = Math.abs(u - sx);
        dx = Math.min(dx, 1 - dx);
        let dy = Math.abs(v - sy);
        dy = Math.min(dy, 1 - dy);
        const d = Math.hypot(dx, dy);
        if (d < d0) {
          d1 = d0;
          d0 = d;
        } else if (d < d1) d1 = d;
      }
      const cells = Math.min(1, (d1 - d0) * 14);
      const streak = oct[2](u * 32, v * 4) * 0.6 + oct[3](u * 64, v * 8) * 0.4;
      const i = (y * size + x) * 4;
      data[i] = Math.min(255, (h / 0.94) * 255);
      data[i + 1] = cells * 255;
      data[i + 2] = streak * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export function makeDropTexture(size = 512) {
  const rand = mulberry32(99);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = 128;
    data[i * 4 + 1] = 128;
  }
  for (let n = 0; n < 140; n++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const rad = (rand() < 0.85 ? 3 + rand() * 9 : 12 + rand() * 22) * (size / 512);
    const aspect = 1 + rand() * 0.5;
    const y0 = Math.max(0, Math.floor(cy - rad * aspect));
    const y1 = Math.min(size, cy + rad * aspect);
    const x0 = Math.max(0, Math.floor(cx - rad));
    const x1 = Math.min(size, cx + rad);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const u = (x - cx) / rad;
        const v = (y - cy) / (rad * aspect);
        const r2 = u * u + v * v;
        if (r2 < 1) {
          const i = (y * size + x) * 4;
          const h = Math.sqrt(1 - r2);
          data[i] = 128 + u * h * 127;
          data[i + 1] = 128 + v * h * 127;
          data[i + 2] = Math.max(data[i + 2], Math.min(255, (1 - r2) * 3 * 255));
          data[i + 3] = 255;
        }
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
