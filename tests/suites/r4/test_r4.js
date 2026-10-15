/* Targeted tests for the R4 fixes (timeline / availability engine / checklist).
   node test_r4.js [appDir]   — default appDir = the repository root
   Each scenario runs in a fresh app context (empty workspace, operator). */
const path = require('path');
const H = require(path.join(__dirname, '..', '..', 'harness', 'harness.js'));
const appDir = process.argv[2] || H.APP_DIR;
const only = process.argv[3] || '';

const results = [];
function check(name, cond, info) {
  results.push({ name, ok: !!cond, info });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + JSON.stringify(info)));
}

// In-page helpers installed into every scenario.
const PAGE_HELPERS = () => {
  window.__fmt = function (d) {
    const p = n => String(n).padStart(2, '0');
    return d.getDate() + ' ' + MO[d.getMonth()] + ' ' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };
  // hours from now, rounded to the minute, never exactly 00:00 (= "no firm ETA")
  window.__at = function (hrs) {
    const d = new Date(Date.now() + hrs * 3600000); d.setSeconds(0, 0);
    if (d.getHours() === 0 && d.getMinutes() === 0) d.setMinutes(7);
    return d;
  };
  window.__reset = function () {
    document.querySelectorAll('.vcard[id^="vessel-"]').forEach(c => c.remove());
    (_barges || []).slice().forEach(b => rmBarge(b.id));
    _lastSched = []; _checklistRecords = {}; _savedSupplies = []; _deliveryLog = {};
  };
  window.__barge = function (def) { addBarge(def); return _barges[_barges.length - 1].id; };
  window.__vessel = function (def) {
    const d = Object.assign({ area: 'FUJ-A', lc: '', paq: 'no' }, def);
    if (d.etaHrs !== undefined) d.eta = __fmt(__at(d.etaHrs));
    addVessel(d);
    const cards = document.querySelectorAll('.vcard[id^="vessel-"]');
    return cards[cards.length - 1].dataset.nomUid;
  };
  window.__nsc = function (v, m, etaHrs, name) {
    document.getElementById('nsc-vessel-name').value = name || 'CHECK VSL';
    document.getElementById('nsc-req-v').value = v || '';
    document.getElementById('nsc-req-m').value = m || '';
    document.getElementById('nsc-vessel-eta').value = etaHrs === null || etaHrs === undefined ? '' : __fmt(__at(etaHrs));
    checkNSCUnified();
    const res = document.getElementById('nsc-unified-result');
    const ids = Object.keys(_nscCheckData);
    return { html: res ? res.innerHTML : '', text: res ? res.textContent : '', data: _nscCheckData[ids[ids.length - 1]] };
  };
};

async function scenario(browser, name, fn) {
  if (only && !name.includes(only)) return;
  const db = H.createDb();
  const holder = { dialogs: [], mode: 'accept' };
  const app = await H.openApp(browser, db, { appDir, uid: 'user-operator', onDialog: async d => {
    holder.dialogs.push(d.type() + ': ' + d.message());
    try { holder.mode === 'accept' ? await d.accept() : await d.dismiss(); } catch (e) {}
  } });
  const page = app.page;
  Object.defineProperty(page, '__dialogs', { get: () => holder.dialogs });
  Object.defineProperty(page, '__dialogMode', { get: () => holder.mode, set: v => { holder.mode = v; } });
  if (process.env.DIAG) page.on('pageerror', e => console.log('STACK', e.stack));
  await page.evaluate(PAGE_HELPERS);
  await page.evaluate(() => __reset());
  try { await fn(page, app); }
  catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
  const errs = app.errors.filter(e => !/capacitorExports/.test(e) && !(name.startsWith('T16') && /INTEGRITY ALERT/.test(e)) && !(name.startsWith('T1 ') && /Unexpected token|Invalid or unexpected/.test(e)));
  check(name + ': no page errors', errs.length === 0, errs.slice(0, 3));
  await app.ctx.close();
}

