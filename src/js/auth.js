/* ═══════════════════════════════════════════════════════════════
   OPERATOR ACCESS — Supabase Auth, single shared team account
   ─────────────────────────────────────────────────────────────
   One shared email + password (created once in the Supabase
   dashboard) unlocks the workspace for everyone. The password is
   never stored or checked in this file — Supabase verifies it
   server-side and returns a signed session. The anon key below is
   safe to publish; it only grants what your Row Level Security
   policies allow (see Supabase setup notes).
   ═══════════════════════════════════════════════════════════════ */
const SUPABASE_URL      = 'https://siqntfkpdstikrqffmep.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpcW50ZmtwZHN0aWtycWZmbWVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMDAxODgsImV4cCI6MjA5OTU3NjE4OH0.mYrfXA7H4KmeY0EckwLXPnUQX5Ou1wLLnXNK-wwDSbU';

// If the Supabase CDN script failed to load (network hiccup, ad-blocker,
// CDN outage), window.supabase would be undefined and calling
// .createClient() on it would throw — which, as a top-level statement in
// this script block, would stop EVERY function below from being defined,
// breaking the entire sync/auth module (and anything that calls into it)
// even though the rest of the app has nothing to do with Supabase. Guard
// against that so a CDN failure degrades to "sync unavailable" instead of
// silently breaking unrelated functionality.
let supabaseClient = null;
let _supabaseLoadError = null;
try {
  if (!window.supabase) throw new Error('Supabase library failed to load from CDN');
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,    // keep the session in localStorage across browser restarts
      autoRefreshToken: true,  // proactively refresh the JWT before it expires
      detectSessionInUrl: false
    }
  });
} catch(e) {
  _supabaseLoadError = e.message;
  console.error('Supabase client setup failed:', e.message);
}

function _normEmail(s) { return (s || '').trim().toLowerCase(); }

/* ── Offline launch ──────────────────────────────────────────────────
   An installed PWA opened with no signal can't refresh its JWT (or even
   load the Supabase library), which used to leave the user stuck at the
   login gate with no way to view the plan already cached on the device.
   A successful sign-in records the account's uid locally; if a later
   launch can't reach Supabase for NETWORK reasons (not because the
   session was rejected), that record lets the app open in offline mode.
   The cloud copy is safe: saves are held back until a successful pull,
   and RLS still rejects anything without a live session. Logging out
   clears the record (see operatorLogout). */
const LAST_LOGIN_LS_KEY = 'abps_last_login_v1'; // { uid, at }
const ROLE_CACHE_LS_KEY = 'abps_role_cache_v1'; // { uid, role } — last role the server confirmed
let _flowOfflineLaunch = false;

function _recordSuccessfulLogin(uid) {
  if (!uid) return;
  try { localStorage.setItem(LAST_LOGIN_LS_KEY, JSON.stringify({ uid: uid, at: new Date().toISOString() })); } catch(e) {}
}
function _readLastLogin() {
  try { const v = JSON.parse(localStorage.getItem(LAST_LOGIN_LS_KEY) || 'null'); return (v && v.uid) ? v : null; } catch(e) { return null; }
}
// Network-level failure (no connection, DNS, timeout) as opposed to the auth
// server answering "this session is invalid" — only the former may fall
// back to offline mode.
function _isNetworkAuthError(err) {
  if (navigator.onLine === false) return true;
  if (!err) return false;
  if (err.name === 'AuthRetryableFetchError' || err.status === 0) return true;
  return /failed to fetch|network|load failed|timed? ?out|fetch/i.test(String(err.message || err));
}
// supabase-js persists the session as 'sb-<project-ref>-auth-token'. When the
// library DID load, also require that stored session to still be there —
// if Supabase itself discarded it (rejected/revoked), that's a sign-out.
function _hasStoredSupabaseSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /^sb-.*-auth-token$/.test(k) && localStorage.getItem(k)) return true;
    }
  } catch(e) {}
  return false;
}
function _allowOfflineEntry(reason) {
  const last = _readLastLogin();
  if (!last) return false;
  if (supabaseClient && !_hasStoredSupabaseSession()) return false;
  console.warn('ABPS: launching in offline mode (' + reason + ') for the last signed-in account.');
  _flowOfflineLaunch = true;
  return true;
}

