/* ═══════════════════════════════════════════════════════════════
   NOMINATION EMAIL NOTIFICATIONS — Fix #3
   ─────────────────────────────────────────────────────────────
   Sends an automatic email the instant a new vessel nomination is
   added, to ANY operator, with no page refresh required.

   SETUP REQUIRED (one-time, ~5 minutes, free):
   This file has no backend, so sending real email needs a
   client-side email API. EmailJS (https://www.emailjs.com) is the
   standard tool for this and has a free tier that's enough for
   nomination volume. To activate:
     1. Create a free EmailJS account.
     2. Add an Email Service connected to the SENDER address
        (abpsops@gmail.com) — EmailJS walks you through connecting
        a Gmail account for sending.
     3. Create an Email Template with these variables in the body:
        {{subject}}, {{message}}, {{to_email}}
     4. Copy your Public Key, Service ID, and Template ID into the
        three constants below.
   Until those three values are filled in, nominations are still
   tracked and the email content is still generated and logged to
   the console — only the actual outbound send is skipped, and the
   UI shows a clear "email not configured" notice rather than
   silently pretending to have sent something.
   ═══════════════════════════════════════════════════════════════ */

// NOTE (unverified config): EmailJS Service IDs are normally 'service_…'
// (EmailJS dashboard → Email Services → the service's "Service ID"). An email
// address here only works if the service was given that exact custom ID —
// if every send fails with a 400 "service ID is invalid", copy the real ID in
// here. Also in the EmailJS dashboard: the template's "To Email" should be
// either {{to_email}} or a fixed address (to_email below is ignored then),
// and Account → Security → allowed origins must include this app's domain.
// Not changed blind — _emailSendFailureHint() points at this on failure.
const EMAILJS_PUBLIC_KEY  = 'd1941h1Yp0MHl7sWJ';
const EMAILJS_SERVICE_ID  = 'abpsops@gmail.com';
const EMAILJS_TEMPLATE_ID = 'template_wwr6lvu';

const NOMINATION_EMAIL_FROM = 'abpsops@gmail.com';
const NOMINATION_EMAIL_TO   = 'abpsops@gmail.com';

function _emailNotifyConfigured() {
  return !!(EMAILJS_PUBLIC_KEY && EMAILJS_SERVICE_ID && EMAILJS_TEMPLATE_ID);
}
// Extra guidance appended to a send failure when the likely cause is the
// EmailJS setup rather than the network (see the NOTE above the constants).
function _emailSendFailureHint(reason) {
  const r = String(reason || '');
  if (navigator.onLine === false) return ' You appear to be offline.';
  if (!/^service_/.test(EMAILJS_SERVICE_ID) || /service|template|origin|public key|user id|400|403|412|422/i.test(r)) {
    console.warn('ABPS: EmailJS send failed — check EMAILJS_SERVICE_ID ("' + EMAILJS_SERVICE_ID + '"; normally "service_…"), the template\'s To Email setting, and allowed origins in the EmailJS dashboard.');
    return ' This may be an email-service setup problem — tell your FLOW admin to check the EmailJS settings.';
  }
  return '';
}

/* ── Shared cloud email-log access (both logs) ───────────────────────
   Each log is its own abps_workspace row ({ [nomUid]: entry }). Writes go
   through the log_nomination_email() RPC, which sets/clears ONE key
   atomically server-side — so two devices never overwrite each other's
   entries, and traders (who RLS blocks from writing abps_workspace
   directly) can record their sends too. If the RPC isn't installed yet
   (supabase_role_setup.sql not re-run), operators fall back to re-reading
   the row and merging the single key in just before upserting. */
