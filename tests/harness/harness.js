/* Test harness for FLOW's single-file index.html.

   const H = require('../../harness/harness.js');
   const db = H.createDb({ roles: { 'user-operator': 'operator', 'user-trader': 'trader' } });
   const browser = await H.launch();
   const app = await H.openApp(browser, db, { appDir: H.APP_DIR, uid: 'user-operator' });
   // app.page is a Playwright Page, app.errors collects uncaught page errors + console.error text
   ...
   await browser.close();

   - H.APP_DIR is the app under test: $APP_DIR, else the repository root
     (the folder that holds index.html, two levels above this file).
   - The real Supabase is never contacted: window.supabase is replaced by
     mock-supabase.js, whose calls land in `db` (shared by every page/context
     opened with the same db, so you can simulate two operators at once).
   - db.tables.abps_workspace is a Map id -> row ({id, payload, version, updated_at}).
   - RLS is emulated: only role 'operator' may insert/update/delete abps_workspace;
     traders write only via rpc('trader_update_vessels').
   - CDN libraries are served from the exact-version npm packages installed in
     tests/node_modules (see CDN_MAP); Google Fonts are stubbed; any other
     external request is blocked and reported in app.errors.
   - Service workers are blocked. The app is served from https://flow.test/.
   - Chromium: Playwright's own build (PLAYWRIGHT_BROWSERS_PATH is honoured by
     Playwright itself); set CHROMIUM_PATH to use a specific executable instead.
   - Realtime: every write that changes an abps_workspace row (insert/upsert/
     update/delete/rpc) is turned into a postgres_changes event
     {eventType, schema, table, commit_timestamp, new:{id,version,updated_at}, old:{id,...}}
     and delivered to every OTHER open page's subscribed channel handlers.
     db.realtime = false turns delivery off (the subscription still reports
     SUBSCRIBED — like a project whose table isn't in the publication);
     db.realtimeEcho = true also delivers to the page that made the write (as
     real Supabase does). db.realtimeLog records every delivery batch.
*/
const fs = require('fs');
const path = require('path');

// Playwright from tests/node_modules; fall back to a global install if absent.
function loadPlaywright() {
  try { return require('playwright'); } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
    let root = '';
    try { root = require('child_process').execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (_) {}
    if (root && fs.existsSync(path.join(root, 'playwright'))) return require(path.join(root, 'playwright'));
    throw new Error('playwright not found — run `npm ci` in tests/ first');
  }
}
const { chromium } = loadPlaywright();

const APP_DIR = path.resolve(process.env.APP_DIR || path.join(__dirname, '..', '..'));

// Folder of an installed npm package (works even when its "exports" hides package.json).
function pkgDir(name) {
  for (const base of require.resolve.paths(name) || []) {
    const d = path.join(base, name);
    if (fs.existsSync(path.join(d, 'package.json'))) return d;
  }
  throw new Error(`npm package "${name}" is not installed — run \`npm ci\` in tests/`);
}
const vendor = (pkg, file) => () => path.join(pkgDir(pkg), file);

// CDN URL (as written in index.html) -> local file. Versions in tests/package.json
// must match the ones pinned in index.html.
const CDN_MAP = [
  [/supabase-js@[^/]+\/dist\/umd\/supabase\.js/, () => path.join(__dirname, 'mock-supabase.js')],
  [/xlsx\/0\.18\.5\/xlsx\.full\.min\.js/, vendor('xlsx', 'dist/xlsx.full.min.js')],
  [/flatpickr\/4\.6\.13\/flatpickr\.min\.css/, vendor('flatpickr', 'dist/flatpickr.min.css')],
  [/flatpickr\/4\.6\.13\/flatpickr\.min\.js/, vendor('flatpickr', 'dist/flatpickr.min.js')],
  [/mammoth\/1\.6\.0\/mammoth\.browser\.min\.js/, vendor('mammoth', 'mammoth.browser.min.js')],
  [/Chart\.js\/4\.4\.0\/chart\.umd\.min\.js/, vendor('chart.js', 'dist/chart.umd.js')],
  [/html2canvas\/1\.4\.1\/html2canvas\.min\.js/, vendor('html2canvas', 'dist/html2canvas.min.js')],
  [/jspdf\/2\.5\.1\/jspdf\.umd\.min\.js/, vendor('jspdf', 'dist/jspdf.umd.min.js')],
  [/exceljs\/4\.4\.0\/exceljs\.min\.js/, vendor('exceljs', 'dist/exceljs.min.js')],
  [/chartjs-plugin-datalabels\/2\.2\.0\/chartjs-plugin-datalabels\.min\.js/, vendor('chartjs-plugin-datalabels', 'dist/chartjs-plugin-datalabels.min.js')],
  [/jszip\/3\.10\.1\/jszip\.min\.js/, vendor('jszip', 'dist/jszip.min.js')],
  [/@emailjs\/browser@[^/]+\/dist\/email\.min\.js/, vendor('@emailjs/browser', 'dist/email.min.js')],
  // Import nomination OCR (lazy-loaded): library, worker, WebAssembly core, English model.
  [/tesseract\.js@6\.0\.1\/dist\/tesseract\.min\.js/, vendor('tesseract.js', 'dist/tesseract.min.js')],
  [/tesseract\.js@6\.0\.1\/dist\/worker\.min\.js/, vendor('tesseract.js', 'dist/worker.min.js')],
  [/tesseract\.js-core@6\.0\.0\/(tesseract-core[\w-]*\.(?:wasm\.js|js|wasm))$/, (m) => path.join(pkgDir('tesseract.js-core'), m[1])],
  [/@tesseract\.js-data\/eng@1\.0\.0\/4\.0\.0_best_int\/eng\.traineddata\.gz$/, vendor('@tesseract.js-data/eng', '4.0.0_best_int/eng.traineddata.gz')],
];

