/* ══════════════════════════════════════════════════════════════════
   BARGE TRACKING REPORTS — upload a PDF for a date range. The file
   lives in a Supabase Storage bucket ('barge-tracking-reports'); only
   the small metadata (dates, filename, storage path, who/when) goes
   through the normal shared-state sync so every operator and trader
   picks it up. Requires supabase_role_setup.sql's bucket/policy
   counterpart — see barge_tracking_bucket_setup.sql.
   ══════════════════════════════════════════════════════════════════ */
let _bargeTrackingReports = [];
const BTR_BUCKET = 'barge-tracking-reports';
const BTR_SEEN_KEY_BASE = 'flow_seen_tracking_report_ids';
// The "seen" list must be scoped to the SIGNED-IN ACCOUNT, not just the
// browser — this device may be shared between an operator and trader
// signing in/out of the same browser (exactly how this app gets tested
// day to day). Keying purely by browser meant one account's dismissal
// silently carried over to the next account that signed in on the same
// device, so nobody but the very first person ever saw a banner.
function _btrSeenKey() { return BTR_SEEN_KEY_BASE + '_' + (ABPS_UID || 'anon'); }

let _btrFromPicker = null, _btrToPicker = null;
function openBtrFromPicker() {
  const inp = document.getElementById('btr-from');
  if (!inp) return;
  if (_btrFromPicker) { _btrFromPicker.open(); return; }
  _btrFromPicker = flatpickr(inp, { dateFormat: 'j M Y', allowInput: false, disableMobile: true, minDate: '2026-01-01', onReady(_,__,fp){ fp.open(); } });
  _btrFromPicker.open();
}
function openBtrToPicker() {
  const inp = document.getElementById('btr-to');
  if (!inp) return;
  if (_btrToPicker) { _btrToPicker.open(); return; }
  _btrToPicker = flatpickr(inp, { dateFormat: 'j M Y', allowInput: false, disableMobile: true, minDate: '2026-01-01', onReady(_,__,fp){ fp.open(); } });
  _btrToPicker.open();
}

function renderBargeTrackingPage() {
  const uploadCard = document.getElementById('btr-upload-card');
  const lockedNote = document.getElementById('btr-upload-locked');
  if (uploadCard) uploadCard.style.display = isTrader() ? 'none' : '';
  if (lockedNote) lockedNote.style.display = isTrader() ? 'flex' : 'none';
  renderBargeTrackingReports();
}