function _isMissingRpcError(err) {
  if (!err) return false;
  return err.code === '42883' || err.code === 'PGRST202' ||
    /could not find the function|function .*does not exist/i.test(String(err.message || ''));
}
async function _emailLogFetchRemote(logId) {
  if (!_syncReady()) return { ok: false, unavailable: true, payload: null };
  try {
    await _ensureFreshSession(); // signed out, the log would read as "nothing sent yet"
    const { data, error } = await supabaseClient
      .from('abps_workspace').select('payload').eq('id', logId).maybeSingle();
    if (error) return { ok: false, error: error.message || String(error), payload: null };
    return { ok: true, payload: (data && data.payload) || {} };
  } catch(e) { return { ok: false, error: e.message || String(e), payload: null }; }
}
// entry = object to set, or null to clear that nomUid's key.
async function _emailLogWriteEntry(logId, nomUid, entry) {
  if (!_syncReady()) return { ok: false, error: 'cloud sync unavailable' };
  try {
    await _ensureFreshSession();
    const { error } = await supabaseClient.rpc('log_nomination_email', { log_id: logId, nom_uid: nomUid, entry: entry });
    if (!error) return { ok: true };
    if (!_isMissingRpcError(error)) return { ok: false, error: error.message || String(error) };
    if (isTrader()) return { ok: false, error: 'database function log_nomination_email() is missing — re-run supabase_role_setup.sql' };
    const fresh = await _emailLogFetchRemote(logId);
    if (!fresh.ok) return { ok: false, error: fresh.error || 'could not re-read the log' };
    const merged = Object.assign({}, fresh.payload);
    if (entry) merged[nomUid] = entry; else delete merged[nomUid];
    const { error: upErr } = await supabaseClient.from('abps_workspace').upsert({
      id: logId, payload: merged, version: Date.now(), updated_at: new Date().toISOString()
    });
    if (upErr) return { ok: false, error: upErr.message || String(upErr) };
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message || String(e) }; }
}

let _emailjsLoaded = false;
async function _loadEmailJS() {
  if (_emailjsLoaded && typeof emailjs !== 'undefined') return emailjs;
  return new Promise((resolve, reject) => {
    if (typeof emailjs !== 'undefined') { _emailjsLoaded = true; resolve(emailjs); return; }
    const s = document.createElement('script');
    // Pinned + SRI (hash of the npm file jsdelivr serves byte-for-byte).
    s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4.4.1/dist/email.min.js';
    s.integrity = 'sha384-SALc35EccAf6RzGw4iNsyj7kTPr33K7RoGzYu+7heZhT8s0GZouafRiCg1qy44AS';
    s.crossOrigin = 'anonymous';
    s.onload = () => {
      try { emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY }); } catch(e) {}
      _emailjsLoaded = true;
      resolve(emailjs);
    };
    s.onerror = () => reject(new Error('Could not load the email service library. Check your internet connection.'));
    document.head.appendChild(s);
  });
}

/* ── Permanent "already sent" log — Fix #3's No-Duplicate-Email Rule ──
   Own row in the same Supabase table used for the main workspace state,
   fully decoupled from ROB/schedule state, with a localStorage cache
   written FIRST so the emailSent flag is durable even if the network
   call never completes. A nomination's flag, once true, is NEVER
   cleared by refresh, reopen, redeploy, or re-viewing/editing the
   nomination — only this file's own logic ever sets it, and nothing
   in this app ever resets it back to false. ── */
const NOM_EMAIL_WORKSPACE_ID = 'nomination_email_log';
const NOM_EMAIL_LS_KEY        = 'abps_nomination_email_log_v1';

let _nomEmailLog = {};  // { [nomUid]: { emailSent: true, sentAt, vessel } }
let _nomEmailLogLoaded = false;

function _loadNomEmailLogLocal() {
  try {
    const raw = localStorage.getItem(NOM_EMAIL_LS_KEY);
    if (raw) { _nomEmailLog = JSON.parse(raw) || {}; return true; }
  } catch(e) {}
  return false;
}
function _saveNomEmailLogLocal() {
  try { localStorage.setItem(NOM_EMAIL_LS_KEY, JSON.stringify(_nomEmailLog)); } catch(e) {}
}
// Returns { ok, unavailable?, error? } so a send can refuse to go ahead
// when it couldn't check the shared log (see sendNominationEmailIfNeeded).
async function _loadNomEmailLogRemote() {
  const res = await _emailLogFetchRemote(NOM_EMAIL_WORKSPACE_ID);
  if (res.ok) {
    // Merge: a flag that is true ANYWHERE (local or remote) stays true —
    // this is a one-way ratchet, never reversed by a stale pull.
    const remote = res.payload;
    Object.keys(remote).forEach(function(uid) {
      if (remote[uid] && (!_nomEmailLog[uid] || (remote[uid].emailSent && !_nomEmailLog[uid].emailSent))) {
        _nomEmailLog[uid] = remote[uid];
      }
    });
    _saveNomEmailLogLocal();
  } else if (!res.unavailable) {
    console.warn('ABPS: could not read the shared nomination email log:', res.error);
  }
  _nomEmailLogLoaded = true;
  return res;
}
// Records ONE sent nomination in the shared log (never the whole local log,
// which would overwrite entries other devices added since we last read it).
async function _pushNomEmailLogRemote(nomUid) {
  if (!_syncReady() || !nomUid) return { ok: false, error: 'cloud sync unavailable' };
  const res = await _emailLogWriteEntry(NOM_EMAIL_WORKSPACE_ID, nomUid, _nomEmailLog[nomUid] || null);
  if (!res.ok) console.warn('ABPS: nomination email log cloud sync failed:', res.error);
  return res;
}

