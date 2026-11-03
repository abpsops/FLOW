#!/usr/bin/env node
/* Builds index.html from the source files in src/ (see src/README.md).

     node tools/build.js            write index.html (only when it changed)
     node tools/build.js --check    exit 1 if index.html is not exactly what src/ builds
     node tools/build.js --where N  which src/ file and line make up line N of index.html

   src/index.html is the page skeleton. A line that is exactly
       <!-- @include path/to/file -->
   is replaced by that file's contents (paths are relative to src/; included
   files may include others). Nothing else is changed: the output is the plain
   concatenation, so index.html stays the single file that is deployed, served
   by the service worker and copied into the Android app. Every file under src/
   must be included exactly once, and every included file must be UTF-8 with
   LF line endings (no byte-order mark) ending with a newline — anything else
   is refused, so the output never changes by accident. Plain Node, no
   dependencies. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'index.html');
const ENTRY = 'index.html';
const INCLUDE = /^<!-- @include (\S+) -->$/;
const LOOKS_LIKE_INCLUDE = /^\s*<!--\s*@include\b/;
const DOCS = new Set(['README.md']); // under src/ but not part of the page
// Editor / OS litter is not a source file (vim swap and backup files, macOS Finder).
const LITTER = function (name) { return name.startsWith('.') || name.endsWith('~') || /\.sw[a-p]$/.test(name); };
const UTF8 = new TextDecoder('utf-8', { fatal: true });

function fail(msg) { console.error('build: ' + msg); process.exit(1); }

// Expands `rel` into out[] (strings) and map[] ([file, line] per output line).
function build() {
  const out = [], map = [], used = new Set();
  (function expand(rel, stack) {
    const norm = path.posix.normalize(rel);
    if (norm.startsWith('..') || path.isAbsolute(norm)) fail(`include outside src/: ${rel} (in ${stack[stack.length - 1]})`);
    if (stack.includes(norm)) fail(`include cycle: ${stack.concat(norm).join(' -> ')}`);
    if (used.has(norm)) fail(`${norm} is included twice (second time from ${stack[stack.length - 1]})`);
    used.add(norm);
    const file = path.join(SRC, norm);
    if (!fs.existsSync(file)) fail(`missing file src/${norm} (included from ${stack[stack.length - 1] || 'the build'})`);
    const bytes = fs.readFileSync(file);
    let text;
    try { text = UTF8.decode(bytes); } catch (e) { fail(`src/${norm} is not valid UTF-8 — save it as UTF-8`); }
    if (text.charCodeAt(0) === 0xFEFF || bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) fail(`src/${norm} starts with a byte-order mark — save it as UTF-8 without BOM`);
    if (text.includes('\r')) fail(`src/${norm} has CRLF (Windows) line endings — save it with LF line endings (see .gitattributes)`);
    if (!text.length || !text.endsWith('\n')) fail(`src/${norm} must end with a newline`);
    const lines = text.slice(0, -1).split('\n');
    lines.forEach(function (line, i) {
      const m = INCLUDE.exec(line);
      if (m) expand(m[1], stack.concat(norm));
      else if (LOOKS_LIKE_INCLUDE.test(line)) fail(`malformed include at src/${norm}:${i + 1}: ${JSON.stringify(line)} — the line must be exactly <!-- @include path -->`);
      else { out.push(line + '\n'); map.push([norm, i + 1]); }
    });
  })(ENTRY, []);
  // A file nobody includes would silently not ship.
  const orphans = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (LITTER(name)) continue;
      const p = path.join(dir, name);
      const rel = path.relative(SRC, p).split(path.sep).join('/');
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (!used.has(rel) && !DOCS.has(rel)) orphans.push(rel);
    }
  })(SRC);
  if (orphans.length) fail(`not included anywhere: ${orphans.map(function (o) { return 'src/' + o; }).join(', ')}`);
  return { text: out.join(''), map: map };
}

const args = process.argv.slice(2);
const built = build();

if (args[0] === '--where') {
  const n = parseInt(args[1], 10);
  if (!(n >= 1 && n <= built.map.length)) fail(`--where needs a line number 1..${built.map.length}`);
  const [file, line] = built.map[n - 1];
  console.log(`index.html:${n} = src/${file}:${line}`);
  process.exit(0);
}

// Compared as bytes: a byte difference that decodes to the same text still fails.
const builtBytes = Buffer.from(built.text, 'utf8');
const currentBytes = fs.existsSync(OUT) ? fs.readFileSync(OUT) : null;
const same = !!currentBytes && Buffer.compare(currentBytes, builtBytes) === 0;
if (args[0] === '--check') {
  if (same) { console.log(`BUILD: index.html matches src/ (${built.map.length} lines)`); process.exit(0); }
  const current = currentBytes ? currentBytes.toString('latin1') : '';
  const a = current.split('\n'), b = builtBytes.toString('latin1').split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const src = built.map[i] ? `src/${built.map[i][0]}:${built.map[i][1]}` : 'end of the built file';
  console.log(`BUILD: FAILED — index.html differs from what src/ builds, first at line ${i + 1} (${src}).`);
  const show = function (s) { return JSON.stringify(Buffer.from(s || '', 'latin1').toString('utf8').slice(0, 160)); };
  console.log(`  index.html : ${show(a[i])}`);
  console.log(`  from src/  : ${show(b[i])}`);
  console.log('Edit the file in src/ (not index.html) and run: node tools/build.js');
  process.exit(1);
}
if (args.length) fail(`unknown option ${args[0]}`);
if (same) { console.log('index.html is up to date'); process.exit(0); }
fs.writeFileSync(OUT, builtBytes);
console.log(`index.html written (${built.map.length} lines)`);