function createDb(opts) {
  opts = opts || {};
  const db = {
    roles: Object.assign({ 'user-operator': 'operator', 'user-operator2': 'operator', 'user-trader': 'trader' }, opts.roles || {}),
    tables: { abps_workspace: new Map(), user_roles: new Map() },
    log: [],
    // Set to a function(op) returning {data,error} to intercept any op (e.g. simulate failures).
    intercept: null,
    // Mirrors supabase_role_setup.sql's read policy. 'authenticated' = using(true); 'role' = role not null.
    readPolicy: opts.readPolicy || 'role',
    // Mirror the SQL's protection of operator-owned vessel fields in trader_update_vessels (opt-in).
    protectTraderFields: !!opts.protectTraderFields,
    realtime: opts.realtime !== false,
    realtimeEcho: !!opts.realtimeEcho,
    realtimeLog: [],
    pages: [],   // open pages (filled by openApp) — realtime delivery targets
  };
  if (opts.workspace) db.tables.abps_workspace.set('main', { id: 'main', payload: opts.workspace, version: opts.workspace.version || 1, updated_at: new Date().toISOString() });
  return db;
}

function matches(row, filters) {
  return filters.every(([kind, col, val]) => {
    if (kind === 'eq') return row[col] === val || String(row[col]) === String(val);
    if (kind === 'neq') return row[col] !== val;
    if (kind === 'in') return val.includes(row[col]);
    return true;
  });
}