/* ── Stable per-nomination identity ──────────────────────────────────
   Every brand-new nomination card gets a permanent, unique uid the
   moment it's created — independent of vessel name (so re-nominating
   a vessel that already sailed correctly counts as a NEW nomination
   and gets its own email), and independent of scheduling (so it
   exists before "Generate Schedule" has ever been run). This uid is
   persisted on the vessel record itself (def.nomUid) exactly like
   every other vessel field, via captureCurrentState → applyState. */
function _newNominationUid() {
  return 'nom_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

/* ── Build the email subject + body from a nomination record ──────────
   Pulls every available field dynamically — nothing here is hardcoded
   to a specific vessel. Fields the user left blank are simply omitted
   from the body rather than printed as "undefined". */
// "500–600" when the vessel record carries a range (g = 'qty' | 'mgo'), else the number.
function _vesselQtyTxt(v, g) {
  const mn = v[g + 'Min'], mx = v[g + 'Max'];
  return (mn != null && mx != null && +mn < +mx) ? (+mn) + '–' + (+mx) : String(v[g] || 0);
}
// " (IMO 9321483 / MMSI 636012345)" after the vessel name — only the identifiers that are filled in.
function _vidEmailIds(v) {
  const s = _vidSplitDef(v && v.imo, v && v.mmsi), out = [];
  if (String(s.imo).trim()) out.push('IMO ' + _vidNorm(s.imo));
  if (String(s.mmsi).trim()) out.push('MMSI ' + _vidNorm(s.mmsi));
  return out.length ? ' (' + out.join(' / ') + ')' : '';
}
function _buildNominationEmail(v) {
  const subject = 'New Bunker Nomination – ' + (v.name || 'Unnamed Vessel');

  const lines = [];
  lines.push('Vessel Name: ' + (v.name || '—') + _vidEmailIds(v));
  if (v.eta) lines.push('ETA: ' + _vesselEtaTxt(v));
  if (v.area) {
    // Reuse the real AREA_OPTIONS list (defined later in the script, where
    // the nomination form's Anchorage/Berth dropdown is built) rather than
    // a separate hardcoded map, so the email location always matches
    // exactly what's shown and selectable in the form — no risk of drift.
    const areaOpt = (typeof AREA_OPTIONS !== 'undefined') ? AREA_OPTIONS.find(function(o){ return o.value === v.area; }) : null;
    lines.push('Location: ' + (areaOpt ? areaOpt.label : v.area));
  }
  lines.push('');
  lines.push('Quantity:');
  if (v.type === 'BOTH') {
    lines.push('MGO: ' + _vesselQtyTxt(v, 'mgo') + ' MT');
    lines.push('VLSFO: ' + _vesselQtyTxt(v, 'qty') + ' MT');
  } else if (v.type === 'MGO') {
    lines.push('LSMGO: ' + (v.mgo ? _vesselQtyTxt(v, 'mgo') : (v.qty || 0)) + ' MT');
  } else {
    lines.push('VLSFO: ' + _vesselQtyTxt(v, 'qty') + ' MT');
  }
  lines.push('');
  if (v.agent)     lines.push('Agents: ' + v.agent);
  if (v.manifold)  lines.push('MANIFOLD: ' + v.manifold);
  if (v.spec)      lines.push('ISO Spec: ' + v.spec);
  if (v.lc)        lines.push('Nominated Laycan: ' + v.lc);
  if (v.lcOnly)    lines.push('Supply within laycan only');
  if (v.remarks)   lines.push('Remarks: ' + v.remarks);

  return { subject: subject, body: lines.join('\n') };
}

/* ── Public entry point — call this exactly once per genuinely new
   nomination. Marks emailSent = true IMMEDIATELY and persists that
   locally before attempting the network send, so a crash, closed tab,
   or network failure can never cause a duplicate send on retry — the
   flag is the source of truth, not whether the send succeeded. ── */
// One send per nomUid at a time: the shared-log re-read below is awaited
// before the local "sent" mark, so without this a double trigger could pass
// the duplicate check twice.
const _emailSendsInFlight = {};
async function sendNominationEmailIfNeeded(v) {
  if (!v || !v.nomUid) return;
  const k = 'nom|' + v.nomUid;
  if (_emailSendsInFlight[k]) return;
  _emailSendsInFlight[k] = true;
  try { await _sendNominationEmailIfNeeded(v); } finally { delete _emailSendsInFlight[k]; }
}
async function _sendNominationEmailIfNeeded(v) {
  if (!_nomEmailLogLoaded) _loadNomEmailLogLocal();
  if (_nomEmailLog[v.nomUid] && _nomEmailLog[v.nomUid].emailSent) {
    return; // No-Duplicate-Email Rule: already sent for this nomination, ever — stop here
  }
  // Re-read the SHARED log right before every send (not just once per
  // session) so a send made from another device since then is caught.
  const remoteCheck = await _loadNomEmailLogRemote();
  if (_nomEmailLog[v.nomUid] && _nomEmailLog[v.nomUid].emailSent) {
    const by = _nomEmailLog[v.nomUid].sentAt ? ' at ' + new Date(_nomEmailLog[v.nomUid].sentAt).toLocaleString('en-GB') : '';
    _flashNominationEmailBanner('A nomination email for ' + (v.name || 'this vessel') + ' was already sent from another device' + by + ' — not sent again.', false);
    return;
  }
  if (!remoteCheck.ok && !remoteCheck.unavailable) {
    _flashNominationEmailBanner('Could not check whether this email was already sent from another device (' + remoteCheck.error + '). Nothing was sent — try again.', false);
    return;
  }

  const { subject, body } = _buildNominationEmail(v);

  if (!_emailNotifyConfigured()) {
    console.warn('ABPS: new nomination "' + (v.name||'') + '" — email NOT sent (EmailJS not configured). Subject would be: ' + subject);
    _flashNominationEmailBanner('Email notifications are not configured yet — nothing was sent.', false);
    return; // not configured is a setup problem, not a send attempt — never marked as sent
  }

  // Mark sent FIRST, before the network call returns — once we know we're
  // actually about to attempt a real send, the click is "spent" and must
  // never be allowed to fire twice even if the user double-clicks while
  // the request is in flight. If the send itself then fails, the catch
  // block below rolls this back so the button can legitimately retry.
  _nomEmailLog[v.nomUid] = { emailSent: true, sentAt: new Date().toISOString(), vessel: v.name || '' };
  _saveNomEmailLogLocal();

  try {
    await _loadEmailJS();
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email: NOMINATION_EMAIL_TO,
      from_email: NOMINATION_EMAIL_FROM,
      subject: subject,
      message: body
    });
    // Only sync the "sent" flag to the cloud once the send truly succeeded.
    const logRes = await _pushNomEmailLogRemote(v.nomUid);
    if (logRes.ok || !_syncReady()) _flashNominationEmailBanner('Nomination email sent for ' + (v.name || 'vessel') + '.', true);
    else _flashNominationEmailBanner('Nomination email sent for ' + (v.name || 'vessel') + ', but recording it in the shared log failed (' + logRes.error + ') — other devices may not see it as sent.', false);
  } catch(e) {
    // EmailJS rejects with a plain {status, text} object, not a real Error
    // — it has no .message, which is why that used to show up as
    // "(undefined)". Pull the actual reason out of whichever shape we got.
    const reason = (e && e.text) ? e.text
                 : (e && e.message) ? e.message
                 : (typeof e === 'string') ? e
                 : JSON.stringify(e);
    console.error('ABPS: nomination email send failed for "' + (v.name||'') + '":', reason, e);
    // Roll back: the send did not actually go out, so this nomination is
    // NOT "sent" — un-mark it locally so the button (or a future retry)
    // is allowed to try again instead of being permanently stuck locked.
    // (Nothing was written to the shared log yet, so there's nothing to clear there.)
    delete _nomEmailLog[v.nomUid];
    _saveNomEmailLogLocal();
    _flashNominationEmailBanner('Email failed to send (' + reason + '). You can try again.' + _emailSendFailureHint(reason), false);
  }
}

