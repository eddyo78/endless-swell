// Image helpers for scripts/build-surfers.mjs: PNG decode, area-average resize, edge colour bleed for alpha cut-outs,
// mean-normalised skin detail maps, JPEG and PNG encode. Pure JavaScript (pngjs, jpeg-js), so a build gives the same
// bytes on any machine and needs no native image library.
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

export function decodePng(buf) {
  const png = PNG.sync.read(buf);
  return { w: png.width, h: png.height, data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length) };
}

// Area-average downscale to w x h (alpha-weighted, so transparent texels do not darken the colour).
export function resize(img, w, h) {
  if (img.w === w && img.h === h) return img;
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = img.w / w;
  const sy = img.h / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * sy;
    const y1 = (y + 1) * sy;
    for (let x = 0; x < w; x++) {
      const x0 = x * sx;
      const x1 = (x + 1) * sx;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let wt = 0;
      for (let yy = Math.floor(y0); yy < Math.min(img.h, Math.ceil(y1)); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.floor(x0); xx < Math.min(img.w, Math.ceil(x1)); xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
          const k = wx * wy;
          const i = (yy * img.w + xx) * 4;
          const al = img.data[i + 3] / 255;
          r += img.data[i] * al * k;
          g += img.data[i + 1] * al * k;
          b += img.data[i + 2] * al * k;
          a += al * k;
          wt += k;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = (a / wt) * 255;
    }
  }
  return { w, h, data: out };
}

// Copy colour from opaque texels into transparent neighbours (a few passes), so bilinear filtering and mipmaps do not
// pull dark or white fringes into the cut-out edge.
export function bleedColour(img, passes = 6, threshold = 8) {
  const { w, h, data } = img;
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = data[i * 4 + 3] > threshold ? 1 : 0;
  for (let p = 0; p < passes; p++) {
    const next = solid.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (solid[i]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const j = yy * w + xx;
            if (!solid[j]) continue;
            r += data[j * 4];
            g += data[j * 4 + 1];
            b += data[j * 4 + 2];
            n++;
          }
        }
        if (n) {
          data[i * 4] = r / n;
          data[i * 4 + 1] = g / n;
          data[i * 4 + 2] = b / n;
          next[i] = 1;
        }
      }
    }
    solid.set(next);
  }
  return img;
}

// Divide the colour by its mean over the texels where mask(x, y) is true, then scale so the mean maps to `level`
// (an 8-bit texture cannot hold values above 1, so the mean sits at `level` and the material colour multiplies by
// 1/level). Result keeps per-channel relative variation (pores, blotches, redness) and drops the base tone.
export function meanNormalise(img, mask, level) {
  const { w, h, data } = img;
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask(x, y)) continue;
      const i = (y * w + x) * 4;
      sum[0] += data[i];
      sum[1] += data[i + 1];
      sum[2] += data[i + 2];
      n++;
    }
  }
  if (!n) throw new Error("meanNormalise: mask is empty");
  const mean = sum.map((v) => v / n);
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) out[i + c] = (data[i + c] / mean[c]) * level * 255;
    out[i + 3] = 255;
  }
  return { img: { w, h, data: out }, mean };
}

export function encodeJpeg(img, quality) {
  const raw = { data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), width: img.w, height: img.h };
  return jpeg.encode(raw, quality).data;
}

export function encodePng(img) {
  const png = new PNG({ width: img.w, height: img.h });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length);
  return PNG.sync.write(png, { colorType: 6 });
}

// 8-bit greyscale PNG (colour type 0) from the alpha channel of img.
export function encodeAlphaPng(img) {
  const grey = new Uint8ClampedArray(img.w * img.h * 4);
  for (let i = 0; i < img.w * img.h; i++) {
    const a = img.data[i * 4 + 3];
    grey[i * 4] = a;
    grey[i * 4 + 1] = a;
    grey[i * 4 + 2] = a;
    grey[i * 4 + 3] = 255;
  }
  const png = new PNG({ width: img.w, height: img.h });
  png.data = Buffer.from(grey.buffer);
  return PNG.sync.write(png, { colorType: 0, inputColorType: 6, bitDepth: 8, inputHasAlpha: true });
}

// Opaque version of an RGBA image for JPEG: colour kept, alpha dropped.
export function opaque(img) {
  const out = new Uint8ClampedArray(img.data);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return { w: img.w, h: img.h, data: out };
}