function handle(db, op) {
  db.log.push(op);
  if (db.intercept) { const r = db.intercept(op); if (r) return r; }
  const role = db.roles[op.uid] || null;
  const rls = { data: null, error: { message: 'new row violates row-level security policy', code: '42501' } };
  if (op.action === 'rpc') {
    if (op.name === 'trader_update_vessels') {
      if (!role) return { data: null, error: { message: 'Not authorized: this account has no assigned role' } };
      const row = db.tables.abps_workspace.get('main');
      if (!row) return { data: null, error: { message: 'Workspace row not found' } };
      const a = op.args || {};
      if (a.expected_version != null && Number(row.version) !== Number(a.expected_version)) {
        return { data: null, error: { message: 'version_conflict', code: 'P0001' } };
      }
      row.payload = JSON.parse(JSON.stringify(row.payload));
      row.payload.state = row.payload.state || {};
      // Opt-in (db.protectTraderFields = true): mirror supabase_role_setup.sql's
      // per-nomUid merge that keeps operator-owned fields on existing vessels.
      if (db.protectTraderFields) {
        const PROT = ['bargeId', 'refuelChk', 'rfv', 'rfm', 'rfvr', 'rfmr'];
        const old = (row.payload.state.vessels || []);
        row.payload.state.vessels = (a.new_vessels || []).map(nv => {
          const ov = nv && nv.nomUid ? old.find(o => o && o.nomUid === nv.nomUid) : null;
          if (!ov) return nv;
          const out = Object.assign({}, nv); PROT.forEach(k => { delete out[k]; if (k in ov) out[k] = ov[k]; });
          return out;
        });
      } else row.payload.state.vessels = a.new_vessels || [];
      row.payload.version = a.new_version;
      row.version = a.new_version;
      row.updated_at = new Date().toISOString();
      return { data: null, error: null };
    }
    if (op.name === 'log_nomination_email') {
      // Mirrors supabase_role_setup.sql section 4b: set/clear ONE key of an email-log row.
      // Set db.noEmailLogRpc = true to emulate the SQL not having been re-run yet (PGRST202).
      if (db.noEmailLogRpc) return { data: null, error: { message: 'Could not find the function public.log_nomination_email(entry, log_id, nom_uid) in the schema cache', code: 'PGRST202' } };
      if (!role) return { data: null, error: { message: 'Not authorized: this account has no assigned role', code: 'P0001' } };
      const a = op.args || {};
      if (!['nomination_email_log', 'nomination_cancel_email_log'].includes(a.log_id)) return { data: null, error: { message: 'Invalid log id', code: 'P0001' } };
      if (!a.nom_uid) return { data: null, error: { message: 'Invalid nomination id', code: 'P0001' } };
      const t = db.tables.abps_workspace;
      const row = t.get(a.log_id) || { id: a.log_id, payload: {} };
      const payload = Object.assign({}, row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? row.payload : {});
      if (a.entry == null) delete payload[a.nom_uid]; else payload[a.nom_uid] = clone(a.entry);
      t.set(a.log_id, Object.assign({}, row, { payload, version: Date.now(), updated_at: new Date().toISOString() }));
      return { data: null, error: null };
    }
    return { data: null, error: { message: 'unknown rpc ' + op.name } };
  }
  if (op.table === 'user_roles') {
    if (op.action !== 'select') return rls;
    const r = role ? { role, user_id: op.uid } : null;
    const rows = r && matches(r, op.filters) ? [r] : [];
    return shape(op, rows);
  }
  const t = db.tables[op.table] || (db.tables[op.table] = new Map());
  if (op.action === 'select') {
    if (db.readPolicy === 'role' && !role) return shape(op, []);
    return shape(op, [...t.values()].filter(r => matches(r, op.filters)).map(clone));
  }
  if (op.table === 'abps_workspace' && role !== 'operator') return rls;
  if (op.action === 'upsert' || op.action === 'insert') {
    const rows = Array.isArray(op.rows) ? op.rows : [op.rows];
    for (const r of rows) {
      if (op.action === 'insert' && t.has(r.id)) return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } };
      t.set(r.id, Object.assign({}, op.action === 'upsert' ? t.get(r.id) : {}, clone(r)));
    }
    return { data: op.returning ? rows.map(clone) : null, error: null };
  }
  if (op.action === 'update') {
    const hit = [...t.values()].filter(r => matches(r, op.filters));
    hit.forEach(r => Object.assign(r, clone(op.values)));
    return { data: op.returning ? hit.map(clone) : null, error: null, count: hit.length };
  }
  if (op.action === 'delete') {
    const hit = [...t.values()].filter(r => matches(r, op.filters));
    hit.forEach(r => t.delete(r.id));
    return { data: op.returning ? hit.map(clone) : null, error: null };
  }
  return { data: null, error: { message: 'unsupported op' } };
}
// Snapshot of abps_workspace row identities, to diff into realtime events.
function wsSnapshot(db) {
  const m = new Map();
  for (const [id, r] of db.tables.abps_workspace) m.set(id, { ref: r, version: r.version, updated_at: r.updated_at, payload: r.payload });
  return m;
}
function wsEvents(before, db) {
  const out = [], ts = new Date().toISOString();
  const after = db.tables.abps_workspace;
  for (const [id, r] of after) {
    const b = before.get(id);
    const pub = { id, version: r.version, updated_at: r.updated_at };
    if (!b) out.push({ eventType: 'INSERT', schema: 'public', table: 'abps_workspace', commit_timestamp: ts, new: pub, old: {} });
    else if (b.ref !== r || b.version !== r.version || b.updated_at !== r.updated_at || b.payload !== r.payload) {
      out.push({ eventType: 'UPDATE', schema: 'public', table: 'abps_workspace', commit_timestamp: ts, new: pub, old: { id } });
    }
  }
  for (const id of before.keys()) if (!after.has(id)) out.push({ eventType: 'DELETE', schema: 'public', table: 'abps_workspace', commit_timestamp: ts, new: {}, old: { id } });
  return out;
}
// handle() + realtime fan-out to the other open pages (never awaited, so the
// writer gets its response first, as with the real server).
function handleAndBroadcast(db, op, originPage) {
  const writes = op.action !== 'select' && (op.table === 'abps_workspace' || op.action === 'rpc');
  const before = writes ? wsSnapshot(db) : null;
  const res = handle(db, op);
  if (before && db.realtime) {
    const events = wsEvents(before, db);
    if (events.length) {
      const targets = db.pages.filter(p => db.realtimeEcho || p.page !== originPage);
      db.realtimeLog.push({ at: Date.now(), from: op.uid, events, to: targets.map(p => p.uid) });
      setTimeout(() => {
        for (const t of targets) {
          if (t.page.isClosed()) continue;
          t.page.evaluate(ev => window.__mockRealtimeDeliver && window.__mockRealtimeDeliver(ev), events).catch(() => {});
        }
      }, 5);
    }
  }
  return res;
}
function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
function shape(op, rows) {
  if (op.single === 'maybe') return { data: rows[0] || null, error: null };
  if (op.single === 'one') return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
  return { data: rows, error: null };
}