function _flashNominationEmailBanner(msg, ok) {
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;background:' + (ok ? 'var(--green)' : 'var(--amber)') + ';color:#fff;border-radius:12px;padding:12px 20px;font-size:12.5px;font-weight:600;font-family:DM Sans,sans-serif;display:flex;align-items:center;gap:10px;box-shadow:0 8px 32px rgba(0,0,0,.25);max-width:90vw;text-align:center';
  banner.textContent = msg;
  document.body.appendChild(banner);
  setTimeout(function(){ banner.style.opacity = '0'; banner.style.transition = 'opacity .4s'; setTimeout(function(){ banner.remove(); }, 400); }, 4500);
}

/* ── Manual "Send Nomination Email" button ───────────────────────────
   Reads ONE vessel card directly from its live form fields (no need for
   a generated schedule, no dependency on getVessels()'s validation),
   builds the email, and sends it. The button itself is responsible for
   its own one-time lock — see _lockSendEmailButton() below — but the
   underlying emailSent flag in _nomEmailLog is still the real source of
   truth: even if someone reloads the page or duplicates a button somehow,
   sendNominationEmailIfNeeded() will still refuse to send twice for the
   same nomUid. */
async function sendNominationEmailForCard(id) {
  const card = document.getElementById('vessel-' + id);
  if (!card) return;
  const btn = document.getElementById('v' + id + '-send-email-btn');

  const name = document.getElementById(`v${id}-name`)?.value?.trim();
  if (!name) { alert('Enter a vessel name first.'); return; }

  if (!_nomEmailLogLoaded) _loadNomEmailLogLocal();
  if (_nomEmailLog[card.dataset.nomUid] && _nomEmailLog[card.dataset.nomUid].emailSent) {
    _lockSendEmailButton(btn);
    return; // already sent — button should already be locked, this is just a safety net
  }
  // (sendNominationEmailIfNeeded re-reads the shared log itself before sending.)
  // No valid IMO / MMSI: say so, but send anyway (never blocks).
  _vidWarnCard(id, 'the nomination e-mail is sent without it.');

  const ty = document.getElementById(`v${id}-type`)?.value;
  const origLabel = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="animation:spin .8s linear infinite"><path d="M21 12a9 9 0 1 1-2.64-6.36"/></svg> Sending…';
  }

  try {
    await sendNominationEmailIfNeeded(Object.assign({
      nomUid:   card.dataset.nomUid,
      name:     name,
      imo:      document.getElementById(`v${id}-imo`)?.value || '',
      area:     document.getElementById(`v${id}-area`)?.value || '',
      type:     ty,
      qty:      ty === 'MGO'   ? 0 : _cardQty(id, 'vlsfo').qty,
      mgo:      ty === 'VLSFO' ? 0 : _cardQty(id, 'mgo').qty,
      agent:    document.getElementById(`v${id}-agent`)?.value || '',
      manifold: document.getElementById(`v${id}-manifold`)?.value || '',
      spec:     document.getElementById(`v${id}-spec`)?.value || '',
      lc:       document.getElementById(`v${id}-lc`)?.value || '',
      eta:      document.getElementById(`v${id}-eta`)?.value || '',
      remarks:  document.getElementById(`v${id}-remarks`)?.value || ''
    }, _cardQtyRangeFields(id), _cardEtaWinFields(id), _cardLcOnlyFields(id), _cardIdFields(id)));
  } finally {
    // _lockSendEmailButton reflects whatever sendNominationEmailIfNeeded
    // actually recorded in _nomEmailLog — if the send failed, the log was
    // never written and the button unlocks again so the user can retry.
    const sent = _nomEmailLog[card.dataset.nomUid] && _nomEmailLog[card.dataset.nomUid].emailSent;
    if (sent) {
      _lockSendEmailButton(btn);
    } else if (btn) {
      btn.disabled = false;
      btn.innerHTML = origLabel;
    }
  }
}