function renderBargeTrackingReports() {
  const el = document.getElementById('btr-list');
  if (!el) return;
  const sorted = (_bargeTrackingReports || []).slice().sort(function(a, b) {
    return new Date(b.dateFrom) - new Date(a.dateFrom);
  });
  if (!sorted.length) {
    el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);font-size:12.5px">No tracking reports uploaded yet.</div>';
    return;
  }
  const canManage = !isTrader(); // traders can view/open; only operators delete
  el.innerHTML = sorted.map(function(r) {
    const from = new Date(r.dateFrom), to = new Date(r.dateTo);
    const fmtD = d => isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const uploadedAt = r.uploadedAt ? new Date(r.uploadedAt).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
    return `<div class="card" style="padding:12px 16px;margin-bottom:8px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <span style="font-size:9.5px;font-weight:700;padding:3px 9px;border-radius:4px;background:var(--pg-bargetracking);color:#fff;font-family:'DM Mono',monospace;letter-spacing:.04em">PDF</span>
      <div style="flex:1;min-width:180px">
        <div style="font-size:13px;font-weight:700;color:var(--ink)">${fmtD(from)} → ${fmtD(to)}</div>
        <div style="font-size:11px;color:var(--sub);margin-top:1px;word-break:break-all">${esc(r.fileName || 'report.pdf')}</div>
      </div>
      <div style="font-size:10.5px;color:var(--muted);text-align:right;min-width:150px">
        <div>Uploaded by ${(r.uploadedByRole || 'operator') === 'operator' ? 'Operator' : esc(r.uploadedByEmail || 'unknown')}</div>
        <div style="margin-top:1px">${uploadedAt}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-primary btn-sm" onclick="openBargeTrackingReport('${escJs(r.id)}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          Open
        </button>
        ${canManage ? `<button class="btn btn-secondary btn-sm" onclick="deleteBargeTrackingReport('${escJs(r.id)}')" title="Remove">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function uploadBargeTrackingReport() {
  if (isTrader()) { showToast('Only operators can upload tracking reports.', 'error'); return; }
  const fromInp = document.getElementById('btr-from');
  const toInp = document.getElementById('btr-to');
  const fileInp = document.getElementById('btr-file');
  const btn = document.getElementById('btr-upload-btn');
  // Use the picker's own parsed date — new Date("5 Oct 2026") isn't
  // reliably parsed across browsers (Safari returns Invalid Date).
  const _pickedDate = function(fp, inp) {
    if (fp && fp.selectedDates && fp.selectedDates[0]) return fp.selectedDates[0];
    return inp && inp.value ? parseDT(inp.value) : null;
  };
  const dateFrom = _pickedDate(_btrFromPicker, fromInp);
  const dateTo = _pickedDate(_btrToPicker, toInp);
  const file = fileInp && fileInp.files && fileInp.files[0];

  if (!dateFrom || isNaN(dateFrom) || !dateTo || isNaN(dateTo)) { showToast('Pick a From and To date first.', 'warning'); return; }
  if (!file) { showToast('Choose a PDF file to upload.', 'warning'); return; }
  if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    showToast('Only PDF files are supported here.', 'warning'); return;
  }
  if (!_syncReady()) { showToast('Cloud sync isn\'t set up — can\'t upload a report that reaches your team.', 'error', 0); return; }

  if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }
  try {
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const uploaderEmail = (sessionData && sessionData.session && sessionData.session.user && sessionData.session.user.email) || 'unknown';

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${Date.now()}_${safeName}`;
    const { error: upErr } = await supabaseClient.storage.from(BTR_BUCKET).upload(storagePath, file, { contentType: 'application/pdf', upsert: false });
    if (upErr) throw upErr;

    const record = {
      id: 'btr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      fileName: file.name,
      storagePath,
      uploadedByEmail: uploaderEmail,
      // Only operators ever reach this point (traders are blocked at the
      // top of this function), so this is always accurate — no lookup
      // needed, and safe under RLS (which only lets each user read their
      // own row in user_roles, not everyone else's).
      uploadedByRole: 'operator',
      uploadedAt: Date.now(),
    };
    _bargeTrackingReports = (_bargeTrackingReports || []).concat([record]);

    // Mark it as already-seen on THIS browser (the uploader doesn't need
    // their own banner) before syncing, so the banner only fires for
    // everyone else who pulls this down.
    _markTrackingReportsSeen([record.id]);

    await saveSharedState();
    renderBargeTrackingReports();
    showToast('Report uploaded — your team will see it shortly.', 'success');

    if (_btrFromPicker) _btrFromPicker.clear(); else if (fromInp) fromInp.value = '';
    if (_btrToPicker) _btrToPicker.clear(); else if (toInp) toInp.value = '';
    if (fileInp) fileInp.value = '';
  } catch (e) {
    showToast('Upload failed: ' + (e.message || e), 'error', 0);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;vertical-align:-2px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Upload Report'; }
  }
}

async function openBargeTrackingReport(id) {
  const r = (_bargeTrackingReports || []).find(function(x) { return x.id === id; });
  if (!r) return;
  if (!_syncReady()) { showToast('Cloud sync isn\'t set up.', 'error'); return; }
  try {
    const { data, error } = await supabaseClient.storage.from(BTR_BUCKET).createSignedUrl(r.storagePath, 3600);
    if (error) throw error;
    window.open(data.signedUrl, '_blank');
  } catch (e) {
    showToast('Could not open report: ' + (e.message || e), 'error');
  }
}

async function deleteBargeTrackingReport(id) {
  if (isTrader()) { showToast('Only operators can remove tracking reports.', 'error'); return; }
  const r = (_bargeTrackingReports || []).find(function(x) { return x.id === id; });
  if (!r) return;
  if (!confirm('Remove this tracking report (' + (r.fileName || '') + ')? This cannot be undone.')) return;
  // Even if the storage delete fails, still drop it from the list below —
  // but say so, rather than silently leaving an orphaned PDF in storage.
  let storageErr = null;
  try {
    if (_syncReady()) {
      const res = await supabaseClient.storage.from(BTR_BUCKET).remove([r.storagePath]);
      if (res && res.error) storageErr = res.error;
    }
  } catch (e) { storageErr = e; }
  if (storageErr) showToast('The PDF could not be deleted from storage (' + (storageErr.message || storageErr) + ') — it is removed from the list, but the file may remain in the storage bucket.', 'warning', 8000);
  _bargeTrackingReports = (_bargeTrackingReports || []).filter(function(x) { return x.id !== id; });
  await saveSharedState();
  renderBargeTrackingReports();
  showToast('Report removed.', 'success');
}

/* ── Cross-user "new report" banner ───────────────────────────────
   showToast() is local-only and disappears in a few seconds — not
   enough for "every trader and operator gets notified" about a report
   uploaded on someone else's device. This banner is unmissable (fixed,
   top of screen, on every page) and stays until the person dismisses
   it or opens the report, tracked per-browser via localStorage so
   dismissing it doesn't hide it from anyone else. ── */
function _getSeenTrackingReportIds() {
  try { return new Set(JSON.parse(localStorage.getItem(_btrSeenKey()) || '[]')); } catch (e) { return new Set(); }
}
function _markTrackingReportsSeen(ids) {
  const seen = _getSeenTrackingReportIds();
  ids.forEach(function(id) { seen.add(id); });
  try { localStorage.setItem(_btrSeenKey(), JSON.stringify(Array.from(seen))); } catch (e) {}
}
function _checkNewTrackingReportAlerts() {
  const seen = _getSeenTrackingReportIds();
  const unseen = (_bargeTrackingReports || []).filter(function(r) { return !seen.has(r.id); });
  const badge = document.getElementById('nav-badge-bargetracking');
  if (badge) {
    if (unseen.length > 0) { badge.textContent = unseen.length; badge.style.display = ''; }
    else badge.style.display = 'none';
  }
  if (unseen.length > 0) _showTrackingReportBanner(unseen);
  else _hideTrackingReportBanner();
}
function _showTrackingReportBanner(unseen) {
  let banner = document.getElementById('btr-alert-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'btr-alert-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999996;background:var(--pg-bargetracking);color:#fff;font-size:12.5px;font-weight:600;padding:9px 16px;text-align:center;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap';
    document.body.appendChild(banner);
  }
  const latest = unseen.slice().sort(function(a,b){ return (b.uploadedAt||0)-(a.uploadedAt||0); })[0];
  const msg = unseen.length === 1
    ? `📄 New Barge Tracking Report uploaded (${esc(latest.fileName||'report.pdf')}) by Operator`
    : `📄 ${unseen.length} new Barge Tracking Reports uploaded`;
  banner.innerHTML = `<span>${msg}</span>` +
    `<button onclick="showPage('bargetracking');_dismissTrackingReportAlerts()" style="background:#fff;color:var(--pg-bargetracking);border:none;border-radius:5px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer">View</button>` +
    `<button onclick="_dismissTrackingReportAlerts()" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.6);border-radius:5px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer">Dismiss</button>`;
  banner.style.display = 'flex';
}
function _hideTrackingReportBanner() {
  const banner = document.getElementById('btr-alert-banner');
  if (banner) banner.style.display = 'none';
}
function _dismissTrackingReportAlerts() {
  _markTrackingReportsSeen((_bargeTrackingReports || []).map(function(r) { return r.id; }));
  _hideTrackingReportBanner();
  const badge = document.getElementById('nav-badge-bargetracking');
  if (badge) badge.style.display = 'none';
}

