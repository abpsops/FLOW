/* Loose ends: FY labels follow the current year (FY27 in 2027 with live data
   only, FY26 still reachable) + Danger zone / typed confirmation.
   node loose.test.js [appDir] [shotDir]   — screenshots only when shotDir (or $SHOTS_DIR) is given */
const path = require('path');
const fs = require('fs');
if (process.argv[2]) process.env.APP_DIR = process.argv[2];
const SHOTS = process.argv[3] || process.env.SHOTS_DIR || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const U = require('../r3/util.js');
const { check } = U;
const wait = ms => new Promise(r => setTimeout(r, ms));

function payloadWithRecords() {
  const p = U.seedPayload();
  const rec = (id, date, v, m) => ({ id, vessel: 'REC ' + id, supplied: true, supplyDate: date, savedAt: date, vlsfoAct: v, lsmgoAct: m, barge: 'Barge 1' });
  p.records = [rec('a26', '2026-08-10T08:00:00Z', 1000, 100), rec('b26', '2026-01-12T08:00:00Z', 777, 7), rec('c27', '2027-01-20T08:00:00Z', 2222, 22)];
  return p;
}
const hideWelcome = () => { const o = document.getElementById('flow-welcome-overlay'); if (o) o.style.display = 'none'; };

async function fyProbe(app) {
  return app.page.evaluate(async () => {
    showPage('dashboard'); try { refreshDashboard(); } catch (e) {}
    await new Promise(r => setTimeout(r, 300));
    const dash = { title: document.getElementById('dash-monthly-qty-title').textContent, sub: document.getElementById('dash-monthly-qty-subtitle').textContent, track: document.getElementById('dash-track-record-subtitle').textContent };
    showPage('reports'); try { renderReportCharts(_savedSupplies); } catch (e) {}
    await new Promise(r => setTimeout(r, 300));
    const sel = document.getElementById('rep-monthly-qty-year-select');
    const opts = [...sel.options].map(o => o.textContent);
    const repSub = document.getElementById('rep-monthly-qty-subtitle').textContent;
    const cur = getMonthlyQuantitySeries(_currentFY());
    return { year: new Date().getFullYear(), dash, opts, repSub, jan: cur[0], aug: cur[7], fy26jan: getMonthlyQuantitySeries(2026)[0], fy26aug: getMonthlyQuantitySeries(2026)[7], pdfTitle: _fySelectedLabel() };
  });
}

