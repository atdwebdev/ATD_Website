#!/usr/bin/env node
// Mirror https://atdumich.com (a Framer site) into ./site for local viewing.
//
// - Fetches every page in sitemap.xml and saves it as site/<slug>.html
// - Downloads every framerusercontent.com / fonts.gstatic.com asset referenced
//   from HTML, JS modules, CSS and JSON (recursively), stored under site/_assets/
// - Rewrites remote asset URLs to local /_assets/... paths
// - Strips Framer analytics / editor-bar scripts
//
// Usage: npm run update            (writes to ./site)
//        node tools/mirror.mjs DIR  (writes to DIR)

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = "https://atdumich.com";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] ?? path.join(HERE, "..", "site"));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const CONCURRENCY = 16;
const TEXT_EXT = [".mjs", ".js", ".css", ".json", ".svg"];

// Absolute asset URLs (also inside JS strings / CSS url())
const URL_RE = /https:\/\/(?:framerusercontent\.com|fonts\.gstatic\.com)\/[^\s"'`)\\<>,]+/g;
// Relative module imports inside .mjs files: "./foo.mjs"
const REL_MJS_RE = /["'`](\.\/[A-Za-z0-9_\-.]+\.mjs)["'`]/g;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchBytes(url) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
      // Framer's 404 page is served with status 404
      if (res.ok || (res.status === 404 && url.endsWith("/404"))) {
        return Buffer.from(await res.arrayBuffer());
      }
      lastErr = new Error(`HTTP ${res.status}`);
      if (res.status < 500 && res.status !== 429) break; // not worth retrying
    } catch (e) {
      lastErr = e;
    }
    await sleep(500 * attempt);
  }
  throw lastErr;
}

function htmlUnescape(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Same encoding as Python's urllib.parse.quote(s, safe="/")
function quote(s) {
  let out = "";
  for (const byte of Buffer.from(s, "utf8")) {
    const c = String.fromCharCode(byte);
    out += /[A-Za-z0-9_.\-~/]/.test(c) ? c : "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

// Strip query + fragment
function clean(url) {
  const u = new URL(htmlUnescape(url));
  return `${u.protocol}//${u.host}${u.pathname}`;
}

// Remote asset URL -> { disk: path on disk, web: URL path used in the site }
function localPath(url) {
  const u = new URL(htmlUnescape(url));
  const rel = `_assets/${u.host}${safeDecode(u.pathname)}`;
  return { disk: path.join(OUT, rel), web: "/" + quote(rel) };
}

function rewrite(text) {
  text = text.replace(URL_RE, (m) => localPath(clean(m)).web);
  // Disable Framer's on-page editor bar (it auto-loads on localhost)
  return text.replace(/EditorBar:(\w+)===void 0\?void 0:/g, "EditorBar:!0?void 0:");
}

const seen = new Set();
let queue = [];

function enqueue(url) {
  let c;
  try { c = clean(url); } catch { return; }
  if (c.endsWith("/") || seen.has(c)) return; // skip bare hosts / path prefixes built in JS
  seen.add(c);
  queue.push(c);
}

function scan(text, baseUrl) {
  for (const m of text.matchAll(URL_RE)) enqueue(m[0]);
  if (baseUrl) for (const m of text.matchAll(REL_MJS_RE)) enqueue(new URL(m[1], baseUrl).href);
}

async function download(url) {
  const { disk } = localPath(url);
  let data;
  try {
    data = await fetchBytes(url);
  } catch (e) {
    return { url, err: String(e?.cause?.code ?? e?.message ?? e) };
  }
  await mkdir(path.dirname(disk), { recursive: true });
  if (TEXT_EXT.some((ext) => disk.endsWith(ext))) {
    const text = new TextDecoder("utf-8").decode(data);
    await writeFile(disk, rewrite(text), "utf8");
    return { url, text };
  }
  await writeFile(disk, data);
  return { url };
}

// Run fn over items with limited concurrency, preserving order
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }));
  return results;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const sitemap = (await fetchBytes(`${ROOT}/sitemap.xml`)).toString("utf8");
  const pages = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  console.log(`${pages.length} pages`);

  for (const page of pages) {
    const slug = new URL(page).pathname.replace(/^\/+|\/+$/g, "") || "index";
    let text = (await fetchBytes(page)).toString("utf8");
    scan(text);
    // strip analytics + editor-bar bootstrap
    text = text.replace(/<script[^>]*src="https:\/\/events\.framer\.com[^"]*"[^>]*><\/script>/g, "");
    text = text.replace(/<script>try\{if\(localStorage\.getItem\("__framer_force_showing_editorbar_since"\)[\s\S]*?<\/script>/g, "");
    await writeFile(path.join(OUT, `${slug}.html`), rewrite(text), "utf8");
    console.log("page", slug);
  }

  const failures = [];
  while (queue.length) {
    const batch = queue;
    queue = [];
    for (const r of await mapLimit(batch, CONCURRENCY, download)) {
      if (r.err) failures.push(r);
      else if (r.text !== undefined) scan(r.text, r.url);
    }
    console.log(`downloaded ${batch.length} (total ${seen.size})`);
  }

  for (const p of ["sitemap.xml", "robots.txt"]) {
    await writeFile(path.join(OUT, p), await fetchBytes(`${ROOT}/${p}`));
  }

  console.log(`done: ${seen.size} assets, ${failures.length} failures`);
  for (const f of failures) console.log("  FAIL", f.url, f.err);
  if (failures.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