// Keeps the Loading form's barge dropdown in sync with the configured
// fleet, preserving whatever is currently selected where possible.
function _populateLoadingBargeSelect() {
  const fleet = _fleetNow();
  ['ld-barge', 'ld-from-barge'].forEach(function(id) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = fleet.map(function(b) { return `<option value="${esc(b.name)}">${esc(b.name)}</option>`; }).join('');
    if (prev && fleet.some(function(b) { return b.name === prev; })) sel.value = prev;
  });
  if (typeof _ldKind === 'function' && _ldKind() === 'transfer') _ldSyncFromBarge();
}

// Loadings whose window hasn't fully passed, scoped to one barge — used to
// interleave Loading entries chronologically into that barge's Supply
// Timeline instead of showing them as a separate summary block.
function _loadingsForBargeName(name) {
  const now = new Date();
  return (_loadingRecords || []).filter(function(r) {
    return !r.deletedAt && !r.completed && r.kind !== 'transfer' && new Date(r.endAt) >= now && _resolveRecordBargeName(r) === name;
  });
}
// Barge transfers still ahead that involve this barge (discharging or receiving).
function _transfersForBargeName(name) {
  const now = new Date();
  return (_loadingRecords || []).filter(function(r) {
    return r && r.kind === 'transfer' && !r.deletedAt && !r.completed && new Date(r.endAt) >= now && (r.barge === name || r.fromBarge === name);
  });
}

