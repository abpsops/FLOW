const path = require('path');
const H = require('../../harness/harness.js');
const APP = process.env.APP_DIR || H.APP_DIR;

function seedPayload(extra) {
  const state = Object.assign({
    barges: [{ id: 1, name: 'Barge 1', vcap: 5000, mcap: 1000, vrob: 4000, mrob: 800, vbuf: 500, mbuf: 150, vtph: 300, mtph: 100, vrfr: 750, mrfr: 275 }],
    vessels: [
      { nomUid: 'n1', name: 'ALPHA', imo: '', area: 'FUJ-A', type: 'VLSFO', qty: 500, mgo: 0, spec: 'ISO 8217:2010', agent: 'AG1', manifold: 'VESSEL MANIFOLD', remarks: '', lc: '', eta: '20 Oct 2026 08:00', paq: 'no', bargeId: '', refuelChk: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275 },
      { nomUid: 'n2', name: 'BRAVO', imo: '', area: 'FUJ-A', type: 'VLSFO', qty: 700, mgo: 0, spec: 'ISO 8217:2010', agent: 'AG2', manifold: 'VESSEL MANIFOLD', remarks: '', lc: '', eta: '21 Oct 2026 08:00', paq: 'no', bargeId: '', refuelChk: false, rfv: 0, rfm: 0, rfvr: 750, rfmr: 275 },
    ],
    checklist: {}, manualROB: {}, calcParams: { hoseHrs: 6, travelHrs: 1 }, lastSched: [], checklistRecords: {}, agents: [], archives: {},
    deliveryLog: {}, loadingRecords: [], loadingConfig: { rateVLSFO: 300, rateLSMGO: 150 }, bargeTrackingReports: [], fuelingInitiated: {}, version: 1000,
  }, extra || {});
  return { state, records: [], checklistRecords: {}, version: 1000 };
}

let failures = 0, passes = 0;
function check(cond, msg) {
  if (cond) { passes++; console.log('  ok   ' + msg); }
  else { failures++; console.log('  FAIL ' + msg); }
}
function summary(name) {
  console.log(`${name}: ${passes} passed, ${failures} failed`);
  process.exitCode = failures ? 1 : 0;
}
// Errors other than the 2 known capacitor ones.
function realErrors(app) { return app.errors.filter(e => !/capacitorExports is not defined/.test(e)); }

async function open(browser, db, uid, opts) {
  return H.openApp(browser, db, Object.assign({ appDir: APP, uid }, opts || {}));
}
// In-page helpers: set a vessel field by nomUid.
const PAGE_HELPERS = `
window.__cardFor = function(nomUid) {
  const c = Array.from(document.querySelectorAll('.vcard[id^="vessel-"]')).find(x => x.dataset.nomUid === nomUid);
  return c ? c.id.replace('vessel-','') : null;
};
window.__setV = function(nomUid, field, value) {
  const id = __cardFor(nomUid); if (!id) throw new Error('no card ' + nomUid);
  const el = document.getElementById('v' + id + '-' + field); el.value = value; return true;
};
window.__getV = function(nomUid, field) {
  const id = __cardFor(nomUid); if (!id) return null;
  return document.getElementById('v' + id + '-' + field).value;
};
window.__toasts = window.__toasts || [];
if (!window.__toastWrapped && typeof showToast === 'function') {
  const orig = showToast; window.__toastWrapped = true;
  showToast = function(m, t, d) { window.__toasts.push(String(m)); return orig.apply(this, arguments); };
}
`;
async function helpers(app) { await app.page.evaluate(PAGE_HELPERS); }
function row(db) { return db.tables.abps_workspace.get('main'); }
function writes(db, uid) { return db.log.filter(o => o.uid === uid && o.table === 'abps_workspace' && ['update', 'insert', 'upsert'].includes(o.action)); }

module.exports = { H, APP, seedPayload, check, summary, realErrors, open, helpers, row, writes };