(async () => {
  const browser = await U.H.launch();
  try {
    // ── 1. FY labels in 2026 vs 2027 ──
    for (const [label, iso] of [['2026', '2026-10-13T10:00:00+04:00'], ['2027', '2027-03-15T10:00:00+04:00']]) {
      console.log('FY in ' + label);
      const db = U.H.createDb({ workspace: payloadWithRecords() });
      const app = await U.open(browser, db, 'user-operator', { beforeLoad: (ctx, page) => page.clock.setSystemTime(new Date(iso)) });
      await app.page.evaluate(hideWelcome);
      const r = await fyProbe(app);
      check(String(r.year) === label, 'page clock reads ' + r.year);
      if (label === '2026') {
        check(r.dash.title === 'Bunker Quantity — FY26', 'dashboard title FY26 (' + r.dash.title + ')');
        check(/FY26 · Jan–Jul from historical records · Aug onward/.test(r.dash.sub), 'seeded subtitle in 2026: ' + r.dash.sub);
        check(JSON.stringify(r.opts) === JSON.stringify(['FY26 (Live)']), 'selector: ' + JSON.stringify(r.opts));
        check(r.jan.live === false && r.jan.fo === 25805.705, 'Jan 2026 = seed figure');
        check(r.aug.live === true && r.aug.fo === 1000, 'Aug 2026 = live record');
        check(r.pdfTitle === 'FY26', 'PDF chart title label FY26');
      } else {
        check(r.dash.title === 'Bunker Quantity — FY27', 'dashboard title FY27 (' + r.dash.title + ')');
        check(/^FY27 · computed live from Monthly Report · Grand total so far/.test(r.dash.sub) && !/historical/.test(r.dash.sub), 'live-only subtitle in 2027: ' + r.dash.sub);
        check(JSON.stringify(r.opts) === JSON.stringify(['FY27 (Live)', 'FY26']), 'selector reaches FY26: ' + JSON.stringify(r.opts));
        check(r.jan.live === true && r.jan.fo === 2222, 'Jan 2027 = live record only (no 2026 seed) ' + JSON.stringify(r.jan));
        check(r.fy26jan.live === false && r.fy26jan.fo === 25805.705 && r.fy26aug.fo === 1000, 'FY26 series still seed + live');
        check(r.pdfTitle === 'FY27', 'PDF chart title label FY27');
        // pick FY26 in the dropdown
        const pick = await app.page.evaluate(() => { const s = document.getElementById('rep-monthly-qty-year-select'); s.value = '__fy:2026'; _onFYChartSelectorChange(); return { sub: document.getElementById('rep-monthly-qty-subtitle').textContent, undo: document.getElementById('rep-monthly-qty-undo-btn').style.display, pdf: _fySelectedLabel() }; });
        check(/^FY26 · Jan–Jul from historical records/.test(pick.sub) && /Grand total: /.test(pick.sub) && pick.undo === 'none' && pick.pdf === 'FY26', 'FY26 view from the dropdown ' + JSON.stringify(pick));
        const def = await app.page.evaluate(() => { let asked = null; const o = window.prompt; window.prompt = (m, d) => { asked = d; return null; }; confirmArchiveFiscalYear(); window.prompt = o; return asked; });
        check(def === 'FY27', 'Archive Year suggests FY27');
        const ph = await app.page.evaluate(() => ['btr-from', 'report-to'].map(i => document.getElementById(i).placeholder));
        check(ph[0] === '01 Jan 2027' && ph[1] === '31 Jan 2027', 'date placeholders follow the year ' + JSON.stringify(ph));
        await app.page.evaluate(() => { const s = document.getElementById('rep-monthly-qty-year-select'); s.value = '__live__'; _onFYChartSelectorChange(); });
      }
      check(/since Sep 2026/.test(r.dash.track), 'track record keeps its fixed start (Sep 2026) in ' + label);
      // screenshots: dashboard chart + analytics chart
      for (const [pg, id] of [['dashboard', 'chart-monthly-qty-dashboard'], ['reports', 'chart-monthly-qty-analytics']]) {
        await app.page.evaluate(p => { showPage(p); if (p === 'dashboard') refreshDashboard(); else renderReportCharts(_savedSupplies); }, pg);
        await wait(700);
        const card = app.page.locator('#' + id).locator('xpath=ancestor::div[contains(@class,"chart-card")][1]');
        await card.scrollIntoViewIfNeeded();
        if (SHOTS) await card.screenshot({ path: path.join(SHOTS, `fy-${label}-${pg}.png`) });
      }
      check(U.realErrors(app).length === 0, 'no page errors (' + U.realErrors(app).join(' | ') + ')');
      await app.ctx.close();
    }

    // ── 2. Danger zone + typed confirmation ──
    console.log('Danger zone');
    {
      const db = U.H.createDb({ workspace: payloadWithRecords() });
      const dialogs = [];
      const app = await U.open(browser, db, 'user-operator', { onDialog: d => { dialogs.push(d.type() + ':' + d.message().slice(0, 40)); d.accept(); } });
      const p = app.page;
      await p.evaluate(hideWelcome);
      const z = await p.evaluate(() => ({
        shown: getComputedStyle(document.getElementById('danger-zone')).display !== 'none',
        exp: document.getElementById('danger-zone-toggle').getAttribute('aria-expanded'),
        tag: document.getElementById('danger-zone-toggle').tagName,
        hidden: document.getElementById('danger-zone-panel').hidden,
        inZone: ['topbar-fullreset-btn', 'topbar-wipecloud-btn', 'topbar-clearall-btn', 'danger-clearchecklist-btn', 'danger-clearrecords-btn'].every(id => { const el = document.getElementById(id); return el && el.closest('#danger-zone-panel'); }),
        menu: [...document.querySelectorAll('#topbar-menu-dropdown button')].map(b => b.textContent.trim()),
        redLinks: [...document.querySelectorAll('#sidebar a.sidebar-item')].filter(a => /Full Reset|Clear All Data/.test(a.textContent)).length,
        pageBtns: [...document.querySelectorAll('.page-actions button')].filter(b => /Clear Checklist|Clear All Records/.test(b.textContent)).length,
      }));
      check(z.shown && z.tag === 'BUTTON' && z.exp === 'false' && z.hidden, 'operator: collapsed Danger zone <button aria-expanded=false> ' + JSON.stringify(z));
      check(z.inZone, 'all five actions (existing ids kept) live inside the Danger zone');
      check(JSON.stringify(z.menu) === JSON.stringify(['Log Out']) && z.redLinks === 0 && z.pageBtns === 0, 'no other always-visible destructive buttons ' + JSON.stringify({ menu: z.menu, red: z.redLinks, page: z.pageBtns }));
      await p.click('#danger-zone-toggle');
      check(await p.evaluate(() => document.getElementById('danger-zone-toggle').getAttribute('aria-expanded') === 'true' && !document.getElementById('danger-zone-panel').hidden), 'toggle reveals the actions');

      // spies on the underlying functions
      await p.evaluate(() => {
        window.__ran = {};
        ['fullReset', 'clearChecklistRecords', 'clearAllSavedRecords', 'wipeSupabaseWorkspace', 'nuclearClear'].forEach(n => {
          window['__orig_' + n] = window[n];
          window[n] = new Function('window.__ran["' + n + '"] = (window.__ran["' + n + '"] || 0) + 1;');
        });
      });
      // assigning window[n] replaces the global binding used by the confirm* wrappers
      const cases = [
        ['topbar-fullreset-btn', 'fullReset', 'RESET'],
        ['danger-clearchecklist-btn', 'clearChecklistRecords', 'CLEAR'],
        ['danger-clearrecords-btn', 'clearAllSavedRecords', 'DELETE'],
        ['topbar-wipecloud-btn', 'wipeSupabaseWorkspace', 'WIPE'],
        ['topbar-clearall-btn', 'nuclearClear', 'DELETE'],
      ];
      const modalOpen = () => p.evaluate(() => getComputedStyle(document.getElementById('danger-confirm-modal')).display !== 'none');
      const ran = n => p.evaluate(n => window.__ran[n] || 0, n);
      for (const [btn, fn, word] of cases) {
        await p.click('#' + btn);
        await wait(80);
        const m = await p.evaluate(() => ({ title: document.getElementById('danger-confirm-title').textContent, word: document.querySelector('.danger-confirm-word').textContent, disabled: document.getElementById('danger-confirm-go').disabled, dels: document.querySelectorAll('.danger-confirm-del li').length, focus: document.activeElement && document.activeElement.id }));
        check(await modalOpen() && m.word === word && m.disabled && m.dels > 0 && m.focus === 'danger-confirm-input', `${btn}: modal explains (${m.dels} items) and asks for "${word}", action disabled`);
        // forcing a click on the disabled button / a wrong word / Enter with a wrong word → nothing runs
        await p.evaluate(() => _dangerConfirmClose(true));
        await p.fill('#danger-confirm-input', word.slice(0, -1));
        await p.keyboard.press('Enter');
        check(await modalOpen() && await p.evaluate(() => document.getElementById('danger-confirm-go').disabled) && await ran(fn) === 0, `${btn}: wrong word keeps it disabled; forced confirm ignored`);
        await p.keyboard.press('Escape');
        await wait(50);
        check(!(await modalOpen()) && await ran(fn) === 0, `${btn}: Escape aborts, ${fn} not run`);
        // Cancel button
        await p.click('#' + btn); await wait(50);
        await p.fill('#danger-confirm-input', word);
        await p.click('#danger-confirm-cancel'); await wait(50);
        check(!(await modalOpen()) && await ran(fn) === 0, `${btn}: Cancel aborts even with the word typed`);
        // typed word (lower-case is fine) → runs exactly once
        await p.click('#' + btn); await wait(50);
        await p.fill('#danger-confirm-input', word.toLowerCase());
        check(!(await p.evaluate(() => document.getElementById('danger-confirm-go').disabled)), `${btn}: typing "${word}" enables the action`);
        await p.click('#danger-confirm-go'); await wait(80);
        check(!(await modalOpen()) && await ran(fn) === 1, `${btn}: confirmed → ${fn} ran once`);
      }
      check(dialogs.length === 0, 'no native confirm()/prompt() dialogs used (' + dialogs.join(' | ') + ')');

      // real (unspied) run: Clear Saved Records + Full Reset reach the cloud
      await p.evaluate(() => { ['fullReset', 'clearAllSavedRecords'].forEach(n => { window[n] = window['__orig_' + n]; }); });
      // (past months' records are auto-archived on load, so count what's live)
      const nRec = (U.row(db).payload.records || []).length;
      check(nRec > 0 && nRec === await p.evaluate(() => _savedSupplies.length), 'cloud has ' + nRec + ' saved record(s) before');
      await p.click('#danger-clearrecords-btn'); await wait(50);
      await p.fill('#danger-confirm-input', 'DELETE'); await p.click('#danger-confirm-go');
      await wait(1500);
      check((U.row(db).payload.records || []).length === 0, 'Clear Saved Records (typed) emptied the cloud records');
      check(U.row(db).payload.state.vessels.length === 2, 'vessels untouched before Full Reset');
      await p.click('#topbar-fullreset-btn'); await wait(50);
      await p.fill('#danger-confirm-input', 'RESET'); await p.click('#danger-confirm-go');
      await wait(1500);
      check(U.row(db).payload.state.vessels.length === 0, 'Full Reset (typed) cleared the cloud nominations');

      // screenshots in both looks: zone open + modal
      for (const skin of ['harbour', 'classic']) {
        await p.evaluate(s => { if (_isPremiumSkin() !== (s === 'harbour')) toggleSkin(); toggleDangerZone(true); showPage('dashboard'); }, skin);
        await wait(300);
        if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `danger-zone-${skin}.png`), clip: { x: 0, y: 0, width: 700, height: 900 } });
        await p.click('#topbar-clearall-btn'); await wait(100);
        await p.fill('#danger-confirm-input', 'DEL');
        await wait(100);
        if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `danger-modal-${skin}.png`) });
        await p.keyboard.press('Escape');
      }
      check(U.realErrors(app).length === 0, 'no page errors (' + U.realErrors(app).join(' | ') + ')');
      await app.ctx.close();
    }

    // ── 3. Traders: no Danger zone, wrappers refuse ──
    console.log('Trader');
    {
      const db = U.H.createDb({ workspace: payloadWithRecords() });
      const app = await U.open(browser, db, 'user-trader');
      const t = await app.page.evaluate(async () => {
        const zone = getComputedStyle(document.getElementById('danger-zone')).display;
        confirmFullReset(); confirmNuclearClear(); confirmWipeSupabaseWorkspace(); confirmClearChecklist(); confirmClearAllRecords();
        await new Promise(r => setTimeout(r, 100));
        return { zone, modal: getComputedStyle(document.getElementById('danger-confirm-modal')).display, role: ABPS_ROLE };
      });
      check(t.role === 'trader' && t.zone === 'none' && t.modal === 'none', 'trader: Danger zone hidden and confirm* wrappers do nothing ' + JSON.stringify(t));
      check(U.realErrors(app).length === 0, 'no page errors');
      await app.ctx.close();
    }
  } catch (e) {
    check(false, 'threw: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    U.summary('loose.test');
  }
})();
