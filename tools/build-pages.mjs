#!/usr/bin/env node
// Build a copy of site/ for hosting under a sub-path, e.g. GitHub Pages at
// https://<user>.github.io/<repo>/
//
//   node tools/build-pages.mjs <outDir> [basePath]
//
// basePath is like "/ATD_Website" (or "" when hosted at a domain root, in which
// case the output is an exact copy of site/). With a basePath it:
//   1. prefixes every local asset URL (/_assets/...) with the base path
//   2. adds a tiny script so Framer's in-page navigation keeps the base path in
//      the address bar (Framer assumes it lives at the domain root)
// site/ itself is never modified.

import { cp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "site");
const OUT = path.resolve(process.argv[2] ?? path.join(HERE, "..", "dist"));
const BASE = (process.argv[3] ?? "").replace(/\/+$/, "");
const TEXT_EXT = [".html", ".mjs", ".js", ".css", ".json", ".svg"];

if (BASE && !/^\/[A-Za-z0-9._\-/]+$/.test(BASE)) {
  console.error(`Invalid base path: ${JSON.stringify(BASE)}`);
  process.exit(1);
}

// Keeps Framer's router on the base path: Framer pushes root-relative URLs
// like "/board"; rewrite them to "<BASE>/board".
const historyFix = (base) =>
  `<script>(function(){var B=${JSON.stringify(base)};function fix(u){if(typeof u!=="string"||u.charAt(0)!=="/"||u.charAt(1)==="/")return u;return u===B||u.indexOf(B+"/")===0?u:B+u;}["pushState","replaceState"].forEach(function(m){var o=history[m];history[m]=function(s,t,u){return o.call(this,s,t,u==null?u:fix(String(u)));};});})();</script>`;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

await rm(OUT, { recursive: true, force: true });
await cp(SRC, OUT, { recursive: true });

if (!BASE) {
  console.log(`Copied site/ to ${OUT} (no base path)`);
  process.exit(0);
}

let changed = 0;
for await (const file of walk(OUT)) {
  if (!TEXT_EXT.some((ext) => file.endsWith(ext))) continue;
  let text = await readFile(file, "utf8");
  const before = text;
  // The mirror only ever writes asset URLs in this exact form.
  text = text
    .replaceAll("/_assets/framerusercontent.com/", `${BASE}/_assets/framerusercontent.com/`)
    .replaceAll("/_assets/fonts.gstatic.com/", `${BASE}/_assets/fonts.gstatic.com/`);
  if (file.endsWith(".html")) text = text.replace("<head>", `<head>${historyFix(BASE)}`);
  if (text !== before) {
    await writeFile(file, text, "utf8");
    changed++;
  }
}
console.log(`Built ${OUT} with base path ${BASE} (${changed} files adjusted)`);
