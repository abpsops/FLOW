/* Syntax-checks every inline <script> block of index.html without running it.
   node check-scripts.js [path/to/index.html]   (default: ../index.html)
   Exit code 1 if any block fails to parse. Pure Node — no bash needed. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.resolve(process.argv[2] || path.join(process.env.APP_DIR || path.join(__dirname, '..'), 'index.html'));
const html = fs.readFileSync(file, 'utf8');
const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
const JS_TYPES = /^(|text\/javascript|application\/javascript|module)$/i;
let m, n = 0, bad = 0;
while ((m = re.exec(html))) {
  const attrs = m[1] || '';
  if (/\bsrc=/.test(attrs) || !m[2].trim()) continue;
  const type = ((attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || '').trim();
  if (!JS_TYPES.test(type)) continue; // JSON / templates are not scripts
  const line = html.slice(0, m.index).split('\n').length;
  const code = m[2];
  n++;
  try {
    if (/^module$/i.test(type)) {
      // Modules can't be compiled by vm.Script; fall back to node --check on a temp .mjs.
      const os = require('os');
      const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flow-check-')), 'block-' + line + '.mjs');
      fs.writeFileSync(tmp, code);
      const r = require('child_process').spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
      if (r.status !== 0) throw new Error(r.stderr.trim().split('\n').slice(0, 5).join('\n'));
    } else {
      // lineOffset makes error positions point at index.html lines.
      new vm.Script(code, { filename: path.basename(file), lineOffset: line - 1 });
    }
  } catch (e) {
    bad++;
    const where = (e.stack || '').split('\n')[0];
    console.log(`FAILED: <script> starting at line ${line}: ${e.message}${where && where !== e.message ? '\n   at ' + where : ''}`);
  }
}
if (!n) { console.log('No inline script blocks found in ' + file); process.exit(1); }
console.log(bad ? `${bad} of ${n} inline script blocks FAILED to parse` : `ALL ${n} INLINE SCRIPT BLOCKS PARSE OK`);
process.exit(bad ? 1 : 0);