// ── Supply Timeline strip — shows every loading whose window hasn't
// fully passed, so operators can plan barge supply around terminal
// occupancy. Purely additive: sits above the existing per-barge Gantt
// and never touches its rendering.
// ── Supply Timeline strip — superseded by inline interleaving of Loading
// entries directly into each barge's chronological card list in buildTL()
// below, per an explicit request that Loading sit *between* the vessel
// cards it actually falls between, not as a separate summary block above
// them. Left as a no-op (rather than deleted) since other code still
// calls it via _refreshLoadingConsumers().
function renderTimelineLoadingStrip() {
  const el = document.getElementById('timeline-loading-strip');
  if (el) el.innerHTML = '';
}

function _flashSyncBanner(msg, color) {
  const b = document.createElement('div');
  b.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;background:${color};color:#fff;border-radius:12px;padding:12px 22px;font-size:13px;font-weight:700;font-family:DM Sans,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.22);white-space:nowrap;transition:opacity .4s`;
  b.textContent = msg;
  document.body.appendChild(b);
  setTimeout(() => { b.style.opacity='0'; setTimeout(()=>b.remove(), 400); }, 3500);
}

/* ── Auto-sync poll (every 30s when sync configured) ── */
// One pull: skipped while a save is in flight (applying remote state then
// would roll the UI back), and deferred while someone is typing in a vessel
// or barge card (re-rendering would wipe what they're typing). Only applies
// a strictly NEWER version, and merges any local unsynced edits.
async function _pollOnce(manual) {
  if (!_syncReady()) return;
  if (_isSyncing || _saveRunning || _saveQueued) return;
  if (!manual && _isEditingSyncedForm()) { _deferPollUntilBlur(); return; }
  _isSyncing = true;
  const endPull = _beginPull(); // a save requested meanwhile waits for this pull (see saveSharedState)
  try {
    const applied = await _pullAndMerge({});
    _pollFailCount = 0;
    if (applied) setSyncStatus('ok', `Auto-synced at ${new Date().toLocaleTimeString()} — colleague pushed changes`);
  } catch(e) {
    _pollFailCount++;
    setSyncStatus('error', `Auto-sync failed: ${e.message}`);
    if (_cloudBaseUnknown) _showOfflineBanner();
    else if (_pollFailCount >= 2) _showSyncWarningBanner(e.message); // don't flash the banner for one blip
  } finally {
    _isSyncing = false;
    endPull();
  }
}
function _deferPollUntilBlur() {
  if (_deferPollUntilBlur._armed) return;
  _deferPollUntilBlur._armed = true;
  document.addEventListener('focusout', function onOut() {
    document.removeEventListener('focusout', onOut, true);
    _deferPollUntilBlur._armed = false;
    // Re-check shortly after: focus may just have moved to the next field.
    setTimeout(function() { _pollOnce(); }, 400);
  }, true);
}
// Poll cadence: 30 s normally; 60 s while the Realtime channel is live
// (it's then only the safety net — see REALTIME below).
let SYNC_POLL_MS      = 30000;
let SYNC_POLL_LIVE_MS = 60000;
function _pollIntervalMs() { return _rtStatus === 'live' ? SYNC_POLL_LIVE_MS : SYNC_POLL_MS; }
function startAutoSync() {
  if (_syncInterval) clearInterval(_syncInterval);
  _syncInterval = setInterval(async () => {
    _pollTicks++;
    await _pollOnce();
    // Runs every tick regardless of whether a remote pull happened —
    // covers both "a colleague changed something" and "I changed
    // something locally on this device" without needing to hook into
    // every single state-mutating function individually.
    _refreshGlobalAlertsBell();
  }, _pollIntervalMs());
  _refreshGlobalAlertsBell(); // show the correct count immediately, don't wait for the first 30s tick
}
let _pollTicks = 0; // how many timer polls have run (diagnostics / tests)

/* ── REALTIME — instant sync via Supabase postgres_changes ─────────────
   Polling alone means a colleague's save can take up to 30 s to appear.
   A Realtime subscription on abps_workspace tells this device within ~1 s
   that the row changed — and then runs the SAME pull path a poll uses
   (_pollOnce → _pullAndMerge), so the version check, three-way merge,
   save serialisation and focus deferral all still apply. The event's own
   payload is never applied: it can be large or truncated, and only the
   pull path knows how to merge safely.
   Polling stays on as the safety net (offline, reconnects, or the SQL that
   adds the table to the supabase_realtime publication not run yet — the
   subscription then succeeds but simply never fires), slowed to 60 s while
   the channel is SUBSCRIBED. Realtime applies the table's RLS select
   policy, so traders receive events exactly as operators do. */