async function _operatorSessionValid() {
  _flowOfflineLaunch = false;
  if (!supabaseClient) return _allowOfflineEntry('Supabase library unavailable');
  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error || !data || !data.session) {
      // supabase-js tries to refresh an expired stored session inside
      // getSession(); offline that fails with a fetch error rather than an
      // auth rejection — still a session we just can't verify right now.
      if (error && _isNetworkAuthError(error)) return _allowOfflineEntry('session check failed: ' + (error.message || error));
      if (navigator.onLine === false) return _allowOfflineEntry('device offline');
      return false;
    }

    // getSession() can return a cached session whose JWT has already expired
    // (e.g. after the tab was closed for longer than the token's lifetime).
    // A session object existing is NOT the same as it still being valid —
    // check the actual expiry, and if it's expired or about to expire,
    // try a real refresh before deciding the session is dead. Without this,
    // the login gate gets skipped on a stale session, every Supabase read/
    // write silently fails afterward, and the app falls back to a workspace
    // that looks "reset" even though nothing was actually lost server-side.
    const expiresAt = data.session.expires_at; // unix seconds
    const nowSec = Math.floor(Date.now() / 1000);
    if (!expiresAt || expiresAt <= nowSec + 30) {
      try {
        const { data: refreshed, error: refreshErr } = await supabaseClient.auth.refreshSession();
        if (refreshErr && _isNetworkAuthError(refreshErr)) return _allowOfflineEntry('token refresh failed: ' + (refreshErr.message || refreshErr));
        if (refreshErr || !refreshed || !refreshed.session) return false;
      } catch(e) {
        if (_isNetworkAuthError(e)) return _allowOfflineEntry('token refresh failed: ' + e.message);
        return false;
      }
    }
    _recordSuccessfulLogin(data.session.user && data.session.user.id);
    return true;
  } catch(e) {
    if (_isNetworkAuthError(e)) return _allowOfflineEntry('session check failed: ' + e.message);
    return false;
  }
}

async function _handleOperatorLogin(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  const emailEl = document.getElementById('og-email');
  const passEl  = document.getElementById('og-password');
  const errEl   = document.getElementById('og-error');
  const btn     = document.getElementById('og-submit-btn');

  if (btn) { btn.disabled = true; btn.style.background = '#344d63'; btn.textContent = 'Signing in…'; }
  errEl.style.display = 'none';

  if (!supabaseClient) {
    if (btn) { btn.disabled = false; btn.style.background = '#0B1726'; btn.textContent = 'Sign in'; }
    errEl.textContent = 'Could not reach the login service. Check your connection and refresh.';
    errEl.style.display = '';
    return false;
  }

  let data, error;
  try {
    const res = await supabaseClient.auth.signInWithPassword({
      email: _normEmail(emailEl.value),
      password: passEl.value || ''
    });
    data = res.data; error = res.error;
  } catch(e) {
    if (btn) { btn.disabled = false; btn.style.background = '#0B1726'; btn.textContent = 'Sign in'; }
    errEl.textContent = 'Network error: ' + e.message + '. Check your connection and try again.';
    errEl.style.display = '';
    return false;
  }

  if (btn) { btn.disabled = false; btn.style.background = '#0B1726'; btn.textContent = 'Sign in'; }

  if (error || !data?.session) {
    errEl.textContent = 'Email or password is incorrect. Contact your operations lead for the shared credentials.';
    errEl.style.display = '';
    passEl.value = '';
    passEl.focus();
    return false;
  }

  _flowOfflineLaunch = false;
  _recordSuccessfulLogin(data.session.user && data.session.user.id);
  _unlockOperatorGate();
  return false;
}

function _toggleOgPassword() {
  const pw = document.getElementById('og-password');
  if (!pw) return;
  pw.type = pw.type === 'password' ? 'text' : 'password';
}

function _unlockOperatorGate() {
  const gate = document.getElementById('operator-gate');
  if (!gate) { _startAppAfterLogin(); return; }
  gate.style.transition = 'opacity .35s ease';
  gate.style.opacity = '0';
  setTimeout(() => { gate.style.display = 'none'; }, 360);
  _startAppAfterLogin();
}

