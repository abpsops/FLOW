/* Integration-pass fixes: refreshReports KPIs, per-nomination checklist
   dedupe, Delivery Log deletion tombstones across two operators, and
   nuclearClear resets. node fix.test.js [appDir] */
const path = require('path');
const U = require('../r3/util.js');
const { H, seedPayload, check, summary, realErrors, row } = U;
const appDir = process.argv[2] || U.APP;
const open = (browser, db, uid, opts) => H.openApp(browser, db, Object.assign({ appDir, uid }, opts || {}));

function monthKey(t) { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

(async () => {
  const browser = await H.launch();
  const errs = [];

  // ── 1. refreshReports ──
  {
    const db = H.createDb({ workspace: seedPayload() });
    const A = await open(browser, db, 'user-operator');
    const r = await A.page.evaluate(() => {
      const now = new Date().toISOString();
      _reportPort = 'ALL';
      _savedSupplies = [
        { id: 's1', vessel: 'A', supplyDate: now, vlsfoAct: 100, mgoAct: 10, supplied: true },
        { id: 's2', vessel: 'B', supplyDate: now, vlsfoAct: 0, vlsfoActual: 300, mgoAct: 0, supplied: true }, // actual 0 is real
        { id: 's3', vessel: 'C', supplyDate: now, vlsfoAct: 500, mgoAct: 50, supplied: false },              // draft — not delivered
      ];
      _archives = { 2025: { Jan: { records: [{ id: 'a1', vessel: 'D', supplyDate: '2025-01-05', vlsfoAct: 200, mgoAct: 5 }], archivedAt: '2025-02-01T00:00:00Z', month: 0, year: 2025 } } };
      refreshReports();
      const t = id => document.getElementById(id).textContent;
      return { v: t('rep-total-vlsfo'), m: t('rep-total-lsmgo'), ops: t('rep-ops-count'), exp: fmtMT(300) + ' MT', expM: fmtMT(15) + ' MT' };
    });
    check(r.v === r.exp && r.m === r.expM && r.ops === '3', 'refreshReports: supplied live + archived, actual qty (0 kept), drafts excluded ' + JSON.stringify(r));
    errs.push(...realErrors(A));
    await A.ctx.close();
  }

  // ── 2. renderChecklist never drops locked/other-nomination records ──
  {
    const db = H.createDb({ workspace: seedPayload() });
    const A = await open(browser, db, 'user-operator');
    const r = await A.page.evaluate(() => {
      const d0 = new Date('2026-10-20T08:00:00Z'), day = 864e5;
      const mk = (uid, o) => Object.assign({ uid, sno: 1, vessel: 'SAME', nomV: 100, nomM: null, actV: '', actM: '', supplied: false, notes: '', bargeLabel: 'Barge 1', supplyDate: d0.toISOString(), state: 'draft', lockedAt: null }, o);
      _checklistRecords = {
        L1: mk('L1', { nomUid: 'n1', state: 'completed', lockedAt: Date.now(), supplied: true, actV: '100' }),
        L1b: mk('L1b', { nomUid: 'n1' }),                                                  // open dup of a completed nomination → drop
        O2: mk('O2', { nomUid: 'n2', supplyDate: new Date(+d0 + 5 * day).toISOString() }),  // other nomination, same name → keep
        LL: mk('LL', { state: 'completed', lockedAt: Date.now(), supplied: true, supplyDate: new Date(+d0 + 30 * day).toISOString() }), // legacy locked
        LL2: mk('LL2', { state: 'completed', lockedAt: Date.now(), supplied: true, supplyDate: new Date(+d0 + 30 * day).toISOString() }), // second legacy locked, same day
        v_same: mk('v_same', { supplyDate: new Date(+d0 + 10 * day).toISOString() }),                      // legacy open call 1
        v_same__resupply_x: mk('v_same__resupply_x', { supplyDate: new Date(+d0 + 20 * day).toISOString() }), // legacy open call 2
        v_dup: mk('v_dup', { supplyDate: new Date(+d0 + 31 * day).toISOString() }),                       // legacy open, same supply as LL → drop
      };
      renderChecklist([]);
      return { keys: Object.keys(_checklistRecords).sort(), rows: document.querySelectorAll('#checklist-rows tbody tr[id^="cl-row-"]').length };
    });
    const want = ['L1', 'LL', 'LL2', 'O2', 'v_same', 'v_same__resupply_x'];
    check(JSON.stringify(r.keys) === JSON.stringify(want), 'checklist dedupe keeps every locked record and each distinct nomination ' + JSON.stringify(r));
    errs.push(...realErrors(A));
    await A.ctx.close();
  }

  // ── 3. Delivery Log tombstones across two operators ──
  {
    const now = Date.now();
    const mk = (uid, vessel, t) => ({ id: 'sup_' + uid, checklistUid: uid, vessel, dateStr: 'x', supplyDate: new Date(t).toISOString(), barge: 'Barge 1', vlsfoAct: 100, mgoAct: 0, loggedAt: new Date(t).toISOString() });
    const key = monthKey(now);
    const dl = {}; dl[key] = { timely: [mk('c1', 'TRACKED', now - 864e5), mk('c2', 'TRACKED', now - 2 * 864e5)], delayed: [mk('c3', 'TRACKED', now - 3 * 864e5)], disputes: [Object.assign(mk('c1', 'TRACKED', now - 864e5), { remarks: 'short' })] };
    const db = H.createDb({ workspace: seedPayload({ deliveryLog: dl }) });
    const A = await open(browser, db, 'user-operator');
    const B = await open(browser, db, 'user-operator2');
    await A.page.waitForTimeout(500); await B.page.waitForTimeout(500);
    const liveCount = (p) => p.evaluate((key) => {
      const m = _deliveryLog[key] || {};
      const live = ['timely', 'delayed', 'disputes'].map(b => _dlLive(m[b]).filter(e => e.checklistUid === 'c1').length);
      const tr = computeVesselTrackRecord('TRACKED');
      return { live: live.reduce((a, b) => a + b, 0), total: tr ? tr.total : 0, disputes: tr ? tr.disputes.length : 0 };
    }, key);
    check((await liveCount(B.page)).live === 2, 'B starts with c1 logged (timely + dispute)');

    // A deletes the completed supply's log entries and saves.
    await A.page.evaluate(async () => { _removeDeliveryLogEntries('c1'); await saveSharedState(); });
    const cloud = row(db).payload.state.deliveryLog[key];
    check(cloud.removed && cloud.removed.c1 && cloud.removed.c1.deletedAt && !cloud.timely.concat(cloud.disputes).some(e => e.checklistUid === 'c1'), 'cloud holds a tombstone for c1 and no c1 entries');
    const a1 = await liveCount(A.page);
    check(a1.live === 0 && a1.total === 2 && a1.disputes === 0, 'A: c1 gone from Delivery Log and Track Record ' + JSON.stringify(a1));

    // B (still holding c1 live) edits something else and saves → merge.
    await B.page.evaluate(async () => { const c = document.querySelector('.vcard[id^="vessel-"]'); document.getElementById(c.id.replace('vessel-', 'v') + '-remarks').value = 'B edit'; await saveSharedState(); });
    const b1 = await liveCount(B.page);
    check(b1.live === 0 && b1.total === 2, 'B: deletion arrived through the merge, not resurrected ' + JSON.stringify(b1));
    const cloud2 = row(db).payload.state.deliveryLog[key];
    check(!cloud2.timely.some(e => e.checklistUid === 'c1' && !e.deleted) && !cloud2.disputes.some(e => e.checklistUid === 'c1' && !e.deleted), 'cloud still has no live c1 after B\'s save');

    // A device that only knows the old live copy (stale localStorage) loading
    // the workspace: the additive applyState merge must honour the tombstone.
    const stale = {}; stale[key] = dl[key];
    const C = await open(browser, db, 'user-operator2', { localStorage: { abps_delivery_log_v1: JSON.stringify(stale) } });
    await C.page.waitForTimeout(500);
    await C.page.evaluate(() => _mergeDeliveryLog(JSON.parse(JSON.stringify(_deliveryLog)))); // idempotent
    const c1 = await liveCount(C.page);
    check(c1.live === 0, 'fresh load with stale local copy: tombstone wins ' + JSON.stringify(c1));
    const dlText = await C.page.evaluate(() => { showPage('deliverylog'); renderDeliveryLog(); return document.getElementById('dl-count-timely').textContent + '/' + document.getElementById('dl-count-disputes').textContent; });
    check(dlText === '1/0', 'Delivery Log page counts ignore tombstones (' + dlText + ')');
    await C.page.evaluate(async () => { await saveSharedState(); });
    check(!row(db).payload.state.deliveryLog[key].timely.some(e => e.checklistUid === 'c1' && !e.deleted), 'stale device save does not push c1 back');

    // Re-logging after a deletion (newer) beats the tombstone everywhere.
    await A.page.evaluate(async () => { await _pollOnce(true); _logDelivery({ uid: 'c1', vessel: 'TRACKED', bargeLabel: 'Barge 1', isDelayed: false, notes: '' }, { id: 'sup_c1b', supplyDate: new Date().toISOString(), dateStr: 'y', vlsfoAct: 50, mgoAct: 0 }); await saveSharedState(); });
    await B.page.evaluate(() => _pollOnce(true));
    const b2 = await liveCount(B.page);
    check(b2.live === 1, 're-logged entry (newer than tombstone) reaches B ' + JSON.stringify(b2));
    // Merge unit: older tombstone vs newer live and vice versa.
    const mu = await B.page.evaluate(() => {
      const save = _deliveryLog;
      _deliveryLog = { '2026-01': { timely: [{ checklistUid: 'u', vessel: 'V', loggedAt: '2026-01-02T00:00:00Z', updatedAt: 2000 }], delayed: [], disputes: [] } };
      _mergeDeliveryLog({ '2026-01': { timely: [], removed: { u: { deletedAt: 'x', updatedAt: 1000 } } } });
      const keepLive = _dlLive(_deliveryLog['2026-01'].timely).length;
      _mergeDeliveryLog({ '2026-01': { timely: [], removed: { u: { deletedAt: 'x', updatedAt: 3000 } } } });
      const nowDead = _dlLive(_deliveryLog['2026-01'].timely).length;
      // an older live copy arriving after the deletion stays dead
      _mergeDeliveryLog({ '2026-01': { timely: [{ checklistUid: 'u', vessel: 'V', loggedAt: '2026-01-02T00:00:00Z', updatedAt: 2000 }] } });
      const staysDead = _dlLive(_deliveryLog['2026-01'].timely).length;
      _deliveryLog = save;
      return { keepLive, nowDead, staysDead };
    });
    check(mu.keepLive === 1 && mu.nowDead === 0 && mu.staysDead === 0, 'merge: newer of live/tombstone wins ' + JSON.stringify(mu));
    errs.push(...realErrors(A), ...realErrors(B), ...realErrors(C));
    await A.ctx.close(); await B.ctx.close(); await C.ctx.close();
  }

  // ── 4. nuclearClear resets reloads + trash bin ──
  {
    const db = H.createDb({ workspace: seedPayload({ bargeReloads: [{ id: 'rl1', bargeId: 1, v: 100, m: 0, at: Date.now() }] }) });
    const A = await open(browser, db, 'user-operator', { localStorage: { abps_trash_bin_v1: JSON.stringify([{ id: 1, trashedAt: Date.now(), def: { name: 'T' } }]) } });
    A.page.on('dialog', d => d.accept().catch(() => {}));
    const before = await A.page.evaluate(() => ({ rl: _bargeReloads.length, tr: _trashBin.length }));
    const r = await A.page.evaluate(async () => {
      await nuclearClear();
      await _waitForSaveIdle();
      return { rl: _bargeReloads.length, tr: _trashBin.length, ls: localStorage.getItem('abps_trash_bin_v1'), dlLive: Object.values(_deliveryLog).reduce((n, m) => n + _dlLive(m.timely).length, 0) };
    });
    const cloud = row(db) && row(db).payload.state;
    check(before.rl === 1 && before.tr === 1 && r.rl === 0 && r.tr === 0 && !r.ls, 'nuclearClear resets _bargeReloads and the trash bin ' + JSON.stringify({ before, r }));
    check(cloud && Array.isArray(cloud.bargeReloads) && cloud.bargeReloads.length === 0, 'cleared reloads pushed to cloud');
    errs.push(...realErrors(A));
    await A.ctx.close();
  }

  check(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 5)));
  await browser.close();
  summary('fix.test');
})().catch(e => { console.error(e); process.exit(2); });
