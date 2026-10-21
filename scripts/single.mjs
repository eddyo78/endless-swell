import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const htmlPath = join(dist, "index.html");
let html = readFileSync(htmlPath, "utf8");

const cssHref = html.match(/href="(\.\/assets\/[^"]+\.css)"/);
const jsSrc = html.match(/src="(\.\/assets\/[^"]+\.js)"/);
if (!cssHref || !jsSrc) {
  throw new Error("dist/index.html is missing the built stylesheet or script");
}

const css = readFileSync(join(dist, cssHref[1]), "utf8");
let js = readFileSync(join(dist, jsSrc[1]), "utf8");
js = js.replace(/<\/script/gi, "<\\/script");

// Replacement functions, not strings: minified JS contains $`, $&, and $' which
// String.replace would treat as match tokens and splice the page into the script.
html = html.replace(/<link rel="stylesheet"[^>]*>/, () => `<style>\n${css}\n</style>`);
html = html.replace(/<script type="module"[^>]*><\/script>/, () => `<script type="module">\n${js}\n</script>`);
html = html.replace(/<link rel="modulepreload"[^>]*>/g, "");

if (html.includes('src="./assets/') || html.includes('href="./assets/')) {
  throw new Error("single file still references built assets");
}

const outDir = join(root, "single");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, "endless-swell.html");
writeFileSync(out, html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`wrote ${out} (${kb} KB)`);
