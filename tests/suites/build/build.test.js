/* index.html is built from src/ by tools/build.js (see src/README.md).
   • the committed index.html is exactly what src/ builds (an edit made in index.html
     instead of src/ fails here, naming the src/ file and line to edit)
   • every JavaScript file in src/js parses on its own (each is whole statements)
   • the build tool: an edit in src/ reaches index.html at the right line; a stray file,
     a missing / duplicated / cyclic / outside include and a file without a final newline
     are refused; --where maps an index.html line to its src/ file and line
   • the deploy ignore lists keep src/ and tools/ off the published site
   node suites/build/build.test.js            (APP_DIR = repository to check, default ../..) */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(process.env.APP_DIR || path.join(__dirname, '..', '..', '..'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 700)));
}
function run(root, args) {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', 'build.js')].concat(args || []), { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const a = path.join(from, name), b = path.join(to, name);
    if (fs.statSync(a).isDirectory()) copyTree(a, b); else fs.copyFileSync(a, b);
  }
}

if (!fs.existsSync(path.join(ROOT, 'tools', 'build.js'))) {
  console.log('No tools/build.js in ' + ROOT + ' (a build from before src/) — nothing to check.');
  console.log('\n0 passed, 0 failed');
  process.exit(0);
}

/* B1 — the repository itself */
{
  const r = run(ROOT, ['--check']);
  check('B1 the committed index.html is exactly what src/ builds', r.code === 0 && /matches src\//.test(r.out), r.out.trim());
  const dir = path.join(ROOT, 'src', 'js');
  const bad = [];
  let n = 0;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js')).sort()) {
    n++;
    try { new vm.Script(fs.readFileSync(path.join(dir, f), 'utf8'), { filename: 'src/js/' + f }); }
    catch (e) { bad.push('src/js/' + f + ': ' + e.message); }
  }
  check('B1 every src/js file parses on its own (' + n + ' files)', n > 30 && !bad.length, bad);
  const vi = fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8').split('\n').map(s => s.trim());
  const jk = fs.readFileSync(path.join(ROOT, '_config.yml'), 'utf8');
  check('B1 src/ and tools/ are kept off the published site (Vercel and GitHub Pages)', vi.includes('src/') && vi.includes('tools/') && /-\s*src\/\s*$/m.test(jk) && /-\s*tools\/\s*$/m.test(jk), { vi, jk });
}

/* B2 — the build tool, on a scratch copy of the repository */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-build-'));
try {
  const fresh = function () {
    fs.rmSync(TMP, { recursive: true, force: true });
    copyTree(path.join(ROOT, 'src'), path.join(TMP, 'src'));
    copyTree(path.join(ROOT, 'tools'), path.join(TMP, 'tools'));
    fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(TMP, 'index.html'));
  };
  const idx = function () { return fs.readFileSync(path.join(TMP, 'index.html'), 'utf8'); };
  const lineOf = function (text, needle) { return text.slice(0, text.indexOf(needle)).split('\n').length; };

  fresh();
  const before = idx();
  const r0 = run(TMP, []);
  check('B2 building an unchanged src/ leaves index.html untouched', r0.code === 0 && /up to date/.test(r0.out) && idx() === before, r0.out.trim());

  // an edit made in index.html instead of src/
  const needle = 'function _dealStats(d) {';
  const atIdx = lineOf(before, needle);
  fs.writeFileSync(path.join(TMP, 'index.html'), before.replace(needle, needle + ' /* edited here */'));
  const r1 = run(TMP, ['--check']);
  const deals = fs.readFileSync(path.join(TMP, 'src', 'js', 'deals.js'), 'utf8');
  const atSrc = lineOf(deals, needle);
  check('B2 an edit made directly in index.html fails the check, naming the src/ file and line to edit', r1.code === 1 && r1.out.includes('first at line ' + atIdx + ' (src/js/deals.js:' + atSrc + ')') && /Edit the file in src\//.test(r1.out), { atIdx, atSrc, out: r1.out });

  // the same edit made in src/ reaches index.html at that line
  fresh();
  fs.writeFileSync(path.join(TMP, 'src', 'js', 'deals.js'), deals.replace(needle, needle + ' /* edited in src */'));
  const r2 = run(TMP, []);
  const after = idx();
  check('B2 an edit in src/js/deals.js is written into index.html at the same place, and nothing else changes', r2.code === 0 && /written/.test(r2.out) && after.split('\n')[atIdx - 1] === needle + ' /* edited in src */' && after.replace(' /* edited in src */', '') === before && run(TMP, ['--check']).code === 0, r2.out.trim());

  const w = run(TMP, ['--where', String(atIdx)]);
  check('B2 --where maps an index.html line to its src/ file and line', w.code === 0 && w.out.trim() === 'index.html:' + atIdx + ' = src/js/deals.js:' + atSrc, w.out.trim());

  // mistakes the tool refuses
  const tpl = path.join(TMP, 'src', 'index.html');
  const refuse = function (name, setup, pattern) {
    fresh(); setup();
    const r = run(TMP, ['--check']);
    check('B2 refused: ' + name, r.code === 1 && pattern.test(r.out), r.out.trim());
  };
  refuse('a file under src/ that nothing includes', () => fs.writeFileSync(path.join(TMP, 'src', 'js', 'stray.js'), 'var x;\n'), /not included anywhere: src\/js\/stray\.js/);
  refuse('an include of a missing file', () => fs.appendFileSync(tpl, '<!-- @include js/nope.js -->\n'), /missing file src\/js\/nope\.js/);
  refuse('a file included twice', () => fs.appendFileSync(tpl, '<!-- @include js/deals.js -->\n'), /js\/deals\.js is included twice/);
  refuse('an include cycle', () => fs.appendFileSync(path.join(TMP, 'src', 'html', 'topbar.html'), '<!-- @include html/topbar.html -->\n'), /included twice|include cycle/);
  refuse('an include outside src/', () => fs.appendFileSync(tpl, '<!-- @include ../index.html -->\n'), /include outside src\//);
  refuse('a file without a final newline', () => fs.writeFileSync(path.join(TMP, 'src', 'js', 'shell.js'), fs.readFileSync(path.join(TMP, 'src', 'js', 'shell.js'), 'utf8').replace(/\n$/, '')), /src\/js\/shell\.js must end with a newline/);
  fresh();
  fs.writeFileSync(path.join(TMP, 'src', 'README.md'), '# notes\n');
  check('B2 src/README.md is documentation, not part of the page', run(TMP, ['--check']).code === 0);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
