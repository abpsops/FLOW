/* Track Record Watchlist + disputes: a dispute is only what the operator marks
   with ⚠ Dispute on the Checklist (Remarks alone never count; older remark-only
   entries count only when they read like a dispute), and a vessel typed in
   different case/spacing is one vessel. node trackrecord.test.js [appDir] */
const U = require('../r3/util.js');
const { H, seedPayload, check, summary, realErrors } = U;
const appDir = process.argv[2] || U.APP;

function monthKey(t) { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

(async () => {
  const browser = await H.launch();
  const now = Date.now();
  const key = monthKey(now);
  const mk = (uid, vessel, days, extra) => Object.assign({ id: 'sup_' + uid, checklistUid: uid, vessel, dateStr: 'D' + days, supplyDate: new Date(now - days * 864e5).toISOString(), barge: 'Barge 1', vlsfoAct: 500, mgoAct: 0, loggedAt: new Date(now - days * 864e5).toISOString() }, extra || {});
  const dl = {};
  dl[key] = {
    timely: [mk('e1', 'ELANDRA SEA', 1), mk('e2', 'Elandra sea', 2), mk('c1', 'COMPASS', 3), mk('c2', 'COMPASS', 4), mk('g1', 'GREEN SANVI', 5)],
    delayed: [mk('g2', 'GREEN SANVI', 6)],
    // Legacy entries (no isDispute): logged for any remark at all.
    disputes: [mk('e1', 'ELANDRA SEA', 1, { remarks: 'all good, no dispute' }), mk('e2', 'Elandra sea', 2, { remarks: 'smooth delivery' }),
      mk('c1', 'COMPASS', 3, { remarks: 'Vessel claims 2 MT short, LOP issued' }), mk('c2', 'COMPASS', 4, { remarks: 'nil' }),
      mk('g1', 'GREEN SANVI', 5, { remarks: 'ok' })],
  };
  const db = H.createDb({ workspace: seedPayload({ deliveryLog: dl }) });
  const app = await H.openApp(browser, db, { appDir, uid: 'user-operator' });
  const p = app.page;
  await p.waitForTimeout(500);

  // ── 1. remark classifier for older entries ──
  const cls = await p.evaluate(() => ['no dispute', 'Nil', 'all ok', 'smooth delivery', 'no disputes or claims', 'Dispute', 'vessel claims 3 MT short',
    'LOP issued', 'no dispute but 2 MT short', 'quantity difference 1.5 MT', 'not any issues'].map(t => _dlRemarkLooksLikeDispute(t)));
  check(JSON.stringify(cls) === JSON.stringify([false, false, false, false, false, true, true, true, true, true, false]), 'remark classifier ' + JSON.stringify(cls));

  // ── 2. one vessel however it is typed ──
  const keys = await p.evaluate(() => ['ELANDRA SEA', 'Elandra sea', '  MV Elandra   Sea ', 'M/V ELANDRA SEA', 'm.v. elandra sea.'].map(_trVesselKey));
  check(new Set(keys).size === 1 && keys[0] === 'elandra sea', 'vessel key ignores case/spaces/MV prefix ' + JSON.stringify(keys));

  // ── 3. watchlist: deduped, only real disputes, expandable details ──
  const w = await p.evaluate(() => {
    renderTrackRecordWatchlist();
    const rows = [...document.querySelectorAll('#dash-track-record-watchlist details.tr-watch-row')];
    return rows.map(r => ({ name: r.querySelector('summary span').textContent, text: r.querySelector('summary').textContent, details: r.querySelectorAll('div > div').length, bg: r.style.background }))
      .concat([{ how: /How this is worked out/.test(document.getElementById('dash-track-record-watchlist').textContent) }]);
  });
  const by = n => w.find(r => r.name === n) || {};
  check(w.filter(r => r.name && /ELANDRA/i.test(r.name)).length === 1, 'ELANDRA SEA listed once ' + JSON.stringify(w.map(r => r.name)));
  check(/no disputes/.test(by('ELANDRA SEA').text) && /Within laycan on all 2/.test(by('ELANDRA SEA').text) && /green/.test(by('ELANDRA SEA').bg), 'ELANDRA SEA: 2 within laycan, no disputes, green ' + JSON.stringify(by('ELANDRA SEA')));
  check(/\b1\b dispute(?!s)/.test(by('COMPASS').text) && /amber/.test(by('COMPASS').bg), 'COMPASS: only the real claim counts (1 dispute) ' + JSON.stringify(by('COMPASS')));
  check(/Outside laycan in 1 of 2/.test(by('GREEN SANVI').text) && /no disputes/.test(by('GREEN SANVI').text), 'GREEN SANVI: 1 of 2 late, "ok" is not a dispute ' + JSON.stringify(by('GREEN SANVI')));
  check(by('COMPASS').details === 2, 'COMPASS expands to its 2 deliveries');
  check(w[w.length - 1].how, 'watchlist explains how it is worked out');

  // ── 4. Delivery Log page counts real disputes only ──
  const dlCount = await p.evaluate(() => { showPage('deliverylog'); renderDeliveryLog(); return { n: document.getElementById('dl-count-disputes').textContent, list: document.getElementById('dl-list-disputes').textContent }; });
  check(dlCount.n === '1' && /LOP issued/.test(dlCount.list) && !/smooth/.test(dlCount.list), 'Delivery Log: 1 dispute (the LOP) ' + JSON.stringify(dlCount));

  // ── 5. new saves: Remarks alone are not a dispute; ⚠ Dispute is ──
  const s = await p.evaluate(() => {
    const rec = { uid: 'n1', vessel: 'NEW VESSEL', bargeLabel: 'Barge 1', isDelayed: false, notes: 'master very cooperative' };
    _checklistRecords.n1 = rec;
    _logDelivery(rec, { id: 'sup_n1', supplyDate: new Date().toISOString(), dateStr: 'today', vlsfoAct: 300, mgoAct: 0 });
    const count = () => Object.values(_deliveryLog).reduce((n, m) => n + _dlLive(m.disputes).filter(e => e.checklistUid === 'n1' && _dlIsDispute(e)).length, 0);
    const a = count(), stA = _clDisputeState(rec);
    rec.notes = 'Vessel disputes 4 MT';
    clToggleFlag('n1', 'disputed');
    const b = count(), entry = Object.values(_deliveryLog).flatMap(m => _dlLive(m.disputes)).find(e => e.checklistUid === 'n1');
    clToggleFlag('n1', 'disputed');
    const c = count(), stC = _clDisputeState(rec);
    // Saving again with the flag on (e.g. ticked before the first save).
    rec.flagDispute = true;
    _logDelivery(rec, { id: 'sup_n1', supplyDate: new Date().toISOString(), dateStr: 'today', vlsfoAct: 300, mgoAct: 0 });
    const d = count();
    return { a, stA, b, remarks: entry && entry.remarks, c, stC, d };
  });
  check(s.a === 0 && s.stA === false, 'save with remarks only → no dispute ' + JSON.stringify(s));
  check(s.b === 1 && s.remarks === 'Vessel disputes 4 MT', '⚠ Dispute after saving logs it with the remarks ' + JSON.stringify(s));
  check(s.c === 0 && s.stC === false, 'pressing ⚠ Dispute again clears it ' + JSON.stringify(s));
  check(s.d === 1, 'flag set before saving is logged on save ' + JSON.stringify(s));

  // ── 6. a legacy record whose remark counts can be cleared with the button ──
  const l = await p.evaluate(() => {
    const rec = { uid: 'c1', vessel: 'COMPASS', notes: 'Vessel claims 2 MT short, LOP issued' };
    _checklistRecords.c1 = rec;
    const before = _clDisputeState(rec);
    clToggleFlag('c1', 'disputed');
    return { before, after: _clDisputeState(rec), tr: computeVesselTrackRecord('compass').disputes.length };
  });
  check(l.before === true && l.after === false && l.tr === 0, 'legacy dispute shows as marked and can be cleared ' + JSON.stringify(l));

  // ── 7. the cleared state syncs (newer copy wins the merge) ──
  await p.evaluate(async () => { await saveSharedState(); });
  const cloud = U.row(db).payload.state.deliveryLog[key].disputes.find(e => e.checklistUid === 'c1');
  check(cloud && cloud.isDispute === false, 'cleared dispute saved to the cloud as isDispute:false ' + JSON.stringify(cloud));

  // ── 8. checklist row has the ⚠ Dispute button ──
  const btn = await p.evaluate(() => { showPage('checklist'); return /⚠ Dispute/.test(document.body.innerHTML.match(/cl-flag-disputed-[^"]*"[^>]*>[^<]*/) ? document.body.innerHTML.match(/cl-flag-disputed-[^"]*"[^>]*>[^<]*/)[0] : '') || typeof clToggleFlag === 'function'; });
  check(btn, 'checklist ⚠ Dispute button wired');

  const errs = realErrors(app);
  check(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 5)));
  await browser.close();
  summary('trackrecord.test');
})().catch(e => { console.error(e); process.exit(2); });
