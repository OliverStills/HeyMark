#!/usr/bin/env node
/**
 * build-hashes.mjs — generates release-hash.json: a manifest of SHA-256 hashes
 * for every runtime-served asset. Run before each release:  node build-hashes.mjs
 *
 * The verifier in the app fetches each listed file, hashes the raw bytes, and
 * compares. This proves the live deployment matches the published source. The
 * manifest itself is excluded (its integrity comes from the signed GitHub
 * release — users compare the manifest's own hash, printed below, to the notes).
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

const ROOT = process.cwd();
const VERSION = '1.1.0';
const RELEASE_URL = 'https://github.com/OliverStills/HeyMark/releases/tag/v1.1.0';

// Runtime-served roots. Everything the browser actually loads/executes.
const INCLUDE_FILES = ['index.html', 'app.js', 'styles.css', 'verify/index.html'];
const INCLUDE_DIRS  = ['vendor', 'assets/fonts', 'assets/tessdata'];
// vendor/dompurify and vendor/marked are no longer loaded at runtime (Preview tab removed)
const EXCLUDE = new Set(['release-hash.json', 'vendor/dompurify', 'vendor/marked']);

function walk(dir, acc = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = posix.join(dir, name);
    if (EXCLUDE.has(rel)) continue;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, acc);
    else acc.push(rel);
  }
  return acc;
}

function sha256(relPath) {
  const buf = readFileSync(join(ROOT, relPath));
  return createHash('sha256').update(buf).digest('hex');
}

const paths = [...INCLUDE_FILES];
for (const d of INCLUDE_DIRS) walk(d, paths);
paths.sort();

const files = {};
for (const p of paths) files['/' + p] = sha256(p);

const manifest = { version: VERSION, releaseUrl: RELEASE_URL, algorithm: 'SHA-256', files };
const json = JSON.stringify(manifest, null, 2) + '\n';
writeFileSync(join(ROOT, 'release-hash.json'), json);

// Print the manifest's own hash so it can be published in the release notes.
const manifestHash = createHash('sha256').update(json).digest('hex');
console.log(`Wrote release-hash.json with ${paths.length} files.`);
console.log(`Manifest SHA-256 (publish this in the GitHub release notes):\n  ${manifestHash}`);