// Fix #3: permanently locks the button to a disabled "Sent ✓" state. Once
// applied there is no code path anywhere in this app that re-enables it —
// the only way a card's button unlocks again is if the card itself is
// deleted and a brand-new one is added (which gets a brand-new nomUid).
function _lockSendEmailButton(btn) {
  if (!btn) return;
  btn.disabled = true;
  btn.classList.add('sent');
  btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Sent';
}

// Called once per card right after it's inserted into the DOM (both for
// brand-new cards and cards restored from saved state) so a previously
// sent nomination shows the locked "Sent" state immediately on reload,
// instead of briefly looking sendable again before the async log check
// in sendNominationEmailForCard() would have caught it.
function _refreshSendEmailButtonState(id) {
  const card = document.getElementById('vessel-' + id);
  const btn = document.getElementById('v' + id + '-send-email-btn');
  if (!card || !btn) return;
  if (_nomEmailLog[card.dataset.nomUid] && _nomEmailLog[card.dataset.nomUid].emailSent) {
    _lockSendEmailButton(btn);
  }
}

/* ── "Nomination Cancelled" email — same delivery path (EmailJS, same
   to/from address, same one-time-per-nomination guarantee) as the
   regular nomination email above, just its own independent log and its
   own subject/body so cancelling never touches or re-locks the original
   "Send Nomination Email" button, and vice versa. ── */