async function launch() {
  return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
}

/* opts: appDir (default H.APP_DIR), uid ('user-operator'), signedOut (false),
   localStorage ({key: value} seeded before load), viewport, timezoneId ('Asia/Dubai'),
   offline (false), csp (Content-Security-Policy header value for index.html),
   beforeLoad (async (ctx, page) => {} run before the app is loaded) */
async function openApp(browser, db, opts) {
  opts = Object.assign({}, opts || {});
  opts.appDir = opts.appDir || APP_DIR;
  const ctx = await browser.newContext({
    serviceWorkers: 'block',
    viewport: opts.viewport || { width: 1400, height: 900 },
    timezoneId: opts.timezoneId || 'Asia/Dubai',
    acceptDownloads: true,
  });
  const errors = [];
  let page = null;
  await ctx.exposeFunction('__mockDb', (s) => JSON.stringify(handleAndBroadcast(db, JSON.parse(s), page)));
  const uid = opts.uid || 'user-operator';
  const ls = opts.localStorage || {};
  await ctx.addInitScript(([uid, signedOut, ls]) => {
    window.__mockUid = uid; window.__mockSignedOut = signedOut;
    try { if (!sessionStorage.getItem('__seeded')) { for (const k in ls) localStorage.setItem(k, ls[k]); sessionStorage.setItem('__seeded', '1'); } } catch (e) {}
  }, [uid, !!opts.signedOut, ls]);
  await ctx.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('https://flow.test/')) {
      let p = decodeURIComponent(new URL(url).pathname);
      if (p === '/' || !path.extname(p)) p = '/index.html';
      const f = path.join(opts.appDir, p);
      if (fs.existsSync(f)) {
        if (p === '/index.html') {
          // supabase-js is replaced by a mock, so its SRI hash can never match: drop
          // integrity on that one tag only (other CDN files are the real npm bytes).
          const html = fs.readFileSync(f, 'utf8').replace(/(<script[^>]*supabase-js@[^>]*?)\s+integrity="[^"]*"/, '$1');
          const headers = { 'content-type': 'text/html; charset=utf-8' };
          if (opts.csp) headers['content-security-policy'] = opts.csp;
          return route.fulfill({ status: 200, body: html, headers });
        }
        return route.fulfill({ path: f });
      }
      return route.fulfill({ status: 404, body: 'not found' });
    }
    for (const [re, fileOf] of CDN_MAP) {
      const m = url.match(re);
      if (m) {
        const file = fileOf(m);
        const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.gz') ? 'application/gzip' : 'application/javascript';
        if (db.cdnLog) db.cdnLog.push(url);
        return route.fulfill({ path: file, headers: { 'access-control-allow-origin': '*', 'content-type': type } });
      }
    }
    if (/fonts\.(googleapis|gstatic)\.com/.test(url)) return route.fulfill({ status: 200, body: '', headers: { 'content-type': 'text/css' } });
    if (/^(data|blob):/.test(url)) return route.continue();
    if (opts.allowUnknown) return route.continue();
    errors.push('BLOCKED external request: ' + url);
    return route.abort();
  });
  page = await ctx.newPage();
  // opts.beforeLoad(ctx, page): e.g. page.clock.setSystemTime(...) to fake the date
  if (opts.beforeLoad) await opts.beforeLoad(ctx, page);
  const entry = { page, uid };
  if (db.pages) { db.pages.push(entry); page.on('close', () => { const i = db.pages.indexOf(entry); if (i !== -1) db.pages.splice(i, 1); }); }
  page.on('pageerror', e => errors.push('pageerror: ' + (e.stack || e.message)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('dialog', d => { (opts.onDialog || (dd => dd.accept()))(d); });
  await page.goto('https://flow.test/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(opts.settleMs == null ? 2500 : opts.settleMs);
  return { ctx, page, errors };
}

module.exports = { APP_DIR, CDN_MAP, createDb, handle, handleAndBroadcast, launch, openApp };