(async () => {
  const browser = await H.launch();

  /* Task 2 (H5): completion per nomination, re-nominated vessel reappears */
  await scenario(browser, 'T2 renomination', async (page) => {
    const r = await page.evaluate(async () => {
      const b = __barge({ name: 'B1' });
      const u1 = __vessel({ name: 'MV REPEAT', type: 'VLSFO', qty: 500, mgo: 0, etaHrs: 24, bargeId: b });
      const u2 = __vessel({ name: 'MV REPEAT', type: 'VLSFO', qty: 400, mgo: 0, etaHrs: 24 * 20, bargeId: b });
      calculate();
      const recs1 = Object.values(_checklistRecords).filter(r => r.vessel === 'MV REPEAT');
      const first = recs1.find(r => r.nomUid === u1);
      document.getElementById('cl-av-' + first.uid).value = '500';
      await saveChecklistRecord(first.uid);
      const cardsAfterSave = [...document.querySelectorAll('.vcard[id^="vessel-"]')].map(c => c.dataset.nomUid);
      const supply = _savedSupplies.find(s => s.checklistUid === first.uid);
      const dl = Object.values(_deliveryLog).flatMap(m => m.timely.concat(m.delayed));
      // regenerate from the remaining card
      calculate();
      const item2 = _lastSched.find(i => i.nomUid === u2);
      const tlText = document.getElementById('tl').textContent;
      const voyText = document.getElementById('voy-barge-tabs').textContent;
      const recs2 = Object.values(_checklistRecords).filter(r => r.vessel === 'MV REPEAT');
      const clText = document.getElementById('checklist-rows').textContent;
      const btl = _getBargeTimeline(b, 'B1');
      showPage('commandcenter');
      const ccText = document.getElementById('cc-schedule-panel').textContent;
      showPage('dashboard');
      return {
        u1, u2, recs1: recs1.length, cardsAfterSave, supplyNomUid: supply && supply.nomUid, dlNomUid: dl.length && dl[0].nomUid,
        item2: !!item2, item2Done: item2 ? _isScheduleItemCompleted(item2) : null,
        tlHas: tlText.includes('MV REPEAT'), voyHas: voyText.includes('MV REPEAT'),
        recs2: recs2.map(r => ({ nomUid: r.nomUid, state: r.state, locked: !!r.lockedAt })),
        clCount: (clText.match(/MV REPEAT/g) || []).length,
        btl: btl.map(o => o.nomUid), ccHas: ccText.includes('MV REPEAT'),
      };
    });
    check('T2 both nominations get their own checklist row', r.recs1 === 2, r);
    check('T2 save removes only the supplied nomination card', r.cardsAfterSave.length === 1 && r.cardsAfterSave[0] === r.u2, r.cardsAfterSave);
    check('T2 supplyRec + delivery log carry nomUid', r.supplyNomUid === r.u1 && r.dlNomUid === r.u1, r);
    check('T2 re-nominated vessel in schedule & not completed', r.item2 && r.item2Done === false, r);
    check('T2 re-nominated vessel on timeline', r.tlHas);
    check('T2 re-nominated vessel in voyage table', r.voyHas);
    check('T2 checklist: completed + new draft rows', r.recs2.length === 2 && r.recs2.some(x => x.nomUid === r.u2 && !x.locked) && r.recs2.some(x => x.nomUid === r.u1 && x.locked) && r.clCount === 2, r.recs2);
    check('T2 barge busy in _getBargeTimeline', r.btl.includes(r.u2), r.btl);
    check('T2 Command Center shows re-nominated vessel', r.ccHas);
  });

  /* Task 3a: both grades requested, no MGO anywhere -> never "feasible" via a VLSFO-only STS */
  await scenario(browser, 'T3a mgo not dropped', async (page) => {
    const r = await page.evaluate(() => {
      const b1 = __barge({ name: 'B1', vrob: 2000, mrob: 0 });
      const b2 = __barge({ name: 'B2', vrob: 2500, mrob: 0 });
      __vessel({ name: 'DUMMY', type: 'VLSFO', qty: 1, mgo: 0, etaHrs: 24 * 40, bargeId: b1 });
      calculate();
      return __nsc(3000, 500, 48);
    });
    check('T3a verdict is NOT FEASIBLE (MGO cannot be planned)', /NOT FEASIBLE/.test(r.text) && !/SPLIT SUPPLY FEASIBLE/.test(r.text), r.text.slice(-400));
  });

  /* Task 3b: recipient already has enough -> no STS; delayed single barge wins */
  await scenario(browser, 'T3b prefer delayed over sts', async (page) => {
    const r = await page.evaluate(() => {
      const b1 = __barge({ name: 'B1', vrob: 4500, mrob: 900 });
      const b2 = __barge({ name: 'B2', vrob: 500, mrob: 900 });
      __vessel({ name: 'BUSY ONE', type: 'VLSFO', qty: 1000, mgo: 0, etaHrs: 1, bargeId: b1 });
      calculate();
      return __nsc(3000, 0, 3);
    });
    check('T3b no STS proposed', !/STS/.test(r.text), r.text.slice(-300));
    check('T3b delayed start chosen', /DELAYED START FEASIBLE/.test(r.text), r.text.slice(-300));
    check('T3b nomination plan = single delayed entry on B1', r.data && r.data.nominationPlan && r.data.nominationPlan.mode === 'delayed' && r.data.nominationPlan.entries[0].bargeName === 'B1', r.data);
  });

  /* Task 3b: genuine STS starts only once BOTH barges are free (timeline-aware) */
  await scenario(browser, 'T3b sts timing', async (page) => {
    const r = await page.evaluate(() => {
      const b1 = __barge({ name: 'B1', vrob: 2000, mrob: 900 });
      const b2 = __barge({ name: 'B2', vrob: 1500, mrob: 900 });
      __vessel({ name: 'MGO JOB', type: 'MGO', qty: 0, mgo: 600, etaHrs: 2, bargeId: b1 });
      calculate();
      const op = _lastSched.find(i => i.name === 'MGO JOB');
      const res = __nsc(3000, 0, 3);
      return { text: res.text, plan: res.data && res.data.nominationPlan, opEtc: op.etc.toISOString(), travel: _calcParams.travelHrs };
    });
    const ok = r.plan && r.plan.entries.length === 1;
    const supplyAt = ok ? new Date(r.plan.entries[0].eta) : null;
    check('T3b STS plan found', /STS/.test(r.text) && ok, r.text.slice(-300));
    check('T3b STS/supply not before recipient is free', ok && supplyAt.getTime() >= new Date(r.opEtc).getTime() + r.travel * 3600000, { supplyAt, opEtc: r.opEtc });
  });

  /* Task 4: op whose ETC passed but supply not saved keeps its ROB committed */
  await scenario(browser, 'T4 past unsaved op', async (page) => {
    const r = await page.evaluate(() => {
      const b1 = __barge({ name: 'B1', vrob: 4500, mrob: 900, vbuf: 0 });
      __vessel({ name: 'PAST ONE', type: 'VLSFO', qty: 1000, mgo: 0, etaHrs: -30, bargeId: b1 });
      calculate();
      const tlAll = _getBargeTimeline(b1, 'B1', true);
      const tlFuture = _getBargeTimeline(b1, 'B1');
      const fw = computeFreeWindows(b1, 'B1', new Date(), new Date(Date.now() + 7 * 86400000));
      const res = __nsc(4000, 0, null);
      return { all: tlAll.map(o => [o.vessel, o.pastEtc]), fut: tlFuture.length, fw0: fw[0], text: res.text };
    });
    check('T4 committed list includes the past-ETC unsaved op', r.all.length === 1 && r.all[0][1] === true, r.all);
    check('T4 time-gap timeline excludes it', r.fut === 0);
    check('T4 free window ROB estimate already deducts it', r.fw0 && r.fw0.status === 'free' && r.fw0.estV <= 3500, r.fw0);
    check('T4 4000 MT not feasible (only 3500 uncommitted)', /Insufficient/.test(r.text) && /NOT FEASIBLE/.test(r.text), r.text.slice(-300));
  });

  /* Task 5 + 7: no ETA -> feasible at earliest time; Add Nomination button in Final Decision */
  await scenario(browser, 'T5 no eta + T7 add nomination', async (page) => {
    const r = await page.evaluate(() => {
      const b1 = __barge({ name: 'B1', vrob: 4500, mrob: 900 });
      __vessel({ name: 'DUMMY', type: 'VLSFO', qty: 1, mgo: 0, etaHrs: 24 * 40, bargeId: b1 });
      calculate();
      const res = __nsc(1000, 0, null, 'NEW VSL');
      const inline = document.getElementById('nsc-unified-result');
      const btn = [...inline.querySelectorAll('button')].find(x => /Add Nomination for This Plan/.test(x.textContent));
      const before = document.querySelectorAll('.vcard[id^="vessel-"]').length;
      if (btn) btn.click();
      const after = document.querySelectorAll('.vcard[id^="vessel-"]').length;
      const names = [...document.querySelectorAll('.vcard[id^="vessel-"] input[id$="-name"]')].map(i => i.value);
      return { text: res.text, hasBtn: !!btn, before, after, names };
    });
    check('T5 no-ETA request is FEASIBLE (not delayed)', /Final DecisionAdd Nomination for This PlanFEASIBLE/.test(r.text.replace(/\s+/g, '')) || (/FEASIBLE/.test(r.text) && !/DELAYED START/.test(r.text) && !/NOT FEASIBLE/.test(r.text)), r.text.slice(-400));
    check('T7 Add Nomination button renders in Final Decision', r.hasBtn);
    check('T7 button adds the nomination', r.after === r.before + 1 && r.names.includes('NEW VSL'), r);
  });

  /* Task 6: partial-MGO split — berth sequencing and committed ROB */
  await scenario(browser, 'T6 partial mgo', async (page) => {
    const r = await page.evaluate(() => {
      const b1 = __barge({ name: 'B1', vrob: 4500, mrob: 200 });
      const b2 = __barge({ name: 'B2', vrob: 0, mrob: 400 });
      __vessel({ name: 'DUMMY', type: 'VLSFO', qty: 1, mgo: 0, etaHrs: 24 * 40, bargeId: b1 });
      calculate();
      const res = __nsc(1000, 500, 3);
      return { text: res.text, plan: res.data && res.data.nominationPlan, hose: _calcParams.hoseHrs, travel: _calcParams.travelHrs };
    });
    const e = r.plan && r.plan.entries;
    const ok = e && e.length === 2;
    check('T6 partial MGO split found', ok && /SPLIT SUPPLY FEASIBLE/.test(r.text), r.plan);
    if (ok) {
      const vStart = new Date(e[0].eta), mStart = new Date(e[1].eta);
      const vEtc = vStart.getTime() + (r.hose + Math.max(1000 / 300, 200 / 100)) * 3600000;
      check('T6 second barge comes alongside only after first casts off', mStart.getTime() >= vEtc + r.travel * 3600000 - 1000, { vStart, mStart });
    }
  });
  await scenario(browser, 'T6 partial mgo uses committed ROB', async (page) => {
    const r = await page.evaluate(() => {
      const b1 = __barge({ name: 'B1', vrob: 4500, mrob: 200 });
      const b2 = __barge({ name: 'B2', vrob: 0, mrob: 900 });
      __vessel({ name: 'MGO COMMIT', type: 'MGO', qty: 0, mgo: 700, etaHrs: 1, bargeId: b2 });
      calculate();
      const res = __nsc(1000, 500, 30);
      return { text: res.text, plan: res.data && res.data.nominationPlan };
    });
    // B2 live 900 but 700 committed before the request -> only 200 free < 300 remaining
    check('T6 no partial-MGO plan on committed MGO', !(r.plan && r.plan.mode === 'split'), r.plan);
  });

  /* Task 8: checklist date after JSON reload; dateStr never '—' */
  await scenario(browser, 'T8 checklist dates', async (page) => {
    const r = await page.evaluate(async () => {
      const b1 = __barge({ name: 'B1' });
      __vessel({ name: 'MV DATE', type: 'VLSFO', qty: 300, mgo: 0, etaHrs: 10, bargeId: b1 });
      calculate();
      // simulate a JSON restore
      _checklistRecords = JSON.parse(JSON.stringify(_checklistRecords));
      renderChecklist([]); // no re-inject: dates stay ISO strings as after a reload
      const rec = Object.values(_checklistRecords).find(x => x.vessel === 'MV DATE');
      const row = document.getElementById('cl-row-' + rec.uid);
      const dateCell = row.children[2].textContent.trim();
      document.getElementById('cl-av-' + rec.uid).value = '300';
      await saveChecklistRecord(rec.uid);
      const s = _savedSupplies.find(x => x.checklistUid === rec.uid);
      return { dateCell, dateStr: s.dateStr, typeofSD: typeof rec.supplyDate };
    });
    check('T8 checklist date renders after reload', r.dateCell && r.dateCell !== '—', r);
    check('T8 persisted dateStr is a real date', r.dateStr && r.dateStr !== '—', r);
  });

  /* Task 9: bunker message sequence is per barge */
  await scenario(browser, 'T9 bunker msg per barge', async (page) => {
    const r = await page.evaluate(() => {
      const b1 = __barge({ name: 'B1' });
      const b2 = __barge({ name: 'B2' });
      __vessel({ name: 'ON B1', type: 'VLSFO', qty: 300, mgo: 0, etaHrs: 5, bargeId: b1 });
      __vessel({ name: 'ON B2', type: 'VLSFO', qty: 300, mgo: 0, etaHrs: 7, bargeId: b2 });
      calculate();
      const it = _lastSched.find(i => i.name === 'ON B2');
      openBunkerMsgModal(it.sno);
      const sel = document.getElementById('bm-seq-type');
      const out = { order: _lastSched.map(i => i.name + '@' + i.bargeLabel), val: sel.value, opts: sel.innerHTML };
      closeBunkerMsgModal();
      return out;
    });
    check('T9 vessel on B2 is "On Arrival", not "After ON B1"', r.val === 'arrival' && !/ON B1/.test(r.opts), r);
  });

  /* Task 10: zero/zero save needs explicit confirmation (default cancel) */
  await scenario(browser, 'T10 zero save', async (page) => {
    await page.evaluate(() => {
      const b1 = __barge({ name: 'B1' });
      __vessel({ name: 'MV ZERO', type: 'VLSFO', qty: 300, mgo: 0, etaHrs: 10, bargeId: b1 });
      calculate();
    });
    page.__dialogMode = 'dismiss';
    const a = await page.evaluate(async () => {
      const rec = Object.values(_checklistRecords).find(x => x.vessel === 'MV ZERO');
      await saveChecklistRecord(rec.uid);
      return { locked: !!rec.lockedAt, cards: document.querySelectorAll('.vcard[id^="vessel-"]').length, supplies: _savedSupplies.length };
    });
    check('T10 cancel keeps record open, nomination and no supply', !a.locked && a.cards === 1 && a.supplies === 0, a);
    check('T10 confirm dialog shown', page.__dialogs.some(d => /ZERO delivery/.test(d)), page.__dialogs);
    page.__dialogMode = 'accept';
    const b = await page.evaluate(async () => {
      const rec = Object.values(_checklistRecords).find(x => x.vessel === 'MV ZERO');
      await saveChecklistRecord(rec.uid);
      return { locked: !!rec.lockedAt };
    });
    check('T10 explicit confirm records the zero delivery', b.locked);
  });

  /* Task 11: de-dup never deletes the locked record */
  await scenario(browser, 'T11 dedupe keeps locked', async (page) => {
    const r = await page.evaluate(() => {
      const d0 = __at(48);
      _checklistRecords = {
        v_mv_dup: { uid: 'v_mv_dup', sno: 1, vessel: 'MV DUP', nomV: 100, nomM: null, actV: '100', actM: '0', supplied: true, state: 'completed', lockedAt: new Date().toISOString(), supplyDate: d0.toISOString(), notes: '', bargeLabel: 'B1' },
        v_mv_dup_x: { uid: 'v_mv_dup_x', sno: 2, vessel: 'MV DUP', nomV: 100, nomM: null, actV: '', actM: '', supplied: false, state: 'draft', lockedAt: null, supplyDate: new Date(d0.getTime() - 86400000).toISOString(), notes: '', bargeLabel: 'B1' },
        n_a: { uid: 'n_a', nomUid: 'A', sno: 3, vessel: 'MV OTHER', nomV: 100, nomM: null, actV: '', actM: '', supplied: false, state: 'draft', lockedAt: null, supplyDate: d0.toISOString(), notes: '', bargeLabel: 'B1' },
        n_a2: { uid: 'n_a2', nomUid: 'A', sno: 4, vessel: 'MV OTHER', nomV: 100, nomM: null, actV: '', actM: '', supplied: false, state: 'saved', lockedAt: null, supplyDate: d0.toISOString(), notes: '', bargeLabel: 'B1' },
        n_b: { uid: 'n_b', nomUid: 'B', sno: 5, vessel: 'MV OTHER', nomV: 100, nomM: null, actV: '', actM: '', supplied: false, state: 'draft', lockedAt: null, supplyDate: __at(24 * 30).toISOString(), notes: '', bargeLabel: 'B1' },
      };
      renderChecklist([]);
      return Object.keys(_checklistRecords).sort();
    });
    check('T11 locked legacy record kept, its open duplicate removed', r.includes('v_mv_dup') && !r.includes('v_mv_dup_x'), r);
    check('T11 per-nomUid dedupe keeps most advanced, other nomination kept', r.includes('n_a2') && !r.includes('n_a') && r.includes('n_b'), r);
  });

  /* Task 12: deleting a completed record clears its Delivery Log entries */
  await scenario(browser, 'T12 delete clears delivery log', async (page) => {
    const r = await page.evaluate(async () => {
      const b1 = __barge({ name: 'B1' });
      __vessel({ name: 'MV DEL', type: 'VLSFO', qty: 300, mgo: 0, etaHrs: 10, bargeId: b1 });
      calculate();
      const rec = Object.values(_checklistRecords).find(x => x.vessel === 'MV DEL');
      document.getElementById('cl-av-' + rec.uid).value = '300';
      rec.notes = 'short 2mt';
      rec.flagDispute = true; // a dispute is logged only when marked ⚠ Dispute
      await saveChecklistRecord(rec.uid);
      const count = () => Object.values(_deliveryLog).reduce((n, m) => n + m.timely.concat(m.delayed, m.disputes).filter(e => e.checklistUid === rec.uid).length, 0);
      const before = count();
      deleteChecklistRecord(rec.uid);
      const stored = JSON.parse(localStorage.getItem('abps_delivery_log_v1') || '{}');
      const storedCount = Object.values(stored).reduce((n, m) => n + (m.timely || []).concat(m.delayed || [], m.disputes || []).filter(e => e.checklistUid === rec.uid).length, 0);
      return { before, after: count(), storedCount };
    });
    check('T12 delivery log entries removed + persisted', r.before >= 2 && r.after === 0 && r.storedCount === 0, r);
  });

  /* Task 13: Command Center intervals stop when leaving the page */
  await scenario(browser, 'T13 cc intervals', async (page) => {
    await page.evaluate(() => showPage('commandcenter'));
    const on = await page.evaluate(() => ({ c: !!_ccClockInterval, d: !!_ccDataInterval }));
    await page.evaluate(() => showPage('dashboard'));
    await page.waitForTimeout(1300);
    const off = await page.evaluate(() => ({ c: _ccClockInterval }));
    check('T13 clock interval running on CC page', on.c && on.d, on);
    check('T13 clock interval self-cancels after leaving', off.c === null, off);
  });

  /* Task 14: OS notification once per vessel per tier; dismissal keyed on nomination */
  await scenario(browser, 'T14 notifications', async (page) => {
    const r = await page.evaluate(() => {
      window.__notes = [];
      window.Notification = function (t, o) { __notes.push(t); };
      window.Notification.permission = 'granted';
      const b1 = __barge({ name: 'B1' });
      __vessel({ name: 'MV SOON', type: 'VLSFO', qty: 300, mgo: 0, etaHrs: 5, bargeId: b1 });
      calculate();
      const n1 = __notes.length;
      renderScheduleReminders(); renderScheduleReminders();
      const n2 = __notes.length;
      const stored = JSON.parse(sessionStorage.getItem('flow_notified_reminders') || '[]');
      const btn = [...document.querySelectorAll('#reminder-panel button')].find(x => /Dismiss/.test(x.textContent));
      if (btn) btn.click();
      renderScheduleReminders();
      const txt = document.getElementById('reminder-panel').textContent;
      return { n1, n2, stored, dismissed: !txt.includes('MV SOON') };
    });
    check('T14 single notification across refreshes', r.n2 === 1, r);
    check('T14 notified key persisted in sessionStorage', r.stored.length === 1 && /^n:/.test(r.stored[0]), r.stored);
    check('T14 dismissal sticks across re-render', r.dismissed, r);
  });

  /* Task 15: PAQ reminder skips arrived & completed */
  await scenario(browser, 'T15 paq', async (page) => {
    const r = await page.evaluate(async () => {
      const b1 = __barge({ name: 'B1' });
      __vessel({ name: 'MV ARRIVED', type: 'VLSFO', qty: 300, mgo: 0, etaHrs: -5, bargeId: b1 });
      __vessel({ name: 'MV COMING', type: 'VLSFO', qty: 300, mgo: 0, etaHrs: 30, bargeId: b1 });
      __vessel({ name: 'MV DONE', type: 'VLSFO', qty: 300, mgo: 0, etaHrs: 20, bargeId: b1 });
      calculate();
      const rec = Object.values(_checklistRecords).find(x => x.vessel === 'MV DONE');
      document.getElementById('cl-av-' + rec.uid).value = '300';
      await saveChecklistRecord(rec.uid);
      renderPAQReminders(_lastSched);
      const fired = document.querySelector('#paq-panel .apanel.fired');
      return { fired: fired ? fired.textContent : '', all: document.getElementById('paq-panel').textContent };
    });
    check('T15 upcoming vessel reminded', /MV COMING/.test(r.fired), r);
    check('T15 arrived vessel not in "arriving" reminder', !/MV ARRIVED/.test(r.fired), r);
    check('T15 completed vessel not listed', !/MV DONE/.test(r.all), r);
  });

  /* Task 16: tripwire restores every guarded layer */
  await scenario(browser, 'T16 tripwire', async (page) => {
    const r = await page.evaluate(() => {
      const b1 = __barge({ name: 'B1', vrob: 4000 });
      __vessel({ name: 'DUMMY', type: 'VLSFO', qty: 1, mgo: 0, etaHrs: 24 * 40, bargeId: b1 });
      calculate();
      _savedSupplies = [{ id: 'x', vessel: 'OLD', vlsfoAct: 5, supplied: true }];
      const orig = _checkNSCUnifiedInner;
      window._checkNSCUnifiedInner = function () { _bargeConfig[0].vrob = 1; _savedSupplies.push({ id: 'evil' }); _savedSupplies[0].vlsfoAct = 999; _manualROB.zzz = 1; };
      try { checkNSCUnified(); } finally { window._checkNSCUnifiedInner = orig; }
      return { vrob: _bargeConfig[0].vrob, sup: JSON.stringify(_savedSupplies), man: JSON.stringify(_manualROB) };
    });
    check('T16 barge opening ROB restored', r.vrob === 4000, r);
    check('T16 saved supplies restored', r.sup === JSON.stringify([{ id: 'x', vessel: 'OLD', vlsfoAct: 5, supplied: true }]), r);
    check('T16 manual ROB restored', !/zzz/.test(r.man), r);
  });

  /* Task 1: stored XSS in the R4-rendered surfaces */
  await scenario(browser, 'T1 xss', async (page) => {
    const r = await page.evaluate(async () => {
      window.__xss = 0;
      const evil = `X<img src=x onerror="window.__xss++">'"`;
      const b1 = __barge({ name: 'B1' });
      const b2 = __barge({ name: 'B2' });
      __vessel({ name: 'MV ' + evil, type: 'BOTH', qty: 300, mgo: 50, etaHrs: 5, bargeId: b1, agent: evil, spec: evil });
      __vessel({ name: 'MV2 ' + evil, type: 'VLSFO', qty: 300, mgo: 0, etaHrs: 6, bargeId: b1 });
      __vessel({ name: 'MV3', type: 'VLSFO', qty: 300, mgo: 0, etaHrs: 8, bargeId: b2 });
      calculate();
      // poison barge names / loadings / checklist as cloud data would
      _lastSched.forEach(i => { if (i.bargeLabel === 'B2') i.bargeLabel = evil; });
      _bargeConfig[1].name = evil;
      Object.values(_checklistRecords).forEach(r => { r.notes = evil; r.bdnV = evil; r.bargeLabel = evil; });
      _deliveryLog = { '2026-10': { timely: [{ vessel: evil, dateStr: evil, barge: evil, checklistUid: 'q' }], delayed: [], disputes: [{ vessel: evil, remarks: evil, checklistUid: 'q', isDispute: true }] } };
      renderBargeTabsAndTL(_lastSched, _bargeConfig);
      renderChecklist(_lastSched);
      renderPAQReminders(_lastSched);
      renderScheduleReminders();
      if (typeof renderDeliveryLog === 'function') { try { renderDeliveryLog(); } catch (e) {} }
      showPage('commandcenter'); _ccRefreshData(); showPage('dashboard');
      renderFreeWindowsPanel();
      __nsc(9000, 900, 2, evil);
      const ids = ['tl', 'voy-barge-tabs', 'checklist-rows', 'paq-panel', 'reminder-panel', 'cc-upnext', 'cc-schedule-panel', 'cc-rob-panel', 'cc-alerts-panel', 'free-windows-panel', 'nsc-unified-result', 'nsc-checks-list', 'dl-list-timely', 'dl-list-disputes'];
      const imgs = {};
      ids.forEach(id => { const el = document.getElementById(id); if (el) imgs[id] = el.querySelectorAll('img').length; });
      await new Promise(r => setTimeout(r, 200));
      const handlers = [...document.querySelectorAll("*")].flatMap(el => [...el.attributes].filter(a => { if (!/^on/.test(a.name)) return false; try { new Function(a.value); return false; } catch (e) { return true; } }).map(a => { let p = el; while (p && !p.id) p = p.parentElement; return (p ? p.id : "?") + ":" + a.name + "=" + a.value.slice(0, 80); }));
      const where = [...document.querySelectorAll('img[src="x"]')].map(im => { let p = im.parentElement; while (p && !p.id) p = p.parentElement; return p ? p.id : '?'; });
      return { imgs, xss: window.__xss, where: [...new Set(where)], handlers };
    });
    const bad = Object.entries(r.imgs).filter(([k, v]) => v > 0);
    check('T1 no injected <img> in R4 surfaces', bad.length === 0, r.imgs);
    // Injection still happens in OTHER agents' regions (dashboard, calendar,
    // remaining-supply tracker, live ROB) — only R4 surfaces are asserted.
    const r4 = Object.keys(r.imgs);
    const r4Handlers = r.handlers.filter(h => r4.includes(h.split(':')[0]));
    check('T1 no broken/injected inline handlers in R4 surfaces', r4Handlers.length === 0, r4Handlers);
    console.log('   (info) injection outside R4 surfaces:', JSON.stringify(r.where));
  });

  await browser.close();
  const failed = results.filter(x => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
