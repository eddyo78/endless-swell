// MakeHuman file readers used by scripts/build-surfers.mjs. Formats were read from the files themselves
// (system assets pack and the GitHub repo), not from memory. They are all plain text.
//
// .obj  Wavefront. `v x y z` positions (MakeHuman units are decimeters), `vt u v` texture coordinates (origin bottom
//       left), `g name` / `o name` groups, `f a/ta b/tb c/tc [d/td]` faces with 1-based indices. The base mesh is
//       all quads. UVs are per face corner, so one vertex can have several UVs along a texture seam; a GLB wants one
//       UV per vertex, so the exporter splits a vertex wherever its (v, vt) pair differs (see mesh.mjs `compact`).
//
// .mhclo  A MakeHuman "clothes" file; the same format is used for hair, eyebrows, eyelashes, eyes and teeth. Header
//       lines are `key value` (name, obj_file, material, z_depth, tag, uuid, basemesh). After `verts 0` come one line
//       per proxy vertex, in obj vertex order. Two forms:
//         `a b c wa wb wc ox oy oz`  proxy = wa*base[a] + wb*base[b] + wc*base[c] + (ox*sx, oy*sy, oz*sz)
//         `a`                        proxy = base[a] (direct vertex; used by the eyelashes)
//       `x_scale a b d` (and y_, z_) gives the per-axis offset scale sx = |base[a].x - base[b].x| / d, measured on
//       the (morphed) base mesh, so offsets grow and shrink with the body. `base` here is the full 19,158-vertex
//       MakeHuman 1.1 mesh including helper geometry (eyes, lashes), which is why indices exceed 13,379.
//       Check made while writing this (not a proof): fitting to the base mesh shaped to an approximation of
//       MakeHuman's default human (gender 0.5, young, average muscle and weight, equal ancestry) puts the proxies
//       within about 1 to 5 cm of the positions stored in their .obj files, and the offset scales come out at 0.94 to
//       1.05, the "about 1" they are meant to be on the default human. The proxies sit correctly on the shaped body in
//       the renders (hair on the head, brows over the eyes, lashes on the lids, eyeballs in the sockets).
//
// .mhmat  Material: `diffuseTexture file.png`, `transparent True|False`, `backfaceCull`, colours. Only the diffuse
//       texture name, transparency and the licence header are used here; MakeHuman's litsphere shader is not.
//
// .mhskel / .mhw  JSON: bone list with head/tail joint names, and per-bone [vertex, weight] pairs.

export function parseObj(src) {
  const v = [];
  const vt = [];
  const groups = new Map(); // name -> array of faces; a face is an array of [vIndex, vtIndex] corners
  let name = "";
  for (const line of src.split("\n")) {
    if (line.startsWith("v ")) {
      const p = line.trim().split(/\s+/);
      v.push(+p[1], +p[2], +p[3]);
    } else if (line.startsWith("vt ")) {
      const p = line.trim().split(/\s+/);
      vt.push(+p[1], +p[2]);
    } else if (line.startsWith("g ") || line.startsWith("o ")) {
      name = line.slice(2).trim();
      if (!groups.has(name)) groups.set(name, []);
    } else if (line.startsWith("f ")) {
      const corners = line.trim().split(/\s+/).slice(1).map((tok) => {
        const parts = tok.split("/");
        return [parseInt(parts[0], 10) - 1, parts[1] ? parseInt(parts[1], 10) - 1 : -1];
      });
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(corners);
    }
  }
  return { verts: Float64Array.from(v), uvs: Float64Array.from(vt), groups };
}

// Triangulate faces (fan) into flat arrays of vertex indices and uv indices.
export function triangulate(faces) {
  const tv = [];
  const tt = [];
  for (const corners of faces) {
    for (let i = 1; i < corners.length - 1; i++) {
      for (const c of [corners[0], corners[i], corners[i + 1]]) {
        tv.push(c[0]);
        tt.push(c[1]);
      }
    }
  }
  return { tv, tt };
}

export function parseMhclo(src) {
  const out = { header: {}, tags: [], scale: {}, fit: [] };
  let inVerts = false;
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const p = line.split(/\s+/);
    if (inVerts && /^-?\d/.test(p[0])) {
      if (p.length === 9) out.fit.push({ v: [+p[0], +p[1], +p[2]], w: [+p[3], +p[4], +p[5]], o: [+p[6], +p[7], +p[8]] });
      else if (p.length === 1) out.fit.push({ v: [+p[0], +p[0], +p[0]], w: [1, 0, 0], o: [0, 0, 0] });
      else throw new Error(`unexpected mhclo vertex line "${line}"`);
      continue;
    }
    // key/value lines may follow `verts 0` (some files put `material` there), so they are read in either mode
    if (p[0] === "verts") {
      inVerts = true;
    } else if (p[0] === "x_scale" || p[0] === "y_scale" || p[0] === "z_scale") {
      out.scale[p[0][0]] = { a: +p[1], b: +p[2], den: +p[3] };
    } else if (p[0] === "tag") {
      out.tags.push(p.slice(1).join(" "));
    } else if (p[0] === "delete_verts" || p[0] === "weights" || p[0] === "delete" || p[0] === "subdivide") {
      // not used by the assets read here; stop rather than ignore silently
      throw new Error(`mhclo key ${p[0]} is not handled`);
    } else {
      out.header[p[0]] = p.slice(1).join(" ");
    }
  }
  if (!out.fit.length) throw new Error("mhclo has no vertex fitting data");
  return out;
}

// base: Float64Array of the full base mesh (any consistent unit). Returns the fitted proxy positions, same unit.
export function fitProxy(mhclo, base) {
  const s = [1, 1, 1];
  ["x", "y", "z"].forEach((axis, i) => {
    const d = mhclo.scale[axis];
    if (d) s[i] = Math.abs(base[d.a * 3 + i] - base[d.b * 3 + i]) / d.den;
  });
  const out = new Float64Array(mhclo.fit.length * 3);
  mhclo.fit.forEach((f, n) => {
    for (let k = 0; k < 3; k++) {
      out[n * 3 + k] =
        f.w[0] * base[f.v[0] * 3 + k] + f.w[1] * base[f.v[1] * 3 + k] + f.w[2] * base[f.v[2] * 3 + k] + f.o[k] * s[k];
    }
  });
  return out;
}

export function parseMhmat(src) {
  const out = { texture: null, transparent: false, name: "" };
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const p = line.split(/\s+/);
    if (p[0] === "diffuseTexture") out.texture = p[1];
    else if (p[0] === "transparent") out.transparent = /^true$/i.test(p[1]);
    else if (p[0] === "name") out.name = p.slice(1).join(" ");
  }
  return out;
}