const NOM_CANCEL_EMAIL_WORKSPACE_ID = 'nomination_cancel_email_log';
const NOM_CANCEL_EMAIL_LS_KEY        = 'abps_nomination_cancel_email_log_v1';

let _nomCancelEmailLog = {};  // { [nomUid]: { emailSent: true, sentAt, vessel } }
let _nomCancelEmailLogLoaded = false;

function _loadNomCancelEmailLogLocal() {
  try {
    const raw = localStorage.getItem(NOM_CANCEL_EMAIL_LS_KEY);
    if (raw) { _nomCancelEmailLog = JSON.parse(raw) || {}; return true; }
  } catch(e) {}
  return false;
}
function _saveNomCancelEmailLogLocal() {
  try { localStorage.setItem(NOM_CANCEL_EMAIL_LS_KEY, JSON.stringify(_nomCancelEmailLog)); } catch(e) {}
}
async function _loadNomCancelEmailLogRemote() {
  const res = await _emailLogFetchRemote(NOM_CANCEL_EMAIL_WORKSPACE_ID);
  if (res.ok) {
    const remote = res.payload;
    Object.keys(remote).forEach(function(uid) {
      if (remote[uid] && (!_nomCancelEmailLog[uid] || (remote[uid].emailSent && !_nomCancelEmailLog[uid].emailSent))) {
        _nomCancelEmailLog[uid] = remote[uid];
      }
    });
    _saveNomCancelEmailLogLocal();
  } else if (!res.unavailable) {
    console.warn('ABPS: could not read the shared nomination-cancelled email log:', res.error);
  }
  _nomCancelEmailLogLoaded = true;
  return res;
}
async function _pushNomCancelEmailLogRemote(nomUid) {
  if (!_syncReady() || !nomUid) return { ok: false, error: 'cloud sync unavailable' };
  const res = await _emailLogWriteEntry(NOM_CANCEL_EMAIL_WORKSPACE_ID, nomUid, _nomCancelEmailLog[nomUid] || null);
  if (!res.ok) console.warn('ABPS: nomination-cancelled email log cloud sync failed:', res.error);
  return res;
}