async function operatorLogout() {
  // Changes that haven't reached the cloud (a failed or offline save, one
  // still running/queued, or an edit whose debounced save hasn't fired yet)
  // live only in the localStorage the logout below wipes. Try to save them
  // first; if they still aren't in the cloud, say plainly that they will be
  // lost, and only wipe if the user agrees.
  let unsynced = false;
  try {
    if (_isMarkedUnsynced() || _saveRunning || _saveQueued || _countLocalChanges()) {
      // Capped, so a stalled connection can't leave Log Out doing nothing.
      await Promise.race([saveSharedState(), new Promise(function(r) { setTimeout(r, 15000); })]);
      unsynced = _isMarkedUnsynced() || !!_saveRunning || !!_saveQueued;
    }
  } catch(e) { unsynced = _isMarkedUnsynced(); }
  if (unsynced) {
    let n = 0;
    try { n = _countLocalChanges(); } catch(e) {}
    const what = n === 1 ? '1 unsynced change' : n > 1 ? n + ' unsynced changes' : 'Unsynced changes', them = n === 1 ? 'it' : 'them';
    if (!confirm('⚠ ' + what + ' on this device never reached the shared workspace. Logging out deletes this device\'s copy and loses ' + them + ' for good.\n\n' +
      'To keep ' + them + ', press Cancel, then click Retry on the sync banner or reload the page — unsynced changes stay on this device and sync once the cloud accepts them.\n\n' +
      'Log out anyway and lose ' + them + '?')) return;
  } else if (!confirm('Log out of the shared FLOW workspace on this device?\n\nYou will need the operator email and password to sign back in.')) return;
  try { _rtStop(); } catch(e) {} // unsubscribe from Realtime before the session goes
  // 'local': end THIS device's session only. The default ('global') revokes
  // every session of the account, and the team shares one login — it would
  // sign out every other operator's device and the wallboard too.
  try { await supabaseClient.auth.signOut({ scope: 'local' }); } catch(e) {}
  _clearLocalWorkspaceData();
  location.reload();
}

// Logging out must actually take the workspace off a shared/handed-over
// device: the plan, records, archives, email logs, ROB history and the
// offline-login record all live in localStorage and would otherwise stay
// readable (and re-openable offline) by the next person. Only harmless
// per-device UI prefs survive. 'sb-' keys are Supabase's own session store,
// removed here too in case signOut() couldn't reach the server.
const _LOGOUT_KEEP_KEYS = ['flow-theme', 'abps_sidebar_collapsed'];
function _clearLocalWorkspaceData() {
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || _LOGOUT_KEEP_KEYS.indexOf(k) !== -1) continue;
      if (/^(abps_|flow_|flowops_|sb-)/.test(k)) toRemove.push(k);
    }
    toRemove.forEach(function(k) { try { localStorage.removeItem(k); } catch(e) {} });
  } catch(e) { console.warn('ABPS: could not clear local workspace data on logout:', e && e.message); }
}

// Guard so init() only ever runs once, however login completes
let _abpsAppStarted = false;
async function _startAppAfterLogin() {
  if (_abpsAppStarted) return;
  _abpsAppStarted = true;
  await _fetchAndApplyUserRole();
  const started = typeof init === 'function' ? init() : null;
  // After an update reload: back on the page that was on screen once the workspace is in, no welcome screen.
  const back = typeof _buildReloadPage === 'function' ? _buildReloadPage() : null;
  if (back) Promise.resolve(started).finally(function() { if (_currentPage === 'dashboard') showPage(back); });
  else if (typeof showFlowWelcomeRadar === 'function') showFlowWelcomeRadar();
  if (_flowOfflineLaunch) {
    showToast('Offline — read-only until reconnected. Showing the copy last saved on this device; nothing will sync to the shared workspace.', 'warning', 0);
    window.addEventListener('online', function() {
      showToast('Back online — reload to sign in again and sync with the shared workspace.', 'info', 0);
    }, { once: true });
  }
}

// If this device already has a valid Supabase session, skip the gate entirely
document.addEventListener('DOMContentLoaded', async () => {
  const valid = await _operatorSessionValid();
  if (valid) {
    const gate = document.getElementById('operator-gate');
    if (gate) gate.style.display = 'none';
    _startAppAfterLogin();
  } else {
    // Focus the email field for a fast keyboard-first login
    setTimeout(() => document.getElementById('og-email')?.focus(), 100);
  }
});