let _rtChannel     = null;
let _rtStatus      = 'off';   // 'off' | 'connecting' | 'live' | 'down'
let _rtWanted      = false;   // false before init and after logout
let _rtAttempt     = 0;       // channel generation — each (re)subscribe gets a fresh name
let _rtRetryTimer  = null;
let _rtRetryDelay  = 0;
let _rtPullTimer   = null;
let _rtEverLive    = false;
let _rtAuthBound   = false;
let _rtEvents      = 0;       // diagnostics: events received / pulls they triggered
let _rtPulls       = 0;
const _RT_LOG_IDS  = ['nomination_email_log', 'nomination_cancel_email_log'];

function _rtSetStatus(s) {
  const prev = _rtStatus;
  _rtStatus = s;
  _renderLiveIndicator();
  // Switch the safety-net poll between 30 s and 60 s — but never restart a
  // poll that was deliberately paused (Wipe Cloud clears _syncInterval).
  if (_syncInterval && (prev === 'live') !== (s === 'live')) startAutoSync();
}
function _renderLiveIndicator() {
  const el = document.getElementById('sync-live');
  if (!el) return;
  const live = _rtStatus === 'live';
  el.dataset.state = _rtStatus;
  el.style.display = _rtStatus === 'off' ? 'none' : '';
  const txt = live ? 'Live' : 'Syncing every ' + Math.round(SYNC_POLL_MS / 1000) + ' s';
  const label = el.querySelector('.sync-live-text');
  if (label && label.textContent !== txt) label.textContent = txt;
  el.title = live
    ? 'Live — colleagues\' changes appear within a second or two (with a ' + Math.round(SYNC_POLL_LIVE_MS / 1000) + ' s check as a backup)'
    : (_rtStatus === 'connecting' ? 'Connecting to live updates… meanwhile checking every ' : 'Live updates unavailable — checking for changes every ') + Math.round(SYNC_POLL_MS / 1000) + ' s';
}

function _rtStart() {
  if (!_syncReady() || typeof supabaseClient.channel !== 'function') return;
  _rtWanted = true;
  _rtBindAuth();
  _rtSubscribe();
}
function _rtStop() {
  _rtWanted = false;
  if (_rtRetryTimer) { clearTimeout(_rtRetryTimer); _rtRetryTimer = null; }
  if (_rtPullTimer) { clearTimeout(_rtPullTimer); _rtPullTimer = null; }
  _rtTeardown();
  _rtSetStatus('off');
}
function _rtTeardown() {
  const ch = _rtChannel;
  _rtChannel = null; // set first: the old channel's late CLOSED callback is then ignored
  if (ch) { try { const p = supabaseClient.removeChannel(ch); if (p && p.catch) p.catch(function() {}); } catch(e) {} }
}
function _rtSubscribe() {
  if (!_rtWanted || !supabaseClient) return;
  if (_rtRetryTimer) { clearTimeout(_rtRetryTimer); _rtRetryTimer = null; }
  _rtTeardown();
  _rtSetStatus('connecting');
  // A fresh name per attempt: supabase-js hands back an existing channel with
  // the same topic until its async removal finishes, which would re-use the
  // errored one.
  const name = _rtAttempt++ ? 'workspace-' + _rtAttempt : 'workspace';
  let ch;
  try {
    ch = supabaseClient.channel(name)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'abps_workspace' }, _rtOnChange);
    _rtChannel = ch;
    ch.subscribe(function(status, err) {
      if (ch !== _rtChannel) return; // superseded / torn down
      if (status === 'SUBSCRIBED') {
        _rtRetryDelay = 0;
        const reconnect = _rtEverLive;
        _rtEverLive = true;
        _rtSetStatus('live');
        // Changes made while we were disconnected sent no event — catch up.
        if (reconnect) _rtSchedulePull();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (err) console.warn('FLOW realtime:', status, err && err.message);
        _rtSetStatus('down');
        _rtScheduleRetry();
      }
    });
  } catch(e) {
    console.warn('FLOW realtime: subscribe failed —', e && e.message);
    _rtChannel = null;
    _rtSetStatus('down');
    _rtScheduleRetry();
  }
}
// Exponential backoff (2 s → 60 s, with jitter); polling covers the gap.
function _rtScheduleRetry() {
  if (!_rtWanted || _rtRetryTimer) return;
  _rtRetryDelay = Math.min(60000, _rtRetryDelay ? _rtRetryDelay * 2 : 2000);
  const wait = Math.round(_rtRetryDelay * (0.8 + Math.random() * 0.4));
  _rtRetryTimer = setTimeout(function() { _rtRetryTimer = null; _rtSubscribe(); }, wait);
}
// Sign-in / token refresh: supabase-js re-auths an open socket itself, but a
// channel that dropped while the token was stale is resubscribed straight
// away rather than waiting out the backoff. Sign-out stops it.
function _rtBindAuth() {
  if (_rtAuthBound || !supabaseClient.auth || typeof supabaseClient.auth.onAuthStateChange !== 'function') return;
  _rtAuthBound = true;
  try {
    supabaseClient.auth.onAuthStateChange(function(event) {
      if (event === 'SIGNED_OUT') { _rtStop(); if (typeof _flowSessionLostGate === 'function') _flowSessionLostGate('signed out'); return; }
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && _rtWanted && _rtStatus !== 'live') {
        _rtRetryDelay = 0;
        setTimeout(_rtSubscribe, 0); // outside the auth callback (supabase-js holds a lock there)
      }
    });
  } catch(e) {}
}
window.addEventListener('online', function() {
  if (_rtWanted && _rtStatus !== 'live') { _rtRetryDelay = 0; _rtSubscribe(); }
});

