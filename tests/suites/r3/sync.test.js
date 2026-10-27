/* Multi-device sync tests: two operators + a trader on one fake Supabase. */
const U = require('./util.js');
const { check } = U;

(async () => {
  const browser = await U.H.launch();
  try {
    // ── 1. Concurrent edits to different vessels both survive ─────────
    console.log('T1 concurrent operator edits (different vessels)');
    {
      const db = U.H.createDb({ workspace: U.seedPayload() });
      const A = await U.open(browser, db, 'user-operator');
      const B = await U.open(browser, db, 'user-operator2');
      await U.helpers(A); await U.helpers(B);
      await A.page.evaluate(async () => { __setV('n1', 'vlsfo', '555'); return saveSharedState(); });
      const vA = U.row(db).version;
      check(vA > 1000, 'A write bumped version (' + vA + ')');
      // B never pulled A's change — B edits another vessel and saves
      const okB = await B.page.evaluate(async () => { __setV('n2', 'agent', 'AGENT-B'); return saveSharedState(); });
      check(okB === true, 'B save reported success after merge');
      const vs = U.row(db).payload.state.vessels;
      const n1 = vs.find(v => v.nomUid === 'n1'), n2 = vs.find(v => v.nomUid === 'n2');
      check(n1 && n1.qty === 555, 'A\'s qty edit survived B\'s save (qty=' + (n1 && n1.qty) + ')');
      check(n2 && n2.agent === 'AGENT-B', 'B\'s agent edit landed');
      check(U.row(db).version > vA, 'B wrote a newer version');
      const bUi = await B.page.evaluate(() => __getV('n1', 'vlsfo'));
      check(bUi === '555', 'B\'s UI now shows A\'s change (merged + applied)');
      const toastB = await B.page.evaluate(() => window.__toasts.filter(t => /Merged with changes/.test(t)).length);
      check(toastB === 0, 'no conflict toast when different fields changed');
      // A polls → gets B's change, only because version is newer
      await A.page.evaluate(() => _pollOnce(true));
      check(await A.page.evaluate(() => __getV('n2', 'agent')) === 'AGENT-B', 'A pulled B\'s change on poll');

      // ── 1b. same field on both → local wins + user warned
      console.log('T1b same field edited on both devices');
      // A true clash needs B to save WITHOUT having pulled A's edit: the mock's
      // realtime push could land on B first (it did under CPU load), so delivery is
      // off for this step and B's save has to merge.
      db.realtime = false;
      // …and B is typing in that very field meanwhile, which (as for a real user)
      // defers B's own periodic pull until the field is left.
      await B.page.evaluate(() => { document.getElementById('v' + __cardFor('n1') + '-agent').focus(); });
      await A.page.evaluate(async () => { __setV('n1', 'agent', 'FROM-A'); return saveSharedState(); });
      await B.page.evaluate(async () => { __setV('n1', 'agent', 'FROM-B'); document.activeElement && document.activeElement.blur(); return saveSharedState(); });
      db.realtime = true;
      const n1b = U.row(db).payload.state.vessels.find(v => v.nomUid === 'n1');
      check(n1b.agent === 'FROM-B', 'later saver (local) wins a true clash');
      const toast = await B.page.evaluate(() => window.__toasts.filter(t => /Merged with changes saved by a colleague/.test(t)).length);
      check(toast >= 1, 'B was shown the "Merged with changes saved by a colleague" toast');

      // ── 1c. vessel deleted on A, untouched on B → stays deleted after B's save
      console.log('T1c delete on one side');
      await A.page.evaluate(async () => { await _pollOnce(true); const id = __cardFor('n2'); document.getElementById('vessel-' + id).remove(); return saveSharedState(); });
      await B.page.evaluate(async () => { __setV('n1', 'remarks', 'note from B'); return saveSharedState(); });
      const vs2 = U.row(db).payload.state.vessels;
      check(!vs2.some(v => v.nomUid === 'n2'), 'vessel removed on A is not resurrected by B');
      check(vs2.find(v => v.nomUid === 'n1').remarks === 'note from B', 'B\'s edit kept');

      // ── 1d. coalescing: many rapid saves → few writes, final state correct
      console.log('T1d serialized + coalesced saves');
      const before = U.writes(db, 'user-operator').length;
      await A.page.evaluate(async () => {
        await _pollOnce(true);
        const ps = [];
        for (let i = 0; i < 6; i++) { __setV('n1', 'vlsfo', String(600 + i)); ps.push(saveSharedState()); }
        return Promise.all(ps);
      });
      const n = U.writes(db, 'user-operator').length - before;
      check(n <= 2, '6 rapid saves → ' + n + ' cloud write(s)');
      check(U.row(db).payload.state.vessels.find(v => v.nomUid === 'n1').qty === 605, 'last value written');
      // ── 1e. poll does not apply an equal/older version
      console.log('T1e poll only moves forward');
      await B.page.evaluate(() => _pollOnce(true)); // B now up to date
      const r = U.row(db);
      r.payload = JSON.parse(JSON.stringify(r.payload));
      r.payload.state.vessels[0].agent = 'SNEAKY-SAME-VERSION';
      await B.page.evaluate(() => _pollOnce(true));
      check(await B.page.evaluate(() => __getV('n1', 'agent')) !== 'SNEAKY-SAME-VERSION', 'same-version row not applied');
      check(U.realErrors(A).length === 0 && U.realErrors(B).length === 0, 'no page errors (' + U.realErrors(A).concat(U.realErrors(B)).join(' | ') + ')');
      await A.ctx.close(); await B.ctx.close();
    }

    // ── 2. Failed initial pull → no stale overwrite, merge on recovery ──
    console.log('T2 failed initial pull');
    {
      const db = U.H.createDb({ workspace: U.seedPayload() });
      const A = await U.open(browser, db, 'user-operator');
      await U.helpers(A);
      // B has a stale local cache from an earlier session
      const stale = U.seedPayload().state; stale.vessels[1].agent = 'STALE'; stale.version = 900;
      let failB = true;
      db.intercept = (op) => (failB && op.uid === 'user-operator2' && op.table === 'abps_workspace' && op.action === 'select') ? { data: null, error: { message: 'Failed to fetch' } } : null;
      const B = await U.open(browser, db, 'user-operator2', { localStorage: { ['flow_state_202606290803']: JSON.stringify(stale) } });
      await U.helpers(B);
      const st = await B.page.evaluate(() => ({ unknown: _cloudBaseUnknown, banner: (document.getElementById('sync-offline-banner') || {}).style ? document.getElementById('sync-offline-banner').style.display : 'none', agent: __getV('n2', 'agent') }));
      check(st.unknown === true, 'B marked _cloudBaseUnknown');
      check(st.banner === 'flex', 'offline banner visible');
      check(st.agent === 'STALE', 'B shows its local copy for viewing');
      // Meanwhile A changes vessel n1
      await A.page.evaluate(async () => { __setV('n1', 'agent', 'A-ONLINE'); return saveSharedState(); });
      const vAfterA = U.row(db).version;
      // B edits n2 and saves, plus autoArchive style save — must not write
      const wBefore = U.writes(db, 'user-operator2').length;
      const okB = await B.page.evaluate(async () => { __setV('n2', 'remarks', 'offline edit'); const a = await saveSharedState(); await saveSharedRecords(); autoArchivePastMonths(); return a; });
      check(okB === false, 'save while cloud base unknown returns false');
      check(U.writes(db, 'user-operator2').length === wBefore, 'no cloud write happened while offline');
      check(U.row(db).version === vAfterA && U.row(db).payload.state.vessels.find(v => v.nomUid === 'n1').agent === 'A-ONLINE', 'cloud copy untouched (A\'s edit intact)');
      // cloud reachable again → poll recovers
      failB = false;
      await B.page.evaluate(() => _pollOnce());
      await B.page.waitForTimeout(500);
      const vs = U.row(db).payload.state.vessels;
      check(vs.find(v => v.nomUid === 'n1').agent === 'A-ONLINE', 'after recovery: A\'s change kept');
      check(vs.find(v => v.nomUid === 'n2').remarks === 'offline edit', 'after recovery: B\'s offline edit pushed');
      check(vs.find(v => v.nomUid === 'n2').agent === 'AG2', 'B\'s untouched stale field did NOT overwrite cloud (agent=' + vs.find(v => v.nomUid === 'n2').agent + ')');
      const st2 = await B.page.evaluate(() => ({ unknown: _cloudBaseUnknown, banner: document.getElementById('sync-offline-banner').style.display, agent: __getV('n1', 'agent') }));
      check(!st2.unknown && st2.banner === 'none', 'offline state cleared, banner hidden');
      check(st2.agent === 'A-ONLINE', 'B UI shows A\'s change');
      check(U.realErrors(B).filter(e => !/Failed to fetch|Pull failed/.test(e)).length === 0, 'no unexpected page errors on B');
      await A.ctx.close(); await B.ctx.close();
    }

    // ── 2b. Unsynced changes survive a reload and merge when the cloud comes back
    console.log('T2b unsynced edits survive reload');
    {
      const db = U.H.createDb({ workspace: U.seedPayload() });
      const B = await U.open(browser, db, 'user-operator2');
      await U.helpers(B);
      let fail = true;
      db.intercept = (op) => (fail && op.uid === 'user-operator2' && op.table === 'abps_workspace') ? { data: null, error: { message: 'Failed to fetch' } } : null;
      const okB = await B.page.evaluate(async () => { __setV('n2', 'remarks', 'unsynced-before-reload'); return saveSharedState(); });
      check(okB === false, 'save failed (network)');
      // colleague changes n1 meanwhile
      const A = await U.open(browser, db, 'user-operator');
      await U.helpers(A);
      await A.page.evaluate(async () => { __setV('n1', 'agent', 'A2'); return saveSharedState(); });
      fail = false;
      await B.page.reload({ waitUntil: 'load' }); await B.page.waitForTimeout(2500); await U.helpers(B);
      await B.page.waitForTimeout(300);
      const vs = U.row(db).payload.state.vessels;
      check(vs.find(v => v.nomUid === 'n2').remarks === 'unsynced-before-reload', 'unsynced edit from before reload merged + pushed');
      check(vs.find(v => v.nomUid === 'n1').agent === 'A2', 'colleague\'s change kept');
      await A.ctx.close(); await B.ctx.close();
    }

    // ── 3. Record / loading saves propagate with a NEW version ─────────
    console.log('T3 records + loadings propagate');
    {
      const db = U.H.createDb({ workspace: U.seedPayload() });
      const A = await U.open(browser, db, 'user-operator');
      const B = await U.open(browser, db, 'user-operator2');
      await U.helpers(A); await U.helpers(B);
      const v0 = U.row(db).version;
      await A.page.evaluate(async () => { _savedSupplies.push({ id: 'rec_t3', vessel: 'ALPHA', barge: 'Barge 1', vlsfoAct: 100, mgoAct: 0, supplyDate: '2026-10-11T08:00:00', supplied: true }); return saveSharedRecords(); });
      check(U.row(db).version > v0, 'saveSharedRecords wrote a new version');
      check(U.row(db).payload.records.some(r => r.id === 'rec_t3'), 'record is in the cloud row');
      // B (not pulled) saves an unrelated loading — must not drop A's record
      await B.page.evaluate(async () => { _loadingRecords.push({ id: 'ld_t3', barge: 'Barge 1', terminal: 'T', grade: 'VLSFO', qty: 100, startAt: new Date().toISOString(), endAt: new Date(Date.now()+3600e3).toISOString(), updatedAt: Date.now() }); return saveLoadingRecords(); });
      check(U.row(db).payload.records.some(r => r.id === 'rec_t3'), 'A\'s record survived B\'s loading save');
      check(U.row(db).payload.state.loadingRecords.some(r => r.id === 'ld_t3'), 'B\'s loading saved');
      check(Object.values(U.row(db).payload.checklistRecords || {}).every(r => !r.lockedAt && r.state !== 'completed'), 'no completed checklist records pushed');
      await A.page.evaluate(() => _pollOnce(true));
      check(await A.page.evaluate(() => _loadingRecords.some(r => r.id === 'ld_t3')), 'A pulled B\'s loading');
      // Mark done bumps updatedAt
      const ua = await A.page.evaluate(async () => { const before = _loadingRecords.find(r => r.id === 'ld_t3').updatedAt; await new Promise(r => setTimeout(r, 5)); markLoadingRecordDone('ld_t3'); await _waitForSaveIdle(); return [before, _loadingRecords.find(r => r.id === 'ld_t3').updatedAt]; });
      check(ua[1] > ua[0], 'Mark Done bumps updatedAt');
      check(U.row(db).payload.state.loadingRecords.find(r => r.id === 'ld_t3').completed === true, 'Done state synced');
      await A.ctx.close(); await B.ctx.close();
    }

    // ── 4. Trader: CAS via expected_version + legacy fallback ─────────
    console.log('T4 trader writes');
    {
      const db = U.H.createDb({ workspace: U.seedPayload() });
      const A = await U.open(browser, db, 'user-operator');
      const T = await U.open(browser, db, 'user-trader');
      await U.helpers(A); await U.helpers(T);
      await A.page.evaluate(async () => { __setV('n1', 'agent', 'OP-EDIT'); return saveSharedState(); });
      const okT = await T.page.evaluate(async () => { __setV('n2', 'vlsfo', '999'); return saveSharedState(); });
      check(okT === true, 'trader save succeeded after version_conflict retry');
      const rpcCalls = db.log.filter(o => o.action === 'rpc' && o.uid === 'user-trader');
      check(rpcCalls.length >= 2 && rpcCalls[0].args.expected_version != null, 'trader sent expected_version (' + rpcCalls.length + ' rpc calls)');
      const vs = U.row(db).payload.state.vessels;
      check(vs.find(v => v.nomUid === 'n1').agent === 'OP-EDIT', 'operator\'s concurrent edit not lost by trader save');
      check(vs.find(v => v.nomUid === 'n2').qty === 999, 'trader\'s edit landed');
      const disabled = await T.page.evaluate(() => { const id = __cardFor('n1'); return document.getElementById('v' + id + '-barge').disabled; });
      check(disabled === true, 'barge assignment locked for traders');
      // Legacy SQL: function has no expected_version param
      db.intercept = (op) => (op.action === 'rpc' && op.args && 'expected_version' in op.args) ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.trader_update_vessels(expected_version, new_version, new_vessels) in the schema cache' } } : null;
      const okT2 = await T.page.evaluate(async () => { __setV('n2', 'agent', 'TR-LEGACY'); return saveSharedState(); });
      check(okT2 === true, 'falls back to the old 2-arg RPC');
      check(U.row(db).payload.state.vessels.find(v => v.nomUid === 'n2').agent === 'TR-LEGACY', 'legacy write landed');
      // server keeps operator-owned fields even if a trader payload changes them
      db.intercept = null; db.protectTraderFields = true;
      await T.page.evaluate(async () => { await _pollOnce(true); const id = __cardFor('n1'); const sel = document.getElementById('v' + id + '-barge'); sel.disabled = false; sel.value = '1'; __setV('n1', 'remarks', 'trader note'); return saveSharedState(); });
      const n1t = U.row(db).payload.state.vessels.find(v => v.nomUid === 'n1');
      check(n1t.bargeId === '' && n1t.remarks === 'trader note', 'operator-owned bargeId kept, trader edit applied (bargeId=' + JSON.stringify(n1t.bargeId) + ')');
            // trader records save is refused locally with a message
      const rec = await T.page.evaluate(async () => { const r = await saveSharedRecords(); return [r, window.__toasts.some(t => /operator account/.test(t))]; });
      check(rec[0] === false && rec[1], 'trader record save refused with a clear message');
      check(U.realErrors(T).length === 0, 'no trader page errors (' + U.realErrors(T).join(' | ') + ')');
      await A.ctx.close(); await T.ctx.close();
    }

    // ── 5. Poll defers while typing; save-in-flight blocks apply ──────
    console.log('T5 poll vs typing / in-flight save');
    {
      const db = U.H.createDb({ workspace: U.seedPayload() });
      const A = await U.open(browser, db, 'user-operator');
      const B = await U.open(browser, db, 'user-operator2');
      await U.helpers(A); await U.helpers(B);
      await B.page.evaluate(() => { showPage('nominations'); const id = __cardFor('n2'); const el = document.getElementById('v' + id + '-agent'); el.focus(); el.value = 'TYPING…'; });
      check(await B.page.evaluate(() => _isEditingSyncedForm()), 'B is typing in a vessel card');
      await A.page.evaluate(async () => { __setV('n1', 'agent', 'A5'); return saveSharedState(); });
      await B.page.evaluate(() => _pollOnce());
      const r1 = await B.page.evaluate(() => ({ typed: __getV('n2', 'agent'), n1: __getV('n1', 'agent'), focused: document.activeElement && document.activeElement.id }));
      check(r1.typed === 'TYPING…' && r1.n1 === 'AG1', 'poll deferred while typing (input untouched)');
      await B.page.evaluate(() => document.activeElement.blur());
      await B.page.waitForTimeout(900);
      const r2 = await B.page.evaluate(() => ({ typed: __getV('n2', 'agent'), n1: __getV('n1', 'agent') }));
      check(r2.n1 === 'A5', 'applied after blur');
      check(r2.typed === 'TYPING…', 'typed (unsaved) value merged, not wiped');
      await B.page.waitForTimeout(300);
      check(U.row(db).payload.state.vessels.find(v => v.nomUid === 'n2').agent === 'TYPING…', 'pending edit pushed after merge');
      // save in flight → poll is a no-op
      const blocked = await B.page.evaluate(async () => {
        let applied = false; const orig = applyState; applyState = function() { applied = true; return orig.apply(this, arguments); };
        const p = saveSharedState(); await _pollOnce(true); await p; applyState = orig; return applied;
      });
      check(blocked === false, 'applyState never ran during an in-flight save');
      await A.ctx.close(); await B.ctx.close();
    }

    // ── 6. Empty cloud at load + unsynced edits → merged, not wiped ───
    console.log('T6 empty cloud, failed first save, colleague creates the row');
    {
      const db = U.H.createDb();
      const B = await U.open(browser, db, 'user-operator2');
      await U.helpers(B);
      let fail = true;
      db.intercept = (op) => (fail && op.uid === 'user-operator2' && ['insert', 'update', 'upsert'].includes(op.action)) ? { data: null, error: { message: 'Failed to fetch' } } : null;
      const okB = await B.page.evaluate(async () => { addVessel({ name: 'FROM-B', nomUid: 'nb' }); return saveSharedState(); });
      check(okB === false, 'B\'s first save failed');
      const A = await U.open(browser, db, 'user-operator');
      await U.helpers(A);
      await A.page.evaluate(async () => { addVessel({ name: 'FROM-A', nomUid: 'na' }); return saveSharedState(); });
      fail = false;
      await B.page.evaluate(() => _pollOnce(true));
      await B.page.waitForTimeout(500);
      const names = U.row(db).payload.state.vessels.map(v => v.name).sort();
      check(JSON.stringify(names) === '["FROM-A","FROM-B"]', 'both vessels in the cloud (' + names + ')');
      await A.ctx.close(); await B.ctx.close();
    }
  } finally {
    await browser.close();
  }
  U.summary('sync.test');
})().catch(e => { console.error(e); process.exit(2); });