// Same field layout as _buildNominationEmail — only the subject prefix and
// an explicit "This nomination has been CANCELLED" line differ, so a
// cancellation email is unmistakable at a glance in an inbox even before
// it's opened, while still carrying every detail the original had.
function _buildNominationCancelledEmail(v) {
  const subject = 'Nomination Cancelled – ' + (v.name || 'Unnamed Vessel');

  const lines = [];
  lines.push('NOMINATION CANCELLED');
  lines.push('');
  lines.push('Vessel Name: ' + (v.name || '—') + _vidEmailIds(v));
  if (v.eta) lines.push('ETA: ' + _vesselEtaTxt(v));
  if (v.area) {
    const areaOpt = (typeof AREA_OPTIONS !== 'undefined') ? AREA_OPTIONS.find(function(o){ return o.value === v.area; }) : null;
    lines.push('Location: ' + (areaOpt ? areaOpt.label : v.area));
  }
  lines.push('');
  lines.push('Quantity (as nominated):');
  if (v.type === 'BOTH') {
    lines.push('MGO: ' + _vesselQtyTxt(v, 'mgo') + ' MT');
    lines.push('VLSFO: ' + _vesselQtyTxt(v, 'qty') + ' MT');
  } else if (v.type === 'MGO') {
    lines.push('LSMGO: ' + (v.mgo ? _vesselQtyTxt(v, 'mgo') : (v.qty || 0)) + ' MT');
  } else {
    lines.push('VLSFO: ' + _vesselQtyTxt(v, 'qty') + ' MT');
  }
  lines.push('');
  if (v.agent)     lines.push('Agents: ' + v.agent);
  if (v.manifold)  lines.push('MANIFOLD: ' + v.manifold);
  if (v.spec)      lines.push('ISO Spec: ' + v.spec);
  if (v.lc)        lines.push('Nominated Laycan: ' + v.lc);
  if (v.lcOnly)    lines.push('Supply within laycan only');
  if (v.remarks)   lines.push('Remarks: ' + v.remarks);

  return { subject: subject, body: lines.join('\n') };
}

async function sendNominationCancelledEmailIfNeeded(v) {
  if (!v || !v.nomUid) return;
  const k = 'cancel|' + v.nomUid;
  if (_emailSendsInFlight[k]) return;
  _emailSendsInFlight[k] = true;
  try { await _sendNominationCancelledEmailIfNeeded(v); } finally { delete _emailSendsInFlight[k]; }
}
async function _sendNominationCancelledEmailIfNeeded(v) {
  if (!_nomCancelEmailLogLoaded) _loadNomCancelEmailLogLocal();
  if (_nomCancelEmailLog[v.nomUid] && _nomCancelEmailLog[v.nomUid].emailSent) {
    return; // already sent a cancellation for this nomination — never send twice
  }
  // Fresh read of the shared log before every send — see sendNominationEmailIfNeeded.
  const remoteCheck = await _loadNomCancelEmailLogRemote();
  if (_nomCancelEmailLog[v.nomUid] && _nomCancelEmailLog[v.nomUid].emailSent) {
    const by = _nomCancelEmailLog[v.nomUid].sentAt ? ' at ' + new Date(_nomCancelEmailLog[v.nomUid].sentAt).toLocaleString('en-GB') : '';
    _flashNominationEmailBanner('A cancellation email for ' + (v.name || 'this vessel') + ' was already sent from another device' + by + ' — not sent again.', false);
    return;
  }
  if (!remoteCheck.ok && !remoteCheck.unavailable) {
    _flashNominationEmailBanner('Could not check whether this cancellation was already sent from another device (' + remoteCheck.error + '). Nothing was sent — try again.', false);
    return;
  }

  const { subject, body } = _buildNominationCancelledEmail(v);

  if (!_emailNotifyConfigured()) {
    console.warn('ABPS: nomination "' + (v.name||'') + '" cancellation — email NOT sent (EmailJS not configured). Subject would be: ' + subject);
    _flashNominationEmailBanner('Email notifications are not configured yet — nothing was sent.', false);
    return;
  }

  _nomCancelEmailLog[v.nomUid] = { emailSent: true, sentAt: new Date().toISOString(), vessel: v.name || '' };
  _saveNomCancelEmailLogLocal();

  try {
    await _loadEmailJS();
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email: NOMINATION_EMAIL_TO,
      from_email: NOMINATION_EMAIL_FROM,
      subject: subject,
      message: body
    });
    const logRes = await _pushNomCancelEmailLogRemote(v.nomUid);
    if (logRes.ok || !_syncReady()) _flashNominationEmailBanner('Nomination cancelled email sent for ' + (v.name || 'vessel') + '.', true);
    else _flashNominationEmailBanner('Nomination cancelled email sent for ' + (v.name || 'vessel') + ', but recording it in the shared log failed (' + logRes.error + ') — other devices may not see it as sent.', false);
  } catch(e) {
    const reason = (e && e.text) ? e.text
                 : (e && e.message) ? e.message
                 : (typeof e === 'string') ? e
                 : JSON.stringify(e);
    console.error('ABPS: nomination-cancelled email send failed for "' + (v.name||'') + '":', reason, e);
    delete _nomCancelEmailLog[v.nomUid];
    _saveNomCancelEmailLogLocal();
    _flashNominationEmailBanner('Email failed to send (' + reason + '). You can try again.' + _emailSendFailureHint(reason), false);
  }
}