function _rtOnChange(evt) {
  _rtEvents++;
  const nu = (evt && evt.new) || {}, old = (evt && evt.old) || {};
  const id = nu.id != null ? nu.id : old.id;
  if (_RT_LOG_IDS.indexOf(id) !== -1) { _rtScheduleLogRefresh(); return; }
  if (id !== ABPS_WORKSPACE_ID) return;
  // Echo of this device's own save: the row is at the version we already
  // hold, or our save is still in flight (it reconciles any concurrent
  // change itself via the compare-and-swap conflict path).
  const v = Number(nu.version) || 0;
  if (evt.eventType !== 'DELETE' && v && v === Number(_lastKnownVersion)) return;
  if (_saveRunning || _saveQueued) return;
  _rtSchedulePull();
}
// Debounced (~300 ms) so a burst of events costs one pull. Waits out a poll
// already running (it may have read the row just before this change).
function _rtSchedulePull(tries) {
  if (_rtPullTimer) clearTimeout(_rtPullTimer);
  _rtPullTimer = setTimeout(function() {
    _rtPullTimer = null;
    if (!_syncInterval) return; // sync deliberately paused (Wipe Cloud / reload pending)
    if (_isSyncing || _saveRunning || _saveQueued) {
      if ((tries || 0) < 20) _rtSchedulePull((tries || 0) + 1);
      return;
    }
    _rtPulls++;
    _pollOnce().then(function() { _refreshGlobalAlertsBell(); });
  }, tries ? 500 : 300);
}
let _rtLogTimer = null;
function _rtScheduleLogRefresh() {
  if (_rtLogTimer) clearTimeout(_rtLogTimer);
  _rtLogTimer = setTimeout(async function() {
    _rtLogTimer = null;
    try {
      await _loadNomEmailLogRemote();
      await _loadNomCancelEmailLogRemote();
      document.querySelectorAll('.vcard[id^="vessel-"]').forEach(function(card) {
        const cid = card.id.replace('vessel-', '');
        _refreshSendEmailButtonState(cid);
        _refreshCancelEmailButtonState(cid);
      });
    } catch(e) { console.warn('FLOW realtime: email-log refresh failed —', e && e.message); }
  }, 300);
}
// Back online after the first pull failed → recover straight away rather
// than waiting for the next 30s tick.
window.addEventListener('online', function() {
  if (_cloudBaseUnknown || _pollFailCount) _pollOnce(true);
});

// A background/minimized tab routinely has its timers throttled or fully
// paused by the browser — including the 30s auto-sync poll above and
// Supabase's own autoRefreshToken timer — so a long idle stretch (this is
// a dashboard people leave open all day) is exactly when the session is
// most likely to have quietly expired by the time anyone looks at the tab
// again. Proactively refresh the instant it becomes visible, rather than
// waiting for whatever the user does next to be the thing that discovers
// the expired token and shows the sync-failed banner.
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible' && _syncReady() && _abpsAppStarted) {
    _ensureFreshSession().catch(function() {}); // signed out: it brings up the sign-in form
  }
});

