// Cached downloads for scripts/build-surfers.mjs.
//
// Everything fetched is stored under build/.cache/ (gitignored) so a second run needs no network, and so the files
// that fed a build can be inspected. Two sources are used:
//   1. single files from the MakeHuman GitHub repo (raw.githubusercontent.com): base mesh, rig, weights, targets.
//   2. single files out of the MakeHuman "system assets" CC0 zip (about 267 MB). The zip is never downloaded whole:
//      the server supports HTTP Range requests, so the zip's central directory is read first and then only the
//      wanted entries are fetched (each is a local header plus raw-deflate data, inflated with node:zlib).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
export const CACHE = join(here, "..", "..", ".cache");

export const GITHUB_DATA = "https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data";
export const SYSTEM_ASSETS_ZIP = "https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function cachePath(...parts) {
  return join(CACHE, ...parts);
}

function readCached(path) {
  return existsSync(path) ? readFileSync(path) : null;
}

function writeCached(path, buf) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
}

export async function fetchBuffer(url, cacheName) {
  const path = cachePath("github", cacheName);
  const hit = readCached(path);
  if (hit) return hit;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeCached(path, buf);
  return buf;
}

export async function githubText(rel) {
  return (await fetchBuffer(`${GITHUB_DATA}/${rel}`, rel)).toString("utf8");
}

async function range(url, start, end) {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (res.status !== 206) throw new Error(`expected 206 for ${url} bytes ${start}-${end}, got ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Reads the central directory of a remote zip and returns { entries: Map(name -> entry), read(name) -> Buffer }.
export async function openRemoteZip(url) {
  const head = await fetch(url, { method: "HEAD" });
  if (!head.ok) throw new Error(`${head.status} HEAD ${url}`);
  const size = Number(head.headers.get("content-length"));
  if (head.headers.get("accept-ranges") !== "bytes") throw new Error(`${url} does not accept byte ranges`);
  const tailLen = Math.min(size, 1 << 17);
  const tail = await range(url, size - tailLen, size - 1);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip end-of-central-directory record not found");
  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error("zip64 archives are not supported");
  const cd = cdOffset >= size - tailLen ? tail.subarray(cdOffset - (size - tailLen), cdOffset - (size - tailLen) + cdSize) : await range(url, cdOffset, cdOffset + cdSize - 1);
  const entries = new Map();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad central directory signature at entry ${i}`);
    const method = cd.readUInt16LE(p + 10);
    const crc = cd.readUInt32LE(p + 16);
    const csize = cd.readUInt32LE(p + 20);
    const usize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const offset = cd.readUInt32LE(p + 42);
    const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
    entries.set(name, { name, method, crc, csize, usize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  async function read(name) {
    const hit = readCached(cachePath("system-assets", name));
    if (hit) return hit;
    const e = entries.get(name);
    if (!e) throw new Error(`${name} is not in ${url}`);
    const header = await range(url, e.offset, e.offset + 29);
    if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const dataStart = e.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    const raw = e.csize ? await range(url, dataStart, dataStart + e.csize - 1) : Buffer.alloc(0);
    let data;
    if (e.method === 0) data = raw;
    else if (e.method === 8) data = inflateRawSync(raw);
    else throw new Error(`${name}: unsupported zip method ${e.method}`);
    if (data.length !== e.usize) throw new Error(`${name}: expected ${e.usize} bytes, got ${data.length}`);
    if (crc32(data) !== e.crc) throw new Error(`${name}: CRC32 mismatch`);
    writeCached(cachePath("system-assets", name), data);
    return data;
  }
  return { entries, read };
}