async function sendNominationCancelledEmailForCard(id) {
  const card = document.getElementById('vessel-' + id);
  if (!card) return;
  const btn = document.getElementById('v' + id + '-cancel-email-btn');

  const name = document.getElementById(`v${id}-name`)?.value?.trim();
  if (!name) { alert('Enter a vessel name first.'); return; }

  if (!confirm('Send a "Nomination Cancelled" email for ' + name + '?')) return;

  if (!_nomCancelEmailLogLoaded) _loadNomCancelEmailLogLocal();
  if (_nomCancelEmailLog[card.dataset.nomUid] && _nomCancelEmailLog[card.dataset.nomUid].emailSent) {
    _lockCancelEmailButton(btn);
    return;
  }

  const ty = document.getElementById(`v${id}-type`)?.value;
  const origLabel = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="animation:spin .8s linear infinite"><path d="M21 12a9 9 0 1 1-2.64-6.36"/></svg> Cancelling…';
  }

  try {
    await sendNominationCancelledEmailIfNeeded(Object.assign({
      nomUid:   card.dataset.nomUid,
      name:     name,
      imo:      document.getElementById(`v${id}-imo`)?.value || '',
      area:     document.getElementById(`v${id}-area`)?.value || '',
      type:     ty,
      qty:      ty === 'MGO'   ? 0 : _cardQty(id, 'vlsfo').qty,
      mgo:      ty === 'VLSFO' ? 0 : _cardQty(id, 'mgo').qty,
      agent:    document.getElementById(`v${id}-agent`)?.value || '',
      manifold: document.getElementById(`v${id}-manifold`)?.value || '',
      spec:     document.getElementById(`v${id}-spec`)?.value || '',
      lc:       document.getElementById(`v${id}-lc`)?.value || '',
      eta:      document.getElementById(`v${id}-eta`)?.value || '',
      remarks:  document.getElementById(`v${id}-remarks`)?.value || ''
    }, _cardQtyRangeFields(id), _cardEtaWinFields(id), _cardLcOnlyFields(id), _cardIdFields(id)));
  } finally {
    const sent = _nomCancelEmailLog[card.dataset.nomUid] && _nomCancelEmailLog[card.dataset.nomUid].emailSent;
    if (sent) {
      _lockCancelEmailButton(btn);
    } else if (btn) {
      btn.disabled = false;
      btn.innerHTML = origLabel;
    }
  }
}

// Unlike the "Sent" nomination-email lock, cancellation can legitimately
// need to be sent again if the user made a mistake, so this only shows a
// "Cancelled ✓" confirmation state — it does not otherwise change what
// the button can do; sendNominationCancelledEmailIfNeeded() is still the
// one source of truth preventing an accidental double-send.
function _lockCancelEmailButton(btn) {
  if (!btn) return;
  btn.disabled = true;
  btn.classList.add('sent');
  btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Cancelled';
}

function _refreshCancelEmailButtonState(id) {
  const card = document.getElementById('vessel-' + id);
  const btn = document.getElementById('v' + id + '-cancel-email-btn');
  if (!card || !btn) return;
  if (_nomCancelEmailLog[card.dataset.nomUid] && _nomCancelEmailLog[card.dataset.nomUid].emailSent) {
    _lockCancelEmailButton(btn);
  }
}