/* ── NEW VERSION CHECK ─────────────────────────────────────────────
   Every deploy is live at once (several a day), but a tab, the wallboard or
   the Android app (it loads the live site) opened before it keeps running the
   OLD code against the newer shared data until it is reloaded — and its saves
   can undo what the new code wrote. So at load we note a fingerprint of the
   deployed index.html, and look again when the app comes back into view or
   gets focus, and every 5 minutes while it is on screen — never offline. The
   fingerprint is the file's ETag / Last-Modified from a HEAD request (the
   service worker only handles GETs, so it can't answer from its cache); a
   host that sends neither gets a hash of the file itself, at most hourly.
   A different fingerprint = a new build: a banner offers Reload, and the page
   reloads by itself only when nothing can be lost (_buildReloadSafe), then
   comes back on the same page without the welcome screen. Never in a loop: at
   most one automatic reload per new build and per 30 minutes, and none for
   the rest of the session once a reload didn't land on the build it was for
   (a host whose fingerprint keeps changing). */
const BUILD_CHECK_MS     = 5 * 60000;
const BUILD_HASH_MS      = 60 * 60000; // whole-file hash (no ETag / Last-Modified) at most this often
const BUILD_AUTO_GAP_MS  = 30 * 60000; // at most one automatic reload per this long
const LS_BUILD_FP_KEY     = 'flow_build_fp';     // fingerprint at the last load that could check — an offline launch runs that build from the service worker's cache
const SS_BUILD_RELOAD_KEY = 'flow_build_reload'; // {fp, at, pending, off} of this tab's last automatic reload
const SS_BUILD_PAGE_KEY   = 'flow_build_page';   // page to show again after an update reload
let _buildFp = null, _buildNewFp = null, _buildChecking = false, _buildLastCheck = 0, _buildLastHash = 0, _buildBannerHidden = false;

