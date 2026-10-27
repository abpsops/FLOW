/* Audit "fix first" — the small ones:
   • nomination import never freezes on a line that starts with a date-like token it rejects
   • a hand-picked barge never pins the other "Auto" nominations (no remembered preferred barge)
   • a double-click on Save in the Reload dialog records the reload once; negatives refused
   • "Save Parameters" on a barge card keeps the manual ROB correction unless Opening ROB changed
   • removing a barge asks first, and takes its ROB correction / baked ids / blocks with it
   node suites/fix2/small.test.js [appDir] */
const H = require('../../harness/harness.js');
const appDir = process.argv[2] || H.APP_DIR;

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) pass++; else fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info).slice(0, 600)));
}
const HELPERS = () => {
  const p = n => String(n).padStart(2, '0');
  window.__fmt = d => p(d.getDate()) + ' ' + MO[d.getMonth()] + ' ' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  window.__at = h => { const d = new Date(); d.setHours(8, 0, 0, 0); d.setDate(d.getDate() + 1); return __fmt(new Date(d.getTime() + h * 3600000)); };
  window.__reset = function () {
    const o = document.getElementById('flow-welcome-overlay'); if (o) o.style.display = 'none';
    document.querySelectorAll('.vcard[id^="vessel-"]').forEach(c => c.remove());
    (_barges || []).slice().forEach(b => rmBarge(b.id));
    _lastSched = []; _checklistRecords = {}; _savedSupplies = []; _deliveryLog = {}; _loadingRecords = []; _bargeBlocks = []; _bargeReloads = []; _manualROB = {}; _bakedSupplyIds = {};
  };
  window.__card = name => [...document.querySelectorAll('.vcard[id^="vessel-"]')].find(c => document.getElementById(c.id.replace('vessel-', 'v') + '-name').value === name);
  window.__id = name => __card(name).id.replace('vessel-', '');
};
async function scenario(browser, name, fn, opts) {
  const db = H.createDb();
  const dialogs = [];
  const holder = { mode: 'accept' };
  const app = await H.openApp(browser, db, Object.assign({ appDir, uid: 'user-operator', onDialog: async d => { dialogs.push(d.type() + ': ' + d.message()); try { holder.mode === 'accept' ? await d.accept() : await d.dismiss(); } catch (e) {} } }, opts || {}));
  await app.page.evaluate(HELPERS);
  await app.page.evaluate(() => __reset());
  try { await fn(app.page, app, db, dialogs, holder); }
  catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
  const errs = app.errors.filter(e => !/capacitorExports/.test(e));
  check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
  await app.ctx.close();
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await H.launch();

  await scenario(browser, 'S1 import never freezes', async (page) => {
    const samples = ['MV TEST ONE\n0.5% VLSFO 500 MT\nETA TBA\nFujairah', '0.5% VLSFO 500 mt for mv TEST TWO, eta tbc', 'MV X\nVLSFO 500 MT\n0.1% LSMGO 100 MT',
      'MV Y\n5.0 MT VLSFO', 'MV Z\n31/02 VLSFO 500', 'MV Q\n00 Oct', 'MV W\n14.30 hrs barge ready\n500 MT VLSFO'];
    for (const t of samples) {
      const r = await Promise.race([page.evaluate(t => { const t0 = performance.now(); const out = _parseNominationText(t); return { ms: performance.now() - t0, n: (out && (out.rows || out).length) || 0 }; }, t), sleep(6000).then(() => 'HUNG')]);
      check('S1 parses without hanging: ' + JSON.stringify(t).slice(0, 50), r !== 'HUNG' && r.ms < 2000, r);
      if (r === 'HUNG') return;
    }
    // the unlabelled-date scan still finds a real date in a one-liner, also at the start of a line
    const r2 = await page.evaluate(() => {
      const a = _parseNominationText('MV SEA STAR 500 MT VLSFO arriving 28 Oct 2026 0800');
      const b = _parseNominationText('MV SEA STAR\n28 Oct 2026 0800\n500 MT VLSFO');
      const first = o => (o.rows || o)[0] || {};
      return { a: first(a).eta, b: first(b).eta };
    });
    check('S1 a date without an ETA label is still found (mid-line and at the start of a line)', /28 Oct 2026/.test(r2.a || '') && /28 Oct 2026/.test(r2.b || ''), r2);
    // random fuzz: lines that start with numbers/dates, no ETA label
    const fz = await Promise.race([page.evaluate(() => {
      let seed = 7; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const toks = ['0.5%', '0.1%', '5.0', '31/02', '00 Oct', '12/13', '99/99/9999', '30 Feb', '14.30', 'VLSFO', 'LSMGO', '500', 'MT', 'MV', 'SEA', 'STAR', 'ETA', 'TBA', 'Fujairah', '28 Oct', '1/11'];
      const t0 = performance.now(); let n = 0;
      for (let i = 0; i < 300; i++) {
        const lines = []; for (let l = 0; l < 4; l++) { const w = []; for (let k = 0; k < 4; k++) w.push(toks[Math.floor(R() * toks.length)]); lines.push(w.join(' ')); }
        _parseNominationText(lines.join('\n')); n++;
      }
      return { n, ms: performance.now() - t0 };
    }), sleep(30000).then(() => 'HUNG')]);
    check('S1 300 random messages that start lines with dates/numbers all finish', fz !== 'HUNG' && fz.n === 300, fz);
  });

  await scenario(browser, 'S2 Auto stays Auto', async (page) => {
    const r = await page.evaluate(() => {
      addBarge({ name: 'FNSA 10', vrob: 4000, mrob: 800 }); addBarge({ name: 'FNSA 11', vrob: 4000, mrob: 800 });
      const b11 = String(_barges[1].id);
      addVessel({ name: 'AUTO ONE', type: 'VLSFO', qty: 500, eta: __at(0) });
      addVessel({ name: 'AUTO TWO', type: 'VLSFO', qty: 500, eta: __at(1) });
      addVessel({ name: 'PINNED', type: 'VLSFO', qty: 500, eta: __at(2) });
      const sel = document.getElementById('v' + __id('PINNED') + '-barge'); sel.value = b11; sel.dispatchEvent(new Event('change', { bubbles: true }));
      const out = {};
      const pins = () => ['AUTO ONE', 'AUTO TWO', 'PINNED'].map(n => document.getElementById('v' + __id(n) + '-barge').value);
      out.afterPick = pins();
      addVessel({ name: 'NEW ONE', type: 'VLSFO', qty: 500, eta: __at(3) });            // Add Nomination path
      out.afterAdd = pins().concat(document.getElementById('v' + __id('NEW ONE') + '-barge').value);
      document.getElementById('b' + _barges[0].id + '-name').value = 'FNSA 10X'; renameBargeDropdowns();   // a barge name keystroke
      out.afterRename = pins();
      applyState(captureCurrentState(), true);                                          // what a reload / pull does
      out.afterReload = pins();
      out.cloud = captureCurrentState().vessels.map(v => [v.name, v.bargeId]);
      calculate();
      out.plan = _lastSched.map(i => [i.name, i.bargeLabel]);
      out.storage = localStorage.getItem('abps_preferred_barge');
      return out;
    });
    check('S2 picking a barge on one card leaves the Auto cards on Auto', JSON.stringify(r.afterPick) === JSON.stringify(['', '', r.afterPick[2]]) && r.afterPick[2] !== '', r);
    check('S2 …also after Add Nomination, a barge rename and a reload (incl. the new card)', JSON.stringify(r.afterAdd) === JSON.stringify(['', '', r.afterPick[2], '']) && JSON.stringify(r.afterRename) === JSON.stringify(r.afterPick) && JSON.stringify(r.afterReload) === JSON.stringify(r.afterPick), r);
    check('S2 the shared state keeps them Auto and Generate spreads them over both barges', r.cloud.filter(c => c[1] === '').length === 3 && new Set(r.plan.map(p => p[1])).size === 2, r);
    check('S2 no remembered preferred barge is written', r.storage === null, r.storage);
  });

  await scenario(browser, 'S3 reload saved once', async (page, app, db) => {
    db.intercept = op => { if (op.table === 'abps_workspace' && ['update', 'insert', 'upsert'].includes(op.action)) return new Promise(r => setTimeout(() => r(null), 600)); return null; };
    const r = await page.evaluate(async () => {
      addBarge({ name: 'FNSA 10', vrob: 1000, mrob: 800 }); calculate === undefined;
      _bargeConfig = getBarges();
      const id = _barges[0].id;
      openReloadModal(id);
      document.getElementById('reload-vlsfo').value = '1000';
      await Promise.all([saveReloadQty(), saveReloadQty()]);                // a double-click while the save is in flight
      const out = { events: _bargeReloads.length, live: Math.round(getAllLiveROBs()[id].liveV) };
      openReloadModal(id);
      document.getElementById('reload-vlsfo').value = '-200'; document.getElementById('reload-mgo').value = '100';
      await saveReloadQty();
      out.afterNegative = _bargeReloads.length;
      closeReloadModal();
      return out;
    });
    check('S3 a double-click on Save records the reload once (ROB +1000, not +2000)', r.events === 1 && r.live === 2000, r);
    check('S3 a negative reloaded quantity is refused', r.afterNegative === 1, r);
  });

  await scenario(browser, 'S4 Save Parameters keeps the ROB correction', async (page) => {
    const r = await page.evaluate(async () => {
      addBarge({ name: 'FNSA 10', vrob: 4000, mrob: 800 }); _bargeConfig = getBarges();
      const id = _barges[0].id;
      _manualROB[id + '_final'] = { v: 3333, m: 777, reason: 'dip', editedAt: new Date().toISOString(), editedBy: 'ROB Update', atIds: _robOverrideAtIds(id) };
      await saveManualROB();
      const out = { before: Math.round(getAllLiveROBs()[id].liveV) };
      toggleBargeEdit(id);
      document.getElementById('b' + id + '-vbuf').value = '600';
      saveBargeEdit(id);
      out.afterBuffer = Math.round(getAllLiveROBs()[id].liveV); out.keyKept = !!_manualROB[id + '_final'];
      out.cloudKept = !!(captureCurrentState().manualROB || {})[id + '_final'];
      toggleBargeEdit(id);
      document.getElementById('b' + id + '-vrob').value = '4500';
      saveBargeEdit(id);
      out.afterOpening = Math.round(getAllLiveROBs()[id].liveV); out.keyAfterOpening = !!_manualROB[id + '_final'];
      return out;
    });
    check('S4 changing only a buffer keeps the "Update ROB" correction (here and in the shared state)', r.before === 3333 && r.afterBuffer === 3333 && r.keyKept && r.cloudKept, r);
    check('S4 changing the Opening ROB still replaces it (unchanged behaviour)', r.afterOpening === 4500 && !r.keyAfterOpening, r);
  });

  await scenario(browser, 'S5 removing a barge', async (page, app, db, dialogs, holder) => {
    const r = await page.evaluate(() => {
      addBarge({ name: 'FNSA 10', vrob: 4000, mrob: 800 }); addBarge({ name: 'FNSA 11', vrob: 2000, mrob: 300 }); _bargeConfig = getBarges();
      const b2 = _barges[1].id;
      _manualROB[b2 + '_final'] = { v: 2500, m: 400, atIds: [] };
      _bargeReloads.push({ id: 'rl_t', bargeId: b2, v: 1000, m: 0, at: Date.now(), note: 'Reload' });
      _bargeBlocks.push({ id: 'blk_t', bargeId: b2, bargeName: 'FNSA 11', start: new Date().toISOString(), end: new Date(Date.now() + 864e5).toISOString(), reason: 'Dry dock' });
      _bakedSupplyIds[b2] = ['old1'];
      addVessel({ name: 'ATLAS TRADER', type: 'VLSFO', qty: 500, eta: __at(0), bargeId: String(b2) });
      return { b2 };
    });
    holder.mode = 'dismiss';
    await page.evaluate(id => document.querySelector('#barge-' + id + ' .rm-btn').click(), r.b2);
    const kept = await page.evaluate(id => !!document.getElementById('barge-' + id) && _barges.length === 2, r.b2);
    check('S5 Remove asks first (naming the barge and what goes with it); Cancel keeps the barge', kept && dialogs.some(d => /^confirm: Remove barge "FNSA 11"/.test(d) && /1 nomination assigned to it/.test(d) && /1 recorded reload/.test(d) && /manual ROB correction/.test(d) && /1 Unavailable block/.test(d)), dialogs);
    holder.mode = 'accept';
    await page.evaluate(id => document.querySelector('#barge-' + id + ' .rm-btn').click(), r.b2);
    const after = await page.evaluate(id => {
      const st = captureCurrentState();
      const out = { barges: _barges.length, manual: Object.keys(_manualROB), baked: Object.keys(_bakedSupplyIds), blocks: _bargeBlocks.length, reloads: (st.bargeReloads || []).length, pin: st.vessels[0].bargeId };
      // reload, then a new barge that gets the same id inherits nothing
      applyState(st, true);
      addBarge({ id: id, name: 'NEW BARGE', vrob: 1500, mrob: 200 }); _bargeConfig = getBarges();
      out.newLive = [Math.round(getAllLiveROBs()[id].liveV), Math.round(getAllLiveROBs()[id].liveM)];
      out.newBlocks = _blocksForBarge(id, 'NEW BARGE').length;
      return out;
    }, r.b2);
    // Its baked-supply list stays (a barge added back under the same name must not have
    // those old supplies deducted again — supplyedit S12); '<id>_measured' marks them as in the
    // fresh figure of a barge added back, so correcting them later moves nothing.
    check('S5 removal takes its correction, blocks and reloads with it, keeps its baked list; the pinned nomination goes back to Auto', after.barges === 1 && !after.manual.some(k => k.startsWith(r.b2 + '_') && k !== r.b2 + '_measured') && after.manual.includes(r.b2 + '_measured') && after.baked.includes(String(r.b2)) && after.blocks === 0 && after.reloads === 0 && after.pin === '', after);
    check('S5 a new barge given the same id starts clean (its own opening ROB, no blocks)', after.newLive[0] === 1500 && after.newLive[1] === 200 && after.newBlocks === 0, after);
  });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