async function _buildFetchFp() {
  const res = await fetch('./index.html', { method: 'HEAD', cache: 'no-store' });
  if (!res.ok) return null;
  const tag = (res.headers.get('etag') || '').replace(/^W\//, '') || res.headers.get('last-modified');
  if (tag) return tag;
  if (_buildFp && Date.now() - _buildLastHash < BUILD_HASH_MS) return null;
  _buildLastHash = Date.now();
  const full = await fetch('./index.html', { cache: 'no-store' });
  if (!full.ok) return null;
  const text = await full.text();
  return '#' + _fwHash(text) + '.' + text.length;
}
async function _buildCheck(force) {
  if (_buildChecking || navigator.onLine === false) return;
  if (_buildNewFp) { _buildOffer(); return; } // found already: only try the reload again
  if (!force && (document.visibilityState !== 'visible' || Date.now() - _buildLastCheck < 60000)) return;
  _buildChecking = true;
  _buildLastCheck = Date.now();
  try {
    const fp = await _buildFetchFp();
    if (!fp) return;
    if (!_buildFp) _buildFp = fp;
    else if (fp !== _buildFp) { _buildNewFp = fp; _buildOffer(); }
  } catch (e) { /* unreachable — try again next time */ }
  finally { _buildChecking = false; }
}
function _buildReloadRecord() {
  try { return JSON.parse(sessionStorage.getItem(SS_BUILD_RELOAD_KEY) || 'null'); } catch (e) { return { off: true }; }
}
// Nothing on this device a reload would lose, and nobody in the middle of something.
function _buildReloadSafe() {
  if (_saveRunning || _saveQueued || _pullRunning || _isSyncing) return false;
  if (_cloudBaseUnknown || _isMarkedUnsynced()) return false; // changes the cloud hasn't got
  if (_lastSyncedPayload && !_samePayload(_buildLocalPayload(), _lastSyncedPayload)) return false; // an edit not saved yet
  const el = document.activeElement;
  if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return false;
  if (document.fullscreenElement || document.webkitFullscreenElement) return false; // wallboard screen mode — a reload would end it
  if (_niDrafts.length || _niImage || ((document.getElementById('nimp-text') || {}).value || '').trim()) return false; // an import, never saved
  if (document.querySelector('.flatpickr-calendar.open')) return false;
  // A form typed into but not saved yet, or an upload on its way: the Loading
  // form (new or editing), a chosen file (Barge Tracking report) not uploaded.
  if (typeof _loadingEditingId !== 'undefined' && _loadingEditingId) return false;
  if (typeof _dealEditingId !== 'undefined' && _dealEditingId) return false;
  if (typeof _blModal !== 'undefined' && _blModal) return false;
  if (['ld-terminal', 'ld-qty', 'ld-surveyor', 'ld-notes', 'dl-supplier', 'dl-terminal', 'dl-qty', 'dl-ref', 'dl-notes'].some(function(id) { return ((document.getElementById(id) || {}).value || '').trim(); })) return false;
  const btrFile = document.getElementById('btr-file');
  if (btrFile && btrFile.files && btrFile.files.length) return false;
  const up = document.getElementById('btr-upload-btn');
  if (up && up.disabled) return false;
  // A dialog: anything fixed that covers the window (the welcome screen aside).
  return !Array.prototype.some.call(document.querySelectorAll('body [style*="position:fixed"], body [style*="position: fixed"]'), function(o) {
    if (o.id === 'flow-welcome-overlay') return false;
    const r = o.getBoundingClientRect();
    return r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9;
  });
}
function _buildOffer() {
  if (!_buildBannerHidden) _showBuildBanner();
  let safe = false;
  try { safe = _buildReloadSafe(); } catch (e) {}
  if (!safe) return; // the banner stays; tried again at the next check
  const last = _buildReloadRecord();
  if (last && (last.off || last.fp === _buildNewFp || Date.now() - (last.at || 0) < BUILD_AUTO_GAP_MS)) return;
  try { sessionStorage.setItem(SS_BUILD_RELOAD_KEY, JSON.stringify({ fp: _buildNewFp, at: Date.now(), pending: true })); } catch (e) { return; } // can't remember it → no automatic reload
  _buildReload();
}
function _buildReload() {
  try { sessionStorage.setItem(SS_BUILD_PAGE_KEY, _currentPage || 'dashboard'); } catch (e) {}
  location.reload();
}
// The banner's Reload: save what's pending first (kept on this device even when
// the cloud can't be reached, and merged after the reload).
async function _buildReloadNow() {
  if (_lastSyncedPayload || _cloudBaseUnknown) { try { await saveSharedState(); } catch (e) {} }
  _buildReload();
}
// After an update reload (once): the page that was on screen, or null.
function _buildReloadPage() {
  let p = null;
  try { p = sessionStorage.getItem(SS_BUILD_PAGE_KEY); sessionStorage.removeItem(SS_BUILD_PAGE_KEY); } catch (e) {}
  return p && PAGE_META[p] ? p : null;
}
function _showBuildBanner() {
  let banner = document.getElementById('build-update-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'build-update-banner';
    banner.setAttribute('role', 'status');
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999996;background:var(--azure-lt);border-bottom:1px solid var(--azure-bd);color:var(--azure-dk);font-size:12px;font-weight:600;padding:8px 16px;text-align:center;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap';
    banner.innerHTML = '<span>A new version of FLOW is available —</span>' +
      '<button onclick="_buildReloadNow()" style="background:var(--azure);color:#fff;border:none;border-radius:5px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer">Reload</button>' +
      '<button onclick="_buildBannerHidden=true;document.getElementById(\'build-update-banner\').style.display=\'none\'" style="background:transparent;color:var(--azure-dk);border:1px solid var(--azure-bd);border-radius:5px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer">Later</button>';
    document.body.appendChild(banner);
  }
  banner.style.display = 'flex';
}
window.addEventListener('load', function() {
  _buildCheck(true).then(function() {
    const checked = !!_buildFp;
    if (checked) { try { localStorage.setItem(LS_BUILD_FP_KEY, _buildFp); } catch (e) {} }
    else { try { _buildFp = localStorage.getItem(LS_BUILD_FP_KEY); } catch (e) {} }
    // First load after an automatic reload: it must be on the build it was for.
    const last = _buildReloadRecord();
    if (last && last.pending) {
      last.pending = false;
      if (checked && last.fp !== _buildFp) last.off = true;
      try { sessionStorage.setItem(SS_BUILD_RELOAD_KEY, JSON.stringify(last)); } catch (e) {}
    }
  });
  setInterval(_buildCheck, BUILD_CHECK_MS);
});
document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'visible') _buildCheck(); });
window.addEventListener('focus', function() { _buildCheck(); });

