/* Apply saved theme immediately, before first paint, to avoid a flash of
   the wrong theme. Falls back to the visitor's OS preference the very
   first time they open FLOW on a device. */
(function(){
  try{
    var saved = localStorage.getItem('flow-theme');
    var theme = saved || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  }catch(e){ document.documentElement.setAttribute('data-theme','light'); }
})();


// ===== next inline <script> block from original index.html =====


/* Chart.js renders to <canvas>, so it can't read our CSS variables directly —
   give it colors that hold legible contrast on both a white and a near-black
   canvas, and re-apply whenever the theme toggle flips. Individual charts
   still override these per-dataset colors (fuel-v/fuel-m/etc.) as before. */
function _applyChartJsTheme() {
  if (typeof Chart === 'undefined') return;
  var dark = document.documentElement.getAttribute('data-theme') === 'dark';
  var textColor = dark ? '#C8D6E8' : '#47617D';
  Chart.defaults.color = textColor;
  Chart.defaults.borderColor = dark ? 'rgba(255,255,255,.09)' : 'rgba(19,38,62,.08)';
  Chart.defaults.font.family = "'DM Sans', sans-serif";
  // Chart.defaults.color alone doesn't reliably reach the legend plugin's own
  // nested default in every Chart.js code path — set it explicitly too so
  // legends never silently fall back to Chart.js's built-in near-black '#666'.
  if (Chart.defaults.plugins && Chart.defaults.plugins.legend && Chart.defaults.plugins.legend.labels) {
    Chart.defaults.plugins.legend.labels.color = textColor;
  }
}
_applyChartJsTheme();
/* Explicit per-chart text color, for legends/ticks that set their own
   `color` in options — belt-and-suspenders alongside Chart.defaults.color
   above, since some Chart.js legend configs don't reliably fall back to
   the global default. */
function _chartTextColor() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? '#C8D6E8' : '#47617D';
}


// ===== next inline <script> block from original index.html =====


/* ── Keeps --header-h locked to the header's real rendered height ──
   On mobile the topbar wraps into multiple rows (title / search /
   action buttons), so its height is variable and can't be hard-coded.
   Without this, --header-h fell back to a fixed single-row estimate,
   which was shorter than the real header — causing the button row and
   the sidebar's top items (e.g. Dashboard) to sit underneath/behind
   the header instead of below it. This measures the real height and
   keeps it accurate as content, viewport, or orientation changes. */
(function(){
  function syncHeaderHeight(){
    var header = document.getElementById('app-header');
    if (!header) return;
    var h = header.offsetHeight;
    if (h > 0) document.documentElement.style.setProperty('--header-h', h + 'px');
  }
  window.addEventListener('load', syncHeaderHeight);
  window.addEventListener('resize', syncHeaderHeight);
  window.addEventListener('orientationchange', function(){ setTimeout(syncHeaderHeight, 50); setTimeout(syncHeaderHeight, 300); });
  setTimeout(syncHeaderHeight, 0);
  setTimeout(syncHeaderHeight, 300);
  setTimeout(syncHeaderHeight, 1000);
  var headerEl = document.getElementById('app-header');
  if (headerEl && window.ResizeObserver) {
    new ResizeObserver(syncHeaderHeight).observe(headerEl);
  }
})();


// ===== next inline <script> block from original index.html =====


/* ══════════════════════════════════════════════
   AGENT DIRECTORY — data + UI
══════════════════════════════════════════════ */
const _AGENTS_DEFAULT = [
  {id:1,  name:'Kanoo',                                     emails:'fujops@kanoo.ae'},
  {id:2,  name:'Yatch International',                       emails:'operations@yacht-intl.com'},
  {id:3,  name:'SMV Maritime',                              emails:'operations@smvmaritime.com'},
  {id:4,  name:'Gulf Navigation',                           emails:'opsfuj@gulfnav.com'},
  {id:5,  name:'Inchcape Shipping Services',                emails:'Jainy.rajan@iss-shipping.com; youriss.fujairah@iss-shipping.com'},
  {id:6,  name:'Archipelago Middle East Shipping',          emails:'operations@archipelago.ae'},
  {id:7,  name:'Gulf Agency Fujairah / GAC',                emails:'sss.ae@gac.com; msml.fujairah@gac.com'},
  {id:8,  name:'Wilhelmsen / WSS',                          emails:'wss.fujairah@wilhelmsen.com; barwil.fujairah@wilhelmsen.com; wps.fujairah@wilhelmsen.com'},
  {id:9,  name:'Fairdeal Marine',                           emails:'AGENCY@FAIRDEAL.AE'},
  {id:10, name:'Sea Master Maritime Agency',                emails:'agency.fujairah@seamasteruae.com'},
  {id:11, name:'Middle East Fuji Khimji Shipping',          emails:'agency@mefks.ae; operations@mefks.ae'},
  {id:12, name:'Seaworld Shipping & Logistics',             emails:'seaship@emirates.net.ae'},
  {id:13, name:'Ocean Master',                              emails:'imohamed@seabizworld.com; oceantramp@seabizworld.com'},
  {id:14, name:'Sharaf Shipping',                           emails:'fujairah@sharafshipping.com'},
  {id:15, name:'Wesal Shipping LLC',                        emails:'wesalfuj@emirates.net.ae'},
  {id:16, name:'Galax Shipping',                            emails:'galaxy@galaxyship.com; operationsfuj@galaxyship.com'},
  {id:17, name:'CRD Marine',                                emails:'operation@crdmarine.com; crd@eim.ae'},
  {id:18, name:'North Star Shipping',                       emails:'Operations@northstar-shipping.com'},
  {id:19, name:'Fujairah Marine Services',                  emails:'operations@fujamar.com'},
  {id:20, name:'Ocean Marine',                              emails:'omsagncy@emirates.net.ae'},
  {id:21, name:'Inter Ship Shipping',                       emails:'inter@interseas.ae'},
  {id:22, name:'National Shipping Agency',                  emails:'nascofuj@eim.ae; dubaihub@nationaldubai.ae; nalaka@nationaldubai.ae'},
  {id:23, name:'AR Shipping Agency Service',                emails:'operations@arshipping.com'},
  {id:24, name:'Sea Star',                                  emails:'ops1@seastarrak.net; faiqueb@gmail.com'},
  {id:25, name:'Flamingo Shipping Agency',                  emails:'flamingo@eim.ae'},
  {id:26, name:'Sea World',                                 emails:'ssldxbops@seaworldship.com'},
  {id:27, name:'Aegean Marine Petroleum LLC',               emails:'aegeangr@emirates.net.ae'},
  {id:28, name:'Al Bahar Shipping',                         emails:'ops@albaharshipping.com; agency@albaharshipping.ae'},
  {id:29, name:'Al Rudainy Shipping Agency',                emails:'operation@alrudainy.com'},
  {id:30, name:'Alligator Shipping',                        emails:'akshay@ascouae.com; ops.auh@ascouae.com'},
  {id:31, name:'Atlantic Shipping',                         emails:'fujops@atlanticuae.com'},
  {id:32, name:'Blue Bird Marine Services',                 emails:'agency@bluebirddubai.com; agency@bluebirdshipping.com'},
  {id:33, name:'Blue Sea Shipping',                         emails:'fujairah@blueseashipping.com; bluesea@blueseashipping.com'},
  {id:34, name:'Blue Wave Agency',                          emails:'fujairah@bluewaveshipping.com'},
  {id:35, name:'Blue Wide Shipping Services',               emails:'agency@bluewideshipping.com'},
  {id:36, name:'Credential Ship Services',                  emails:'agency@credentialships.com'},
  {id:37, name:'Cyclades Marine Services',                  emails:'agency@cyclades-marine.com'},
  {id:38, name:'Dubai Shipping Company',                    emails:'dscagency@enoc.com'},
  {id:39, name:'Dynasty Maritime',                          emails:'ops@dynasty-maritime.ae'},
  {id:40, name:'Eastern Maritime Co. LLC',                  emails:'ops@eastern-maritime.com'},
  {id:41, name:'ES Global Shipping',                        emails:'shipping.fuj@esglobal.ae'},
  {id:42, name:'Focal Shipping',                            emails:'agency.fuj@focalshipping.com'},
  {id:43, name:'Global Maritime Agency',                    emails:'ops.fuj@globalmaritimeagency.com'},
  {id:44, name:'Great Circle Line Co. (LLC)',               emails:'bulkgroup@gclconline.com'},
  {id:45, name:'Gremco Shipping',                           emails:'operations@gremcoshipping.ae'},
  {id:46, name:'Gulf Environment FZE',                      emails:'ecoref@emirates.net.ae'},
  {id:47, name:'Ionian Shipping Agency LLC',                emails:'ionian@emirates.net.ae'},
  {id:48, name:'JW Marine',                                 emails:'ops@jwmarine.org'},
  {id:49, name:'Khor Kalba Marine Services',                emails:'kkms@emirates.net.ae'},
  {id:50, name:'Kinetic Shipping Services',                 emails:'ops@kineticshipping.com'},
  {id:51, name:'Mesco Marine',                              emails:'mesco@mescomarine.ae'},
  {id:52, name:'Metro Marine',                              emails:'operations@metromarineuae.com'},
  {id:53, name:'Middle East Fuji LLC',                      emails:'fujairah@mef.ae'},
  {id:54, name:'Mubarak Fisheries',                         emails:'mubarakfisheries@hotmail.com'},
  {id:55, name:'Ocean Marine Services',                     emails:'omsagncy@emirates.net.ae'},
  {id:56, name:'Ocean Masters LLC',                         emails:'oceantramp@seabizworld.com'},
  {id:57, name:'Polestar Ocean Carriers',                   emails:'dryops@polestarocean.com'},
  {id:58, name:'Rais Hassan Saadi',                         emails:'ec.operations@rhsgroup.com'},
  {id:59, name:'Royal Pacific Shipping',                    emails:'ops@royalpacificship.com'},
  {id:60, name:'Sea Master Maritime (RAK Branch)',          emails:'rak@seamasteruae.com'},
  {id:61, name:'Shark International Shipping',              emails:'operations@shark-intl.com; john@shark-intl.com'},
  {id:62, name:'Sprinter Ship Services',                    emails:'ops@sprintershipservices.com'},
  {id:63, name:'Trans Gulf Agency',                         emails:'operations@transgulfagency.ae'},
  {id:64, name:'Viking Marine Services',                    emails:'agency@vikingmarines.com'},
  {id:65, name:'West Coast Shipping Services',              emails:'renjith@wcss.ae'},
  {id:66, name:'Whales Shipping Line',                      emails:'opsfuj@whalesshipping.com'},
  {id:67, name:'White Sea Marine Services LLC',             emails:'wsmarine@emirates.net.ae'},
  {id:68, name:'World Wide Marine',                         emails:'operations@wwmarine.ae'},
  {id:69, name:'Your Shore Shipping',                       emails:'ram@yourshoreshipping.com; operations@yourshoreshipping.com; sruthy@yourshoreshipping.com'},
  {id:70, name:'FNSA',                                      emails:'fnsafujairah@fng.ae'},
];

let _agents = [];
let _agentEditId = null;
let _agentNextId = 1000;

function _loadAgents() {
  try {
    const saved = localStorage.getItem('abps_agents');
    if (saved) {
      _agents = JSON.parse(saved);
      _agentNextId = Math.max(..._agents.map(a => a.id), 999) + 1;
    } else {
      _agents = _AGENTS_DEFAULT.map(a => Object.assign({}, a));
      _agentNextId = 2000;
      _saveAgents();
    }
  } catch(e) {
    _agents = _AGENTS_DEFAULT.map(a => Object.assign({}, a));
  }
  _refreshAgentDatalist();
}

function _saveAgents() {
  try { localStorage.setItem('abps_agents', JSON.stringify(_agents)); } catch(e) {}
  _refreshAgentDatalist();
}

// Additive merge of an incoming (cloud/remote) agent list into the local
// Agent Directory. Matched by name (case-insensitive, trimmed) rather than
// id, since ids are assigned independently per device/session and would
// otherwise collide or fail to match. Existing agents are never removed —
// emails are unioned (deduped) on a name match, and any remote agent not
// present locally is added as a new entry. This is what makes an agency
// added once, anywhere, permanent across rebuilds, redeploys, and devices:
// every push carries the full directory to the cloud, and every pull only
// ever adds to what's here, never overwrites or drops it.
function _mergeAgents(remoteAgents) {
  if (!Array.isArray(remoteAgents) || !remoteAgents.length) return;
  const byName = {};
  _agents.forEach(function(a) { byName[(a.name||'').trim().toLowerCase()] = a; });
  let changed = false;
  remoteAgents.forEach(function(r) {
    const key = (r.name||'').trim().toLowerCase();
    if (!key) return;
    const existing = byName[key];
    if (existing) {
      const localEmails  = (existing.emails||'').split(';').map(function(e){return e.trim();}).filter(Boolean);
      const remoteEmails = (r.emails||'').split(';').map(function(e){return e.trim();}).filter(Boolean);
      const merged = Array.from(new Set(localEmails.concat(remoteEmails)));
      const mergedStr = merged.join('; ');
      if (mergedStr !== existing.emails) { existing.emails = mergedStr; changed = true; }
    } else {
      const newAgent = { id: _agentNextId++, name: r.name, emails: r.emails||'' };
      _agents.push(newAgent);
      byName[key] = newAgent;
      changed = true;
    }
  });
  if (changed) _saveAgents();
}

// Populates <datalist id="agent-directory-list"> from _agents so every "Agent" field
// (vessel nomination cards, Edit Record modal) behaves like a searchable combobox:
// type to filter/pick a known agent, or just keep typing a name that isn't listed yet.
function _refreshAgentDatalist() {
  const dl = document.getElementById('agent-directory-list');
  if (!dl) return;
  const names = Array.from(new Set((_agents||[]).map(a => a.name).filter(Boolean))).sort();
  dl.innerHTML = names.map(n => '<option value="' + n.replace(/&/g,'&amp;').replace(/"/g,'&quot;') + '">').join('');
}

function renderAgentDirectory() {
  _loadAgents();
  filterAgents(document.getElementById('agent-search') ? document.getElementById('agent-search').value : '');
  // KPI: count unique emails
  const allEmails = new Set();
  _agents.forEach(a => {
    a.emails.split(';').forEach(e => { const t = e.trim().toLowerCase(); if (t) allEmails.add(t); });
  });
  const kpiEmails = document.getElementById('kpi-total-emails');
  if (kpiEmails) kpiEmails.textContent = allEmails.size;
  const kpiTotal = document.getElementById('kpi-total-agents');
  if (kpiTotal) kpiTotal.textContent = _agents.length;
}

function filterAgents(q) {
  if (!_agents.length) _loadAgents();
  const query = (q || '').toLowerCase().trim();
  const filtered = query ? _agents.filter(a =>
    a.name.toLowerCase().includes(query) || a.emails.toLowerCase().includes(query)
  ) : _agents;

  const tbody = document.getElementById('agents-tbody');
  const empty = document.getElementById('agents-empty');
  const kpiSearch = document.getElementById('kpi-search-results');

  if (kpiSearch) kpiSearch.textContent = filtered.length;

  if (!filtered.length) {
    if (tbody) tbody.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  if (!tbody) return;
  tbody.innerHTML = filtered.map((a, i) => {
    const emailPills = a.emails.split(';').map(e => e.trim()).filter(Boolean).map(e =>
      `<a href="mailto:${e}" style="display:inline-flex;align-items:center;gap:4px;padding:2px 9px;background:var(--azure-lt);border:1px solid var(--azure-bd);border-radius:20px;font-size:11px;font-family:'DM Mono',monospace;color:var(--azure);text-decoration:none;transition:all .13s;white-space:nowrap" onmouseover="this.style.background='var(--azure)';this.style.color='#fff'" onmouseout="this.style.background='var(--azure-lt)';this.style.color='var(--azure)'">${e}</a>`
    ).join(' ');
    return `<tr>
      <td style="color:var(--muted);font-family:'DM Mono',monospace;font-size:11px">${String(i+1).padStart(2,'0')}</td>
      <td style="font-weight:600;color:var(--ink);font-size:13px">${a.name}</td>
      <td><div style="display:flex;flex-wrap:wrap;gap:5px">${emailPills}</div></td>
      <td>
        <div style="display:flex;gap:5px">
          <button onclick="openEditAgentModal(${a.id})" style="display:flex;align-items:center;gap:4px;padding:4px 9px;border:none;box-shadow:var(--sh-xs);border-radius:5px;background:var(--surface2);color:var(--sub);font-size:11px;cursor:pointer;font-family:DM Sans,sans-serif;transition:all .13s" onmouseover="this.style.background='var(--azure-lt)';this.style.color='var(--azure)';this.style.boxShadow='var(--sh-sm)'" onmouseout="this.style.background='var(--surface2)';this.style.color='var(--sub)';this.style.boxShadow='var(--sh-xs)'">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit
          </button>
          <button onclick="deleteAgent(${a.id})" style="display:flex;align-items:center;gap:4px;padding:4px 9px;border:none;box-shadow:var(--sh-xs);border-radius:5px;background:var(--surface2);color:var(--muted);font-size:11px;cursor:pointer;font-family:DM Sans,sans-serif;transition:all .13s" onmouseover="this.style.background='var(--red-lt)';this.style.color='var(--red)';this.style.boxShadow='var(--sh-sm)'" onmouseout="this.style.background='var(--surface2)';this.style.color='var(--muted)';this.style.boxShadow='var(--sh-xs)'">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function openAddAgentModal() {
  _agentEditId = null;
  document.getElementById('agent-modal-title').textContent = 'Add New Agent';
  document.getElementById('am-save-btn').textContent = 'Save Agent';
  document.getElementById('am-name').value = '';
  document.getElementById('am-emails').value = '';
  document.getElementById('am-error').style.display = 'none';
  document.getElementById('agent-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('am-name').focus(), 80);
}

function openEditAgentModal(id) {
  const a = _agents.find(x => x.id === id); if (!a) return;
  _agentEditId = id;
  document.getElementById('agent-modal-title').textContent = 'Edit Agent';
  document.getElementById('am-save-btn').textContent = 'Update Agent';
  document.getElementById('am-name').value = a.name;
  document.getElementById('am-emails').value = a.emails;
  document.getElementById('am-error').style.display = 'none';
  document.getElementById('agent-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('am-name').focus(), 80);
}

function closeAgentModal() {
  document.getElementById('agent-modal').style.display = 'none';
  _agentEditId = null;
}

function saveAgent() {
  const name = document.getElementById('am-name').value.trim();
  const emails = document.getElementById('am-emails').value.trim();
  const errEl = document.getElementById('am-error');
  if (!name) { errEl.textContent = 'Company name is required.'; errEl.style.display = ''; return; }
  if (!emails) { errEl.textContent = 'At least one email address is required.'; errEl.style.display = ''; return; }
  errEl.style.display = 'none';
  if (_agentEditId) {
    const idx = _agents.findIndex(x => x.id === _agentEditId);
    if (idx > -1) { _agents[idx].name = name; _agents[idx].emails = emails; }
  } else {
    _agents.push({ id: _agentNextId++, name, emails });
  }
  _saveAgents();
  closeAgentModal();
  renderAgentDirectory();
}

function deleteAgent(id) {
  const a = _agents.find(x => x.id === id); if (!a) return;
  if (!confirm('Remove ' + a.name + ' from the directory?')) return;
  _agents = _agents.filter(x => x.id !== id);
  _saveAgents();
  renderAgentDirectory();
}

function copyAllAgentEmails() {
  if (!_agents.length) { alert('No agents loaded.'); return; }
  const all = [];
  _agents.forEach(a => { a.emails.split(';').forEach(e => { const t = e.trim(); if (t) all.push(t); }); });
  const text = all.join('; ');
  navigator.clipboard.writeText(text).then(() => {
    const btn = event.currentTarget;
    const orig = btn.innerHTML;
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
    btn.style.background = 'var(--green-lt)'; btn.style.borderColor = 'var(--green-bd)'; btn.style.color = 'var(--green)';
    setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; btn.style.borderColor = ''; btn.style.color = ''; }, 2000);
  }).catch(() => { alert('Clipboard copy failed. Please copy manually.'); });
}

// Init agents on page load
(function() { _loadAgents(); })();


// ===== next inline <script> block from original index.html =====


/* ═══════════════════════════════════════════════════════
   PAGE ROUTER — showPage() drives all navigation
   Each sidebar click calls showPage(id)
   topbar title updates per page
═══════════════════════════════════════════════════════ */

/* ── FLOW Welcome Sphere — Velocity Physics Engine v3 ───────────────────
   Completely rebuilt. Every particle has genuine velocity (vx, vy) that
   accumulates forces each frame. This makes interactions feel PHYSICAL:
   • Hover:  strong repulsion field — particles fly away from cursor
   • Hold:   gravity well — everything spirals in toward your hand
   • Release: particles coast with inertia before sphere pulls them back
   • Click:  radial shockwave with per-particle velocity impulse
   • Swipe:  sphere SPINS from momentum — the faster you flick the more
   • Gravity: soft spring force continuously pulls particles back to their
             home position on the sphere surface (rubber-band snap)
   • Depth glow: front particles are large/bright cyan; rear are dim navy
   • Connection lattice: nearby particles draw mesh lines (distance-gated)
   Maritime palette: refined ocean blue #0E7A9B + deep navy #0B1929
──────────────────────────────────────────────────────────────────────── */
(function() {
  let canvas, ctx, W, H, DPR;
  let particles = [];
  let rotX = 0, rotY = 0;
  let targetTiltX = 0, targetTiltY = 0;
  let tiltX = 0, tiltY = 0;
  let running = false;
  let mouseX = -9999, mouseY = -9999;
  let prevMX = 0, prevMY = 0;
  let mouseActive = false;
  let mouseDown = false;
  let spinVX = 0, spinVY = 0;   // angular velocity from mouse flick
  let breathT = 0;
  let shockwaves = [];           // [{sx,sy,age,maxAge,vx,vy}]
  let frame_n = 0;

  const N  = 5000;
  const RR = 0.33;               // radius ratio vs min(W,H)
  // Physics constants
  const DRAG        = 0.82;      // per-frame velocity damping (high = snappier)
  const SPRING      = 0.035;     // spring pull back to home position
  const REPEL_R     = 200;       // hover repulsion radius px
  const REPEL_F     = 18;        // repulsion force magnitude
  const ATTRACT_R   = 240;       // hold attraction radius px
  const ATTRACT_F   = 22;        // attraction force magnitude
  const SW_F        = 38;        // shockwave impulse magnitude
  const SPIN_DECAY  = 0.965;     // angular momentum decay

  // Maritime color palette
  const C_CYAN  = [14,  122, 155]; // #0E7A9B refined ocean blue (azure)
  const C_TEAL  = [11,  92,  110]; // #0B5C6E deep teal
  const C_NAVY  = [35,  65,  95];  // muted blue (far-side particles)
  const C_WHITE = [220, 240, 248]; // highlight particles

  function mix3(a, b, t) {
    return [
      a[0] + (b[0]-a[0])*t | 0,
      a[1] + (b[1]-a[1])*t | 0,
      a[2] + (b[2]-a[2])*t | 0
    ];
  }

  function buildParticles() {
    particles = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y   = 1 - (i / (N-1)) * 2;
      const rad = Math.sqrt(Math.max(0, 1 - y*y));
      const th  = golden * i;
      const x0  = Math.cos(th)*rad, z0 = Math.sin(th)*rad, y0 = y;
      particles.push({
        // home position on unit sphere
        x0, y0, z0,
        // screen-space offset with velocity
        ox: 0, oy: 0,
        vx: 0, vy: 0,
        // appearance
        sz:  0.7 + Math.random()*1.8,
        hue: Math.random(),          // 0=cyan 1=white
        ph:  Math.random()*Math.PI*2 // phase for idle drift
      });
    }
  }

  function resize() {
    if (!canvas) return;
    DPR = Math.min(window.devicePixelRatio||1, 2);
    const r = canvas.parentElement.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width  = W*DPR; canvas.height = H*DPR;
    canvas.style.width = W+'px'; canvas.style.height = H+'px';
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }

  function shockwave(sx, sy) {
    shockwaves.push({ sx, sy, age:0, maxAge:55 });
  }

  function draw() {
    if (!running) return;
    requestAnimationFrame(draw);
    if (!canvas || !W) return;
    frame_n++;

    // ── Breathing ──
    breathT += 0.014;
    const breathR = 1 + Math.sin(breathT)*0.025;

    // ── Angular spin with momentum ──
    spinVX *= SPIN_DECAY; spinVY *= SPIN_DECAY;
    rotY += 0.0018 + spinVY;
    rotX += 0.0007 + spinVX;
    tiltX += (targetTiltX - tiltX)*0.06;
    tiltY += (targetTiltY - tiltY)*0.06;

    ctx.clearRect(0,0,W,H);

    const cx = W/2, cy = H/2;
    const R  = Math.min(W,H) * RR * breathR;

    const cosY = Math.cos(rotY+tiltY), sinY = Math.sin(rotY+tiltY);
    const cosX = Math.cos(rotX+tiltX), sinX = Math.sin(rotX+tiltX);

    // ── Project + physics ──
    const proj = new Array(N);
    for (let i = 0; i < N; i++) {
      const p = particles[i];

      // Rotate home position into view space
      let rx = p.x0*cosY - p.z0*sinY;
      let rz = p.x0*sinY + p.z0*cosY;
      let ry = p.y0;
      const ry2 = ry*cosX - rz*sinX;
      const rz2 = ry*sinX + rz*cosX;
      ry = ry2; rz = rz2;

      const sc = 1/(1.75 - rz*0.6);
      const bsx = cx + rx*R*sc;
      const bsy = cy + ry*R*sc;

      // ── Spring force: pull offset back to zero (home) ──
      let fx = -p.ox * SPRING;
      let fy = -p.oy * SPRING;

      // ── Mouse forces ──
      if (mouseActive) {
        const dx = (bsx+p.ox) - mouseX;
        const dy = (bsy+p.oy) - mouseY;
        const dist = Math.sqrt(dx*dx+dy*dy) || 0.01;
        if (mouseDown) {
          // GRAVITY WELL — attract
          if (dist < ATTRACT_R) {
            const f = (1 - dist/ATTRACT_R);
            const pull = f*f*f * ATTRACT_F;
            fx -= (dx/dist)*pull;
            fy -= (dy/dist)*pull;
          }
        } else {
          // REPULSION FIELD
          if (dist < REPEL_R) {
            const f = (1 - dist/REPEL_R);
            const push = f*f * REPEL_F;
            fx += (dx/dist)*push;
            fy += (dy/dist)*push;
          }
        }
      } else {
        // Idle shimmer drift
        const drift = 1.2;
        fx += Math.sin(frame_n*0.009 + p.ph) * drift * 0.04;
        fy += Math.cos(frame_n*0.011 + p.ph) * drift * 0.03;
      }

      // ── Shockwave impulses ──
      for (const sw of shockwaves) {
        const sdx = (bsx+p.ox) - sw.sx;
        const sdy = (bsy+p.oy) - sw.sy;
        const sd  = Math.sqrt(sdx*sdx+sdy*sdy)||0.01;
        const prog = sw.age/sw.maxAge;
        const ring = prog * 360;
        const diff = Math.abs(sd - ring);
        if (diff < 80) {
          const sw_f = (1-diff/80)*(1-prog)*SW_F;
          fx += (sdx/sd)*sw_f;
          fy += (sdy/sd)*sw_f;
        }
      }

      // ── Integrate velocity ──
      p.vx = (p.vx + fx) * DRAG;
      p.vy = (p.vy + fy) * DRAG;
      p.ox += p.vx;
      p.oy += p.vy;

      proj[i] = {
        sx: bsx + p.ox,
        sy: bsy + p.oy,
        z:  rz,
        sc,
        sz: p.sz,
        hue: p.hue,
        speed: p.vx*p.vx + p.vy*p.vy
      };
    }

    // Sort back-to-front
    proj.sort((a,b) => a.z - b.z);

    // ── Connection lattice — only front-facing, bucketed for perf ──
    // Use spatial grid to avoid O(n²)
    const CELL = 55;
    const cols = Math.ceil(W/CELL)+1, rows = Math.ceil(H/CELL)+1;
    const grid = new Array(cols*rows);
    for (let i = 0; i < grid.length; i++) grid[i] = [];
    const frontPts = [];
    for (const pt of proj) {
      if (pt.z > 0.05) {
        frontPts.push(pt);
        const gc = (pt.sx/CELL|0), gr = (pt.sy/CELL|0);
        if (gc>=0 && gc<cols && gr>=0 && gr<rows) grid[gc+gr*cols].push(pt);
      }
    }
    let linesDone = 0;
    const MAX_L = 300;
    for (let gi = 0; gi < grid.length && linesDone < MAX_L; gi++) {
      const cell = grid[gi];
      if (!cell.length) continue;
      const gc = gi%cols, gr = gi/cols|0;
      for (let di = -1; di<=1 && linesDone<MAX_L; di++) {
        for (let dj = -1; dj<=1 && linesDone<MAX_L; dj++) {
          const nc = gc+di, nr = gr+dj;
          if (nc<0||nc>=cols||nr<0||nr>=rows) continue;
          const ncell = grid[nc+nr*cols];
          for (const pa of cell) {
            for (const pb of ncell) {
              if (pa === pb) continue;
              const ddx = pa.sx-pb.sx, ddy = pa.sy-pb.sy;
              const dd2 = ddx*ddx+ddy*ddy;
              if (dd2 < CELL*CELL) {
                const dd = Math.sqrt(dd2);
                const ta = (pa.z+1)/2, tb = (pb.z+1)/2;
                const la = (1-dd/CELL)*0.22*(ta+tb)/2;
                const col = mix3(C_TEAL, C_CYAN, (ta+tb)/2);
                ctx.beginPath();
                ctx.moveTo(pa.sx,pa.sy);
                ctx.lineTo(pb.sx,pb.sy);
                ctx.strokeStyle=`rgba(${col[0]},${col[1]},${col[2]},${la.toFixed(3)})`;
                ctx.lineWidth = 0.55;
                ctx.stroke();
                linesDone++;
                if (linesDone>=MAX_L) break;
              }
            }
            if (linesDone>=MAX_L) break;
          }
        }
      }
    }

    // ── Draw particles ──
    for (const pt of proj) {
      const t = (pt.z+1)/2; // 0=back 1=front
      // Color: back=dim navy, mid=teal, front=electric cyan, fast=white-hot
      let col;
      const spd = Math.min(pt.speed/120, 1);
      if (t < 0.35) {
        col = mix3(C_NAVY, C_TEAL, t/0.35);
      } else {
        col = mix3(C_TEAL, C_CYAN, (t-0.35)/0.65);
      }
      if (spd > 0.05) col = mix3(col, C_WHITE, spd*0.7);

      const baseAlpha = 0.12 + t*0.78;
      const sz = Math.max(0.45, pt.sz*pt.sc);

      // Cursor glow ring
      let alpha = baseAlpha;
      let drawSz = sz;
      if (mouseActive) {
        const cdx = pt.sx-mouseX, cdy = pt.sy-mouseY;
        const cd2 = cdx*cdx+cdy*cdy;
        const gr = mouseDown ? ATTRACT_R : REPEL_R;
        if (cd2 < gr*gr) {
          const gf = 1 - Math.sqrt(cd2)/gr;
          alpha  = Math.min(0.98, alpha + gf*0.7);
          drawSz = drawSz * (1 + gf*2.2);
        }
      }

      ctx.beginPath();
      ctx.arc(pt.sx, pt.sy, drawSz, 0, Math.PI*2);
      ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${alpha.toFixed(3)})`;
      ctx.fill();
    }

    // ── Shockwave rings ──
    for (let i = shockwaves.length-1; i>=0; i--) {
      const sw = shockwaves[i];
      sw.age++;
      if (sw.age > sw.maxAge) { shockwaves.splice(i,1); continue; }
      const prog = sw.age/sw.maxAge;
      const rr   = prog*380;
      const ralpha = (1-prog)*(1-prog)*0.9;
      const rw    = (1-prog)*5;
      // Dual ring: cyan inner + navy outer
      ctx.beginPath();
      ctx.arc(sw.sx, sw.sy, rr, 0, Math.PI*2);
      ctx.strokeStyle = `rgba(0,180,216,${ralpha.toFixed(3)})`;
      ctx.lineWidth = rw;
      ctx.stroke();
      if (prog < 0.6) {
        ctx.beginPath();
        ctx.arc(sw.sx, sw.sy, rr*0.65, 0, Math.PI*2);
        ctx.strokeStyle = `rgba(220,240,248,${(ralpha*0.5).toFixed(3)})`;
        ctx.lineWidth = rw*0.5;
        ctx.stroke();
      }
    }
  }

  // ── Event handlers ──
  function onMove(e) {
    const ws = document.getElementById('welcome-screen');
    if (!ws || ws.classList.contains('hidden')) return;
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX !== undefined ? e.clientX : e.touches[0].clientX);
    const cy2 = (e.clientY !== undefined ? e.clientY : e.touches[0].clientY);
    // Angular momentum from swipe speed
    const dvx = cx - prevMX, dvy = cy2 - prevMY;
    spinVY += dvx * 0.000032;
    spinVX += dvy * 0.000020;
    prevMX = cx; prevMY = cy2;
    mouseX = cx - rect.left;
    mouseY = cy2 - rect.top;
    mouseActive = true;
    const nx = (cx/window.innerWidth)*2-1;
    const ny = (cy2/window.innerHeight)*2-1;
    targetTiltY = nx * 1.1;
    targetTiltX = -ny * 0.75;
  }
  function onLeave()  { mouseActive=false; mouseDown=false; }
  function onDown(e)  {
    const ws = document.getElementById('welcome-screen');
    if (!ws||ws.classList.contains('hidden')) return;
    mouseDown=true;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX !== undefined ? e.clientX : e.touches[0].clientX;
    const cy2 = e.clientY !== undefined ? e.clientY : e.touches[0].clientY;
    shockwave(cx-rect.left, cy2-rect.top);
  }
  function onUp()     { mouseDown=false; }

  function start() {
    canvas = document.getElementById('ws-sphere-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    buildParticles(); resize();
    canvas.style.pointerEvents = 'auto';
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseleave', onLeave);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchstart', onDown, {passive:true});
    window.addEventListener('touchmove', onMove, {passive:true});
    window.addEventListener('touchend', onUp);
    if (!running) { running=true; draw(); }
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

/* ── Welcome screen dismiss ── */
function enterApp(targetPage) {
  const ws = document.getElementById('welcome-screen');
  ws.classList.add('hiding');
  setTimeout(function() {
    ws.classList.add('hidden');
    showPage(targetPage || 'dashboard');
  }, 300);
}

const PAGE_META = {
  dashboard:    { title: 'Operations Dashboard',        sub: 'Bunker planning overview — live data',                                    section: 'operations' },
  nominations:  { title: 'Vessel Nominations',          sub: 'Central nomination register — intake, assignment, PAQ tracking',           section: 'operations' },
  schedule:     { title: 'Schedule Planner',            sub: 'Intelligent barge-vessel assignment · ROB impact · Conflict detection',     section: 'operations' },
  timeline:     { title: 'Supply Timeline',             sub: 'Operational supply timeline — active vessels only',                        section: 'operations' },
  alerts:       { title: 'Alerts & Notices',            sub: 'PAQ status · Barge ROB alerts · Replenishment · Schedule reminders',        section: 'operations' },
  bargefleet:   { title: 'Barge Fleet Configuration',   sub: 'Register barges, ROB, pump rates and operational parameters',               section: 'planning' },
  availability: { title: 'Availability Check',          sub: 'Next Supply Availability — multi-barge checker with split recommendation', section: 'planning' },
  agents:       { title: 'Agent Directory',             sub: 'Fujairah shipping agents — company names & email contacts',                section: 'planning' },
  reports:      { title: 'Reports & Analytics',         sub: 'Supply performance, fuel volumes, barge utilisation',                      section: 'reports' },
  checklist:    { title: 'Supply Operations Checklist', sub: 'Mark vessels supplied, enter actuals, save records',                        section: 'reports' },
  records:      { title: 'Saved Supply Records',        sub: 'All completed supply operations — historical log',                          section: 'reports' },
  deliverylog:  { title: 'Delivery Log',                sub: 'Timely / Delayed deliveries and dispute log — by month',                    section: 'reports' },
  archives:     { title: 'Archives',                    sub: 'Monthly archives — survive Full Reset',                                    section: 'system' },
  trash:        { title: 'Trash Bin',                   sub: 'Removed vessels — restore or permanently delete',                           section: 'system' },
};

const SECTION_LABELS = { operations: 'Operations', planning: 'Planning', reports: 'Reports', system: 'System' };

let _currentPage = 'dashboard';
let _chartInstances = {};

function showPage(id) {
  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  // Show target
  const page = document.getElementById('page-' + id);
  if (page) page.classList.add('active');

  // Update sidebar active
  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
  const navEl = document.getElementById('nav-' + id);
  if (navEl) navEl.classList.add('active');

  // Update topbar
  const meta = PAGE_META[id] || { title: id, sub: '', section: 'operations' };
  document.getElementById('topbar-page-title').textContent = meta.title;
  document.getElementById('topbar-page-sub').textContent   = meta.sub;
  const sec = meta.section || 'operations';
  document.getElementById('topbar-section-label').textContent = SECTION_LABELS[sec] || sec;
  document.getElementById('topbar').style.setProperty('--topbar-fill', 'var(--pg-' + id + ')');

  _currentPage = id;

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');

  // Page-specific refresh hooks
  if (id === 'dashboard')    refreshDashboard();
  if (id === 'reports')      refreshReports();
  if (id === 'records')      renderSavedRecords();
  if (id === 'checklist')    { renderChecklist(_lastSched || []); }
  if (id === 'timeline')     {
    renderLiveROBDashboard();
    if (_lastSched && _lastSched.length && typeof renderBargeTabsAndTL === 'function')
      renderBargeTabsAndTL(_lastSched, _bargeConfig && _bargeConfig.length ? _bargeConfig : []);
  }
  if (id === 'nominations')  refreshNominationKPIs();
  if (id === 'schedule')     refreshScheduleKPIs();
  if (id === 'archives')     renderArchivePanel();
  if (id === 'deliverylog')  renderDeliveryLog();
  if (id === 'agents')       renderAgentDirectory();
  if (id === 'trash')        renderTrashBin();
  if (id === 'alerts')       refreshAlertsPage();
}

function toggleSidebar() {
  // Narrow phone viewports keep the existing slide-in overlay drawer.
  // Anything wider (including a phone's "Desktop site" mode, which reports
  // a viewport past the 768px breakpoint) gets a persistent collapse that
  // reclaims the sidebar's width for the main content.
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.toggle('open');
    return;
  }
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  try { localStorage.setItem('abps_sidebar_collapsed', collapsed ? '1' : '0'); } catch(e) {}
}
// Restore a previously-collapsed sidebar on load (desktop-width sessions only).
(function _restoreSidebarCollapsed() {
  try {
    if (localStorage.getItem('abps_sidebar_collapsed') === '1' && window.innerWidth > 768) {
      document.addEventListener('DOMContentLoaded', function() {
        document.body.classList.add('sidebar-collapsed');
      });
    }
  } catch(e) {}
})();

/* ── LIGHT / DARK THEME TOGGLE ──────────��───────────────────────────
   Flips html[data-theme] between 'light' and 'dark', persists the
   choice per-device in localStorage, and syncs the sun/moon icon. ── */
function _syncThemeIcon() {
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  var sun = document.getElementById('theme-icon-sun');
  var moon = document.getElementById('theme-icon-moon');
  if (sun)  sun.style.display  = isDark ? 'none' : 'block';
  if (moon) moon.style.display = isDark ? 'block' : 'none';
}
function toggleColorTheme() {
  var html = document.documentElement;
  var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  try { localStorage.setItem('flow-theme', next); } catch(e) {}
  _syncThemeIcon();
  // Charts render to <canvas> and can't read CSS variables, so their tick/
  // legend colors are baked in at creation time — re-apply the palette and
  // rebuild any charts that already exist so they don't stay stuck on the
  // previous theme's (invisible) text color.
  try {
    if (typeof _applyChartJsTheme === 'function') _applyChartJsTheme();
    if (typeof _savedSupplies !== 'undefined' && typeof renderReportCharts === 'function') renderReportCharts(_savedSupplies);
    if (typeof refreshDashboard === 'function') refreshDashboard();
    if (typeof renderWeekCalendar === 'function') renderWeekCalendar(_calWeekOffset || 0);
  } catch(e) { /* charts/data not ready yet — safe to ignore */ }
}
document.addEventListener('DOMContentLoaded', _syncThemeIcon);

/* ── GLOBAL VESSEL SEARCH ──────────────────────────────────────────
   Searches across the three places a vessel name lives — live
   Nomination cards (DOM inputs), the generated Schedule (_lastSched),
   and Saved Records (_savedSupplies) — and lets the operator jump
   straight to it instead of hunting through pages/sidebar tabs by hand. */
function _globalSearchClose() {
  const box = document.getElementById('global-search-results');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
}

function _globalSearchRun(qRaw) {
  const q = (qRaw || '').trim().toLowerCase();
  const box = document.getElementById('global-search-results');
  if (!box) return;
  if (!q) { _globalSearchClose(); return; }

  const results = [];

  // 1) Live nomination cards — read straight from the DOM inputs so this
  // always reflects exactly what's on screen, including unsaved edits.
  document.querySelectorAll('.vcard').forEach(function(card) {
    const nameInput = card.querySelector('input[id$="-name"]');
    const name = nameInput ? nameInput.value.trim() : '';
    if (name && name.toLowerCase().includes(q)) {
      const cardId = card.id.replace('vessel-', '');
      results.push({ type: 'Nomination', label: name, sub: 'Vessel Nominations', action: function() { _globalSearchGoNomination(cardId); } });
    }
  });

  // 2) Generated schedule
  (typeof _lastSched !== 'undefined' ? _lastSched : []).forEach(function(item) {
    if (item.name && item.name.toLowerCase().includes(q)) {
      const etaStr = (item.eta instanceof Date && !isNaN(item.eta)) ? fmtShort(item.eta) : '';
      results.push({ type: 'Schedule', label: item.name, sub: etaStr ? ('ETA ' + etaStr) : 'Bunker Schedule', action: function() { _globalSearchGoSchedule(item.sno); } });
    }
  });

  // 3) Saved supply records
  (typeof _savedSupplies !== 'undefined' ? _savedSupplies : []).forEach(function(rec) {
    if (rec.vessel && rec.vessel.toLowerCase().includes(q)) {
      results.push({ type: 'Record', label: rec.vessel, sub: rec.dateStr || 'Saved Record', action: function() { _globalSearchGoRecords(); } });
    }
  });

  if (!results.length) {
    box.innerHTML = '<div style="padding:14px 16px;font-size:12.5px;color:var(--muted)">No vessels matching "' + qRaw.replace(/</g,'&lt;') + '"</div>';
    box.style.display = 'block';
    return;
  }

  const badgeColor = { Nomination: 'var(--azure)', Schedule: 'var(--teal)', Record: 'var(--amber)' };
  box.innerHTML = results.slice(0, 25).map(function(r, i) {
    return '<div class="gs-result" data-idx="' + i + '" style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;font-size:12.5px;border-bottom:1px solid rgba(13,27,42,.05)" onmouseover="this.style.background=\'var(--surface)\'" onmouseout="this.style.background=\'\'">' +
      '<span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#fff;background:' + (badgeColor[r.type] || 'var(--muted)') + ';border-radius:5px;padding:2px 7px;flex-shrink:0">' + r.type + '</span>' +
      '<span style="flex:1;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + r.label.replace(/</g,'&lt;') + '</span>' +
      '<span style="color:var(--muted);font-size:11px;white-space:nowrap">' + r.sub.replace(/</g,'&lt;') + '</span>' +
      '</div>';
  }).join('');
  box.style.display = 'block';

  Array.prototype.forEach.call(box.querySelectorAll('.gs-result'), function(el, i) {
    el.addEventListener('click', function() {
      results[i].action();
      _globalSearchClose();
      const input = document.getElementById('global-search-input');
      if (input) { input.value = ''; input.blur(); }
    });
  });
}

function _globalSearchHighlight(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const prevOutline = el.style.outline, prevOffset = el.style.outlineOffset;
  el.style.outline = '3px solid var(--azure)';
  el.style.outlineOffset = '3px';
  setTimeout(function() { el.style.outline = prevOutline; el.style.outlineOffset = prevOffset; }, 2200);
}

function _globalSearchGoNomination(cardId) {
  showPage('nominations');
  setTimeout(function() { _globalSearchHighlight(document.getElementById('vessel-' + cardId)); }, 60);
}

function _globalSearchGoSchedule(sno) {
  showPage('schedule');
  // The Bunker Message modal is the existing, meaningful "jump to this
  // vessel" surface for a scheduled entry — full detail in one click,
  // rather than trying to scroll a re-rendered table to a bare row.
  setTimeout(function() { if (typeof openBunkerMsgModal === 'function') openBunkerMsgModal(sno); }, 60);
}

function _globalSearchGoRecords() {
  showPage('records');
}

document.addEventListener('click', function(e) {
  const wrap = document.getElementById('global-search-wrap');
  if (wrap && !wrap.contains(e.target)) _globalSearchClose();
});
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
}

/* ── Schedule ready flag ── */
let _scheduleReady = false;

/* ── Dashboard refresh — reads directly from live app state ── */
/* ── ACTION QUEUE — the dashboard's actual work surface.
   Pulls delayed operations + PAQ-pending nominations into one ranked
   list with inline actions, so the dashboard is something you act
   from, not just something you read. ── */
function renderActionQueue() {
  const el = document.getElementById('dash-action-queue');
  if (!el) return;

  const vcCards = document.querySelectorAll('#vc .vcard[id^="vessel-"]');
  const items = [];

  (_lastSched || []).forEach(item => {
    if (item.isDelayed) {
      items.push({
        urgency: 0, kind: 'DELAYED',
        name: item.name,
        detail: 'Outside laycan window' + (item.eta instanceof Date && !isNaN(item.eta) ? ' — ETA ' + fmt24(item.eta) : ''),
        sno: item.sno
      });
    }
  });

  vcCards.forEach(card => {
    const cid = card.id.replace('vessel-', '');
    const paqEl = document.getElementById('v' + cid + '-paq');
    if (paqEl && paqEl.value !== 'yes') {
      const nm = document.getElementById('v' + cid + '-name')?.value || ('Vessel ' + cid);
      items.push({
        urgency: 1, kind: 'PAQ',
        name: nm,
        detail: 'Pre-Arrival Questionnaire not yet received',
        cid: cid
      });
    }
  });

  items.sort((a, b) => a.urgency - b.urgency);

  if (!items.length) {
    el.innerHTML = `<div style="border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);padding:26px 20px;text-align:center;margin-bottom:14px">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:6px"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      <div style="font-size:12.5px;font-weight:700;color:var(--ink)">All clear</div>
      <div style="font-size:10.5px;color:var(--muted);margin-top:2px">Nothing needs attention right now</div>
    </div>`;
    return;
  }

  const KIND_STYLE = {
    DELAYED: { color: 'var(--red)',   bg: 'var(--red-lt)',   border: 'var(--red)'   },
    PAQ:     { color: 'var(--amber)', bg: 'var(--amber-lt)', border: 'var(--amber)' }
  };

  const shown = items.slice(0, 8);
  const rows = shown.map(it => {
    const s = KIND_STYLE[it.kind];
    let actionHtml = '';
    if (it.kind === 'DELAYED') {
      actionHtml = `<button class="aq-btn" onclick="_globalSearchGoSchedule(${JSON.stringify(String(it.sno))})">View in Schedule</button>`;
    } else if (it.kind === 'PAQ') {
      actionHtml = `<button class="aq-btn aq-btn-primary" onclick="_aqMarkPaqReceived('${it.cid}')">Mark Received</button>
        <button class="aq-btn" onclick="_globalSearchGoNomination('${it.cid}')">Open</button>`;
    }
    return `<div class="aq-row">
      <span class="aq-tag" style="color:${s.color};background:${s.bg};border-color:${s.border}">${it.kind}</span>
      <div class="aq-body">
        <div class="aq-name">${it.name}</div>
        <div class="aq-detail">${it.detail}</div>
      </div>
      <div class="aq-actions">${actionHtml}</div>
    </div>`;
  }).join('');

  const moreHtml = items.length > 8
    ? `<div style="padding:8px 14px;text-align:center;font-size:10.5px;color:var(--muted);font-weight:600;border-top:1px solid var(--border)">+${items.length - 8} more — <a onclick="showPage('alerts')" style="color:var(--azure);cursor:pointer;font-weight:700">view all in Alerts</a></div>`
    : '';

  el.innerHTML = `<div style="border:1px solid var(--border);border-radius:var(--radius-xs);overflow:hidden;background:var(--surface);margin-bottom:14px">
    <div style="padding:9px 14px;border-bottom:1px solid var(--border);background:var(--surface2);display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:10px;font-weight:700;color:var(--sub);text-transform:uppercase;letter-spacing:.08em;font-family:'DM Mono',monospace">Needs Attention — ${items.length}</span>
    </div>
    ${rows}
    ${moreHtml}
  </div>`;
}

function _aqMarkPaqReceived(cid) {
  const paqEl = document.getElementById('v' + cid + '-paq');
  if (!paqEl) return;
  const nm = document.getElementById('v' + cid + '-name')?.value || 'Vessel';
  paqEl.value = 'yes';
  paqEl.dispatchEvent(new Event('change'));
  refreshDashboard();
  showToast(nm + ' — PAQ marked received', 'success');
}

function refreshDashboard() {
  const now = new Date();
  safeSet('dash-date-sub',
    now.toLocaleDateString('en-GB', { weekday:'long', year:'numeric', month:'long', day:'numeric' }));

  renderActionQueue();

  // ── Read vessel cards directly from DOM ──
  const vcCards = document.querySelectorAll('#vc .vcard[id^="vessel-"]');
  const nomCount = vcCards.length;
  safeSet('kpi-nominations', nomCount || '0');

  // Barge count from _bargeConfig (set by getBarges after schedule)
  const bargeCnt = (_bargeConfig && _bargeConfig.length) ? _bargeConfig.length
    : document.querySelectorAll('#barge-list .vcard').length;
  safeSet('kpi-barges', bargeCnt || '0');

  // PAQ pending — count from vessel cards
  let paqPending = 0, totalV = 0, totalM = 0;
  const paqPendingVessels = [];
  vcCards.forEach(card => {
    const cid = card.id.replace('vessel-', '');
    const paqEl = document.getElementById('v' + cid + '-paq');
    if (paqEl && paqEl.value !== 'yes') {
      paqPending++;
      const nm = document.getElementById('v' + cid + '-name')?.value || ('Vessel ' + cid);
      paqPendingVessels.push({ cid, name: nm });
    }
    const typeEl = document.getElementById('v' + cid + '-type');
    const ty = typeEl ? typeEl.value : 'BOTH';
    const vv = parseFloat(document.getElementById('v' + cid + '-vlsfo')?.value) || 0;
    const mm = parseFloat(document.getElementById('v' + cid + '-mgo')?.value) || 0;
    if (ty !== 'MGO') totalV += vv;
    if (ty !== 'VLSFO') totalM += mm;
  });
  safeSet('kpi-paq', paqPending);
  safeSet('kpi-vlsfo', totalV > 0 ? Math.round(totalV).toLocaleString() + ' MT' : '0 MT');
  safeSet('kpi-lsmgo', totalM > 0 ? Math.round(totalM).toLocaleString() + ' MT' : '0 MT');

  // Deliveries / delayed — from last schedule run
  let deliveries = 0, delayed = 0;
  const delayedItems = [];
  if (_lastSched && _lastSched.length) {
    _lastSched.forEach(item => {
      deliveries++;
      if (item.isDelayed) { delayed++; delayedItems.push(item); }
    });
  }
  safeSet('kpi-deliveries', deliveries);
  safeSet('kpi-delayed', delayed);

  // Monthly vol from saved supply records (_savedSupplies is the live array)
  const savedRecs = (_savedSupplies && _savedSupplies.length) ? _savedSupplies
    : JSON.parse(localStorage.getItem(LS_RECORDS_KEY) || '[]');
  const nowMonth = now.getMonth(), nowYear = now.getFullYear();
  let monthlyVol = 0;
  savedRecs.forEach(r => {
    const d = new Date(r.savedAt || r.date || 0);
    if (d.getMonth() === nowMonth && d.getFullYear() === nowYear) {
      monthlyVol += (parseFloat(r.vlsfoAct) || parseFloat(r.vlsfoActual) || 0)
                  + (parseFloat(r.mgoAct)   || parseFloat(r.mgoActual)   || 0);
    }
  });
  safeSet('kpi-monthly', Math.round(monthlyVol).toLocaleString() + ' MT');
  safeSet('kpi-monthly-sub', 'MT this month (' + now.toLocaleString('default',{month:'long'}) + ')');

  // Alert banners — clickable action rows, not just status text
  const alertsEl = document.getElementById('dash-alerts');
  if (alertsEl) {
    let html = '';
    const CHEVRON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:.6"><polyline points="9 18 15 12 9 6"/></svg>';
    if (paqPending > 0) {
      const first = paqPendingVessels[0];
      const names = paqPendingVessels.slice(0, 3).map(v => v.name).join(', ') + (paqPendingVessels.length > 3 ? ' +' + (paqPendingVessels.length - 3) + ' more' : '');
      html += `<div class="alert-strip warning" style="cursor:pointer" onclick="_globalSearchGoNomination('${first.cid}')" title="Click to open ${first.name} in Nominations">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span><strong>${paqPending} nomination${paqPending>1?'s':''}</strong> have PAQ outstanding — ${names} — submission required within 6 hours.</span>
        ${CHEVRON}
      </div>`;
    }
    if (delayed > 0) {
      const first = delayedItems[0];
      const names = delayedItems.slice(0, 3).map(v => v.name).join(', ') + (delayedItems.length > 3 ? ' +' + (delayedItems.length - 3) + ' more' : '');
      html += `<div class="alert-strip critical" style="cursor:pointer" onclick="_globalSearchGoSchedule(${JSON.stringify(String(first.sno))})" title="Click to open ${first.name} in Schedule">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span><strong>${delayed} operation${delayed>1?'s':''}</strong> delayed — ${names} — outside laycan window. Requires immediate action.</span>
        ${CHEVRON}
      </div>`;
    }
    alertsEl.innerHTML = html;
  }

  // Update alerts badge
  const totalAlerts = paqPending + delayed;
  const alertBadge = document.getElementById('nav-badge-alerts');
  if (alertBadge) {
    if (totalAlerts > 0) { alertBadge.textContent = totalAlerts; alertBadge.style.display = ''; }
    else alertBadge.style.display = 'none';
  }

  renderDashCharts(savedRecs, []);
  renderDashFleetStatus();
  renderDashActivity(savedRecs, []);
}

function renderDashFleetStatus() {
  const el = document.getElementById('dash-fleet-status');
  const barges = (_bargeConfig && _bargeConfig.length) ? _bargeConfig : (_barges || []);
  if (!barges.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:24px">No barges configured.</div>';
    return;
  }
  const liveROBs = (typeof getAllLiveROBs === 'function') ? getAllLiveROBs() : {};
  el.innerHTML = barges.map(b => {
    const live = liveROBs[b.id];
    const v = live ? live.liveV : (parseFloat(b.vrob) || parseFloat(b.robV) || 0);
    const m = live ? live.liveM : (parseFloat(b.mrob) || parseFloat(b.robM) || 0);
    const cap = parseFloat(b.vcap) || parseFloat(b.cap) || 4000;
    const pctV = Math.min(100, Math.round(v / cap * 100));
    const pctM = Math.min(100, Math.round(m / (cap * 0.3) * 100));
    const statusClass = pctV < 20 ? 'badge-red' : pctV < 40 ? 'badge-amber' : 'badge-green';
    const statusLabel = pctV < 20 ? 'Refill' : pctV < 40 ? 'Low' : 'Available';
    return `<div style="padding:10px 0;border-bottom:1px solid var(--border2)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="font-size:12px;font-weight:700;color:var(--ink)">${b.name||('Barge '+(b.id||''))}</div>
        <span class="badge ${statusClass}" style="font-size:9.5px">${statusLabel}</span>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-row">
          <div class="progress-label-row"><span style="font-size:10px;color:var(--muted)">VLSFO</span><span style="font-size:10px;font-family:'DM Mono',monospace;color:var(--fuel-v)">${Math.round(v).toLocaleString()} MT</span></div>
          <div class="progress-track"><div class="progress-fill" style="width:${pctV}%;background:var(--fuel-v)"></div></div>
        </div>
        <div class="progress-row">
          <div class="progress-label-row"><span style="font-size:10px;color:var(--muted)">LSMGO</span><span style="font-size:10px;font-family:'DM Mono',monospace;color:var(--fuel-m)">${Math.round(m).toLocaleString()} MT</span></div>
          <div class="progress-track"><div class="progress-fill" style="width:${pctM}%;background:var(--fuel-m)"></div></div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderDashActivity(records, vessels) {
  const el = document.getElementById('dash-activity-feed');
  const items = [];
  // From _savedSupplies (live in-memory — most accurate)
  const liveRecs = (_savedSupplies && _savedSupplies.length) ? _savedSupplies : records;
  liveRecs.slice(-8).reverse().forEach(r => {
    const d = new Date(r.savedAt || 0);
    const t = isNaN(d) ? '—' : d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    items.push({ color:'var(--green)', title:'Supply Completed', detail:`${r.vessel||'Vessel'} — ${r.vlsfoAct||r.vlsfoActual||0} MT VLSFO, ${r.mgoAct||r.mgoActual||0} MT LSMGO via ${r.barge||'Barge'}`, time: t });
  });
  // From vessel nomination cards in DOM (live). Cards are appended to #vc in
  // the order they're added, so the most recently added nomination is the
  // LAST element returned by querySelectorAll. Reverse before building items
  // so a freshly-added nomination shows up first, not pushed off the end of
  // the feed by items.slice(0,10) below.
  Array.from(document.querySelectorAll('#vc .vcard[id^="vessel-"]')).reverse().forEach(card => {
    const cid = card.id.replace('vessel-', '');
    const nm = document.getElementById('v'+cid+'-name')?.value || 'Vessel';
    const et = document.getElementById('v'+cid+'-eta')?.value || 'TBD';
    const vq = document.getElementById('v'+cid+'-vlsfo')?.value || '0';
    items.push({ color:'var(--fuel-v)', title:'Nomination', detail:`${nm} — ${vq} MT VLSFO  ETA ${et}`, time:'—' });
  });
  if (!items.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:24px">No activity yet. Add nominations or generate a schedule.</div>';
    return;
  }
  el.innerHTML = items.slice(0,10).map(i =>
    `<div class="activity-item">
      <div class="activity-dot" style="background:${i.color}"></div>
      <div class="activity-content">
        <div class="activity-title">${i.title}</div>
        <div class="activity-detail">${i.detail}</div>
      </div>
      <div class="activity-time">${i.time}</div>
    </div>`
  ).join('');
}

function renderDashCharts(records, vessels) {
  // Use live _savedSupplies first, fall back to localStorage, then nominations
  const baseLive = (_savedSupplies && _savedSupplies.length)
    ? _savedSupplies
    : JSON.parse(localStorage.getItem(LS_RECORDS_KEY) || '[]');
  // Merge archived records so Operations Dashboard reflects full history
  const dashArchiveRecs = [];
  if (typeof _archives !== 'undefined') {
    Object.values(_archives).forEach(yearObj => {
      Object.values(yearObj).forEach(arch => {
        if (arch && arch.records) {
          arch.records.forEach(r => {
            dashArchiveRecs.push(Object.assign({}, r, {
              vessel: r.vessel || r.name || 'Unknown',
              vlsfoAct: r.vlsfoAct || r.vlsfoActual || r.vQ || 0,
              mgoAct:   r.mgoAct   || r.mgoActual   || r.mQ || 0,
              savedAt:  r.savedAt  || r.supplyDate   || r.date || arch.archivedAt || '',
              _fromArchive: true
            }));
          });
        }
      });
    });
  }
  const liveIds2 = new Set(baseLive.map(r => r.id).filter(Boolean));
  const liveRecs = [...baseLive, ...dashArchiveRecs.filter(r => !r.id || !liveIds2.has(r.id))];


  // ── WEEKLY PLANNED SUPPLY CALENDAR ──
  renderWeekCalendar(0);

  // ── FUEL MIX DISTRIBUTION — real live data, split into DISTRIBUTED vs PLANNED ──
  {
    // DISTRIBUTED = actual quantities already delivered (from saved/completed supply records).
    let distV = 0, distM = 0;
    liveRecs.forEach(r => {
      distV += parseFloat(r.vlsfoAct) || parseFloat(r.vlsfoActual) || 0;
      distM += parseFloat(r.mgoAct)   || parseFloat(r.mgoActual)   || 0;
    });

    // PLANNED = quantities still to be supplied per fuel type, taking barge ROB
    // into account. The generated schedule (_lastSched) already factors each
    // barge's live ROB / availability when it assigns quantities, so it is the
    // ROB-aware source of truth for what's planned; live nomination inputs are
    // only used as a fallback before a schedule has been generated.
    let planV = 0, planM = 0;
    if (_lastSched && _lastSched.length) {
      _lastSched.forEach(item => {
        planV += ((item.nomVQ!==undefined&&item.nomVQ!==null)?item.nomVQ:item.vQ)||0;
        planM += ((item.nomMQ!==undefined&&item.nomMQ!==null)?item.nomMQ:item.mQ)||0;
      });
    } else {
      document.querySelectorAll('#vc .vcard[id^="vessel-"]').forEach(card => {
        const cid = card.id.replace('vessel-','');
        const ty = document.getElementById('v'+cid+'-type')?.value || 'BOTH';
        if (ty !== 'MGO')   planV += parseFloat(document.getElementById('v'+cid+'-vlsfo')?.value)||0;
        if (ty !== 'VLSFO') planM += parseFloat(document.getElementById('v'+cid+'-mgo')?.value)||0;
      });
    }

    const _fdTextColor = _chartTextColor();
    const _fdColors = ['rgba(47,111,237,.85)','rgba(255,122,26,.78)'];
    function _buildFuelDonut(key, canvasId, vVal, mVal) {
      const ctx = document.getElementById(canvasId);
      if (!ctx) return;
      if (_chartInstances[key]) _chartInstances[key].destroy();
      const rv = Math.round(vVal), rm = Math.round(mVal);
      _chartInstances[key] = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['VLSFO', 'LSMGO'],
          datasets: [{ data:[rv||0, rm||0], backgroundColor:_fdColors, borderWidth:2, borderColor:'#fff', hoverOffset:8 }]
        },
        options: {
          responsive:true, maintainAspectRatio:false, cutout:'66%',
          plugins:{
            legend:{ position:'bottom', labels:{ font:{size:10,family:'DM Sans'}, boxWidth:10, padding:10, color:_fdTextColor,
              generateLabels: chart => chart.data.labels.map((label,i) => ({
                text: label+' — '+Math.round(chart.data.datasets[0].data[i]).toLocaleString()+' MT',
                fillStyle: chart.data.datasets[0].backgroundColor[i],
                fontColor: _fdTextColor, color: _fdTextColor,
                strokeStyle:'#fff', lineWidth:0, hidden:false, index:i, datasetIndex:0
              }))
            }},
            tooltip:{ callbacks:{ label: c => ` ${c.label}: ${Math.round(c.parsed).toLocaleString()} MT` }}
          }
        }
      });
      // Safety net: if this chart was created while its container hadn't been
      // laid out yet (e.g. 0-width during a page transition), the canvas can
      // end up stuck at a bogus size with a clipped/invisible legend. A resize
      // on the next frame re-measures the now-visible container and redraws.
      requestAnimationFrame(() => { try { _chartInstances[key]?.resize(); } catch(e) {} });
    }
    _buildFuelDonut('fuel-dist-distributed', 'chart-fuel-dist-distributed', distV, distM);
    _buildFuelDonut('fuel-dist-planned',     'chart-fuel-dist-planned',     planV, planM);
  }
}

/* ── Nomination KPIs — reads directly from vessel cards in DOM ── */
function refreshNominationKPIs() {
  const cards = document.querySelectorAll('#vc .vcard[id^="vessel-"]');
  let paq = 0, v = 0, m = 0, unassigned = 0;
  cards.forEach(card => {
    const cid = card.id.replace('vessel-', '');
    const paqEl  = document.getElementById('v' + cid + '-paq');
    const typeEl = document.getElementById('v' + cid + '-type');
    const vEl    = document.getElementById('v' + cid + '-vlsfo');
    const mEl    = document.getElementById('v' + cid + '-mgo');
    const brg    = document.getElementById('v' + cid + '-barge');
    const ty = typeEl ? typeEl.value : 'BOTH';
    if (paqEl && paqEl.value !== 'yes') paq++;
    if (ty !== 'MGO')   v += parseFloat(vEl?.value) || 0;
    if (ty !== 'VLSFO') m += parseFloat(mEl?.value) || 0;
    if (!brg || !brg.value) unassigned++;
  });
  safeSet('nom-kpi-total',   cards.length);
  safeSet('nom-kpi-pending', unassigned);
  safeSet('nom-kpi-paq',     paq);
  safeSet('nom-kpi-vlsfo',   Math.round(v).toLocaleString());
  safeSet('nom-kpi-lsmgo',   Math.round(m).toLocaleString());
}

/* ── Schedule KPIs — reads from _lastSched set by calculate() ── */
function refreshScheduleKPIs() {
  if (!_lastSched || !_lastSched.length) {
    // No schedule — reset the KPI cards to their blank state instead of
    // silently leaving whatever numbers were last rendered (that stale-
    // display bug was why Schedule Planner kept showing old totals/table
    // even after Clear All Data wiped the underlying data).
    safeSet('sched-kpi-ops',     '—');
    safeSet('sched-kpi-delayed', '—');
    safeSet('sched-kpi-vlsfo',   '—');
    safeSet('sched-kpi-lsmgo',   '—');
    return;
  }
  let ops = _lastSched.length, delayed = 0, v = 0, m = 0;
  _lastSched.forEach(item => {
    if (item.isDelayed) delayed++;
    v += ((item.nomVQ!==undefined&&item.nomVQ!==null)?item.nomVQ:item.vQ) || 0;
    m += ((item.nomMQ!==undefined&&item.nomMQ!==null)?item.nomMQ:item.mQ) || 0;
  });
  safeSet('sched-kpi-ops',     ops);
  safeSet('sched-kpi-delayed', delayed);
  safeSet('sched-kpi-vlsfo',   v ? Math.round(v).toLocaleString() + ' MT' : '—');
  safeSet('sched-kpi-lsmgo',   m ? Math.round(m).toLocaleString() + ' MT' : '—');
}

/* ── Reports ── */
function refreshReports() {
  // Use live _savedSupplies first, fall back to localStorage
  const records = (_savedSupplies && _savedSupplies.length)
    ? _savedSupplies
    : JSON.parse(localStorage.getItem(LS_RECORDS_KEY) || '[]');
  let totalV=0, totalM=0;
  records.forEach(r => {
    totalV += parseFloat(r.vlsfoAct) || parseFloat(r.vlsfoActual) || 0;
    totalM += parseFloat(r.mgoAct)   || parseFloat(r.mgoActual)   || 0;
  });
  const ops = records.length;
  const avgV = ops ? Math.round(totalV/ops) : 0;
  const avgM = ops ? Math.round(totalM/ops) : 0;
  safeSet('rep-total-vlsfo', Math.round(totalV).toLocaleString()+' MT');
  safeSet('rep-total-lsmgo', Math.round(totalM).toLocaleString()+' MT');
  safeSet('rep-ops-count', ops);
  safeSet('rep-avg-vol', (avgV+avgM).toLocaleString()+' MT');
  safeSet('rep-avg-vlsfo', avgV.toLocaleString()+' MT');
  safeSet('rep-avg-mgo',   avgM.toLocaleString()+' MT');

  // Render records table — connected to _savedSupplies (same as Monthly Report)
  const tbody = document.getElementById('rep-records-body');
  if (tbody) {
    const dispRecs = (_savedSupplies && _savedSupplies.length) ? _savedSupplies : records;
    if (!dispRecs.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:24px">No saved records yet. Save supply records in the Checklist to build reports.</td></tr>';
    } else {
      tbody.innerHTML = dispRecs.slice().reverse().slice(0,50).map((r,i) =>
        `<tr id="rep-row-${r.id||i}">
          <td class="sno">${i+1}</td>
          <td style="font-weight:600">${r.vessel||'—'}</td>
          <td>${_resolveRecordBargeName(r)}</td>
          <td class="mono">${r.dateStr||r.date||'—'}</td>
          <td class="num azure">${Math.round(r.vlsfoAct||r.vlsfoActual||0).toLocaleString()}</td>
          <td class="num teal">${Math.round(r.mgoAct||r.mgoActual||0).toLocaleString()}</td>
          <td>${r.area||r.location||'—'}</td>
          <td><span class="badge badge-green"><span class="badge-dot"></span>${r.supplied?'Completed':'Saved'}</span></td>
          <td><button onclick="deleteRecord('${r.id||''}')" style="background:var(--red-lt);border:1px solid var(--red-bd);color:var(--red);border-radius:5px;padding:3px 10px;font-size:10px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="vertical-align:middle;margin-right:3px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>Delete
          </button></td>
        </tr>`
      ).join('');
    }
  }

  renderReportCharts(records);
}

// Resolve the actual barge name for a saved supply record. Records normally
// carry it in r.barge (sometimes r.bargeLabel on archived/legacy records).
// If neither is present but only one barge is configured in the fleet, that
// barge did the work by definition, so use its name — the record should
// never be shown as "Unassigned" in Reports & Analytics when a real barge
// (e.g. "FNSA 10") is the actual, known source.
function _resolveRecordBargeName(r) {
  const direct = (r.barge || r.bargeLabel || '').toString().trim();
  if (direct) return direct;
  const fleet = (_bargeConfig && _bargeConfig.length) ? _bargeConfig : (_barges || []);
  if (fleet.length === 1 && fleet[0].name) return fleet[0].name;
  return 'Unassigned';
}

function renderReportCharts(records) {
  // Merge live saved supplies + all archived records so reports & analytics reflect full history
  const liveSaved = (_savedSupplies && _savedSupplies.length) ? _savedSupplies : records;
  const archiveRecs = [];
  if (typeof _archives !== 'undefined') {
    Object.values(_archives).forEach(yearObj => {
      Object.values(yearObj).forEach(arch => {
        if (arch && arch.records) {
          arch.records.forEach(r => {
            // Normalise archived record fields to match live record shape
            archiveRecs.push(Object.assign({}, r, {
              vessel: r.vessel || r.name || 'Unknown',
              vlsfoAct: r.vlsfoAct || r.vlsfoActual || r.vQ || 0,
              mgoAct:   r.mgoAct   || r.mgoActual   || r.mQ || 0,
              savedAt:  r.savedAt  || r.supplyDate   || r.date || arch.archivedAt || '',
              _fromArchive: true
            }));
          });
        }
      });
    });
  }
  // Deduplicate: skip archived records that are already in live saved (match by id)
  const liveIds = new Set(liveSaved.map(r => r.id).filter(Boolean));
  const freshArchive = archiveRecs.filter(r => !r.id || !liveIds.has(r.id));
  const recs = [...liveSaved, ...freshArchive];
  // Monthly trend
  {
    const ctx = document.getElementById('chart-monthly-trend');
    if (_chartInstances['monthly-trend']) _chartInstances['monthly-trend'].destroy();
    const buckets = {};
    recs.forEach(r => {
      const d = new Date(r.savedAt||r.supplyDate||r.date||0);
      if(isNaN(d.getTime())) return;
      const key = d.toLocaleString('default',{month:'short',year:'2-digit'});
      if(!buckets[key]) buckets[key]={v:0,m:0};
      buckets[key].v += parseFloat(r.vlsfoAct)||parseFloat(r.vlsfoActual)||0;
      buckets[key].m += parseFloat(r.mgoAct)||parseFloat(r.mgoActual)||0;
    });
    const labels = Object.keys(buckets);
    _chartInstances['monthly-trend'] = new Chart(ctx, {
      type:'bar',
      data:{
        labels: labels.length?labels:['No data'],
        datasets:[
          {label:'VLSFO (MT)',data:labels.map(k=>Math.round(buckets[k].v)),backgroundColor:'rgba(47,111,237,.78)',borderRadius:5,borderSkipped:false},
          {label:'LSMGO (MT)',data:labels.map(k=>Math.round(buckets[k].m)),backgroundColor:'rgba(255,122,26,.68)',borderRadius:5,borderSkipped:false}
        ]
      },
      options:{
        responsive:true,maintainAspectRatio:false,interaction:{mode:'index'},
        plugins:{legend:{position:'top',labels:{font:{size:11,family:'DM Sans'},boxWidth:10,padding:12,color:_chartTextColor()}},tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ${c.parsed.y.toLocaleString()} MT`}}},
        scales:{x:{grid:{display:false},ticks:{font:{size:10,family:'DM Mono'},color:_chartTextColor()}},y:{grid:{color:Chart.defaults.borderColor},ticks:{font:{size:10,family:'DM Mono'},color:_chartTextColor(),callback:v=>v.toLocaleString()+' MT'}}}
      }
    });
  }

  // Barge Performance — grouped bar per barge (VLSFO + MGO)
  {
    const ctx = document.getElementById('chart-fuel-mix');
    if (_chartInstances['fuel-mix']) _chartInstances['fuel-mix'].destroy();
    const bargeBuckets = {};
    recs.forEach(r => {
      const bname = _resolveRecordBargeName(r);
      if (!bargeBuckets[bname]) bargeBuckets[bname] = {v:0, m:0};
      bargeBuckets[bname].v += parseFloat(r.vlsfoAct)||parseFloat(r.vlsfoActual)||0;
      bargeBuckets[bname].m += parseFloat(r.mgoAct)||parseFloat(r.mgoActual)||0;
    });
    const bLabels = Object.keys(bargeBuckets);
    _chartInstances['fuel-mix'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: bLabels.length ? bLabels : ['No data'],
        datasets: [
          { label:'VLSFO (MT)', data: bLabels.map(k=>Math.round(bargeBuckets[k].v)), backgroundColor:'rgba(47,111,237,.82)', borderRadius:5, borderSkipped:false },
          { label:'LSMGO (MT)', data: bLabels.map(k=>Math.round(bargeBuckets[k].m)), backgroundColor:'rgba(255,122,26,.75)', borderRadius:5, borderSkipped:false }
        ]
      },
      options: {
        responsive:true, maintainAspectRatio:false, interaction:{mode:'index'},
        plugins:{
          legend:{position:'top',labels:{font:{size:11,family:'DM Sans'},boxWidth:10,padding:12,color:_chartTextColor()}},
          tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ${c.parsed.y.toLocaleString()} MT`}}
        },
        scales:{
          x:{grid:{display:false},ticks:{font:{size:11,family:'DM Sans'},color:_chartTextColor()}},
          y:{grid:{color:Chart.defaults.borderColor},ticks:{font:{size:10,family:'DM Mono'},color:_chartTextColor(),callback:v=>v.toLocaleString()+' MT'}}
        }
      }
    });
  }

  // Vessel volume bar (horizontal) — VLSFO + MGO stacked
  {
    const ctx = document.getElementById('chart-vessel-vol');
    if (_chartInstances['vessel-vol']) _chartInstances['vessel-vol'].destroy();
    const vBuckets = {};
    recs.forEach(r => {
      const name = r.vessel||'Unknown';
      if(!vBuckets[name]) vBuckets[name]={v:0,m:0};
      vBuckets[name].v += parseFloat(r.vlsfoAct)||parseFloat(r.vlsfoActual)||0;
      vBuckets[name].m += parseFloat(r.mgoAct)||parseFloat(r.mgoActual)||0;
    });
    const sorted = Object.entries(vBuckets).sort((a,b)=>(b[1].v+b[1].m)-(a[1].v+a[1].m)).slice(0,8);
    _chartInstances['vessel-vol'] = new Chart(ctx, {
      type:'bar',
      data:{
        labels:sorted.map(x=>x[0]),
        datasets:[
          {label:'VLSFO (MT)',data:sorted.map(x=>Math.round(x[1].v)),backgroundColor:'rgba(47,111,237,.8)',borderRadius:4,borderSkipped:false,stack:'s'},
          {label:'LSMGO (MT)',data:sorted.map(x=>Math.round(x[1].m)),backgroundColor:'rgba(255,122,26,.72)',borderRadius:4,borderSkipped:false,stack:'s'}
        ]
      },
      options:{
        indexAxis:'y',responsive:true,maintainAspectRatio:false,
        interaction:{mode:'index'},
        plugins:{
          legend:{position:'top',labels:{font:{size:11,family:'DM Sans'},boxWidth:10,padding:10,color:_chartTextColor()}},
          tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ${c.parsed.x.toLocaleString()} MT`}}
        },
        scales:{
          x:{grid:{color:Chart.defaults.borderColor},stacked:true,ticks:{font:{size:10,family:'DM Mono'},color:_chartTextColor(),callback:v=>v.toLocaleString()}},
          y:{grid:{display:false},stacked:true,ticks:{font:{size:11,family:'DM Sans'},color:_chartTextColor()}}
        }
      }
    });
  }

  // Top Ports by Vessel Count
  {
    const ctx = document.getElementById('chart-supply-freq');
    if (_chartInstances['supply-freq']) _chartInstances['supply-freq'].destroy();
    // Map area codes → port buckets
    const portMap = { 'FUJ-A':'FUJ', 'FUJ-B':'FUJ', 'KFK-A':'KFK', 'KFK-B':'KFK' };
    const portCounts = { 'FUJ': 0, 'KFK': 0 };
    recs.forEach(r => {
      // areaCode holds the raw code (FUJ-A etc); area may be a human-readable label
      const areaKey = r.areaCode || r.area || '';
      const port = portMap[areaKey] || portMap[Object.keys(portMap).find(k => areaKey.includes(k)) || ''];
      if (port) portCounts[port]++;
    });
    const labels = ['FUJ', 'KFK'];
    const data   = [portCounts['FUJ'], portCounts['KFK']];
    _chartInstances['supply-freq'] = new Chart(ctx, {
      type:'bar',
      data:{
        labels,
        datasets:[{
          label:'Vessel Count',
          data,
          backgroundColor:'rgba(14,122,155,.82)',
          borderRadius:6,
          borderSkipped:false
        }]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{
          legend:{display:false},
          title:{display:true, text:'Top ports by vessel count', font:{size:13,family:'DM Sans',weight:'600'}, color:_chartTextColor(), padding:{bottom:10}},
          tooltip:{callbacks:{label:c=>` ${c.parsed.y} vessel${c.parsed.y!==1?'s':''}`}}
        },
        scales:{
          x:{grid:{display:false}, ticks:{font:{size:11,family:'DM Sans'},color:_chartTextColor()}},
          y:{grid:{color:Chart.defaults.borderColor}, ticks:{font:{size:10,family:'DM Mono'},color:_chartTextColor(), stepSize:1, callback:v=>Number.isInteger(v)?v:''}}
        }
      }
    });
  }
}

// renderArchivePanel is defined in the archive section below

// renderTrashBin is defined in the vessel nomination section below

function safeSet(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

/* ── TOAST NOTIFICATIONS ──────────────────────────────────────────
   Confirms an action actually happened. type: 'success'|'error'|
   'info'|'warning'. Auto-dismisses after `duration`ms (0 = sticky,
   dismiss via the × only — used for errors worth reading twice). ── */
const _TOAST_ICONS = {
  success: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  error:   '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  info:    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  warning: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
};
function showToast(message, type, duration) {
  type = type || 'success';
  duration = duration === undefined ? 3200 : duration;
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.innerHTML =
    '<span class="toast-icon">' + (_TOAST_ICONS[type] || _TOAST_ICONS.success) + '</span>' +
    '<span class="toast-msg"></span>' +
    '<span class="toast-close" title="Dismiss">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
    '</span>';
  t.querySelector('.toast-msg').textContent = message; // textContent, not innerHTML — never trust caller text as markup
  const remove = function() {
    t.classList.add('toast-leaving');
    setTimeout(function() { t.remove(); }, 180);
  };
  t.querySelector('.toast-close').onclick = remove;
  stack.appendChild(t);
  if (duration > 0) setTimeout(remove, duration);
}

/* ── Hook into calculate() to trigger page route ── */
function _routerOnScheduleReady() {
  _scheduleReady = true;
  // Small delay lets renderOutput finish writing to DOM first
  setTimeout(function() {
    refreshScheduleKPIs();
    refreshNominationKPIs();
    refreshDashboard();
    refreshAlertsPage();
    updateAlertsBadge();
  }, 150);
  showPage('schedule');
}

/* addVessel nom refresh is triggered via MutationObserver below */

/* ── Live clock ── */
function updateClock() {
  // Replaced by the second-resolution UAE clock below — this is a no-op stub
  // to prevent any earlier call from erroring
}
updateClock();
// The real UAE live clock is initialised later in the script (second-resolution, Asia/Dubai)

/* ── Date subtitle ── */
document.addEventListener('DOMContentLoaded', () => {
  refreshDashboard();
  showPage('dashboard');
  // Observe vessel card container to refresh KPIs on change
  const vcEl = document.getElementById('vc');
  if (vcEl) {
    new MutationObserver(() => { refreshNominationKPIs(); refreshDashboard(); }).observe(vcEl, {childList:true, subtree:true});
  }
  // Observe barge list for KPI refresh
  const blEl = document.getElementById('barge-list');
  if (blEl) {
    new MutationObserver(() => refreshDashboard()).observe(blEl, {childList:true, subtree:true});
  }
});
// Alias function names for compatibility
function permanentlyDeleteFromTrash(idx) { if(typeof permanentDeleteFromTrash==='function') permanentDeleteFromTrash(idx); }


// ===== next inline <script> block from original index.html =====


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

async function _operatorSessionValid() {
  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error || !data || !data.session) return false;

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
        if (refreshErr || !refreshed || !refreshed.session) return false;
      } catch(e) { return false; }
    }
    return true;
  } catch(e) { return false; }
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
  if (!confirm('Log out of the shared FLOW workspace on this device?\n\nYou will need the operator email and password to sign back in.')) return;
  try { await supabaseClient.auth.signOut(); } catch(e) {}
  location.reload();
}

// Guard so init() only ever runs once, however login completes
let _abpsAppStarted = false;
function _startAppAfterLogin() {
  if (_abpsAppStarted) return;
  _abpsAppStarted = true;
  if (typeof init === 'function') init();
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



// ===== next inline <script> block from original index.html =====


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

const EMAILJS_PUBLIC_KEY  = 'd1941h1Yp0MHl7sWJ';
const EMAILJS_SERVICE_ID  = 'abpsops@gmail.com';
const EMAILJS_TEMPLATE_ID = 'template_wwr6lvu';

const NOMINATION_EMAIL_FROM = 'abpsops@gmail.com';
const NOMINATION_EMAIL_TO   = 'abpsops@gmail.com';

function _emailNotifyConfigured() {
  return !!(EMAILJS_PUBLIC_KEY && EMAILJS_SERVICE_ID && EMAILJS_TEMPLATE_ID);
}

let _emailjsLoaded = false;
async function _loadEmailJS() {
  if (_emailjsLoaded && typeof emailjs !== 'undefined') return emailjs;
  return new Promise((resolve, reject) => {
    if (typeof emailjs !== 'undefined') { _emailjsLoaded = true; resolve(emailjs); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
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
async function _loadNomEmailLogRemote() {
  if (!_syncReady()) { _nomEmailLogLoaded = true; return; }
  try {
    const { data, error } = await supabaseClient
      .from('abps_workspace')
      .select('payload')
      .eq('id', NOM_EMAIL_WORKSPACE_ID)
      .maybeSingle();
    if (!error && data && data.payload) {
      // Merge: a flag that is true ANYWHERE (local or remote) stays true —
      // this is a one-way ratchet, never reversed by a stale pull.
      const remote = data.payload;
      Object.keys(remote).forEach(function(uid) {
        if (!_nomEmailLog[uid] || (remote[uid].emailSent && !_nomEmailLog[uid].emailSent)) {
          _nomEmailLog[uid] = remote[uid];
        }
      });
      _saveNomEmailLogLocal();
    }
  } catch(e) {}
  _nomEmailLogLoaded = true;
}
async function _pushNomEmailLogRemote() {
  if (!_syncReady()) return;
  try {
    await supabaseClient.from('abps_workspace').upsert({
      id: NOM_EMAIL_WORKSPACE_ID, payload: _nomEmailLog, version: Date.now(), updated_at: new Date().toISOString()
    });
  } catch(e) { console.warn('ABPS: nomination email log cloud sync failed (will retry on next nomination):', e.message); }
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
function _buildNominationEmail(v) {
  const subject = 'New Bunker Nomination – ' + (v.name || 'Unnamed Vessel');

  const lines = [];
  lines.push('Vessel Name: ' + (v.name || '—') + (v.imo ? ' (' + v.imo + ')' : ''));
  if (v.eta) lines.push('ETA: ' + v.eta);
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
    lines.push('MGO: ' + (v.mgo || 0) + ' MT');
    lines.push('VLSFO: ' + (v.qty || 0) + ' MT');
  } else if (v.type === 'MGO') {
    lines.push('LSMGO: ' + (v.mgo || v.qty || 0) + ' MT');
  } else {
    lines.push('VLSFO: ' + (v.qty || 0) + ' MT');
  }
  lines.push('');
  if (v.agent)     lines.push('Agents: ' + v.agent);
  if (v.manifold)  lines.push('MANIFOLD: ' + v.manifold);
  if (v.spec)      lines.push('ISO Spec: ' + v.spec);
  if (v.lc)        lines.push('Nominated Laycan: ' + v.lc);
  if (v.remarks)   lines.push('Remarks: ' + v.remarks);

  return { subject: subject, body: lines.join('\n') };
}

/* ── Public entry point — call this exactly once per genuinely new
   nomination. Marks emailSent = true IMMEDIATELY and persists that
   locally before attempting the network send, so a crash, closed tab,
   or network failure can never cause a duplicate send on retry — the
   flag is the source of truth, not whether the send succeeded. ── */
async function sendNominationEmailIfNeeded(v) {
  if (!v || !v.nomUid) return;
  if (!_nomEmailLogLoaded) { _loadNomEmailLogLocal(); await _loadNomEmailLogRemote(); }

  if (_nomEmailLog[v.nomUid] && _nomEmailLog[v.nomUid].emailSent) {
    return; // No-Duplicate-Email Rule: already sent for this nomination, ever — stop here
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
    _pushNomEmailLogRemote(); // only sync the "sent" flag to the cloud once the send truly succeeded
    _flashNominationEmailBanner('Nomination email sent for ' + (v.name || 'vessel') + '.', true);
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
    delete _nomEmailLog[v.nomUid];
    _saveNomEmailLogLocal();
    _flashNominationEmailBanner('Email failed to send (' + reason + '). You can try again.', false);
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

  if (!_nomEmailLogLoaded) { _loadNomEmailLogLocal(); await _loadNomEmailLogRemote(); }
  if (_nomEmailLog[card.dataset.nomUid] && _nomEmailLog[card.dataset.nomUid].emailSent) {
    _lockSendEmailButton(btn);
    return; // already sent — button should already be locked, this is just a safety net
  }

  const ty = document.getElementById(`v${id}-type`)?.value;
  const origLabel = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="animation:spin .8s linear infinite"><path d="M21 12a9 9 0 1 1-2.64-6.36"/></svg> Sending…';
  }

  try {
    await sendNominationEmailIfNeeded({
      nomUid:   card.dataset.nomUid,
      name:     name,
      imo:      document.getElementById(`v${id}-imo`)?.value || '',
      area:     document.getElementById(`v${id}-area`)?.value || '',
      type:     ty,
      qty:      ty === 'MGO'   ? 0 : parseFloat(document.getElementById(`v${id}-vlsfo`)?.value || 0),
      mgo:      ty === 'VLSFO' ? 0 : parseFloat(document.getElementById(`v${id}-mgo`)?.value   || 0),
      agent:    document.getElementById(`v${id}-agent`)?.value || '',
      manifold: document.getElementById(`v${id}-manifold`)?.value || '',
      spec:     document.getElementById(`v${id}-spec`)?.value || '',
      lc:       document.getElementById(`v${id}-lc`)?.value || '',
      eta:      document.getElementById(`v${id}-eta`)?.value || '',
      remarks:  document.getElementById(`v${id}-remarks`)?.value || ''
    });
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


// ===== next inline <script> block from original index.html =====


/* ═══════════════════════════════════════════════════════════════
   STORAGE LAYER v5 — Supabase Real Internet Sync
   ─────────────────────────────────────────────────────────────
   HOW IT WORKS:
   • One shared Supabase project + table holds the team's live state
   • Push → writes full state to the `abps_workspace` table row
   • Pull → reads that row — works from any PC, any browser
   • Falls back to localStorage if Supabase is briefly unreachable
   ═══════════════════════════════════════════════════════════════ */

/* ── BUILD ID: baked at generation time — each new file is a clean slate ──
   localStorage keys include this ID, so a new file never loads old data.
   If Supabase sync is active, shared state still comes from the cloud (same
   workspace), but local-only caches start fresh. ── */
const _FLOW_BUILD_ID = '202606290803';
const LS_STATE_KEY   = 'flow_state_'   + _FLOW_BUILD_ID;
const LS_RECORDS_KEY = 'flow_records_' + _FLOW_BUILD_ID;

/* ── SHARED WORKSPACE — Supabase table ──────────────────────────────
   All operators read/write the single row with id = ABPS_WORKSPACE_ID
   in the `abps_workspace` table. Push/Pull and auto-sync just work
   for anyone signed in through the Operator Access gate above.
   ──────────────────────────────────────────────────────────────────── */
const ABPS_WORKSPACE_ID = 'main';

let _syncInterval     = null;
let _lastKnownVersion = 0;
let _isSyncing        = false;
let _hasSharedStorage = false; // legacy compat — always false now

/* ── Sync is always ready once signed in — Supabase client handles auth ── */
function _loadSyncCfg() {
  _updateSyncUI();
}

function _saveSyncCfg() {
  // No-op by design — the shared workspace is fixed for every operator.
  _updateSyncUI();
}

function _clearSyncCfg() {
  // No-op by design — sync can't be disconnected; it's how the team shares data.
  _updateSyncUI();
}

function _syncReady() {
  return !!supabaseClient; // false if the Supabase CDN script failed to load
}

function _updateSyncUI() {
  const setupBtn  = document.getElementById('sync-setup-btn');
  const pushBtn   = document.getElementById('sync-push-btn');
  const pullBtn   = document.getElementById('sync-pull-btn');
  const configBtn = document.getElementById('sync-config-btn');
  if (!setupBtn) return;
  // Sync is always pre-configured to the shared team workspace — no setup state to show.
  setupBtn.style.display  = 'none';
  pushBtn.style.display   = '';
  pullBtn.style.display   = '';
  configBtn.style.display = 'none';
  setSyncStatus('ok', 'Shared workspace connected');
}

/* ── Supabase table helpers (replaces JSONBin) ── */
async function _jbPut(payload) {
  if (!supabaseClient) throw new Error(_supabaseLoadError || 'Supabase client not available');
  const { error } = await supabaseClient
    .from('abps_workspace')
    .upsert({ id: ABPS_WORKSPACE_ID, payload, version: payload.version, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Supabase save failed: ${error.message}`);
  return payload;
}

async function _jbGet() {
  if (!supabaseClient) throw new Error(_supabaseLoadError || 'Supabase client not available');
  const { data, error } = await supabaseClient
    .from('abps_workspace')
    .select('payload, version')
    .eq('id', ABPS_WORKSPACE_ID)
    .maybeSingle();
  if (error) throw new Error(`Supabase load failed: ${error.message}`);
  if (!data) return null;
  return data.payload || null;
}

/* ── Status dot ── */
let _syncStatusTimer = null;
function setSyncStatus(state, msg) {
  // Debounce rapid status updates (e.g. during auto-sync polling) to prevent topbar flicker
  if (_syncStatusTimer) clearTimeout(_syncStatusTimer);
  _syncStatusTimer = setTimeout(function() {
    const dot   = document.getElementById('sync-dot');
    const msgEl = document.getElementById('sync-msg');
    if (!dot || !msgEl) return;
    // Only update DOM if value actually changed — prevents unnecessary repaints
    const newClass = 'sync-dot' + (state === 'syncing' ? ' syncing' : state === 'error' ? ' error' : '');
    if (dot.className !== newClass) dot.className = newClass;
    if (msgEl.textContent !== msg) msgEl.textContent = msg;
  }, state === 'syncing' ? 0 : 120); // show 'syncing' immediately, debounce others
}

/* ── Save / Load full state ── */
async function saveSharedState() {
  const state   = captureCurrentState();
  state.version = Date.now();
  _lastKnownVersion = state.version;

  // Bake current live ROB into barges vrob/mrob so the Barge Fleet config
  // screen always shows the true current figure. This must be idempotent:
  // record exactly which completed-supply ids are now folded into each
  // barge's opening so a future computeLiveROB() call (which always walks
  // the full, never-trimmed _savedSupplies history) skips them instead of
  // deducting them a second time. Without this, ROB would silently drift
  // lower on every save/reload even with no new completion or manual edit.
  const liveROBs = getAllLiveROBs();
  const isOnlyBargeNow = state.barges.length === 1;
  state.barges = state.barges.map(function(b, idx) {
    const rob = liveROBs[b.id];
    if (!rob) return b;

    const isFirstBargeNow = idx === 0;
    const matchedIds = (_savedSupplies || [])
      .filter(function(r) {
        const aV = parseFloat(r.vlsfoAct)||0, aM = parseFloat(r.mgoAct)||0;
        if (aV === 0 && aM === 0) return false;
        const rb = (r.barge||'').trim();
        if (rb === '') return isOnlyBargeNow || isFirstBargeNow;
        return rb === b.name;
      })
      .map(function(r) { return r.id; })
      .filter(function(id) { return id !== undefined && id !== null; });

    const prevBaked = (_bakedSupplyIds && _bakedSupplyIds[b.id]) || [];
    _bakedSupplyIds[b.id] = Array.from(new Set(prevBaked.concat(matchedIds)));

    return Object.assign({}, b, { vrob: Math.round(rob.liveV), mrob: Math.round(rob.liveM), _robBakedAt: state.version });
  });
  state.bakedSupplyIds = _bakedSupplyIds;

  // Strip every manual-override key belonging to a barge that was just
  // baked (pre-supply, after-each-record, AND final — not just final) since
  // the baked opening above already fully reflects all of them. Leaving any
  // behind would cause computeLiveROB to re-apply a stale override on top
  // of the fresh baseline on the next load, another source of drift.
  const savedManualROB = Object.assign({}, _manualROB || {});
  state.barges.forEach(function(b) {
    Object.keys(savedManualROB).forEach(function(k) {
      if (k === (b.id + '_pre') || k === (b.id + '_final') || k.indexOf(b.id + '_after_') === 0) {
        delete savedManualROB[k];
      }
    });
  });
  _manualROB = savedManualROB;
  state.manualROB   = savedManualROB;
  state.robAuditLog = _robAuditLog || [];

  // Only persist ACTIVE (non-completed, non-locked) checklist records into state.
  // Completed/locked records are already saved in _savedSupplies — including them here
  // caused the checklist to accumulate all historical entries across sessions, creating
  // duplicate rows every time applyState ran (on init, auto-sync, or pull).
  const activeChecklistRecords = {};
  Object.entries(_checklistRecords).forEach(function([uid, rec]) {
    if (!rec.lockedAt && rec.state !== 'completed') {
      activeChecklistRecords[uid] = rec;
    }
  });
  const payload = { state, records: _savedSupplies, checklistRecords: activeChecklistRecords, version: state.version };
  // Always persist locally first
  try { localStorage.setItem(LS_STATE_KEY,   JSON.stringify(state)); } catch(e) {}
  try { localStorage.setItem(LS_RECORDS_KEY, JSON.stringify(_savedSupplies)); } catch(e) {}
  // If sync configured — write to Supabase
  if (_syncReady()) {
    try {
      await _jbPut(payload);
      setSyncStatus('ok', `Saved & synced — ${new Date().toLocaleTimeString()}`);
      _clearSyncWarningBanner();
      return true;
    } catch(e) {
      setSyncStatus('error', `Saved locally only — cloud sync failed: ${e.message}`);
      _showSyncWarningBanner(e.message);
      return false;
    }
  } else {
    setSyncStatus('ok', `Saved locally — ${new Date().toLocaleTimeString()}`);
    return true; // no cloud configured — local-only save is the expected outcome
  }
}

/* ── Persistent warning banner for sync failures ──────────────────────
   The small topbar status dot is easy to miss. When cloud sync fails,
   show an unmissable banner so the operator knows their changes are only
   on THIS device/browser and won't appear for teammates or survive a
   browser data clear, until the underlying issue (usually an expired
   sign-in session) is fixed. ─────────────────────────────────────────── */
function _showSyncWarningBanner(errMsg) {
  let banner = document.getElementById('sync-warning-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'sync-warning-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999997;background:var(--amber-lt);border-bottom:1px solid #F5C842;color:var(--amber);font-size:12px;font-weight:600;padding:8px 16px;text-align:center;display:flex;align-items:center;justify-content:center;gap:10px';
    banner.innerHTML = '<span>⚠ Cloud sync failed — your changes are saved on this device only and won\'t reach your team until this is fixed.</span>' +
      '<button onclick="_retrySyncNow()" style="background:var(--amber);color:#fff;border:none;border-radius:5px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer">Retry</button>' +
      '<button onclick="document.getElementById(\'sync-warning-banner\').style.display=\'none\'" style="background:transparent;color:var(--amber);border:1px solid var(--amber);border-radius:5px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer">Dismiss</button>';
    document.body.appendChild(banner);
  }
  banner.title = errMsg || '';
  banner.style.display = 'flex';
}
function _clearSyncWarningBanner() {
  const banner = document.getElementById('sync-warning-banner');
  if (banner) banner.style.display = 'none';
}
async function _retrySyncNow() {
  setSyncStatus('syncing', 'Retrying…');
  await saveSharedState();
}

async function loadSharedState(silent = false) {
  if (!silent) setSyncStatus('syncing', 'Loading…');
  // Try Supabase first if configured
  if (_syncReady()) {
    try {
      const payload = await _jbGet();
      if (payload && payload.state) {
        const remoteVersion = payload.version || payload.state.version || 0;
        if (remoteVersion && remoteVersion === _lastKnownVersion) {
          if (!silent) setSyncStatus('ok', `Up to date — ${new Date().toLocaleTimeString()}`);
          return false;
        }
        _lastKnownVersion = remoteVersion;
        applyState(payload.state);
        // Restore manualROB — clear _final since vrob/mrob are now baked
        if (payload.state.manualROB) {
          _manualROB = payload.state.manualROB;
          Object.keys(_manualROB).forEach(function(k) { if (k.endsWith('_final')) delete _manualROB[k]; });
        } else { _manualROB = {}; }
        try { localStorage.setItem('abps_manual_rob_v1', JSON.stringify(_manualROB)); } catch(e) {}
        // Also restore records and checklist if present in payload
        if (payload.records)          { _savedSupplies = payload.records; renderSavedRecords(); }
        // FT84 FIX (Issue 5): merge, do not replace (same logic as applyState)
        if (payload.checklistRecords) {
          // Active-only: applyState already cleaned _checklistRecords above.
          // This top-up ensures any active records in the payload payload not yet in state
          // are included (e.g. records saved between state writes).
          Object.entries(payload.checklistRecords).forEach(function([uid, remote]) {
            if (!remote.lockedAt && remote.state !== 'completed') {
              if (!_checklistRecords[uid] || (!_checklistRecords[uid].lockedAt)) {
                _checklistRecords[uid] = remote;
              }
            }
          });
        }
        if (!silent) setSyncStatus('ok', `Pulled — ${new Date(remoteVersion).toLocaleTimeString()}`);
        _clearSyncWarningBanner();
        return true;
      }
      // Bug fix: the cloud IS configured and WAS reachable, it just has no
      // row yet (id='main' doesn't exist — e.g. a brand-new Supabase
      // project, or right after Clear All Data). That is a real, true
      // "this workspace is empty" answer — it must NOT fall through to the
      // localStorage fallback below, which could resurrect stale data left
      // over from a previous Supabase project or a previous session on
      // this same browser/device. An empty cloud means an empty workspace,
      // full stop.
      if (!silent) setSyncStatus('ok', 'Fresh empty workspace');
      return false;
    } catch(e) {
      setSyncStatus('error', `Pull failed: ${e.message}`);
      _showSyncWarningBanner(e.message);
      // Network/auth error talking to a CONFIGURED cloud is the one case
      // where falling back to local cache is legitimate — the cloud might
      // genuinely have data, we just couldn't reach it right now. Fall
      // through to the localStorage fallback below.
    }
  }
  // Fallback: localStorage — only reached when the cloud is not configured
  // at all, or a configured cloud could not be reached (see comment above).
  try {
    const raw = localStorage.getItem(LS_STATE_KEY);
    if (raw) {
      const state = JSON.parse(raw);
      _lastKnownVersion = state.version || 0;
      applyState(state);
      // Strip _final (applyState already does this, belt-and-suspenders for LS fallback)
      if (_manualROB) Object.keys(_manualROB).forEach(function(k) { if (k.endsWith('_final')) delete _manualROB[k]; });
      if (!silent) setSyncStatus('ok', `Loaded from local — ${new Date().toLocaleTimeString()}`);
      return true;
    }
  } catch(e) {}
  if (!silent) setSyncStatus('ok', 'Fresh workspace');
  return false;
}

async function loadSharedRecords(silent = false) {
  // Bug fix: this used to unconditionally load _savedSupplies from
  // localStorage before the cloud was ever checked. On a BRAND NEW
  // Supabase project (genuinely zero rows), loadSharedState() correctly
  // finds nothing to restore for barges/vessels — but it has no records
  // payload to act on either, so it never got the chance to clear out
  // whatever this function had already preloaded from a previous
  // session's local cache. That's how old completed supplies (from an
  // earlier/different Supabase project on the same browser) kept
  // reappearing in the Activity feed even on a "blank" workspace.
  //
  // Fix: only trust the local cache once we know the cloud was actually
  // unreachable or not configured. If the cloud IS reachable, defer to
  // whatever loadSharedState() decides — including "nothing" — and do
  // not silently resurrect a local-only cache on top of that decision.
  if (typeof _syncReady === 'function' && _syncReady()) {
    // Cloud is configured — let loadSharedState() be the single source
    // of truth for _savedSupplies. Don't touch it here at all.
    if (!silent) renderSavedRecords();
    return;
  }
  try {
    const raw = localStorage.getItem(LS_RECORDS_KEY);
    if (raw) _savedSupplies = JSON.parse(raw);
  } catch(e) {}
  if (!silent) renderSavedRecords();
}

async function saveSharedRecords() {
  try { localStorage.setItem(LS_RECORDS_KEY, JSON.stringify(_savedSupplies)); } catch(e) {}
  // Records are bundled into the next saveSharedState call — no separate Supabase write needed
  // But if sync ready, push the full payload now so records are live immediately
  if (_syncReady()) {
    try {
      const state = captureCurrentState();
      state.version = _lastKnownVersion || Date.now();
      // Only push active (non-completed) checklist records — completed ones live in _savedSupplies
      const activeChecklistRecords = {};
      Object.entries(_checklistRecords).forEach(function([uid, rec]) {
        if (!rec.lockedAt && rec.state !== 'completed') activeChecklistRecords[uid] = rec;
      });
      await _jbPut({ state, records: _savedSupplies, checklistRecords: activeChecklistRecords, version: state.version });
    } catch(e) {} // silent — don't surface record-save errors to user
  }
}

function _flashSyncBanner(msg, color) {
  const b = document.createElement('div');
  b.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;background:${color};color:#fff;border-radius:12px;padding:12px 22px;font-size:13px;font-weight:700;font-family:DM Sans,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.22);white-space:nowrap;transition:opacity .4s`;
  b.textContent = msg;
  document.body.appendChild(b);
  setTimeout(() => { b.style.opacity='0'; setTimeout(()=>b.remove(), 400); }, 3500);
}

/* ── Auto-sync poll (every 30s when sync configured) ── */
function startAutoSync() {
  if (_syncInterval) clearInterval(_syncInterval);
  _syncInterval = setInterval(async () => {
    if (_isSyncing || !_syncReady()) return;
    _isSyncing = true;
    try {
      const payload = await _jbGet();
      if (payload && payload.version && payload.version !== _lastKnownVersion) {
        _lastKnownVersion = payload.version;
        applyState(payload.state);
        // Restore manualROB (applyState sets it from state.manualROB, which has _final stripped)
        if (payload.state && payload.state.manualROB) {
          _manualROB = payload.state.manualROB;
          Object.keys(_manualROB).forEach(function(k) { if (k.endsWith('_final')) delete _manualROB[k]; });
        }
        if (payload.records) { _savedSupplies = payload.records; renderSavedRecords(); }
        setSyncStatus('ok', `Auto-synced at ${new Date().toLocaleTimeString()} — colleague pushed changes`);
      }
    } catch(e) {} // silent polling
    _isSyncing = false;
  }, 30000);
}

/* ══════════════════════════════════════════════════════
   SYNC SETUP — no longer needed. Supabase is pre-configured
   in code and authentication happens through the Operator
   Access gate, so there's nothing left for an operator to set
   up here. Stub kept in case any old UI element still calls it.
   ════════════════════════════════════════════════════ */
function openSyncSetup() {
  alert('Team sync is already connected via Supabase — no setup needed.');
}
function closeSyncSetup() {}
function disconnectSync() {}

function captureCurrentState() {
  const barges = [];
  _barges.forEach(b => {
    const id = b.id;
    barges.push({
      id, name: document.getElementById(`b${id}-name`)?.value||`Barge ${id}`,
      vcap: parseFloat(document.getElementById(`b${id}-vcap`)?.value)||5000,
      mcap: parseFloat(document.getElementById(`b${id}-mcap`)?.value)||1000,
      vrob: parseFloat(document.getElementById(`b${id}-vrob`)?.value)||0,
      mrob: parseFloat(document.getElementById(`b${id}-mrob`)?.value)||0,
      vbuf: parseFloat(document.getElementById(`b${id}-vbuf`)?.value)||500,
      mbuf: parseFloat(document.getElementById(`b${id}-mbuf`)?.value)||150,
      vtph: parseFloat(document.getElementById(`b${id}-vtph`)?.value)||300,
      mtph: parseFloat(document.getElementById(`b${id}-mtph`)?.value)||100,
    });
  });

  const vessels = [];
  document.querySelectorAll('.vcard[id^="vessel-"]').forEach(c => {
    const id = c.id.replace('vessel-','');
    vessels.push({
      nomUid:   c.dataset.nomUid || '',
      name:     document.getElementById(`v${id}-name`)?.value||'',
      imo:      document.getElementById(`v${id}-imo`)?.value||'',
      area:     document.getElementById(`v${id}-area`)?.value||'FUJ-A',
      type:     document.getElementById(`v${id}-type`)?.value||'VLSFO',
      qty:      parseFloat(document.getElementById(`v${id}-vlsfo`)?.value)||0,
      mgo:      parseFloat(document.getElementById(`v${id}-mgo`)?.value)||0,
      spec:     document.getElementById(`v${id}-spec`)?.value||'',
      agent:    document.getElementById(`v${id}-agent`)?.value||'',
      manifold: document.getElementById(`v${id}-manifold`)?.value||'',
      remarks:  document.getElementById(`v${id}-remarks`)?.value||'',
      lc:       document.getElementById(`v${id}-lc`)?.value||'',
      eta:      document.getElementById(`v${id}-eta`)?.value||'',
      paq:      document.getElementById(`v${id}-paq`)?.value||'no',
      bargeId:  document.getElementById(`v${id}-barge`)?.value||'',
      refuelChk: document.getElementById(`v${id}-refuel-chk`)?.checked||false,
      rfv:  parseFloat(document.getElementById(`v${id}-rfv`)?.value)||0,
      rfm:  parseFloat(document.getElementById(`v${id}-rfm`)?.value)||0,
      rfvr: parseFloat(document.getElementById(`v${id}-rfvr`)?.value)||750,
      rfmr: parseFloat(document.getElementById(`v${id}-rfmr`)?.value)||275,
    });
  });

  return { barges, vessels, checklist: _checklist, manualROB: _manualROB, calcParams: _calcParams, lastSched: _lastSched||[], checklistRecords: _checklistRecords||{}, agents: _agents||[], archives: _archives||{}, deliveryLog: _deliveryLog||{} };
}

/* ── ANTI-ZERO-RESET GUARD (Fix #1) ──────────────────────────────────
   Both VLSFO and MGO ROB must behave IDENTICALLY and must never silently
   collapse to zero on reload/reopen unless the user explicitly set them
   to zero. We only intervene when the INCOMING state is provably STALER
   than what this device already has cached locally (incoming.version <
   local.version) — never when the incoming state is the newer, current
   truth. That way a deliberate "edit ROB down to 0, then reload" always
   wins (incoming version is newest), while a corrupted/incomplete/older
   payload that would wipe a barge's ROB back to 0 gets caught and the
   last good local value is kept instead. Applied identically to vrob
   and mrob — neither grade is special-cased — so they can't drift apart. */
function _guardAgainstZeroROBReset(incomingBarges, incomingVersion) {
  if (!incomingBarges || !incomingBarges.length) return incomingBarges;
  let localState = null;
  try {
    const raw = localStorage.getItem(LS_STATE_KEY);
    if (raw) localState = JSON.parse(raw);
  } catch(e) { return incomingBarges; }
  if (!localState || !localState.barges || !localState.barges.length) return incomingBarges;

  // Only guard if the incoming payload is older (or has no version info at
  // all to prove it's current) than the local cache — a genuinely newer
  // incoming state (e.g. the user just zeroed it out and saved) must win.
  const localVersion = localState.version || 0;
  const incomingIsOlderOrUnknown = !incomingVersion || incomingVersion < localVersion;
  if (!incomingIsOlderOrUnknown) return incomingBarges;

  return incomingBarges.map(function(b) {
    const localMatch = localState.barges.find(function(lb) {
      return String(lb.id) === String(b.id) || lb.name === b.name;
    });
    if (!localMatch) return b;

    const fixed = Object.assign({}, b);
    ['vrob', 'mrob'].forEach(function(field) {
      const incomingVal = parseFloat(b[field]) || 0;
      const localVal     = parseFloat(localMatch[field]) || 0;
      if (incomingVal === 0 && localVal > 0) {
        fixed[field] = localVal;
        fixed._robGuardApplied = true;
      }
    });
    return fixed;
  });
}

function applyState(state) {
  if (!state) return;

  // Clear current UI
  document.getElementById('vc').innerHTML = '';
  document.getElementById('barge-list').innerHTML = '';
  vc = 0; bc = 0; _barges = [];
  Object.values(_lcPickers).forEach(p => { try { p.destroy(); } catch(e) {} });
  Object.values(_etaPickers).forEach(p => { try { p.destroy(); } catch(e) {} });
  Object.keys(_lcPickers).forEach(k => delete _lcPickers[k]);
  Object.keys(_etaPickers).forEach(k => delete _etaPickers[k]);

  // Restore barges
  if (state.barges && state.barges.length) {
    const guardedBarges = _guardAgainstZeroROBReset(state.barges, state.version);
    guardedBarges.forEach(b => {
      // Backward compat: old saves had single 'buf' field
      if (b.buf !== undefined && b.vbuf === undefined) { b.vbuf = b.buf; b.mbuf = Math.round(b.buf * 0.3); }
      addBarge(b);
    });
    if (guardedBarges.some(function(b){ return b._robGuardApplied; })) {
      console.warn('ABPS: prevented a zero-ROB reset on reload for one or more barges — restored from local cache instead.');
    }
  }
  // else: state.barges is genuinely empty (e.g. after Clear All Data) —
  // leave it empty rather than silently re-adding a default barge. An
  // intentionally blank workspace should stay blank until the operator
  // adds their own barge.

  // Restore vessels
  if (state.vessels && state.vessels.length) {
    state.vessels.forEach(v => addVessel(v));
  }

  // Restore checklist
  if (state.checklist)         _checklist         = state.checklist;
  if (state.bakedSupplyIds) {
    // Merge rather than overwrite — never forget a previously-baked id, even
    // if this particular incoming state predates a more recent local bake.
    Object.keys(state.bakedSupplyIds).forEach(function(bid) {
      const incoming = state.bakedSupplyIds[bid] || [];
      const existing = _bakedSupplyIds[bid] || [];
      _bakedSupplyIds[bid] = Array.from(new Set(existing.concat(incoming)));
    });
  }
  if (state.manualROB) {
    _manualROB = state.manualROB;
    // Defensive: strip ALL override keys (pre / after-each-record / final) for
    // any barge whose ROB has already been baked into vrob/mrob — leaving any
    // behind would cause computeLiveROB to re-apply a stale override on top
    // of the fresh baseline, double-counting it. (Normal saves already strip
    // these before persisting; this guards against older saved states.)
    Object.keys(_manualROB).forEach(function(k) {
      const bargeId = k.replace(/_pre$|_final$|_after_.*$/, '');
      if (_bakedSupplyIds && _bakedSupplyIds[bargeId] && _bakedSupplyIds[bargeId].length) {
        delete _manualROB[k];
      }
    });
  }
  if (state.calcParams)      { _calcParams        = state.calcParams; renderCalcParamsView(); }
  // Restore only ACTIVE (non-completed) checklist records.
  // Completed records live in _savedSupplies — merging them here was the root cause
  // of ever-growing duplicate rows across sessions, syncs, and navigation.
  // Strategy: clear current active records, then load remote active records,
  // but KEEP any locally-locked records that the remote doesn't know about yet.
  if (state.checklistRecords) {
    // Preserve local records that are locked but not in remote (locally completed, not yet synced)
    const localLocked = {};
    Object.entries(_checklistRecords).forEach(function([uid, rec]) {
      if (rec.lockedAt) localLocked[uid] = rec;
    });
    // Start fresh with only active (non-locked) remote records
    _checklistRecords = {};
    Object.entries(state.checklistRecords).forEach(function([uid, remote]) {
      if (!remote.lockedAt && remote.state !== 'completed') {
        _checklistRecords[uid] = remote;
      }
    });
    // Re-apply any locally-locked records that remote didn't include
    Object.entries(localLocked).forEach(function([uid, rec]) {
      if (!_checklistRecords[uid]) _checklistRecords[uid] = rec;
    });
  } else {
    // No checklistRecords in state — clear active drafts but keep any local locked records
    const keep = {};
    Object.entries(_checklistRecords).forEach(function([uid, rec]) {
      if (rec.lockedAt) keep[uid] = rec;
    });
    _checklistRecords = keep;
  }
  // Restore / merge Archives — additive union, same reasoning as Agent
  // Directory above: an archived month should never disappear just because
  // a different device's state doesn't happen to know about it yet.
  if (state.archives && typeof _mergeArchives === 'function') {
    _mergeArchives(state.archives);
  }

  // Restore / merge Agent Directory — additive union so an agency added on
  // any device, at any point, is never lost when a newer/older state is
  // pulled or the app is rebuilt/redeployed. See _mergeAgents() below.
  if (state.agents && state.agents.length) {
    _mergeAgents(state.agents);
  }

  // Restore / merge Delivery Log — same additive philosophy as Archives and
  // Agents: entries are only ever added, never dropped, on a pull.
  if (state.deliveryLog && typeof _mergeDeliveryLog === 'function') {
    _mergeDeliveryLog(state.deliveryLog);
  }

  if (state.lastSched && state.lastSched.length) {
    // Restore dates (serialised as strings) back to Date objects.
    // item.lc (laycan) is a NESTED object with its own .from/.to dates —
    // missing this caused fmtLC() to crash with "f.getMonth is not a
    // function" on every reload, which stopped init() partway through and
    // looked like saved data (including barge ROB) had been lost, even
    // though it was actually loaded correctly into memory just before the
    // crash. Also guard refuelSlot's nested dates for the same reason.
    _lastSched = state.lastSched.map(function(item) {
      const restored = Object.assign({}, item);
      if (restored.eta        && !(restored.eta        instanceof Date)) restored.eta        = new Date(restored.eta);
      if (restored.bargeStart && !(restored.bargeStart instanceof Date)) restored.bargeStart = new Date(restored.bargeStart);
      if (restored.etc        && !(restored.etc        instanceof Date)) restored.etc        = new Date(restored.etc);
      if (restored.lc && typeof restored.lc === 'object') {
        restored.lc = Object.assign({}, restored.lc);
        if (restored.lc.from && !(restored.lc.from instanceof Date)) restored.lc.from = new Date(restored.lc.from);
        if (restored.lc.to   && !(restored.lc.to   instanceof Date)) restored.lc.to   = new Date(restored.lc.to);
      }
      if (restored.refuelSlot && typeof restored.refuelSlot === 'object') {
        restored.refuelSlot = Object.assign({}, restored.refuelSlot);
        if (restored.refuelSlot.rfStart && !(restored.refuelSlot.rfStart instanceof Date)) restored.refuelSlot.rfStart = new Date(restored.refuelSlot.rfStart);
        if (restored.refuelSlot.rfEnd   && !(restored.refuelSlot.rfEnd   instanceof Date)) restored.refuelSlot.rfEnd   = new Date(restored.refuelSlot.rfEnd);
      }
      return restored;
    });
  }
}

async function forcePush() {
  // saveSharedState() returns false when a cloud sync is configured but the
  // write failed — in that case it has already set an 'error' status and
  // shown the warning banner, so don't stomp on that with a false "Pushed"
  // success message (that previously masked real push failures from the
  // operator, who'd otherwise have no way to know their team never got it).
  const synced = await saveSharedState();
  if (synced) {
    setSyncStatus('ok', `Pushed your config at ${new Date().toLocaleTimeString()}`);
  }
}

async function forcePull() {
  setSyncStatus('syncing', 'Pulling latest from shared workspace…');
  _lastKnownVersion = 0; // force reload
  const changed = await loadSharedState(false);
  await loadSharedRecords(true);
  // Re-render every dependent panel (checklist, Live ROB dashboard, saved
  // records, KPIs, alerts, calendar) so pulled data shows up immediately
  // instead of only taking effect after the next unrelated re-render.
  refreshAllModules();
  if (!changed) setSyncStatus('ok', `Already up to date — ${new Date().toLocaleTimeString()}`);
}


/* ═══════════════════════════════════════════════════════════════
   LIVE ROB ENGINE
   
   Opening ROB  = barge config value (user-entered at schedule start)
   After each SAVED + COMPLETED supply → deduct actual quantity
   Manual ROB overrides → stored with full audit trail
   Availability Checker uses live ROB only, not nomination-based
═══════════════════════════════════════════════════════════════ */

const ROB_AUDIT_KEY = 'abps_rob_audit_v1';
let _robAuditLog = [];   // [{bargeId, bargeName, field, oldVal, newVal, reason, editedAt, editedBy}]
let _manualROB   = {};   // {bargeId: {v: number|null, m: number|null}}  null = use computed

// Which completed-supply record ids have already been folded into each
// barge's saved Opening ROB (vrob/mrob). saveSharedState() bakes the current
// Live ROB back into Opening ROB so the barge-config screen always shows the
// true current figure — but computeLiveROB() always re-walks the FULL,
// never-trimmed _savedSupplies history. Without this tracker, every bake+
// reload cycle would deduct the same completed supplies a second time,
// silently drifting ROB downward with no new completion or manual edit
// having happened. Recording, per barge, which record ids are already
// reflected in the baked opening lets computeLiveROB skip them next time —
// so ROB only ever moves for a genuinely NEW completed supply or an explicit
// manual override, exactly once each. {bargeId: [recordId, ...]}
let _bakedSupplyIds = {};

/* ─── Load / Save audit log ─── */
async function loadROBAudit() {
  try {
    let raw = null;
    if (_hasSharedStorage) {
      try { const r = await window.storage.get(ROB_AUDIT_KEY, true); raw = r ? r.value : null; } catch(e) {}
    }
    if (!raw) raw = localStorage.getItem(ROB_AUDIT_KEY);
    if (raw) _robAuditLog = JSON.parse(raw);
  } catch(e) { _robAuditLog = []; }
}

async function saveROBAudit() {
  const json = JSON.stringify(_robAuditLog);
  try { localStorage.setItem(ROB_AUDIT_KEY, json); } catch(e) {}
  if (_hasSharedStorage) {
    try { await window.storage.set(ROB_AUDIT_KEY, json, true); } catch(e) {}
  }
}

/* ─── Compute LIVE ROB per barge ─── */
/*
  Algorithm:
  1. Start from Opening ROB (barge config input).
  2. Walk through _savedSupplies sorted by supplyDate ascending.
  3. For each saved record that is 'supplied=true' and matches this barge:
     subtract actual quantity delivered.
  4. Apply manual override if set (replaces computed value from that point).
  Returns: { v: number, m: number, history: [{...}] }
*/
function computeLiveROB(bargeId, bargeName, openingV, openingM, upToDate) {
  // Single barge setup: deduct ALL saved records with actuals
  // Multi-barge: match by barge name, unassigned go to first barge
  const isOnlyBarge = _bargeConfig && _bargeConfig.length === 1;
  const isFirstBarge = _bargeConfig && _bargeConfig.length > 0 && _bargeConfig[0].name === bargeName;
  const bakedIds = new Set((_bakedSupplyIds && _bakedSupplyIds[bargeId]) || []);

  const completed = (_savedSupplies || [])
    .filter(function(r) {
      const aV = parseFloat(r.vlsfoAct)||0;
      const aM = parseFloat(r.mgoAct)||0;
      if (aV === 0 && aM === 0) return false;
      // Already folded into this barge's saved Opening ROB — deducting it
      // again here would double-count the same supply on every reload.
      if (r.id !== undefined && r.id !== null && bakedIds.has(r.id)) return false;
      var rb = (r.barge||'').trim();
      var bargeMatch = false;
      if (rb === '') {
        // Unassigned: deduct from only barge, or first barge in multi-barge
        bargeMatch = isOnlyBarge || isFirstBarge;
      } else {
        bargeMatch = (rb === bargeName);
      }
      if (!bargeMatch) return false;
      // Apply upToDate filter to ALL matched records (both assigned and unassigned)
      if (upToDate && r.supplyDate) {
        const d = new Date(r.supplyDate);
        if (!isNaN(d.getTime()) && d > upToDate) return false;
      }
      return true;
    })
    .sort(function(a, b) {
      const da = a.supplyDate ? new Date(a.supplyDate) : new Date(0);
      const db = b.supplyDate ? new Date(b.supplyDate) : new Date(0);
      return da - db;
    });

  var bCfg=(_bargeConfig||[]).find(function(b){return b.id==bargeId;});
  var receivedV=(bCfg&&bCfg.receivedV)?parseFloat(bCfg.receivedV)||0:0;
  var receivedM=(bCfg&&bCfg.receivedM)?parseFloat(bCfg.receivedM)||0:0;
  let rv=openingV+receivedV, rm=openingM+receivedM;
  const history = [{ label: 'Opening ROB', v: rv, m: rm, source: 'opening' }];

  const _mrob = _manualROB || {};

  // Check if there's a manual override before any supplies
  const manBefore = _mrob[bargeId + '_pre'];
  if (manBefore) {
    if (manBefore.v !== null && manBefore.v !== undefined) { rv = manBefore.v; }
    if (manBefore.m !== null && manBefore.m !== undefined) { rm = manBefore.m; }
    history.push({ label: 'Manual Override (pre-supply)', v: rv, m: rm, source: 'manual' });
  }

  completed.forEach(function(r) {
    const supDate = new Date(r.supplyDate);
    const actV = parseFloat(r.vlsfoAct) || 0;
    const actM = parseFloat(r.mgoAct)   || 0;
    rv = Math.max(0, rv - actV);
    rm = Math.max(0, rm - actM);
    history.push({
      label:     'Supplied to ' + r.vessel,
      dateStr:   r.dateStr,
      supDate:   supDate,
      vlsfoAct:  actV,
      mgoAct:    actM,
      v:         rv,
      m:         rm,
      source:    'supply',
      recordId:  r.id
    });

    const manKey = bargeId + '_after_' + r.id;
    const manAt = _mrob[manKey];
    if (manAt) {
      if (manAt.v !== null && manAt.v !== undefined) { rv = manAt.v; }
      if (manAt.m !== null && manAt.m !== undefined) { rm = manAt.m; }
      history.push({ label: 'Manual Override (after ' + r.vessel + ')', v: rv, m: rm, source: 'manual' });
    }
  });

  const manFinal = _mrob[bargeId + '_final'];
  if (manFinal) {
    if (manFinal.v !== null && manFinal.v !== undefined) { rv = manFinal.v; }
    if (manFinal.m !== null && manFinal.m !== undefined) { rm = manFinal.m; }
    history.push({ label: 'Manual Override (current)', v: rv, m: rm, source: 'manual' });
  }

  return { v: rv, m: rm, history: history, completedCount: completed.length };
}

/* ─── Get Live ROB for all barges ─── */
function getAllLiveROBs() {
  const result = {};
  if (!_bargeConfig || !_bargeConfig.length) return result;
  _bargeConfig.forEach(function(b) {
    const live = computeLiveROB(b.id, b.name, b.vrob, b.mrob, null);

    // Count supplies for this barge (for stats display only)
    var directSumV = 0, directSumM = 0, directCount = 0;
    _savedSupplies.forEach(function(r) {
      var rv = parseFloat(r.vlsfoAct)||0;
      var rm = parseFloat(r.mgoAct)||0;
      if (rv === 0 && rm === 0) return;
      var rb = (r.barge||'').trim();
      if (rb === '' || rb === b.name) {
        directSumV += rv;
        directSumM += rm;
        directCount++;
      }
    });

    // liveV/liveM come from computeLiveROB which applies _manualROB _final override
    result[b.id] = {
      bargeName:      b.name,
      bargeId:        b.id,
      openingV:       b.vrob,
      openingM:       b.mrob,
      liveV:          live.v,
      liveM:          live.m,
      totalSuppliedV: directSumV,
      totalSuppliedM: directSumM,
      history:        live.history,
      completedCount: directCount,
      vcap:           b.vcap,
      mcap:           b.mcap,
      vbuf:           b.vbuf,
      mbuf:           b.mbuf,
      vtph:           b.vtph,
      mtph:           b.mtph
    };
  });
  return result;
}

/* ─── Render Live ROB Dashboard ─── */
function renderLiveROBDashboard() {
  const el = document.getElementById('live-rob-dashboard');
  if (!el) return;

  // Try to rebuild _bargeConfig from DOM if empty
  if (!_bargeConfig || !_bargeConfig.length) {
    if (typeof captureCurrentState === 'function') {
      const st = captureCurrentState();
      if (st && st.barges && st.barges.length) {
        _bargeConfig = st.barges;
      }
    }
  }

  if (!_bargeConfig || !_bargeConfig.length) {
    el.innerHTML = '<div style="font-size:13px;color:var(--muted);text-align:center;padding:20px">Add a barge and generate the schedule to see live ROB.</div>';
    return;
  }

  const liveROBs = getAllLiveROBs();
  let html = '';

  Object.values(liveROBs).forEach(function(rob) {
    const b = _bargeConfig.find(function(x) { return x.name === rob.bargeName; });
    if (!b) return;

    const vPct = Math.min(100, Math.round((rob.liveV / rob.vcap) * 100));
    const mPct = Math.min(100, Math.round((rob.liveM / rob.mcap) * 100));
    const vCol = vPct < 15 ? 'var(--red)' : vPct < 30 ? 'var(--amber)' : 'var(--fuel-v)';
    const mCol = mPct < 15 ? 'var(--red)' : mPct < 30 ? 'var(--amber)' : 'var(--fuel-m)';
    const hasManual = Object.keys(_manualROB).some(function(k) { return k.startsWith(b.id + '_'); });

    // Ullage and Refill Time calculations
    const vUllage = Math.max(0, rob.vcap - rob.liveV);
    const mUllage = Math.max(0, rob.mcap - rob.liveM);
    const vRefillHrs = (b.vrfr||750) > 0 ? vUllage / (b.vrfr||750) : 0;
    const mRefillHrs = (b.mrfr||275) > 0 ? mUllage / (b.mrfr||275) : 0;

    html += '<div style="background:var(--surface);border:none;border-radius:var(--radius);padding:1.25rem;margin-bottom:1rem;box-shadow:var(--sh-sm);position:relative;overflow:hidden">' +
      '<div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--azure),var(--teal))"></div>' +

      // Header
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--border2);flex-wrap:wrap;gap:8px">' +
      '<div style="display:flex;align-items:center;gap:10px">' +
      '<div style="width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,var(--azure),var(--teal))"></div>' +
      '<div style="font-size:14px;font-weight:700;color:var(--ink);font-family:DM Sans,sans-serif;display:flex;align-items:center;gap:8px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2a4 4 0 0 1 4 4 4 4 0 0 1-4 4 4 4 0 0 1-4-4 4 4 0 0 1 4-4m0 8v12m-6-6l6 6 6-6"/></svg>' + rob.bargeName + '</div>' +
      (hasManual ? '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:var(--purple-lt);color:var(--purple);border:1px solid var(--purple-bd)">Manual Override Active</span>' : '') +
      '</div>' +
      '<div style="display:flex;gap:6px">' +
      '<button onclick="openROBEditor(' + JSON.stringify(b.id) + ')" style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;background:var(--azure);color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit ROB</button>' +
      '<button onclick="openReloadModal(' + JSON.stringify(b.id) + ')" style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;background:var(--green);color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add Reload</button>' +
      '<button onclick="toggleROBHistory(' + JSON.stringify(b.id) + ')" style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;background:var(--surface);border:none;box-shadow:var(--sh-sm);border-radius:6px;font-size:11px;cursor:pointer;font-family:DM Sans,sans-serif"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z"/></svg>History</button>' +
      '</div></div>' +



      // ── ROB Summary Cards ──
      '<div class="rob-fuel-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">' +

        // VLSFO Card
        '<div style="background:linear-gradient(135deg,var(--fuel-v-lt) 0%,var(--surface) 100%);border:1.5px solid var(--azure-bd);border-radius:12px;padding:16px;position:relative;overflow:hidden">' +
          '<div style="position:absolute;top:0;left:0;bottom:0;width:3px;background:linear-gradient(180deg,var(--azure),#0A4FA8)"></div>' +
          '<div style="padding-left:10px">' +
            '<div style="font-size:10px;font-weight:700;color:var(--fuel-v);letter-spacing:.09em;text-transform:uppercase;margin-bottom:10px">VLSFO</div>' +
            // Three values stacked
            '<div class="rob-triplet" style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:10px">' +
              '<div style="text-align:center">' +
                '<div style="font-size:9px;color:var(--sub);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">Opening</div>' +
                '<div style="font-size:18px;font-weight:700;color:var(--ink);font-family:DM Mono,monospace;line-height:1">' + rob.openingV.toLocaleString() + '</div>' +
                '<div style="font-size:9px;color:var(--muted);margin-top:2px">MT</div>' +
              '</div>' +
              '<div style="font-size:18px;color:var(--red);font-weight:300;padding-bottom:14px">&minus;</div>' +
              '<div style="text-align:center">' +
                '<div style="font-size:9px;color:var(--red);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">Supplied</div>' +
                '<div style="font-size:18px;font-weight:700;color:var(--red);font-family:DM Mono,monospace;line-height:1">' + Math.round(rob.totalSuppliedV).toLocaleString() + '</div>' +
                '<div style="font-size:9px;color:var(--muted);margin-top:2px">MT</div>' +
              '</div>' +
              '<div style="font-size:18px;color:var(--sub);font-weight:300;padding-bottom:14px">=</div>' +
              '<div style="text-align:center">' +
                '<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;color:' + vCol + '">Current ROB</div>' +
                '<div style="font-size:26px;font-weight:700;font-family:DM Mono,monospace;line-height:1;color:' + vCol + '">' + Math.round(rob.liveV).toLocaleString() + '</div>' +
                '<div style="font-size:9px;color:var(--muted);margin-top:2px">MT</div>' +
              '</div>' +
            '</div>' +
            // Progress bar
            '<div style="background:var(--surface3);border-radius:99px;height:6px;overflow:hidden">' +
              '<div style="height:100%;border-radius:99px;background:' + vCol + ';width:' + vPct + '%;transition:width .5s ease"></div>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;margin-top:5px">' +
              '<span style="font-size:10px;color:var(--muted)">' + vPct + '% of ' + rob.vcap.toLocaleString() + ' MT cap</span>' +
              '<span style="font-size:10px;font-weight:600;color:' + vCol + '">' + rob.completedCount + ' supply record(s)</span>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // LSMGO Card
        '<div style="background:linear-gradient(135deg,var(--fuel-m-lt) 0%,var(--surface) 100%);border:1.5px solid var(--fuel-m-bd);border-radius:12px;padding:16px;position:relative;overflow:hidden">' +
          '<div style="position:absolute;top:0;left:0;bottom:0;width:3px;background:linear-gradient(180deg,var(--teal),#0A6B61)"></div>' +
          '<div style="padding-left:10px">' +
            '<div style="font-size:10px;font-weight:700;color:var(--fuel-m);letter-spacing:.09em;text-transform:uppercase;margin-bottom:10px">LSMGO</div>' +
            '<div class="rob-triplet" style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:10px">' +
              '<div style="text-align:center">' +
                '<div style="font-size:9px;color:var(--sub);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">Opening</div>' +
                '<div style="font-size:18px;font-weight:700;color:var(--ink);font-family:DM Mono,monospace;line-height:1">' + rob.openingM.toLocaleString() + '</div>' +
                '<div style="font-size:9px;color:var(--muted);margin-top:2px">MT</div>' +
              '</div>' +
              '<div style="font-size:18px;color:var(--red);font-weight:300;padding-bottom:14px">&minus;</div>' +
              '<div style="text-align:center">' +
                '<div style="font-size:9px;color:var(--red);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">Supplied</div>' +
                '<div style="font-size:18px;font-weight:700;color:var(--red);font-family:DM Mono,monospace;line-height:1">' + Math.round(rob.totalSuppliedM).toLocaleString() + '</div>' +
                '<div style="font-size:9px;color:var(--muted);margin-top:2px">MT</div>' +
              '</div>' +
              '<div style="font-size:18px;color:var(--sub);font-weight:300;padding-bottom:14px">=</div>' +
              '<div style="text-align:center">' +
                '<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;color:' + mCol + '">Current ROB</div>' +
                '<div style="font-size:26px;font-weight:700;font-family:DM Mono,monospace;line-height:1;color:' + mCol + '">' + Math.round(rob.liveM).toLocaleString() + '</div>' +
                '<div style="font-size:9px;color:var(--muted);margin-top:2px">MT</div>' +
              '</div>' +
            '</div>' +
            '<div style="background:var(--surface3);border-radius:99px;height:6px;overflow:hidden">' +
              '<div style="height:100%;border-radius:99px;background:' + mCol + ';width:' + mPct + '%;transition:width .5s ease"></div>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;margin-top:5px">' +
              '<span style="font-size:10px;color:var(--muted)">' + mPct + '% of ' + rob.mcap.toLocaleString() + ' MT cap</span>' +
              '<span style="font-size:10px;font-weight:600;color:' + mCol + '">from saved records</span>' +
            '</div>' +
          '</div>' +
        '</div>' +

      '</div>' +



      // Ullage & Refill Time
      '<div style="background:linear-gradient(90deg,var(--amber-lt),var(--surface));border:1.5px solid var(--amber-bd);border-radius:10px;padding:12px 16px;margin-bottom:12px">' +
      '<div style="font-size:10px;font-weight:700;color:var(--amber);letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px">Ullage &amp; Refill Planning</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px">' +
        '<div style="text-align:center;background:var(--surface);border-radius:7px;padding:9px">' +
          '<div style="font-size:9px;font-weight:700;color:var(--amber);letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px">VLSFO Ullage</div>' +
          '<div style="font-size:16px;font-weight:700;color:var(--ink);font-family:DM Mono,monospace">' + vUllage.toLocaleString() + '</div>' +
          '<div style="font-size:10px;color:var(--sub)">MT to fill</div>' +
        '</div>' +
        '<div style="text-align:center;background:var(--surface);border-radius:7px;padding:9px">' +
          '<div style="font-size:9px;font-weight:700;color:var(--amber);letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px">VLSFO Refill Time</div>' +
          '<div style="font-size:16px;font-weight:700;color:var(--ink);font-family:DM Mono,monospace">' + (vUllage > 0 ? durStr(vRefillHrs) : '—') + '</div>' +
          '<div style="font-size:10px;color:var(--sub)">@ ' + (b.vrfr||750) + ' MT/hr</div>' +
        '</div>' +
        '<div style="text-align:center;background:var(--surface);border-radius:7px;padding:9px">' +
          '<div style="font-size:9px;font-weight:700;color:var(--amber);letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px">LSMGO Ullage</div>' +
          '<div style="font-size:16px;font-weight:700;color:var(--ink);font-family:DM Mono,monospace">' + mUllage.toLocaleString() + '</div>' +
          '<div style="font-size:10px;color:var(--sub)">MT to fill</div>' +
        '</div>' +
        '<div style="text-align:center;background:var(--surface);border-radius:7px;padding:9px">' +
          '<div style="font-size:9px;font-weight:700;color:var(--amber);letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px">LSMGO Refill Time</div>' +
          '<div style="font-size:16px;font-weight:700;color:var(--ink);font-family:DM Mono,monospace">' + (mUllage > 0 ? durStr(mRefillHrs) : '—') + '</div>' +
          '<div style="font-size:10px;color:var(--sub)">@ ' + (b.mrfr||275) + ' MT/hr</div>' +
        '</div>' +
      '</div></div>' +

      // Deduction history (collapsible)
      '<div id="rob-history-' + b.id + '" style="display:none">' +
      '<div style="font-size:10px;font-weight:700;color:var(--sub);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">ROB Deduction History</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:11.5px">' +
      '<thead><tr style="background:var(--ink-solid)">' +
        '<th style="color:#fff;padding:7px 10px;text-align:left;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">Event</th>' +
        '<th style="color:#fff;padding:7px 10px;text-align:left;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">Date</th>' +
        '<th style="color:#fff;padding:7px 10px;text-align:right;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">VLSFO Deducted</th>' +
        '<th style="color:#fff;padding:7px 10px;text-align:right;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">LSMGO Deducted</th>' +
        '<th style="color:#fff;padding:7px 10px;text-align:right;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">VLSFO ROB</th>' +
        '<th style="color:#fff;padding:7px 10px;text-align:right;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">LSMGO ROB</th>' +
        '<th style="color:#fff;padding:7px 10px;text-align:center;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">Source</th>' +
      '</tr></thead><tbody>' +
      rob.history.map(function(h, idx) {
        const srcBg = h.source === 'manual' ? 'var(--purple-lt)' : h.source === 'opening' ? 'var(--azure-lt)' : 'var(--green-lt)';
        const srcColor = h.source === 'manual' ? 'var(--purple)' : h.source === 'opening' ? 'var(--azure)' : 'var(--green)';
        const srcLabel = h.source === 'manual' ? 'Manual' : h.source === 'opening' ? 'Opening' : 'Supply';
        return '<tr style="border-bottom:1px solid var(--border2);background:' + (idx % 2 === 0 ? 'var(--surface)' : 'var(--surface2)') + '">' +
          '<td style="padding:7px 10px;font-weight:600;color:var(--ink)">' + h.label + '</td>' +
          '<td style="padding:7px 10px;font-family:DM Mono,monospace;font-size:11px;color:var(--sub)">' + (h.dateStr || '—') + '</td>' +
          '<td style="padding:7px 10px;text-align:right;font-family:DM Mono,monospace;font-weight:600;color:' + (h.vlsfoAct > 0 ? 'var(--red)' : 'var(--muted)') + '">' + (h.vlsfoAct > 0 ? '−' + h.vlsfoAct.toLocaleString() + ' MT' : '—') + '</td>' +
          '<td style="padding:7px 10px;text-align:right;font-family:DM Mono,monospace;font-weight:600;color:' + (h.mgoAct > 0 ? 'var(--red)' : 'var(--muted)') + '">' + (h.mgoAct > 0 ? '−' + h.mgoAct.toLocaleString() + ' MT' : '—') + '</td>' +
          '<td style="padding:7px 10px;text-align:right;font-family:DM Mono,monospace;font-weight:600;color:var(--azure)">' + Math.round(h.v).toLocaleString() + ' MT</td>' +
          '<td style="padding:7px 10px;text-align:right;font-family:DM Mono,monospace;font-weight:600;color:var(--teal)">' + Math.round(h.m).toLocaleString() + ' MT</td>' +
          '<td style="padding:7px 10px;text-align:center"><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:' + srcBg + ';color:' + srcColor + '">' + srcLabel + '</span></td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>' +
      '</div>';
  });

  el.innerHTML = html || '<div style="font-size:13px;color:var(--muted);text-align:center;padding:20px">No barge data. Generate schedule first.</div>';

  // Also update the Barge ROB Summary to mirror Live ROB exactly
  renderBargeROBSummaryFromLive(liveROBs);
}

/* ─── Barge ROB Summary — Always mirrors Live ROB ─── */
function renderBargeROBSummaryFromLive(liveROBs) {
  const el = document.getElementById('barge-rob-summary');
  if (!el) return;

  if (!liveROBs || !Object.keys(liveROBs).length) {
    liveROBs = getAllLiveROBs();
  }
  if (!liveROBs || !Object.keys(liveROBs).length) {
    el.innerHTML = '<div style="font-size:13px;color:var(--muted);text-align:center;padding:16px;background:var(--surface);border-radius:var(--radius);box-shadow:var(--sh-in-xs)">Generate the schedule to see ROB Summary.</div>';
    return;
  }

  let html = '<div style="background:linear-gradient(135deg,var(--azure-lt),var(--fuel-v-lt));border:1.5px solid var(--azure-bd);border-radius:12px;padding:14px 16px;margin-bottom:6px">' +
    '<div style="font-size:10px;font-weight:700;color:var(--azure);letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;gap:8px">' +
    '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--azure);animation:pulse 2s infinite"></span>' +
    'Live Barge ROB Summary — Click "Update ROB" to override' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">';

  Object.values(liveROBs).forEach(function(rob) {
    const b = _bargeConfig.find(function(x) { return x.name === rob.bargeName || x.id == rob.bargeId; });
    if (!b) return;

    const vPct = rob.vcap > 0 ? Math.min(100, Math.round((rob.liveV / rob.vcap) * 100)) : 0;
    const mPct = rob.mcap > 0 ? Math.min(100, Math.round((rob.liveM / rob.mcap) * 100)) : 0;
    const vCol = vPct < 15 ? 'var(--red)' : vPct < 30 ? 'var(--amber)' : 'var(--fuel-v)';
    const mCol = mPct < 15 ? 'var(--red)' : mPct < 30 ? 'var(--amber)' : 'var(--fuel-m)';
    const hasManual = Object.keys(_manualROB||{}).some(function(k) { return k.startsWith(b.id + '_'); });

    const supplyOps = (_savedSupplies||[]).filter(function(r) {
      if (!r.barge) return Object.values(liveROBs).length === 1;
      return (r.barge||'').toLowerCase().indexOf(rob.bargeName.toLowerCase()) >= 0;
    });
    const totalSupV = supplyOps.reduce(function(s,r){ return s+(parseFloat(r.vlsfoAct)||0); }, 0);
    const totalSupM = supplyOps.reduce(function(s,r){ return s+(parseFloat(r.mgoAct)||0); }, 0);
    const opsCount  = supplyOps.length;
    const plannedOps = (_lastSched||[]).filter(function(item){
      return (item.bargeLabel||'').toLowerCase().indexOf(rob.bargeName.toLowerCase()) >= 0;
    }).length;

    const bid = b.id;

    html +=
      '<div style="background:var(--surface);border-radius:10px;border:none;box-shadow:var(--sh-sm);overflow:hidden" id="rob-sum-card-' + bid + '">' +

        // ── Card header ──
        '<div style="padding:12px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border2)">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M3 11V8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3"/><line x1="12" y1="11" x2="12" y2="22"/></svg>' +
            '<span style="font-size:13px;font-weight:700;color:var(--ink);font-family:DM Sans,sans-serif">' + rob.bargeName + '</span>' +
            (hasManual ? '<span style="font-size:8px;font-weight:700;padding:2px 6px;border-radius:4px;background:var(--purple-lt);color:var(--purple);border:1px solid var(--purple-bd)">Override</span>' : '') +
          '</div>' +
          '<button onclick="toggleROBSumEdit(' + JSON.stringify(bid) + ')" id="rob-sum-edit-btn-' + bid + '" style="display:inline-flex;align-items:center;gap:5px;padding:5px 11px;background:var(--azure);color:#fff;border:none;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif">' +
            '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.47"/></svg>' +
            'Update ROB' +
          '</button>' +
        '</div>' +

        // ── ROB display ──
        '<div style="padding:12px 14px" id="rob-sum-view-' + bid + '">' +

          // VLSFO row
          '<div style="margin-bottom:10px">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">' +
              '<span style="font-size:10px;font-weight:700;color:var(--fuel-v);text-transform:uppercase;letter-spacing:.06em">VLSFO</span>' +
              '<div style="display:flex;align-items:baseline;gap:6px">' +
                '<span style="font-size:20px;font-weight:800;font-family:DM Mono,monospace;color:' + vCol + ';line-height:1">' + Math.round(rob.liveV).toLocaleString() + '</span>' +
                '<span style="font-size:10px;color:var(--muted)">MT</span>' +
                '<span style="font-size:10px;font-weight:600;color:' + vCol + '">(' + vPct + '%)</span>' +
              '</div>' +
            '</div>' +
            '<div style="height:8px;background:var(--bg);border-radius:4px;overflow:hidden">' +
              '<div style="height:100%;background:' + vCol + ';width:' + vPct + '%;border-radius:4px;transition:width .4s"></div>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;margin-top:3px">' +
              '<span style="font-size:9px;color:var(--muted)">Cap: ' + (rob.vcap||0).toLocaleString() + ' MT</span>' +
              '<span style="font-size:9px;color:var(--muted)">Opening: ' + Math.round(rob.openingV||0).toLocaleString() + ' MT</span>' +
            '</div>' +
          '</div>' +

          // LSMGO row
          '<div style="margin-bottom:10px">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">' +
              '<span style="font-size:10px;font-weight:700;color:var(--fuel-m);text-transform:uppercase;letter-spacing:.06em">LSMGO</span>' +
              '<div style="display:flex;align-items:baseline;gap:6px">' +
                '<span style="font-size:20px;font-weight:800;font-family:DM Mono,monospace;color:' + mCol + ';line-height:1">' + Math.round(rob.liveM).toLocaleString() + '</span>' +
                '<span style="font-size:10px;color:var(--muted)">MT</span>' +
                '<span style="font-size:10px;font-weight:600;color:' + mCol + '">(' + mPct + '%)</span>' +
              '</div>' +
            '</div>' +
            '<div style="height:8px;background:var(--bg);border-radius:4px;overflow:hidden">' +
              '<div style="height:100%;background:' + mCol + ';width:' + mPct + '%;border-radius:4px;transition:width .4s"></div>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;margin-top:3px">' +
              '<span style="font-size:9px;color:var(--muted)">Cap: ' + (rob.mcap||0).toLocaleString() + ' MT</span>' +
              '<span style="font-size:9px;color:var(--muted)">Opening: ' + Math.round(rob.openingM||0).toLocaleString() + ' MT</span>' +
            '</div>' +
          '</div>' +

          // Stats strip
          '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;border-top:1px solid var(--border2);padding-top:8px">' +
            '<div style="text-align:center">' +
              '<div style="font-size:8px;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:2px">Ops</div>' +
              '<div style="font-size:13px;font-weight:700;font-family:DM Mono,monospace">' + opsCount + '<span style="font-size:8px;color:var(--muted)">/' + plannedOps + '</span></div>' +
            '</div>' +
            '<div style="text-align:center;border-left:1px solid var(--border2)">' +
              '<div style="font-size:8px;text-transform:uppercase;color:var(--azure);font-weight:600;margin-bottom:2px">V Supplied</div>' +
              '<div style="font-size:12px;font-weight:700;font-family:DM Mono,monospace;color:var(--azure)">' + Math.round(totalSupV).toLocaleString() + '<span style="font-size:8px;font-weight:400"> MT</span></div>' +
            '</div>' +
            '<div style="text-align:center;border-left:1px solid var(--border2)">' +
              '<div style="font-size:8px;text-transform:uppercase;color:var(--teal);font-weight:600;margin-bottom:2px">M Supplied</div>' +
              '<div style="font-size:12px;font-weight:700;font-family:DM Mono,monospace;color:var(--teal)">' + Math.round(totalSupM).toLocaleString() + '<span style="font-size:8px;font-weight:400"> MT</span></div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // ── Inline ROB editor (hidden by default) ──
        '<div id="rob-sum-edit-' + bid + '" style="display:none;border-top:2px solid var(--azure-bd);background:linear-gradient(135deg,var(--azure-lt),var(--green-lt));padding:14px 14px 10px">' +
          '<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--azure);margin-bottom:10px">Set New Current ROB</div>' +

          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">' +
            '<div>' +
              '<label style="font-size:9px;font-weight:700;color:var(--fuel-v);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:4px">VLSFO (MT)</label>' +
              '<div style="position:relative">' +
                '<input type="number" id="rob-sum-v-' + bid + '" value="' + Math.round(rob.liveV) + '" min="0" max="' + (rob.vcap||99999) + '" step="50" ' +
                  'style="width:100%;padding:9px 10px;border:2px solid var(--azure-bd);border-radius:7px;font-size:15px;font-weight:700;font-family:DM Mono,monospace;color:var(--azure);background:var(--surface);outline:none;box-sizing:border-box" ' +
                  'oninput="updateROBSumPreview(\'' + bid + '\')">' +
              '</div>' +
              '<div style="font-size:9px;color:var(--muted);margin-top:3px">Was: <strong>' + Math.round(rob.liveV).toLocaleString() + ' MT</strong></div>' +
            '</div>' +
            '<div>' +
              '<label style="font-size:9px;font-weight:700;color:var(--fuel-m);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:4px">LSMGO (MT)</label>' +
              '<div style="position:relative">' +
                '<input type="number" id="rob-sum-m-' + bid + '" value="' + Math.round(rob.liveM) + '" min="0" max="' + (rob.mcap||99999) + '" step="50" ' +
                  'style="width:100%;padding:9px 10px;border:2px solid var(--fuel-m-bd);border-radius:7px;font-size:15px;font-weight:700;font-family:DM Mono,monospace;color:var(--teal);background:var(--surface);outline:none;box-sizing:border-box" ' +
                  'oninput="updateROBSumPreview(\'' + bid + '\')">' +
              '</div>' +
              '<div style="font-size:9px;color:var(--muted);margin-top:3px">Was: <strong>' + Math.round(rob.liveM).toLocaleString() + ' MT</strong></div>' +
            '</div>' +
          '</div>' +

          // Preview of new %
          '<div id="rob-sum-preview-' + bid + '" style="display:none;margin-bottom:10px;padding:8px 10px;background:var(--surface);border-radius:7px;border:none;box-shadow:var(--sh-in-xs);font-size:11px;color:var(--ink);display:flex;gap:14px;flex-wrap:wrap">' +
          '</div>' +

          '<div>' +
            '<label style="font-size:9px;font-weight:700;color:var(--sub);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:4px">Reason (optional)</label>' +
            '<input type="text" id="rob-sum-reason-' + bid + '" placeholder="e.g. Refuelled at Fujairah, 12 Jun 2025" ' +
              'style="width:100%;padding:7px 10px;border:none;box-shadow:var(--sh-in-xs);border-radius:7px;font-size:12px;font-family:DM Sans,sans-serif;outline:none;box-sizing:border-box">' +
          '</div>' +

          '<div style="display:flex;gap:8px;margin-top:10px">' +
            '<button onclick="saveROBSumEdit(\'' + bid + '\')" ' +
              'style="flex:1;padding:9px 0;background:linear-gradient(135deg,var(--ink-solid),var(--fuel-v));color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif">' +
              '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="vertical-align:middle;margin-right:4px"><polyline points="20 6 9 17 4 12"/></svg>' +
              'Confirm &amp; Apply ROB' +
            '</button>' +
            '<button onclick="toggleROBSumEdit(\'' + bid + '\')" ' +
              'style="padding:9px 16px;background:var(--surface);border:none;box-shadow:var(--sh-sm);border-radius:7px;font-size:12px;cursor:pointer;font-family:DM Sans,sans-serif;color:var(--sub)">Cancel</button>' +
          '</div>' +
        '</div>' +

      '</div>'; // end card
  });

  html += '</div></div>';
  el.innerHTML = html;
}

/* ── ROB Summary inline edit helpers ── */
function toggleROBSumEdit(bid) {
  const editEl = document.getElementById('rob-sum-edit-' + bid);
  const btn    = document.getElementById('rob-sum-edit-btn-' + bid);
  if (!editEl) return;
  const isOpen = editEl.style.display !== 'none';
  editEl.style.display = isOpen ? 'none' : 'block';
  if (btn) {
    if (!isOpen) {
      btn.style.background = 'var(--amber)';
      btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Cancel';
      // Focus VLSFO input
      setTimeout(function(){ const inp = document.getElementById('rob-sum-v-'+bid); if(inp) inp.focus(); }, 50);
    } else {
      btn.style.background = 'var(--azure)';
      btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.47"/></svg> Update ROB';
    }
  }
}

function updateROBSumPreview(bid) {
  const b = _bargeConfig.find(function(x){ return x.id == bid; });
  if (!b) return;
  const newV = parseFloat(document.getElementById('rob-sum-v-' + bid)?.value) || 0;
  const newM = parseFloat(document.getElementById('rob-sum-m-' + bid)?.value) || 0;
  const vPct = b.vcap > 0 ? Math.min(100, Math.round((newV/b.vcap)*100)) : 0;
  const mPct = b.mcap > 0 ? Math.min(100, Math.round((newM/b.mcap)*100)) : 0;
  const vCol = vPct < 15 ? 'var(--red)' : vPct < 30 ? 'var(--amber)' : 'var(--fuel-v)';
  const mCol = mPct < 15 ? 'var(--red)' : mPct < 30 ? 'var(--amber)' : 'var(--fuel-m)';
  const prev = document.getElementById('rob-sum-preview-' + bid);
  if (prev) {
    prev.style.display = 'flex';
    prev.innerHTML =
      '<span style="color:' + vCol + ';font-weight:700;font-family:DM Mono,monospace">VLSFO → ' + newV.toLocaleString() + ' MT (' + vPct + '%)</span>' +
      '<span style="color:' + mCol + ';font-weight:700;font-family:DM Mono,monospace">LSMGO → ' + newM.toLocaleString() + ' MT (' + mPct + '%)</span>';
  }
}

async function saveROBSumEdit(bid) {
  const b = _bargeConfig.find(function(x){ return x.id == bid; });
  if (!b) return;
  const newV   = parseFloat(document.getElementById('rob-sum-v-' + bid)?.value);
  const newM   = parseFloat(document.getElementById('rob-sum-m-' + bid)?.value);
  const reason = (document.getElementById('rob-sum-reason-' + bid)?.value || '').trim() || 'Manual ROB update';
  if (isNaN(newV) || isNaN(newM) || newV < 0 || newM < 0) {
    alert('Enter valid positive values for both VLSFO and LSMGO.');
    return;
  }

  const liveROBs = getAllLiveROBs();
  const oldROB   = liveROBs[bid];
  const oldV = oldROB ? Math.round(oldROB.liveV) : 0;
  const oldM = oldROB ? Math.round(oldROB.liveM) : 0;
  const ts   = new Date().toISOString();

  // Store as _final override — this is the ONLY place this edit is
  // recorded. The "current ROB" you type here is just that: the current
  // remaining amount right now. It is intentionally NEVER written into
  // _bargeConfig's Opening ROB (b.vrob/b.mrob) — doing so used to cause a
  // double-deduction bug, where computeLiveROB() would re-subtract every
  // already-completed supply against a starting point that had already
  // had those same supplies subtracted from it once. Opening ROB is only
  // ever set from the Barge Fleet page's own "Opening ROB" field
  // (saveBargeEdit), which represents the true starting baseline, not a
  // live snapshot — those are two different things and must stay separate.
  if (!_manualROB) _manualROB = {};
  _manualROB[bid + '_final'] = { v: newV, m: newM, reason: reason, editedAt: ts, editedBy: 'ROB Update' };

  // Audit log
  if (!_robAuditLog) _robAuditLog = [];
  _robAuditLog.push({ bargeId: bid, bargeName: b.name, field: 'VLSFO', oldVal: oldV, newVal: Math.round(newV), reason: reason, editedAt: ts, editedBy: 'ROB Update' });
  _robAuditLog.push({ bargeId: bid, bargeName: b.name, field: 'LSMGO', oldVal: oldM, newVal: Math.round(newM), reason: reason, editedAt: ts, editedBy: 'ROB Update' });

  // Also sync barge states so scheduler uses new values
  if (_bargeStates && _bargeStates[bid]) {
    _bargeStates[bid].rv = newV;
    _bargeStates[bid].rm = newM;
  }

  if (typeof updateBargeView === 'function') updateBargeView(bid);

  await saveManualROB();
  await saveROBAudit();
  await saveSharedState();

  // Close the editor panel
  toggleROBSumEdit(bid);

  // Re-render everything that uses ROB
  renderLiveROBDashboard();
  renderRemainingSupplyTracker();
  renderWeekCalendar(_calWeekOffset||0);

  // Flash success on card
  const card = document.getElementById('rob-sum-card-' + bid);
  if (card) {
    card.style.transition = 'box-shadow .2s';
    card.style.boxShadow  = '0 0 0 3px var(--green)';
    setTimeout(function(){ card.style.boxShadow = ''; }, 1200);
  }

  // Toast
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;background:var(--green);color:#fff;border-radius:12px;padding:12px 22px;font-size:13px;font-weight:700;font-family:DM Sans,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.22);white-space:nowrap';
  t.innerHTML = '✓ ' + b.name + ' ROB updated — VLSFO ' + Math.round(newV).toLocaleString() + ' MT | LSMGO ' + Math.round(newM).toLocaleString() + ' MT';
  document.body.appendChild(t);
  setTimeout(function(){ t.style.transition='opacity .4s'; t.style.opacity='0'; setTimeout(function(){ t.remove(); }, 400); }, 3500);
}

function toggleROBHistory(bargeId) {
  const el = document.getElementById('rob-history-' + bargeId);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

/* ─── ROB Editor Modal ─── */
let _editingROBBargeId = null;

function openROBEditor(bargeId) {
  const b = _bargeConfig.find(function(x) { return x.id == bargeId; });
  if (!b) { alert('Generate schedule first.'); return; }
  _editingROBBargeId = bargeId;

  const liveROBs = getAllLiveROBs();
  const rob = liveROBs[bargeId];
  if (!rob) { alert('No ROB data found.'); return; }

  document.getElementById('rob-edit-barge-name').textContent = b.name;
  document.getElementById('rob-edit-vlsfo-cur').textContent  = Math.round(rob.liveV).toLocaleString() + ' MT';
  document.getElementById('rob-edit-mgo-cur').textContent    = Math.round(rob.liveM).toLocaleString() + ' MT';
  document.getElementById('rob-edit-vlsfo').value = Math.round(rob.liveV);
  document.getElementById('rob-edit-mgo').value   = Math.round(rob.liveM);
  document.getElementById('rob-edit-reason').value = '';
  document.getElementById('rob-edit-user').value   = '';

  // Show recent audit log for this barge
  const auditLog = _robAuditLog.filter(function(e) { return e.bargeId == bargeId; }).slice(-8).reverse();
  const auditEl = document.getElementById('rob-audit-list');
  if (auditLog.length) {
    auditEl.innerHTML = auditLog.map(function(e) {
      return '<div style="border-bottom:1px solid var(--border2);padding:6px 0;font-size:11.5px">' +
        '<span style="font-weight:600;color:var(--ink)">' + e.field + '</span>: ' +
        '<span style="color:var(--red)">' + (e.oldVal || 0).toLocaleString() + ' MT</span> → ' +
        '<span style="color:var(--green)">' + (e.newVal || 0).toLocaleString() + ' MT</span>' +
        '<span style="color:var(--muted);font-size:10.5px;margin-left:8px">' + e.editedBy + ' · ' + new Date(e.editedAt).toLocaleString() + '</span>' +
        (e.reason ? '<div style="color:var(--sub);font-size:10.5px;margin-top:2px">' + e.reason + '</div>' : '') +
        '</div>';
    }).join('');
  } else {
    auditEl.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0">No manual edits recorded yet.</div>';
  }

  document.getElementById('rob-editor-modal').style.display = 'flex';
}

function closeROBEditor() {
  document.getElementById('rob-editor-modal').style.display = 'none';
  _editingROBBargeId = null;
}


// ═══════════════════════════════════════════════════════
// REMAINING SUPPLY TRACKER
// Shows planned vs supplied vs remaining per vessel + total
// ═══════════════════════════════════════════════════════
function renderRemainingSupplyTracker(){
  var el=document.getElementById('remaining-supply-tracker');
  if(!el)return;
  var recs=Object.values(_checklistRecords||{}).filter(function(r){return r.state!=='completed';}).sort(function(a,b){return a.sno-b.sno;});

  // Deduplicate by vessel name — if the same vessel appears more than once
  // (e.g. from stale schedule re-injection), keep only the first occurrence.
  var seenVessels = new Set();
  recs = recs.filter(function(r) {
    var key = (r.vessel || '').trim().toLowerCase();
    if (seenVessels.has(key)) return false;
    seenVessels.add(key);
    return true;
  });

  if(!recs.length){
    el.innerHTML='<div style="font-size:12px;color:var(--muted);padding:14px;text-align:center">Generate schedule first to see remaining quantities.</div>';
    return;
  }

  // Prune stale selections — a ticked uid that no longer has a matching
  // pending record (e.g. vessel completed or removed) should not linger.
  (function _pruneRSTSelection(){
    if (!_rstSelected.size) return;
    var live = new Set(recs.map(function(r){return r.uid;}));
    Array.from(_rstSelected).forEach(function(u){ if (!live.has(u)) _rstSelected.delete(u); });
  })();

  // Grand total across ALL barges for whatever rows are currently ticked.
  var rstSelV = 0, rstSelM = 0, rstSelCount = 0;
  recs.forEach(function(rec){
    if (!_rstSelected.has(rec.uid)) return;
    rstSelCount++;
    rstSelV += Number(rec.nomV) || 0;
    rstSelM += Number(rec.nomM) || 0;
  });

  var barges = _bargeConfig && _bargeConfig.length ? _bargeConfig : [{id:'all',name:'All Barges',vrob:0,mrob:0,vbuf:0,mbuf:0}];

  // Helper to resolve which barge a record belongs to (same matching logic
  // used for the visible rows below) — needed so completed vessels' actuals
  // still get subtracted from the right barge's ROB even though they're no
  // longer shown as individual rows.
  function _matchBargeId(rec) {
    var label = (rec.bargeLabel||'').toLowerCase().trim();
    for (var bi=0; bi<barges.length; bi++) {
      if (label === barges[bi].name.toLowerCase().trim()) return barges[bi].id;
    }
    for (var bi=0; bi<barges.length; bi++) {
      if (label.indexOf(barges[bi].name.toLowerCase().trim())>=0) return barges[bi].id;
    }
    return barges[0].id;
  }

  // Completed vessels are hidden from the tracker's rows, but their already-
  // delivered quantities must still reduce the barge's ROB — otherwise the
  // running ROB total would look higher than what's actually left on board.
  var completedTotals = {}; // bargeId -> {v, m}
  barges.forEach(function(b){ completedTotals[b.id] = {v:0, m:0}; });
  Object.values(_checklistRecords||{}).forEach(function(rec){
    if (rec.state !== 'completed') return;
    var bid = _matchBargeId(rec);
    var saved=(_savedSupplies||[]).find(function(r){return r.checklistUid===rec.uid;})
            || (_savedSupplies||[]).find(function(r){return r.vessel===rec.vessel;});
    var aV=saved?(parseFloat(saved.vlsfoAct)||0):(parseFloat(rec.actV)||0);
    var aM=saved?(parseFloat(saved.mgoAct)||0):(parseFloat(rec.actM)||0);
    completedTotals[bid].v += aV;
    completedTotals[bid].m += aM;
  });

  // Map records to barges
  var bargeMap = {}; // bargeId -> {barge, recs}
  barges.forEach(function(b){ bargeMap[b.id]={barge:b,recs:[]}; });

  recs.forEach(function(rec){
    bargeMap[_matchBargeId(rec)].recs.push(rec);
  });

  var html='';
  var hdr=function(txt,col){return '<th style="padding:6px 12px;text-align:right;color:'+(col||'rgba(255,255,255,.5)')+';font-size:9px;text-transform:uppercase;font-weight:600;letter-spacing:.05em">'+txt+'</th>';};

  barges.forEach(function(b){
    var bargeRecs=bargeMap[b.id].recs;
    if(!bargeRecs.length && !(completedTotals[b.id].v||completedTotals[b.id].m))return;

    var openV=b.vrob||0, openM=b.mrob||0;
    // stN = planned qty for PENDING (not-yet-completed) rows only (Subtotal display)
    // stA = actuals for PENDING rows only (Subtotal display)
    var stNV=0, stNM=0, stAV=0, stAM=0;
    // pendingNV/pendingNM = planned quantities for truly PENDING items (state !== completed && state !== saved)
    // used for ROB After All Planned Supplies projection
    var pendingNV=0, pendingNM=0;
    // selV/selM = sum of nominated qty for rows in THIS barge that are ticked (display total)
    // selRemV/selRemM = sum of REMAINING-to-supply qty for ticked rows (state!=='saved' only,
    // matching pendingNV's convention) — this is what actually still needs deducting from
    // Live ROB, since already-delivered actuals are already reflected in Live ROB.
    var selV=0, selM=0, selCount=0, selRemV=0, selRemM=0;
    var rowHtml='';

    bargeRecs.forEach(function(rec){
      var nV=Number(rec.nomV)||0,nM=Number(rec.nomM)||0;
      var isSel = _rstSelected.has(rec.uid);
      var saved=(_savedSupplies||[]).find(function(r){return r.checklistUid===rec.uid;})
              || (_savedSupplies||[]).find(function(r){return r.vessel===rec.vessel;});
      var aV=saved?(parseFloat(saved.vlsfoAct)||0):(parseFloat(rec.actV)||0);
      var aM=saved?(parseFloat(saved.mgoAct)||0):(parseFloat(rec.actM)||0);
      var rV=Math.max(0,nV-aV),rM=Math.max(0,nM-aM);
      if (isSel) {
        selCount++; selV+=nV; selM+=nM;
        if (rec.state !== 'saved') { selRemV += rV; selRemM += rM; }
      }
      // Subtotal: ONLY pending/uncompleted items (exclude saved=executed records from pending calc)
      stNV+=nV; stNM+=nM; stAV+=aV; stAM+=aM;
      // Track remaining planned qty for truly pending items (no actuals yet)
      // This is used for "ROB after all planned supplies" projection
      if (rec.state !== 'saved') {
        pendingNV += Math.max(0, nV - aV);
        pendingNM += Math.max(0, nM - aM);
      }

      var badge=rec.state==='completed'
        ?'<span style="font-size:9px;padding:2px 7px;border-radius:4px;background:var(--green-lt);color:var(--green);font-weight:700">Done</span>'
        :rec.state==='saved'
          ?'<span style="font-size:9px;padding:2px 7px;border-radius:4px;background:var(--azure-lt);color:var(--azure);font-weight:700">Saved</span>'
          :'<span style="font-size:9px;padding:2px 7px;border-radius:4px;background:var(--amber-lt);color:var(--amber);font-weight:700">Pending</span>';

      var vRem=nV>0?(rV>0?'<span style="font-family:DM Mono,monospace;font-weight:700;color:var(--red)">'+rV.toLocaleString()+' MT</span>':'<span style="color:var(--green);font-weight:700">&#10003;</span>'):'&mdash;';
      var mRem=nM>0?(rM>0?'<span style="font-family:DM Mono,monospace;font-weight:700;color:var(--red)">'+rM.toLocaleString()+' MT</span>':'<span style="color:var(--green);font-weight:700">&#10003;</span>'):'&mdash;';

      var dateDisplay = rec.supplyDate ? fmt24(rec.supplyDate instanceof Date ? rec.supplyDate : new Date(rec.supplyDate)) : '&mdash;';

      rowHtml+='<tr data-rst-uid="'+rec.uid+'" style="border-bottom:0.5px solid var(--border2)'+(isSel?';background:rgba(107,198,255,.08)':'')+'">'
        +'<td class="rst-select-col" style="padding:9px 10px;text-align:center"><input type="checkbox" onchange="toggleRSTSelection(\''+rec.uid+'\', this.checked)" '+(isSel?'checked':'')+' style="width:15px;height:15px;cursor:pointer;accent-color:var(--azure,#3B82F6)" title="Tick to include this vessel in the Selected total and image export"></td>'
        +'<td style="padding:9px 14px;font-weight:600;color:var(--ink)">'+rec.vessel+'</td>'
        +'<td style="padding:9px 12px;font-family:DM Mono,monospace;font-size:11px;color:var(--sub);white-space:nowrap">'+dateDisplay+'</td>'
        +'<td style="padding:9px 10px;text-align:center">'+badge+'</td>'
        +'<td style="padding:9px 12px;text-align:right;font-family:DM Mono,monospace;color:var(--azure)">'+(nV>0?nV.toLocaleString()+' MT':'&mdash;')+'</td>'
        +'<td style="padding:9px 12px;text-align:right;font-family:DM Mono,monospace;color:'+(aV>0?'var(--teal)':'var(--muted)')+'">'+(nV>0?aV.toLocaleString()+' MT':'&mdash;')+'</td>'
        +'<td style="padding:9px 12px;text-align:right">'+vRem+'</td>'
        +'<td style="padding:9px 12px;text-align:right;font-family:DM Mono,monospace;color:var(--teal)">'+(nM>0?nM.toLocaleString()+' MT':'&mdash;')+'</td>'
        +'<td style="padding:9px 12px;text-align:right;font-family:DM Mono,monospace;color:'+(aM>0?'var(--teal)':'var(--muted)')+'">'+(nM>0?aM.toLocaleString()+' MT':'&mdash;')+'</td>'
        +'<td style="padding:9px 12px;text-align:right">'+mRem+'</td>'
        +'</tr>';
    });

    // Subtotal = ONLY pending items shown in table (not completed, not saved-executed)
    var tRV=Math.max(0,stNV-stAV), tRM=Math.max(0,stNM-stAM);

    // ── Live ROB (After Actuals) ──────────────────────────────────────────────
    // RULE: Use ONLY completed/actual supplies from computeLiveROB.
    // DO NOT include planned or pending supplies.
    // computeLiveROB deducts only records with non-zero vlsfoAct/mgoAct (_savedSupplies).
    var _lrob = computeLiveROB(b.id, b.name, b.vrob || 0, b.mrob || 0, null);
    var robLiveV = openV > 0 ? _lrob.v : null;
    var robLiveM = openM > 0 ? _lrob.m : null;

    // ── ROB After All Planned Supplies ────────────────────────────────────────
    // RULE: Base = Live ROB (actuals already applied). Subtract ONLY pending planned
    // quantities (items not yet executed/saved). DO NOT re-deduct completed actuals.
    var robAfterV = robLiveV !== null ? Math.max(0, robLiveV - pendingNV) : null;
    var robAfterM = robLiveM !== null ? Math.max(0, robLiveM - pendingNM) : null;

    // ── ROB After Selected (Ticked) Supplies ────────────────────────────────────
    // RULE: Base = Live ROB (actuals already applied). Subtract ONLY the remaining
    // qty of vessels the user has TICKED in this barge. DO NOT re-deduct actuals
    // already reflected in Live ROB. Always the exact remaining nominated amount —
    // never held back just because it exceeds what's currently on board.
    var robSelV = (robLiveV !== null && selCount > 0) ? Math.max(0, robLiveV - selRemV) : null;
    var robSelM = (robLiveM !== null && selCount > 0) ? Math.max(0, robLiveM - selRemM) : null;

    html+=
      '<div class="rst-barge-block" data-rst-barge="'+b.id+'" style="margin-bottom:18px">'
      // Barge header
      +'<div style="background:var(--ink-solid);padding:8px 14px;display:flex;align-items:center;gap:10px">'
        +'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6BC6FF" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M3 11V8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3"/><line x1="12" y1="11" x2="12" y2="22"/></svg>'
        +'<span style="font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.08em">'+b.name+'</span>'
        +(openV>0?'<span style="margin-left:auto;font-size:10px;color:rgba(107,198,255,.7)">Opening ROB: VLSFO '+openV.toLocaleString()+' MT &nbsp;|&nbsp; MGO '+openM.toLocaleString()+' MT</span>':'')
      +'</div>'
      +'<div style="overflow-x:auto">'
      +'<table style="width:100%;border-collapse:collapse;font-size:12px">'
      +'<thead>'
        +'<tr style="background:var(--ink-solid)">'
          +'<th class="rst-select-col" style="padding:7px 10px;color:#fff;font-size:9.5px;text-transform:uppercase" title="Tick vessels to include in the Selected total and image export">Sel.</th>'
          +'<th style="padding:7px 14px;text-align:left;color:#fff;font-size:9.5px;text-transform:uppercase;white-space:nowrap">Vessel</th>'
          +'<th style="padding:7px 12px;text-align:left;color:#fff;font-size:9.5px;text-transform:uppercase;white-space:nowrap">Date / Actual ETA</th>'
          +'<th style="padding:7px 10px;color:#fff;font-size:9.5px;text-transform:uppercase">Status</th>'
          +'<th colspan="3" style="padding:7px 12px;text-align:center;color:var(--fuel-v-bd);font-size:9.5px;text-transform:uppercase;border-left:1px solid rgba(255,255,255,.1)">VLSFO</th>'
          +'<th colspan="3" style="padding:7px 12px;text-align:center;color:var(--fuel-m-bd);font-size:9.5px;text-transform:uppercase;border-left:1px solid rgba(255,255,255,.1)">LSMGO</th>'
        +'</tr>'
        +'<tr style="background:var(--navy2)">'
          +'<th class="rst-select-col"></th><th></th><th></th><th></th>'
          +hdr('Planned','rgba(107,198,255,.7)')+hdr('Supplied','rgba(255,255,255,.5)')+hdr('Remaining','rgba(255,255,255,.5)')
          +hdr('Planned','rgba(107,198,255,.7)')+hdr('Supplied','rgba(255,255,255,.5)')+hdr('Remaining','rgba(255,255,255,.5)')
        +'</tr>'
      +'</thead>'
      +'<tbody>'+rowHtml+'</tbody>'
      +'<tfoot>'
        // Totals row — unchanged: always the full, exact nominated quantity
        // still to be supplied, regardless of ROB availability or ticks.
        +'<tr style="background:var(--bg);border-top:2px solid var(--border)">'
          +'<td class="rst-select-col"></td>'
          +'<td style="padding:9px 14px;font-weight:700;color:var(--ink)" colspan="3">SUBTOTAL (REMAINING)</td>'
          +'<td style="padding:9px 12px;text-align:right;font-family:DM Mono,monospace;font-weight:700;color:var(--azure)">'+stNV.toLocaleString()+' MT</td>'
          +'<td style="padding:9px 12px;text-align:right;font-family:DM Mono,monospace;color:var(--teal)">'+stAV.toLocaleString()+' MT</td>'
          +'<td style="padding:9px 12px;text-align:right;font-weight:700;color:'+(tRV>0?'var(--red)':'var(--green)')+'">'+(tRV>0?tRV.toLocaleString()+' MT':'&#10003; Done')+'</td>'
          +'<td style="padding:9px 12px;text-align:right;font-family:DM Mono,monospace;font-weight:700;color:var(--teal)">'+stNM.toLocaleString()+' MT</td>'
          +'<td style="padding:9px 12px;text-align:right;font-family:DM Mono,monospace;color:var(--teal)">'+stAM.toLocaleString()+' MT</td>'
          +'<td style="padding:9px 12px;text-align:right;font-weight:700;color:'+(tRM>0?'var(--red)':'var(--green)')+'">'+(tRM>0?tRM.toLocaleString()+' MT':'&#10003; Done')+'</td>'
        +'</tr>'
        // TOTAL (SELECTED) row — shows ONLY the ticked vessels' nominated
        // quantity for this barge. Always the exact nominated figure (never
        // reduced for ROB shortage — whatever is short still gets supplied).
        +(selCount>0?
          '<tr style="background:rgba(107,198,255,.08);border-top:1px dashed var(--azure-bd)">'
            +'<td class="rst-select-col"></td>'
            +'<td style="padding:8px 14px;font-size:11px;font-weight:700;color:var(--azure)" colspan="3">TOTAL (SELECTED) &mdash; '+selCount+' vessel'+(selCount>1?'s':'')+' ticked</td>'
            +'<td style="padding:8px 12px;text-align:right;font-family:DM Mono,monospace;font-weight:700;color:var(--azure)">'+selV.toLocaleString()+' MT</td>'
            +'<td></td><td></td>'
            +'<td style="padding:8px 12px;text-align:right;font-family:DM Mono,monospace;font-weight:700;color:var(--teal)">'+selM.toLocaleString()+' MT</td>'
            +'<td></td><td></td>'
          +'</tr>'
        :'')
        // Live ROB row (opening - actuals supplied so far)
        +(robLiveV!==null?
          '<tr style="background:var(--amber-lt);border-top:1px dashed var(--amber-bd)">'
            +'<td class="rst-select-col"></td>'
            +'<td style="padding:7px 14px;font-size:11px;color:var(--amber);font-weight:600" colspan="3">Live ROB (after actuals)</td>'
            +'<td></td><td></td>'
            +'<td style="padding:7px 12px;text-align:right;font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:'+(robLiveV<(b.vbuf||0)?'var(--red)':'var(--amber)')+'">'+(robLiveV.toLocaleString())+' MT</td>'
            +'<td></td><td></td>'
            +'<td style="padding:7px 12px;text-align:right;font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:'+(robLiveM<(b.mbuf||0)?'var(--red)':'var(--amber)')+'">'+(robLiveM!==null?robLiveM.toLocaleString()+' MT':'&mdash;')+'</td>'
          +'</tr>'
        :'')
        // ROB after SELECTED (ticked) supplies row — only shown when something's ticked
        +(robSelV!==null?
          '<tr style="background:rgba(107,198,255,.10);border-top:1px dashed var(--azure-bd)">'
            +'<td class="rst-select-col"></td>'
            +'<td style="padding:7px 14px;font-size:11px;color:var(--azure);font-weight:700" colspan="3">ROB after selected supplies ('+selCount+' ticked)</td>'
            +'<td></td><td></td>'
            +'<td style="padding:7px 12px;text-align:right;font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:'+(robSelV<(b.vbuf||0)?'var(--red)':'var(--azure)')+'">'+(robSelV.toLocaleString())+' MT</td>'
            +'<td></td><td></td>'
            +'<td style="padding:7px 12px;text-align:right;font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:'+(robSelM!==null&&robSelM<(b.mbuf||0)?'var(--red)':'var(--teal)')+'">'+(robSelM!==null?robSelM.toLocaleString()+' MT':'&mdash;')+'</td>'
          +'</tr>'
        :'')
        // ROB after ALL planned row
        +(robAfterV!==null?
          '<tr style="background:var(--azure-lt);border-top:1px dashed var(--azure-bd)">'
            +'<td class="rst-select-col"></td>'
            +'<td style="padding:7px 14px;font-size:11px;color:var(--azure);font-weight:600" colspan="3">ROB after all planned supplies</td>'
            +'<td></td><td></td>'
            +'<td style="padding:7px 12px;text-align:right;font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:'+(robAfterV<(b.vbuf||0)?'var(--red)':'var(--azure)')+'">'+(robAfterV.toLocaleString())+' MT</td>'
            +'<td></td><td></td>'
            +'<td style="padding:7px 12px;text-align:right;font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:'+(robAfterM!==null&&robAfterM<(b.mbuf||0)?'var(--red)':'var(--teal)')+'">'+(robAfterM!==null?robAfterM.toLocaleString()+' MT':'&mdash;')+'</td>'
          +'</tr>'
        :'')
      +'</tfoot>'
      +'</table></div>'
      +'</div>';
  });

  // Grand-total "Selected" summary bar across ALL barges — reflects only
  // the vessels currently ticked. Not part of the per-barge SUBTOTAL logic,
  // purely an additive convenience so a ticked group's combined qty is
  // visible at a glance, and it's what the image download will total too.
  var selBar = '<div class="rst-summary-bar" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:9px 14px;margin-bottom:14px;border-radius:6px;background:'
    +(rstSelCount>0?'rgba(107,198,255,.12)':'var(--bg)')+';border:1px solid '+(rstSelCount>0?'var(--azure-bd)':'var(--border2)')+'">'
    +'<span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:'+(rstSelCount>0?'var(--azure)':'var(--muted)')+'">'
      +(rstSelCount>0?('Selected: '+rstSelCount+' vessel'+(rstSelCount>1?'s':'')):'No vessels ticked')
    +'</span>'
    +(rstSelCount>0?
      ('<span style="font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:var(--fuel-v)">VLSFO '+rstSelV.toLocaleString()+' MT</span>'
      +'<span style="font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:var(--fuel-m)">LSMGO '+rstSelM.toLocaleString()+' MT</span>'
      +'<button onclick="clearRSTSelection()" class="btn btn-ghost btn-sm rst-noprint" style="margin-left:auto;font-size:10px;padding:3px 10px">Clear Selection</button>')
      :'<span style="font-size:11px;color:var(--muted)">Tick vessels below to see a combined selected total, and to limit the image download to just those vessels.</span>')
    +'</div>';

  el.innerHTML = (html ? (selBar + html) : '<div style="font-size:12px;color:var(--muted);padding:14px;text-align:center">No checklist records matched to barges.</div>');
}

/* ─── Download Remaining Supply Tracker as PNG ───
   Lazy-loads html2canvas (same pattern as ciLoadJSZip), renders the
   actual on-screen card — header, every per-barge table, footer
   totals — to a canvas at 2x scale for crisp text, then triggers a
   PNG file download. Nothing about the tracker's own data or layout
   changes; this only captures exactly what's already shown. ─────── */
async function _loadHtml2Canvas() {
  if (typeof html2canvas !== 'undefined') return html2canvas;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = () => resolve(window.html2canvas);
    s.onerror = () => reject(new Error('Could not load the image export library. Check your internet connection.'));
    document.head.appendChild(s);
  });
}

async function downloadRemainingSupplyTrackerPNG() {
  const btn = document.getElementById('rst-download-btn');
  const card = document.getElementById('remaining-tracker-card');
  if (!card) return;

  const recs = Object.values(_checklistRecords || {});
  if (!recs.length) {
    alert('Nothing to download yet — generate a schedule first so the tracker has data to show.');
    return;
  }

  const origLabel = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="animation:spin .8s linear infinite"><path d="M21 12a9 9 0 1 1-2.64-6.36"/></svg> Preparing image…';
  }

  // The card itself has overflow:hidden, and its inner table is often wrapped
  // in its own overflow-x:auto div — both clip the real content width. Without
  // removing both, html2canvas captures only what's visible and the right
  // edge gets cut off. Temporarily unclip everything, capture, then restore.
  const clippers = [card, ...Array.from(card.querySelectorAll('[style*="overflow-x:auto"], [style*="overflow-x: auto"]'))];
  const clipperOrigStyles = clippers.map(el => ({ overflow: el.style.overflow, overflowX: el.style.overflowX, width: el.style.width }));
  clippers.forEach(el => { el.style.overflow = 'visible'; el.style.overflowX = 'visible'; });

  // The tables themselves are styled width:100%, which stretches them to
  // fill the full card width even when the content is much narrower — and
  // the card itself is a block element that fills its parent regardless of
  // how narrow the table inside becomes. Both must shrink to their natural
  // content width before capture, or the image keeps a wide blank margin on
  // the right even after the table itself is narrowed. Restore both after.
  const cardOrigWidth = card.style.width;
  card.style.width = 'max-content';
  const tables = Array.from(card.querySelectorAll('table'));
  const tableOrigWidths = tables.map(t => t.style.width);
  tables.forEach(t => { t.style.width = 'max-content'; });

  // If specific vessels are ticked, the exported image should show ONLY
  // those ticked rows (plus their totals) — not the full tracker. Hide
  // everything else for the capture, then restore it right after.
  const hasTickedSelection = _rstSelected && _rstSelected.size > 0;
  const hiddenForExport = [];
  if (hasTickedSelection) {
    Array.from(card.querySelectorAll('tr[data-rst-uid]')).forEach(tr => {
      if (!_rstSelected.has(tr.getAttribute('data-rst-uid'))) {
        hiddenForExport.push({ el: tr, disp: tr.style.display });
        tr.style.display = 'none';
      }
    });
    Array.from(card.querySelectorAll('[data-rst-barge]')).forEach(blk => {
      const anyVisible = Array.from(blk.querySelectorAll('tr[data-rst-uid]'))
        .some(tr => tr.style.display !== 'none');
      if (!anyVisible) {
        hiddenForExport.push({ el: blk, disp: blk.style.display });
        blk.style.display = 'none';
      }
    });
  }
  // The tick-mark checkboxes themselves and any interactive controls (e.g.
  // "Clear Selection") are UI-only — never useful in a static exported
  // image — so they're always hidden for the capture, ticked or not.
  Array.from(card.querySelectorAll('.rst-select-col, .rst-noprint')).forEach(elx => {
    hiddenForExport.push({ el: elx, disp: elx.style.display });
    elx.style.display = 'none';
  });

  try {
    const html2canvasFn = await _loadHtml2Canvas();

    // Measure AFTER unclipping/shrinking so scrollWidth reflects the true,
    // tightly-fitted content size rather than the stretched 100% width.
    const fullWidth  = Math.max(card.scrollWidth,  card.offsetWidth);
    const fullHeight = Math.max(card.scrollHeight, card.offsetHeight);

    const canvas = await html2canvasFn(card, {
      backgroundColor: '#ffffff',
      scale: 4,                 // high resolution, presentation-ready output
      useCORS: true,
      logging: false,
      width: fullWidth,
      height: fullHeight,
      windowWidth: fullWidth,
      windowHeight: fullHeight,
      scrollX: 0,
      scrollY: 0
    });

    const stamp = new Date();
    const fname = (hasTickedSelection ? 'Remaining-Supply-Tracker-Selected-' : 'Remaining-Supply-Tracker-') + stamp.getFullYear() +
      String(stamp.getMonth()+1).padStart(2,'0') + String(stamp.getDate()).padStart(2,'0') +
      '-' + String(stamp.getHours()).padStart(2,'0') + String(stamp.getMinutes()).padStart(2,'0') + '.png';

    canvas.toBlob(function(blob) {
      if (!blob) { alert('Could not generate the image. Please try again.'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/png');

  } catch (e) {
    alert('Could not download the image: ' + e.message);
  } finally {
    clippers.forEach((el, i) => {
      el.style.overflow = clipperOrigStyles[i].overflow;
      el.style.overflowX = clipperOrigStyles[i].overflowX;
    });
    tables.forEach((t, i) => { t.style.width = tableOrigWidths[i]; });
    card.style.width = cardOrigWidth;
    hiddenForExport.forEach(h => { h.el.style.display = h.disp; });
    if (btn) { btn.disabled = false; btn.innerHTML = origLabel; }
  }
}

/* ─── Download Voyage Schedule table as PNG image (same pattern as the
   Remaining Supply Tracker download) — captures exactly what's on screen,
   nothing about the schedule's own data or layout changes. ─────────── */
async function downloadVoyageSchedulePNG() {
  const btn = document.getElementById('voy-download-btn');
  const card = document.getElementById('voy-barge-tabs-card');
  if (!card) return;

  if (!_lastSched || !_lastSched.length) {
    alert('Nothing to download yet — generate the schedule first.');
    return;
  }

  // Only the ticked rows should appear in the image — same selection the
  // Print button already respects. Hide unchecked rows (and the checkbox
  // column itself, since it's meaningless in a static image) right before
  // capture, then restore everything afterward so the live table is
  // untouched once the download finishes.
  const allChecks = Array.from(card.querySelectorAll('.voy-print-chk'));
  const checkedCount = allChecks.filter(c => c.checked).length;
  if (allChecks.length && checkedCount === 0) {
    alert('No vessels selected.\nUse the Print checkboxes in the Voyage Schedule table to choose which vessels to include in the image.');
    return;
  }

  const hiddenRows = [];   // <tr> elements temporarily hidden
  const hiddenCells = [];  // checkbox <td>/<th> cells temporarily hidden (header + body)
  allChecks.forEach(chk => {
    const row = chk.closest('tr');
    if (row && !chk.checked) {
      hiddenRows.push(row);
      row.style.display = 'none';
    }
  });
  // Hide the checkbox column entirely (header "PRINT" cell + every body cell)
  if (allChecks.length) {
    card.querySelectorAll('tr').forEach(row => {
      const firstCell = row.querySelector('th, td');
      if (firstCell && (firstCell.querySelector('.voy-print-chk') || firstCell.querySelector('#voy-select-all'))) {
        hiddenCells.push(firstCell);
        firstCell.style.display = 'none';
      }
    });
  }

  // ── Fix #4: the "Download ... PDF" button(s) live INSIDE this same card
  // (rendered above the table for each barge tab) so html2canvas would
  // otherwise capture them into the exported image. The PDF button must
  // NEVER appear in the image output under any condition — hide every
  // such button for the duration of the capture, then restore them all
  // afterward exactly as they were (this never disables or removes the
  // PDF button from the live page, only from the screenshot).
  const pdfBtns = Array.from(card.querySelectorAll('button[onclick^="downloadBargePDF"]'));
  const pdfBtnOrigDisplay = pdfBtns.map(b => b.style.display);
  pdfBtns.forEach(b => { b.style.display = 'none'; });

  const origLabel = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="animation:spin .8s linear infinite"><path d="M21 12a9 9 0 1 1-2.64-6.36"/></svg> Preparing image…';
  }

  // The table can be wider than its visible scroll container (.voy-wrap has
  // overflow-x:auto). html2canvas only captures what's actually laid out —
  // if the wrapper is still clipping at capture time, the right-most columns
  // get cut off, no matter what width/windowWidth options are passed. Fix:
  // temporarily remove the clipping (overflow:visible, width:max-content)
  // from every .voy-wrap inside the card so the full table lays out and
  // renders before the screenshot, then restore those styles afterward.
  const wraps = Array.from(card.querySelectorAll('.voy-wrap'));
  const wrapOrigStyles = wraps.map(w => ({ overflow: w.style.overflow, width: w.style.width }));
  wraps.forEach(w => { w.style.overflow = 'visible'; w.style.width = 'max-content'; });

  // .voy-tbl and the card itself are both styled/sized to stretch to their
  // full container width regardless of how narrow the actual content is —
  // that leaves a wide blank margin in the downloaded image. Shrink both to
  // their natural content width too, so the image crops tightly with no
  // wasted space, then restore everything after capture.
  const cardOrigWidth = card.style.width;
  card.style.width = 'max-content';
  const tables = Array.from(card.querySelectorAll('table'));
  const tableOrigWidths = tables.map(t => t.style.width);
  tables.forEach(t => { t.style.width = 'max-content'; });

  try {
    const html2canvasFn = await _loadHtml2Canvas();

    // Now that wrappers are unclipped, the card's own scrollWidth correctly
    // reflects the full table width — measure it fresh, after the unclip.
    const fullWidth  = Math.max(card.scrollWidth,  card.offsetWidth);
    const fullHeight = Math.max(card.scrollHeight, card.offsetHeight);

    const canvas = await html2canvasFn(card, {
      backgroundColor: '#ffffff',
      scale: 5,                 // high resolution, presentation-ready output — this table is wider (many columns) than the Remaining Supply Tracker, so a higher multiplier keeps text equally sharp at the larger final image size
      useCORS: true,
      logging: false,
      width: fullWidth,
      height: fullHeight,
      windowWidth: fullWidth,
      windowHeight: fullHeight,
      scrollX: 0,
      scrollY: 0
    });

    const stamp = new Date();
    const fname = 'Voyage-Schedule-' + stamp.getFullYear() +
      String(stamp.getMonth()+1).padStart(2,'0') + String(stamp.getDate()).padStart(2,'0') +
      '-' + String(stamp.getHours()).padStart(2,'0') + String(stamp.getMinutes()).padStart(2,'0') + '.png';

    canvas.toBlob(function(blob) {
      if (!blob) { alert('Could not generate the image. Please try again.'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/png');

  } catch (e) {
    alert('Could not download the image: ' + e.message);
  } finally {
    // Always restore hidden rows/cells and unclip overrides, even if capture failed
    hiddenRows.forEach(row => { row.style.display = ''; });
    hiddenCells.forEach(cell => { cell.style.display = ''; });
    pdfBtns.forEach((b, i) => { b.style.display = pdfBtnOrigDisplay[i]; });
    wraps.forEach((w, i) => { w.style.overflow = wrapOrigStyles[i].overflow; w.style.width = wrapOrigStyles[i].width; });
    tables.forEach((t, i) => { t.style.width = tableOrigWidths[i]; });
    card.style.width = cardOrigWidth;
    if (btn) { btn.disabled = false; btn.innerHTML = origLabel; }
  }
}

async function saveROBEdit() {
  const bargeId = _editingROBBargeId;
  const b = _bargeConfig.find(function(x) { return x.id == bargeId; });
  if (!b || bargeId === null) return;

  const newV  = parseFloat(document.getElementById('rob-edit-vlsfo').value);
  const newM  = parseFloat(document.getElementById('rob-edit-mgo').value);
  const reason = document.getElementById('rob-edit-reason').value.trim();
  const user   = document.getElementById('rob-edit-user').value.trim() || 'User';

  if (isNaN(newV) || isNaN(newM)) { alert('Enter valid numeric values.'); return; }
  if (newV < 0 || newM < 0)       { alert('ROB cannot be negative.'); return; }

  const liveROBs = getAllLiveROBs();
  const cur = liveROBs[bargeId];

  // Log the change
  const ts = new Date().toISOString();
  if (Math.round(newV) !== Math.round(cur.liveV)) {
    _robAuditLog.push({ bargeId: bargeId, bargeName: b.name, field: 'VLSFO ROB', oldVal: Math.round(cur.liveV), newVal: newV, reason: reason, editedAt: ts, editedBy: user });
  }
  if (Math.round(newM) !== Math.round(cur.liveM)) {
    _robAuditLog.push({ bargeId: bargeId, bargeName: b.name, field: 'MGO ROB', oldVal: Math.round(cur.liveM), newVal: newM, reason: reason, editedAt: ts, editedBy: user });
  }

  // Store override — set as the final override so it takes effect immediately
  if (!_manualROB) _manualROB = {};
  _manualROB[bargeId + '_final'] = { v: newV, m: newM, reason: reason, editedAt: ts, editedBy: user };

  await saveROBAudit();
  await saveManualROB();

  closeROBEditor();
  renderLiveROBDashboard();
  // _bargeRobSummary is re-rendered inside renderLiveROBDashboard via the call chain
  // but force it explicitly to be sure
  setTimeout(function(){ renderBargeROBSummaryFromLive(getAllLiveROBs()); }, 50);

  // Update the bargeStates used by the availability checker
  if (_bargeStates[bargeId]) {
    _bargeStates[bargeId].rv = newV;
    _bargeStates[bargeId].rm = newM;
  }

  // Flash success
  const dashEl = document.getElementById('live-rob-dashboard');
  if (dashEl) {
    const banner = document.createElement('div');
    banner.style.cssText = 'background:var(--green);color:#fff;font-size:12px;font-weight:700;padding:10px 16px;border-radius:8px;text-align:center;margin-bottom:10px';
    banner.textContent = 'ROB for ' + b.name + ' updated. VLSFO: ' + newV.toLocaleString() + ' MT | MGO: ' + newM.toLocaleString() + ' MT. Availability Checker will use new values.';
    dashEl.insertBefore(banner, dashEl.firstChild);
    setTimeout(function() { banner.remove(); }, 5000);
  }
}

async function saveManualROB() {
  // Strip _final entries before persisting — they will be baked into vrob/mrob by
  // saveSharedState(), so they must not also survive in _manualROB on reload.
  const toSave = Object.assign({}, _manualROB || {});
  Object.keys(toSave).forEach(function(k) { if (k.endsWith('_final')) delete toSave[k]; });
  try { localStorage.setItem('abps_manual_rob_v1', JSON.stringify(toSave)); } catch(e) {}
  // Sync to Supabase (saveSharedState handles baking)
  if (_syncReady()) { try { await saveSharedState(); } catch(e) {} }
}

async function loadManualROB() {
  // IMPORTANT: applyState() (called via loadSharedState() earlier in init())
  // already restores _manualROB from the authoritative shared/synced state —
  // that copy is always the most current one, since it's written every time
  // saveSharedState() runs from ANY save path (Barge Parameters edit, ROB
  // Summary override, etc). This function's own localStorage key
  // ('abps_manual_rob_v1') is only updated by saveManualROB() specifically,
  // which is NOT called from every save path — so it can easily go stale.
  // Unconditionally overwriting _manualROB here was clobbering a correct,
  // just-restored override with old/empty data, which is exactly what
  // caused ROB overrides to silently reset after closing and reopening.
  // Only use this as a fallback when applyState() found nothing at all.
  if (_manualROB && Object.keys(_manualROB).length > 0) return;
  try {
    const raw = localStorage.getItem('abps_manual_rob_v1');
    if (raw) _manualROB = JSON.parse(raw);
  } catch(e) { /* leave _manualROB as-is */ }
}


/* ─── UAE LIVE CLOCK — Asia/Dubai (UTC+4), 24-hour, updates every second ─── */
(function uaeClock() {
  const DAYS  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const pad = n => String(n).padStart(2,'0');

  function tickUAE() {
    const timeEl = document.getElementById('live-clock-time');
    const dateEl = document.getElementById('live-clock-date');
    if (!timeEl && !dateEl) return;

    // Use Intl.DateTimeFormat for reliable UAE timezone handling
    const now = new Date();
    try {
      const uaeParts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Dubai',
        year:    'numeric',
        month:   '2-digit',
        day:     '2-digit',
        hour:    '2-digit',
        minute:  '2-digit',
        second:  '2-digit',
        hour12:  false,
        weekday: 'short'
      }).formatToParts(now);

      const get = type => (uaeParts.find(p => p.type === type) || {}).value || '';
      const hh  = get('hour');
      const mi  = get('minute');
      const ss  = get('second');
      const dd  = get('day');
      const mo  = parseInt(get('month'), 10) - 1; // 0-indexed
      const yr  = get('year');
      const wd  = get('weekday');

      const timeStr = (hh === '24' ? '00' : hh) + ':' + mi + ':' + ss;
      const dateStr = wd + ' ' + dd + ' ' + MONTHS[mo] + ' ' + yr + ' · UAE';

      if (timeEl) timeEl.textContent = timeStr;
      if (dateEl) dateEl.textContent = dateStr;

      // Legacy fallback — update old single-text clock if still present
      const legacyEl = document.getElementById('live-clock');
      if (legacyEl && !legacyEl.querySelector('#live-clock-time')) {
        legacyEl.textContent = dd + ' ' + MONTHS[mo] + ' ' + yr + '  ' + timeStr + ' UAE';
      }
    } catch(e) {
      // Fallback: UTC+4 manual offset
      const uae = new Date(now.getTime() + 4 * 3600000);
      const timeStr = pad(uae.getUTCHours()) + ':' + pad(uae.getUTCMinutes()) + ':' + pad(uae.getUTCSeconds());
      const dateStr = DAYS[uae.getUTCDay()].slice(0,3) + ' ' + pad(uae.getUTCDate()) + ' ' + MONTHS[uae.getUTCMonth()] + ' ' + uae.getUTCFullYear() + ' · UAE';
      if (timeEl) timeEl.textContent = timeStr;
      if (dateEl) dateEl.textContent = dateStr;
    }
  }

  tickUAE();
  setInterval(tickUAE, 1000);
})();

/* ─── CONSTANTS ─── */
let vc = 0, bc = 0;
let _barges = [];
let _lastETC = null, _closingV = 0, _closingM = 0, _lastSched = [];
let _bargeStates = {}, _bargeConfig = [];
const _nscCheckData = {}; // NSC check data store
let _checklistRecords = {}; // Persistent independent checklist records

/* ─── Remaining Supply Tracker — row selection (tick marks) ───
   Purely a UI/export convenience: lets the user tick specific vessels
   in the Remaining Supply Tracker so a "Selected" total can be shown
   and so the downloaded image can be limited to just the ticked rows.
   Does not affect Subtotal/Planned figures anywhere — those always
   keep showing the full, exact nominated quantity as before. ─────── */
let _rstSelected = new Set();
function toggleRSTSelection(uid, checked) {
  if (!uid) return;
  if (checked) _rstSelected.add(uid); else _rstSelected.delete(uid);
  if (typeof renderRemainingSupplyTracker === 'function') renderRemainingSupplyTracker();
}
function clearRSTSelection() {
  if (!_rstSelected.size) return;
  _rstSelected.clear();
  if (typeof renderRemainingSupplyTracker === 'function') renderRemainingSupplyTracker();
}
let _checklist = {};        // Legacy checklist sync store
let _trashBin = []; // Soft-deleted vessels — must be at top level
const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MMAP = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
const pad = n => String(n).padStart(2,'0');

/* ─── ANCHORAGE OPTIONS ─── */
const AREA_OPTIONS = [
  { value: 'FUJ-A', label: 'FUJ A — Fujairah Anchorage', short: 'FUJ A' },
  { value: 'FUJ-B', label: 'FUJ B — Fujairah Berth',     short: 'FUJ B' },
  { value: 'KFK-A', label: 'KFK A — Khor Fakkan Anchorage', short: 'KFK A' },
  { value: 'KFK-B', label: 'KFK B — Khor Fakkan Berth',   short: 'KFK B' },
];
function areaShort(val) { return AREA_OPTIONS.find(o=>o.value===val)?.short || val || '—'; }
function areaOptionsHTML(selected) {
  return AREA_OPTIONS.map(o => `<option value="${o.value}" ${selected===o.value?'selected':''}>${o.label}</option>`).join('');
}

/* ─── FORMATTERS ─── */
function fmt24(d) { if (!(d instanceof Date) || isNaN(d.getTime())) return '—'; return `${pad(d.getDate())} ${MO[d.getMonth()]} ${d.getFullYear()}  ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fmtShort(d) { if (!d) return '—'; return `${d.getDate()} ${MO[d.getMonth()]}`; }
function durStr(h) { const hh = Math.floor(h), mm = Math.round((h-hh)*60); return mm > 0 ? `${hh}h ${mm}m` : `${hh}h`; }
function addHrs(d,h) {
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) {
    console.error('ABPS: addHrs() received an invalid date value:', d);
    throw new Error('Invalid date encountered while building the schedule (received: ' + JSON.stringify(d) + '). This usually means a vessel or barge record has a missing or corrupted ETA/date field — check entries with blank or unusual date values.');
  }
  return new Date(dt.getTime() + h * 3600000);
}

function parseDT(raw) {
  if (!raw || !raw.trim()) return null;
  raw = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) { const d = new Date(raw); return isNaN(d) ? null : d; }
  let ap = null;
  const apm = raw.match(/\s*(am|pm)\s*$/i);
  if (apm) { ap = apm[1].toLowerCase(); raw = raw.slice(0, raw.length - apm[0].length).trim(); }
  const tM = raw.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
  let h = 0, m = 0, hasT = false;
  if (tM) {
    h = parseInt(tM[1]); m = parseInt(tM[2]); hasT = true;
    if (ap === 'am') { if (h === 12) h = 0; } else if (ap === 'pm') { if (h !== 12) h += 12; }
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  }
  const ds = (hasT ? raw.replace(/(\d{1,2}):(\d{2})(?::\d{2})?/,'') : raw).trim().replace(/,/g,'');
  let day, mon, yr;
  const d1 = ds.match(/^(\d{1,2})\s+([a-z]{3,9})\s+(\d{4})$/i);
  if (d1) { day = +d1[1]; mon = MMAP[d1[2].toLowerCase().slice(0,3)]; yr = +d1[3]; }
  const d2 = ds.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!d1 && d2) { day = +d2[1]; mon = +d2[2]-1; yr = +d2[3]; }
  const d3 = ds.match(/^(\d{1,2})\s+([a-z]{3,9})$/i);
  if (!d1 && !d2 && d3) { day = +d3[1]; mon = MMAP[d3[2].toLowerCase().slice(0,3)]; yr = new Date().getFullYear(); }
  if (day === undefined) { const n = new Date(); day = n.getDate(); mon = n.getMonth(); yr = n.getFullYear(); }
  if (mon === undefined || mon < 0 || mon > 11) return null;
  const out = new Date(yr, mon, day, h, m, 0, 0);
  return isNaN(out.getTime()) ? null : out;
}

function parseLaycan(raw) {
  if (!raw || !raw.trim()) return null;
  let s = raw.trim().replace(/(\d+)(st|nd|rd|th)/gi,'$1');
  let fromStr, toStr;
  if (/\bto\b/i.test(s)) { const p = s.split(/\s+to\s+/i); if (p.length === 2) { fromStr = p[0].trim(); toStr = p[1].trim(); } }
  if (!fromStr) { const m = s.match(/^(.+?)\s*[-–]\s*(.+)$/); if (m) { fromStr = m[1].trim(); toStr = m[2].trim(); } }
  if (!fromStr || !toStr) return null;

  /* ── Helper: push any date that parsed to exactly midnight forward
     to 23:59 of that same day. This means the laycan TO date is
     always treated as "end of that calendar day", so a vessel with
     ETA on the closing day of the laycan (e.g. 6 Jun 23:00 inside
     a "4–6 Jun" window) is never wrongly marked Delayed. ── */
  function endOfDay(d) {
    if (!d) return d;
    if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) {
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
    }
    return d;
  }

  let fromD, toD;
  const hasMonFrom = /[a-z]/i.test(fromStr), hasMonTo = /[a-z]/i.test(toStr);

  if (!hasMonFrom && hasMonTo) {
    // e.g. "4 – 6 Jun"  →  fromStr="4", toStr="6 Jun"
    toD = endOfDay(parseDT(toStr)); if (!toD) return null;
    const day = parseInt(fromStr, 10); if (isNaN(day)) return null;
    fromD = new Date(toD.getFullYear(), toD.getMonth(), day, 0, 0, 0);
  } else if (hasMonFrom && !hasMonTo) {
    // e.g. "4 Jun – 6"  →  fromStr="4 Jun", toStr="6"
    fromD = parseDT(fromStr); if (!fromD) return null;
    const day = parseInt(toStr, 10); if (isNaN(day)) return null;
    toD = new Date(fromD.getFullYear(), fromD.getMonth(), day, 23, 59, 59);
  } else {
    // e.g. "4 Jun – 6 Jun" or "4 Jun to 6 Jun"
    fromD = parseDT(fromStr); toD = parseDT(toStr);
    if (!fromD || !toD) return null;
    toD = endOfDay(toD);
  }

  if (!fromD || !toD) return null;
  return { from: fromD, to: toD, raw };
}

function fmtLC(lc) {
  if (!lc) return '—';
  const f = lc.from, t = lc.to;
  if (f.getMonth()===t.getMonth()&&f.getFullYear()===t.getFullYear()) return `${f.getDate()} – ${t.getDate()} ${MO[f.getMonth()]} ${f.getFullYear()}`;
  return `${fmtShort(f)} – ${fmtShort(t)} ${t.getFullYear()}`;
}

function calcETC(eta, vq, mq, vtph=300, mtph=100) { return addHrs(eta, _calcParams.hoseHrs + Math.max(vq/vtph, mq/mtph)); }

/* ─── LIVE PREVIEW ─── */
function upd(id) {
  const lcR = document.getElementById(`v${id}-lc`)?.value || '';
  const etR = document.getElementById(`v${id}-eta`)?.value || '';
  const ty  = document.getElementById(`v${id}-type`)?.value;
  const vq  = ty === 'MGO'   ? 0 : parseFloat(document.getElementById(`v${id}-vlsfo`)?.value || 0);
  const mq  = ty === 'VLSFO' ? 0 : parseFloat(document.getElementById(`v${id}-mgo`)?.value   || 0);
  const lcEl = document.getElementById(`v${id}-lc`), etEl = document.getElementById(`v${id}-eta`);
  const hLC = document.getElementById(`v${id}-hlc`), hET = document.getElementById(`v${id}-het`);
  const prev = document.getElementById(`v${id}-prev`), lcbx = document.getElementById(`v${id}-lcbox`);
  const lc = parseLaycan(lcR), eta = parseDT(etR);
  if (lc) { hLC.textContent='→ '+fmtLC(lc); hLC.className='hint ok'; lcEl.classList.remove('err'); }
  else if (lcR) { hLC.textContent='Using Actual ETA for scheduling'; hLC.className='hint inf'; lcEl.classList.remove('err'); }
  else { hLC.textContent=''; hLC.className='hint'; lcEl.classList.remove('err'); }
  if (etR&&!eta) { hET.textContent='Cannot parse — try: 24 Mar 2025 08:00'; hET.className='hint er'; etEl.classList.add('err'); }
  else if (eta) { hET.textContent='→ '+fmt24(eta); hET.className='hint ok'; etEl.classList.remove('err'); }
  else { hET.textContent=''; hET.className='hint'; etEl.classList.remove('err'); }
  if (eta) { const etc=calcETC(eta,vq,mq); prev.className='etc-prev show'; prev.innerHTML=`<strong>ETA:</strong> ${fmt24(eta)} &nbsp;→&nbsp; <strong>ETC:</strong> ${fmt24(etc)} &nbsp;<span style="color:var(--muted)">(${durStr(_calcParams.hoseHrs+Math.max(vq/300,mq/100))} total)</span>`; }
  else { prev.className='etc-prev'; }
  if (lc&&eta) {
    if (eta>=lc.from&&eta<=lc.to) { lcbx.className='lc-box ok show'; lcbx.innerHTML=`ETA is <strong>within laycan</strong> (${fmtLC(lc)}).`; }
    else if (eta>lc.to) { const dh=((eta-lc.to)/3600000).toFixed(1); lcbx.className='lc-box warn show'; lcbx.innerHTML=`ETA is <strong>${dh} hrs after laycan closes</strong> (${fmtLC(lc)}). Vessel slotted after on-laycan supplies.`; }
    else { lcbx.className='lc-box late show'; lcbx.innerHTML=`ETA is <strong>before laycan opens</strong> (${fmtLC(lc)}).`; }
  } else { lcbx.className='lc-box'; }
  // auto-save on change (debounced)
  clearTimeout(upd._t);
  upd._t = setTimeout(saveSharedState, 1200);
}

function tQ(id) {
  const t = document.getElementById(`v${id}-type`)?.value;
  document.getElementById(`v${id}-vw`).style.display = t==='MGO' ? 'none' : '';
  document.getElementById(`v${id}-mw`).style.display = t==='VLSFO' ? 'none' : '';
}

/* ─── UNDO DELETE VESSEL ─── */
let _deletedVesselStack = []; // stack of {def, position}

function rmV(id) {
  const card = document.getElementById(`vessel-${id}`);
  if (!card) return;
  const name     = document.getElementById(`v${id}-name`)?.value || '';
  const area     = document.getElementById(`v${id}-area`)?.value || 'FUJ-A';
  const type     = document.getElementById(`v${id}-type`)?.value || 'VLSFO';
  const qty      = parseFloat(document.getElementById(`v${id}-vlsfo`)?.value) || 0;
  const mgo      = parseFloat(document.getElementById(`v${id}-mgo`)?.value) || 0;
  const spec     = document.getElementById(`v${id}-spec`)?.value || '';
  const agent    = document.getElementById(`v${id}-agent`)?.value || '';
  const manifold = document.getElementById(`v${id}-manifold`)?.value || '';
  const lc       = document.getElementById(`v${id}-lc`)?.value || '';
  const eta      = document.getElementById(`v${id}-eta`)?.value || '';
  const paq      = document.getElementById(`v${id}-paq`)?.value || 'no';
  const bargeId  = document.getElementById(`v${id}-barge`)?.value || '';
  const refuelChk= document.getElementById(`v${id}-refuel-chk`)?.checked || false;
  const rfv      = parseFloat(document.getElementById(`v${id}-rfv`)?.value) || 0;
  const rfm      = parseFloat(document.getElementById(`v${id}-rfm`)?.value) || 0;
  const rfvr     = parseFloat(document.getElementById(`v${id}-rfvr`)?.value) || 750;
  const rfmr     = parseFloat(document.getElementById(`v${id}-rfmr`)?.value) || 275;

  // Move to Trash Bin instead of permanent delete
  const trashEntry = {
    id: id,
    trashedAt: Date.now(),
    def: {name,area,type,qty,mgo,spec,agent,manifold,lc,eta,paq,bargeId,refuelChk,rfv,rfm,rfvr,rfmr}
  };
  _trashBin.push(trashEntry);

  // Vessel removed from Nomination — it should no longer linger in the
  // Supply Checklist or the Remaining Supply Tracker. Drop any checklist
  // record(s) matching this vessel name (Saved Records/history untouched).
  (function _purgeChecklistForRemovedVessel(vesselName) {
    const target = (vesselName || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!target || typeof _checklistRecords !== 'object') return;
    Object.keys(_checklistRecords).forEach(function(uid) {
      const rec = _checklistRecords[uid];
      const recName = (rec && rec.vessel || '').trim().toUpperCase().replace(/\s+/g, ' ');
      if (recName === target) delete _checklistRecords[uid];
    });
  })(name);
  if (typeof _rstSelected !== 'undefined') {
    // Also drop any tick-mark selection tied to the removed vessel's uid(s)
    Array.from(_rstSelected).forEach(function(uid){ if (!_checklistRecords[uid]) _rstSelected.delete(uid); });
  }

  card.style.transition = 'opacity .25s, transform .25s';
  card.style.opacity = '0';
  card.style.transform = 'translateX(20px)';
  setTimeout(() => {
    card.remove();
    renumberVessels();
    saveSharedState();
    renderTrashBin();
    showTrashBanner(name);
    if (typeof renderChecklist === 'function') renderChecklist(_lastSched || []);
    if (typeof renderRemainingSupplyTracker === 'function') renderRemainingSupplyTracker();
  }, 250);
}

// Remove vessel nomination card when supply is saved/completed in checklist
function removeNominationByName(vesselName) {
  if (!vesselName) return;
  const target = vesselName.trim().toUpperCase().replace(/\s+/g, ' ');
  // Find the vessel card matching this name
  var cards = document.querySelectorAll('.vcard[id^="vessel-"]');
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var cid = card.id.replace('vessel-', '');
    var nameEl = document.getElementById('v' + cid + '-name');
    var cardName = nameEl ? (nameEl.value || '').trim().toUpperCase().replace(/\s+/g, ' ') : '';
    if (nameEl && cardName === target) {
      // Remove immediately and synchronously — a delayed/animated removal can
      // leave the card in the DOM if the user clicks "Generate Schedule" before
      // the fade-out timer fires, which then re-reads the stale card and makes
      // the vessel reappear in the Nomination Register / Voyage Schedule.
      card.remove();
      renumberVessels();
      saveSharedState();
      break;
    }
  }
}


// (declared at top level)

function renderTrashBin() {
  const container = document.getElementById('trash-bin-section');
  const list = document.getElementById('trash-bin-list');
  if (!container || !list) return;

  if (_trashBin.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = '';

  list.innerHTML = _trashBin.map((entry, idx) => {
    const d = entry.def;
    const trashedTime = new Date(entry.trashedAt).toLocaleString();
    const fuelLine = d.type === 'BOTH'
      ? `VLSFO ${d.qty} MT + MGO ${d.mgo} MT`
      : d.type === 'MGO' ? `MGO ${d.mgo} MT` : `VLSFO ${d.qty} MT`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--surface);border:none;box-shadow:var(--sh-xs);border-radius:8px;margin-bottom:8px;gap:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:180px">
        <div style="font-size:13px;font-weight:700;color:var(--ink)">${d.name || '(unnamed vessel)'}</div>
        <div style="font-size:11px;color:var(--sub);margin-top:2px">${fuelLine} · ${d.area} · Removed: ${trashedTime}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button onclick="restoreFromTrash(${idx})" style="padding:6px 14px;background:var(--green-lt);border:1.5px solid var(--green-bd);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;color:var(--green);font-family:DM Sans,sans-serif">↩ Restore</button>
        <button onclick="permanentDeleteFromTrash(${idx})" style="padding:6px 12px;background:var(--red-lt);border:1.5px solid var(--red-bd);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;color:var(--red);font-family:DM Sans,sans-serif"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Delete Forever</button>
      </div>
    </div>`;
  }).join('');
}

function restoreFromTrash(idx) {
  const entry = _trashBin[idx];
  if (!entry) return;
  _trashBin.splice(idx, 1);
  addVessel(entry.def);
  renderTrashBin();
  saveSharedState();
}

function permanentDeleteFromTrash(idx) {
  if (!confirm('Permanently delete this vessel? This cannot be undone.')) return;
  _trashBin.splice(idx, 1);
  renderTrashBin();
  saveSharedState();
}

function clearTrashBin() {
  if (!_trashBin.length) return;
  if (!confirm(`Permanently delete all ${_trashBin.length} vessel(s) in the Trash Bin?`)) return;
  _trashBin = [];
  renderTrashBin();
  saveSharedState();
}

function showTrashBanner(name) {
  let banner = document.getElementById('trash-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'trash-banner';
    banner.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;background:var(--ink-solid);color:#fff;border-radius:12px;padding:12px 20px;font-size:13px;font-weight:600;font-family:DM Sans,sans-serif;display:flex;align-items:center;gap:14px;box-shadow:0 8px 32px rgba(13,27,42,.35);transition:opacity .3s,transform .3s;white-space:nowrap';
    document.body.appendChild(banner);
  }
  banner.innerHTML = `<span><strong>${name||'Vessel'}</strong> moved to Trash</span><button onclick="restoreFromTrash(_trashBin.length-1)" style="background:var(--azure);color:#fff;border:none;border-radius:7px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif">Undo</button><button onclick="hideTrashBanner()" style="background:rgba(255,255,255,.12);color:#fff;border:none;border-radius:7px;padding:6px 10px;font-size:12px;cursor:pointer"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
  banner.style.opacity = '1';
  banner.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(showTrashBanner._t);
  showTrashBanner._t = setTimeout(hideTrashBanner, 8000);
}
function hideTrashBanner() {
  const b = document.getElementById('trash-banner');
  if (b) { b.style.opacity='0'; b.style.transform='translateX(-50%) translateY(20px)'; setTimeout(()=>b.remove(),300); }
}

let _undoBannerTimeout = null;
function showUndoBanner(name) {
  let banner = document.getElementById('undo-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'undo-banner';
    banner.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;background:var(--ink-solid);color:#fff;border-radius:12px;padding:12px 20px;font-size:13px;font-weight:600;font-family:DM Sans,sans-serif;display:flex;align-items:center;gap:14px;box-shadow:0 8px 32px rgba(13,27,42,.35);transition:opacity .3s,transform .3s;white-space:nowrap';
    document.body.appendChild(banner);
  }
  banner.innerHTML = `<span><strong>${name||'Vessel'}</strong> removed</span><button onclick="undoLastVesselDelete()" style="background:var(--azure);color:#fff;border:none;border-radius:7px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif">Undo</button><button onclick="hideUndoBanner()" style="background:rgba(255,255,255,.12);color:#fff;border:none;border-radius:7px;padding:6px 10px;font-size:12px;cursor:pointer"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
  banner.style.opacity = '1';
  banner.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(_undoBannerTimeout);
  _undoBannerTimeout = setTimeout(hideUndoBanner, 8000);
}
function hideUndoBanner() {
  const b = document.getElementById('undo-banner');
  if (b) { b.style.opacity='0'; b.style.transform='translateX(-50%) translateY(20px)'; setTimeout(()=>b.remove(),300); }
}
function undoLastVesselDelete() {
  if (!_deletedVesselStack.length) return;
  const {def} = _deletedVesselStack.pop();
  addVessel(def);
  hideUndoBanner();
  saveSharedState();
  // Flash the restored vessel card
  setTimeout(() => {
    const cards = document.querySelectorAll('.vcard[id^="vessel-"]');
    if (cards.length) {
      const last = cards[cards.length-1];
      last.style.background = 'var(--azure-lt)';
      last.style.transition = 'background 1s';
      setTimeout(() => { last.style.background = ''; }, 1500);
    }
  }, 100);
}

function renumberVessels() {
  let n = 1;
  document.querySelectorAll('.vcard[id^="vessel-"]').forEach(function(card) {
    var numEl = card.querySelector('.vnum');
    if (numEl) numEl.textContent = 'VESSEL ' + String(n++).padStart(2,'0');
    var cid = card.id.replace('vessel-',''); if(cid) { var te=document.getElementById('v'+cid+'-type'); if(te) tQ(cid); }
  });
}

// Fix #3: simple convenience wrapper for the "Add Vessel" button. addVessel()
// itself stays generic so restore/seed/undo paths can keep calling it plainly.
function addNewVesselNomination() {
  addVessel({});
}

function addVessel(def = {}) {
  vc++;
  const id = vc;
  // Fix #3: nomUid is the nomination's permanent identity, used ONLY to key
  // the one-time email log (see sendNominationEmailIfNeeded / the
  // "Generate Schedule" trigger in calculate()). It's assigned once, the
  // first time this card is ever created, and carried forward unchanged
  // on every subsequent save/restore — so a vessel keeps the same identity
  // (and therefore never gets duplicate-emailed) across reloads and edits.
  const nomUid = def.nomUid || _newNominationUid();
  const type = def.type || 'VLSFO', qty = def.qty || 0, mgoQ = def.mgo || 0;
  const name = def.name || '', lc = def.lc || '', eta = def.eta || '';
  const area = def.area || 'FUJ-A', spec = def.spec || 'ISO 8217:2010';
  const agent = def.agent || '', manifold = def.manifold || 'VESSEL MANIFOLD', paq = def.paq || 'no';
  const imo = def.imo || '', remarks = def.remarks || '';
  const refuelChk = def.refuelChk || false;
  const rfv = def.rfv || 0, rfm = def.rfm || 0, rfvr = def.rfvr || 750, rfmr = def.rfmr || 275;

  const c = document.createElement('div');
  c.className = 'vcard'; c.id = `vessel-${id}`;
  c.dataset.nomUid = nomUid;
  c.innerHTML = `
  <div class="vcard-hdr">
    <span class="vnum">VESSEL ${String(id).padStart(2,'0')}</span>
    <div style="display:flex;gap:6px;align-items:center">
      <button class="send-email-btn" id="v${id}-send-email-btn" onclick="sendNominationEmailForCard(${id})">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>
        Send Nomination Email
      </button>
      <button class="rm-btn" onclick="rmV(${id})"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Remove</button>
    </div>
  </div>
  <div class="g4 mb10">
    <div class="field"><label>Vessel Name</label><input type="text" id="v${id}-name" value="${name}" oninput="clearTimeout(upd._t);upd._t=setTimeout(saveSharedState,1500)"></div>
    <div class="field"><label>IMO Number <span style="font-weight:400;color:var(--muted)">— optional</span></label><input type="text" id="v${id}-imo" value="${imo}" placeholder="e.g. 9873022" oninput="clearTimeout(upd._t);upd._t=setTimeout(saveSharedState,1500)"></div>
    <div class="field">
      <label>Anchorage / Berth</label>
      <select id="v${id}-area" onchange="saveSharedState()">${areaOptionsHTML(area)}</select>
    </div>
    <div class="field"><label>Fuel Type</label>
      <select id="v${id}-type" onchange="tQ(${id});upd(${id})">
        <option value="VLSFO" ${type==='VLSFO'?'selected':''}>VLSFO</option>
        <option value="MGO"   ${type==='MGO'?'selected':''}>MGO</option>
        <option value="BOTH"  ${type==='BOTH'?'selected':''}>Both</option>
      </select>
    </div>
  </div>
  <div class="g5 mb10">
    <div class="field" id="v${id}-vw">
      <label>VLSFO Qty (MT)</label>
      <input type="number" id="v${id}-vlsfo" value="${qty}" min="0" step="10" oninput="upd(${id})">
    </div>
    <div class="field" id="v${id}-mw" style="display:none">
      <label>MGO Qty (MT)</label>
      <input type="number" id="v${id}-mgo" value="${mgoQ}" min="0" step="10" oninput="upd(${id})">
    </div>
    <div class="field">
      <label>ISO Spec</label>
      <select id="v${id}-spec" onchange="saveSharedState()">
        <option value="ISO 8217:2010" ${spec==='ISO 8217:2010'?'selected':''}>ISO 8217:2010</option>
        <option value="ISO 8217:2017" ${spec==='ISO 8217:2017'?'selected':''}>ISO 8217:2017</option>
      </select>
    </div>
    <div class="field"><label>Agent</label><input type="text" id="v${id}-agent" list="agent-directory-list" placeholder="Type to search agent directory…" value="${agent}" oninput="clearTimeout(upd._t);upd._t=setTimeout(saveSharedState,1500)"></div>
    <div class="field">
      <label>Sampling / Manifold</label>
      <select id="v${id}-manifold" onchange="saveSharedState()">
        <option value="VESSEL MANIFOLD" ${manifold==='VESSEL MANIFOLD'?'selected':''}>Vessel Manifold</option>
        <option value="BARGE MANIFOLD"  ${manifold==='BARGE MANIFOLD'?'selected':''}>Barge Manifold</option>
      </select>
    </div>
  </div>
  <div class="g2 mb10">
    <div class="field">
      <label>PAQ Received <span style="font-weight:400;color:var(--muted)">— Pre-Arrival Questionnaire</span></label>
      <select id="v${id}-paq" onchange="saveSharedState()">
        <option value="yes" ${paq==='yes'?'selected':''}>Yes — Received</option>
        <option value="no"  ${paq==='no'?'selected':''}>No — Not Yet Received</option>
      </select>
    </div>
    <div class="field">
      <label>Assigned Barge <span style="font-weight:400;color:var(--muted)">— optional</span></label>
      <select id="v${id}-barge" onchange="saveSharedState()"><option value="">Auto (any barge)</option></select>
    </div>
  </div>
  <div class="g2 mb10">
    <div class="field">
      <label>Nominated Laycan <span style="font-weight:400;color:var(--muted)">— date range</span></label>
      <div class="input-with-cal">
        <input type="text" id="v${id}-lc" value="${lc}" placeholder="e.g. 22-24 Apr 2026…" oninput="upd(${id})" autocomplete="off" readonly style="cursor:pointer;background:var(--surface)" onclick="openLaycanPicker(${id})">
        <button type="button" class="cal-btn" onclick="openLaycanPicker(${id})"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></button>
      </div>
      <span class="hint" id="v${id}-hlc"></span>
    </div>
    <div class="field">
      <label>Actual ETA <span style="font-weight:400;color:var(--muted)">— date &amp; time</span></label>
      <div class="input-with-cal">
        <input type="text" id="v${id}-eta" value="${eta}" placeholder="Select date &amp; time…" oninput="upd(${id})" autocomplete="off" readonly style="cursor:pointer;background:var(--surface)" onclick="openETAPicker(${id})">
        <button type="button" class="cal-btn" onclick="openETAPicker(${id})">🕐</button>
      </div>
      <span class="hint" id="v${id}-het"></span>
    </div>
  </div>
  <div class="lc-box" id="v${id}-lcbox"></div>
  <div class="etc-prev" id="v${id}-prev"></div>
  <div class="field" style="margin-top:10px">
    <label>Remarks <span style="font-weight:400;color:var(--muted)">— optional, included in nomination emails</span></label>
    <textarea id="v${id}-remarks" rows="2" oninput="clearTimeout(upd._t);upd._t=setTimeout(saveSharedState,1500)" style="width:100%;resize:vertical">${remarks}</textarea>
  </div>
  <div style="margin-top:12px;border-top:1px solid var(--border2);padding-top:12px">
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;font-weight:600;color:var(--sub)">
      <input type="checkbox" id="v${id}-refuel-chk" ${refuelChk?'checked':''} onchange="toggleRefuelPanel(${id})" style="width:15px;height:15px;accent-color:var(--azure);cursor:pointer">
      <span>Schedule Barge Refuelling After This Vessel</span>
      <span style="font-size:10px;font-weight:400;color:var(--muted)">(Suspends next supply until refuel complete)</span>
    </label>
    <div id="v${id}-refuel-panel" style="display:${refuelChk?'block':'none'};margin-top:10px;background:linear-gradient(90deg,var(--teal-lt),var(--surface));border:1.5px solid var(--fuel-m-bd);border-radius:10px;padding:14px 16px">
      <div style="font-size:11px;font-weight:700;color:var(--teal);letter-spacing:.07em;text-transform:uppercase;margin-bottom:10px">Barge Refuelling Slot</div>
      <div class="g4 mb10">
        <div class="field"><label>VLSFO to Load (MT)</label><input type="number" id="v${id}-rfv" value="${rfv}" min="0" step="50" oninput="calcRefuelTime(${id})"></div>
        <div class="field"><label>MGO to Load (MT)</label><input type="number" id="v${id}-rfm" value="${rfm}" min="0" step="50" oninput="calcRefuelTime(${id})"></div>
        <div class="field"><label>VLSFO Load Rate (MT/hr)</label><input type="number" id="v${id}-rfvr" value="${rfvr}" min="1" step="10" oninput="calcRefuelTime(${id})"></div>
        <div class="field"><label>MGO Load Rate (MT/hr)</label><input type="number" id="v${id}-rfmr" value="${rfmr}" min="1" step="10" oninput="calcRefuelTime(${id})"></div>
      </div>
      <div id="v${id}-rfprev" style="font-size:12px;color:var(--teal);background:var(--surface);border-radius:7px;padding:8px 12px;border:1px solid var(--fuel-m-bd);display:none"></div>
    </div>
  </div>
  <!-- CI Generator per vessel -->
  <div style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--border2);display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    <button onclick="ciOpenForVessel(${id})" style="display:flex;align-items:center;gap:7px;padding:8px 16px;background:linear-gradient(135deg,var(--ink-solid),var(--fuel-v));color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif">
      Generate Calling Instructions
    </button>
    <button onclick="emailOpenForVessel(${id})" style="display:flex;align-items:center;gap:6px;padding:8px 15px;background:linear-gradient(135deg,#145E31,var(--fuel-m));color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2" y="4" width="12" height="9" rx="1.5" stroke="#fff" stroke-width="1.4"/><path d="M2 5l6 5 6-5" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg>Generate Email</button>
  </div>`;

  document.getElementById('vc').appendChild(c);
  tQ(id);
  if (lc || eta) upd(id);
  populateBargeDropdowns();
  // Fix #3: if this card is being restored from saved state and its
  // nomination already has emailSent=true in the (already-loaded) local
  // log cache, lock the button immediately so it never flashes as
  // sendable for a moment after reload.
  if (typeof _refreshSendEmailButtonState === 'function') _refreshSendEmailButtonState(id);
  // FT84 FIX (Issue 4): Restore per-vessel manual barge assignment from saved state.
  // populateBargeDropdowns() applies a global preferred-barge fallback which overwrites
  // individual assignments. We must apply def.bargeId AFTER the dropdown is populated.
  if (def.bargeId) {
    const bargeSel = document.getElementById(`v${id}-barge`);
    if (bargeSel && Array.from(bargeSel.options).some(o => String(o.value) === String(def.bargeId))) {
      bargeSel.value = String(def.bargeId);
    }
  }
  renumberVessels();
  // Explicit refresh (in addition to the #vc MutationObserver) so a newly
  // added nomination shows up in the Operational Activity card immediately,
  // even if this card was added before the observer had a chance to attach.
  if (typeof refreshNominationKPIs === 'function') refreshNominationKPIs();
  if (typeof refreshDashboard === 'function') refreshDashboard();
}

function getVessels() {
  const out = [];
  document.querySelectorAll('.vcard[id^="vessel-"]').forEach(c => {
    const id = c.id.replace('vessel-','');
    const name = (document.getElementById(`v${id}-name`)?.value || '').trim().replace(/\s+/g,' ');
    const lcR  = document.getElementById(`v${id}-lc`)?.value   || '';
    const etR  = document.getElementById(`v${id}-eta`)?.value  || '';
    const type = document.getElementById(`v${id}-type`)?.value;
    const vq   = type==='MGO'   ? 0 : parseFloat(document.getElementById(`v${id}-vlsfo`)?.value || 0);
    const mq   = type==='VLSFO' ? 0 : parseFloat(document.getElementById(`v${id}-mgo`)?.value   || 0);
    const spec   = document.getElementById(`v${id}-spec`)?.value     || '';
    const agent  = document.getElementById(`v${id}-agent`)?.value    || '';
    const mani   = document.getElementById(`v${id}-manifold`)?.value || '';
    const area   = document.getElementById(`v${id}-area`)?.value     || '';
    const refuelChk = document.getElementById(`v${id}-refuel-chk`)?.checked || false;
    const rfv  = refuelChk ? (parseFloat(document.getElementById(`v${id}-rfv`)?.value)||0) : 0;
    const rfm  = refuelChk ? (parseFloat(document.getElementById(`v${id}-rfm`)?.value)||0) : 0;
    const rfvr = parseFloat(document.getElementById(`v${id}-rfvr`)?.value)||750;
    const rfmr = parseFloat(document.getElementById(`v${id}-rfmr`)?.value)||275;
    if (!name) return;
    const lc  = lcR ? parseLaycan(lcR) : null;
    const eta = etR ? parseDT(etR)     : null;
    if (etR && !eta) { alert(`"${name}": cannot read Actual ETA "${etR}". Use the calendar picker.`); throw new Error(); }
    if (!eta && !lc) { alert(`"${name}": please enter at least an Actual ETA or Nominated Laycan.`); throw new Error(); }
    const effectiveETA = eta || (lc ? new Date((lc.from.getTime()+lc.to.getTime())/2) : null);
    const isDelayed = !!(lc && eta && eta > lc.to);
    // ETA at exactly 00:00 = no firm ETA — scheduled last, after all firm-ETA vessels
    const noFirmETA = !!(eta && eta.getHours() === 0 && eta.getMinutes() === 0);
    const paq     = document.getElementById(`v${id}-paq`)?.value    || 'no';
    const bargeId = document.getElementById(`v${id}-barge`)?.value  || '';
    const nomUid  = c.dataset.nomUid || '';
    const imo     = document.getElementById(`v${id}-imo`)?.value     || '';
    const remarks = document.getElementById(`v${id}-remarks`)?.value || '';
    out.push({id, name, lc, eta, effectiveETA, vq, mq, type, spec, agent, mani, area, isDelayed, noFirmETA, paq, bargeId,
              refuel: refuelChk && (rfv>0||rfm>0), rfv, rfm, rfvr, rfmr, nomUid, imo, remarks});
  });
  return out;
}

/* ─── CALCULATE ─── */
let _calculating = false; // Guard: prevent concurrent schedule generation (Issue 1 fix)
function calculate() {
  if (_calculating) { console.warn('ABPS: schedule generation already in progress — ignored'); return; }
  _calculating = true;
  try {
  let vessels;
  try { vessels = getVessels(); } catch(e) { _calculating = false; return; }
  if (!vessels.length) { alert('Add at least one vessel.'); _calculating = false; return; }
  const barges = getBarges();
  if (!barges.length) { alert('Add at least one barge.'); _calculating = false; return; }

  // Warn (don't block) on near-duplicate vessel names — likely typos that would otherwise
  // silently create two separate checklist entries for what is probably the same vessel.
  (function warnNearDuplicateVesselNames() {
    function lev(a, b) {
      const m = a.length, n = b.length;
      if (!m) return n; if (!n) return m;
      const d = Array.from({length:m+1}, (_,i) => [i, ...Array(n).fill(0)]);
      for (let j=0;j<=n;j++) d[0][j] = j;
      for (let i=1;i<=m;i++) for (let j=1;j<=n;j++)
        d[i][j] = a[i-1]===b[j-1] ? d[i-1][j-1] : 1+Math.min(d[i-1][j], d[i][j-1], d[i-1][j-1]);
      return d[m][n];
    }
    const seen = [];
    const flagged = [];
    vessels.forEach(v => {
      const nm = (v.name||'').toLowerCase();
      seen.forEach(prev => {
        if (prev === nm) return; // exact duplicate handled elsewhere / is intentional (e.g. two calls)
        const dist = lev(prev, nm);
        if (dist > 0 && dist <= 2 && Math.min(prev.length, nm.length) > 4) {
          flagged.push(prev + '  /  ' + nm);
        }
      });
      seen.push(nm);
    });
    if (flagged.length) {
      const unique = [...new Set(flagged)];
      console.warn('ABPS: possible vessel name typo(s) detected:', unique);
      alert('Heads up — these vessel names look very similar and might be a typo for the same vessel:\n\n' +
            unique.join('\n') +
            '\n\nIf they really are two different vessels, you can ignore this. Otherwise, fix the spelling so they don\'t show up as separate checklist entries.');
    }
  })();

  // Sort: firm-ETA vessels first by ETA, no-firm-ETA (00:00) vessels go to end —
  // and among themselves, ordered by their NOMINATED LAYCAN (not the placeholder
  // ETA date), since a no-firm vessel's ETA field carries no real timing info.
  vessels.sort((a, b) => {
    if (a.noFirmETA && !b.noFirmETA) return 1;
    if (!a.noFirmETA && b.noFirmETA) return -1;
    if (a.noFirmETA && b.noFirmETA) {
      const aKey = (a.lc && a.lc.from) ? a.lc.from.getTime() : a.effectiveETA;
      const bKey = (b.lc && b.lc.from) ? b.lc.from.getTime() : b.effectiveETA;
      return aKey - bKey;
    }
    return a.effectiveETA - b.effectiveETA;
  });
  const onTime = vessels.filter(v => !v.isDelayed);
  const delayed = vessels.filter(v => v.isDelayed);
  const sequence = [];
  let cursor = null;

  for (let i = 0; i < onTime.length; i++) {
    const ov = onTime[i];
    let found = true;
    while (found) {
      found = false;
      for (let d = 0; d < delayed.length; d++) {
        const dv = delayed[d];
        if (dv._placed) continue;
        const dvBargeStart = (cursor && addHrs(cursor,_calcParams.travelHrs) > dv.effectiveETA) ? addHrs(cursor,_calcParams.travelHrs) : dv.effectiveETA;
        const dvETC  = calcETC(dvBargeStart, dv.vq, dv.mq);
        const dvDone = addHrs(dvETC,_calcParams.travelHrs);
        if (dv.effectiveETA <= ov.effectiveETA && dvDone <= ov.effectiveETA) { dv._placed=true; sequence.push(dv); cursor=dvETC; found=true; break; }
      }
    }
    sequence.push(ov);
    const ovStart = (cursor && addHrs(cursor,_calcParams.travelHrs) > ov.effectiveETA) ? addHrs(cursor,_calcParams.travelHrs) : ov.effectiveETA;
    cursor = calcETC(ovStart, ov.vq, ov.mq);
  }
  delayed.filter(dv => !dv._placed).forEach(dv => sequence.push(dv));

  const bargeState = {};
  barges.forEach(b => {
    const openV=b.vrob, openM=b.mrob;
    bargeState[b.id] = { cursor:null, rv:openV, rm:openM, _openingV:openV, _openingM:openM, vcap:b.vcap, mcap:b.mcap, vbuf:b.vbuf, mbuf:b.mbuf, name:b.name };
  });
  cursor = null;
  const sched = [], vAl = [], mAl = [];
  let totV = 0, totM = 0;

  for (let i = 0; i < sequence.length; i++) {
    const v = sequence[i];
    let barge, bs;
    if (v.bargeId && bargeState[v.bargeId]) { barge = barges.find(b => b.id==v.bargeId); bs = bargeState[v.bargeId]; }
    else { barge = barges.reduce((best,b) => bargeState[b.id].rv >= bargeState[best.id].rv ? b : best, barges[0]); bs = bargeState[barge.id]; }
    const VCAP = barge.vcap, MCAP = barge.mcap;
    const earliestBarge = bs.cursor ? addHrs(bs.cursor,_calcParams.travelHrs) : null;
    const bargeStart = earliestBarge && earliestBarge > v.effectiveETA ? earliestBarge : v.effectiveETA;
    const waitedForBarge = !!(earliestBarge && earliestBarge > v.effectiveETA);
    const sv = Math.min(v.vq, bs.rv), sm = Math.min(v.mq, bs.rm);
    // ETC/Duration reflect the time to pump the FULL nominated quantity —
    // not however much ROB happens to be left. Running out of ROB partway
    // through is a real operational fact (flagged separately via isPartial /
    // "Partial supply — insufficient ROB"), but it doesn't shrink the actual
    // pumping time the timeline is meant to show; it just means the barge
    // needs a top-up before or during that window.
    const etc = calcETC(bargeStart, v.vq, v.mq, barge.vtph, barge.mtph);
    let rva = bs.rv-sv, rma = bs.rm-sm;
    const nxt = sequence[i+1];
    const vLow = rva < barge.vbuf || (nxt && nxt.vq > 0 && (rva-nxt.vq) < barge.vbuf);
    const mLow = rma < barge.mbuf || (nxt && nxt.mq > 0 && (rma-nxt.mq) < barge.mbuf);
    if (vLow) vAl.push({after:v.name, rob:Math.round(rva), top:Math.round(VCAP-rva), before:nxt?.name||null, etc, barge:barge.name});
    if (mLow) mAl.push({after:v.name, rob:Math.round(rma), top:Math.round(MCAP-rma), before:nxt?.name||null, etc, barge:barge.name});

    let refuelSlot = null;
    if (v.refuel && (v.rfv > 0 || v.rfm > 0)) {
      const rfStart = addHrs(etc, _calcParams.travelHrs);
      const rfDuration = Math.max(v.rfv / (v.rfvr||750), v.rfm / (v.rfmr||275));
      const rfEnd = addHrs(rfStart, rfDuration);
      rva = Math.min(VCAP, rva + v.rfv);
      rma = Math.min(MCAP, rma + v.rfm);
      refuelSlot = { rfStart, rfEnd, rfDuration, rfv: v.rfv, rfm: v.rfm };
      bs.cursor = addHrs(rfEnd, _calcParams.travelHrs);
      cursor = bs.cursor;
    } else {
      bs.cursor = etc;
      cursor = etc;
    }

    sched.push({sno:i+1, name:v.name, area:v.area, spec:v.spec, agent:v.agent, mani:v.mani, lc:v.lc, eta:v.eta||v.effectiveETA, bargeStart, etc, bargeLabel:barge.name, vQ:Math.round(sv), mQ:Math.round(sm), nomVQ:Math.round(v.vq||0), nomMQ:Math.round(v.mq||0), robVA:Math.round(rva), robMA:Math.round(rma), isPartial:sv<v.vq||sm<v.mq, isDelayed:v.isDelayed, noFirmETA:v.noFirmETA, waitedForBarge, totalHrs:(etc-bargeStart)/3600000, vLow, mLow, paq:v.paq, VCAP, MCAP, refuelSlot});
    bs.rv=rva; bs.rm=rma;
    totV+=sv; totM+=sm;
  }

  _bargeStates = bargeState; _bargeConfig = barges;
  // Compute aggregate last ETC across all barges (latest cursor = overall last completion)
  let _lastETC_agg = null;
  let _closingV_agg = 0, _closingM_agg = 0;
  barges.forEach(function(b) {
    const bs = bargeState[b.id];
    if (bs) {
      _closingV_agg += bs.rv;
      _closingM_agg += bs.rm;
      if (bs.cursor && (!_lastETC_agg || bs.cursor > _lastETC_agg)) _lastETC_agg = bs.cursor;
    }
  });
  _lastETC = _lastETC_agg;
  _closingV = _closingV_agg;
  _closingM = _closingM_agg;
  renderOutput(sched, totV, totM, vAl, mAl, barges, bargeState);
  if(typeof _routerOnScheduleReady==='function') _routerOnScheduleReady();
  // Sync all modules after schedule generation
  setTimeout(refreshAllModules, 100);
  showToast('Schedule generated — ' + vessels.length + ' vessel' + (vessels.length!==1?'s':'') + ' across ' + barges.length + ' barge' + (barges.length!==1?'s':''), 'success');
  } catch(e) {
    console.error('ABPS schedule generation failed:', e);
    alert('Something went wrong generating the schedule: ' + (e && e.message ? e.message : e) + '\n\nPlease try again. If this keeps happening, let support know.');
  } finally {
    _calculating = false; // Always release guard, even if generation threw partway through
  }
}

function renderOutput(sched, totV, totM, vAl, mAl, barges, bargeState) {
  _lastSched = sched;
  // page routing handles visibility
  // page router handles navigation

  const totalOpeningV = Object.values(bargeState).reduce((sum, bs) => sum + bs._openingV, 0);
  const totalOpeningM = Object.values(bargeState).reduce((sum, bs) => sum + bs._openingM, 0);
  const closingV = totalOpeningV - Math.round(totV);
  const closingM = totalOpeningM - Math.round(totM);

  document.getElementById('sum-cards').innerHTML = `
    <div class="scard"><label>VLSFO to be Supplied</label><span>${Math.round(totV).toLocaleString()}</span><small>Metric Tonnes</small></div>
    <div class="scard"><label>MGO to be Supplied</label><span>${Math.round(totM).toLocaleString()}</span><small>Metric Tonnes</small></div>
    <div class="scard"><label>Closing VLSFO ROB</label><span>${closingV.toLocaleString()}</span><small>Opening ${totalOpeningV.toLocaleString()} − To be Supplied ${Math.round(totV).toLocaleString()} MT</small></div>
    <div class="scard"><label>Closing MGO ROB</label><span>${closingM.toLocaleString()}</span><small>Opening ${totalOpeningM.toLocaleString()} − To be Supplied ${Math.round(totM).toLocaleString()} MT</small></div>`;

  renderPAQReminders(sched);
  renderNSCPerBarge(barges, bargeState);
  renderScheduleReminders();
  // Inject new schedule entries into the persistent checklist (never overwrites existing)
  injectChecklistFromSchedule(sched);
  renderChecklist(sched);
  // Update remaining supply tracker immediately after schedule generation
  if(typeof renderRemainingSupplyTracker==="function") renderRemainingSupplyTracker();
  renderSavedRecords();
  renderLiveROBDashboard();
  // Refresh report charts (port by vessel, monthly trend etc) after schedule generate
  if(typeof renderReportCharts==="function") setTimeout(function(){ renderReportCharts(_savedSupplies); }, 100);
  // Persist the new schedule immediately so it survives reload/navigation/other devices
  if (typeof saveSharedState === 'function') { try { saveSharedState(); } catch(e) { console.error('ABPS: saveSharedState after generate failed:', e); } }

  const dlSpan = document.getElementById('per-barge-dl-btns');
  if (dlSpan && barges.length > 1) {
    dlSpan.innerHTML = barges.map(b => `<button class="btn-xl" onclick="downloadExcelForBarge(${b.id})">⬇ ${b.name}</button>`).join('');
  } else if (dlSpan) { dlSpan.innerHTML = ''; }

  // Barge ROB Summary is now rendered by renderLiveROBDashboard via renderBargeROBSummaryFromLive
  // Just show a placeholder until Live ROB is rendered
  const brs = document.getElementById('barge-rob-summary');
  if (brs) { brs.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:10px;text-align:center">Syncing with Live ROB…</div>'; }

  function buildAP(el, alerts, fuel) {
    if (alerts.length) {
      el.className = 'apanel fired';
      let h = `<div class="apt"><div class="apdot"></div>${fuel} Refuel — ${alerts.length} Alert${alerts.length>1?'s':''}</div>`;
      alerts.forEach((a,i) => h += `<div class="arow"><div class="snum">${i+1}</div><div>After <strong>${a.after}</strong> (ETC ${fmt24(a.etc)}) — ROB <strong>${a.rob.toLocaleString()} MT</strong> on <strong>${a.barge||'barge'}</strong>. ${a.before?`Refuel before <strong>${a.before}</strong>.`:'Refuel at earliest.'} Top-up: <strong>~${a.top.toLocaleString()} MT</strong>.</div></div>`);
      el.innerHTML = h;
    } else {
      el.className = 'apanel clear';
      el.innerHTML = `<div class="apt"><div class="apdot"></div>${fuel} Refuel</div><div class="arow">${fuel} ROB sufficient. No refuel required.</div>`;
    }
  }
  buildAP(document.getElementById('ap-v'), vAl, 'VLSFO');
  buildAP(document.getElementById('ap-m'), mAl, 'MGO');
  renderBargeTabsAndTL(sched, barges);
}

function renderBargeTabsAndTL(sched, barges) {
  const tlWrap = document.getElementById('tl'), voyWrap = document.getElementById('voy-barge-tabs');
  const bargeGroups = {};
  barges.forEach(b => { bargeGroups[b.id] = {name:b.name, items:[]}; });

  // Filter: active vessels only for timeline (exclude completed & saved)
  const completedSNOs = new Set(
    _savedSupplies.filter(r => r.supplied).map(r => r.vessel)
  );

  sched.forEach(item => {
    const bid = Object.keys(bargeGroups).find(id => bargeGroups[id].name === item.bargeLabel);
    if (bid) bargeGroups[bid].items.push(item);
    else { const firstKey = Object.keys(bargeGroups)[0]; if (firstKey) bargeGroups[firstKey].items.push(item); }
  });
  const bargeKeys = barges.map(b => b.id);

  if (barges.length > 1) {
    let tabsHtml = '<div class="barge-tl-tabs">';
    bargeKeys.forEach((bid,i) => { tabsHtml += `<button class="barge-tl-tab${i===0?' active':''}" onclick="switchBargeTL('${bid}')">${bargeGroups[bid].name}</button>`; });
    tabsHtml += '</div>';
    bargeKeys.forEach((bid,i) => { tabsHtml += `<div id="tl-${bid}" style="${i>0?'display:none':''}"></div>`; });
    tlWrap.innerHTML = tabsHtml;
    bargeKeys.forEach(bid => buildTL(bargeGroups[bid].items.filter(item => !completedSNOs.has(item.name)), `tl-${bid}`));
  } else {
    tlWrap.innerHTML = '<div id="tl-single"></div>';
    buildTL(sched.filter(item => !completedSNOs.has(item.name)), 'tl-single');
  }

  if (voyWrap) {
    const colHdrs = `<th style="width:36px;text-align:center;padding:8px 6px">
      <label title="Select all / deselect all" style="cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px">
        <input type="checkbox" id="voy-select-all" onchange="toggleAllVoyPrint(this.checked)" style="width:14px;height:14px;accent-color:#93C4F7;cursor:pointer">
        <span style="font-size:8px;color:rgba(255,255,255,.65);letter-spacing:.04em;font-weight:700">PRINT</span>
      </label>
    </th><th>No.</th><th>Vessel</th><th>Anchorage</th><th>FO (MT)</th><th>MGO (MT)</th><th>Spec</th><th>Nominated Laycan</th><th>Actual ETA</th><th>Supply Start</th><th>ETC</th><th>Supply Sequence</th><th>Laycan Status</th><th>PAQ</th><th>Agent</th><th>Barge</th><th>Sampling / Manifold</th>`;

    // Exclude saved/completed vessels — only show pending (unsupplied) in voyage schedule
    const savedVesselNames = new Set(
      Object.values(_checklistRecords || {})
        .filter(function(r){ return r.state === 'saved' || r.state === 'completed'; })
        .map(function(r){ return r.vessel; })
    );
    const filterActive = function(items){
      return items.filter(function(item){ return !savedVesselNames.has(item.name); });
    };

    if (barges.length > 1) {
      let vtHtml = '<div class="barge-tl-tabs">';
      bargeKeys.forEach((bid,i) => { vtHtml += `<button class="barge-tl-tab${i===0?' active':''}" onclick="switchBargeTbl('${bid}')">${bargeGroups[bid].name}</button>`; });
      vtHtml += '</div>';
      bargeKeys.forEach((bid,i) => {
        const activeItems = filterActive(bargeGroups[bid].items);
        vtHtml += `<div id="voy-tab-${bid}" style="${i>0?'display:none':''}">
          <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
            <button onclick="downloadBargePDF('${bid}')" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;background:var(--ink-solid);color:#fff;border:none;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              Download ${bargeGroups[bid].name} PDF
            </button>
          </div>
          <div class="voy-wrap"><table class="voy-tbl"><thead><tr>${colHdrs}</tr></thead><tbody>${buildVoyRows(activeItems)}</tbody></table></div>
        </div>`;
      });
      voyWrap.innerHTML = vtHtml;
    } else {
      const singleBid = bargeKeys[0];
      const bargeName = singleBid ? (bargeGroups[singleBid]?.name || 'Barge') : 'Barge';
      voyWrap.innerHTML = `
        <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
          <button onclick="downloadBargePDF('${singleBid}')" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;background:var(--ink-solid);color:#fff;border:none;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            Download ${bargeName} PDF
          </button>
        </div>
        <div class="voy-wrap"><table class="voy-tbl"><thead><tr>${colHdrs}</tr></thead><tbody>${buildVoyRows(filterActive(sched))}</tbody></table></div>`;
    }
  }
}


function switchBargeTL(bid) {
  // Hide all tl- divs inside #tl
  const tlWrap = document.getElementById('tl');
  if (!tlWrap) return;
  tlWrap.querySelectorAll('[id^="tl-"]').forEach(el => el.style.display='none');
  const tlEl = document.getElementById('tl-'+bid);
  if (tlEl) tlEl.style.display='';
  tlWrap.querySelectorAll('.barge-tl-tab').forEach(function(el) {
    const bname = (_bargeConfig||[]).find(function(b){return b.id==bid;});
    el.classList.toggle('active', el.textContent.trim() === (bname?bname.name:''));
  });
}

function switchBargeTbl(bid) {
  const voyWrap = document.getElementById('voy-barge-tabs');
  if (!voyWrap) return;
  // Only hide voy-tab- divs (not any other elements)
  voyWrap.querySelectorAll('[id^="voy-tab-"]').forEach(el => el.style.display='none');
  const tblEl = document.getElementById('voy-tab-'+bid);
  if (tblEl) tblEl.style.display='';
  voyWrap.querySelectorAll('.barge-tl-tab').forEach(function(el) {
    const bname = (_bargeConfig||[]).find(function(b){return b.id==bid;});
    el.classList.toggle('active', el.textContent.trim() === (bname?bname.name:''));
  });
}

function buildVoyRows(items) {
  if (!items || !items.length) return '<tr><td colspan="17" style="text-align:center;padding:24px;color:var(--muted);font-size:13px">No vessels scheduled. Add vessel nominations and generate the schedule.</td></tr>';
  return items.map((item,idx) => {
    const nomV_ = (item.nomVQ !== undefined && item.nomVQ !== null) ? item.nomVQ : item.vQ;
    const nomM_ = (item.nomMQ !== undefined && item.nomMQ !== null) ? item.nomMQ : item.mQ;
    const fo = nomV_>0?nomV_.toLocaleString():'—', mo = nomM_>0?nomM_.toLocaleString():'—';
    const seq  = classifySeq(item, idx, items);
    const plan = seq.label;
    const lcIn = !!(item.lc&&item.eta&&item.eta>=item.lc.from&&item.eta<=item.lc.to);
    const lcStr = item.lc?`<span class="lc-rng ${lcIn?'in':'out'}">${fmtLC(item.lc)}</span>`:'—';
    const clRec = _checklistRecords ? Object.values(_checklistRecords).find(r => r.vessel === item.name && r.lockedAt) : null;
    const completedBadge = clRec ? '<span class="stag" style="background:var(--green-lt);color:var(--green);border:1px solid var(--green-bd);margin-left:4px">Done</span>' : '';
    const displayNo = idx + 1; // Re-number from 1 after filtering
    const st = (item.noFirmETA
      ? '<span class="stag" style="background:var(--purple-lt);color:var(--purple);border:1px solid var(--purple-bd)">No Firm ETA</span>'
      : item.isDelayed?'<span class="stag st-dl">Delayed</span>':'<span class="stag st-ok">On Laycan</span>') + completedBadge;
    const seqStyle = seq.type === 'arrival'
      ? 'background:var(--green-lt);color:var(--green);border:1px solid var(--green-bd)'
      : 'background:var(--azure-lt);color:var(--azure);border:1px solid var(--azure-bd)';
    const pl = `<span class="stag" style="${seqStyle}">${plan}</span>`;
    const paqT = item.paq==='yes'?'<span class="stag st-ok">Received</span>':'<span class="stag st-dl">Pending</span>';
    const rowBg = item.noFirmETA ? 'background:rgba(240,230,255,.35)' : '';
    const cls = ` style="${rowBg}"`;
    const areaS = areaShort(item.area);
    const etaDisplay = item.noFirmETA
      ? `<span style="color:var(--purple);font-style:italic">${fmt24(item.eta)} <span style="font-size:9px;font-weight:700">(NO FIRM ETA)</span></span>`
      : fmt24(item.eta);
    const chkCell = `<td style="text-align:center;padding:6px 4px"><input type="checkbox" class="voy-print-chk" data-sno="${item.sno}" checked style="width:15px;height:15px;accent-color:var(--azure);cursor:pointer" title="Include in print"></td>`;
    return `<tr${cls}>${chkCell}<td class="sno">${item.sno}</td><td><strong>${item.name}</strong></td><td style="font-size:11px;font-weight:700;font-family:DM Mono,monospace">${areaS}</td><td>${fo}</td><td>${mo}</td><td style="font-size:11px">${item.spec||'—'}</td><td>${lcStr}</td><td>${etaDisplay}</td><td>${fmt24(item.bargeStart)}</td><td>${fmt24(item.etc)}</td><td>${pl}</td><td>${st}</td><td>${paqT}</td><td>${item.agent||'—'}</td><td style="font-size:11px">${item.bargeLabel||'—'}</td><td style="font-size:11px">${item.mani||'—'}</td></tr>`;
  }).join('');
}

function toggleAllVoyPrint(checked) {
  document.querySelectorAll('.voy-print-chk').forEach(chk => { chk.checked = checked; });
}

function toggleRefuelPanel(id) {
  const chk = document.getElementById(`v${id}-refuel-chk`);
  const panel = document.getElementById(`v${id}-refuel-panel`);
  if (panel) panel.style.display = chk.checked ? 'block' : 'none';
  calcRefuelTime(id);
  saveSharedState();
}

function calcRefuelTime(id) {
  const rfv = parseFloat(document.getElementById(`v${id}-rfv`)?.value)||0;
  const rfm = parseFloat(document.getElementById(`v${id}-rfm`)?.value)||0;
  const rfvr = parseFloat(document.getElementById(`v${id}-rfvr`)?.value)||750;
  const rfmr = parseFloat(document.getElementById(`v${id}-rfmr`)?.value)||275;
  const prev = document.getElementById(`v${id}-rfprev`); if (!prev) return;
  if (rfv <= 0 && rfm <= 0) { prev.style.display='none'; return; }
  const rfDuration = Math.max(rfv/(rfvr||750), rfm/(rfmr||275));
  prev.style.display = 'block';
  prev.innerHTML = `Barge refuelling: VLSFO <strong>${rfv.toLocaleString()} MT</strong> + MGO <strong>${rfm.toLocaleString()} MT</strong> — Loading time: <strong>${durStr(rfDuration)}</strong> + 2 hr transit. Next vessel scheduled after refuel completes.`;
}

function buildTL(items, containerId) {
  const tl = document.getElementById(containerId);
  if (!tl) return;
  tl.innerHTML = '';
  if (!items || !items.length) {
    tl.innerHTML = '<div style="background:var(--green-lt);border:1.5px solid var(--green-bd);border-radius:12px;padding:20px;text-align:center;margin-bottom:1rem">' +
      '<div style="margin-bottom:8px;display:flex;justify-content:center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 12 15 17 9"/></svg></div>' +
      '<div style="font-size:14px;font-weight:700;color:var(--green);margin-bottom:4px">All Vessels Completed</div>' +
      '<div style="font-size:12px;color:var(--green)">All vessels in this schedule have been marked as completed and saved. Timeline is clear.</div>' +
      '</div>';
    return;
  }
  items.forEach(item => {
    const vP = Math.min(100, Math.round((item.robVA/item.VCAP)*100));
    const mP = Math.min(100, Math.round((item.robMA/item.MCAP)*100));
    const vC = vP<15?'var(--red)':vP<30?'var(--amber)':'var(--fuel-v)';
    const mC = mP<15?'var(--red)':mP<30?'var(--amber)':'var(--fuel-m)';
    const tlNomV=(item.nomVQ!==undefined&&item.nomVQ!==null)?item.nomVQ:item.vQ, tlNomM=(item.nomMQ!==undefined&&item.nomMQ!==null)?item.nomMQ:item.mQ;
    const qty = [tlNomV>0?`VLSFO ${tlNomV.toLocaleString()} MT`:'', tlNomM>0?`MGO ${tlNomM.toLocaleString()} MT`:''].filter(Boolean).join(' | ')||'—';
    const dc  = (item.vLow||item.mLow)?'var(--red)':item.noFirmETA?'var(--purple)':item.isDelayed?'var(--amber)':'var(--azure)';
    const cc  = (item.vLow&&item.mLow)?'wvm':item.vLow?'wv':item.mLow?'wm':item.isDelayed?'del':'';
    const supB= item.isPartial?`<span class="tb tb-pt">Part Supply</span>`:`<span class="tb tb-ok">Full Supply</span>`;
    const dlB = item.noFirmETA
      ? `<span class="tb" style="background:var(--purple-lt);color:var(--purple);border:1px solid var(--purple-bd)">No Firm ETA</span>`
      : item.isDelayed?`<span class="tb tb-dl">Delayed</span>`:`<span class="tb tb-on">On Laycan</span>`;
    const vB  = item.vLow?`<span class="tb tb-wv">VLSFO Alert</span>`:'';
    const mB  = item.mLow?`<span class="tb tb-wm">MGO Alert</span>`:'';
    const paqB= item.paq==='yes'?`<span class="tb tb-ok">PAQ ✓</span>`:`<span class="tb tb-dl">PAQ Pending</span>`;
    const bgB = item.bargeLabel?`<span class="tb tb-on">${item.bargeLabel}</span>`:'';
    const areaLabel = AREA_OPTIONS.find(o=>o.value===item.area)?.label || item.area || '—';
    const vT  = (item.vLow && item.refuelSlot && item.refuelSlot.rfv>0)?`<div class="cat cat-v"><div class="pdot" style="background:var(--red)"></div>VLSFO ROB LOW — refuelling scheduled</div>`:(item.vLow?`<div class="cat cat-v"><div class="pdot" style="background:var(--red)"></div>VLSFO ROB LOW</div>`:'');
    const mT  = (item.mLow && item.refuelSlot && item.refuelSlot.rfm>0)?`<div class="cat cat-m"><div class="pdot" style="background:var(--amber)"></div>MGO ROB LOW — refuelling scheduled</div>`:(item.mLow?`<div class="cat cat-m"><div class="pdot" style="background:var(--amber)"></div>MGO ROB LOW</div>`:'');
    const pT  = item.isPartial?`<div class="pt-tag">Partial supply — insufficient ROB</div>`:'';
    const dlN = item.noFirmETA
      ? `<div class="dl-note" style="background:var(--purple-lt);border-color:var(--purple-bd);color:var(--purple)">ETA is 00:00 — no firm arrival time confirmed. This vessel is scheduled last, after all firm-ETA vessels. Update ETA when confirmed.</div>`
      : item.isDelayed?`<div class="dl-note">Actual ETA (${fmt24(item.eta)}) is outside nominated laycan (${fmtLC(item.lc)}). Vessel slotted by ETA order.</div>`:'';

    const waitN = item.waitedForBarge?`<div class="travel-notice">Vessel arrived at ${fmt24(item.eta)} but barge was still on previous job. Supply started at ${fmt24(item.bargeStart)} (after previous ETC + 1 hr travel buffer).</div>`:'';
    const travN = (!item.waitedForBarge&&item.sno>1)?`<div class="travel-notice" style="color:var(--green);background:var(--green-lt);border-color:var(--green-bd)">Barge free before vessel ETA. Supply starts on vessel arrival.</div>`:'';
    const rfBlock = item.refuelSlot ? `
      <div style="margin-top:12px;padding:10px 14px;background:linear-gradient(90deg,var(--teal-lt),var(--surface));border:1.5px solid var(--fuel-m-bd);border-radius:8px">
        <div style="font-size:11px;font-weight:700;color:var(--teal);letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">Barge Refuelling Slot</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;font-size:11.5px">
          <div class="tmi"><label>Loading Start</label><span>${fmt24(item.refuelSlot.rfStart)}</span></div>
          <div class="tmi"><label>Loading End</label><span>${fmt24(item.refuelSlot.rfEnd)}</span></div>
          <div class="tmi"><label>VLSFO Loading</label><span>${item.refuelSlot.rfv.toLocaleString()} MT</span></div>
          <div class="tmi"><label>MGO Loading</label><span>${item.refuelSlot.rfm.toLocaleString()} MT</span></div>
        </div>
      </div>` : '';
    const d = document.createElement('div');
    d.className = 'tli';
    d.innerHTML = `<div class="tls"><div class="tld" style="background:${dc}"></div><div class="tll"></div></div>
    <div class="tlc ${cc}">
      <div class="tlch"><div class="tlvn">#${item.sno} — ${item.name}</div><div class="br">${dlB}${supB}${vB}${mB}${paqB}${bgB}</div></div>
      <div class="tlm">
        <div class="tmi"><label>Laycan</label><span>${fmtLC(item.lc)}</span></div>
        <div class="tmi"><label>Actual ETA</label><span>${fmt24(item.eta)}</span></div>
        <div class="tmi"><label>Supply Start</label><span>${fmt24(item.bargeStart)}</span></div>
        <div class="tmi"><label>ETC</label><span>${fmt24(item.etc)}</span></div>
        <div class="tmi"><label>Duration</label><span>${durStr(item.totalHrs)}</span></div>
        <div class="tmi"><label>Quantity</label><span>${qty}</span></div>
      </div>
      <div style="font-size:11px;color:var(--sub);margin-bottom:8px">📍 ${areaLabel}</div>
      <div class="rbs">
        <div class="rbr"><span class="rbl">VLSFO</span><div class="rbt"><div class="rbf" style="width:${vP}%;background:${vC}"></div></div><span class="rbv" style="color:${vC}">${item.robVA.toLocaleString()} MT</span></div>
        <div class="rbr"><span class="rbl">MGO</span><div class="rbt"><div class="rbf" style="width:${mP}%;background:${mC}"></div></div><span class="rbv" style="color:${mC}">${item.robMA.toLocaleString()} MT</span></div>
      </div>
      ${(item.vLow||item.mLow)?`<div class="cat-tags">${vT}${mT}</div>`:''}
      ${pT}${dlN}${waitN}${travN}${rfBlock}
    </div>`;
    tl.appendChild(d);
  });
}

/* ─── NSC UNIFIED MULTI-BARGE CHECKER ─── */
let _nscEtaPicker = null;

function openNscEtaPicker() {
  const inp = document.getElementById('nsc-vessel-eta'); if (!inp) return;
  if (_nscEtaPicker) { _nscEtaPicker.open(); return; }
  _nscEtaPicker = flatpickr(inp, {
    enableTime: true, time_24hr: true, dateFormat: 'j M Y H:i',
    allowInput: false, minuteIncrement: 30, disableMobile: true,
    onReady(_, __, fp) { fp.open(); },
    onChange(dates) {
      if (dates.length === 1) {
        const d = dates[0];
        inp.value = `${pad(d.getDate())} ${MO[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
    }
  });
  _nscEtaPicker.open();
}




/*
  ══════════════════════════════════════════════════════════════════════
  BARGE AVAILABILITY & FEASIBILITY ENGINE — v5 (Complete Rebuild)
  ══════════════════════════════════════════════════════════════════════
  DESIGN PHILOSOPHY — Think like an experienced bunker planner:
    • Find a workable solution first — "NOT FEASIBLE" is a last resort
    • Protect existing commitments at all times
    • Maximise barge utilisation — use every gap
    • Never reject because a future commitment exists if the job fits before it
    • Explore every possible scheduling combination before rejecting

  PHASES (per specification):
    1  Data Collection
    2  Calculate True Free Time (ETC of last op + transit — not just "has ops")
    3  Build Timeline (all gaps between commitments are valid opportunities)
    4  Single Barge Check (any one barge can complete the full supply)
    5  Alternative Barge Check (if primary fails, evaluate entire fleet)
    6  Gap Utilisation (supply fits in any free gap between ops)
    7  Split Supply Engine (sequential / staggered / multi-barge splits)
    8  Berth Occupancy (only one barge alongside; second waits for berth)
    9  Smart Rescheduling (alternative sequences, start times, allocations)
   10  Overlap Tolerance (±2 h flexibility if no commitment is missed)
   11  ROB Protection (committed qty reserved; only free ROB allocated)
   12  Feasibility Decision Tree (all 10 steps before any rejection)
   13  Output Format (Barge Analysis table + Feasibility Summary + Final Decision)
  ══════════════════════════════════════════════════════════════════════
*/

/* ─────────────────────────────────────────────────────────────────────
   HELPER: Build the sorted, future-only timeline for a barge
   ───────────────────────────────────────────────────────────────────── */
function _getBargeTimeline(bargeId, bargeName) {
  var now = new Date();
  var completedVessels = new Set();
  Object.values(_checklistRecords || {}).forEach(function (r) {
    if (r.state === 'completed' || r.state === 'saved') completedVessels.add(r.vessel);
  });
  (_savedSupplies || []).forEach(function (r) { if (r.supplied) completedVessels.add(r.vessel); });

  return (_lastSched || [])
    .filter(function (item) {
      var itemBarge  = (item.bargeLabel || '').trim();
      var targetName = (bargeName || '').trim();
      var singleBarge = (_bargeConfig || []).length === 1;
      var bargeMatch = (itemBarge === targetName) ||
                       (itemBarge === '' && singleBarge) ||
                       (item.bargeId && String(item.bargeId) === String(bargeId));
      if (!bargeMatch) return false;
      var opEtc = item.etc;
      if (!opEtc || opEtc <= now) return false;       // past ops excluded
      if (completedVessels.has(item.name)) return false;
      return true;
    })
    .map(function (item) {
      return {
        vessel: item.name,
        start:  item.bargeStart || item.eta || item.etc,
        etc:    item.etc,
        vQ:     item.vQ || 0,
        mQ:     item.mQ || 0,
        sno:    item.sno
      };
    })
    .sort(function (a, b) { return a.start - b.start; });
}

/* ─────────────────────────────────────────────────────────────────────
   HELPER: Does a proposed job genuinely conflict with a committed op?
   A conflict exists only when there is REAL time overlap that would
   delay the committed op. (Phase 10 — 2h tolerance applied here)
   ───────────────────────────────────────────────────────────────────── */
function _doesJobConflict(jobStart, jobEnd, op, travelHrs, toleranceHrs) {
  var tol = toleranceHrs || 0;
  var opBusyFrom  = addHrs(op.start, -travelHrs);
  var opBusyUntil = addHrs(op.etc,    travelHrs);
  var overlap = jobStart < opBusyUntil && jobEnd > opBusyFrom;
  if (!overlap) return false;
  var overlapHrs = (
    Math.min(jobEnd.getTime(), opBusyUntil.getTime()) -
    Math.max(jobStart.getTime(), opBusyFrom.getTime())
  ) / 3600000;
  return overlapHrs > tol;
}

/* ─────────────────────────────────────────────────────────────────────
   HELPER: Can a job [start, start+jobHrs] complete before nextOpStart?
   ───────────────────────────────────────────────────────────────────── */
function _jobFitsBeforeOp(jobStart, jobHrs, nextOpStart, travelHrs, toleranceHrs) {
  if (!nextOpStart) return true;
  var jobEnd = addHrs(jobStart, jobHrs + travelHrs);
  var margin = (nextOpStart - jobEnd) / 3600000;
  return margin >= -(toleranceHrs || 0);
}

/* ─────────────────────────────────────────────────────────────────────
   HELPER: Enumerate ALL scheduling gaps on a barge timeline (Phase 3)
   ───────────────────────────────────────────────────────────────────── */
function _findAllGaps(ops, freeFrom) {
  var gaps = [];
  var now  = new Date();
  var absEarliest = new Date(Math.max(now.getTime(), freeFrom ? freeFrom.getTime() : now.getTime()));

  if (ops.length === 0) {
    gaps.push({
      type: 'empty', gapStart: absEarliest, gapEnd: null, gapHrs: Infinity,
      prevOp: null, nextOp: null, label: 'Fully available', isNow: true
    });
    return gaps;
  }

  // Gap before first op
  var firstStart = ops[0].start;
  var beforeHrs = (firstStart - absEarliest) / 3600000;
  if (beforeHrs > 0) {
    gaps.push({
      type: 'before_first', gapStart: absEarliest, gapEnd: firstStart, gapHrs: beforeHrs,
      prevOp: null, nextOp: ops[0], label: 'Now until ' + ops[0].vessel, isNow: true
    });
  }

  // Gaps between consecutive ops
  for (var i = 0; i < ops.length - 1; i++) {
    var rawOpen  = addHrs(ops[i].etc, _calcParams.travelHrs);
    var gapOpen  = new Date(Math.max(rawOpen.getTime(), now.getTime()));
    var gapClose = ops[i + 1].start;
    var hrs      = (gapClose - gapOpen) / 3600000;
    if (hrs > 0) {
      gaps.push({
        type: 'between', gapStart: gapOpen, gapEnd: gapClose, gapHrs: hrs,
        prevOp: ops[i], nextOp: ops[i + 1],
        label: 'Between ' + ops[i].vessel + ' and ' + ops[i + 1].vessel
      });
    }
  }

  // Open-ended gap after last op (Phase 6: future commitment ≠ blocker for past slot)
  var afterRaw   = addHrs(ops[ops.length - 1].etc, _calcParams.travelHrs);
  var afterStart = new Date(Math.max(afterRaw.getTime(), now.getTime()));
  gaps.push({
    type: 'after_last', gapStart: afterStart, gapEnd: null, gapHrs: Infinity,
    prevOp: ops[ops.length - 1], nextOp: null,
    label: 'After ' + ops[ops.length - 1].vessel
  });

  return gaps;
}

/* ─────────────────────────────────────────────────────────────────────
   HELPER: Evaluate whether a job fits inside a gap window
   ───────────────────────────────────────────────────────────────────── */
function _evalGapForJob(gap, requestedETA, jobDurationHrs, travelBuffer) {
  var now    = new Date();
  var TOTAL  = jobDurationHrs + travelBuffer;
  var earliest = new Date(Math.max(gap.gapStart.getTime(), now.getTime()));
  var latestStart = null;

  if (gap.gapEnd !== null) {
    latestStart = new Date(gap.gapEnd.getTime() - TOTAL * 3600000);
    if (latestStart < earliest) {
      return { fits: false, requestedOk: false, earliestStart: earliest, latestStart: null, reason: 'Window too short' };
    }
  }

  var effectiveHrs = gap.gapEnd
    ? (gap.gapEnd.getTime() - earliest.getTime()) / 3600000
    : Infinity;

  if (effectiveHrs < TOTAL) {
    return {
      fits: false, requestedOk: false, earliestStart: earliest, latestStart: null,
      reason: 'Window too short (' + effectiveHrs.toFixed(1) + 'h available, ' + TOTAL.toFixed(1) + 'h needed)'
    };
  }

  var requestedOk = false;
  if (requestedETA) {
    requestedOk = requestedETA >= now &&
                  requestedETA >= earliest &&
                  (latestStart === null || requestedETA <= latestStart);
  }

  return { fits: true, requestedOk: requestedOk, earliestStart: earliest, latestStart: latestStart, reason: null };
}

/* ─────────────────────────────────────────────────────────────────────
   HELPER: Find the earliest conflict-free start for a job on a barge
   Used by split-supply engine (Phase 7) and rescheduling (Phase 9)
   ───────────────────────────────────────────────────────────────────── */
function _findEarliestStart(timeline, freeFrom, requestedETA, jobHrs, travelHrs) {
  var now = new Date();
  var TOL = 2; // Phase 10 overlap tolerance

  var candidates = [];
  if (requestedETA) candidates.push(requestedETA);
  candidates.push(freeFrom || now);
  candidates.push(now);
  timeline.forEach(function (op) { candidates.push(addHrs(op.etc, travelHrs)); });
  candidates.sort(function (a, b) { return a - b; });

  for (var ci = 0; ci < candidates.length; ci++) {
    var tryStart = new Date(Math.max(candidates[ci].getTime(), now.getTime(), freeFrom ? freeFrom.getTime() : 0));
    var tryEndTravel = addHrs(tryStart, jobHrs + travelHrs);

    var conflict = timeline.some(function (op) {
      return _doesJobConflict(tryStart, tryEndTravel, op, travelHrs, TOL);
    });

    if (!conflict) {
      var prevOp = null;
      for (var pi = timeline.length - 1; pi >= 0; pi--) {
        if (addHrs(timeline[pi].etc, travelHrs) <= tryStart) {
          prevOp = timeline[pi]; break;
        }
      }
      var lbl = (requestedETA && Math.abs(tryStart - requestedETA) < 300000)
        ? 'On vessel arrival'
        : prevOp
          ? 'After ' + prevOp.vessel + ' ETC ' + fmt24(prevOp.etc)
          : 'At earliest available time';
      return { start: tryStart, etc: addHrs(tryStart, jobHrs), label: lbl, onTime: requestedETA && Math.abs(tryStart - requestedETA) < 300000 };
    }
  }

  // Ultimate fallback: after all ops
  var lastOp  = timeline[timeline.length - 1];
  var afterAll = addHrs(lastOp.etc, travelHrs);
  afterAll = new Date(Math.max(afterAll.getTime(), now.getTime()));
  return { start: afterAll, etc: addHrs(afterAll, jobHrs), label: 'After all ops (' + fmt24(lastOp.etc) + ')', onTime: false };
}

/* ─────────────────────────────────────────────────────────────────────
   PUBLIC ENTRY POINT — wraps with error handling
   ───────────────────────────────────────────────────────────────────── */
function checkNSCUnified() {
  // ── READ-ONLY ENFORCEMENT (Fix #2) ──────────────────────────────────
  // Check Availability is a pure simulation tool and must NEVER write to
  // any persisted ROB storage layer (_manualROB, _savedSupplies baked
  // values, or _bargeConfig opening ROB). Snapshot the three storage
  // layers before running the check and compare after — if anything
  // differs, the check is rolled back immediately and the change is
  // surfaced loudly instead of silently corrupting stored ROB. This is
  // a tripwire against future regressions, not just a one-time fix.
  const _preCheckManualROB    = JSON.stringify(_manualROB || {});
  const _preCheckBargeOpening = JSON.stringify((_bargeConfig || []).map(function(b){ return {id:b.id, vrob:b.vrob, mrob:b.mrob}; }));
  const _preCheckSuppliesLen  = (_savedSupplies || []).length;

  try {
    _checkNSCUnifiedInner();
  } catch (e) {
    console.error('checkNSCUnified error:', e);
    alert('Availability check error: ' + e.message + '\n\nLine: ' + (e.stack || '').split('\n')[1]);
  }

  const _postCheckManualROB    = JSON.stringify(_manualROB || {});
  const _postCheckBargeOpening = JSON.stringify((_bargeConfig || []).map(function(b){ return {id:b.id, vrob:b.vrob, mrob:b.mrob}; }));
  const _postCheckSuppliesLen  = (_savedSupplies || []).length;

  if (_preCheckManualROB !== _postCheckManualROB ||
      _preCheckBargeOpening !== _postCheckBargeOpening ||
      _preCheckSuppliesLen !== _postCheckSuppliesLen) {
    console.error('ABPS INTEGRITY ALERT: Check Availability mutated stored ROB data — this must never happen. Reverting.');
    try { _manualROB = JSON.parse(_preCheckManualROB); } catch(e) {}
    alert('A data-integrity issue was caught and blocked: the availability check tried to modify saved ROB data. No stored values were changed. Please reload and contact support if this keeps happening.');
  }
}

/* ═════════════════════════════════════════════════════════════════════
   MAIN ENGINE — _checkNSCUnifiedInner
   Phase 1 → Phase 13
   ═════════════════════════════════════════════════════════════════════ */
function _checkNSCUnifiedInner() {
  /* ── PHASE 1: Data Collection ── */
  var barges = _bargeConfig, states = _bargeStates;
  if (!barges || !barges.length) {
    barges = []; states = {};
    _barges.forEach(function (b) {
      var vcap = parseFloat(document.getElementById('b' + b.id + '-vcap')?.value) || 0;
      var mcap = parseFloat(document.getElementById('b' + b.id + '-mcap')?.value) || 0;
      var vrob = parseFloat(document.getElementById('b' + b.id + '-vrob')?.value) || 0;
      var mrob = parseFloat(document.getElementById('b' + b.id + '-mrob')?.value) || 0;
      var vbuf = parseFloat(document.getElementById('b' + b.id + '-vbuf')?.value) || 0;
      var mbuf = parseFloat(document.getElementById('b' + b.id + '-mbuf')?.value) || 0;
      var vtph = parseFloat(document.getElementById('b' + b.id + '-vtph')?.value) || 300;
      var mtph = parseFloat(document.getElementById('b' + b.id + '-mtph')?.value) || 100;
      var vrfr = parseFloat(document.getElementById('b' + b.id + '-vrfr')?.value) || 750;
      var mrfr = parseFloat(document.getElementById('b' + b.id + '-mrfr')?.value) || 275;
      var name = (document.getElementById('b' + b.id + '-name')?.value) || ('Barge ' + b.id);
      barges.push({ id: b.id, name: name, vcap: vcap, mcap: mcap, vrob: vrob, mrob: mrob, vbuf: vbuf, mbuf: mbuf, vtph: vtph, mtph: mtph, vrfr: vrfr, mrfr: mrfr });
      states[b.id] = { rv: vrob, rm: mrob, cursor: null };
    });
    if (!barges.length) { alert('Add at least one barge with ROB values to check availability.'); return; }
  }

  var vReq        = parseFloat(document.getElementById('nsc-req-v')?.value) || 0;
  var mReq        = parseFloat(document.getElementById('nsc-req-m')?.value) || 0;
  var vesselName  = (document.getElementById('nsc-vessel-name')?.value || '').trim() || 'Unnamed Vessel';
  var etaRaw      = document.getElementById('nsc-vessel-eta')?.value || '';
  var requestedETA = etaRaw ? parseDT(etaRaw) : null;

  if (etaRaw && !requestedETA) { alert('Cannot parse ETA. Use the calendar picker.'); return; }
  if (!vReq && !mReq) { alert('Enter at least one fuel quantity to check.'); return; }

  if (requestedETA) {
    var nowCheck = new Date();
    var pastHrs  = (nowCheck - requestedETA) / 3600000;
    if (pastHrs > 2) {
      if (!confirm(
        'The selected time (' + fmt24(requestedETA) + ') is ' + pastHrs.toFixed(1) + ' hours in the past.\n\n' +
        'The system will check future availability only — past slots will be excluded.\n\nContinue?'
      )) return;
    }
  }

  var now       = new Date();
  var liveROBs  = getAllLiveROBs();
  var travelHrs = _calcParams.travelHrs;
  var hoseHrs   = _calcParams.hoseHrs;
  var TOL       = 2; // Phase 10: 2-hour overlap tolerance

  /* ══════════════════════════════════════════════════════════════════
     PHASE 2 + 3: Per-barge: calculate true free time & build timeline
     ══════════════════════════════════════════════════════════════════ */
  var bargeResults = barges.map(function (b) {
    var liveData = liveROBs[b.id];
    var bs       = states[b.id] || {};
    var liveRv   = liveData ? liveData.liveV : (bs.rv || 0);
    var liveRm   = liveData ? liveData.liveM : (bs.rm || 0);

    // Build full timeline
    var timeline = _getBargeTimeline(b.id, b.name);

    /* PHASE 2: True Free Time ─────────────────────────────────────────
       Rule: freeFrom = ETC of last op that ACTUALLY BLOCKS the requested
       window + transit. Future ops far away are NOT blockers. (Phase 6) */
    var reqJobHrs = hoseHrs + Math.max(
      vReq > 0 ? vReq / (b.vtph || 300) : 0,
      mReq > 0 ? mReq / (b.mtph || 100) : 0
    );
    var reqStart  = requestedETA || now;
    var reqJobEnd = addHrs(reqStart, reqJobHrs + travelHrs);

    var freeFrom;
    if (timeline.length === 0) {
      freeFrom = now; // Phase 2 Rule 1: no planned ops → free immediately
    } else {
      var blockingOps = timeline.filter(function (op) {
        var opBusyFrom  = addHrs(op.start, -travelHrs);
        var opBusyUntil = addHrs(op.etc,    travelHrs);
        return reqStart < opBusyUntil && reqJobEnd > opBusyFrom;
      });

      if (blockingOps.length === 0) {
        freeFrom = now; // Phase 6: no genuine block → barge available
      } else {
        var lastBlocker = blockingOps.reduce(function (lat, op) { return op.etc > lat.etc ? op : lat; }, blockingOps[0]);
        freeFrom = addHrs(lastBlocker.etc, travelHrs);
      }
    }

    /* PHASE 11: ROB Protection ─────────────────────────────────────────
       Only deduct ops that occur BEFORE the requested supply window.
       Ops after the requested window do NOT consume ROB yet. */
    var opsBeforeReq = requestedETA
      ? timeline.filter(function (op) { return op.start < requestedETA; })
      : (requestedETA === null ? timeline : []);
    var plannedVbeforeReq = opsBeforeReq.reduce(function (s, op) { return s + (op.vQ || 0); }, 0);
    var plannedMbeforeReq = opsBeforeReq.reduce(function (s, op) { return s + (op.mQ || 0); }, 0);

    // Total planned quantities (for the analysis table)
    var totalPlannedV = timeline.reduce(function (s, op) { return s + (op.vQ || 0); }, 0);
    var totalPlannedM = timeline.reduce(function (s, op) { return s + (op.mQ || 0); }, 0);

    var availRv = Math.max(0, liveRv - plannedVbeforeReq);
    var availRm = Math.max(0, liveRm - plannedMbeforeReq);

    // 72h planned snapshot (informational)
    var cut72 = new Date(now.getTime() + 72 * 3600000);
    var planned72V = 0, planned72M = 0;
    timeline.forEach(function (op) {
      if (op.start >= now && op.start <= cut72) { planned72V += op.vQ || 0; planned72M += op.mQ || 0; }
    });

    /* PHASE 11: Free ROB = Current ROB − Committed Qty */
    var freeROBv = Math.max(0, availRv - (vReq > 0 ? vReq : 0));
    var freeROBm = Math.max(0, availRm - (mReq > 0 ? mReq : 0));
    var canV     = availRv >= vReq;
    var canM     = availRm >= mReq;
    var canFull  = (vReq === 0 || canV) && (mReq === 0 || canM);
    var shortV   = Math.max(0, vReq - availRv);
    var shortM   = Math.max(0, mReq - availRm);

    /* PHASE 3: Build gaps and evaluate each one */
    var gaps       = _findAllGaps(timeline, freeFrom);
    var jobHrs     = reqJobHrs;
    var supplyV    = vReq, supplyM = mReq;
    var robAfterV  = availRv - (vReq > 0 ? vReq : 0);
    var robAfterM  = availRm - (mReq > 0 ? mReq : 0);
    var vBelowBuf  = vReq > 0 && robAfterV < (b.vbuf || 0);
    var mBelowBuf  = mReq > 0 && robAfterM < (b.mbuf || 0);

    var gapAnalysis = gaps.map(function (gap) {
      var ev         = _evalGapForJob(gap, requestedETA, jobHrs, travelHrs);
      var startTime  = (requestedETA && ev.requestedOk) ? requestedETA : ev.earliestStart;
      var etcTime    = canFull ? calcETC(startTime, supplyV, supplyM, b.vtph, b.mtph) : addHrs(startTime, jobHrs);
      var cReasons   = [];
      if (vBelowBuf && vReq > 0) cReasons.push('VLSFO ROB after (' + Math.round(robAfterV).toLocaleString() + ' MT) below buffer (' + b.vbuf + ' MT)');
      if (mBelowBuf && mReq > 0) cReasons.push('MGO ROB after (' + Math.round(robAfterM).toLocaleString() + ' MT) below buffer (' + b.mbuf + ' MT)');
      var feasibility = !canFull ? 'no_stock' : !ev.fits ? 'infeasible' : cReasons.length === 0 ? 'feasible' : 'constrained';
      return {
        gap: gap, eval: ev, startTime: startTime, etcTime: etcTime,
        constraintReasons: cReasons, feasibility: feasibility,
        requestedFitsHere: ev.fits && ev.requestedOk && canFull,
        anyFitsHere: ev.fits && canFull
      };
    });

    var requestedGap      = gapAnalysis.find(function (ga) { return ga.requestedFitsHere; }) || null;
    var requestedFeasible = !!requestedGap;
    var feasibleGaps      = gapAnalysis.filter(function (ga) { return ga.anyFitsHere; });
    var nearestGap        = feasibleGaps.length
      ? feasibleGaps.slice().sort(function (a, b) { return a.eval.earliestStart - b.eval.earliestStart; })[0]
      : null;
    var nearestSlot       = nearestGap ? nearestGap.eval.earliestStart : null;

    /* Blocking reasons (only when genuinely blocked) */
    var blockingReasons = [];
    if (!requestedFeasible && requestedETA && canFull) {
      var jobEnd2 = addHrs(requestedETA, jobHrs + travelHrs);
      var directConflicts = timeline.filter(function (op) {
        return _doesJobConflict(requestedETA, jobEnd2, op, travelHrs, 0);
      });
      if (directConflicts.length) {
        directConflicts.forEach(function (op) {
          blockingReasons.push('Conflicts with committed supply: ' + op.vessel +
            ' (' + fmt24(op.start) + ' → ' + fmt24(op.etc) + ')');
        });
      } else if (freeFrom > requestedETA) {
        var blockOp = timeline.filter(function (op) { return addHrs(op.etc, travelHrs) > requestedETA; })
          .sort(function (a, b) { return a.etc - b.etc; })[0];
        blockingReasons.push('Barge free from ' + fmt24(freeFrom) +
          (blockOp ? ' (after ' + blockOp.vessel + ' ETC ' + fmt24(blockOp.etc) + ' + ' + travelHrs + 'h transit)' : ''));
      } else if (!feasibleGaps.length) {
        blockingReasons.push('No scheduling window available (' + jobHrs.toFixed(1) + 'h job + ' + travelHrs + 'h transit needed)');
      } else {
        blockingReasons.push('Requested time does not fit in any available scheduling window');
      }
    }

    /* Phase 4 single-barge determination */
    var canFullySupply    = canFull && feasibleGaps.length > 0;
    var canFullyAtRequest = canFull && requestedFeasible;

    return {
      b, bs, canFull, canV, canM, shortV, shortM,
      liveRv, liveRm,
      totalPlannedV, totalPlannedM,
      plannedV: plannedVbeforeReq, plannedM: plannedMbeforeReq,
      availRv, availRm, freeROBv, freeROBm,
      planned72V, planned72M,
      supplyV, supplyM, robAfterV, robAfterM, vBelowBuf, mBelowBuf,
      jobDurationHrs: jobHrs, freeFrom, timeline,
      gaps, gapAnalysis, requestedFeasible, requestedGap,
      nearestGap, nearestSlot, blockingReasons,
      canFullySupply, canFullyAtRequest,
      stockBlockReason: !canFull
        ? 'Insufficient ROB — ' +
          (!canV && vReq > 0 ? 'VLSFO: ' + Math.round(availRv).toLocaleString() + ' MT available (need ' + vReq.toLocaleString() + ' MT) ' : '') +
          (!canM && mReq > 0 ? 'MGO: ' + Math.round(availRm).toLocaleString() + ' MT available (need ' + mReq.toLocaleString() + ' MT)' : '')
        : null
    };
  });

  /* ══════════════════════════════════════════════════════════════════
     PHASE 12: FEASIBILITY DECISION TREE
     Evaluate in strict order — only reject after ALL steps fail
     ══════════════════════════════════════════════════════════════════ */

  /* Step 1 + 4: Single barge — requested time */
  var feasibleAtRequested    = bargeResults.filter(function (r) { return r.canFull && r.requestedFeasible && r.requestedGap && r.requestedGap.feasibility === 'feasible'; });
  var constrainedAtRequested = bargeResults.filter(function (r) { return r.canFull && r.requestedFeasible && r.requestedGap && r.requestedGap.feasibility === 'constrained'; });
  var anyFeasibleAtRequested = feasibleAtRequested.length + constrainedAtRequested.length > 0;

  /* Step 2+5: Alternative barges — any barge can do it (same logic, all barges checked above) */
  /* (the bargeResults loop already covers all barges — feasibleAtRequested includes best alt) */

  /* Step 3+6: Gap utilisation — any barge has a feasible gap (even if not at requested time) */
  var anyGapFeasible = bargeResults.some(function (r) { return r.canFull && r.nearestGap; });

  /* Step 4 (split supply): evaluate ALL split combinations — Phase 7 */
  var splitResult = null;
  if (!anyFeasibleAtRequested) {
    splitResult = _evaluateSplitSupply(bargeResults, vReq, mReq, requestedETA, travelHrs, hoseHrs, TOL);
  }

  /* Step 8: Delayed start — find nearest overall feasible slot across all barges */
  var delayedOption = null;
  if (!anyFeasibleAtRequested && !splitResult) {
    bargeResults.forEach(function (r) {
      if (r.canFull && r.nearestGap) {
        var delayHrs = requestedETA ? Math.max(0, (r.nearestGap.eval.earliestStart - requestedETA) / 3600000) : 0;
        if (!delayedOption || r.nearestGap.eval.earliestStart < delayedOption.earliest) {
          delayedOption = { barge: r, gap: r.nearestGap, delayHrs: delayHrs, earliest: r.nearestGap.eval.earliestStart };
        }
      }
    });
  }

  /* Overall result categorisation */
  var isFeasibleViaSplit   = !!splitResult;
  var isFeasibleDelayed    = !anyFeasibleAtRequested && !isFeasibleViaSplit && !!delayedOption;
  var overallFeasible      = anyFeasibleAtRequested || isFeasibleViaSplit || isFeasibleDelayed;
  var blockedAtRequested   = bargeResults.filter(function (r) { return r.canFull && !r.requestedFeasible; });

  /* ══════════════════════════════════════════════════════════════════
     PHASE 13: Build HTML Output
     1. Barge Analysis Table
     2. Feasibility Summary Table
     3. Main verdict card (single / split / delayed / not feasible)
     4. Per-barge detailed gap analysis
     5. Final Decision block
     ══════════════════════════════════════════════════════════════════ */
  var html = '';

  /* ── Request context header ── */
  if (requestedETA) {
    var hrsAway = (requestedETA - now) / 3600000;
    var urgBg   = hrsAway < 0 ? 'var(--red-lt)' : hrsAway < 12 ? 'var(--red-lt)' : hrsAway < 30 ? 'var(--amber-lt)' : 'var(--azure-lt)';
    var urgBd   = hrsAway < 0 ? 'var(--red-bd)' : hrsAway < 12 ? 'var(--red-bd)' : hrsAway < 30 ? 'var(--amber-bd)' : 'var(--azure-bd)';
    html += '<div style="background:' + urgBg + ';border:1.5px solid ' + urgBd + ';border-radius:10px;padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
      '<div style="flex:1"><div style="font-size:13px;font-weight:700;color:var(--ink)">' + vesselName + '</div>' +
      '<div style="font-size:12px;color:var(--sub);margin-top:2px">Requested supply time: <strong>' + fmt24(requestedETA) + '</strong> &nbsp;|&nbsp; ' +
      (hrsAway >= 0 ? hrsAway.toFixed(1) + ' hrs from now' : 'Already arrived') + '</div></div></div>';
  }

  /* ── Quantities header ── */
  html += '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">' +
    (vReq > 0 ? '<div style="background:var(--fuel-v-lt);border:1px solid var(--fuel-v-bd);border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700;color:var(--fuel-v)">VLSFO: ' + vReq.toLocaleString() + ' MT</div>' : '') +
    (mReq > 0 ? '<div style="background:var(--fuel-m-lt);border:1px solid var(--fuel-m-bd);border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700;color:var(--fuel-m)">MGO: ' + mReq.toLocaleString() + ' MT</div>' : '') +
    '</div>';

  /* ──────────────────────────────────────────────────────────────────
     PHASE 13 SECTION 1 — BARGE ANALYSIS TABLE
     ────────────────────────────────────────────────────────────────── */
  html += '<div style="margin-bottom:16px">' +
    '<div style="font-size:10px;font-weight:700;color:var(--sub);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">Barge Analysis</div>' +
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11.5px;background:var(--surface);border-radius:10px;overflow:hidden;border:none;box-shadow:var(--sh-sm)">' +
    '<thead><tr style="background:linear-gradient(135deg,var(--ink-solid),var(--navy2))">' +
    ['Barge', 'ROB (V / M)', 'Planned Qty', 'Free ROB', 'Earliest Free', 'Transit', 'Can Fully Supply', 'Split Supply', 'Status'].map(function (h) {
      return '<th style="color:rgba(255,255,255,.82);padding:8px 10px;text-align:left;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap">' + h + '</th>';
    }).join('') + '</tr></thead><tbody>' +
    bargeResults.map(function (r, i) {
      var rowBg    = i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)';
      var statusC  = r.canFull && r.canFullyAtRequest ? 'var(--green)'
                   : r.canFull && r.canFullySupply    ? 'var(--amber)'
                   : r.canFull                         ? 'var(--amber)'
                   : 'var(--red)';
      var statusL  = r.canFull && r.canFullyAtRequest ? 'Available — On Time'
                   : r.canFull && r.canFullySupply    ? 'Available — Delayed'
                   : r.canFull                         ? 'Available — No Gap'
                   : 'Insufficient Stock';
      var splitCap = r.canV || r.canM; // can contribute at least one fuel
      var plannedStr = '';
      if (r.totalPlannedV > 0 && vReq > 0) plannedStr += Math.round(r.totalPlannedV).toLocaleString() + 'MT V';
      if (r.totalPlannedM > 0 && mReq > 0) plannedStr += (plannedStr ? ' / ' : '') + Math.round(r.totalPlannedM).toLocaleString() + 'MT M';
      if (!plannedStr) plannedStr = '—';
      var freeROBstr = '';
      if (vReq > 0) freeROBstr += Math.round(r.availRv).toLocaleString() + 'MT V';
      if (mReq > 0) freeROBstr += (freeROBstr ? ' / ' : '') + Math.round(r.availRm).toLocaleString() + 'MT M';
      return '<tr style="border-bottom:1px solid var(--border2);background:' + rowBg + '">' +
        '<td style="padding:8px 10px;font-weight:700;white-space:nowrap">' + r.b.name + '</td>' +
        '<td style="padding:8px 10px;font-family:\'DM Mono\',monospace;font-size:11px;color:var(--azure)">' + Math.round(r.liveRv).toLocaleString() + ' / ' + Math.round(r.liveRm).toLocaleString() + ' MT</td>' +
        '<td style="padding:8px 10px;font-size:11px;color:' + (r.totalPlannedV > 0 || r.totalPlannedM > 0 ? 'var(--amber)' : 'var(--muted)') + '">' + plannedStr + '</td>' +
        '<td style="padding:8px 10px;font-family:\'DM Mono\',monospace;font-weight:700;font-size:11px;color:' + (r.canFull ? 'var(--green)' : 'var(--red)') + '">' + freeROBstr + '</td>' +
        '<td style="padding:8px 10px;font-size:11px;font-family:\'DM Mono\',monospace;white-space:nowrap">' + fmt24(r.freeFrom) + '</td>' +
        '<td style="padding:8px 10px;font-size:11px;text-align:center">' + travelHrs + 'h</td>' +
        '<td style="padding:8px 10px;text-align:center"><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:' + (r.canFullyAtRequest ? 'var(--green-lt)' : r.canFull ? 'var(--amber-lt)' : 'var(--red-lt)') + ';color:' + (r.canFullyAtRequest ? 'var(--green)' : r.canFull ? 'var(--amber)' : 'var(--red)') + ';border:1px solid ' + (r.canFullyAtRequest ? 'var(--green-bd)' : r.canFull ? 'var(--amber-bd)' : 'var(--red-bd)') + '">' + (r.canFullyAtRequest ? 'YES' : r.canFull ? 'DELAYED' : 'NO') + '</span></td>' +
        '<td style="padding:8px 10px;text-align:center"><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:' + (splitCap ? 'var(--azure-lt)' : 'var(--red-lt)') + ';color:' + (splitCap ? 'var(--azure)' : 'var(--red)') + ';border:1px solid ' + (splitCap ? 'var(--azure-bd)' : 'var(--red-bd)') + '">' + (splitCap ? 'YES' : 'NO') + '</span></td>' +
        '<td style="padding:8px 10px"><span style="font-size:10px;font-weight:700;color:' + statusC + '">' + statusL + '</span></td>' +
        '</tr>';
    }).join('') +
    '</tbody></table></div></div>';

  /* ──────────────────────────────────────────────────────────────────
     PHASE 13 SECTION 2 — FEASIBILITY SUMMARY TABLE
     ────────────────────────────────────────────────────────────────── */
  var checkSingleBarge = feasibleAtRequested.length > 0 || constrainedAtRequested.length > 0;
  var checkAltBarge    = checkSingleBarge && bargeResults.length > 1; // covered in step 1 (all evaluated)
  var checkGapUtil     = anyGapFeasible;
  var checkSplit       = !!splitResult;
  var checkBerth       = checkSplit && splitResult && splitResult.berthOk !== false;
  var checkROB         = bargeResults.some(function (r) { return r.canFull; });
  var checkPlanImpact  = bargeResults.every(function (r) {
    // No committed op is delayed = planned supply impact passes
    return !r.requestedGap || r.requestedGap.constraintReasons.length === 0;
  });

  function _fRow(label, pass, note) {
    var c = pass ? 'var(--green)' : 'var(--red)';
    var bg = pass ? 'var(--green-lt)' : 'var(--red-lt)';
    var bd = pass ? 'var(--green-bd)' : 'var(--red-bd)';
    return '<tr style="border-bottom:1px solid var(--border2)">' +
      '<td style="padding:7px 12px;font-size:12px;color:var(--ink);font-weight:600">' + label + '</td>' +
      '<td style="padding:7px 12px;text-align:center"><span style="font-size:10px;font-weight:700;padding:2px 10px;border-radius:4px;background:' + bg + ';color:' + c + ';border:1px solid ' + bd + '">' + (pass ? 'PASS' : 'FAIL') + '</span></td>' +
      (note ? '<td style="padding:7px 12px;font-size:11px;color:var(--sub)">' + note + '</td>' : '<td></td>') +
      '</tr>';
  }

  html += '<div style="margin-bottom:16px">' +
    '<div style="font-size:10px;font-weight:700;color:var(--sub);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">Feasibility Summary</div>' +
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;background:var(--surface);border-radius:10px;border:none;box-shadow:var(--sh-sm);overflow:hidden">' +
    '<thead><tr style="background:var(--ink-solid)">' +
    '<th style="padding:8px 12px;text-align:left;font-size:9px;font-weight:700;color:rgba(255,255,255,.82);letter-spacing:.07em;text-transform:uppercase">Check</th>' +
    '<th style="padding:8px 12px;text-align:center;font-size:9px;font-weight:700;color:rgba(255,255,255,.82);letter-spacing:.07em;text-transform:uppercase">Result</th>' +
    '<th style="padding:8px 12px;text-align:left;font-size:9px;font-weight:700;color:rgba(255,255,255,.82);letter-spacing:.07em;text-transform:uppercase">Note</th>' +
    '</tr></thead><tbody>' +
    _fRow('Single Barge', checkSingleBarge, checkSingleBarge ? 'At least one barge can supply fully at requested time' : 'No single barge can supply fully at requested time') +
    _fRow('Alternative Barge', checkAltBarge || checkSingleBarge, bargeResults.length > 1 ? 'All barges evaluated' : 'Only one barge in fleet') +
    _fRow('Gap Utilisation', checkGapUtil, checkGapUtil ? 'Feasible window found — may be delayed' : 'No gap fits the job on any barge') +
    _fRow('Split Supply', checkSplit, checkSplit ? (splitResult ? splitResult.summary : 'Split supply option found') : 'No viable split supply combination') +
    _fRow('Berth Constraint', !checkSplit || checkBerth, checkSplit ? 'One barge alongside at a time — sequenced correctly' : 'N/A') +
    _fRow('ROB Constraint', checkROB, checkROB ? 'At least one barge has sufficient stock' : 'ALL barges are short on stock') +
    _fRow('Planned Supply Impact', checkPlanImpact, checkPlanImpact ? 'No committed supplies delayed' : 'Some operations may be constrained — review schedule') +
    '</tbody></table></div></div>';

  /* ──────────────────────────────────────────────────────────────────
     PHASE 13 SECTION 3 — MAIN VERDICT CARD
     ────────────────────────────────────────────────────────────────── */

  /* ─── Case A: FEASIBLE at requested time (single barge) ─── */
  var goodList = feasibleAtRequested.length ? feasibleAtRequested : constrainedAtRequested;

  if (goodList.length) {
    var best    = goodList[0];
    var ga      = best.requestedGap;
    var fColor  = ga.feasibility === 'feasible' ? 'var(--green)' : 'var(--amber)';
    var fBg     = ga.feasibility === 'feasible' ? 'var(--green-lt)' : 'var(--amber-lt)';
    var fBd     = ga.feasibility === 'feasible' ? 'var(--green-bd)' : 'var(--amber-bd)';
    var gapTypeLbl = ga.gap.type === 'between'      ? 'Feasible between scheduled operations'
                   : ga.gap.type === 'before_first' ? 'Feasible before first scheduled operation'
                   : ga.gap.type === 'after_last'   ? 'Feasible after last scheduled operation'
                   : 'Barge fully available';

    html += '<div style="background:' + fBg + ';border:2px solid ' + fBd + ';border-radius:12px;padding:16px 18px;margin-bottom:14px">' +
      '<div style="font-size:14px;font-weight:700;color:' + fColor + ';margin-bottom:12px">✓ Requested Time is Feasible — ' + best.b.name + '</div>' +
      '<div style="margin-bottom:10px;display:inline-flex;align-items:center;gap:8px;background:var(--surface);border:1.5px solid ' + fBd + ';border-radius:7px;padding:6px 12px">' +
      '<span style="font-size:12px;font-weight:700;color:' + fColor + '">' + gapTypeLbl + '</span></div>' +
      (ga.gap.type === 'between' ? '<div style="font-size:11.5px;color:var(--sub);margin-top:5px">Gap window: <strong>' + fmt24(ga.gap.gapStart) + '</strong> → <strong>' + fmt24(ga.gap.gapEnd) + '</strong> (' + ga.gap.gapHrs.toFixed(1) + ' hrs)</div>' : '') +
      (ga.gap.prevOp ? '<div style="font-size:11.5px;color:var(--sub);margin-top:3px">After: <strong>' + ga.gap.prevOp.vessel + '</strong> ETC ' + fmt24(ga.gap.prevOp.etc) + '</div>' : '') +
      (ga.gap.nextOp ? '<div style="font-size:11.5px;color:var(--sub);margin-top:3px">Before: <strong>' + ga.gap.nextOp.vessel + '</strong> ETA ' + fmt24(ga.gap.nextOp.start) + '</div>' : '') +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px;margin-bottom:12px">' +
      '<div class="rob-stat"><div class="rob-stat-label">Supply Start</div><div class="rob-stat-val" style="font-size:11px;color:' + fColor + '">' + fmt24(ga.startTime) + '</div></div>' +
      '<div class="rob-stat"><div class="rob-stat-label">ETC</div><div class="rob-stat-val" style="font-size:11px;color:' + fColor + '">' + fmt24(ga.etcTime) + '</div></div>' +
      '<div class="rob-stat"><div class="rob-stat-label">Duration</div><div class="rob-stat-val" style="font-size:12px">' + durStr(best.jobDurationHrs) + '</div></div>' +
      '<div class="rob-stat"><div class="rob-stat-label">Gap Available</div><div class="rob-stat-val" style="font-size:11px">' + (ga.gap.gapHrs === Infinity ? '∞ Open' : ga.gap.gapHrs.toFixed(1) + ' hrs') + '</div></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:' + (ga.constraintReasons.length ? '12px' : '0') + '">' +
      (vReq > 0 ? '<div style="background:var(--surface);border:1px solid ' + fBd + ';border-radius:7px;padding:8px 12px"><div style="font-size:10px;font-weight:700;color:var(--sub);letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px">VLSFO After Supply</div><div style="font-size:13px;font-weight:700;color:' + (best.vBelowBuf ? 'var(--red)' : 'var(--green)') + '">' + Math.round(best.robAfterV).toLocaleString() + ' MT</div><div style="font-size:10.5px;color:var(--sub)">Buffer: ' + best.b.vbuf.toLocaleString() + ' MT ' + (best.vBelowBuf ? '<span style="color:var(--red);font-weight:700">Below Buffer</span>' : '<span style="color:var(--green)">OK</span>') + '</div></div>' : '') +
      (mReq > 0 ? '<div style="background:var(--surface);border:1px solid ' + fBd + ';border-radius:7px;padding:8px 12px"><div style="font-size:10px;font-weight:700;color:var(--sub);letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px">MGO After Supply</div><div style="font-size:13px;font-weight:700;color:' + (best.mBelowBuf ? 'var(--red)' : 'var(--green)') + '">' + Math.round(best.robAfterM).toLocaleString() + ' MT</div><div style="font-size:10.5px;color:var(--sub)">Buffer: ' + best.b.mbuf.toLocaleString() + ' MT ' + (best.mBelowBuf ? '<span style="color:var(--red);font-weight:700">Below Buffer</span>' : '<span style="color:var(--green)">OK</span>') + '</div></div>' : '') +
      '</div>' +
      (ga.constraintReasons.length ? '<div style="background:var(--surface);border:1.5px solid ' + fBd + ';border-radius:8px;padding:10px 14px;margin-top:10px"><div style="font-size:10px;font-weight:700;color:' + fColor + ';letter-spacing:.07em;text-transform:uppercase;margin-bottom:6px">Operational Constraints</div>' + ga.constraintReasons.map(function (r) { return '<div style="font-size:12px;color:var(--sub);margin-bottom:3px">• ' + r + '</div>'; }).join('') + '</div>' : '') +
      '</div>';

    // Other barges also feasible
    var otherGood = goodList.filter(function (r) { return r.b.id !== best.b.id; });
    if (otherGood.length) {
      html += '<div style="font-size:10px;font-weight:700;color:var(--sub);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">Also feasible at requested time:</div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">' +
        otherGood.map(function (r) {
          var ga2 = r.requestedGap;
          var ac = ga2.feasibility === 'feasible' ? 'var(--green)' : 'var(--amber)';
          var ab = ga2.feasibility === 'feasible' ? 'var(--green-lt)' : 'var(--amber-lt)';
          return '<div style="background:' + ab + ';border:1px solid;border-radius:8px;padding:9px 14px;font-size:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
            '<strong>' + r.b.name + '</strong>' +
            '<span>' + ga2.gap.label + '</span>' +
            '<span>→ ETC: ' + fmt24(ga2.etcTime) + '</span>' +
            '<span style="font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:4px;background:' + ac + ';color:#fff">' + ga2.feasibility.toUpperCase() + '</span>' +
            '</div>';
        }).join('') + '</div>';
    }

    // Show blocked barges
    if (blockedAtRequested.length) {
      html += '<div style="background:var(--surface);border:none;box-shadow:var(--sh-xs);border-radius:10px;padding:10px 14px;margin-bottom:14px">' +
        '<div style="font-size:10px;font-weight:700;color:var(--sub);letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">Other barges — not feasible at requested time:</div>' +
        blockedAtRequested.map(function (r) {
          return '<div style="border-top:1px solid var(--border2);padding:7px 0;font-size:12px">' +
            '<strong style="color:var(--ink)">' + r.b.name + '</strong> — ' +
            '<span style="color:var(--red)">' + (r.blockingReasons[0] || r.stockBlockReason || 'Not available') + '</span>' +
            (r.nearestSlot ? ' &nbsp;→&nbsp; Nearest: <strong style="color:var(--azure)">' + fmt24(r.nearestSlot) + '</strong> (' + r.nearestGap.gap.label + ')' : '') +
            '</div>';
        }).join('') + '</div>';
    }

  /* ─── Case B: SPLIT SUPPLY FEASIBLE ─── */
  } else if (isFeasibleViaSplit && splitResult) {
    html += _buildSplitSupplyCard(splitResult, requestedETA, vReq, mReq, travelHrs, hoseHrs);

  /* ─── Case C: DELAYED — nearest feasible slot ─── */
  } else if (isFeasibleDelayed && delayedOption) {
    var dR  = delayedOption.barge;
    var dGa = delayedOption.gap;
    html += '<div style="background:var(--amber-lt);border:2px solid var(--amber-bd);border-radius:12px;padding:16px 18px;margin-bottom:14px">' +
      '<div style="font-size:14px;font-weight:700;color:var(--amber);margin-bottom:10px">⏳ Delayed Start Feasible — ' + dR.b.name + '</div>' +
      '<div style="font-size:12px;color:var(--sub);margin-bottom:12px">Requested time cannot be met. The earliest feasible slot is shown below. No committed supplies are impacted.</div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px">' +
      '<div class="rob-stat"><div class="rob-stat-label">Earliest Feasible</div><div class="rob-stat-val" style="color:var(--amber)">' + fmt24(dGa.eval.earliestStart) + '</div></div>' +
      '<div class="rob-stat"><div class="rob-stat-label">Delay vs Requested</div><div class="rob-stat-val" style="color:var(--amber)">+' + delayedOption.delayHrs.toFixed(1) + ' hrs</div></div>' +
      '<div class="rob-stat"><div class="rob-stat-label">Gap Window</div><div class="rob-stat-val" style="font-size:11px">' + dGa.gap.label + '</div></div>' +
      '</div>' +
      (dGa.gap.prevOp ? '<div style="font-size:11.5px;color:var(--sub);margin-bottom:3px">After: <strong>' + dGa.gap.prevOp.vessel + '</strong> ETC ' + fmt24(dGa.gap.prevOp.etc) + '</div>' : '') +
      (dGa.gap.nextOp ? '<div style="font-size:11.5px;color:var(--sub)">Before: <strong>' + dGa.gap.nextOp.vessel + '</strong> ETA ' + fmt24(dGa.gap.nextOp.start) + '</div>' : '') +
      '</div>';

    // Show all barges' nearest slots for comparison
    var allNearest = bargeResults.filter(function (r) { return r.canFull && r.nearestGap; })
      .sort(function (a, b) { return a.nearestGap.eval.earliestStart - b.nearestGap.eval.earliestStart; });
    if (allNearest.length > 1) {
      html += '<div style="background:var(--surface);border:none;box-shadow:var(--sh-xs);border-radius:10px;padding:10px 14px;margin-bottom:14px">' +
        '<div style="font-size:10px;font-weight:700;color:var(--sub);letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">All barges — nearest feasible windows:</div>' +
        allNearest.map(function (r) {
          var dh = requestedETA ? Math.max(0, (r.nearestGap.eval.earliestStart - requestedETA) / 3600000) : 0;
          return '<div style="border-top:1px solid var(--border2);padding:7px 0;font-size:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
            '<strong>' + r.b.name + '</strong>' +
            '<span style="color:var(--azure)">' + fmt24(r.nearestGap.eval.earliestStart) + '</span>' +
            (dh > 0.1 ? '<span style="color:var(--amber);font-size:10.5px">+' + dh.toFixed(1) + 'h delay</span>' : '<span style="color:var(--green);font-size:10.5px">On time</span>') +
            '<span style="color:var(--sub);font-size:11px">(' + r.nearestGap.gap.label + ')</span>' +
            '</div>';
        }).join('') + '</div>';
    }

    // Barges with insufficient stock
    bargeResults.filter(function (r) { return !r.canFull; }).forEach(function (r) {
      html += '<div style="background:var(--surface);border:1.5px solid var(--red-bd);border-radius:10px;padding:12px 14px;margin-bottom:10px">' +
        '<div style="font-size:12px;font-weight:700;color:var(--red);margin-bottom:4px">' + r.b.name + ' — Insufficient Stock</div>' +
        '<div style="font-size:12px;color:var(--sub)">' + r.stockBlockReason + '</div>' +
        '</div>';
    });

  /* ─── Case D: TRULY NOT FEASIBLE ─── */
  } else {
    html += '<div style="background:var(--red-lt);border:2px solid var(--red-bd);border-radius:12px;padding:16px 18px;margin-bottom:14px">' +
      '<div style="font-size:14px;font-weight:700;color:var(--red);margin-bottom:8px">✗ Not Feasible — All Options Exhausted</div>' +
      '<div style="font-size:12px;color:var(--red);margin-bottom:14px">' +
      (requestedETA ? fmt24(requestedETA) : 'Requested time') + ' cannot be accommodated on any barge. ' +
      'Every scheduling combination, gap, split supply, and rescheduling option has been tested and failed. ' +
      'See full analysis below.</div>';

    bargeResults.forEach(function (r) {
      if (!r.canFull) {
        html += '<div style="background:var(--surface);border:1.5px solid var(--red-bd);border-radius:10px;padding:12px 14px;margin-bottom:10px">' +
          '<div style="font-size:12px;font-weight:700;color:var(--ink);margin-bottom:6px">' + r.b.name + ' — <span style="color:var(--red)">Stock Insufficient</span></div>' +
          '<div style="font-size:12px;color:var(--sub)">' + r.stockBlockReason + '</div>' +
          '<div style="font-size:11px;color:var(--muted);margin-top:4px">Action required: arrange barge refuelling before this supply.</div></div>';
        return;
      }

      html += '<div style="background:var(--surface);border:1.5px solid var(--red-bd);border-radius:10px;padding:12px 14px;margin-bottom:10px">' +
        '<div style="font-size:12px;font-weight:700;color:var(--ink);margin-bottom:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
        r.b.name + '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:var(--red-lt);color:var(--red);border:1px solid var(--red-bd)">BLOCKED</span></div>';

      html += '<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:700;color:var(--red);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">Why blocked:</div>' +
        (r.blockingReasons || []).map(function (reason) {
          return '<div style="font-size:12px;color:var(--sub);display:flex;gap:8px;margin-bottom:3px"><span style="color:var(--red);font-weight:700;flex-shrink:0">✗</span>' + reason + '</div>';
        }).join('') + '</div>';

      html += '<div style="font-size:10px;font-weight:700;color:var(--sub);letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">Available windows on this barge:</div>';
      r.gapAnalysis.forEach(function (ga) {
        var isNearest = r.nearestGap && ga === r.nearestGap;
        var gBg   = isNearest ? 'var(--green-lt)' : 'var(--bg)';
        var gBd   = isNearest ? 'var(--green-bd)' : 'var(--border)';
        var gColor = isNearest ? 'var(--green)' : 'var(--sub)';
        html += '<div style="background:' + gBg + ';border:1.5px solid ' + gBd + ';border-radius:8px;padding:10px 12px;margin-bottom:6px">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">' +
          (isNearest ? '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:var(--green);color:#fff">★ NEAREST</span>' : '') +
          '<span style="font-size:11px;font-weight:700;color:' + gColor + '">' + ga.gap.label + '</span>' +
          '<span style="font-size:10px;color:var(--muted)">Available: ' + (ga.gap.gapHrs === Infinity ? 'Open-ended' : ga.gap.gapHrs.toFixed(1) + ' hrs') + '</span>' +
          (ga.gap.prevOp ? '<span style="font-size:10px;color:var(--muted)">After ' + ga.gap.prevOp.vessel + ' ETC ' + fmt24(ga.gap.prevOp.etc) + '</span>' : '') +
          (ga.gap.nextOp ? '<span style="font-size:10px;color:var(--muted)">Before ' + ga.gap.nextOp.vessel + ' ETA ' + fmt24(ga.gap.nextOp.start) + '</span>' : '') +
          '</div>';
        if (ga.eval.fits) {
          var delayHrs = requestedETA ? Math.max(0, (ga.eval.earliestStart - requestedETA) / 3600000) : 0;
          var fromNow  = (ga.eval.earliestStart.getTime() - now.getTime()) / 3600000;
          html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px">' +
            '<div class="rob-stat"><div class="rob-stat-label">Earliest Start</div><div class="rob-stat-val" style="font-size:11px;color:' + gColor + '">' + fmt24(ga.eval.earliestStart) + '</div><div class="rob-stat-sub">' + (fromNow <= 0.1 ? 'Now' : fromNow.toFixed(1) + ' hrs from now') + '</div></div>' +
            '<div class="rob-stat"><div class="rob-stat-label">ETC</div><div class="rob-stat-val" style="font-size:11px">' + fmt24(ga.etcTime) + '</div></div>' +
            '<div class="rob-stat"><div class="rob-stat-label">Delay vs Requested</div><div class="rob-stat-val" style="color:' + (delayHrs > 0 ? 'var(--amber)' : 'var(--green)') + '">' + (delayHrs > 0 ? '+' + delayHrs.toFixed(1) + ' hrs' : 'On time') + '</div></div>' +
            '<div class="rob-stat"><div class="rob-stat-label">Status</div><div class="rob-stat-val" style="font-size:10px">' + (ga.constraintReasons.length ? '<span style="color:var(--amber)">Constrained</span>' : '<span style="color:var(--green)">Clear</span>') + '</div></div>' +
            '</div>';
          if (ga.constraintReasons.length) {
            html += '<div style="font-size:11px;color:var(--amber);margin-top:5px">' + ga.constraintReasons[0] + '</div>';
          }
        } else {
          html += '<div style="font-size:11.5px;color:var(--red)">' + ga.eval.reason + '</div>';
        }
        html += '</div>';
      });

      html += '</div>';
    });
    html += '</div>';
  }

  /* ──────────────────────────────────────────────────────────────────
     PHASE 13 SECTION 4 — COMPLETE WINDOW ANALYSIS TABLE
     (all barges, all ROB, nearest slots)
     ────────────────────────────────────────────────────────────────── */
  html += '<div style="margin-top:8px">' +
    '<div style="font-size:10px;font-weight:700;color:var(--sub);letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">' +
    'Complete Window Analysis — All Barges' + (requestedETA ? ' at ' + fmt24(requestedETA) : '') + '</div>' +
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;background:var(--surface);border-radius:10px;overflow:hidden;border:none;box-shadow:var(--sh-sm)">' +
    '<thead><tr style="background:linear-gradient(135deg,var(--ink-solid),var(--navy2))">' +
    ['Barge', 'Live VLSFO', 'Planned Ops', 'Available VLSFO', 'Live MGO', 'Planned MGO', 'Available MGO', 'Stock OK?', 'Requested Slot', 'Nearest Feasible', 'ROB After V', 'ROB After M', 'Verdict'].map(function (h) {
      return '<th style="color:rgba(255,255,255,.8);padding:8px 10px;text-align:left;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap">' + h + '</th>';
    }).join('') + '</tr></thead><tbody>' +
    bargeResults.map(function (r, i) {
      var ga3       = r.requestedGap;
      var nearest3  = r.nearestGap;
      var delayHrs3 = requestedETA && nearest3 ? Math.max(0, (nearest3.eval.earliestStart - requestedETA) / 3600000) : 0;
      var verd      = !r.canFull ? 'No Stock' : r.requestedFeasible ? (ga3 && ga3.feasibility === 'feasible' ? 'Feasible' : 'Constrained') : (nearest3 ? 'Delayed' : 'No Window');
      var vC        = !r.canFull ? 'var(--red)' : r.requestedFeasible ? (ga3 && ga3.feasibility === 'feasible' ? 'var(--green)' : 'var(--amber)') : nearest3 ? 'var(--amber)' : 'var(--red)';
      var vBG       = !r.canFull ? 'var(--red-lt)' : r.requestedFeasible ? (ga3 && ga3.feasibility === 'feasible' ? 'var(--green-lt)' : 'var(--amber-lt)') : nearest3 ? 'var(--amber-lt)' : 'var(--red-lt)';
      var rowBg     = i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)';
      return '<tr style="border-bottom:1px solid var(--border2);background:' + rowBg + '">' +
        '<td style="padding:8px 10px;font-weight:700;white-space:nowrap">' + r.b.name + '</td>' +
        '<td style="padding:8px 10px;font-family:\'DM Mono\',monospace;font-size:11px;color:var(--azure)">' + Math.round(r.liveRv).toLocaleString() + ' MT</td>' +
        '<td style="padding:8px 10px;font-size:11px;color:' + (r.totalPlannedV > 0 ? 'var(--amber)' : 'var(--muted)') + '">' + (r.totalPlannedV > 0 && vReq > 0 ? '−' + Math.round(r.totalPlannedV).toLocaleString() + ' MT' : '—') + '</td>' +
        '<td style="padding:8px 10px;font-family:\'DM Mono\',monospace;font-weight:700;font-size:11px;color:' + (r.canV || vReq === 0 ? 'var(--green)' : 'var(--red)') + '">' + Math.round(r.availRv).toLocaleString() + ' MT</td>' +
        '<td style="padding:8px 10px;font-family:\'DM Mono\',monospace;font-size:11px;color:var(--teal)">' + Math.round(r.liveRm).toLocaleString() + ' MT</td>' +
        '<td style="padding:8px 10px;font-size:11px;color:' + (r.totalPlannedM > 0 ? 'var(--amber)' : 'var(--muted)') + '">' + (r.totalPlannedM > 0 && mReq > 0 ? '−' + Math.round(r.totalPlannedM).toLocaleString() + ' MT' : '—') + '</td>' +
        '<td style="padding:8px 10px;font-family:\'DM Mono\',monospace;font-weight:700;font-size:11px;color:' + (r.canM || mReq === 0 ? 'var(--teal)' : 'var(--red)') + '">' + Math.round(r.availRm).toLocaleString() + ' MT</td>' +
        '<td style="padding:8px 10px;text-align:center"><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:' + (r.canFull ? 'var(--green-lt)' : 'var(--red-lt)') + ';color:' + (r.canFull ? 'var(--green)' : 'var(--red)') + ';border:1px solid ' + (r.canFull ? 'var(--green-bd)' : 'var(--red-bd)') + '">' + (r.canFull ? '✓ Yes' : '✗ No') + '</span></td>' +
        '<td style="padding:8px 10px;text-align:center"><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:' + (r.requestedFeasible ? 'var(--green-lt)' : 'var(--red-lt)') + ';color:' + (r.requestedFeasible ? 'var(--green)' : 'var(--red)') + ';border:1px solid ' + (r.requestedFeasible ? 'var(--green-bd)' : 'var(--red-bd)') + '">' + (r.requestedFeasible ? '✓ Fits' : '✗ Blocked') + '</span></td>' +
        '<td style="padding:8px 10px;font-size:11px;font-family:\'DM Mono\',monospace;white-space:nowrap">' + (nearest3 ? fmt24(nearest3.eval.earliestStart) + (delayHrs3 > 0.1 ? '<br><span style="font-size:9px;color:var(--amber)">+' + delayHrs3.toFixed(1) + 'h delay</span>' : '<br><span style="font-size:9px;color:var(--green)">✓ On time</span>') : '<span style="color:var(--red);font-size:11px">No slot</span>') + '</td>' +
        '<td style="padding:8px 10px;font-weight:700;font-size:11px;color:' + (r.vBelowBuf ? 'var(--red)' : 'var(--green)') + ';font-family:\'DM Mono\',monospace;white-space:nowrap">' + (vReq > 0 ? Math.round(r.robAfterV).toLocaleString() + ' MT' : '—') + '</td>' +
        '<td style="padding:8px 10px;font-weight:700;font-size:11px;color:' + (r.mBelowBuf ? 'var(--red)' : 'var(--teal)') + ';font-family:\'DM Mono\',monospace;white-space:nowrap">' + (mReq > 0 ? Math.round(r.robAfterM).toLocaleString() + ' MT' : '—') + '</td>' +
        '<td style="padding:8px 10px"><span style="font-size:11px;font-weight:700;padding:4px 10px;border-radius:5px;background:' + vBG + ';color:' + vC + ';white-space:nowrap">' + verd + '</span></td>' +
        '</tr>';
    }).join('') +
    '</tbody></table></div></div>';

  /* ──────────────────────────────────────────────────────────────────
     PHASE 13 SECTION 5 — FINAL DECISION BLOCK
     ────────────────────────────────────────────────────────────────── */
  var finalStatus, finalColor, finalBg, finalBd, finalReason, finalPlan;

  if (feasibleAtRequested.length) {
    finalStatus = 'FEASIBLE';
    finalColor  = 'var(--green)'; finalBg = 'var(--green-lt)'; finalBd = 'var(--green-bd)';
    var fb = feasibleAtRequested[0];
    finalReason = fb.b.name + ' can supply fully at the requested time of ' + fmt24(requestedETA) + '. No committed ops are delayed.';
    finalPlan   = fb.b.name + ' — alongside at ' + fmt24(fb.requestedGap.startTime) + ', ETC ' + fmt24(fb.requestedGap.etcTime) + '.' +
      (vReq > 0 ? ' VLSFO: ' + vReq.toLocaleString() + ' MT.' : '') +
      (mReq > 0 ? ' MGO: ' + mReq.toLocaleString() + ' MT.' : '') +
      ' ROB after: ' + (vReq > 0 ? Math.round(fb.robAfterV).toLocaleString() + ' MT VLSFO' : '') + (mReq > 0 && vReq > 0 ? ' / ' : '') + (mReq > 0 ? Math.round(fb.robAfterM).toLocaleString() + ' MT MGO' : '') + '.';
  } else if (constrainedAtRequested.length) {
    finalStatus = 'FEASIBLE WITH CONSTRAINTS';
    finalColor  = 'var(--amber)'; finalBg = 'var(--amber-lt)'; finalBd = 'var(--amber-bd)';
    var fb2 = constrainedAtRequested[0];
    finalReason = fb2.b.name + ' can supply at the requested time with minor constraints (buffer or overlap tolerance applied).';
    finalPlan   = fb2.b.name + ' — alongside at ' + fmt24(fb2.requestedGap.startTime) + ', ETC ' + fmt24(fb2.requestedGap.etcTime) + '. Review buffer levels before confirming.';
  } else if (isFeasibleViaSplit && splitResult) {
    finalStatus = 'SPLIT SUPPLY FEASIBLE';
    finalColor  = 'var(--amber)'; finalBg = 'var(--amber-lt)'; finalBd = 'var(--amber-bd)';
    finalReason = 'No single barge can complete the full supply at the requested time. A coordinated two-barge split supply is feasible.';
    finalPlan   = splitResult.plan || 'See split supply card above for barge allocation and timeline.';
  } else if (isFeasibleDelayed && delayedOption) {
    finalStatus = 'DELAYED START FEASIBLE';
    finalColor  = 'var(--amber)'; finalBg = 'var(--amber-lt)'; finalBd = 'var(--amber-bd)';
    var dBarge = delayedOption.barge;
    finalReason = 'Requested time cannot be met. ' + dBarge.b.name + ' is available ' + delayedOption.delayHrs.toFixed(1) + 'h after the requested time with no impact on committed ops.';
    finalPlan   = dBarge.b.name + ' — earliest alongside: ' + fmt24(delayedOption.earliest) + '. ETC: ' + fmt24(delayedOption.gap.etcTime) + '. Delay: +' + delayedOption.delayHrs.toFixed(1) + 'h.';
  } else {
    finalStatus = 'NOT FEASIBLE';
    finalColor  = 'var(--red)'; finalBg = 'var(--red-lt)'; finalBd = 'var(--red-bd)';
    var stockIssues = bargeResults.filter(function (r) { return !r.canFull; });
    var timingIssues = bargeResults.filter(function (r) { return r.canFull && !r.nearestGap; });
    finalReason = 'All scheduling options have been exhausted. ' +
      (stockIssues.length ? stockIssues.map(function (r) { return r.b.name + ' insufficient stock'; }).join('; ') + '. ' : '') +
      (timingIssues.length ? 'No scheduling window available on remaining barges.' : '');
    finalPlan = 'Actions required: ' +
      (stockIssues.length ? 'Arrange refuelling for ' + stockIssues.map(function (r) { return r.b.name; }).join(', ') + '. ' : '') +
      'Review vessel ETA or negotiate a revised supply window with the vessel operator.';
  }

  html += '<div style="margin-top:16px;background:' + finalBg + ';border:2px solid ' + finalBd + ';border-radius:12px;padding:16px 18px">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px">' +
    '<div style="font-size:10px;font-weight:700;color:' + finalColor + ';letter-spacing:.09em;text-transform:uppercase">Final Decision</div>' +
    (nominationPlan ? '<button onclick="addNominationFromNSC(\'__NSC_CHECK_ID__\')" style="display:flex;align-items:center;gap:6px;padding:7px 14px;background:' + finalColor + ';color:#fff;border:none;border-radius:7px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:\'DM Sans\',sans-serif"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' + (nominationPlan.mode === 'split' ? 'Add ' + nominationPlan.entries.length + ' Nominations for This Plan' : 'Add Nomination for This Plan') + '</button>' : '') +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap">' +
    '<span style="font-size:15px;font-weight:800;color:' + finalColor + ';letter-spacing:.04em">' + finalStatus + '</span>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr;gap:10px">' +
    '<div style="background:var(--surface);border:1px solid ' + finalBd + ';border-radius:8px;padding:10px 14px">' +
    '<div style="font-size:10px;font-weight:700;color:' + finalColor + ';letter-spacing:.07em;text-transform:uppercase;margin-bottom:5px">Reason</div>' +
    '<div style="font-size:12px;color:var(--sub)">' + finalReason + '</div>' +
    '</div>' +
    '<div style="background:var(--surface);border:1px solid ' + finalBd + ';border-radius:8px;padding:10px 14px">' +
    '<div style="font-size:10px;font-weight:700;color:' + finalColor + ';letter-spacing:.07em;text-transform:uppercase;margin-bottom:5px">Recommended Plan</div>' +
    '<div style="font-size:12px;color:var(--ink);font-weight:600">' + finalPlan + '</div>' +
    '</div>' +
    '</div></div>';

  /* ──────────────────────────────────────────────────────────────────
     BUILD NOMINATION PLAN — used by the "Add Nomination" button so the
     vessel can be pushed straight into the Nominations page with the
     correct barge(s) and quantities already worked out by the engine.
     For split supply this becomes multiple nomination entries, one
     per contributing barge, each carrying only that barge's share.
     ────────────────────────────────────────────────────────────────── */
  var nominationPlan = null;
  if (goodList.length) {
    var nb = goodList[0];
    nominationPlan = {
      mode: 'single',
      entries: [{
        bargeId: nb.b.id, bargeName: nb.b.name,
        vQty: vReq, mQty: mReq,
        eta: nb.requestedGap.startTime
      }]
    };
  } else if (isFeasibleViaSplit && splitResult) {
    var sEntries = [];
    if (splitResult.type === 'partial_mgo') {
      sEntries.push({ bargeId: splitResult.vBarge.b.id, bargeName: splitResult.vBarge.b.name, vQty: vReq, mQty: splitResult.vOnlyMgo, eta: splitResult.vStart });
      if (splitResult.remainMgo > 0) sEntries.push({ bargeId: splitResult.mBarge.b.id, bargeName: splitResult.mBarge.b.name, vQty: 0, mQty: splitResult.remainMgo, eta: splitResult.mFreeAt });
    } else if (splitResult.type === 'vlsfo_split') {
      sEntries.push({ bargeId: splitResult.firstR.b.id, bargeName: splitResult.firstR.b.name, vQty: splitResult.firstQty, mQty: 0, eta: splitResult.firstStart });
      sEntries.push({ bargeId: splitResult.secondR.b.id, bargeName: splitResult.secondR.b.name, vQty: splitResult.secondQty, mQty: 0, eta: splitResult.secondStart });
    } else if (splitResult.type === 'mgo_split') {
      sEntries.push({ bargeId: splitResult.firstR.b.id, bargeName: splitResult.firstR.b.name, vQty: 0, mQty: splitResult.firstQty, eta: splitResult.firstStart });
      sEntries.push({ bargeId: splitResult.secondR.b.id, bargeName: splitResult.secondR.b.name, vQty: 0, mQty: splitResult.secondQty, eta: splitResult.secondStart });
    } else { // standard / standard_after_ops — one fuel each
      var fIsV = splitResult.firstFuel === 'VLSFO';
      var sIsV = splitResult.secondFuel === 'VLSFO';
      sEntries.push({ bargeId: splitResult.firstR.b.id, bargeName: splitResult.firstR.b.name, vQty: fIsV ? splitResult.firstQty : 0, mQty: !fIsV ? splitResult.firstQty : 0, eta: splitResult.firstStart });
      sEntries.push({ bargeId: splitResult.secondR.b.id, bargeName: splitResult.secondR.b.name, vQty: sIsV ? splitResult.secondQty : 0, mQty: !sIsV ? splitResult.secondQty : 0, eta: splitResult.secondStart });
    }
    nominationPlan = { mode: 'split', entries: sEntries };
  } else if (isFeasibleDelayed && delayedOption) {
    nominationPlan = {
      mode: 'delayed',
      entries: [{
        bargeId: delayedOption.barge.b.id, bargeName: delayedOption.barge.b.name,
        vQty: vReq, mQty: mReq,
        eta: delayedOption.earliest
      }]
    };
  }

  /* ──────────────────────────────────────────────────────────────────
     PERSIST AS CARD
     ────────────────────────────────────────────────────────────────── */
  var checkId  = 'nsc_' + Date.now();
  html = html.split('__NSC_CHECK_ID__').join(checkId);
  var topStatus = overallFeasible
    ? (anyFeasibleAtRequested
        ? (feasibleAtRequested.length ? 'Feasible' : 'Feasible with Constraints')
        : isFeasibleViaSplit ? 'Split Supply Feasible' : 'Delayed Start Feasible')
    : 'Not Feasible';
  var topColor  = overallFeasible
    ? (feasibleAtRequested.length ? 'var(--green)' : 'var(--amber)')
    : 'var(--red)';

  var card = document.createElement('div');
  card.id = checkId;
  card.style.cssText = 'background:var(--surface);border:none;border-radius:var(--radius);margin-bottom:14px;box-shadow:var(--sh-sm);overflow:hidden;';
  card.innerHTML =
    '<div style="background:linear-gradient(135deg,var(--ink-solid),var(--navy2));padding:12px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
    '<div style="flex:1;min-width:0">' +
    '<div style="font-size:13px;font-weight:700;color:#fff;font-family:DM Sans,sans-serif">' + vesselName + '</div>' +
    '<div style="font-size:11px;color:rgba(255,255,255,.55);margin-top:2px;font-family:\'DM Mono\',monospace">' +
    (requestedETA ? fmt24(requestedETA) : 'No ETA') + ' &nbsp;|&nbsp; ' +
    (vReq > 0 ? 'VLSFO ' + vReq.toLocaleString() + ' MT ' : '') +
    (mReq > 0 ? 'MGO ' + mReq.toLocaleString() + ' MT' : '') +
    ' &nbsp;|&nbsp; Checked: ' + fmt24(new Date()) + '</div></div>' +
    '<span style="font-size:11px;font-weight:700;padding:4px 12px;border-radius:6px;background:' + topColor + ';color:#fff;white-space:nowrap">' + topStatus + '</span>' +
    '<div style="display:flex;gap:6px;flex-shrink:0">' +
    (nominationPlan ? '<button onclick="addNominationFromNSC(\'' + checkId + '\')" style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:var(--green);color:#fff;border:1px solid var(--green);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:\'DM Sans\',sans-serif"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' + (nominationPlan.mode === 'split' ? 'Add ' + nominationPlan.entries.length + ' Nominations' : 'Add Nomination') + '</button>' : '') +
    '<button onclick="deleteNSCCheck(\'' + checkId + '\')" style="padding:6px 10px;background:rgba(255,255,255,.12);color:rgba(255,255,255,.8);border:1px solid rgba(255,255,255,.2);border-radius:6px;font-size:11px;cursor:pointer;font-family:\'DM Sans\',sans-serif">✕ Remove</button>' +
    '</div></div>' +
    '<div style="padding:14px 16px">' + html + '</div>';

  card._nscData = {
    vesselName: vesselName, vesselETA: requestedETA ? requestedETA.toISOString() : null, vReq: vReq, mReq: mReq,
    nominationPlan: nominationPlan ? {
      mode: nominationPlan.mode,
      entries: nominationPlan.entries.map(function (e) {
        return { bargeId: e.bargeId, bargeName: e.bargeName, vQty: e.vQty, mQty: e.mQty, eta: e.eta ? e.eta.toISOString() : null };
      })
    } : null
  };
  _nscCheckData[checkId] = card._nscData;

  var inlineEl = document.getElementById('nsc-unified-result');
  if (inlineEl) {
    inlineEl.innerHTML = html;
    inlineEl.className = 'nsc-result show';
    inlineEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  var list = document.getElementById('nsc-checks-list');
  if (list) {
    list.insertBefore(card, list.firstChild);
    var hdrEl = document.getElementById('nsc-checks-header');
    if (hdrEl) hdrEl.style.display = 'block';
  }
}

/* ═════════════════════════════════════════════════════════════════════
   SPLIT SUPPLY ENGINE — Phase 7
   Tests ALL combinations:
     A. Standard split: Barge A → VLSFO, Barge B → MGO (different fuels)
     B. Partial MGO: Barge A → VLSFO + partial MGO, Barge B → remaining MGO
     C. Single-fuel split: Barge A + Barge B → VLSFO (large qty, both barges)
     D. Single-fuel split: Barge A + Barge B → MGO
     E. After-ops: barge has stock but is temporarily busy
   Returns the best split option or null if none viable.
   ═════════════════════════════════════════════════════════════════════ */
function _evaluateSplitSupply(bargeResults, vReq, mReq, requestedETA, travelHrs, hoseHrs, TOL) {
  var now = new Date();

  /* Pick the earliest available start for a barge doing a given qty/tph */
  function splitTiming(r, qty, tph) {
    var jobHrs  = hoseHrs + qty / (tph || 300);
    var tl      = r.timeline || [];
    if (tl.length === 0) {
      var eta = requestedETA || now;
      return { start: eta, etc: addHrs(eta, jobHrs), label: 'Free on arrival', free: true };
    }
    return _findEarliestStart(tl, r.freeFrom, requestedETA, jobHrs, travelHrs);
  }

  /* ── Case A: Standard split — one barge per fuel ── */
  if (vReq > 0 && mReq > 0) {
    var vBarges = bargeResults.filter(function (r) { return r.availRv >= vReq; });
    var mBarges = bargeResults.filter(function (r) { return r.availRm >= mReq; });

    for (var vi = 0; vi < vBarges.length; vi++) {
      for (var mi = 0; mi < mBarges.length; mi++) {
        if (vBarges[vi].b.id === mBarges[mi].b.id) continue; // must be different barges
        var vT = splitTiming(vBarges[vi], vReq, vBarges[vi].b.vtph || 300);
        var mT = splitTiming(mBarges[mi], mReq, mBarges[mi].b.mtph || 100);
        // Phase 8: Berth occupancy — one barge at a time
        var firstIsV  = vT.start <= mT.start;
        var first     = firstIsV ? vT : mT;
        var firstR    = firstIsV ? vBarges[vi] : mBarges[mi];
        var firstFuel = firstIsV ? 'VLSFO' : 'MGO';
        var firstQty  = firstIsV ? vReq : mReq;
        var firstTph  = firstIsV ? (vBarges[vi].b.vtph || 300) : (mBarges[mi].b.mtph || 100);
        var second    = firstIsV ? mT : vT;
        var secondR   = firstIsV ? mBarges[mi] : vBarges[vi];
        var secondFuel= firstIsV ? 'MGO' : 'VLSFO';
        var secondQty = firstIsV ? mReq : vReq;
        var secondTph = firstIsV ? (mBarges[mi].b.mtph || 100) : (vBarges[vi].b.vtph || 300);

        var firstJobHrs   = hoseHrs + firstQty / firstTph;
        var firstEtc      = addHrs(first.start, firstJobHrs);
        var firstDepart   = addHrs(firstEtc, travelHrs);
        var secondStart   = new Date(Math.max(second.start.getTime(), firstDepart.getTime()));
        var secondJobHrs  = hoseHrs + secondQty / secondTph;
        var secondEtc     = addHrs(secondStart, secondJobHrs);
        var overallEtc    = secondEtc;
        var secondDelayed = secondStart > second.start;

        return {
          type: 'standard',
          vBarge: vBarges[vi], mBarge: mBarges[mi],
          firstR: firstR, secondR: secondR,
          firstFuel: firstFuel, secondFuel: secondFuel,
          firstQty: firstQty, secondQty: secondQty,
          firstTph: firstTph, secondTph: secondTph,
          first: first, second: second,
          firstStart: first.start, firstEtc: firstEtc, firstDepart: firstDepart,
          secondStart: secondStart, secondEtc: secondEtc, overallEtc: overallEtc,
          secondDelayed: secondDelayed,
          secondDelayHrs: secondDelayed ? (secondStart - second.start) / 3600000 : 0,
          berthOk: true,
          summary: firstR.b.name + ' (' + firstFuel + ') + ' + secondR.b.name + ' (' + secondFuel + ')',
          plan: firstR.b.name + ' alongside ' + fmt24(first.start) + '→' + fmt24(firstEtc) + ' (' + firstFuel + ' ' + firstQty.toLocaleString() + ' MT). ' +
                secondR.b.name + ' alongside ' + fmt24(secondStart) + '→' + fmt24(secondEtc) + ' (' + secondFuel + ' ' + secondQty.toLocaleString() + ' MT). Overall ETC: ' + fmt24(overallEtc) + '.'
        };
      }
    }

    /* ── Case B: Partial MGO — one barge does VLSFO + partial MGO, another does remaining MGO ── */
    var vOnlyBarge = bargeResults.find(function (r) { return r.availRv >= vReq; });
    if (vOnlyBarge && vOnlyBarge.availRm > 0 && vOnlyBarge.availRm < mReq) {
      var vOnlyMgo  = vOnlyBarge.availRm;
      var remainMgo = mReq - vOnlyMgo;
      var mRestB    = bargeResults.find(function (r) {
        return r.b.id !== vOnlyBarge.b.id && r.liveRm >= remainMgo;
      });
      if (mRestB) {
        var vJobHrs   = hoseHrs + Math.max(vReq / (vOnlyBarge.b.vtph || 300), vOnlyMgo / (vOnlyBarge.b.mtph || 100));
        var vStart    = requestedETA || now;
        var vEtc      = addHrs(vStart, vJobHrs);
        var mTl       = mRestB.timeline || [];
        var mFreeFrom = mTl.length ? addHrs(mTl[mTl.length - 1].etc, travelHrs) : (requestedETA || now);
        var mJobHrs   = hoseHrs + remainMgo / (mRestB.b.mtph || 100);
        var mFreeAt   = new Date(Math.max(mFreeFrom.getTime(), now.getTime()));
        var mEtc      = addHrs(mFreeAt, mJobHrs);
        return {
          type: 'partial_mgo',
          vBarge: vOnlyBarge, mBarge: mRestB,
          vOnlyMgo: vOnlyMgo, remainMgo: remainMgo,
          vStart: vStart, vEtc: vEtc,
          mFreeAt: mFreeAt, mEtc: mEtc,
          mLastOp: mTl.length ? mTl[mTl.length - 1] : null,
          berthOk: true,
          summary: vOnlyBarge.b.name + ' (VLSFO + partial MGO) + ' + mRestB.b.name + ' (remaining MGO)',
          plan: vOnlyBarge.b.name + ' alongside ' + fmt24(vStart) + ' for ' + vReq.toLocaleString() + ' MT VLSFO + ' + vOnlyMgo.toLocaleString() + ' MT MGO. ' +
                mRestB.b.name + ' follows from ' + fmt24(mFreeAt) + ' for remaining ' + remainMgo.toLocaleString() + ' MT MGO. Overall ETC: ' + fmt24(mEtc) + '.'
        };
      }
    }

    /* ── Fallback: any barge with live stock (after ops complete) ── */
    var anyVb = bargeResults.find(function (r) { return r.liveRv >= vReq; });
    var anyMb = bargeResults.find(function (r) { return r.liveRm >= mReq && (!anyVb || r.b.id !== anyVb.b.id); });
    if (anyVb && anyMb) {
      var avT  = splitTiming(anyVb, vReq, anyVb.b.vtph || 300);
      var amT  = splitTiming(anyMb, mReq, anyMb.b.mtph || 100);
      var aFirst = avT.start <= amT.start ? avT : amT;
      var aFirstR = avT.start <= amT.start ? anyVb : anyMb;
      var aFirstF = avT.start <= amT.start ? 'VLSFO' : 'MGO';
      var aFirstQ = avT.start <= amT.start ? vReq : mReq;
      var aFirstT = avT.start <= amT.start ? (anyVb.b.vtph || 300) : (anyMb.b.mtph || 100);
      var aSecond = avT.start <= amT.start ? amT : avT;
      var aSecondR = avT.start <= amT.start ? anyMb : anyVb;
      var aSecondF = avT.start <= amT.start ? 'MGO' : 'VLSFO';
      var aSecondQ = avT.start <= amT.start ? mReq : vReq;
      var aSecondT = avT.start <= amT.start ? (anyMb.b.mtph || 100) : (anyVb.b.vtph || 300);
      var aFJ   = hoseHrs + aFirstQ / aFirstT;
      var aFE   = addHrs(aFirst.start, aFJ);
      var aFD   = addHrs(aFE, travelHrs);
      var aSS   = new Date(Math.max(aSecond.start.getTime(), aFD.getTime()));
      var aSJ   = hoseHrs + aSecondQ / aSecondT;
      var aSE   = addHrs(aSS, aSJ);
      return {
        type: 'standard_after_ops',
        vBarge: anyVb, mBarge: anyMb,
        firstR: aFirstR, secondR: aSecondR,
        firstFuel: aFirstF, secondFuel: aSecondF,
        firstQty: aFirstQ, secondQty: aSecondQ,
        firstTph: aFirstT, secondTph: aSecondT,
        firstStart: aFirst.start, firstEtc: aFE, firstDepart: aFD,
        secondStart: aSS, secondEtc: aSE, overallEtc: aSE,
        secondDelayed: aSS > aSecond.start,
        secondDelayHrs: aSS > aSecond.start ? (aSS - aSecond.start) / 3600000 : 0,
        berthOk: true,
        summary: aFirstR.b.name + ' (' + aFirstF + ') + ' + aSecondR.b.name + ' (' + aSecondF + ') — after ops complete',
        plan: aFirstR.b.name + ' alongside ' + fmt24(aFirst.start) + '→' + fmt24(aFE) + ' (' + aFirstF + ' ' + aFirstQ.toLocaleString() + ' MT). ' +
              aSecondR.b.name + ' alongside ' + fmt24(aSS) + '→' + fmt24(aSE) + ' (' + aSecondF + ' ' + aSecondQ.toLocaleString() + ' MT). Overall ETC: ' + fmt24(aSE) + '.'
      };
    }
  }

  /* ── Case C: Single-fuel VLSFO split across two barges ── */
  if (vReq > 0) {
    var vCombos = [];
    for (var ai = 0; ai < bargeResults.length; ai++) {
      for (var bi2 = ai + 1; bi2 < bargeResults.length; bi2++) {
        var rA = bargeResults[ai], rB = bargeResults[bi2];
        if (rA.availRv + rB.availRv >= vReq) {
          // Split quantities proportionally by available ROB
          var qA   = Math.min(rA.availRv, vReq);
          var qB   = Math.max(0, vReq - qA);
          if (qB > rB.availRv) { qB = rB.availRv; qA = Math.max(0, vReq - qB); }
          if (qA <= 0 || qB <= 0) continue;
          var tA  = splitTiming(rA, qA, rA.b.vtph || 300);
          var tB  = splitTiming(rB, qB, rB.b.vtph || 300);
          var fst = tA.start <= tB.start ? tA : tB;
          var fstR= tA.start <= tB.start ? rA : rB;
          var snd = tA.start <= tB.start ? tB : tA;
          var sndR= tA.start <= tB.start ? rB : rA;
          var fQ  = tA.start <= tB.start ? qA : qB;
          var sQ  = tA.start <= tB.start ? qB : qA;
          var fT  = fstR.b.vtph || 300;
          var sT  = sndR.b.vtph || 300;
          var fJH = hoseHrs + fQ / fT;
          var fE  = addHrs(fst.start, fJH);
          var fD  = addHrs(fE, travelHrs);
          var sS  = new Date(Math.max(snd.start.getTime(), fD.getTime()));
          var sJH = hoseHrs + sQ / sT;
          var sE  = addHrs(sS, sJH);
          vCombos.push({
            type: 'vlsfo_split',
            firstR: fstR, secondR: sndR,
            firstQty: fQ, secondQty: sQ,
            firstStart: fst.start, firstEtc: fE, firstDepart: fD,
            secondStart: sS, secondEtc: sE, overallEtc: sE,
            secondDelayed: sS > snd.start,
            secondDelayHrs: sS > snd.start ? (sS - snd.start) / 3600000 : 0,
            berthOk: true,
            summary: fstR.b.name + ' + ' + sndR.b.name + ' (VLSFO split ' + Math.round(fQ).toLocaleString() + ' + ' + Math.round(sQ).toLocaleString() + ' MT)',
            plan: fstR.b.name + ' alongside ' + fmt24(fst.start) + '→' + fmt24(fE) + ' (VLSFO ' + Math.round(fQ).toLocaleString() + ' MT). ' +
                  sndR.b.name + ' alongside ' + fmt24(sS) + '→' + fmt24(sE) + ' (VLSFO ' + Math.round(sQ).toLocaleString() + ' MT). Total VLSFO: ' + vReq.toLocaleString() + ' MT. Overall ETC: ' + fmt24(sE) + '.'
          });
        }
      }
    }
    if (vCombos.length) {
      // Return the option with earliest overall ETC
      vCombos.sort(function (a, b) { return a.overallEtc - b.overallEtc; });
      return vCombos[0];
    }
  }

  /* ── Case D: Single-fuel MGO split across two barges ── */
  if (mReq > 0) {
    for (var ai2 = 0; ai2 < bargeResults.length; ai2++) {
      for (var bi3 = ai2 + 1; bi3 < bargeResults.length; bi3++) {
        var rC = bargeResults[ai2], rD = bargeResults[bi3];
        if (rC.availRm + rD.availRm >= mReq) {
          var qC   = Math.min(rC.availRm, mReq);
          var qD   = Math.max(0, mReq - qC);
          if (qD > rD.availRm) { qD = rD.availRm; qC = Math.max(0, mReq - qD); }
          if (qC <= 0 || qD <= 0) continue;
          var tC  = splitTiming(rC, qC, rC.b.mtph || 100);
          var tD  = splitTiming(rD, qD, rD.b.mtph || 100);
          var fst2= tC.start <= tD.start ? tC : tD;
          var fstR2= tC.start <= tD.start ? rC : rD;
          var snd2= tC.start <= tD.start ? tD : tC;
          var sndR2= tC.start <= tD.start ? rD : rC;
          var fQ2  = tC.start <= tD.start ? qC : qD;
          var sQ2  = tC.start <= tD.start ? qD : qC;
          var fT2  = fstR2.b.mtph || 100;
          var sT2  = sndR2.b.mtph || 100;
          var fJH2 = hoseHrs + fQ2 / fT2;
          var fE2  = addHrs(fst2.start, fJH2);
          var fD2  = addHrs(fE2, travelHrs);
          var sS2  = new Date(Math.max(snd2.start.getTime(), fD2.getTime()));
          var sJH2 = hoseHrs + sQ2 / sT2;
          var sE2  = addHrs(sS2, sJH2);
          return {
            type: 'mgo_split',
            firstR: fstR2, secondR: sndR2,
            firstQty: fQ2, secondQty: sQ2,
            firstStart: fst2.start, firstEtc: fE2, firstDepart: fD2,
            secondStart: sS2, secondEtc: sE2, overallEtc: sE2,
            secondDelayed: sS2 > snd2.start,
            secondDelayHrs: sS2 > snd2.start ? (sS2 - snd2.start) / 3600000 : 0,
            berthOk: true,
            summary: fstR2.b.name + ' + ' + sndR2.b.name + ' (MGO split ' + Math.round(fQ2).toLocaleString() + ' + ' + Math.round(sQ2).toLocaleString() + ' MT)',
            plan: fstR2.b.name + ' alongside ' + fmt24(fst2.start) + '→' + fmt24(fE2) + ' (MGO ' + Math.round(fQ2).toLocaleString() + ' MT). ' +
                  sndR2.b.name + ' alongside ' + fmt24(sS2) + '→' + fmt24(sE2) + ' (MGO ' + Math.round(sQ2).toLocaleString() + ' MT). Total MGO: ' + mReq.toLocaleString() + ' MT. Overall ETC: ' + fmt24(sE2) + '.'
          };
        }
      }
    }
  }

  return null; // No viable split found
}

/* ═════════════════════════════════════════════════════════════════════
   SPLIT SUPPLY HTML CARD BUILDER — Phase 7 output
   ═════════════════════════════════════════════════════════════════════ */
function _buildSplitSupplyCard(splitResult, requestedETA, vReq, mReq, travelHrs, hoseHrs) {
  var type = splitResult.type || 'standard';

  /* ── Partial MGO split ── */
  if (type === 'partial_mgo') {
    var vB   = splitResult.vBarge;
    var mB   = splitResult.mBarge;
    var vStart = splitResult.vStart;
    var vEtc   = splitResult.vEtc;
    var mFreeAt= splitResult.mFreeAt;
    var mEtc   = splitResult.mEtc;
    var mLast  = splitResult.mLastOp;
    var vAfterV= Math.max(0, vB.availRv - vReq);
    var vAfterM= Math.max(0, vB.availRm - splitResult.vOnlyMgo);
    var mAfterM= Math.max(0, mB.liveRm  - splitResult.remainMgo);

    return '<div style="background:var(--amber-lt);border:2px solid var(--amber-bd);border-radius:12px;padding:16px 18px;margin-bottom:14px">' +
      '<div style="font-size:14px;font-weight:700;color:var(--amber);margin-bottom:4px">Split Supply — Coordinated Two-Barge Operation</div>' +
      '<div style="font-size:11.5px;color:var(--amber);font-style:italic;margin-bottom:14px">' + vB.b.name + ' supplies VLSFO + partial MGO on arrival. ' + mB.b.name + ' supplies remaining MGO after its planned op completes.</div>' +

      '<div style="font-size:10px;font-weight:700;color:var(--sub);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Phase 1 — On Vessel Arrival</div>' +
      '<div style="background:var(--surface);border:1.5px solid var(--azure-bd);border-radius:10px;padding:13px;margin-bottom:12px">' +
        '<div style="font-size:10px;font-weight:700;color:var(--fuel-v);letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">' + vB.b.name + ' — VLSFO + Partial LSMGO</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:8px">' +
          '<div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:600">VLSFO Supply</div><div style="font-size:14px;font-weight:700;color:var(--fuel-v);font-family:\'DM Mono\',monospace">' + vReq.toLocaleString() + ' MT</div></div>' +
          '<div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:600">MGO Supply (partial)</div><div style="font-size:14px;font-weight:700;color:var(--fuel-m);font-family:\'DM Mono\',monospace">' + (splitResult.vOnlyMgo > 0 ? splitResult.vOnlyMgo.toLocaleString() + ' MT' : '—') + '</div></div>' +
          '<div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:600">Status</div><div style="font-size:11px;font-weight:700;color:var(--green)">✓ Free on arrival</div></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;padding-top:8px;border-top:1px solid var(--border2)">' +
          '<div><div style="font-size:9px;color:var(--muted)">Start</div><div style="font-size:11px;font-weight:700;font-family:\'DM Mono\',monospace">' + fmt24(vStart) + '</div></div>' +
          '<div><div style="font-size:9px;color:var(--muted)">ETC</div><div style="font-size:11px;font-weight:700;font-family:\'DM Mono\',monospace">' + fmt24(vEtc) + '</div></div>' +
          '<div><div style="font-size:9px;color:var(--muted)">ROB after</div><div style="font-size:11px;font-weight:700;font-family:\'DM Mono\',monospace;color:' + (vAfterV < vB.b.vbuf ? 'var(--red)' : 'var(--azure)') + '">' + Math.round(vAfterV).toLocaleString() + ' MT V / ' + Math.round(vAfterM).toLocaleString() + ' MT M</div></div>' +
        '</div>' +
      '</div>' +

      '<div style="font-size:10px;font-weight:700;color:var(--sub);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Phase 2 — After ' + mB.b.name + '\'s Planned Supply Completes</div>' +
      '<div style="background:var(--surface);border:1.5px solid var(--fuel-m-bd);border-radius:10px;padding:13px">' +
        '<div style="font-size:10px;font-weight:700;color:var(--fuel-m);letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">' + mB.b.name + ' — Remaining LSMGO</div>' +
        (mLast ? '<div style="font-size:11px;color:var(--sub);margin-bottom:8px;padding:6px 10px;background:var(--amber-lt);border-radius:6px;border:1px solid var(--amber-bd)">⚠ Blocked until: <strong>' + mLast.vessel + '</strong> supply ETC <strong style="font-family:\'DM Mono\',monospace">' + fmt24(mLast.etc) + '</strong></div>' : '') +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:8px">' +
          '<div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:600">Remaining MGO</div><div style="font-size:14px;font-weight:700;color:var(--fuel-m);font-family:\'DM Mono\',monospace">' + splitResult.remainMgo.toLocaleString() + ' MT</div></div>' +
          '<div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:600">Live MGO ROB</div><div style="font-size:14px;font-weight:700;color:var(--fuel-m);font-family:\'DM Mono\',monospace">' + Math.round(mB.liveRm).toLocaleString() + ' MT</div></div>' +
          '<div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:600">ROB after</div><div style="font-size:14px;font-weight:700;font-family:\'DM Mono\',monospace;color:' + (mAfterM < mB.b.mbuf ? 'var(--red)' : 'var(--teal)') + '">' + Math.round(mAfterM).toLocaleString() + ' MT</div></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding-top:8px;border-top:1px solid var(--border2)">' +
          '<div><div style="font-size:9px;color:var(--muted)">Free from</div><div style="font-size:11px;font-weight:700;font-family:\'DM Mono\',monospace;color:var(--amber)">' + fmt24(mFreeAt) + '</div></div>' +
          '<div><div style="font-size:9px;color:var(--muted)">ETC (remaining MGO)</div><div style="font-size:11px;font-weight:700;font-family:\'DM Mono\',monospace">' + fmt24(mEtc) + '</div></div>' +
        '</div>' +
      '</div>' +

      '<div style="margin-top:12px;padding:10px 14px;background:rgba(255,255,255,.7);border-radius:8px;border:1px solid var(--amber-bd);font-size:11px;color:var(--sub)">' +
        '<strong>Summary:</strong> Vessel receives ' + vReq.toLocaleString() + ' MT VLSFO + ' + (splitResult.vOnlyMgo > 0 ? splitResult.vOnlyMgo.toLocaleString() : '0') + ' MT MGO from ' + vB.b.name + ' at arrival (' + fmt24(vStart) + '), then ' + splitResult.remainMgo.toLocaleString() + ' MT remaining MGO from ' + mB.b.name + ' from ' + fmt24(mFreeAt) + '. Total MGO: ' + mReq.toLocaleString() + ' MT. Overall ETC: ' + fmt24(mEtc) + '.' +
      '</div></div>';
  }

  /* ── Standard / single-fuel / after-ops split ── */
  var fR  = splitResult.firstR;
  var sR  = splitResult.secondR;
  var fF  = splitResult.firstFuel || (type === 'vlsfo_split' ? 'VLSFO' : type === 'mgo_split' ? 'MGO' : 'VLSFO');
  var sF  = splitResult.secondFuel || fF;
  var fQ  = splitResult.firstQty;
  var sQ  = splitResult.secondQty;
  var fT  = splitResult.firstTph;
  var sT  = splitResult.secondTph;
  var fs  = splitResult.firstStart;
  var fe  = splitResult.firstEtc;
  var fd  = splitResult.firstDepart;
  var ss  = splitResult.secondStart;
  var se  = splitResult.secondEtc;
  var oe  = splitResult.overallEtc;
  var sd  = splitResult.secondDelayed;
  var sdh = splitResult.secondDelayHrs;
  var totalHrs = (oe - fs) / 3600000;
  var fCol = fF === 'VLSFO' ? 'var(--fuel-v)' : 'var(--fuel-m)';
  var sBd  = sF === 'VLSFO' ? 'var(--fuel-v-bd)' : 'var(--fuel-m-bd)';
  var fBd2 = fF === 'VLSFO' ? 'var(--fuel-v-bd)' : 'var(--fuel-m-bd)';
  var sCol = sF === 'VLSFO' ? 'var(--fuel-v)' : 'var(--fuel-m)';

  var typeLabel = type === 'vlsfo_split' ? 'Split Supply — VLSFO Across Two Barges'
               : type === 'mgo_split'    ? 'Split Supply — MGO Across Two Barges'
               : type.includes('after_ops') ? 'Split Supply — Two Barges (After Ops)'
               : 'Sequential Split Supply — Two Barges';

  return '<div style="background:var(--amber-lt);border:2px solid var(--amber-bd);border-radius:12px;padding:16px 18px;margin-bottom:14px">' +
    '<div style="font-size:14px;font-weight:700;color:var(--amber);margin-bottom:4px">' + typeLabel + '</div>' +
    '<div style="font-size:11.5px;color:var(--amber);font-style:italic;margin-bottom:14px">Each barge starts at its own earliest available time. One barge alongside at a time (Phase 8).</div>' +

    // Timeline overview
    '<div style="background:rgba(255,255,255,.8);border:1px solid var(--amber-bd);border-radius:10px;padding:12px 16px;margin-bottom:14px">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">' +
        '<div><div style="font-size:9px;text-transform:uppercase;font-weight:700;color:var(--amber);letter-spacing:.08em;margin-bottom:3px">Operation Starts</div>' +
          '<div style="font-size:16px;font-weight:800;font-family:\'DM Mono\',monospace;color:var(--ink)">' + fmt24(fs) + '</div>' +
          '<div style="font-size:10px;color:var(--sub)">' + fR.b.name + ' begins</div>' +
        '</div>' +
        '<div style="border-left:1px solid var(--amber-bd);padding-left:14px"><div style="font-size:9px;text-transform:uppercase;font-weight:700;color:var(--sub);letter-spacing:.08em;margin-bottom:3px">Overall ETC</div>' +
          '<div style="font-size:16px;font-weight:800;font-family:\'DM Mono\',monospace;color:var(--ink)">' + fmt24(oe) + '</div>' +
          '<div style="font-size:10px;color:var(--sub)">All fuels complete</div>' +
        '</div>' +
        '<div style="border-left:1px solid var(--amber-bd);padding-left:14px"><div style="font-size:9px;text-transform:uppercase;font-weight:700;color:var(--sub);letter-spacing:.08em;margin-bottom:3px">Total Duration</div>' +
          '<div style="font-size:16px;font-weight:800;font-family:\'DM Mono\',monospace;color:var(--ink)">' + totalHrs.toFixed(1) + ' hrs</div>' +
          '<div style="font-size:10px;color:' + (requestedETA && fs > requestedETA ? 'var(--red)' : 'var(--green)') + '">' +
            (requestedETA && fs > requestedETA ? '+' + ((fs - requestedETA) / 3600000).toFixed(1) + 'h after ETA' : '✓ On requested time') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // Barge cards
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
    _splitBargeCardV5(fR, fF, fQ, fT, fs, fe, fCol, fBd2, false, 0, 1, hoseHrs) +
    _splitBargeCardV5(sR, sF, sQ, sT, ss, se, sCol, sBd,  sd,  sdh, 2, hoseHrs) +
    '</div>' +

    // Berth sequence note
    '<div style="margin-top:12px;padding:8px 14px;background:rgba(255,255,255,.6);border-radius:8px;border:1px solid var(--amber-bd);font-size:11px;color:var(--sub)">' +
      '<strong>Berth sequence (Phase 8):</strong> ' + fR.b.name + ' alongside ' + fmt24(fs) + '→' + fmt24(fe) + ', departs ' + fmt24(fd) + '. ' +
      sR.b.name + ' comes alongside ' + fmt24(ss) + '→' + fmt24(se) + '.' +
      (sd ? ' <span style="color:var(--amber)">(' + sR.b.name + ' waits ' + sdh.toFixed(1) + 'h for berth to clear.)</span>' : '') +
    '</div>' +
  '</div>';
}

function _splitBargeCardV5(r, fuel, qty, tph, start, etc, col, bd, delayed, delayHrs, phase, hoseHrs) {
  if (!r) return '<div></div>';
  var pumpH  = (qty / (tph || 300)).toFixed(1);
  var hasOps = r.timeline && r.timeline.length > 0;
  var statusLabel = !hasOps
    ? '<span style="color:var(--green);font-weight:700">✓ Free — starts on arrival</span>'
    : delayed
      ? '<span style="color:var(--amber);font-weight:700">⏳ Waits for berth (' + delayHrs.toFixed(1) + 'h)</span>'
      : '<span style="color:var(--azure);font-weight:700">✓ Free at ' + fmt24(start) + '</span>';
  var robAfterV = fuel === 'VLSFO' ? Math.max(0, (r.availRv || 0) - qty) : (r.availRv || 0);
  var robAfterM = fuel === 'MGO' || fuel === 'LSMGO' ? Math.max(0, (r.availRm || 0) - qty) : (r.availRm || 0);
  return '<div style="background:var(--surface);border:1.5px solid ' + bd + ';border-radius:10px;padding:13px;position:relative">' +
    '<div style="position:absolute;top:10px;right:12px;font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;background:' + col + '22;color:' + col + '">Phase ' + phase + '</div>' +
    '<div style="font-size:10px;font-weight:700;color:' + col + ';letter-spacing:.07em;text-transform:uppercase;margin-bottom:10px">' + r.b.name + ' — ' + fuel + '</div>' +
    '<div style="display:flex;flex-direction:column;gap:5px;font-size:11px;color:var(--sub)">' +
      '<div>Supply: <strong style="color:var(--green)">' + qty.toLocaleString() + ' MT ✓</strong></div>' +
      '<div>Pump: <strong>' + pumpH + ' hrs</strong> + ' + hoseHrs + 'h hose-up</div>' +
      '<div>Status: ' + statusLabel + '</div>' +
      '<div>Alongside: <strong style="font-family:\'DM Mono\',monospace;color:' + col + '">' + fmt24(start) + '</strong></div>' +
      '<div>ETC: <strong style="font-family:\'DM Mono\',monospace">' + fmt24(etc) + '</strong></div>' +
      '<div>Departs: <strong style="font-family:\'DM Mono\',monospace">' + fmt24(addHrs(etc, _calcParams.travelHrs)) + '</strong></div>' +
      '<div>ROB after: <strong style="font-family:\'DM Mono\',monospace">' +
        (fuel === 'VLSFO' ? Math.round(robAfterV).toLocaleString() + ' MT VLSFO' : Math.round(robAfterM).toLocaleString() + ' MT MGO') +
      '</strong></div>' +
      (hasOps && !delayed ? '<div style="font-size:10px;color:var(--muted);border-top:1px solid var(--border2);margin-top:4px;padding-top:4px">Own ops: ' + r.timeline.map(function (op) { return op.vessel + ' (→' + fmt24(op.etc) + ')'; }).join(', ') + '</div>' : '') +
    '</div>' +
  '</div>';
}

function _buildForwardImpactPanel(a) {
  var nvi = a.nextVesselImpact;
  if (!nvi) return '';
  var ok = nvi.canReloadBeforeNext && nvi.canSupplyNext;
  var borderColor = ok ? 'var(--green-bd)' : nvi.canSupplyNext ? 'var(--amber-bd)' : 'var(--red-bd)';
  var bgColor     = ok ? 'var(--green-lt)' : nvi.canSupplyNext ? 'var(--amber-lt)' : 'var(--red-lt)';
  var textColor   = ok ? 'var(--green)'    : nvi.canSupplyNext ? 'var(--amber)'    : 'var(--red)';
  return '<div style="border:1.5px solid ' + borderColor + ';border-radius:10px;padding:12px 16px;background:' + bgColor + ';margin-top:10px">' +
    '<div style="font-size:10px;font-weight:700;color:' + textColor + ';letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">Forward Impact — Next Vessel: ' + nvi.vessel + '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;font-size:12px">' +
    '<div><div style="font-size:9px;color:var(--muted);margin-bottom:3px">Next Vessel ETA</div><div style="font-weight:700;font-family:\'DM Mono\',monospace">' + fmt24(nvi.eta) + '</div></div>' +
    '<div><div style="font-size:9px;color:var(--muted);margin-bottom:3px">Reload Needed</div><div style="font-weight:700">' + (nvi.reloadNeeded ? nvi.reloadQty.toLocaleString() + ' MT' : 'No') + '</div></div>' +
    '<div><div style="font-size:9px;color:var(--muted);margin-bottom:3px">Can Reload In Time</div><div style="font-weight:700;color:' + (nvi.canReloadBeforeNext ? 'var(--green)' : 'var(--red)') + '">' + (nvi.canReloadBeforeNext ? 'Yes' : 'No') + '</div></div>' +
    '</div>' +
    '<div style="font-size:11.5px;color:var(--sub);margin-top:8px">' +
    (nvi.canReloadBeforeNext && nvi.canSupplyNext ? 'Sufficient time to reload and supply next vessel.' : '') +
    (!nvi.canReloadBeforeNext ? ' Insufficient time to reload before next vessel arrives (' + nvi.vessel + ' ETA ' + fmt24(nvi.eta) + ', reload takes ' + (nvi.reloadHrs || '?') + ' hrs).' : '') +
    (nvi.canSupplyNext ? '' : ' Post-supply ROB also insufficient to serve ' + nvi.vessel + ' without refuelling.') +
    '</div></div>';
}



/* ─── NSC PERSISTENT CHECK MANAGEMENT ─── */
// _nscCheckData declared at top of script

function clearAllNSCChecks() {
  if (!confirm('Clear all availability checks?')) return;
  // Fix #2: this clears ONLY the local UI results cache (_nscCheckData and
  // its rendered cards). It must never touch _manualROB, _bargeConfig, or
  // _savedSupplies — those are the persistent ROB storage layers and are
  // intentionally left completely untouched here.
  const list = document.getElementById('nsc-checks-list');
  if (list) list.innerHTML = '';
  const hdr = document.getElementById('nsc-checks-header');
  if (hdr) hdr.style.display = 'none';
  Object.keys(_nscCheckData).forEach(k => delete _nscCheckData[k]);
}

function deleteNSCCheck(checkId) {
  const card = document.getElementById(checkId);
  if (!card) return;
  delete _nscCheckData[checkId];
  card.style.transition = 'opacity .25s, transform .25s';
  card.style.opacity = '0';
  card.style.transform = 'translateX(20px)';
  setTimeout(() => {
    card.remove();
    const list = document.getElementById('nsc-checks-list');
    const hdr  = document.getElementById('nsc-checks-header');
    if (list && hdr && list.children.length === 0) hdr.style.display = 'none';
  }, 250);
}

function addNSCToNominations(checkId) {
  const data = _nscCheckData[checkId];
  if (!data) { alert('Check data not found — please run the check again.'); return; }
  const { vesselName, vesselETA, vReq, mReq } = data;
  const etaDate = vesselETA ? new Date(vesselETA) : null;
  const etaStr  = etaDate ? `${pad(etaDate.getDate())} ${MO[etaDate.getMonth()]} ${etaDate.getFullYear()} ${pad(etaDate.getHours())}:${pad(etaDate.getMinutes())}` : '';
  const type = vReq > 0 && mReq > 0 ? 'BOTH' : mReq > 0 ? 'MGO' : 'VLSFO';
  document.getElementById('vessel-nominations')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  addVessel({ name: vesselName || 'NSC Vessel', area: 'FUJ-A', type, qty: vReq || 0, mgo: mReq || 0, eta: etaStr, lc: '', paq: 'no' });
  setTimeout(() => {
    const cards = document.querySelectorAll('.vcard[id^="vessel-"]');
    if (cards.length) {
      const last = cards[cards.length - 1];
      last.style.background = 'var(--azure-lt)';
      last.style.border = '2px solid var(--azure)';
      last.style.transition = 'background 1.2s, border 1.2s';
      setTimeout(() => { last.style.background = ''; last.style.border = ''; }, 2500);
      last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 300);
  const card = document.getElementById(checkId);
  if (card) {
    const flash = document.createElement('div');
    flash.style.cssText = 'background:var(--green);color:#fff;font-size:12px;font-weight:700;padding:8px 16px;text-align:center;';
    flash.textContent = 'Added to Vessel Nomination Register — scroll up to edit details';
    card.insertBefore(flash, card.children[1] || card.lastChild);
    setTimeout(() => flash.remove(), 4000);
  }
  saveSharedState();
}

/* ─────────────────────────────────────────────────────────────────────
   ADD NOMINATION FROM AVAILABILITY CHECK
   Reads the feasibility engine's computed nominationPlan for this check
   (single barge / split supply / delayed start) and creates the correct
   number of pre-filled nomination entries, each with its feasible barge
   already selected and its share of the quantity already set. Split
   supply produces one nomination entry per contributing barge.
   ───────────────────────────────────────────────────────────────────── */
function addNominationFromNSC(checkId) {
  const data = _nscCheckData[checkId];
  if (!data || !data.nominationPlan || !data.nominationPlan.entries || !data.nominationPlan.entries.length) {
    alert('No feasible allocation available for this check — please run the check again.');
    return;
  }
  const plan = data.nominationPlan;
  const baseType = (entryVQty, entryMQty) => entryVQty > 0 && entryMQty > 0 ? 'BOTH' : entryMQty > 0 ? 'MGO' : 'VLSFO';

  document.getElementById('vessel-nominations')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const createdIds = [];
  plan.entries.forEach((entry, idx) => {
    const etaDate = entry.eta ? new Date(entry.eta) : null;
    const etaStr  = etaDate ? `${pad(etaDate.getDate())} ${MO[etaDate.getMonth()]} ${etaDate.getFullYear()} ${pad(etaDate.getHours())}:${pad(etaDate.getMinutes())}` : '';
    const suffix  = plan.entries.length > 1 ? ` (Split ${idx + 1}/${plan.entries.length} — ${entry.bargeName})` : '';
    addVessel({
      name: (data.vesselName || 'NSC Vessel') + suffix,
      area: 'FUJ-A',
      type: baseType(entry.vQty, entry.mQty),
      qty: entry.vQty || 0,
      mgo: entry.mQty || 0,
      eta: etaStr,
      lc: '',
      paq: 'no'
    });
    const cards = document.querySelectorAll('.vcard[id^="vessel-"]');
    const last = cards[cards.length - 1];
    if (last) {
      createdIds.push(last.id);
      // Preselect the feasible barge the engine identified for this entry
      // (addVessel() synchronously calls populateBargeDropdowns(), so options exist already)
      const bargeSel = last.querySelector('select[id$="-barge"]');
      if (bargeSel) bargeSel.value = String(entry.bargeId);
    }
  });

  setTimeout(() => {
    createdIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.background = 'var(--azure-lt)';
      el.style.border = '2px solid var(--green)';
      el.style.transition = 'background 1.2s, border 1.2s';
      setTimeout(() => { el.style.background = ''; el.style.border = ''; }, 2500);
    });
    const firstEl = createdIds[0] && document.getElementById(createdIds[0]);
    if (firstEl) firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 350);

  const card = document.getElementById(checkId);
  if (card) {
    const flash = document.createElement('div');
    flash.style.cssText = 'background:var(--green);color:#fff;font-size:12px;font-weight:700;padding:8px 16px;text-align:center;';
    flash.textContent = plan.entries.length > 1
      ? `Added ${plan.entries.length} nominations to the Vessel Register — one per feasible barge from the split supply plan`
      : `Added to Vessel Nomination Register — ${plan.entries[0].bargeName} preselected`;
    card.insertBefore(flash, card.children[1] || card.lastChild);
    setTimeout(() => flash.remove(), 4500);
  }
  saveSharedState();
}
let _perBargeDetailOpen = false;
function togglePerBargeDetail() {
  const el = document.getElementById('nsc-per-barge');
  const btn = document.getElementById('per-barge-toggle-btn');
  _perBargeDetailOpen = !_perBargeDetailOpen;
  el.style.display = _perBargeDetailOpen ? 'block' : 'none';
  btn.textContent = (_perBargeDetailOpen ? '▲ Hide' : '▼ Show') + ' Details';
}

function renderNSCPerBarge(barges, bargeState) {
  const wrap = document.getElementById('nsc-per-barge');
  if (!wrap) return;
  wrap.innerHTML = barges.map(b => {
    const bs = bargeState[b.id]; if (!bs) return '';
    return `<div class="nsc-panel">
      <div class="nsc-panel-header"><div class="nsc-barge-dot"></div><div style="font-size:13px;font-weight:700;color:var(--ink);font-family:DM Sans,sans-serif">${b.name} — ROB Detail</div></div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
        <div class="rob-stat"><div class="rob-stat-label">VLSFO ROB</div><div class="rob-stat-val">${Math.round(bs.rv).toLocaleString()}</div><div class="rob-stat-sub">MT remaining</div></div>
        <div class="rob-stat"><div class="rob-stat-label">VLSFO Cap</div><div class="rob-stat-val">${b.vcap.toLocaleString()}</div><div class="rob-stat-sub">MT capacity</div></div>
        <div class="rob-stat"><div class="rob-stat-label">MGO ROB</div><div class="rob-stat-val">${Math.round(bs.rm).toLocaleString()}</div><div class="rob-stat-sub">MT remaining</div></div>
        <div class="rob-stat"><div class="rob-stat-label">Last ETC</div><div class="rob-stat-val" style="font-size:11px">${bs.cursor?fmt24(bs.cursor):'—'}</div><div class="rob-stat-sub">free after this</div></div>
      </div>
    </div>`;
  }).join('');
}

/* ─── PAQ ─── */
function renderPAQReminders(sched) {
  const now = new Date();
  const reminders = sched.filter(item => item.paq !== 'yes' && item.eta && (item.eta-now)/86400000 <= 3);
  const pending = sched.filter(item => item.paq !== 'yes');
  const el = document.getElementById('paq-panel'); if (!el) return;
  if (!pending.length) { el.innerHTML = `<div class="apanel clear"><div class="apt"><div class="apdot"></div>PAQ STATUS</div><div class="arow">All vessels have PAQ received.</div></div>`; return; }
  let html = '';
  if (reminders.length) {
    html += `<div class="apanel fired" style="margin-bottom:10px"><div class="apt"><div class="apdot"></div>PAQ REMINDER — ${reminders.length} vessel${reminders.length>1?'s':''} arriving within 3 days</div>`;
    reminders.forEach((item,i) => { const daysLeft=Math.max(0,((item.eta-now)/86400000)).toFixed(1); html+=`<div class="arow"><div class="snum">${i+1}</div><div><strong>${item.name}</strong> — ETA ${fmt24(item.eta)} (${daysLeft} days away). PAQ not received. <strong>Send reminder now.</strong></div></div>`; });
    html += '</div>';
  }
  const others = pending.filter(item => !reminders.includes(item));
  if (others.length) {
    html += `<div class="apanel" style="background:var(--amber-lt);border-color:var(--amber-bd)"><div class="apt" style="color:var(--amber)"><div class="apdot" style="background:var(--amber)"></div>PAQ PENDING — ${others.length} vessel${others.length>1?'s':''}</div>`;
    others.forEach((item,i) => { const eta=item.eta?`ETA ${fmt24(item.eta)}`:'ETA unknown'; html+=`<div class="arow" style="color:var(--amber)"><div class="snum" style="background:var(--amber-lt);color:var(--amber)">${i+1}</div><div><strong>${item.name}</strong> — ${eta}. Send reminder 2-3 days before arrival.</div></div>`; });
    html += '</div>';
  }
  el.innerHTML = html;
}

/* ─── BARGE SCHEDULE REMINDERS ─── */
let _reminderInterval = null;
let _dismissedReminders = new Set();

function renderScheduleReminders() {
  const el = document.getElementById('reminder-panel');
  const lastCheck = document.getElementById('reminder-last-check');
  if (!el) return;
  if (lastCheck) lastCheck.textContent = `Last checked: ${new Date().toLocaleTimeString()}`;

  if (!_lastSched || !_lastSched.length) {
    el.innerHTML = `<div style="font-size:13px;color:var(--muted);text-align:center;padding:16px">Generate the schedule first to see reminders.</div>`;
    return;
  }

  const now = new Date();
  // Vessels arriving within 24–30 hours
  const urgent   = _lastSched.filter(item => {
    if (!item.eta) return false;
    const hrsAway = (item.eta - now) / 3600000;
    return hrsAway >= 0 && hrsAway <= 24;
  });
  const upcoming = _lastSched.filter(item => {
    if (!item.eta) return false;
    const hrsAway = (item.eta - now) / 3600000;
    return hrsAway > 24 && hrsAway <= 30;
  });
  const arrived  = _lastSched.filter(item => {
    if (!item.eta) return false;
    const hrsAway = (item.eta - now) / 3600000;
    return hrsAway < 0 && hrsAway > -6; // arrived within last 6 hrs
  });

  if (!urgent.length && !upcoming.length && !arrived.length) {
    el.innerHTML = `<div style="background:var(--green-lt);border:1.5px solid var(--green-bd);border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:12px">
      <div style="font-size:24px"></div>
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--green)">No urgent reminders</div>
        <div style="font-size:12px;color:var(--green);margin-top:2px">No vessels arriving within the next 30 hours. All clear.</div>
      </div>
    </div>`;
    return;
  }

  let html = '';

  // ARRIVED — need immediate action
  if (arrived.length) {
    html += `<div style="background:var(--red-lt);border:2px solid var(--red-bd);border-radius:12px;padding:14px 18px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--red);letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:8px">
        <span style="width:9px;height:9px;border-radius:50%;background:var(--red);display:inline-block;animation:pulse 1s infinite"></span>
        ARRIVED — BARGE SCHEDULE MUST BE SENT NOW
      </div>
      ${arrived.map((item, i) => _buildReminderRow(item, now, 'arrived', i)).join('')}
    </div>`;
  }

  // URGENT — within 24 hrs
  if (urgent.length) {
    html += `<div style="background:var(--amber-lt);border:2px solid var(--amber-bd);border-radius:12px;padding:14px 18px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--amber);letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:8px">
        <span style="width:9px;height:9px;border-radius:50%;background:var(--amber);display:inline-block;animation:pulse 2s infinite"></span>
        ARRIVING WITHIN 24 HOURS — SEND BARGE SCHEDULE
      </div>
      ${urgent.map((item, i) => _buildReminderRow(item, now, 'urgent', i)).join('')}
    </div>`;
  }

  // UPCOMING — 24–30 hrs
  if (upcoming.length) {
    html += `<div style="background:var(--azure-lt);border:1.5px solid var(--azure-bd);border-radius:12px;padding:14px 18px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--azure);letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:8px">
        <span style="width:9px;height:9px;border-radius:50%;background:var(--azure);display:inline-block"></span>
        ARRIVING WITHIN 24–30 HOURS — PREPARE TO SEND
      </div>
      ${upcoming.map((item, i) => _buildReminderRow(item, now, 'upcoming', i)).join('')}
    </div>`;
  }

  el.innerHTML = html;

  // Browser notification if browser supports it
  if (urgent.length || arrived.length) {
    _tryBrowserNotification(urgent.concat(arrived));
  }
}

function _buildReminderRow(item, now, type, idx) {
  const hrsAway   = (item.eta - now) / 3600000;
  const isArrived = type === 'arrived';
  const isUrgent  = type === 'urgent';
  const rNomV=(item.nomVQ!==undefined&&item.nomVQ!==null)?item.nomVQ:item.vQ, rNomM=(item.nomMQ!==undefined&&item.nomMQ!==null)?item.nomMQ:item.mQ;
  const qty = [rNomV>0?'VLSFO '+rNomV.toLocaleString()+' MT':'', rNomM>0?'MGO '+rNomM.toLocaleString()+' MT':''].filter(Boolean).join(' + ') || '—';
  const color  = isArrived ? 'var(--red)' : isUrgent ? 'var(--amber)' : 'var(--azure)';
  const isDismissed = _dismissedReminders.has(item.sno);
  if (isDismissed) return '';

  return '<div style="background:var(--surface);border:1px solid ' + (isArrived?'var(--red-bd)':isUrgent?'var(--amber-bd)':'var(--azure-bd)') + ';border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap" id="reminder-row-' + item.sno + '">' +
    '<div style="flex:1;min-width:200px">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">' +
        '<span style="font-size:13px;font-weight:700;color:var(--ink)">' + item.name + '</span>' +
        '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:' + (isArrived?'var(--red-lt)':isUrgent?'var(--amber-lt)':'var(--azure-lt)') + ';color:' + color + ';border:1px solid ' + (isArrived?'var(--red-bd)':isUrgent?'var(--amber-bd)':'var(--azure-bd)') + '">' +
          (isArrived ? ' ARRIVED' : '\u26a1 ' + Math.abs(hrsAway).toFixed(1) + ' hrs away') +
        '</span>' +
        '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:var(--azure-lt);color:var(--azure);border:1px solid var(--azure-bd)">\u2693 ' + (item.bargeLabel||'Barge TBD') + '</span>' +
        (item.paq==='yes'?'<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:var(--green-lt);color:var(--green);border:1px solid var(--green-bd)">PAQ \u2713</span>':'<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:var(--red-lt);color:var(--red);border:1px solid var(--red-bd)">PAQ \u26a0</span>') +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;font-size:11.5px;color:var(--sub)">' +
        '<div>\uD83D\uDCC5 ETA: <strong style="color:var(--ink)">' + fmt24(item.eta) + '</strong></div>' +
        '<div>\u26fd Qty: <strong style="color:var(--ink)">' + qty + '</strong></div>' +
        '<div>\uD83D\uDD50 Supply Start: <strong style="color:var(--ink)">' + fmt24(item.bargeStart) + '</strong></div>' +
      '</div>' +
      '<div style="margin-top:8px;padding:7px 12px;background:' + (isArrived?'var(--red-lt)':isUrgent?'var(--amber-lt)':'var(--azure-lt)') + ';border-radius:7px;font-size:11.5px;font-weight:600;color:' + color + '">' +
        (isArrived ? '\u26a1 Action required: Send barge schedule to vessel agent immediately.' : isUrgent ? '\uD83D\uDCE4 Send barge schedule to vessel agent — vessel arrives in < 24 hrs.' : '\uD83D\uDCCB Confirm barge schedule and notify vessel agent.') +
      '</div>' +
    '</div>' +
    '<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">' +
      '<button onclick="openBunkerMsgModal(' + item.sno + ')" style="padding:7px 14px;background:linear-gradient(135deg,var(--ink-solid),var(--azure));color:#fff;border:none;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;font-family:\'DM Sans\',sans-serif;white-space:nowrap">\uD83D\uDCCB Copy Schedule</button>' +
      '<button onclick="dismissReminder(' + item.sno + ')" style="padding:5px 10px;background:var(--surface);border:none;box-shadow:var(--sh-xs);border-radius:7px;font-size:11px;color:var(--muted);cursor:pointer;font-family:\'DM Sans\',sans-serif;white-space:nowrap">\u2713 Dismiss</button>' +
    '</div>' +
  '</div>';
}

/* ─── BUNKER MESSAGE MODAL ─── */
var _bunkerMsgSno = null;

function openBunkerMsgModal(sno) {
  var item = _lastSched.find(function(x) { return x.sno === sno; });
  if (!item) return;
  _bunkerMsgSno = sno;

  var bmNomV=(item.nomVQ!==undefined&&item.nomVQ!==null)?item.nomVQ:item.vQ, bmNomM=(item.nomMQ!==undefined&&item.nomMQ!==null)?item.nomMQ:item.mQ;
  document.getElementById('bm-vessel-name').textContent = item.name;
  document.getElementById('bm-vlsfo-qty').textContent   = bmNomV > 0 ? bmNomV.toLocaleString() + ' MT' : '—';
  document.getElementById('bm-mgo-qty').textContent     = bmNomM > 0 ? bmNomM.toLocaleString() + ' MT' : '—';

  // Auto-detect fuel type
  var fuelType = (bmNomV > 0 && bmNomM > 0) ? 'both' : (bmNomM > 0 ? 'mgo' : 'vlsfo');
  document.getElementById('bm-fuel-type').value = fuelType;

  // Classify supply sequence using central logic
  var idx2 = _lastSched.findIndex(function(x) { return x.sno === sno; });
  var seq  = classifySeq(item, idx2, _lastSched);

  // Rebuild dropdown dynamically
  var seqSel = document.getElementById('bm-seq-type');
  seqSel.innerHTML = '<option value="arrival">On Arrival</option>';
  if (seq.type === 'after' && seq.prevName) {
    seqSel.innerHTML += '<option value="after">After ' + seq.prevName + '</option>';
    seqSel.innerHTML += '<option value="timed">Timed Window (custom)</option>';
    seqSel.value = 'after';
    seqSel.dataset.prevname = seq.prevName;
  } else {
    seqSel.innerHTML += '<option value="timed">Timed Window (custom)</option>';
    seqSel.value = 'arrival';
  }

  // Pre-fill time window
  var supStart = item.bargeStart || item.eta;
  var supEnd   = item.etc;
  var pad2   = function(n) { return String(n).padStart(2, '0'); };
  var fmtT   = function(d) { return pad2(d.getHours()) + pad2(d.getMinutes()); };
  var fmtDay = function(d) { return d.getDate() + ' ' + MO[d.getMonth()] + "'" + String(d.getFullYear()).slice(2); };
  if (supStart && supEnd) {
    document.getElementById('bm-time-window').value = fmtT(supStart) + '-' + fmtT(supEnd) + ' HRS / ' + fmtDay(supStart);
  }

  // Barge name — use preferred/saved barge or vessel's assigned barge
  document.getElementById('bm-barge-input').value = item.bargeLabel || 'FNSA 10';

  // Pre-fill the ETA Nomination Mail tab from the same schedule item so it's
  // ready to review/copy the moment the operator switches tabs.
  var etaFromEl = document.getElementById('eta-date-from');
  var etaToEl   = document.getElementById('eta-date-to');
  var etaVEl    = document.getElementById('eta-vlsfo-qty');
  var etaMEl    = document.getElementById('eta-mgo-qty');
  if (etaFromEl) etaFromEl.value = supStart ? fmtDay(supStart) : '';
  if (etaToEl)   etaToEl.value   = supEnd   ? fmtDay(supEnd)   : (supStart ? fmtDay(supStart) : '');
  if (etaVEl)    etaVEl.value    = bmNomV > 0 ? bmNomV : '';
  if (etaMEl)    etaMEl.value    = bmNomM > 0 ? bmNomM : '';

  bmSwitchTab('schedule');
  _bunkerMsgToggleSeq();
  _bunkerMsgUpdatePreview();
  document.getElementById('bunker-msg-modal').style.display = 'flex';
}

function closeBunkerMsgModal() {
  document.getElementById('bunker-msg-modal').style.display = 'none';
  _bunkerMsgSno = null;
}

function _bunkerMsgToggleSeq() {
  var seq = document.getElementById('bm-seq-type').value;
  var tw  = document.getElementById('bm-time-window-row');
  // Show time window only for custom timed option
  if (tw) tw.style.display = seq === 'timed' ? 'flex' : 'none';
  _bunkerMsgUpdatePreview();
}

function _generateBunkerMsg(item, fuelType, seqType, timeWindow, bargeName) {
  var barge = (bargeName || (item ? item.bargeLabel : '') || 'FNSA 10').trim();
  var gbmNomV=(item&&item.nomVQ!==undefined&&item.nomVQ!==null)?item.nomVQ:(item?item.vQ:0), gbmNomM=(item&&item.nomMQ!==undefined&&item.nomMQ!==null)?item.nomMQ:(item?item.mQ:0);
  var vQty  = item && gbmNomV > 0 ? gbmNomV.toLocaleString() : null;
  var mQty  = item && gbmNomM > 0 ? gbmNomM.toLocaleString() : null;

  var manifoldLine, dischargeLine, qtyLine;

  if (fuelType === 'both') {
    manifoldLine  = 'MANIFOLD SIZE: 8" LSFO / 6" LSMGO';
    dischargeLine = 'DISCHARGE RATE: 300 TPH HSFO / 100 TPH LSMGO';
    qtyLine       = 'QUANTITY: ' + (vQty || '—') + ' MT VLSFO / ' + (mQty || '—') + ' MT LSMGO';
  } else if (fuelType === 'mgo') {
    manifoldLine  = 'MANIFOLD SIZE: 6" LSMGO';
    dischargeLine = 'DISCHARGE RATE: 100 TPH LSMGO';
    qtyLine       = 'QUANTITY: ' + (mQty || '—') + ' MT LSMGO';
  } else {
    manifoldLine  = 'MANIFOLD SIZE: 8" LSFO';
    dischargeLine = 'DISCHARGE RATE: 300 TPH HSFO';
    qtyLine       = 'QUANTITY: ' + (vQty || '—') + ' MT LSFO';
  }

  var body;
  if (seqType === 'arrival') {
    // On Arrival — barge alongside when vessel arrives
    body = 'Good day,\n\nFurther to our below, please note our bunker barge ' + barge +
      ' is scheduled for supply and expected to be alongside upon vessel\'s arrival at STBD side of the vessel\n\n' +
      'STANDBY VHF: CH 16 / 10\n' + manifoldLine + '\n' + dischargeLine + '\n\n' + qtyLine +
      '\n\nKindly ensure speedy turnaround of our bunker barge as she is on a very tight schedule.';

  } else if (seqType === 'after') {
    // After [Previous Vessel] — tight schedule, get time window from the time window field if filled
    var seqSel    = document.getElementById('bm-seq-type');
    var prevName  = (seqSel && seqSel.dataset.prevname) ? seqSel.dataset.prevname : 'previous vessel';
    var tw        = (timeWindow && timeWindow.trim()) ? timeWindow.trim() : null;
    var timePhrase = tw ? 'latest by ' + tw : 'upon completion of ' + prevName;
    body = 'Good day,\n\nFurther to the below, please note our bunker barge ' + barge +
      ' is scheduled for supply and expected to be alongside ' + timePhrase + ' at STBD side of the vessel.\n\n' +
      'STANDBY VHF: CH 16 / 10\n' + manifoldLine + '\n' + dischargeLine + '\n\n' + qtyLine +
      '\n\nKindly ensure speedy turnaround of our bunker barge as she is on a very tight schedule.';

  } else {
    // Timed (custom) — user-specified time window
    var tw2 = (timeWindow && timeWindow.trim()) ? timeWindow.trim() : '[TIME WINDOW]';
    body = 'Good day,\n\nFurther to the below, please note our bunker barge ' + barge +
      ' is scheduled for supply and expected to be alongside latest by ' + tw2 + ' at STBD side of the vessel.\n\n' +
      'STANDBY VHF: CH 16 / 10\n' + manifoldLine + '\n' + dischargeLine + '\n\n' + qtyLine +
      '\n\nKindly ensure speedy turnaround of our bunker barge as she is on a very tight schedule.';
  }
  return body;
}

function _bunkerMsgUpdatePreview() {
  var sno = _bunkerMsgSno;
  if (sno === null || sno === undefined) return;
  var item      = _lastSched.find(function(x) { return x.sno === sno; });
  if (!item) return;
  var fuelType  = document.getElementById('bm-fuel-type').value;
  var seqType   = document.getElementById('bm-seq-type').value;
  var timeWin   = document.getElementById('bm-time-window').value.trim();
  var bargeName = document.getElementById('bm-barge-input').value.trim();
  var msg = _generateBunkerMsg(item, fuelType, seqType, timeWin, bargeName);
  var prev = document.getElementById('bm-preview');
  if (prev) prev.textContent = msg;
}

function copyBunkerMsg() {
  var prev = document.getElementById('bm-preview');
  if (!prev) return;
  var text = prev.textContent;
  navigator.clipboard.writeText(text).then(function() {
    var btn = document.getElementById('bm-copy-btn');
    if (btn) { btn.textContent = '\u2713 Copied!'; btn.style.background = 'var(--green)'; setTimeout(function() { btn.textContent = '\uD83D\uDCCB Copy Message'; btn.style.background = ''; }, 2500); }
  }).catch(function() { prompt('Copy this message:', text); });
}

// Kept for any direct calls elsewhere in the system
function copyScheduleForVessel(sno) { openBunkerMsgModal(sno); }

/* ─── BUNKER MESSAGE MODAL — tab switcher ───
   Toggles between the "Bunker Schedule" message panel and the
   "ETA Nomination Mail" panel, and keeps the two tab buttons' active/
   inactive styling in sync. Switching into the ETA tab refreshes its
   preview immediately, so it's never left showing stale content. */
function bmSwitchTab(tab) {
  var schedBtn   = document.getElementById('bm-tab-schedule');
  var etaBtn     = document.getElementById('bm-tab-eta');
  var schedPanel = document.getElementById('bm-panel-schedule');
  var etaPanel   = document.getElementById('bm-panel-eta');
  if (!schedBtn || !etaBtn || !schedPanel || !etaPanel) return;

  var activeCss   = 'padding:7px 16px;background:var(--azure);color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif';
  var inactiveCss = 'padding:7px 16px;background:var(--surface);color:var(--sub);border:none;box-shadow:var(--sh-sm);border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif';

  if (tab === 'eta') {
    schedPanel.style.display = 'none';
    etaPanel.style.display   = '';
    schedBtn.style.cssText = inactiveCss;
    etaBtn.style.cssText   = activeCss;
    etaMailUpdatePreview();
  } else {
    etaPanel.style.display   = 'none';
    schedPanel.style.display = '';
    etaBtn.style.cssText   = inactiveCss;
    schedBtn.style.cssText = activeCss;
  }
}

/* ─── ETA NOMINATION MAIL — live preview ───
   Builds the subject line and formatted body from the vessel context
   (set by openBunkerMsgModal) plus whatever the operator has typed into
   the Supply Date / Quantity fields. Reuses _emailBodyToHtml so the
   "NOMINATED DATE OF SUPPLY" / "NOMINATED QUANTITY" lines and the CC
   footer get the exact same bold styling as the other outgoing mail
   templates, and the shared mailbox is linkified the same way. */
function etaMailUpdatePreview() {
  var subjectEl = document.getElementById('eta-subject-preview');
  var bodyEl    = document.getElementById('eta-mail-preview');
  if (!subjectEl || !bodyEl) return;

  var item = (_bunkerMsgSno !== null && _bunkerMsgSno !== undefined)
    ? _lastSched.find(function(x) { return x.sno === _bunkerMsgSno; })
    : null;
  var vessel = item ? item.name : (document.getElementById('bm-vessel-name').textContent || '').trim();

  var dateFromEl = document.getElementById('eta-date-from');
  var dateToEl   = document.getElementById('eta-date-to');
  var vQtyEl     = document.getElementById('eta-vlsfo-qty');
  var mQtyEl     = document.getElementById('eta-mgo-qty');
  var dateFrom = dateFromEl ? dateFromEl.value.trim() : '';
  var dateTo   = dateToEl   ? dateToEl.value.trim()   : '';
  var vQty     = vQtyEl ? (parseFloat(vQtyEl.value) || 0) : 0;
  var mQty     = mQtyEl ? (parseFloat(mQtyEl.value) || 0) : 0;

  var dateRange = dateFrom && dateTo && dateFrom !== dateTo ? (dateFrom + ' to ' + dateTo)
    : (dateFrom || dateTo || '[SUPPLY DATE]');

  var vesselLabel = vessel || '[VESSEL]';
  var subject = 'Bunker Supply Nomination \u2013 ' + vesselLabel + ' \u2013 ' + dateRange;

  var lines = [
    'ATTN: OPERATIONS',
    '',
    'Good day all,',
    '',
    'Please be advised that ' + vesselLabel + ' is nominated for bunker supply as per details below. Kindly keep us posted with her firm and consistent ETA notices basis 96/72/48/36/24/12 HRS to our common mail ID at operations@gpsbunkers.com',
    '',
    'NOMINATED DATE OF SUPPLY \u2013 ' + dateRange + '.',
    'NOMINATED QUANTITY - ' + (vQty > 0 ? vQty.toLocaleString() : '\u2014') + ' MT LSFO / ' + (mQty > 0 ? mQty.toLocaleString() : '\u2014') + ' MT LSMGO',
    '',
    'PLEASE KEEP OUR COMMON E MAIL ID - operations@gpsbunkers.com IN CC FOR ALL COMMUNICATION - WHICH IS MONITORED 24 HRS.'
  ];
  var body = lines.join('\n');

  subjectEl.textContent = subject;
  bodyEl.innerHTML = _emailBodyToHtml(body);
  // Plain text kept alongside the rendered HTML so copy handlers don't have
  // to re-derive it from innerText (which can mangle blank lines).
  bodyEl.dataset.plainText = body;
}

function copyEtaSubject() {
  var el = document.getElementById('eta-subject-preview');
  if (!el) return;
  var text = el.textContent;
  _emailCopyPlainFallback(text);
  var btn = event ? event.currentTarget : null;
  if (btn) {
    var orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.textContent = orig; }, 2000);
  }
}

function copyEtaMailBody() {
  var bodyEl = document.getElementById('eta-mail-preview');
  if (!bodyEl) return;
  var text = bodyEl.dataset.plainText || bodyEl.innerText;
  var html = bodyEl.innerHTML;
  var btn = event ? event.currentTarget : null;
  var orig = btn ? btn.innerHTML : null;
  _emailWriteRichClipboard(text, html).then(function() {
    if (btn) {
      btn.textContent = '\u2713 Copied!';
      setTimeout(function() { btn.innerHTML = orig; }, 2500);
    }
  });
}


function dismissReminder(sno) {
  _dismissedReminders.add(sno);
  const row = document.getElementById(`reminder-row-${sno}`);
  if (row) { row.style.opacity='0'; row.style.transition='opacity .3s'; setTimeout(()=>row.remove(), 300); }
}

function _tryBrowserNotification(vessels) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'denied') return;
  const unDismissed = vessels.filter(v => !_dismissedReminders.has(v.sno));
  if (!unDismissed.length) return;
  if (Notification.permission === 'granted') {
    unDismissed.forEach(v => {
      const hrsAway = (v.eta - new Date()) / 3600000;
      try {
        new Notification(`⏰ Bunker Schedule — ${v.name}`, {
          body: hrsAway < 0 ? `${v.name} has arrived! Send barge schedule NOW.` : `${v.name} arrives in ${hrsAway.toFixed(1)} hrs. Send barge schedule.`,
          icon: ''
        });
      } catch(e) {}
    });
  } else if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function startReminderAutoRefresh() {
  if (_reminderInterval) clearInterval(_reminderInterval);
  _reminderInterval = setInterval(() => {
    const chk = document.getElementById('reminder-auto-check');
    if (chk && chk.checked && _lastSched.length) {
      renderScheduleReminders();
    }
  }, 5 * 60 * 1000); // every 5 minutes
}

/* ─── CHECKLIST ─── */
// ═══════════════════════════════════════════════════════════
// INDEPENDENT PERSISTENT CHECKLIST
// - Records are NEVER deleted when nomination is removed
// - Each record is fully isolated (no row shifting, no data sharing)
// - Once "Completed" a record is permanently locked
// - Nominations feed INTO checklist only on schedule generation
// - Actual quantities are always manual user input
// ═══════════════════════════════════════════════════════════

// (declared at top level) // { [uid]: { uid, sno, vessel, nomV, nomM, actV, actM, supplied, notes, bargeLabel, supplyDate, lockedAt } }

function _clUid(sno, name) {
  // ── FT84 FIX (Issues 2 & 3): UID must be STABLE across recalculations.
  // The old key was `sno + slug(name)` where sno is the scheduler's position number.
  // sno changes every time Generate Schedule runs (vessel order shifts), which caused
  // a new _checklistRecords key to be created each run → DUPLICATE checklist entries.
  // Deletion by the old key then left orphan records that appeared as valid nominations.
  //
  // New key: vessel name slug only.  Name is stable; position is not.
  // The sno parameter is kept for backward-compat call sites but is IGNORED.
  const slug = (name || '').toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g,'_').replace(/^_|_$/g,'').slice(0, 40);
  return 'v_' + (slug || String(Date.now()));
}

// Called ONLY from renderOutput — injects new records, never overwrites existing
// FT84 FIX (Issue 2): UID is now vessel-name-based (stable). Running this function
// 1 time or 100 times produces exactly the same _checklistRecords — fully idempotent.
function injectChecklistFromSchedule(sched) {
  // Deduplicate the incoming schedule by vessel name before processing.
  // A stale _lastSched can contain the same vessel twice (e.g. SAFEEN PROSPER
  // appearing in both a completed slot and a rescheduled slot). Processing both
  // created two checklist rows for the same vessel. Take the first occurrence only.
  const seenNames = new Set();
  const dedupedSched = sched.filter(item => {
    const key = (item.name || '').trim().toLowerCase();
    if (seenNames.has(key)) return false;
    seenNames.add(key);
    return true;
  });

  dedupedSched.forEach(item => {
    let uid = _clUid(item.sno, item.name);

    // If a record exists for this uid and is already completed/supplied,
    // check if this is the same supply event or a genuinely new nomination.
    if (_checklistRecords[uid] && _checklistRecords[uid].supplied) {
      const oldDate = _checklistRecords[uid].supplyDate ? new Date(_checklistRecords[uid].supplyDate).getTime() : null;
      const newDate = (item.bargeStart || item.eta) ? new Date(item.bargeStart || item.eta).getTime() : null;
      const sameDate = oldDate && newDate && Math.abs(oldDate - newDate) < 12 * 3600000; // within 12h = same supply event
      if (sameDate || !newDate) {
        // Same event — skip. Do NOT create any new uid.
        return;
      }
      // Genuinely different date — use a deterministic alt uid based on sno only (no timestamp).
      // Using Date.now() here caused a new uid on every inject call, multiplying rows.
      const altUid = uid + '__resupply_' + item.sno;
      uid = altUid;
      // If altUid is also already completed, skip entirely rather than spawning another uid.
      if (_checklistRecords[uid] && _checklistRecords[uid].supplied) return;
    }
    // Final safety net: if ANY record already exists for this vessel name —
    // active OR already completed/locked — skip creating a new one. The
    // earlier !r.lockedAt condition let completed records slip through
    // here (a completed record IS locked, so it was being excluded from
    // this "already exists" check instead of being caught by it), which
    // is how a vessel could end up with two checklist rows: one
    // 'completed' and a second 'draft' one created on the next schedule
    // generation.
    const vesselNameLower = (item.name || '').trim().toLowerCase();
    const alreadyExists = Object.values(_checklistRecords).some(r =>
      (r.vessel || '').trim().toLowerCase() === vesselNameLower && r.uid !== uid
    );
    if (alreadyExists) return;

    if (!_checklistRecords[uid]) {
      // Distinguish "this fuel type was never part of the nomination" (null —
      // hide the field) from "nominated quantity is 0 / not yet available from
      // ROB" (keep it visible so the operator can still see and enter actuals).
      _checklistRecords[uid] = {
        uid,
        sno:        item.sno,      // display order (updated each run, never used as key)
        vessel:     item.name,
        area:       item.area || '',
        nomV:       (item.nomVQ !== undefined && item.nomVQ !== null) ? item.nomVQ : ((item.vQ === undefined || item.vQ === null || item.vQ === '') ? null : (typeof item.vQ === 'number' ? item.vQ : (parseFloat(item.vQ) || 0))),
        nomM:       (item.nomMQ !== undefined && item.nomMQ !== null) ? item.nomMQ : ((item.mQ === undefined || item.mQ === null || item.mQ === '') ? null : (typeof item.mQ === 'number' ? item.mQ : (parseFloat(item.mQ) || 0))),
        actV:       '',   // deliberately blank — user must enter actual
        actM:       '',   // deliberately blank
        supplied:   false,
        notes:      '',
        bargeLabel: item.bargeLabel || '',
        supplyDate: item.bargeStart || item.eta,
        isDelayed:  !!item.isDelayed,
        state:      'draft',
        lockedAt:   null
      };
    } else if (!_checklistRecords[uid].supplied) {
      // Existing unlocked record: update display sno and nomination ref only, never actuals
      _checklistRecords[uid].sno        = item.sno;          // keep display order current
      _checklistRecords[uid].nomV       = (item.nomVQ !== undefined && item.nomVQ !== null) ? item.nomVQ : ((item.vQ === undefined || item.vQ === null || item.vQ === '') ? null : (typeof item.vQ === 'number' ? item.vQ : (parseFloat(item.vQ) || 0)));
      _checklistRecords[uid].nomM       = (item.nomMQ !== undefined && item.nomMQ !== null) ? item.nomMQ : ((item.mQ === undefined || item.mQ === null || item.mQ === '') ? null : (typeof item.mQ === 'number' ? item.mQ : (parseFloat(item.mQ) || 0)));
      _checklistRecords[uid].vessel     = item.name;
      _checklistRecords[uid].area       = item.area || _checklistRecords[uid].area || '';
      _checklistRecords[uid].bargeLabel = item.bargeLabel || '';
      _checklistRecords[uid].supplyDate = item.bargeStart || item.eta;
      _checklistRecords[uid].isDelayed  = !!item.isDelayed;
    }
    // If supplied/locked: DO NOT touch any field
  });
}

// (declared at top level)

function renderChecklist(sched) {
  const wrap = document.getElementById('checklist-rows'); if (!wrap) return;

  // Inject/update from schedule (but never delete existing records)
  if (sched && sched.length) injectChecklistFromSchedule(sched);

  // Refresh tracker whenever checklist renders
  if(typeof renderRemainingSupplyTracker==="function") setTimeout(function(){renderRemainingSupplyTracker();},50);
  // Note: legacy _checklist[sno] bidirectional sync removed in FT84 — sno is positional
  // and could map to different vessels after a recalculation. All state lives in _checklistRecords.

  // Sort by actual supply date ascending — sno is just the order vessels were
  // generated in, not the chronological order of supply, and could be
  // misleading once vessels get re-nominated for later dates.
  function _clDateSort(a, b) {
    const da = a.supplyDate ? new Date(a.supplyDate).getTime() : Infinity;
    const db = b.supplyDate ? new Date(b.supplyDate).getTime() : Infinity;
    if (da !== db) return da - db;
    return a.sno - b.sno; // stable tie-breaker when dates are equal/missing
  }
  const records = Object.values(_checklistRecords).sort(_clDateSort);

  // Deduplicate by vessel name — keep only the first occurrence per vessel.
  // Prevents duplicate rows when stale schedule data re-injects the same vessel.
  const _seenCLNames = new Set();
  const dedupedRecords = records.filter(r => {
    const k = (r.vessel || '').trim().toLowerCase();
    if (_seenCLNames.has(k)) { return false; }
    _seenCLNames.add(k); return true;
  });
  // Also purge duplicate keys from _checklistRecords so they don't come back
  records.forEach(r => { if (!dedupedRecords.includes(r)) delete _checklistRecords[r.uid]; });

  // If no records from _checklistRecords, try to inject from _lastSched directly
  if (!dedupedRecords.length && _lastSched && _lastSched.length) {
    injectChecklistFromSchedule(_lastSched);
    const fresh = Object.values(_checklistRecords).sort(_clDateSort);
    const _s2 = new Set();
    fresh.filter(r => { const k=(r.vessel||'').trim().toLowerCase(); if(_s2.has(k))return false; _s2.add(k);return true; })
         .forEach(r => dedupedRecords.push(r));
  }
  if (!dedupedRecords.length) {
    wrap.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:20px;text-align:center">No checklist records. Generate the schedule first.</div>';
    return;
  }

  const th = s => `<th style="padding:10px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;white-space:nowrap">${s}</th>`;

  wrap.innerHTML = `<div style="overflow-x:auto"><table class="cl-tbl">
    <thead><tr>
      ${th('No.')}${th('Vessel')}${th('Supply Date')}
      ${th('Nom. VLSFO')}${th('Actual VLSFO')}
      ${th('Nom. LSMGO')}${th('Actual LSMGO')}
      ${th('Barge')}${th('Status')}${th('Remarks')}${th('Action')}
    </tr></thead>
    <tbody>` +
    dedupedRecords.map((rec, idx) => {
      const isLocked = rec.state === 'completed' && rec.lockedAt;
      const rowBg = isLocked ? 'background:var(--green-lt)' : '';
      const lockStyle = isLocked ? 'opacity:.65;pointer-events:none' : '';
      const lockBadge = ''; // Locked indicator removed — not shown to user

      // null = this fuel type was never part of the nomination → show '—', no input.
      // A real number (including 0, e.g. ROB not yet available) → always show the
      // value and the actuals input, so the operator can still record what's loaded.
      const nomVDisplay = (rec.nomV === null || rec.nomV === undefined) ? '—' : rec.nomV.toLocaleString() + ' MT';
      const nomMDisplay = (rec.nomM === null || rec.nomM === undefined) ? '—' : rec.nomM.toLocaleString() + ' MT';

      const devBadge = (act, nom) => {
        if (act === '' || act === null || act === undefined || nom === 0) return '';
        const dev = parseFloat(act) - nom;
        if (isNaN(dev)) return '';
        if (dev === 0) return '<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;background:var(--green-lt);color:var(--green);margin-left:4px">Match</span>';
        return `<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;background:${dev>0?'var(--azure-lt)':'var(--red-lt)'};color:${dev>0?'var(--azure)':'var(--red)'};margin-left:4px">${dev>0?'+':''}${parseFloat(dev.toFixed(2)).toLocaleString()} MT</span>`;
      };

      return `<tr style="border-bottom:1px solid var(--border2);${rowBg}" id="cl-row-${rec.uid}">
        <td style="padding:9px 12px;color:var(--muted);font-weight:700;font-family:DM Mono,monospace">${idx + 1}</td>
        <td style="padding:9px 12px;font-weight:600">${rec.vessel}${lockBadge}</td>
        <td style="padding:9px 12px;font-family:DM Mono,monospace;font-size:11px;white-space:nowrap">${rec.supplyDate ? fmt24(rec.supplyDate) : '—'}</td>

        <td style="padding:9px 12px;text-align:center">
          <div style="font-family:DM Mono,monospace;font-weight:700;color:var(--azure)">${nomVDisplay}</div>
          <div style="font-size:9px;color:var(--muted);margin-top:1px">Nomination</div>
        </td>

        <td style="padding:9px 12px">
          ${rec.nomV !== null && rec.nomV !== undefined ? `<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
            <input type="number" id="cl-av-${rec.uid}" value="${rec.actV}" min="0" step="0.1"
              placeholder="${rec.nomV}" ${isLocked ? 'disabled' : ''}
              onchange="clUpdateActual('${rec.uid}','v',this.value)"
              style="width:82px;font-size:12px;padding:5px 7px;border:none;box-shadow:var(--sh-in-xs);border-radius:6px;font-family:DM Mono,monospace;background:var(--surface);outline:none;${lockStyle}"
              onfocus="this.style.borderColor='var(--azure)'" onblur="this.style.borderColor='var(--border)'">
            <span style="font-size:11px;color:var(--sub)">MT</span>
            <span id="cl-dv-${rec.uid}">${devBadge(rec.actV, rec.nomV)}</span>
          </div>` : '<span style="color:var(--muted)">—</span>'}
        </td>

        <td style="padding:9px 12px;text-align:center">
          <div style="font-family:DM Mono,monospace;font-weight:700;color:var(--teal)">${nomMDisplay}</div>
          <div style="font-size:9px;color:var(--muted);margin-top:1px">Nomination</div>
        </td>

        <td style="padding:9px 12px">
          ${rec.nomM !== null && rec.nomM !== undefined ? `<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
            <input type="number" id="cl-am-${rec.uid}" value="${rec.actM}" min="0" step="0.1"
              placeholder="${rec.nomM}" ${isLocked ? 'disabled' : ''}
              onchange="clUpdateActual('${rec.uid}','m',this.value)"
              style="width:82px;font-size:12px;padding:5px 7px;border:none;box-shadow:var(--sh-in-xs);border-radius:6px;font-family:DM Mono,monospace;background:var(--surface);outline:none;${lockStyle}"
              onfocus="this.style.borderColor='var(--teal)'" onblur="this.style.borderColor='var(--border)'">
            <span style="font-size:11px;color:var(--sub)">MT</span>
            <span id="cl-dm-${rec.uid}">${devBadge(rec.actM, rec.nomM)}</span>
          </div>` : '<span style="color:var(--muted)">—</span>'}
        </td>

        <td style="padding:9px 12px;font-size:12px">${rec.bargeLabel || '—'}</td>

        <td style="padding:9px 12px">
          ${isLocked
            ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:var(--green)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>Completed</span>`
            : `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap">
            <input type="checkbox" ${rec.supplied?'checked':''} onchange="clToggleSupplied('${rec.uid}',this.checked)"
              style="width:15px;height:15px;cursor:pointer;accent-color:var(--azure)">
            <span style="font-size:11px;font-weight:700;color:${rec.supplied?'var(--green)':'var(--muted)'}">${rec.supplied?'Completed':'Pending'}</span>
          </label>`}
        </td>

        <td style="padding:9px 12px">
          <input type="text" value="${rec.notes||''}" ${isLocked?'disabled':''}
            onchange="clUpdateNotes('${rec.uid}',this.value)"
            placeholder="Remarks…"
            style="font-size:11px;padding:5px 7px;border:none;box-shadow:var(--sh-in-xs);border-radius:5px;width:110px;font-family:DM Sans,sans-serif;${lockStyle}">
        </td>

        <td style="padding:9px 12px;white-space:nowrap">
          ${rec.state==='completed'&&rec.lockedAt
            ? '<span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:5px;background:var(--green-lt);color:var(--green)">Completed</span>'
            : `<button class="btn-success" style="font-size:11px;padding:5px 10px;margin-right:4px" onclick="saveChecklistRecord('${rec.uid}')">Save</button>`}
          <button style="padding:5px 8px;background:var(--red-lt);border:1.5px solid var(--red-bd);border-radius:5px;font-size:11px;color:var(--red);cursor:pointer;font-family:DM Sans,sans-serif;font-weight:600;${isLocked?'':'margin-left:2px'}"
            onclick="deleteChecklistRecord('${rec.uid}')" title="Remove">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </td>
      </tr>`;
    }).join('') + '</tbody></table></div>';
}

// Update actual quantity in record (no re-render, just update state + badge)
function clUpdateActual(uid, field, val) {
  const rec = _checklistRecords[uid];
  if (!rec || rec.supplied) return;
  if (field === 'v') { rec.actV = val; }
  if (field === 'm') { rec.actM = val; }
  // Update deviation badge in place
  const nom = field === 'v' ? rec.nomV : rec.nomM;
  const dev = val !== '' ? parseFloat(val) - nom : null;
  const badgeEl = document.getElementById(`cl-d${field}-${uid}`);
  if (badgeEl) {
    if (dev === null || isNaN(dev) || nom === 0) { badgeEl.innerHTML = ''; return; }
    if (dev === 0) { badgeEl.innerHTML = '<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;background:var(--green-lt);color:var(--green)">Match</span>'; return; }
    badgeEl.innerHTML = `<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;background:${dev>0?'var(--azure-lt)':'var(--red-lt)'};color:${dev>0?'var(--azure)':'var(--red)'}">${dev>0?'+':''}${parseFloat(dev.toFixed(2)).toLocaleString()} MT</span>`;
  }
}

function clToggleSupplied(uid, checked) {
  const rec = _checklistRecords[uid];
  if (!rec || rec.lockedAt) return;
  rec.supplied = checked;
  // Re-render status cell only
  const row = document.getElementById(`cl-row-${uid}`);
  if (row) {
    const statusCell = row.querySelector('td:nth-child(9)');
    if (statusCell) {
      statusCell.innerHTML = `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap">
        <input type="checkbox" ${checked?'checked':''} onchange="clToggleSupplied('${uid}',this.checked)"
          style="width:15px;height:15px;cursor:pointer;accent-color:var(--azure)">
        <span style="font-size:11px;font-weight:700;color:${checked?'var(--green)':'var(--muted)'}">${checked?'Completed':'Pending'}</span>
      </label>`;
    }
  }
}

function clUpdateNotes(uid, val) {
  const rec = _checklistRecords[uid];
  if (!rec || rec.lockedAt) return;
  rec.notes = val;
}

async function saveChecklistRecord(uid) {
  const rec = _checklistRecords[uid];
  if (!rec) return;
  if (rec.lockedAt) { alert('This record is locked.'); return; }

  // Read from DOM first, fallback to rec state
  const inpV = document.getElementById('cl-av-' + uid);
  const inpM = document.getElementById('cl-am-' + uid);

  // Get raw values from DOM inputs
  const rawV = inpV ? inpV.value.trim() : '';
  const rawM = inpM ? inpM.value.trim() : '';

  // Use DOM value if present, else fall back to previously stored rec value
  const actV = rawV !== '' ? (parseFloat(rawV) || 0)
             : (rec.actV !== '' && rec.actV !== undefined ? (parseFloat(rec.actV) || 0) : 0);
  const actM = rawM !== '' ? (parseFloat(rawM) || 0)
             : (rec.actM !== '' && rec.actM !== undefined ? (parseFloat(rec.actM) || 0) : 0);

  // Always sync back to rec so state is consistent
  rec.actV = String(actV);
  rec.actM = String(actM);

  // Also update input display to confirm what was captured
  if (inpV) inpV.value = actV > 0 ? actV : (inpV.value || '');
  if (inpM) inpM.value = actM > 0 ? actM : (inpM.value || '');

  // Resolve area label for display
  const _areaLabel = (typeof AREA_OPTIONS !== 'undefined' && rec.area)
    ? (AREA_OPTIONS.find(o => o.value === rec.area)?.label || rec.area)
    : (rec.area || '—');

  // State: every click of Save/Update completes and locks the record
  // immediately — entering the actual supplied quantity and pressing
  // Save IS the operator's confirmation that the supply happened. There
  // is no separate "tick Pending, then Save" step; one click is final.
  // This MUST happen before supplyRec is built below — supplyRec takes a
  // snapshot of rec.supplied at the moment it's constructed, so setting
  // rec.supplied afterward had no effect on the already-built object,
  // which is why saved records kept showing "Pending" even though the
  // checklist itself correctly marked the row as completed.
  rec.supplied = true;
  rec.state    = 'completed';
  rec.lockedAt = new Date().toISOString();
  rec.actV     = String(actV);
  rec.actM     = String(actM);

  const supplyRec = {
    id: uid + '_' + Date.now(),
    checklistUid: uid,         // FT84 FIX (Issue 3): enables delete by ChecklistID only
    savedAt: new Date().toISOString(),
    vessel: rec.vessel,
    area: _areaLabel,
    areaCode: rec.area || '',
    dateStr: rec.supplyDate ? fmt24(rec.supplyDate) : '—',
    supplyDate: rec.supplyDate ? (rec.supplyDate instanceof Date ? rec.supplyDate.toISOString() : String(rec.supplyDate)) : new Date().toISOString(),
    vlsfoNom: rec.nomV,
    mgoNom:   rec.nomM,
    vlsfoAct: actV,
    mgoAct:   actM,
    barge:    rec.bargeLabel || '',
    notes:    rec.notes || '',
    supplied: true,
  };

  // Replace existing saved record for this exact checklist entry (stable uid),
  // never by vessel+date — date formatting can shift between schedule runs and
  // previously caused duplicate Saved Supply rows for the same checklist record.
  _savedSupplies = _savedSupplies.filter(r => r.checklistUid !== uid);
  _savedSupplies.push(supplyRec);

  // Delivery Log — automatic Timely/Delayed classification + Dispute
  // capture from Remarks, exactly at the moment this supply is saved.
  _logDelivery(rec, supplyRec);

  // Completed records are kept in _checklistRecords (marked state:'completed',
  // lockedAt set) rather than deleted. injectChecklistFromSchedule() already
  // checks for an existing completed/supplied record before creating a new
  // one for the same vessel, so duplicates on re-schedule/reload are already
  // prevented at the injection point — deleting here was unnecessary and
  // broke the Remaining Supply Tracker, which needs completed records to
  // still be present in order to show their "Done" status and correctly
  // deduct them from the running ROB total.

  // Remove this vessel from the Vessel Nomination Register immediately
  if (typeof removeNominationByName === 'function') {
    removeNominationByName(rec.vessel);
  }

  await saveSharedRecords();
  renderSavedRecords();
  renderLiveROBDashboard();
  renderChecklist(_lastSched);
  if(typeof renderRemainingSupplyTracker==="function")renderRemainingSupplyTracker();
  // Remove saved vessel from Voyage Schedule immediately
  if(_lastSched&&_lastSched.length&&typeof renderBargeTabsAndTL==="function"){
    var br=[];
    if(typeof getBarges==="function") br=getBarges();
    if(!br||!br.length) br=(_bargeConfig||[]).map(function(b){return {id:b.id,name:b.name};});
    if(br&&br.length) renderBargeTabsAndTL(_lastSched,br);
  }
  showToast(rec.vessel + ' — supply logged (VLSFO ' + Math.round(actV).toLocaleString() + ' MT, MGO ' + Math.round(actM).toLocaleString() + ' MT)', 'success');
}

function deleteChecklistRecord(uid) {
  // FT84 FIX (Issue 3): Delete targets ChecklistID (uid) ONLY.
  // Never uses sno, array index, or vessel name as the deletion key.
  const rec = _checklistRecords[uid];
  if (!rec) return;
  if (rec.state==='completed'&&rec.lockedAt){
    if(!confirm('Completed record for ' + rec.vessel + '. Delete anyway?'))return;
    // Remove the single matching saved supply for this uid (not all records for this vessel)
    _savedSupplies=_savedSupplies.filter(function(r){return r.id!==uid&&!(r.vessel===rec.vessel&&r.checklistUid===uid);});
    saveSharedRecords();renderSavedRecords();
    delete _checklistRecords[uid];
    // DO NOT touch _checklist[sno] — sno is positional and may refer to a different vessel after a re-run
    renderChecklist(_lastSched);
    return;
  }
  if(!confirm('Remove '+rec.vessel+' from checklist?'))return;
  delete _checklistRecords[uid];
  // DO NOT touch _checklist[sno] — positional index is not a safe deletion key
  renderChecklist(_lastSched);
}

/* ─── SAVED RECORDS ─── */
let _savedSupplies = [];

/* ─── DELIVERY LOG ───────────────────────────────────────────────────
   {monthKey: {timely:[...], delayed:[...], disputes:[...]}} — monthKey
   is 'YYYY-MM'. Timely/Delayed are marked automatically (from the same
   laycan-vs-ETA logic already used everywhere else in the app). Disputes
   are captured automatically from the Checklist Remarks field whenever a
   supply is saved with non-empty remarks — the operator never fills this
   in separately. Persists through the normal state save/load path (cloud
   + local), and is only ever cleared by Clear All Data or Wipe Cloud —
   never by Full Reset or Clear Checklist. */
let _deliveryLog = {};

function _dlMonthKey(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0,7);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}
function _dlMonthLabel(key) {
  const [y,m] = key.split('-').map(Number);
  const d = new Date(y, m-1, 1);
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}
function _dlEnsureMonth(key) {
  if (!_deliveryLog[key]) _deliveryLog[key] = { timely: [], delayed: [], disputes: [] };
  return _deliveryLog[key];
}

// Called from saveChecklistRecord() at the exact moment a supply is saved —
// this is the single, automatic entry point for the whole Delivery Log.
function _logDelivery(rec, supplyRec) {
  const key = _dlMonthKey(supplyRec.supplyDate || rec.supplyDate);
  const month = _dlEnsureMonth(key);
  const base = {
    id: supplyRec.id,
    checklistUid: rec.uid,
    vessel: rec.vessel,
    dateStr: supplyRec.dateStr,
    supplyDate: supplyRec.supplyDate,
    barge: rec.bargeLabel || '',
    vlsfoAct: supplyRec.vlsfoAct,
    mgoAct: supplyRec.mgoAct,
    loggedAt: new Date().toISOString(),
  };

  // Timely / Delayed — automatic, based on whether actual ETA fell within
  // the nominated laycan window (rec.isDelayed, same rule used everywhere
  // else in the app for laycan compliance).
  const bucket = rec.isDelayed ? month.delayed : month.timely;
  const already = bucket.some(function(e) { return e.checklistUid === rec.uid; });
  if (!already) bucket.push(base);

  // Dispute — automatic, whenever Remarks has text at the moment of saving.
  const remarks = (rec.notes || '').trim();
  if (remarks) {
    const existingDispute = month.disputes.find(function(e) { return e.checklistUid === rec.uid; });
    if (existingDispute) {
      existingDispute.remarks = remarks;
      existingDispute.loggedAt = base.loggedAt;
    } else {
      month.disputes.push(Object.assign({}, base, { remarks: remarks }));
    }
  }

  _saveDeliveryLog();
}

function _saveDeliveryLog() {
  try { localStorage.setItem('abps_delivery_log_v1', JSON.stringify(_deliveryLog)); } catch(e) {}
}
function _loadDeliveryLogLocal() {
  try {
    const raw = localStorage.getItem('abps_delivery_log_v1');
    if (raw) _deliveryLog = JSON.parse(raw) || {};
  } catch(e) {}
}

// Additive merge of an incoming (cloud/remote) Delivery Log into the local
// one — same never-lose philosophy as _mergeAgents()/_mergeArchives(). Every
// entry is keyed by checklistUid within its bucket, so a pull only ever adds
// what's missing locally; nothing already logged is ever removed by a sync.
function _mergeDeliveryLog(remoteLog) {
  if (!remoteLog || typeof remoteLog !== 'object') return;
  Object.keys(remoteLog).forEach(function(key) {
    const remoteMonth = remoteLog[key] || {};
    const localMonth = _dlEnsureMonth(key);
    ['timely', 'delayed', 'disputes'].forEach(function(bucket) {
      const remoteEntries = remoteMonth[bucket] || [];
      remoteEntries.forEach(function(re) {
        const exists = localMonth[bucket].some(function(le) {
          return le.checklistUid === re.checklistUid || (le.id && re.id && le.id === re.id);
        });
        if (!exists) localMonth[bucket].push(re);
      });
    });
  });
  _saveDeliveryLog();
}

function renderDeliveryLog() {
  const sel = document.getElementById('dl-month-select');
  if (!sel) return;

  const keys = Object.keys(_deliveryLog).sort().reverse();
  const currentKey = _dlMonthKey(new Date());
  if (!keys.length) keys.push(currentKey);
  else if (!keys.includes(currentKey)) keys.unshift(currentKey);

  const prevVal = sel.value;
  sel.innerHTML = keys.map(function(k) { return '<option value="'+k+'">'+_dlMonthLabel(k)+'</option>'; }).join('');
  sel.value = keys.includes(prevVal) ? prevVal : currentKey;

  const key = sel.value;
  const month = _deliveryLog[key] || { timely: [], delayed: [], disputes: [] };

  document.getElementById('dl-count-timely').textContent   = month.timely.length;
  document.getElementById('dl-count-delayed').textContent  = month.delayed.length;
  document.getElementById('dl-count-disputes').textContent = month.disputes.length;

  const rowHtml = function(e, extra) {
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--border2);font-size:12.5px">'
      + '<div><strong>'+(e.vessel||'—')+'</strong><span style="color:var(--muted);margin-left:8px">'+(e.dateStr||'')+'</span></div>'
      + '<div style="color:var(--muted)">'+(e.barge?('Barge '+e.barge+' · '):'')+(e.vlsfoAct?('VLSFO '+e.vlsfoAct.toLocaleString()+' MT '):'')+(e.mgoAct?('MGO '+e.mgoAct.toLocaleString()+' MT'):'')+'</div>'
      + (extra||'')
      + '</div>';
  };

  const timelyEl = document.getElementById('dl-list-timely');
  timelyEl.innerHTML = month.timely.length
    ? month.timely.map(function(e){ return rowHtml(e); }).join('')
    : '<div style="font-size:12px;color:var(--muted);padding:8px 0">No timely deliveries logged for this month.</div>';

  const delayedEl = document.getElementById('dl-list-delayed');
  delayedEl.innerHTML = month.delayed.length
    ? month.delayed.map(function(e){ return rowHtml(e); }).join('')
    : '<div style="font-size:12px;color:var(--muted);padding:8px 0">No delayed deliveries logged for this month.</div>';

  const disputesEl = document.getElementById('dl-list-disputes');
  disputesEl.innerHTML = month.disputes.length
    ? month.disputes.map(function(e){
        return '<div style="padding:9px 0;border-bottom:1px solid var(--border2);font-size:12.5px">'
          + '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px">'
          + '<strong>'+(e.vessel||'—')+'</strong><span style="color:var(--muted)">'+(e.dateStr||'')+'</span>'
          + '</div>'
          + '<div style="margin-top:4px;padding:8px 10px;background:var(--red-lt);border:1px solid #F3C7C0;border-radius:6px;color:var(--red-dk,#9B2C2C)">'+e.remarks+'</div>'
          + '</div>';
      }).join('')
    : '<div style="font-size:12px;color:var(--muted);padding:8px 0">No disputes logged for this month.</div>';
}

/* ─── ARCHIVES ───────────────────────────────────────────────────────
   BUG FOUND: _archives was declared and used everywhere but NEVER saved
   to localStorage or the cloud, and NEVER loaded back on init(). It only
   ever existed as a plain JS variable for the current page session — the
   instant the tab closed or the app reloaded, every archived month was
   gone, with no wipe/clear action involved at all. saveArchives() /
   loadArchives() below fix that: archives now persist locally and sync
   to the cloud like every other dataset, and only disappear via an
   explicit Clear All Data or Wipe Cloud action. ───────────────────── */
const ARCHIVES_KEY = 'abps_archives';
var _archives={};

function saveArchives() {
  try { localStorage.setItem(ARCHIVES_KEY, JSON.stringify(_archives)); } catch(e) {}
}

function loadArchivesLocal() {
  try {
    const raw = localStorage.getItem(ARCHIVES_KEY);
    if (raw) _archives = JSON.parse(raw) || {};
  } catch(e) { /* leave _archives as-is */ }
}

// Additive merge of cloud-synced archives into the local set — never
// drops a locally-known archived month, only fills in ones this device
// doesn't have yet (e.g. archived from another device/session).
function _mergeArchives(remoteArchives) {
  if (!remoteArchives || typeof remoteArchives !== 'object') return;
  let changed = false;
  Object.keys(remoteArchives).forEach(function(yr) {
    if (!_archives[yr]) { _archives[yr] = {}; }
    Object.keys(remoteArchives[yr]).forEach(function(mon) {
      if (!_archives[yr][mon]) {
        _archives[yr][mon] = remoteArchives[yr][mon];
        changed = true;
      }
    });
  });
  if (changed) saveArchives();
}

function archiveMonth(mon,yr){
  var rows=getMonthlyRows(mon,yr);
  if(!rows.length){alert('No completed records for '+MO[mon]+' '+yr);return;}
  if(!_archives[yr])_archives[yr]={};
  var key=MO[mon];
  if(_archives[yr][key]&&!confirm('Overwrite archive for '+key+' '+yr+'?'))return;
  _archives[yr][key]={records:rows,archivedAt:new Date().toISOString(),month:mon,year:yr};
  _savedSupplies=_savedSupplies.filter(function(r){
    if(!r.supplyDate||!r.supplied)return true;
    var d=new Date(r.supplyDate);
    return!(d.getMonth()===mon&&d.getFullYear()===yr);
  });
  saveArchives();
  saveSharedState();
  saveSharedRecords();renderSavedRecords();renderArchivePanel();
  alert('Archived '+rows.length+' records for '+key+' '+yr);
}
function deleteArchive(yr, mon) {
  const arch = _archives[yr] && _archives[yr][mon];
  if (!arch) return;
  const restore = confirm(
    `Delete the ${mon} ${yr} archive (${arch.records.length} record(s))?\n\n` +
    `Click OK to restore those records back into Saved Supply Records first (so the data isn't lost), ` +
    `or Cancel to stop without deleting anything.\n\n` +
    `(To permanently delete without keeping the data, restore it here first, then use "Remove Duplicates" ` +
    `or Delete on the individual record afterward.)`
  );
  if (!restore) return;
  // Restore archived rows back into the live Saved Supply Records list —
  // give any record missing an id a fresh one so it can be edited/deleted normally.
  arch.records.forEach(r => {
    const restored = Object.assign({}, r, {
      id: r.id || (String(r.vessel||'rec').replace(/\s+/g,'_') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,7)),
      vessel: r.vessel || r.name || 'Unknown',
      vlsfoAct: r.vlsfoAct != null ? r.vlsfoAct : (r.vlsfoActual || r.vQ || 0),
      mgoAct:   r.mgoAct   != null ? r.mgoAct   : (r.mgoActual   || r.mQ || 0),
      supplyDate: r.supplyDate || r.date || arch.archivedAt,
      supplied: true
    });
    _savedSupplies.push(restored);
  });
  delete _archives[yr][mon];
  if (!Object.keys(_archives[yr]).length) delete _archives[yr];
  saveArchives();
  saveSharedRecords();
  saveSharedState();
  renderArchivePanel();
  renderSavedRecords();
  showToast(`${mon} ${yr} archive deleted — ${arch.records.length} record(s) restored to Saved Supply Records.`, 'success');
}
function renderArchivePanel(){
  var el=document.getElementById('archive-panel');if(!el)return;
  var years=Object.keys(_archives).sort(function(a,b){return b-a;});
  if(!years.length){el.innerHTML='<p style="font-size:12px;color:var(--muted);padding:8px">No archives yet. Use Monthly Report to archive.</p>';return;}
  var html='';
  for(var yi=0;yi<years.length;yi++){
    var yr=years[yi];
    html+='<div style="margin-bottom:12px"><div style="font-size:11px;font-weight:700;color:var(--sub);text-transform:uppercase;margin-bottom:6px">'+yr+'</div>';
    var months=Object.keys(_archives[yr]).sort(function(a,b){return MO.indexOf(a)-MO.indexOf(b);});
    for(var mi=0;mi<months.length;mi++){
      var mon=months[mi];var arch=_archives[yr][mon];
      var totV=arch.records.reduce(function(a,r){return a+(r.vQ||0);},0);
      var totM=arch.records.reduce(function(a,r){return a+(r.mQ||0);},0);
      var oc="'"+String(yr).replace(/'/g,"\\'")+"','"+String(mon).replace(/'/g,"\\'")+"'";
      html+='<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--surface);border:0.5px solid var(--border);border-radius:8px;margin-bottom:6px;gap:12px">';
      html+='<div><div style="font-size:13px;font-weight:600">'+mon+' '+yr+' <span style="font-size:10px;padding:2px 6px;border-radius:4px;background:var(--azure-lt);color:var(--azure)">READ-ONLY</span></div>';
      html+='<div style="font-size:11px;color:var(--sub);margin-top:2px">'+arch.records.length+' records &middot; VLSFO '+totV.toLocaleString()+' MT &middot; MGO '+totM.toLocaleString()+' MT</div>';
      html+='<div style="font-size:10px;color:var(--muted);margin-top:2px">Archived: '+(arch.archivedAt?new Date(arch.archivedAt).toLocaleString():'unknown date')+'</div></div>';
      html+='<div style="display:flex;gap:6px;flex-shrink:0"><button onclick="openArchiveWindow('+oc+')" style="padding:5px 12px;background:var(--azure-lt);border:0.5px solid var(--azure-bd);border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;color:var(--azure);font-family:DM Sans,sans-serif">View</button>'
        +'<button onclick="deleteArchive('+oc+')" style="padding:5px 12px;background:var(--red-lt);border:0.5px solid #F3C7C0;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;color:var(--red-dk,#9B2C2C);font-family:DM Sans,sans-serif">Delete</button></div></div>';
    }
    html+='</div>';
  }
  el.innerHTML=html;
}
function openArchiveWindow(yr,mon){
  var arch=_archives[yr]&&_archives[yr][mon];if(!arch)return;
  var totV=arch.records.reduce(function(a,r){return a+(parseFloat(r.vQ)||parseFloat(r.vlsfoAct)||parseFloat(r.vlsfoActual)||0);},0);
  var totM=arch.records.reduce(function(a,r){return a+(parseFloat(r.mQ)||parseFloat(r.mgoAct)||parseFloat(r.mgoActual)||0);},0);
  // Build modal inline instead of popup window (popup blockers break window.open)
  var existing=document.getElementById('_archiveModal');
  if(existing)existing.remove();
  var rows='';
  for(var i=0;i<arch.records.length;i++){
    var r=arch.records[i];
    var vv=parseFloat(r.vQ)||parseFloat(r.vlsfoAct)||parseFloat(r.vlsfoActual)||0;
    var mm=parseFloat(r.mQ)||parseFloat(r.mgoAct)||parseFloat(r.mgoActual)||0;
    rows+='<tr><td>'+(r.vessel||r.name||'—')+'</td><td>'+(r.dateStr||r.supplyDate||r.date||'—')+'</td><td>'+(vv>0?Math.round(vv).toLocaleString():'—')+'</td><td>'+(mm>0?Math.round(mm).toLocaleString():'—')+'</td><td>'+(r.barge||r.bargeLabel||'—')+'</td><td>'+(r.area||r.areaCode||'—')+'</td></tr>';
  }
  var modal=document.createElement('div');
  modal.id='_archiveModal';
  modal.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML='<div style="background:var(--surface);border-radius:14px;box-shadow:0 8px 48px rgba(0,0,0,.22);max-width:860px;width:100%;max-height:85vh;display:flex;flex-direction:column;overflow:hidden">'
    +'<div style="padding:18px 20px 14px;border-bottom:1px solid #eee;display:flex;align-items:center;justify-content:space-between">'
    +'<div><div style="font-size:16px;font-weight:700;color:var(--ink)">'+mon+' '+yr+' — Archive</div>'
    +'<div style="font-size:12px;color:var(--muted);margin-top:3px">'+arch.records.length+' records · VLSFO '+Math.round(totV).toLocaleString()+' MT · MGO '+Math.round(totM).toLocaleString()+' MT · Archived: '+new Date(arch.archivedAt).toLocaleDateString()+'</div></div>'
    +'<button onclick="document.getElementById(\'_archiveModal\').remove()" style="background:var(--surface2);border:none;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:600;cursor:pointer;color:var(--ink)">✕ Close</button></div>'
    +'<div style="overflow-y:auto;padding:16px 20px">'
    +'<table style="width:100%;border-collapse:collapse;font-size:12px;font-family:DM Sans,sans-serif">'
    +'<thead><tr style="background:var(--ink-solid);color:#fff"><th style="padding:9px 12px;text-align:left;font-size:10px;letter-spacing:.06em;text-transform:uppercase">Vessel</th><th style="padding:9px 12px;text-align:left;font-size:10px;letter-spacing:.06em;text-transform:uppercase">Date</th><th style="padding:9px 12px;text-align:left;font-size:10px;letter-spacing:.06em;text-transform:uppercase">VLSFO (MT)</th><th style="padding:9px 12px;text-align:left;font-size:10px;letter-spacing:.06em;text-transform:uppercase">MGO (MT)</th><th style="padding:9px 12px;text-align:left;font-size:10px;letter-spacing:.06em;text-transform:uppercase">Barge</th><th style="padding:9px 12px;text-align:left;font-size:10px;letter-spacing:.06em;text-transform:uppercase">Port</th></tr></thead>'
    +'<tbody>'+rows+'</tbody></table></div>'
    +'<div style="padding:12px 20px;border-top:1px solid #eee;display:flex;justify-content:flex-end;gap:8px">'
    +'<button onclick="document.getElementById(\'_archiveModal\').remove()" style="background:var(--ink-solid);color:#fff;border:none;border-radius:8px;padding:8px 20px;font-size:12px;font-weight:600;cursor:pointer;font-family:DM Sans,sans-serif">Close</button>'
    +'</div></div>';
  document.body.appendChild(modal);
  modal.addEventListener('click',function(e){if(e.target===modal)modal.remove();});
}
function _archiveCurrentReport(){
  if(_reportMode==='range'){alert('Switch to monthly mode to archive.');return;}
  var mon=parseInt(document.getElementById('report-month').value),yr=parseInt(document.getElementById('report-year').value);
  archiveMonth(mon,yr);closeMonthlyReport();
  var ap=document.getElementById('archive-panel');if(ap){ap.style.display='block';ap.scrollIntoView({behavior:'smooth',block:'center'});}
  renderArchivePanel();
}
function initializeSystem() {
  _savedSupplies    = [];
  _checklist        = {};
  _checklistRecords = {};
  _trashBin         = [];
  _lastSched        = null;
  _manualROB        = {};
  try { localStorage.removeItem('abps_records'); } catch(e) {}
  if (typeof renderSavedRecords === 'function') renderSavedRecords();
  if (typeof renderTrashBin     === 'function') renderTrashBin();
}

/* ─── Refresh all modules from current nomination data ─── */
function refreshAllModules() {
  // Re-render checklist from latest schedule
  if (_lastSched && _lastSched.length) {
    if (typeof renderChecklist === 'function')      renderChecklist(_lastSched);
    if (typeof renderBargeTabsAndTL === 'function') renderBargeTabsAndTL(_lastSched, getBarges ? getBarges() : []);
  }
  if (typeof renderSavedRecords  === 'function') renderSavedRecords();
  if (typeof renderLiveROBDashboard === 'function') renderLiveROBDashboard();
  if (typeof renderWeekCalendar === 'function')  renderWeekCalendar(_calWeekOffset || 0);
  // Sync alerts page
  refreshAlertsPage();
  // Refresh KPIs
  refreshNominationKPIs();
  refreshScheduleKPIs();
  refreshDashboard();
}

/* ── Alerts page — mirror data from rendered panels ── */
function refreshAlertsPage() {
  // Mirror PAQ panel
  const srcPAQ = document.getElementById('paq-panel');
  const dstPAQ = document.getElementById('alerts-paq-panel');
  if (srcPAQ && dstPAQ) dstPAQ.innerHTML = srcPAQ.innerHTML;

  // Mirror replenishment alerts
  mirrorAlertPanel('ap-v', 'alerts-ap-v');
  mirrorAlertPanel('ap-m', 'alerts-ap-m');

  // Mirror Live ROB
  renderAlertsLiveROB();

  // Mirror reminders
  renderAlertsReminders();

  // Update alerts badge count
  updateAlertsBadge();
}

function mirrorAlertPanel(srcId, dstId) {
  const src = document.getElementById(srcId);
  const dst = document.getElementById(dstId);
  if (!src || !dst) return;
  dst.className = src.className;
  dst.innerHTML = src.innerHTML;
}

function renderAlertsLiveROB() {
  // live-rob-dashboard is now the real element in Alerts & Notices — just refresh it
  renderLiveROBDashboard();
}

function renderAlertsReminders() {
  const src = document.getElementById('reminder-panel');
  const dst = document.getElementById('alerts-reminder-panel');
  if (!src || !dst) return;
  dst.innerHTML = src.innerHTML;
}

function updateAlertsBadge() {
  let count = 0;
  // Count fired replenishment alerts
  const apv = document.getElementById('ap-v');
  const apm = document.getElementById('ap-m');
  if (apv && apv.className.includes('fired')) count++;
  if (apm && apm.className.includes('fired')) count++;
  // Count PAQ pending from nomination cards
  document.querySelectorAll('#vc .vcard[id^="vessel-"]').forEach(card => {
    const cid = card.id.replace('vessel-', '');
    const paqEl = document.getElementById('v' + cid + '-paq');
    if (paqEl && paqEl.value !== 'yes') count++;
  });
  const badge = document.getElementById('nav-badge-alerts');
  if (badge) {
    if (count > 0) { badge.textContent = count; badge.style.display = ''; }
    else badge.style.display = 'none';
  }
}

/* ─── DUPLICATE DETECTION ────────────────────────────────────────────
   Root of the "doubled records / inflated totals" issue: a supply can
   end up saved twice — e.g. a checklist entry gets a new internal uid
   after a schedule is regenerated (its computed supply time shifts by
   a few hours), so the exact-id-based dedupe elsewhere in this file
   never recognizes it as the same delivery. The two rows then look
   like "MT KARACHI" vs "M T KARACHI" on the same day with identical
   quantities, or the exact same row twice — same vessel, same day,
   same MT figures, just a different save-time or a cosmetic spelling
   difference. This fuzzy key catches that pattern: normalize the
   vessel name (strip spaces/punctuation and any "MT"/"M/T" prefix) and
   compare same-vessel + same-calendar-day + matching VLSFO/MGO
   quantities — the parts that would only match by coincidence if two
   different real-world deliveries happened to tie exactly. ────────── */
function _normVesselKey(name) {
  return (name || '')
    .toUpperCase()
    .replace(/\bM\s*\.?\s*\/?\s*T\s*\.?\b/g, '')  // strip MT / M/T / M.T. tokens anywhere
    .replace(/[^A-Z0-9]/g, '');                    // strip remaining spaces/punctuation
}
function _recordDedupeKey(r) {
  const day = r.supplyDate ? new Date(r.supplyDate).toDateString() : (r.dateStr || '');
  const v = Math.round((parseFloat(r.vlsfoAct) || parseFloat(r.vlsfoActual) || parseFloat(r.vQ) || 0) * 100) / 100;
  const m = Math.round((parseFloat(r.mgoAct)   || parseFloat(r.mgoActual)   || parseFloat(r.mQ) || 0) * 100) / 100;
  return _normVesselKey(r.vessel || r.name) + '|' + day + '|' + v + '|' + m;
}
async function removeDuplicateSavedRecords() {
  const sorted = [..._savedSupplies].sort((a, b) => new Date(a.savedAt || 0) - new Date(b.savedAt || 0));
  const seen = new Map();
  const deduped = [];
  const removedList = [];
  sorted.forEach(r => {
    const key = _recordDedupeKey(r);
    if (!key.replace(/\|/g, '')) { deduped.push(r); return; } // nothing to key on — keep, don't guess
    if (seen.has(key)) { removedList.push(r); return; }
    seen.set(key, true);
    deduped.push(r);
  });
  if (!removedList.length) { alert('No duplicate records found — every saved record has a unique vessel, day, and quantity combination.'); return; }
  const preview = removedList.slice(0, 8).map(r => `• ${r.vessel || '—'} — ${r.dateStr || '—'} — VLSFO ${(r.vlsfoAct||0).toLocaleString()} MT / MGO ${(r.mgoAct||0).toLocaleString()} MT`).join('\n');
  const more = removedList.length > 8 ? `\n…and ${removedList.length - 8} more` : '';
  if (!confirm(`Found ${removedList.length} duplicate record(s) — same vessel, day, and quantities. The earliest copy of each will be kept and the rest removed:\n\n${preview}${more}\n\nThis updates the shared workspace for everyone. Continue?`)) return;
  _savedSupplies = deduped;
  await saveSharedRecords();
  renderSavedRecords();
  renderLiveROBDashboard();
  showToast(`Removed ${removedList.length} duplicate record(s).`, 'success');
}

function renderSavedRecords() {
  const el = document.getElementById('saved-records-list'); if (!el) return;
  if (!_savedSupplies.length) {
    el.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:12px 0;text-align:center">No saved records yet. Click "Save ✓" in the checklist to save supply records.</div>';
    return;
  }
  el.innerHTML = [..._savedSupplies].sort((a,b) => new Date(a.supplyDate) - new Date(b.supplyDate)).map(r => `
    <div class="saved-record-row" id="srrow-${r.id}">
      <div class="saved-record-info">
        <div class="saved-record-vessel">
          ${r.vessel}
          <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:${r.supplied?'var(--green-lt)':'var(--amber-lt)'};color:${r.supplied?'var(--green)':'var(--amber)'};border:1px solid ${r.supplied?'var(--green-bd)':'var(--amber-bd)'}">${r.supplied?'Completed':'Pending'}</span>
        </div>
        <div class="saved-record-meta">
           ${r.dateStr} &nbsp;|&nbsp;  ${r.barge||'—'} &nbsp;|&nbsp;
          VLSFO: <strong>${(r.vlsfoAct||r.vlsfoNom||0).toLocaleString()} MT</strong> &nbsp;|&nbsp;
          MGO: <strong>${(r.mgoAct||r.mgoNom||0).toLocaleString()} MT</strong>
          ${r.agent ? `&nbsp;|&nbsp; Agent: ${r.agent}` : ''}
          ${r.spec  ? `&nbsp;|&nbsp; ${r.spec}` : ''}
        </div>
        ${r.notes?`<div style="font-size:11px;color:var(--sub);margin-top:3px"> ${r.notes}</div>`:''}
        <div style="font-size:10px;color:var(--muted);margin-top:3px">Saved: ${new Date(r.savedAt).toLocaleString()}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;align-items:center">
        <button class="btn-ghost" style="font-size:11px;padding:5px 12px;border-color:var(--azure);color:var(--azure)" onclick="openEditRecord('${r.id}')"> Edit</button>
        <button class="btn-danger" style="font-size:11px;padding:5px 10px" onclick="deleteRecord('${r.id}')"> Delete</button>
      </div>
    </div>`).join('');
}

let _editingRecordId = null;
function openEditRecord(id) {
  const r = _savedSupplies.find(x => x.id === id); if (!r) return;
  _editingRecordId = id;
  document.getElementById('er-vessel').value    = r.vessel    || '';
  document.getElementById('er-barge').value     = r.barge     || '';
  document.getElementById('er-agent').value     = r.agent     || '';
  document.getElementById('er-spec').value      = r.spec      || '';
  document.getElementById('er-date').value      = r.dateStr   || '';
  document.getElementById('er-vlsfo-nom').value = r.vlsfoNom  || 0;
  document.getElementById('er-vlsfo-act').value = r.vlsfoAct  || 0;
  document.getElementById('er-mgo-nom').value   = r.mgoNom    || 0;
  document.getElementById('er-mgo-act').value   = r.mgoAct    || 0;
  document.getElementById('er-notes').value     = r.notes     || '';
  document.getElementById('er-supplied').value  = r.supplied ? 'yes' : 'no';
  const diffEl = document.getElementById('er-diff');
  if (diffEl) { diffEl.style.display = 'none'; document.getElementById('er-diff-rows').innerHTML = ''; }
  document.getElementById('edit-record-modal').style.display = 'flex';
}
function closeEditRecord() { document.getElementById('edit-record-modal').style.display = 'none'; _editingRecordId = null; }
async function saveEditRecord() {
  if (!_editingRecordId) return;
  const idx = _savedSupplies.findIndex(x => x.id === _editingRecordId);
  if (idx === -1) return;
  const savedId = _editingRecordId;
  _savedSupplies[idx] = {
    ..._savedSupplies[idx],
    vessel:    document.getElementById('er-vessel').value.trim() || _savedSupplies[idx].vessel,
    barge:     document.getElementById('er-barge').value.trim(),
    agent:     document.getElementById('er-agent').value.trim(),
    spec:      document.getElementById('er-spec').value.trim(),
    dateStr:   document.getElementById('er-date').value || _savedSupplies[idx].dateStr,
    vlsfoNom:  parseFloat(document.getElementById('er-vlsfo-nom').value) || _savedSupplies[idx].vlsfoNom,
    vlsfoAct:  parseFloat(document.getElementById('er-vlsfo-act').value) || 0,
    mgoNom:    parseFloat(document.getElementById('er-mgo-nom').value)   || _savedSupplies[idx].mgoNom,
    mgoAct:    parseFloat(document.getElementById('er-mgo-act').value)   || 0,
    notes:     document.getElementById('er-notes').value.trim(),
    supplied:  document.getElementById('er-supplied').value === 'yes',
    savedAt:   new Date().toISOString(),
  };
  await saveSharedRecords();
  closeEditRecord();
  renderSavedRecords();
  renderLiveROBDashboard();
  showToast('Record updated for ' + (_savedSupplies[idx].vessel || 'vessel'), 'success');
  setTimeout(() => {
    const row = document.getElementById(`srrow-${savedId}`);
    if (row) { row.style.transition='background .2s'; row.style.background='var(--green-lt)'; setTimeout(()=>{ row.style.background=''; },1400); }
  }, 60);
}
function updateEditDiff() {
  if (!_editingRecordId) return;
  const r = _savedSupplies.find(x => x.id === _editingRecordId); if (!r) return;
  const newV  = parseFloat(document.getElementById('er-vlsfo-act').value) || 0;
  const newM  = parseFloat(document.getElementById('er-mgo-act').value)   || 0;
  const newSt = document.getElementById('er-supplied').value === 'yes';
  const diffs = [];
  const diffV = newV - (r.vlsfoAct || r.vlsfoNom || 0);
  const diffM = newM - (r.mgoAct   || r.mgoNom   || 0);
  if (diffV !== 0) diffs.push(`<div style="display:flex;align-items:center;gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:var(--fuel-v);flex-shrink:0"></span><span>VLSFO: <strong>${(r.vlsfoAct||r.vlsfoNom||0).toLocaleString()} MT</strong> → <strong style="color:var(--fuel-v)">${newV.toLocaleString()} MT</strong> <span style="color:${diffV>0?'var(--green)':'var(--red)'};font-weight:700">(${diffV>0?'+':''}${diffV.toLocaleString()} MT)</span></span></div>`);
  if (diffM !== 0) diffs.push(`<div style="display:flex;align-items:center;gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:var(--fuel-m);flex-shrink:0"></span><span>MGO: <strong>${(r.mgoAct||r.mgoNom||0).toLocaleString()} MT</strong> → <strong style="color:var(--fuel-m)">${newM.toLocaleString()} MT</strong> <span style="color:${diffM>0?'var(--green)':'var(--red)'};font-weight:700">(${diffM>0?'+':''}${diffM.toLocaleString()} MT)</span></span></div>`);
  if (newSt !== r.supplied) diffs.push(`<div style="display:flex;align-items:center;gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:var(--amber);flex-shrink:0"></span><span>Status: <strong>${r.supplied?'Completed':'Pending'}</strong> → <strong style="color:${newSt?'var(--green)':'var(--amber)'}">${newSt?'Completed':'Pending'}</strong></span></div>`);
  const diffEl = document.getElementById('er-diff'), rowEl = document.getElementById('er-diff-rows');
  if (diffs.length) { diffEl.style.display='block'; rowEl.innerHTML=diffs.join(''); }
  else { diffEl.style.display='none'; rowEl.innerHTML=''; }
}
async function deleteRecord(id) {
  if (!id) { alert('Cannot delete — record has no ID. Use Edit to find and remove it.'); return; }
  const rec = _savedSupplies.find(r => r.id === id);
  const name = rec ? rec.vessel : 'this record';
  if (!confirm(`Delete supply record for ${name}?\n\nThis removes it from Saved Records, Monthly Report, and Analytics.`)) return;
  _savedSupplies = _savedSupplies.filter(r => r.id !== id);
  // Also remove from checklist records if linked
  Object.values(_checklistRecords).forEach(cr => {
    if (cr.vessel === (rec && rec.vessel)) {
      cr.state = 'draft'; cr.lockedAt = null; cr.actV = 0; cr.actM = 0;
    }
  });
  await saveSharedRecords();
  renderSavedRecords();
  renderLiveROBDashboard();
  renderRemainingSupplyTracker();
  // Refresh reports/analytics page if visible
  if (typeof renderMonthlyPreview === 'function') renderMonthlyPreview(_savedSupplies);
  if (typeof renderReportCharts === 'function') renderReportCharts(_savedSupplies);
  // Flash feedback
  const row = document.getElementById(`rep-row-${id}`);
  if (row) { row.style.transition='opacity .3s'; row.style.opacity='0'; setTimeout(()=>row.remove(),300); }
}
async function confirmClearAllRecords() {
  if (!_savedSupplies.length) { alert('No saved records to clear.'); return; }
  if (!confirm(`Clear all ${_savedSupplies.length} saved record(s)? This cannot be undone.`)) return;
  _savedSupplies = [];
  await saveSharedRecords();
  renderSavedRecords();
}
async function saveSupplyRecord(sno) {
  // Find the record by sno (uid is compound: sno + vessel slug)
  const rec = Object.values(_checklistRecords).find(function(r){ return r.sno === sno; });
  if (rec) {
    await saveChecklistRecord(rec.uid);
  }
}



/* ─── DOWNLOAD ANALYTICS REPORT ─── */
function downloadAnalyticsReport() {
  const recs = _savedSupplies || [];
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});

  // Collect all chart canvases
  const chartIds = ['chart-monthly-trend','chart-fuel-mix','chart-vessel-vol','chart-barge-util'];
  const chartTitles = {
    'chart-monthly-trend': 'Monthly Supply Trend (VLSFO & LSMGO)',
    'chart-fuel-mix':      'Barge Performance — Supplied per Grade',
    'chart-vessel-vol':    'Top Vessels by Volume (VLSFO + LSMGO)',
    'chart-barge-util':    'Barge Utilisation'
  };

  // KPI values
  let totalV=0, totalM=0;
  recs.forEach(r=>{ totalV+=parseFloat(r.vlsfoAct||r.vlsfoActual)||0; totalM+=parseFloat(r.mgoAct||r.mgoActual)||0; });
  const ops = recs.length;
  const avgV = ops ? Math.round(totalV/ops) : 0;

  let chartsHtml = '';
  chartIds.forEach(id => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    try {
      const img = canvas.toDataURL('image/png',1.0);
      chartsHtml += `
        <div style="margin-bottom:32px;page-break-inside:avoid">
          <div style="font-size:11px;font-weight:700;color:var(--ink);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;border-left:3px solid #1565C0;padding-left:8px">${chartTitles[id]||id}</div>
          <img src="${img}" style="width:100%;max-width:720px;border:1px solid #E0E0E0;border-radius:6px" />
        </div>`;
    } catch(e) {}
  });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>FLOW Analytics Report — ${dateStr}</title>
  <style>
    body{font-family:'DM Sans',Arial,sans-serif;margin:0;padding:32px 48px;color:#0F1E30;background:#fff}
    .header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:2px solid #0F1E30;margin-bottom:24px}
    .logo{font-size:22px;font-weight:800;letter-spacing:.05em;color:#0F1E30}
    .logo span{color:#2C5FA8}
    .meta{font-size:11px;color:#555;text-align:right;line-height:1.7}
    .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:28px}
    .kpi{background:#F5F8FF;border:1px solid #C8D8F0;border-radius:8px;padding:14px 16px}
    .kpi-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#555;display:block;margin-bottom:4px}
    .kpi-value{font-size:20px;font-weight:800;color:#2C5FA8;display:block;font-family:monospace}
    .kpi-sub{font-size:9px;color:#888;margin-top:2px}
    .section-title{font-size:14px;font-weight:700;color:#0F1E30;margin:28px 0 16px;border-bottom:1px solid #E0E0E0;padding-bottom:6px}
    @media print{.kpi-grid{break-inside:avoid}}
  </style>
  </head><body>
  <div class="header">
    <div><div class="logo">FLOW <span>Analytics</span></div><div style="font-size:11px;color:#555;margin-top:4px">Bunker Planning System</div></div>
    <div class="meta">Generated: ${now.toLocaleString()}<br>Records: ${ops}<br>Period: All time</div>
  </div>
  <div class="kpi-grid">
    <div class="kpi"><span class="kpi-label">Total VLSFO Delivered</span><span class="kpi-value">${Math.round(totalV).toLocaleString()} MT</span><div class="kpi-sub">All saved records</div></div>
    <div class="kpi"><span class="kpi-label">Total LSMGO Delivered</span><span class="kpi-value">${Math.round(totalM).toLocaleString()} MT</span><div class="kpi-sub">All saved records</div></div>
    <div class="kpi"><span class="kpi-label">Supply Operations</span><span class="kpi-value">${ops}</span><div class="kpi-sub">Completed deliveries</div></div>
    <div class="kpi"><span class="kpi-label">Avg per Delivery</span><span class="kpi-value">${avgV.toLocaleString()} MT</span><div class="kpi-sub">VLSFO average</div></div>
  </div>
  <div class="section-title">Performance Charts</div>
  ${chartsHtml || '<p style="color:#888;font-size:12px">No chart data available. Open Analytics page first to generate charts.</p>'}
  </body></html>`;

  const blob = new Blob([html], {type:'text/html'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `FLOW_Analytics_${now.toISOString().slice(0,10)}.html`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
function downloadChecklist() {
  const records = Object.values(_checklistRecords).sort(_clDateSort);
  if (!records.length) { alert('No checklist records. Generate the schedule first.'); return; }
  const WB = XLSX.utils.book_new(), ws = {};
  const S = {hdr:{font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'0D1B2A'}},alignment:{horizontal:'center'}}};
  const hdrs = ['S.No.','Vessel','Date of Supply','Barge','Nom. VLSFO (MT)','Actual VLSFO (MT)','Nom. MGO (MT)','Actual MGO (MT)','Supplied?','Locked?','Notes'];
  hdrs.forEach((h,c) => ws[XLSX.utils.encode_cell({r:0,c})] = {v:h,t:'s',s:S.hdr});
  records.forEach((rec,i) => {
    const actV = rec.actV !== '' ? parseFloat(rec.actV)||0 : '';
    const actM = rec.actM !== '' ? parseFloat(rec.actM)||0 : '';
    [i+1, rec.vessel, rec.supplyDate ? fmt24(rec.supplyDate) : '—', rec.bargeLabel||'',
     (rec.nomV===null||rec.nomV===undefined)?'':rec.nomV, actV, (rec.nomM===null||rec.nomM===undefined)?'':rec.nomM, actM,
     rec.supplied?'YES':'PENDING', rec.lockedAt?'LOCKED':'', rec.notes||'']
      .forEach((v,c) => ws[XLSX.utils.encode_cell({r:i+1,c})] = {v,t:typeof v==='number'?'n':'s'});
  });
  ws['!ref'] = XLSX.utils.encode_range({s:{r:0,c:0},e:{r:records.length,c:10}});
  ws['!cols'] = [{wch:6},{wch:22},{wch:22},{wch:16},{wch:16},{wch:16},{wch:14},{wch:14},{wch:12},{wch:10},{wch:25}];
  XLSX.utils.book_append_sheet(WB, ws, 'Checklist');
  XLSX.writeFile(WB, 'FLOW_Checklist.xlsx');
}

/* ─── MONTHLY REPORT ─── */
let _reportMode = 'month';
function openMonthlyReport() {
  if (!_lastSched.length && !_savedSupplies.length) { alert('Run schedule or save some records first.'); return; }
  const now = new Date();
  document.getElementById('report-month').value = now.getMonth();
  document.getElementById('report-year').value  = Math.max(2026, now.getFullYear());
  setReportMode('month');
  renderMonthlyPreview();
  document.getElementById('monthly-modal').style.display = 'flex';
}
function closeMonthlyReport() { document.getElementById('monthly-modal').style.display = 'none'; }
function setReportMode(mode) {
  _reportMode = mode;
  document.getElementById('report-mode-month').style.display = mode==='month' ? '' : 'none';
  document.getElementById('report-mode-range').style.display = mode==='range' ? '' : 'none';
  document.getElementById('mode-month-btn').style.background = mode==='month' ? 'var(--azure)' : 'var(--surface)';
  document.getElementById('mode-month-btn').style.color = mode==='month' ? '#fff' : 'var(--sub)';
  document.getElementById('mode-range-btn').style.background = mode==='range' ? 'var(--azure)' : 'var(--surface)';
  document.getElementById('mode-range-btn').style.color = mode==='range' ? '#fff' : 'var(--sub)';
  renderMonthlyPreview();
}
function renderMonthlyPreview() {
  const prev = document.getElementById('monthly-preview'); if (!prev) return;
  let rows, rangeLabel;
  if (_reportMode === 'range') {
    const fromVal = document.getElementById('report-from')?.value, toVal = document.getElementById('report-to')?.value;
    const fromD = fromVal ? parseDT(fromVal) : null, toD = toVal ? parseDT(toVal) : null;
    if (!fromD || !toD) { prev.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:8px 0">Select a From and To date to view the range.</div>'; return; }
    const toEnd = new Date(toD.getFullYear(), toD.getMonth(), toD.getDate(), 23, 59, 59);
    rows = getRowsByRange(fromD, toEnd);
    rangeLabel = `${fmtShort(fromD)} ${fromD.getFullYear()} – ${fmtShort(toD)} ${toD.getFullYear()}`;
  } else {
    const mon = parseInt(document.getElementById('report-month').value), yr = parseInt(document.getElementById('report-year').value);
    rows = getMonthlyRows(mon, yr);
    rangeLabel = `${MO[mon]} ${yr}`;
  }
  if (!rows.length) { prev.innerHTML = `<div style="font-size:12px;color:var(--muted);padding:10px 14px;background:var(--surface);border-radius:8px;border:none;box-shadow:var(--sh-in-xs)">No <strong>completed and saved</strong> supply records found for ${rangeLabel}.<br><span style="font-size:11px">Only supplies marked as  Completed and saved via the checklist appear in Monthly Reports.</span></div>`; return; }
  const totV = rows.reduce((a,r)=>a+(r.vQ||0),0), totM = rows.reduce((a,r)=>a+(r.mQ||0),0);
  prev.innerHTML = `<div style="font-size:12px;color:var(--sub);margin-bottom:8px">${rows.length} record${rows.length>1?'s':''} — <strong>${rangeLabel}</strong></div>
  <table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:var(--ink-solid);color:#fff"><th style="padding:6px 8px;text-align:left">Vessel</th><th style="padding:6px 8px;text-align:left">Date</th><th style="padding:6px 8px;text-align:right">VLSFO</th><th style="padding:6px 8px;text-align:right">MGO</th><th style="padding:6px 8px;text-align:left">Barge</th></tr></thead>
  <tbody>${rows.map(r=>`<tr style="border-bottom:.5px solid var(--border2)"><td style="padding:6px 8px;font-weight:500">${r.name}</td><td style="padding:6px 8px;font-family:DM Mono,monospace">${r.dateStr}</td><td style="padding:6px 8px;text-align:right;font-family:DM Mono,monospace">${r.vQ>0?r.vQ.toLocaleString():'—'}</td><td style="padding:6px 8px;text-align:right;font-family:DM Mono,monospace">${r.mQ>0?r.mQ.toLocaleString():'—'}</td><td style="padding:6px 8px">${r.bargeLabel||'—'}</td></tr>`).join('')}
  <tr style="background:var(--bg);font-weight:700"><td style="padding:6px 8px" colspan="2">TOTAL</td><td style="padding:6px 8px;text-align:right;font-family:DM Mono,monospace">${totV.toLocaleString()} MT</td><td style="padding:6px 8px;text-align:right;font-family:DM Mono,monospace">${totM.toLocaleString()} MT</td><td style="padding:6px 8px"></td></tr>
  </tbody></table>`;
}
setTimeout(() => {
  const rm = document.getElementById('report-month'), ry = document.getElementById('report-year');
  if (rm) rm.addEventListener('change', renderMonthlyPreview);
  if (ry) ry.addEventListener('input', renderMonthlyPreview);
}, 100);
function _getAllReportRecords() {
  // Combine live saved supplies + archived records for Monthly Report visibility
  const base = _savedSupplies || [];
  const archRows = [];
  if (typeof _archives !== 'undefined') {
    Object.values(_archives).forEach(yearObj => {
      Object.values(yearObj).forEach(arch => {
        if (arch && arch.records) {
          arch.records.forEach(r => {
            archRows.push(Object.assign({}, r, {
              vessel: r.vessel || r.name || 'Unknown',
              vlsfoAct: r.vlsfoAct || r.vlsfoActual || r.vQ || 0,
              mgoAct:   r.mgoAct   || r.mgoActual   || r.mQ || 0,
              supplyDate: r.supplyDate || r.date || arch.archivedAt || '',
              supplied: true,
              _fromArchive: true
            }));
          });
        }
      });
    });
  }
  const liveIds = new Set(base.map(r => r.id).filter(Boolean));
  const combined = [...base, ...archRows.filter(r => !r.id || !liveIds.has(r.id))];

  // Final safety net: collapse any remaining near-duplicates (same vessel,
  // same day, same VLSFO/MGO quantities) that slipped past the id-based
  // check above — e.g. a live record and an archived record that are the
  // same delivery but were never given a matching id. Keeps the earliest
  // saved copy of each.
  const seen = new Map();
  const deduped = [];
  [...combined].sort((a, b) => new Date(a.savedAt || a.supplyDate || 0) - new Date(b.savedAt || b.supplyDate || 0))
    .forEach(r => {
      const key = _recordDedupeKey(r);
      if (key.replace(/\|/g, '') && seen.has(key)) return; // duplicate — skip
      if (key.replace(/\|/g, '')) seen.set(key, true);
      deduped.push(r);
    });
  return deduped;
}
function getRowsByRange(fromD, toD) {
  return _getAllReportRecords().filter(r => {
    if (!r.supplyDate) return false;
    const d = new Date(r.supplyDate);
    return d >= fromD && d <= toD && r.supplied === true;
  }).sort((a,b) => new Date(a.supplyDate) - new Date(b.supplyDate))
    .map(r => ({name:r.vessel||r.name, dateStr:r.dateStr||(r.supplyDate?new Date(r.supplyDate).toLocaleDateString():'—'), vQ:parseFloat(r.vlsfoAct)||parseFloat(r.vlsfoNom)||parseFloat(r.vQ)||0, mQ:parseFloat(r.mgoAct)||parseFloat(r.mgoNom)||parseFloat(r.mQ)||0, bargeLabel:r.barge||r.bargeLabel, fromSaved:true, fromArchive:!!r._fromArchive, spec:r.spec, agent:r.agent, notes:r.notes, area:r.area, areaCode:r.areaCode}));
}
function getMonthlyRows(mon, yr) {
  return _getAllReportRecords().filter(r => {
    if (!r.supplyDate) return false;
    const d = new Date(r.supplyDate);
    return d.getMonth() === mon && d.getFullYear() === yr && r.supplied === true;
  }).sort((a,b) => new Date(a.supplyDate) - new Date(b.supplyDate))
    .map(r => ({name:r.vessel||r.name, dateStr:r.dateStr||(r.supplyDate?new Date(r.supplyDate).toLocaleDateString():'—'), vQ:parseFloat(r.vlsfoAct)||parseFloat(r.vlsfoNom)||parseFloat(r.vQ)||0, mQ:parseFloat(r.mgoAct)||parseFloat(r.mgoNom)||parseFloat(r.mQ)||0, bargeLabel:r.barge||r.bargeLabel, fromSaved:true, fromArchive:!!r._fromArchive, spec:r.spec, agent:r.agent, notes:r.notes, area:r.area, areaCode:r.areaCode}));
}
function downloadMonthlyReport() {
  let rows, rangeLabel;
  if (_reportMode==='range') {
    const fromVal=document.getElementById('report-from')?.value,toVal=document.getElementById('report-to')?.value;
    const fromD=fromVal?parseDT(fromVal):null,toD=toVal?parseDT(toVal):null;
    if(!fromD||!toD){alert('Select a From and To date.');return;}
    const toEnd=new Date(toD.getFullYear(),toD.getMonth(),toD.getDate(),23,59,59);
    rows=getRowsByRange(fromD,toEnd);rangeLabel=`${fmtShort(fromD)}-${fmtShort(toD)}_${toD.getFullYear()}`;
  } else {
    const mon=parseInt(document.getElementById('report-month').value),yr=parseInt(document.getElementById('report-year').value);
    rows=getMonthlyRows(mon,yr);rangeLabel=`${MO[mon]}_${yr}`;
  }
  if (!rows.length){alert('No supplies in selected period.');return;}
  const WB=XLSX.utils.book_new(),ws={};
  const S={hdr:{font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'0D1B2A'}},alignment:{horizontal:'center'}},tot:{font:{bold:true},fill:{fgColor:{rgb:'F2F5F9'}}}};
  ws[XLSX.utils.encode_cell({r:0,c:0})]={v:`FLOW Supply Report — ${rangeLabel.replace(/_/g,' ')}`,t:'s',s:{font:{bold:true,sz:13}}};
  ['S.No.','Vessel Name','Date of Supply','VLSFO Qty (MT)','MGO Qty (MT)','Barge'].forEach((h,c)=>ws[XLSX.utils.encode_cell({r:2,c})]={v:h,t:'s',s:S.hdr});
  rows.forEach((r,i)=>[i+1,r.name,r.dateStr,r.vQ||0,r.mQ||0,r.bargeLabel||''].forEach((v,c)=>ws[XLSX.utils.encode_cell({r:3+i,c})]={v,t:typeof v==='number'?'n':'s'}));
  const totRow=3+rows.length,totV=rows.reduce((a,r)=>a+(r.vQ||0),0),totM=rows.reduce((a,r)=>a+(r.mQ||0),0);
  [{v:'',t:'s'},{v:'TOTAL',t:'s'},{v:'',t:'s'},{v:totV,t:'n'},{v:totM,t:'n'},{v:'',t:'s'}].forEach((cell,c)=>ws[XLSX.utils.encode_cell({r:totRow,c})]={...cell,s:S.tot});
  ws['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:totRow,c:5}});
  ws['!cols']=[{wch:6},{wch:22},{wch:22},{wch:15},{wch:15},{wch:16}];
  ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:5}}];
  XLSX.utils.book_append_sheet(WB,ws,'Supply Report');
  XLSX.writeFile(WB,`FLOW_Report_${rangeLabel}.xlsx`);
}

/* ─── DOWNLOAD EXCEL ─── */
function downloadExcel() {
  if (!_lastSched.length) { alert('Run the schedule first.'); return; }
  const WB = XLSX.utils.book_new();
  const S = {
    hdr:{font:{bold:true,color:{rgb:'FFFFFF'},sz:11},fill:{fgColor:{rgb:'0D1B2A'}},alignment:{horizontal:'center',vertical:'center',wrapText:true}},
    ok:{font:{color:{rgb:'1E6E3E'},bold:true},fill:{fgColor:{rgb:'E5F5EC'}},alignment:{horizontal:'center'}},
    dl:{font:{color:{rgb:'C97B00'},bold:true},fill:{fgColor:{rgb:'FFF5E0'}},alignment:{horizontal:'center'}},
    alrt:{font:{color:{rgb:'BE2B2B'},bold:true},fill:{fgColor:{rgb:'FDEAEA'}},alignment:{horizontal:'center'}},
    num:{alignment:{horizontal:'center'}},ctr:{alignment:{horizontal:'center'}},
    def:{alignment:{horizontal:'left',vertical:'center'}},boldL:{font:{bold:true},alignment:{horizontal:'left'}},
    title:{font:{bold:true,sz:14}},sum:{font:{bold:true,sz:12},fill:{fgColor:{rgb:'F2F5F9'}},alignment:{horizontal:'center'}},
  };
  const ws1={}; let r=0;
  ws1[XLSX.utils.encode_cell({r,c:0})]={v:'FLOW — Voyage Schedule',t:'s',s:S.title};
  ws1[XLSX.utils.encode_cell({r,c:2})]={v:'Generated: '+fmt24(new Date()),t:'s',s:{font:{sz:10,color:{rgb:'8A9BAC'}},alignment:{horizontal:'right'}}};
  r+=2;
  const totV=_lastSched.reduce((a,i)=>a+i.vQ,0),totM=_lastSched.reduce((a,i)=>a+i.mQ,0);
  const openV=Object.values(_bargeStates).reduce((s,bs)=>s+bs._openingV,0);
  const openM=Object.values(_bargeStates).reduce((s,bs)=>s+bs._openingM,0);
  const closV=openV-Math.round(totV),closM=openM-Math.round(totM);
  ['Total VLSFO Supplied','Total MGO Supplied','Closing VLSFO ROB','Closing MGO ROB'].forEach((lbl,i)=>{
    ws1[XLSX.utils.encode_cell({r,c:i*2})]={v:lbl,t:'s',s:{font:{sz:10,color:{rgb:'4A6278'}},fill:{fgColor:{rgb:'F2F5F9'}},alignment:{horizontal:'center'}}};
    ws1[XLSX.utils.encode_cell({r,c:i*2+1})]={v:[totV,totM,closV,closM][i].toLocaleString()+' MT',t:'s',s:S.sum};
  }); r+=2;
  const hdrs=['S.No.','Vessel Name','Anchorage','FO (MT)','MGO (MT)','Spec','Nominated Laycan','Actual ETA','Supply Start','ETC','Supply Plan','Laycan Status','Agent','Sampling / Manifold'];
  hdrs.forEach((h,c)=>{ws1[XLSX.utils.encode_cell({r,c})]={v:h,t:'s',s:S.hdr};}); r++;
  _lastSched.forEach((item,idx)=>{
    const seq  = classifySeq(item, idx, _lastSched);
    const plan = seq.label;
    const areaLabel=AREA_OPTIONS.find(o=>o.value===item.area)?.label||item.area||'—';
    const nomV=(item.nomVQ!==undefined&&item.nomVQ!==null)?item.nomVQ:item.vQ, nomM=(item.nomMQ!==undefined&&item.nomMQ!==null)?item.nomMQ:item.mQ;
    [{v:item.sno,t:'n',s:S.num},{v:item.name,t:'s',s:S.boldL},{v:areaLabel,t:'s',s:S.ctr},
     {v:nomV||'—',t:nomV?'n':'s',s:S.num},{v:nomM||'—',t:nomM?'n':'s',s:S.num},
     {v:item.spec||'—',t:'s',s:S.def},{v:fmtLC(item.lc),t:'s',s:S.ctr},{v:fmt24(item.eta),t:'s',s:S.ctr},
     {v:fmt24(item.bargeStart),t:'s',s:S.ctr},{v:fmt24(item.etc),t:'s',s:S.ctr},
     {v:plan,t:'s',s:{font:{sz:10,color:{rgb:'1A6FD4'}},fill:{fgColor:{rgb:'EBF3FD'}},alignment:{horizontal:'center'}}},
     {v:item.isDelayed?'Delayed':'On Laycan',t:'s',s:item.isDelayed?S.dl:S.ok},
     {v:item.agent||'—',t:'s',s:S.def},{v:item.mani||'—',t:'s',s:S.def},
    ].forEach((cell,c)=>{ws1[XLSX.utils.encode_cell({r,c})]= cell;}); r++;
  });
  ws1['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r,c:hdrs.length-1}});
  ws1['!cols']=[{wch:6},{wch:20},{wch:14},{wch:10},{wch:10},{wch:16},{wch:18},{wch:22},{wch:22},{wch:22},{wch:22},{wch:14},{wch:12},{wch:22}];
  XLSX.utils.book_append_sheet(WB,ws1,'Voyage Schedule');
  XLSX.writeFile(WB,`FLOW_Schedule_${fmt24(new Date()).replace(/\s+/g,'-').replace(/:/g,'')}.xlsx`);
}


/* ── Download Schedule as PDF (print-to-PDF the voyage table) ── */
function downloadBargePDF(bargeId) {
  if (!_lastSched || !_lastSched.length) { alert('Generate the schedule first.'); return; }
  const b = _bargeConfig.find(x => x.id == bargeId);
  if (!b) return;
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) + ' ' + now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + ' UTC';

  // Get the table for this specific barge only
  const tabEl = document.getElementById('voy-tab-' + bargeId);
  const tbl = tabEl ? tabEl.querySelector('.voy-tbl') : null;

  // Fallback: single barge - get first table in voy-barge-tabs
  const singleTbl = !tbl ? document.querySelector('#voy-barge-tabs .voy-tbl') : null;
  const targetTbl = tbl || singleTbl;

  if (!targetTbl) { alert('No schedule table found for ' + b.name + '. Generate schedule first.'); return; }

  // Only ticked rows go into the PDF — same selection the Print/Download as
  // Image actions already respect. Work on a CLONE of the table (never the
  // live DOM) so unchecked rows and the checkbox column are genuinely
  // removed from the captured HTML, not just visually hidden — the live
  // table on screen is completely untouched by this function.
  const allChecks = Array.from(targetTbl.querySelectorAll('.voy-print-chk'));
  const checkedCount = allChecks.filter(c => c.checked).length;
  if (allChecks.length && checkedCount === 0) {
    alert('No vessels selected.\nUse the Print checkboxes in the Voyage Schedule table to choose which vessels to include in the PDF.');
    return;
  }

  const tblClone = targetTbl.cloneNode(true);
  if (allChecks.length) {
    // Remove unchecked rows entirely from the clone
    Array.from(tblClone.querySelectorAll('.voy-print-chk')).forEach(chk => {
      if (!chk.checked) {
        const row = chk.closest('tr');
        if (row) row.remove();
      }
    });
    // Remove the checkbox column entirely (header + every remaining row)
    tblClone.querySelectorAll('tr').forEach(row => {
      const firstCell = row.querySelector('th, td');
      if (firstCell && (firstCell.querySelector('.voy-print-chk') || firstCell.querySelector('#voy-select-all'))) {
        firstCell.remove();
      }
    });
  }

  const tableHtml = tblClone.outerHTML;

  if (!tableHtml) { alert('No schedule table found for ' + b.name + '. Generate schedule first.'); return; }

  const pdfWin = window.open('','_blank','width=1200,height=800');
  if (!pdfWin) { alert('Popup blocked. Allow popups for PDF export.'); return; }

  pdfWin.document.write(`<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>${b.name} — Bunker Schedule ${dateStr}</title>
<style>
  @page { size: A3 landscape; margin: 10mm 8mm; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Segoe UI',Arial,sans-serif; font-size:9pt; color:#0F1E30; background:#fff; }
  .hdr { display:flex; align-items:center; justify-content:space-between; padding:10px 0 8px; border-bottom:2px solid #0F1E30; margin-bottom:12px; }
  .hdr-title { font-size:16pt; font-weight:700; color:#0F1E30; }
  .hdr-barge { display:inline-block; padding:3px 12px; background:#0F1E30; color:#fff; border-radius:20px; font-size:9pt; font-weight:700; margin-top:4px; }
  .hdr-meta { text-align:right; font-size:8.5pt; color:#7891A8; }
  table { width:100%; border-collapse:collapse; font-size:7.5pt; }
  thead { background:#0F1E30; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  th { color:rgba(255,255,255,.72); padding:5px 6px; text-align:left; font-size:7pt; font-weight:700; letter-spacing:.06em; white-space:nowrap; text-transform:uppercase; }
  td { padding:5px 6px; border-bottom:0.5pt solid #E2E8F0; vertical-align:middle; }
  tr:nth-child(even) td { background:#F8FAFC; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .stag { font-size:6.5pt; font-weight:700; padding:1px 5px; border-radius:10px; display:inline-block; border:1px solid; }
  .st-ok { background:#DCFCE7; color:#15803D; border-color:#86EFAC; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .st-dl { background:#FEF3C7; color:#B45309; border-color:#F59E0B; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .lc-rng { font-family:monospace; font-size:7pt; font-weight:600; }
  .lc-rng.in { color:#15803D; } .lc-rng.out { color:#B45309; }
  .footer { margin-top:14px; padding-top:8px; border-top:1px solid #E2E8F0; font-size:7.5pt; color:#7891A8; text-align:center; }
  @media print { .no-print { display:none; } }
</style>
</head><body>
<div class="hdr">
  <div>
    <div class="hdr-title">Bunker Schedule — Voyage Plan</div>
    <div class="hdr-barge">${b.name}</div>
  </div>
  <div class="hdr-meta">
    <div><strong>Generated:</strong> ${dateStr}</div>
    <div><strong>Vessels:</strong> ${(_lastSched||[]).filter(x=>(x.bargeLabel||'')===(b.name)).length}</div>
  </div>
</div>
${tableHtml}
<div class="footer">FLOW — Bunker Planning System · ${b.name} Schedule · System-generated for operational reference only.</div>
<div class="no-print" style="text-align:center;margin:20px;padding:16px;background:#f0f3f8;border-radius:8px;font-family:sans-serif">
  <strong>Ctrl+P / Cmd+P</strong> → Select <em>Save as PDF</em>
  <br><button onclick="window.print()" style="margin-top:10px;padding:8px 20px;background:#1565C0;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer">Print / Save as PDF</button>
</div>
</body></html>`);
  pdfWin.document.close();
  setTimeout(()=>{ try { pdfWin.focus(); pdfWin.print(); } catch(e){} }, 600);
}

function downloadSchedulePDF() {
  // Redirect to first barge PDF for backwards compatibility
  if (_bargeConfig && _bargeConfig.length) downloadBargePDF(_bargeConfig[0].id);
}


function downloadExcelForBarge(bargeId) {
  if (!_lastSched.length){alert('Run schedule first.');return;}
  const b=_bargeConfig.find(x=>x.id===bargeId);if(!b)return;
  const rows=_lastSched.filter(item=>item.bargeLabel===b.name);
  if(!rows.length){alert(`No vessels assigned to ${b.name}.`);return;}
  const WB=XLSX.utils.book_new(),ws={};
  const S={hdr:{font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'0D1B2A'}},alignment:{horizontal:'center',wrapText:true}}};
  ws[XLSX.utils.encode_cell({r:0,c:0})]={v:`Voyage Schedule — ${b.name}`,t:'s',s:{font:{bold:true,sz:13}}};
  ['S.No.','Vessel','Anchorage','FO (MT)','MGO (MT)','Spec','Nominated Laycan','Actual ETA','Supply Start','ETC','Supply Plan','Laycan Status','PAQ','Agent','Sampling/Manifold'].forEach((h,c)=>ws[XLSX.utils.encode_cell({r:2,c})]={v:h,t:'s',s:S.hdr});
  rows.forEach((item,i)=>{
    const areaLabel=AREA_OPTIONS.find(o=>o.value===item.area)?.label||item.area||'';
    const seqXl = classifySeq(item, i, rows);
    const nomV=(item.nomVQ!==undefined&&item.nomVQ!==null)?item.nomVQ:item.vQ, nomM=(item.nomMQ!==undefined&&item.nomMQ!==null)?item.nomMQ:item.mQ;
    [item.sno,item.name,areaLabel,nomV||0,nomM||0,item.spec||'',fmtLC(item.lc),fmt24(item.eta),fmt24(item.bargeStart),fmt24(item.etc),seqXl.label,item.isDelayed?'Delayed':'On Laycan',item.paq==='yes'?'Received':'Pending',item.agent||'',item.mani||''].forEach((v,c)=>ws[XLSX.utils.encode_cell({r:3+i,c})]={v,t:typeof v==='number'?'n':'s'});
  });
  ws['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:3+rows.length-1,c:14}});
  ws['!cols']=[{wch:6},{wch:20},{wch:14},{wch:10},{wch:10},{wch:14},{wch:18},{wch:22},{wch:22},{wch:22},{wch:20},{wch:14},{wch:10},{wch:12},{wch:22}];
  XLSX.utils.book_append_sheet(WB,ws,b.name.substring(0,30));
  XLSX.writeFile(WB,`FLOW_${b.name.replace(/\s+/g,'_')}_${fmt24(new Date()).replace(/\s+/g,'-').replace(/:/g,'')}.xlsx`);
}

/* ─── BARGE SYSTEM ─── */
/* ═══════════════════════════════════════════════════
   WEEKLY SUPPLY CALENDAR
   ═══════════════════════════════════════════════════ */
let _calWeekOffset = 0; // days offset from today

function shiftWeekCal(days) {
  _calWeekOffset = (days === 0) ? 0 : _calWeekOffset + days;
  renderWeekCalendar(_calWeekOffset);
}

function renderWeekCalendar(offsetDays) {
  _calWeekOffset = offsetDays;
  const el = document.getElementById('week-calendar');
  if (!el) return;

  const today = new Date();
  today.setHours(0,0,0,0);
  const weekStart = new Date(today.getTime() + offsetDays * 86400000);

  // Build 7 day slots
  const days = Array.from({length:7}, (_,i) => {
    const d = new Date(weekStart.getTime() + i * 86400000);
    return d;
  });

  // Update header label
  const lblEl = document.getElementById('week-cal-label');
  if (lblEl) {
    const s = days[0].toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
    const e = days[6].toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
    lblEl.textContent = s + ' – ' + e;
  }

  // Build set of completed vessel names (from _checklistRecords)
  var completedVessels = new Set();
  Object.values(_checklistRecords || {}).forEach(function(rec) {
    if (rec.state === 'completed' || rec.state === 'saved') completedVessels.add(rec.vessel);
  });
  (_savedSupplies || []).forEach(function(r) { if (r.supplied) completedVessels.add(r.vessel); });

  // Gather supply items from _lastSched — match by ETA date, exclude completed
  const allItems = (_lastSched || []).map(item => {
    const raw = item.bargeStart || item.eta;
    const d = raw ? (raw instanceof Date ? raw : new Date(raw)) : null;
    return { ...item, _etaDate: d };
  }).filter(x => x._etaDate && !isNaN(x._etaDate) && !completedVessels.has(x.name));

  // Fallback from nominations
  let fallbackItems = [];
  if (!allItems.length) {
    document.querySelectorAll('#vc .vcard[id^="vessel-"]').forEach(card => {
      const cid = card.id.replace('vessel-','');
      const name  = document.getElementById('v'+cid+'-name')?.value   || ('Vessel '+cid);
      const ty    = document.getElementById('v'+cid+'-type')?.value    || 'BOTH';
      const v     = ty!=='MGO'   ? (parseFloat(document.getElementById('v'+cid+'-vlsfo')?.value)||0) : 0;
      const m     = ty!=='VLSFO' ? (parseFloat(document.getElementById('v'+cid+'-mgo')?.value)||0)   : 0;
      const fp    = document.getElementById('v'+cid+'-eta')?._flatpickr;
      const d     = fp?.selectedDates?.[0] || null;
      if ((v||m) && d) fallbackItems.push({ name, vQ:v, mQ:m, _etaDate:new Date(d), bargeLabel:'', area:'' });
    });
  }
  const source = allItems.length ? allItems : fallbackItems;

  // Grade colour helpers — mapped to the app's own design tokens, not ad-hoc hex
  const gradeColor = (v,m) => v>0&&m>0
    ? { bg:'var(--purple-lt)', border:'var(--purple)',  text:'var(--purple)', label:'BOTH'  }
    : v>0
    ? { bg:'var(--fuel-v-lt)', border:'var(--fuel-v)',  text:'var(--fuel-v)', label:'VLSFO' }
    : { bg:'var(--fuel-m-lt)', border:'var(--fuel-m)',  text:'var(--fuel-m)', label:'LSMGO' };

  const fmt  = d => d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  const dow  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Inline SVG icon set — replaces emoji glyphs for a consistent, professional look
  const ICO_CLOCK  = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
  const ICO_PIN    = '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
  const ICO_BARGE  = '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M2 16l1.5 4h17L22 16"/><path d="M4 16V8l8-4 8 4v8"/></svg>';

  // ISO-style week number, for the technical "WK NN" designator
  const jan1 = new Date(weekStart.getFullYear(),0,1);
  const wkNum = Math.ceil((((weekStart - jan1) / 86400000) + jan1.getDay() + 1) / 7);
  const wkLbl = document.getElementById('week-cal-wk');
  if (wkLbl) wkLbl.textContent = 'WK ' + String(wkNum).padStart(2,'0');

  // Build HTML — 7 columns, ruled like a spec table rather than soft cards
  let colsHtml = '';
  let totalV7=0, totalM7=0, totalOps7=0;

  days.forEach((day, dayIdx) => {
    const isToday = day.toDateString() === new Date().toDateString();
    const isPast  = day < today;
    const isLast  = dayIdx === days.length - 1;
    const dayItems = source.filter(x => x._etaDate.toDateString() === day.toDateString())
      .sort((a,b) => a._etaDate - b._etaDate);

    totalOps7 += dayItems.length;
    dayItems.forEach(x => { totalV7+=((x.nomVQ!==undefined&&x.nomVQ!==null)?x.nomVQ:(x.vQ||0)); totalM7+=((x.nomMQ!==undefined&&x.nomMQ!==null)?x.nomMQ:(x.mQ||0)); });

    const dayTotalV = dayItems.reduce((s,x)=>s+((x.nomVQ!==undefined&&x.nomVQ!==null)?x.nomVQ:(x.vQ||0)),0);
    const dayTotalM = dayItems.reduce((s,x)=>s+((x.nomMQ!==undefined&&x.nomMQ!==null)?x.nomMQ:(x.mQ||0)),0);
    const hasSup = dayItems.length > 0;

    colsHtml += `<div style="
      flex:1;min-width:0;display:flex;flex-direction:column;
      border-right:${isLast?'none':'1px solid var(--border)'};
      background:${isToday?'var(--azure-lt)':'transparent'};
      ${isPast?'opacity:.55':''}
    ">
      <!-- Day header — ruled cell, tabular date, hairline rule -->
      <div style="
        padding:9px 6px 8px;
        border-bottom:1px solid var(--border);
        border-top:3px solid ${isToday?'var(--azure)':'transparent'};
        background:var(--surface2);
        text-align:center;
      ">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);font-family:'DM Mono',monospace">${dow[day.getDay()]}</div>
        <div style="font-size:19px;font-weight:700;font-family:'DM Mono',monospace;color:${isToday?'var(--azure)':'var(--ink)'};line-height:1.25;margin-top:2px;letter-spacing:-.02em;font-variant-numeric:tabular-nums">${String(day.getDate()).padStart(2,'0')}</div>
        <div style="font-size:9px;font-weight:600;color:var(--muted);font-family:'DM Mono',monospace;text-transform:uppercase;letter-spacing:.06em">${months[day.getMonth()]}</div>
        ${hasSup?`<div style="margin-top:5px;font-size:8.5px;font-weight:700;padding:1px 7px;border:1px solid ${isToday?'var(--azure)':'var(--azure-bd)'};border-radius:3px;color:var(--azure);display:inline-block;letter-spacing:.03em;font-family:'DM Mono',monospace">${dayItems.length} OP${dayItems.length>1?'S':''}</div>`:`<div style="margin-top:5px;height:19px"></div>`}
      </div>

      <!-- Day total strip — tabular figures, ruled not shadowed -->
      ${hasSup ? `<div style="padding:6px 6px;border-bottom:1px solid var(--border);background:var(--surface);display:flex;gap:4px;flex-wrap:wrap;justify-content:center">
        ${dayTotalV>0?`<span style="font-size:9px;font-weight:700;padding:1px 5px;border:1px solid var(--fuel-v-bd);border-radius:2px;color:var(--fuel-v);font-family:'DM Mono',monospace;font-variant-numeric:tabular-nums">V·${dayTotalV.toLocaleString()}</span>`:''}
        ${dayTotalM>0?`<span style="font-size:9px;font-weight:700;padding:1px 5px;border:1px solid var(--fuel-m-bd);border-radius:2px;color:var(--fuel-m);font-family:'DM Mono',monospace;font-variant-numeric:tabular-nums">M·${dayTotalM.toLocaleString()}</span>`:''}
      </div>` : ''}

      <!-- Vessel manifest entries -->
      <div style="flex:1;padding:6px;display:flex;flex-direction:column;gap:5px;overflow-y:auto;max-height:280px;background:var(--surface)">
        ${dayItems.length ? dayItems.map(item => {
          const calNomV=(item.nomVQ!==undefined&&item.nomVQ!==null)?item.nomVQ:(item.vQ||0), calNomM=(item.nomMQ!==undefined&&item.nomMQ!==null)?item.nomMQ:(item.mQ||0);
          const gc = gradeColor(calNomV, calNomM);
          const etaTime = fmt(item._etaDate);
          const loc = item.area || item.anchorage || item.location || '';
          const barge = item.bargeLabel || '';
          const hasSno = item.sno !== undefined && item.sno !== null;
          return `<div style="
            background:var(--bg);
            border:1px solid var(--border);
            border-left:3px solid ${gc.border};
            border-radius:3px;
            padding:6px 7px;
            ${hasSno?'cursor:pointer':'cursor:default'};
            transition:border-color .12s, transform .12s;
          " class="${hasSno?'cal-ticket-clickable':''}" ${hasSno?`onclick="_globalSearchGoSchedule(${JSON.stringify(String(item.sno))})"`:''} title="${item.name}&#10;ETA: ${etaTime}&#10;VLSFO: ${calNomV.toLocaleString()} MT | MGO: ${calNomM.toLocaleString()} MT${loc?'&#10;'+loc:''}${barge?'&#10;'+barge:''}${hasSno?'&#10;Click to open in Schedule':''}">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
              <span style="font-family:'DM Mono',monospace;font-size:8.5px;font-weight:700;color:var(--muted);display:flex;align-items:center;gap:3px;font-variant-numeric:tabular-nums">${ICO_CLOCK}${etaTime}</span>
              <span style="font-size:7.5px;font-weight:700;padding:1px 4px;border:1px solid ${gc.border};border-radius:2px;color:${gc.text};letter-spacing:.03em;font-family:'DM Mono',monospace">${gc.label}</span>
            </div>
            <div style="font-size:10.5px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;line-height:1.35;margin-top:4px">${item.name}</div>
            <div style="display:flex;gap:8px;margin-top:4px;font-family:'DM Mono',monospace;font-size:9.5px;font-weight:700;font-variant-numeric:tabular-nums">
              ${calNomV>0?`<span style="color:var(--fuel-v)">V&nbsp;${calNomV.toLocaleString()}</span>`:''}
              ${calNomM>0?`<span style="color:var(--fuel-m)">M&nbsp;${calNomM.toLocaleString()}</span>`:''}
            </div>
            ${barge||loc?`<div style="margin-top:4px;padding-top:4px;border-top:1px solid var(--border2);display:flex;flex-direction:column;gap:2px">
              ${barge?`<div style="font-size:8.5px;color:var(--muted);font-weight:600;display:flex;align-items:center;gap:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:'DM Mono',monospace">${ICO_BARGE}${barge}</div>`:''}
              ${loc?`<div style="font-size:8.5px;color:var(--muted);font-weight:600;display:flex;align-items:center;gap:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:'DM Mono',monospace">${ICO_PIN}${loc}</div>`:''}
            </div>`:''}
          </div>`;
        }).join('') : `<div style="flex:1;display:flex;align-items:center;justify-content:center;padding:16px 4px;text-align:center">
          <span style="font-size:9.5px;color:var(--muted);font-weight:600;font-family:'DM Mono',monospace;text-transform:uppercase;letter-spacing:.04em">No Supply</span>
        </div>`}
      </div>
    </div>`;
  });

  // Week summary footer — ruled data strip, tabular figures, technical legend
  const footerHtml = `<div style="
    display:flex;align-items:center;gap:16px;padding:11px 14px;
    background:var(--surface2);border-top:1px solid var(--border);
    flex-wrap:wrap
  ">
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-family:'DM Mono',monospace">Week Total</span>
      <span style="font-size:14px;font-weight:700;color:var(--ink);font-family:'DM Mono',monospace;font-variant-numeric:tabular-nums">${totalOps7}</span>
      <span style="font-size:10px;color:var(--sub);font-weight:600">operation${totalOps7!==1?'s':''}</span>
    </div>
    ${totalV7>0?`<div style="display:flex;align-items:center;gap:6px;padding-left:14px;border-left:1px solid var(--border)"><span style="width:8px;height:8px;border-radius:2px;background:var(--fuel-v);display:inline-block"></span><span style="font-size:11.5px;font-family:'DM Mono',monospace;color:var(--fuel-v);font-weight:700;font-variant-numeric:tabular-nums">${totalV7.toLocaleString()} MT</span><span style="font-size:10px;color:var(--muted);font-weight:600">VLSFO</span></div>`:''}
    ${totalM7>0?`<div style="display:flex;align-items:center;gap:6px;padding-left:14px;border-left:1px solid var(--border)"><span style="width:8px;height:8px;border-radius:2px;background:var(--fuel-m);display:inline-block"></span><span style="font-size:11.5px;font-family:'DM Mono',monospace;color:var(--fuel-m);font-weight:700;font-variant-numeric:tabular-nums">${totalM7.toLocaleString()} MT</span><span style="font-size:10px;color:var(--muted);font-weight:600">LSMGO</span></div>`:''}
    ${!totalOps7?`<span style="font-size:11.5px;color:var(--muted);font-weight:600">No supplies scheduled this week — generate a schedule to populate the calendar</span>`:''}
    <span style="margin-left:auto;display:flex;gap:14px">
      <span style="font-size:9px;font-weight:600;color:var(--sub);display:flex;align-items:center;gap:5px;font-family:'DM Mono',monospace"><span style="width:8px;height:8px;border-radius:2px;background:var(--fuel-v);display:inline-block"></span>VLSFO</span>
      <span style="font-size:9px;font-weight:600;color:var(--sub);display:flex;align-items:center;gap:5px;font-family:'DM Mono',monospace"><span style="width:8px;height:8px;border-radius:2px;background:var(--fuel-m);display:inline-block"></span>LSMGO</span>
      <span style="font-size:9px;font-weight:600;color:var(--sub);display:flex;align-items:center;gap:5px;font-family:'DM Mono',monospace"><span style="width:8px;height:8px;border-radius:2px;background:var(--purple);display:inline-block"></span>BOTH</span>
    </span>
  </div>`;

  el.innerHTML = `
    <div style="border:1px solid var(--border);border-radius:var(--radius-xs);overflow:hidden;background:var(--surface)">
      <div style="display:flex;min-height:340px">
        ${colsHtml}
      </div>
      ${footerHtml}
    </div>`;
}


let _reloadBargeId = null;

function openReloadModal(bargeId) {
  _reloadBargeId = bargeId;
  const b = _bargeConfig.find(x => x.id == bargeId);
  if (!b) return;
  const liveROBs = getAllLiveROBs();
  const rob = liveROBs[bargeId];
  const curV = rob ? Math.round(rob.liveV) : 0;
  const curM = rob ? Math.round(rob.liveM) : 0;

  document.getElementById('reload-barge-sub').textContent = b.name + ' — current ROB + reload = new ROB';
  document.getElementById('reload-cur-v').textContent = curV.toLocaleString();
  document.getElementById('reload-cur-m').textContent = curM.toLocaleString();
  document.getElementById('reload-vlsfo').value = 0;
  document.getElementById('reload-mgo').value = 0;
  document.getElementById('reload-note').value = '';
  document.getElementById('reload-preview').style.display = 'none';
  document.getElementById('reload-modal').style.display = 'flex';
}

function closeReloadModal() {
  document.getElementById('reload-modal').style.display = 'none';
  _reloadBargeId = null;
}

function updateReloadPreview() {
  const bargeId = _reloadBargeId;
  if (!bargeId) return;
  const liveROBs = getAllLiveROBs();
  const rob = liveROBs[bargeId];
  const curV = rob ? rob.liveV : 0;
  const curM = rob ? rob.liveM : 0;
  const addV = parseFloat(document.getElementById('reload-vlsfo').value) || 0;
  const addM = parseFloat(document.getElementById('reload-mgo').value) || 0;

  const newV = Math.round(curV + addV);
  const newM = Math.round(curM + addM);
  const prev = document.getElementById('reload-preview');
  if (addV > 0 || addM > 0) {
    prev.style.display = 'grid';
    document.getElementById('reload-new-v').textContent = newV.toLocaleString();
    document.getElementById('reload-new-m').textContent = newM.toLocaleString();
  } else {
    prev.style.display = 'none';
  }
}

async function saveReloadQty() {
  const bargeId = _reloadBargeId;
  const b = _bargeConfig.find(x => x.id == bargeId);
  if (!b) return;

  const addV = parseFloat(document.getElementById('reload-vlsfo').value) || 0;
  const addM = parseFloat(document.getElementById('reload-mgo').value) || 0;
  if (addV <= 0 && addM <= 0) { alert('Enter at least one reloaded quantity greater than zero.'); return; }

  const liveROBs = getAllLiveROBs();
  const rob = liveROBs[bargeId];
  const curV = rob ? rob.liveV : 0;
  const curM = rob ? rob.liveM : 0;
  const newV = Math.max(0, curV + addV);
  const newM = Math.max(0, curM + addM);
  const note = document.getElementById('reload-note').value.trim() || 'Reload';
  const ts = new Date().toISOString();

  // Store as final override (new ROB = current + reloaded)
  if (!_manualROB) _manualROB = {};
  _manualROB[bargeId + '_final'] = { v: newV, m: newM, reason: 'Reload: +' + addV + ' VLSFO +' + addM + ' MGO. ' + note, editedAt: ts, editedBy: 'Reload' };

  // Log it
  _robAuditLog.push({ bargeId, bargeName: b.name, field: 'RELOAD', oldVal: Math.round(curV), newVal: Math.round(newV), reason: note, editedAt: ts, editedBy: 'Reload' });
  if (addM > 0) _robAuditLog.push({ bargeId, bargeName: b.name, field: 'MGO RELOAD', oldVal: Math.round(curM), newVal: Math.round(newM), reason: note, editedAt: ts, editedBy: 'Reload' });

  // Also update _bargeStates so scheduler knows new ROB
  if (_bargeStates[bargeId]) { _bargeStates[bargeId].rv = newV; _bargeStates[bargeId].rm = newM; }
  // Update barge config opening ROB so it flows into all future calculations
  const bcIdx = _bargeConfig.findIndex(x => x.id == bargeId);
  if (bcIdx >= 0) {
    _bargeConfig[bcIdx] = { ..._bargeConfig[bcIdx], receivedV: (_bargeConfig[bcIdx].receivedV||0) + addV, receivedM: (_bargeConfig[bcIdx].receivedM||0) + addM };
  }

  await saveManualROB();
  await saveROBAudit();
  await saveSharedState();

  closeReloadModal();
  renderLiveROBDashboard();
  renderRemainingSupplyTracker();
  renderBargeROBSummaryFromLive();

  // Confirmation
  showToast('Reload saved — ' + b.name + ': VLSFO ' + Math.round(newV).toLocaleString() + ' MT | MGO ' + Math.round(newM).toLocaleString() + ' MT', 'success');
}
function openCalcParamsEdit() {
  document.getElementById('calc-hose-input').value   = _calcParams.hoseHrs;
  document.getElementById('calc-travel-input').value = _calcParams.travelHrs;
  document.getElementById('calc-view').style.display  = 'none';
  document.getElementById('calc-edit').style.display  = '';
  const btn = document.getElementById('calc-edit-btn');
  if (btn) { btn.style.background='var(--amber-lt)'; btn.style.borderColor='var(--amber-bd)'; btn.style.color='var(--amber)'; btn.innerHTML='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Cancel'; btn.onclick=closeCalcParamsEdit; }
}
function closeCalcParamsEdit() {
  document.getElementById('calc-view').style.display  = '';
  document.getElementById('calc-edit').style.display  = 'none';
  const btn = document.getElementById('calc-edit-btn');
  if (btn) { btn.style.background=''; btn.style.borderColor=''; btn.style.color=''; btn.innerHTML='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Parameters'; btn.onclick=openCalcParamsEdit; }
}
function saveCalcParamsEdit() {
  const h = parseFloat(document.getElementById('calc-hose-input').value);
  const t = parseFloat(document.getElementById('calc-travel-input').value);
  if (isNaN(h)||h<0||isNaN(t)||t<0) { alert('Enter valid positive numbers for both fields.'); return; }
  _calcParams.hoseHrs   = h;
  _calcParams.travelHrs = t;
  saveCalcParams();
  renderCalcParamsView();
  closeCalcParamsEdit();
  const card = document.getElementById('calc-params-card');
  if (card) { card.style.transition='box-shadow .2s'; card.style.boxShadow='0 0 0 2px var(--green)'; setTimeout(()=>card.style.boxShadow='',1000); }
}
function renderCalcParamsView() {
  const h = _calcParams.hoseHrs, t = _calcParams.travelHrs;
  const hEl = document.getElementById('calc-view-hose');
  const tEl = document.getElementById('calc-view-travel');
  const fEl = document.getElementById('calc-view-formulas');
  if (hEl) hEl.textContent = h + (h===1?' hr':' hrs');
  if (tEl) tEl.textContent = t + (t===1?' hr':' hrs');
  if (fEl) fEl.innerHTML = `ETC = Supply Start + ${h}h + (Qty ÷ TPH)<br>Next Start ≥ ETC + ${t}h travel`;
}

function addBarge(def = {}) {
  bc++;
  const id = bc, name = def.name||`Barge ${id}`;
  const vcap=def.vcap??5000,mcap=def.mcap??1000,vrob=def.vrob??4500,mrob=def.mrob??900;
  const vbuf=def.vbuf??500,mbuf=def.mbuf??150,vtph=def.vtph??300,mtph=def.mtph??100;
  const vrfr=def.vrfr??750,mrfr=def.mrfr??275;
  const c=document.createElement('div');
  c.className='vcard';c.id=`barge-${id}`;c.style.marginTop='10px';
  c.innerHTML=`
  <div class="vcard-hdr">
    <span class="vnum barge-tag"> ${name}</span>
    <div style="display:flex;gap:6px;align-items:center">
      <input type="text" id="b${id}-name" value="${name}" style="font-size:12px;padding:5px 9px;border:none;box-shadow:var(--sh-in-xs);border-radius:6px;width:130px;font-family:DM Sans,sans-serif" oninput="renameBargeDropdowns()">
      <button class="btn btn-secondary btn-sm" id="b${id}-edit-btn" onclick="toggleBargeEdit(${id})" style="gap:5px">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Edit
      </button>
      <button class="btn btn-secondary btn-sm" id="b${id}-hide-btn" onclick="toggleBargeParams(${id})" style="gap:5px">
        <svg id="b${id}-hide-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        <span id="b${id}-hide-label">Hide</span>
      </button>
      <button class="rm-btn" onclick="rmBarge(${id})"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Remove</button>
    </div>
  </div>

  <!-- ── VIEW MODE: compact summary strip ── -->
  <div id="b${id}-view" style="display:flex;flex-wrap:wrap;gap:8px;padding:10px 0 6px 0;align-items:center">
    <div style="display:flex;gap:6px;flex-wrap:wrap" id="b${id}-summary"></div>
  </div>

  <!-- ── EDIT MODE: full parameter fields ── -->
  <div id="b${id}-params" style="display:none">
    <div class="g4 mb10" style="margin-top:8px">
      <div class="field"><label>VLSFO Capacity (MT)</label><input type="number" id="b${id}-vcap" value="${vcap}" min="0" step="100" oninput="updateBargeView(${id})"></div>
      <div class="field"><label>MGO Capacity (MT)</label><input type="number" id="b${id}-mcap" value="${mcap}" min="0" step="100" oninput="updateBargeView(${id})"></div>
      <div class="field"><label>Opening VLSFO ROB (MT)</label><input type="number" id="b${id}-vrob" value="${vrob}" min="0" step="50" oninput="updateBargeView(${id})"></div>
      <div class="field"><label>Opening MGO ROB (MT)</label><input type="number" id="b${id}-mrob" value="${mrob}" min="0" step="50" oninput="updateBargeView(${id})"></div>
    </div>
    <div class="g4 mb10">
      <div class="field">
        <label>VLSFO Alert Buffer (MT) <span style="font-weight:400;color:var(--muted)">— refuel trigger</span></label>
        <input type="number" id="b${id}-vbuf" value="${vbuf}" min="0" step="50" oninput="updateBargeView(${id})">
      </div>
      <div class="field">
        <label>MGO Alert Buffer (MT) <span style="font-weight:400;color:var(--muted)">— refuel trigger</span></label>
        <input type="number" id="b${id}-mbuf" value="${mbuf}" min="0" step="50" oninput="updateBargeView(${id})">
      </div>
      <div class="field"><label>VLSFO Pump Rate (MT/hr) <span style="font-weight:400;color:var(--muted)">— vessel supply</span></label><input type="number" id="b${id}-vtph" value="${vtph}" min="1" step="10" oninput="updateBargeView(${id})"></div>
      <div class="field"><label>MGO Pump Rate (MT/hr) <span style="font-weight:400;color:var(--muted)">— vessel supply</span></label><input type="number" id="b${id}-mtph" value="${mtph}" min="1" step="10" oninput="updateBargeView(${id})"></div>
    </div>
    <div class="g4 mb10">
      <div class="field"><label>VLSFO Refill Rate (MT/hr) <span style="font-weight:400;color:var(--muted)">— barge refill</span></label><input type="number" id="b${id}-vrfr" value="${vrfr}" min="1" step="10" oninput="updateBargeView(${id})"></div>
      <div class="field"><label>MGO Refill Rate (MT/hr) <span style="font-weight:400;color:var(--muted)">— barge refill</span></label><input type="number" id="b${id}-mrfr" value="${mrfr}" min="1" step="10" oninput="updateBargeView(${id})"></div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:10px">
      <button class="btn btn-primary btn-sm" onclick="saveBargeEdit(${id})">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        Save Parameters
      </button>
      <button class="btn btn-secondary btn-sm" onclick="cancelBargeEdit(${id})">Cancel</button>
    </div>
  </div>

  <!-- ── REFILL PREVIEW (shown in both modes) ── -->
  <div id="b${id}-refill-preview" style="font-size:12px;background:var(--bg);border-radius:8px;padding:10px 14px;margin-top:4px;border:1px solid var(--border2)">
    <div style="font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--sub);margin-bottom:8px">Barge Refill Summary</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:8px" id="b${id}-refill-grid"></div>
  </div>`;

  document.getElementById('barge-list').appendChild(c);
  _barges.push({id});
  populateBargeDropdowns();
  updateBargeView(id);   // build view-mode summary + refill preview
}

/* ── Barge card state helpers ── */
const _bargeEditMode = {}; // {id: bool}
const _bargeHidden   = {}; // {id: bool}

function _chip(label, val, color) {
  return `<div style="background:var(--surface2);border:1px solid var(--border2);border-radius:7px;padding:5px 10px;display:flex;flex-direction:column;gap:1px">
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:700">${label}</div>
    <div style="font-size:12px;font-weight:700;color:${color||'var(--ink)'};font-family:DM Mono,monospace">${val}</div>
  </div>`;
}

function updateBargeView(id) {
  const vcap = parseFloat(document.getElementById(`b${id}-vcap`)?.value)||0;
  const mcap = parseFloat(document.getElementById(`b${id}-mcap`)?.value)||0;
  const vrob = parseFloat(document.getElementById(`b${id}-vrob`)?.value)||0;
  const mrob = parseFloat(document.getElementById(`b${id}-mrob`)?.value)||0;
  const vbuf = parseFloat(document.getElementById(`b${id}-vbuf`)?.value)||0;
  const mbuf = parseFloat(document.getElementById(`b${id}-mbuf`)?.value)||0;
  const vtph = parseFloat(document.getElementById(`b${id}-vtph`)?.value)||300;
  const mtph = parseFloat(document.getElementById(`b${id}-mtph`)?.value)||100;
  const vrfr = parseFloat(document.getElementById(`b${id}-vrfr`)?.value)||750;
  const mrfr = parseFloat(document.getElementById(`b${id}-mrfr`)?.value)||275;

  const summary = document.getElementById(`b${id}-summary`);
  if (summary) {
    const vPct = vcap > 0 ? Math.round((vrob/vcap)*100) : 0;
    const mPct = mcap > 0 ? Math.round((mrob/mcap)*100) : 0;
    const vColor = vPct < 20 ? 'var(--red)' : vPct < 40 ? 'var(--amber)' : 'var(--green)';
    const mColor = mPct < 20 ? 'var(--red)' : mPct < 40 ? 'var(--amber)' : 'var(--green)';
    summary.innerHTML =
      _chip('VLSFO Cap', vcap.toLocaleString()+' MT') +
      _chip('VLSFO ROB', vrob.toLocaleString()+' MT ('+vPct+'%)', vColor) +
      _chip('MGO Cap', mcap.toLocaleString()+' MT') +
      _chip('MGO ROB', mrob.toLocaleString()+' MT ('+mPct+'%)', mColor) +
      _chip('VLSFO Buffer', vbuf.toLocaleString()+' MT') +
      _chip('MGO Buffer', mbuf.toLocaleString()+' MT') +
      _chip('VLSFO Pump', vtph+' MT/hr') +
      _chip('MGO Pump', mtph+' MT/hr') +
      _chip('VLSFO Refill', vrfr+' MT/hr') +
      _chip('MGO Refill', mrfr+' MT/hr');
  }
  // Always update refill preview too
  updateRefillPreview(id);
}

function toggleBargeEdit(id) {
  const paramsEl = document.getElementById(`b${id}-params`);
  const viewEl   = document.getElementById(`b${id}-view`);
  const editBtn  = document.getElementById(`b${id}-edit-btn`);
  const isEditing = _bargeEditMode[id];
  if (isEditing) {
    cancelBargeEdit(id); return;
  }
  _bargeEditMode[id] = true;
  if (paramsEl) paramsEl.style.display = '';
  if (viewEl)   viewEl.style.display   = 'none';
  if (editBtn)  editBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Cancel`;
  editBtn.style.background   = 'var(--amber-lt)';
  editBtn.style.borderColor  = 'var(--amber-bd)';
  editBtn.style.color        = 'var(--amber)';
  // Also un-hide params section if user had hidden it
  if (_bargeHidden[id]) { toggleBargeParams(id); }
}

function saveBargeEdit(id) {
  _bargeEditMode[id] = false;
  const paramsEl = document.getElementById(`b${id}-params`);
  const viewEl   = document.getElementById(`b${id}-view`);
  const editBtn  = document.getElementById(`b${id}-edit-btn`);
  if (paramsEl) paramsEl.style.display = 'none';
  if (viewEl)   viewEl.style.display   = '';
  if (editBtn) {
    editBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit`;
    editBtn.style.background  = '';
    editBtn.style.borderColor = '';
    editBtn.style.color       = '';
  }
  updateBargeView(id);

  // Two-way ROB sync: editing the Opening ROB here is a fresh declaration of
  // truth for this barge, so clear any older manual override from the Live
  // Barge ROB Summary panel — otherwise that panel would keep showing its
  // own stale override instead of the value just entered here.
  const newVrob = parseFloat(document.getElementById(`b${id}-vrob`)?.value) || 0;
  const newMrob = parseFloat(document.getElementById(`b${id}-mrob`)?.value) || 0;
  if (_manualROB) {
    delete _manualROB[id + '_final'];
    delete _manualROB[id + '_pre'];
  }
  if (_bargeConfig) {
    const bc = _bargeConfig.find(x => x.id == id);
    if (bc) { bc.vrob = newVrob; bc.mrob = newMrob; }
  }
  if (_bargeStates && _bargeStates[id]) {
    _bargeStates[id].rv = newVrob;
    _bargeStates[id].rm = newMrob;
  }
  saveManualROB();
  saveSharedState();
  // Refresh the Live Barge ROB Summary so it immediately reflects this change
  if (typeof renderLiveROBDashboard === 'function') renderLiveROBDashboard();
  if (typeof renderRemainingSupplyTracker === 'function') renderRemainingSupplyTracker();

  // Flash confirmation
  const card = document.getElementById(`barge-${id}`);
  if (card) {
    card.style.transition = 'box-shadow .2s';
    card.style.boxShadow  = '0 0 0 2px var(--green)';
    setTimeout(() => { card.style.boxShadow = ''; }, 1000);
  }
}

function cancelBargeEdit(id) {
  _bargeEditMode[id] = false;
  const paramsEl = document.getElementById(`b${id}-params`);
  const viewEl   = document.getElementById(`b${id}-view`);
  const editBtn  = document.getElementById(`b${id}-edit-btn`);
  if (paramsEl) paramsEl.style.display = 'none';
  if (viewEl)   viewEl.style.display   = '';
  if (editBtn) {
    editBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit`;
    editBtn.style.background  = '';
    editBtn.style.borderColor = '';
    editBtn.style.color       = '';
  }
}

function toggleBargeParams(id) {
  const viewEl  = document.getElementById(`b${id}-view`);
  const refill  = document.getElementById(`b${id}-refill-preview`);
  const hideBtn = document.getElementById(`b${id}-hide-btn`);
  const hideIcon = document.getElementById(`b${id}-hide-icon`);
  const hideLbl = document.getElementById(`b${id}-hide-label`);
  const isHidden = _bargeHidden[id];
  _bargeHidden[id] = !isHidden;
  if (_bargeHidden[id]) {
    if (viewEl)  viewEl.style.display  = 'none';
    if (refill)  refill.style.display  = 'none';
    if (hideLbl) hideLbl.textContent   = 'Show';
    if (hideIcon) hideIcon.innerHTML   = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    if (hideBtn) { hideBtn.style.background='var(--azure-lt)'; hideBtn.style.borderColor='var(--azure-bd)'; hideBtn.style.color='var(--azure)'; }
  } else {
    if (viewEl)  viewEl.style.display  = '';
    if (refill)  refill.style.display  = '';
    if (hideLbl) hideLbl.textContent   = 'Hide';
    if (hideIcon) hideIcon.innerHTML   = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
    if (hideBtn) { hideBtn.style.background=''; hideBtn.style.borderColor=''; hideBtn.style.color=''; }
  }
}

function updateRefillPreview(id) {
  const vcap=parseFloat(document.getElementById(`b${id}-vcap`)?.value)||0,mcap=parseFloat(document.getElementById(`b${id}-mcap`)?.value)||0;
  const vrob=parseFloat(document.getElementById(`b${id}-vrob`)?.value)||0,mrob=parseFloat(document.getElementById(`b${id}-mrob`)?.value)||0;
  const vrfr=parseFloat(document.getElementById(`b${id}-vrfr`)?.value)||750,mrfr=parseFloat(document.getElementById(`b${id}-mrfr`)?.value)||275;
  const grid=document.getElementById(`b${id}-refill-grid`);if(!grid)return;
  const vUllage=Math.max(0,vcap-vrob),mUllage=Math.max(0,mcap-mrob);
  const vRefillHrs=vrfr>0?vUllage/vrfr:0,mRefillHrs=mrfr>0?mUllage/mrfr:0;
  const cell=(label,val,sub)=>`<div style="background:var(--surface);border-radius:6px;padding:7px 10px;border:1px solid var(--border2)"><div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;font-weight:700">${label}</div><div style="font-size:13px;font-weight:600;color:var(--ink);font-family:DM Mono,monospace">${val}</div>${sub?`<div style="font-size:10px;color:var(--muted);margin-top:2px">${sub}</div>`:''}</div>`;
  grid.innerHTML=cell('VLSFO ROB',vrob.toLocaleString()+' MT',`Cap: ${vcap.toLocaleString()} MT`)+cell('VLSFO Ullage',vUllage.toLocaleString()+' MT','to fill')+cell('VLSFO Refill',vUllage>0?durStr(vRefillHrs):'—',`@ ${vrfr} MT/hr`)+cell('MGO Ullage',mUllage.toLocaleString()+' MT','to fill')+cell('MGO Refill',mUllage>0?durStr(mRefillHrs):'—',`@ ${mrfr} MT/hr`);
}

function rmBarge(id) { document.getElementById(`barge-${id}`)?.remove(); _barges=_barges.filter(b=>b.id!==id); populateBargeDropdowns(); saveSharedState(); }
function renameBargeDropdowns() { populateBargeDropdowns(); clearTimeout(upd._t); upd._t=setTimeout(saveSharedState,1500); }
function getBarges() {
  return _barges.map(b=>{
    const id=b.id;
    return{id,name:(document.getElementById(`b${id}-name`)?.value||`Barge ${id}`).trim(),vcap:parseFloat(document.getElementById(`b${id}-vcap`)?.value)||5000,mcap:parseFloat(document.getElementById(`b${id}-mcap`)?.value)||1000,vrob:parseFloat(document.getElementById(`b${id}-vrob`)?.value)||0,mrob:parseFloat(document.getElementById(`b${id}-mrob`)?.value)||0,vbuf:parseFloat(document.getElementById(`b${id}-vbuf`)?.value)||500,mbuf:parseFloat(document.getElementById(`b${id}-mbuf`)?.value)||150,vtph:parseFloat(document.getElementById(`b${id}-vtph`)?.value)||300,mtph:parseFloat(document.getElementById(`b${id}-mtph`)?.value)||100,vrfr:parseFloat(document.getElementById(`b${id}-vrfr`)?.value)||750,mrfr:parseFloat(document.getElementById(`b${id}-mrfr`)?.value)||275};
  });
}
/* ─── SUPPLY SEQUENCE CLASSIFIER ─── */
/*
  Rules:
  • gap >= 24 hrs  → "On Arrival"
  • gap <= 4 hrs   → "After [Prev Vessel Name]"  (tight scheduling)
  • 4 < gap < 24   → "After [Prev Vessel Name]" with timed window
  First vessel in sequence always = "On Arrival"
*/
const PREF_BARGE_KEY = 'abps_preferred_barge';

function classifySeq(item, idx, items) {
  if (idx === 0) return { label: 'On Arrival', type: 'arrival', prevName: null };
  const prev  = items[idx - 1];
  if (!prev || !prev.etc || !item.bargeStart) return { label: 'On Arrival', type: 'arrival', prevName: null };
  const gapHrs = (item.bargeStart - prev.etc) / 3600000;
  if (gapHrs >= 24) {
    return { label: 'On Arrival', type: 'arrival', prevName: prev.name };
  }
  // <= 24 hrs gap → "After [Vessel Name]"
  return { label: 'After ' + prev.name, type: 'after', prevName: prev.name, gapHrs: gapHrs };
}

/* ─── BARGE SELECTION PERSISTENCE ─── */
function savePreferredBarge(bargeId) {
  try { localStorage.setItem(PREF_BARGE_KEY, String(bargeId)); } catch(e) {}
}
function loadPreferredBarge() {
  try { return localStorage.getItem(PREF_BARGE_KEY) || ''; } catch(e) { return ''; }
}

function populateBargeDropdowns() {
  const barges = getBarges();
  const preferred = loadPreferredBarge();
  document.querySelectorAll('[id^="v"][id$="-barge"]').forEach(sel => {
    // Determine value to select: explicit current value > preferred > empty (auto)
    const cur = sel.value || '';
    // Find a valid match
    const selectVal = cur && barges.find(b => String(b.id) === cur) ? cur
                    : preferred && barges.find(b => String(b.id) === preferred) ? preferred
                    : '';
    sel.innerHTML = '<option value="">Auto (any barge)</option>' +
      barges.map(b => '<option value="' + b.id + '"' + (String(b.id) === selectVal ? ' selected' : '') + '>' + b.name + '</option>').join('');
    // Save preference whenever user changes selection
    sel.onchange = function() {
      saveSharedState();
      if (this.value) savePreferredBarge(this.value);
    };
  });
}

/* ─── FLATPICKR ─── */
const _lcPickers={}, _etaPickers={};
function openLaycanPicker(id) {
  const inp=document.getElementById(`v${id}-lc`);if(!inp)return;
  if(_lcPickers[id]){_lcPickers[id].open();return;}
  _lcPickers[id]=flatpickr(inp,{mode:'range',dateFormat:'j M Y',allowInput:false,disableMobile:true,minDate:'2026-01-01',
    onReady(_,__,fp){fp.open();},
    onChange(dates,dateStr){
      if(dates.length===2){
        const d1=dates[0],d2=dates[1];
        if(d1.getMonth()===d2.getMonth()&&d1.getFullYear()===d2.getFullYear()){inp.value=`${d1.getDate()}-${d2.getDate()} ${MO[d1.getMonth()]} ${d1.getFullYear()}`;}
        else{inp.value=`${d1.getDate()} ${MO[d1.getMonth()]} ${d1.getFullYear()} - ${d2.getDate()} ${MO[d2.getMonth()]} ${d2.getFullYear()}`;}
        upd(id);
      }
    }});
  if(inp.value){const lc=parseLaycan(inp.value);if(lc){try{_lcPickers[id].setDate([lc.from,lc.to]);}catch(e){}}}
  _lcPickers[id].open();
}
function openETAPicker(id) {
  const inp=document.getElementById(`v${id}-eta`);if(!inp)return;
  if(_etaPickers[id]){_etaPickers[id].open();return;}
  _etaPickers[id]=flatpickr(inp,{enableTime:true,time_24hr:true,dateFormat:'j M Y H:i',allowInput:false,minuteIncrement:30,disableMobile:true,minDate:'2026-01-01',
    onReady(_,__,fp){fp.open();},
    onChange(dates){if(dates.length===1){const d=dates[0];inp.value=`${pad(d.getDate())} ${MO[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;upd(id);}}});
  if(inp.value){const eta=parseDT(inp.value);if(eta){try{_etaPickers[id].setDate(eta);}catch(e){}}}
  _etaPickers[id].open();
}

let _reportFromPicker=null,_reportToPicker=null;
function openReportFromPicker(){const inp=document.getElementById('report-from');if(!inp)return;if(_reportFromPicker){_reportFromPicker.open();return;}_reportFromPicker=flatpickr(inp,{dateFormat:'j M Y',allowInput:false,disableMobile:true,minDate:'2026-01-01',onReady(_,__,fp){fp.open();},onChange(){renderMonthlyPreview();}});_reportFromPicker.open();}
function openReportToPicker(){const inp=document.getElementById('report-to');if(!inp)return;if(_reportToPicker){_reportToPicker.open();return;}_reportToPicker=flatpickr(inp,{dateFormat:'j M Y',allowInput:false,disableMobile:true,minDate:'2026-01-01',onReady(_,__,fp){fp.open();},onChange(){renderMonthlyPreview();}});_reportToPicker.open();}

/* ─── PRINT ─── */
function printScheduleOnly() {
  if (!_lastSched.length){alert('Generate the schedule first.');return;}

  // Collect selected vessel SNOs from the voyage table checkboxes
  const checkedSNOs = new Set();
  document.querySelectorAll('.voy-print-chk:checked').forEach(chk => {
    checkedSNOs.add(parseInt(chk.dataset.sno));
  });
  if (checkedSNOs.size === 0) {
    alert('No vessels selected.\nUse the Print checkboxes in the Voyage Schedule table to select vessels.');
    return;
  }

  const printItems = _lastSched.filter(item => checkedSNOs.has(item.sno));
  const allSelected = checkedSNOs.size === _lastSched.length;
  const container = document.getElementById('print-only-container');
  const now = fmt24(new Date());
  const bargeNames = [...new Set(printItems.map(i=>i.bargeLabel).filter(Boolean))].join(' · ');
  const totV = printItems.reduce((a,i)=>a+((i.nomVQ!==undefined&&i.nomVQ!==null)?i.nomVQ:i.vQ), 0);
  const totM = printItems.reduce((a,i)=>a+((i.nomMQ!==undefined&&i.nomMQ!==null)?i.nomMQ:i.mQ), 0);
  const selNote = allSelected ? `${printItems.length} vessels` : `${printItems.length} of ${_lastSched.length} vessels selected`;

  const cols=[{label:'No.',w:'3%'},{label:'Vessel',w:'11%'},{label:'Area',w:'5%'},{label:'FO (MT)',w:'5%'},{label:'MGO (MT)',w:'5%'},{label:'Spec',w:'7%'},{label:'Laycan',w:'9%'},{label:'ETA',w:'9%'},{label:'Supply Start',w:'9%'},{label:'ETC',w:'9%'},{label:'Sequence',w:'8%'},{label:'Status',w:'5%'},{label:'PAQ',w:'4%'},{label:'Agent',w:'5%'},{label:'Barge',w:'5%'},{label:'Manifold',w:'5%'}];

  const rows = printItems.map((item, idx) => {
    const nomV_ = (item.nomVQ !== undefined && item.nomVQ !== null) ? item.nomVQ : item.vQ;
    const nomM_ = (item.nomMQ !== undefined && item.nomMQ !== null) ? item.nomMQ : item.mQ;
    const fo = nomV_>0?nomV_.toLocaleString():'—', mo = nomM_>0?nomM_.toLocaleString():'—';
    const seqPr = classifySeq(item, idx, printItems);
    const plan = seqPr.label;
    const lcIn = !!(item.lc&&item.eta&&item.eta>=item.lc.from&&item.eta<=item.lc.to);
    const lcStr = item.lc ? fmtLC(item.lc) : '—';
    const stat = item.noFirmETA ? 'No Firm ETA' : item.isDelayed ? 'Delayed' : 'On Laycan';
    const paqStr = item.paq==='yes' ? 'Rcvd' : ' Pending';
    const bg = idx%2===0 ? '#ffffff' : '#f7f9fc';
    const statColor = item.noFirmETA ? 'var(--purple)' : item.isDelayed ? 'var(--amber)' : 'var(--green)';
    const statBg    = item.noFirmETA ? 'var(--purple-lt)' : item.isDelayed ? '#FFF5E0' : '#E5F5EC';
    const paqColor  = item.paq==='yes' ? 'var(--green)' : 'var(--red)';
    const lcColor   = lcIn ? 'var(--green)' : 'var(--amber)';
    const areaS = areaShort(item.area);
    return `<tr style="background:${bg}">
      <td style="text-align:center;color:var(--muted);font-weight:700">${item.sno}</td>
      <td><strong>${item.name}</strong></td>
      <td style="font-size:6.5pt;font-weight:700;font-family:monospace">${areaS}</td>
      <td style="text-align:right;font-family:monospace">${fo}</td>
      <td style="text-align:right;font-family:monospace">${mo}</td>
      <td>${item.spec||'—'}</td>
      <td style="color:${lcColor};font-family:monospace">${lcStr}</td>
      <td style="font-family:monospace">${fmt24(item.eta)}</td>
      <td style="font-family:monospace">${fmt24(item.bargeStart)}</td>
      <td style="font-family:monospace">${fmt24(item.etc)}</td>
      <td style="font-size:6.5pt;color:var(--fuel-v)">${plan}</td>
      <td><span style="font-size:6pt;padding:2px 4px;border-radius:3px;background:${statBg};color:${statColor};font-weight:700">${stat}</span></td>
      <td style="color:${paqColor};font-weight:700;font-size:6.5pt">${paqStr}</td>
      <td>${item.agent||'—'}</td>
      <td>${item.bargeLabel||'—'}</td>
      <td>${item.mani||'—'}</td>
    </tr>`;
  }).join('');

  const colGroup = cols.map(c=>`<col style="width:${c.w}">`).join('');
  const thCells  = cols.map(c=>`<th>${c.label}</th>`).join('');

  container.innerHTML = `
    <div class="print-schedule-header">
      <table style="width:100%;border-collapse:collapse;margin-bottom:0"><tr>
        <td style="vertical-align:top">
          <div style="font-family:DM Sans,sans-serif;font-size:14pt;font-weight:700;color:var(--ink)">FLOW — Voyage Schedule</div>
          <div style="font-size:8pt;color:var(--pg-deliverylog);margin-top:3px">Generated: ${now} UTC &nbsp;|&nbsp; Barges: ${bargeNames||'—'} &nbsp;|&nbsp; ${selNote}</div>
        </td>
        <td style="text-align:right;vertical-align:top">
          <div style="font-size:8pt;color:var(--pg-deliverylog)">Total VLSFO: <strong style="color:var(--ink)">${totV.toLocaleString()} MT</strong> &nbsp;|&nbsp; Total MGO: <strong style="color:var(--ink)">${totM.toLocaleString()} MT</strong></div>
          ${!allSelected ? `<div style="font-size:7pt;color:var(--amber);margin-top:2px"> Partial schedule — ${_lastSched.length - checkedSNOs.size} vessel(s) excluded</div>` : ''}
        </td>
      </tr></table>
    </div>
    <div class="voy-wrap">
      <table class="voy-tbl" style="width:100%">
        <colgroup>${colGroup}</colgroup>
        <thead><tr>${thCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  container.style.display = 'block';
  setTimeout(() => { window.print(); setTimeout(() => { container.style.display = 'none'; }, 500); }, 80);
}
/* ─── FULL RESET ─── */
function confirmFullReset() {
  if (!confirm(' Full Reset will clear:\n\n• All vessel nominations\n• All barge configurations\n• Generated schedule\n• Checklist data\n• Shared workspace state\n\nSaved supply records will be KEPT.\n\nProceed?')) return;
  fullReset();
}
async function fullReset() {
  document.getElementById('vc').innerHTML = '';
  vc = 0;
  document.getElementById('barge-list').innerHTML = '';
  bc = 0; _barges = [];
  _lastSched=[]; _bargeStates={}; _bargeConfig=[];
  _lastETC=null; _closingV=0; _closingM=0;
  _checklist={}; _checklistRecords={}; _trashBin=[];
  Object.values(_lcPickers).forEach(p=>{try{p.destroy();}catch(e){}});
  Object.values(_etaPickers).forEach(p=>{try{p.destroy();}catch(e){}});
  Object.keys(_lcPickers).forEach(k=>delete _lcPickers[k]);
  Object.keys(_etaPickers).forEach(k=>delete _etaPickers[k]);
  // Clear the actual RENDERED schedule output, not just the in-memory
  // _lastSched — otherwise the old voyage table/timeline stays visibly
  // painted on screen even though the underlying data was reset.
  _scheduleReady = false;
  const outputEl = document.getElementById('output');
  if (outputEl) { outputEl.classList.remove('vis'); outputEl.style.display = 'none'; }
  document.getElementById('nsc-section').classList.remove('vis');
  const sumCards = document.getElementById('sum-cards');
  if (sumCards) sumCards.innerHTML = '';
  const tlWrap = document.getElementById('tl');
  if (tlWrap) tlWrap.innerHTML = '';
  const voyWrap = document.getElementById('voy-barge-tabs');
  if (voyWrap) voyWrap.innerHTML = '';
  const apV = document.getElementById('ap-v');
  if (apV) apV.innerHTML = '';
  const apM = document.getElementById('ap-m');
  if (apM) apM.innerHTML = '';
  const brs = document.getElementById('barge-rob-summary');
  if (brs) brs.innerHTML = '<div style="font-size:13px;color:var(--muted);text-align:center;padding:16px;background:var(--surface);border-radius:var(--radius);box-shadow:var(--sh-in-xs)">Generate the schedule to see ROB Summary.</div>';
  const dlSpan = document.getElementById('per-barge-dl-btns');
  if (dlSpan) dlSpan.innerHTML = '';
  _savedSupplies=[]; _manualROB={};
  renderSavedRecords();
  renderTrashBin();
  // Leave blank — no auto-added barge. The operator adds their own.
  await saveSharedState();
  window.scrollTo({top:0,behavior:'smooth'});
  showToast('Workspace reset — nominations, barges, and schedule cleared', 'info');
}

/* ─── CLEAR CHECKLIST — wipes only active pending checklist rows ─── */
async function clearChecklistRecords() {
  if (!confirm(
    'Clear Checklist will remove all pending rows from the checklist.\n\n' +
    '• Completed + saved supply records are KEPT\n' +
    '• Barge ROB and vessel nominations are KEPT\n' +
    '• The schedule is KEPT\n\n' +
    'Use this to fix duplicate rows or stale entries.\n\nProceed?'
  )) return;

  // Wipe active checklist records AND the schedule that would re-inject them
  _checklistRecords = {};
  _lastSched = [];
  _bargeStates = {};
  _bargeConfig = [];
  _lastETC = null;
  _closingV = 0; _closingM = 0;

  // Re-render clean
  renderChecklist([]);
  if (typeof renderRemainingSupplyTracker === 'function') renderRemainingSupplyTracker();

  // Push the clean state to Supabase so stale data cannot come back on next sync
  try {
    await saveSharedState();
    _flashSyncBanner && _flashSyncBanner('✓ Checklist cleared — workspace updated', 'var(--azure)');
  } catch(e) {}
}

/* ─── NUCLEAR CLEAR — wipes every key ABPS has ever written ─── */
function confirmNuclearClear() {
  // Two-step confirmation — this is irreversible
  if (!confirm(
    '⚠️  CLEAR ALL DATA\n\n' +
    'This will permanently delete:\n\n' +
    '• All vessel nominations\n' +
    '• All barge configurations\n' +
    '• All saved supply records\n' +
    '• All checklist records\n' +
    '• All ROB history & manual overrides\n' +
    '• All archives\n' +
    '• All schedule data\n' +
    '• Shared workspace state\n\n' +
    'Nothing will be kept. This cannot be undone.\n\n' +
    'Continue?'
  )) return;

  const label = 'DELETE';
  const typed = prompt(
    'Type  ' + label + '  to confirm complete data wipe.\n\n' +
    'This will remove all data including test data from localStorage and shared storage.'
  );
  if ((typed || '').trim().toUpperCase() !== label) {
    if (typed !== null) alert('Cancelled — text did not match. No data was deleted.');
    return;
  }
  nuclearClear();
}

async function nuclearClear() {
  // Block the 30-second auto-sync loop for the entire duration of this
  // operation. Without this, a background auto-sync tick could fire
  // mid-clear (or right after) and pull back a stale cached copy of the
  // very data this function is deleting — which is exactly how cleared
  // vessels/checklist rows were able to silently reappear minutes later.
  _isSyncing = true;
  try {
  // ── 1. Wipe all known localStorage keys ──
  const ALL_KEYS = [
    'abps_shared_state_v3',
    'abps_shared_records_v3',
    'abps_state_v4',
    'abps_records_v4',
    'abps_rob_audit_v1',
    'abps_manual_rob_v1',
    'abps_records',
    'abps_saved_records',
    'abps_checklist',
    'abps_checklist_records',
    'abps_trash',
    'abps_archives',
    'abps_preferred_barge',
    'abps_nomination_email_log_v1',
    'abps_agents',
    // NOTE: deliberately NOT clearing abps_sync_cfg_v1 (keep credentials)
  ];
  ALL_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch(e) {} });

  // Also sweep any other abps_ or flow_ keys that may have been written
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('abps_') || k.startsWith('flow_'))) toRemove.push(k);
    }
    toRemove.forEach(k => { try { localStorage.removeItem(k); } catch(e) {} });
  } catch(e) {}

  // ── 2. Wipe the real shared cloud storage (Supabase abps_workspace table) ──
  // This deletes BOTH rows this app writes: the main shared state/records
  // row, and the permanent nomination-email-sent log row. Deleting these
  // (rather than just clearing locally) means every device/operator that
  // opens this workspace next will also see a genuinely blank slate, not
  // just this one browser. Failures here are surfaced, not swallowed —
  // a silently-failed delete left the old row in place, and the
  // push at the end of this function would not have overwritten it if
  // an auto-sync pull had already restored it locally first.
  let _cloudWipeFailed = false;
  if (typeof _syncReady === 'function' && _syncReady()) {
    try {
      const r1 = await supabaseClient.from('abps_workspace').delete().eq('id', ABPS_WORKSPACE_ID);
      if (r1.error) { _cloudWipeFailed = true; console.error('Clear All Data: failed to delete main workspace row:', r1.error.message); }
    } catch(e) { _cloudWipeFailed = true; console.error('Clear All Data: main workspace delete threw:', e.message); }
    try {
      const r2 = await supabaseClient.from('abps_workspace').delete().eq('id', 'nomination_email_log');
      if (r2.error) { console.error('Clear All Data: failed to delete nomination_email_log row:', r2.error.message); }
    } catch(e) { console.error('Clear All Data: nomination_email_log delete threw:', e.message); }
  }

  // ── 3. Reset all in-memory state ──
  _savedSupplies    = [];
  _checklist        = {};
  _checklistRecords = {};
  _trashBin         = [];
  _lastSched        = [];
  _bargeStates      = {};
  _bargeConfig      = [];
  _lastETC          = null;
  _closingV         = 0;
  _closingM         = 0;
  _manualROB        = {};
  _robAuditLog      = [];
  _archives         = {};
  _lastKnownVersion = 0;
  _nomEmailLog      = {};
  _nomEmailLogLoaded = true; // nothing to load — we just wiped it, this is now the true (empty) state
  _calcParams       = { hoseHrs: 6, travelHrs: 1 };
  saveCalcParams();
  renderCalcParamsView();
  if (typeof _ciClearTemplates === 'function') _ciClearTemplates();
  _deliveryLog = {};
  try { localStorage.removeItem('abps_delivery_log_v1'); } catch(e) {}
  if (typeof renderDeliveryLog === 'function' && document.getElementById('dl-month-select')) renderDeliveryLog();

  // ── 4. Wipe DOM ──
  document.getElementById('vc').innerHTML = '';
  vc = 0;
  document.getElementById('barge-list').innerHTML = '';
  bc = 0; _barges = [];

  // Wipe the Availability Checker's saved check history (cards + in-memory data + inline result)
  Object.keys(_nscCheckData).forEach(k => delete _nscCheckData[k]);
  const nscList = document.getElementById('nsc-checks-list');
  if (nscList) nscList.innerHTML = '';
  const nscHdr = document.getElementById('nsc-checks-header');
  if (nscHdr) nscHdr.style.display = 'none';
  const nscInline = document.getElementById('nsc-unified-result');
  if (nscInline) { nscInline.innerHTML = ''; nscInline.className = 'nsc-result'; }
  const nscVesselName = document.getElementById('nsc-vessel-name');
  if (nscVesselName) nscVesselName.value = '';
  const nscEta = document.getElementById('nsc-vessel-eta');
  if (nscEta) nscEta.value = '';
  const nscReqV = document.getElementById('nsc-req-v');
  if (nscReqV) nscReqV.value = '500';
  const nscReqM = document.getElementById('nsc-req-m');
  if (nscReqM) nscReqM.value = '0';
  const nscPerBarge = document.getElementById('nsc-per-barge');
  if (nscPerBarge) nscPerBarge.innerHTML = '';

  // Wipe the actual RENDERED schedule output. _lastSched=[] above only
  // clears the in-memory data — the previous calculate() run's HTML table
  // (voyage schedule, timeline, summary cards) stays painted on screen
  // until something explicitly empties these containers. This was the
  // bug where Schedule Planner kept showing an old table after Clear All
  // Data even though Barge Fleet / Vessel Nominations were correctly blank.
  _scheduleReady = false;
  const outputEl = document.getElementById('output');
  if (outputEl) { outputEl.classList.remove('vis'); outputEl.style.display = 'none'; }
  const nscSection = document.getElementById('nsc-section');
  if (nscSection) nscSection.classList.remove('vis');
  const sumCards = document.getElementById('sum-cards');
  if (sumCards) sumCards.innerHTML = '';
  const tlWrap = document.getElementById('tl');
  if (tlWrap) tlWrap.innerHTML = '';
  const voyWrap = document.getElementById('voy-barge-tabs');
  if (voyWrap) voyWrap.innerHTML = '';
  const apV = document.getElementById('ap-v');
  if (apV) apV.innerHTML = '';
  const apM = document.getElementById('ap-m');
  if (apM) apM.innerHTML = '';
  const brs = document.getElementById('barge-rob-summary');
  if (brs) brs.innerHTML = '<div style="font-size:13px;color:var(--muted);text-align:center;padding:16px;background:var(--surface);border-radius:var(--radius);box-shadow:var(--sh-in-xs)">Generate the schedule to see ROB Summary.</div>';
  const dlSpan = document.getElementById('per-barge-dl-btns');
  if (dlSpan) dlSpan.innerHTML = '';

  Object.values(_lcPickers).forEach(p => { try { p.destroy(); } catch(e) {} });
  Object.values(_etaPickers).forEach(p => { try { p.destroy(); } catch(e) {} });
  Object.keys(_lcPickers).forEach(k => delete _lcPickers[k]);
  Object.keys(_etaPickers).forEach(k => delete _etaPickers[k]);

  // ── 5. Leave genuinely blank — no default barge, no sample data.
  // The person will add their own barges and vessels from scratch. ──
  renderSavedRecords();
  renderTrashBin();
  renderChecklist([]);
  renderLiveROBDashboard();

  // ── 6. Persist the clean state ──
  await saveSharedState();
  await saveSharedRecords();

  if (_cloudWipeFailed) {
    setSyncStatus('error', 'Cleared locally, but cloud delete failed — see console');
    alert('Local data is cleared, but deleting the old cloud record failed (network or permissions issue). ' +
          'The fresh empty state was still pushed on top of it just now, so this device and anyone who ' +
          'opens the workspace next should see it blank. If old vessels still reappear later, the safest ' +
          'fix is creating a brand-new Supabase project rather than continuing to reuse this one.');
  } else {
    setSyncStatus('ok', 'All data cleared — clean workspace');
  }
  showPage('dashboard');
  window.scrollTo({top:0, behavior:'smooth'});

  // Flash confirmation banner
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;background:var(--amber);color:#fff;border-radius:12px;padding:14px 24px;font-size:13px;font-weight:700;font-family:DM Sans,sans-serif;display:flex;align-items:center;gap:10px;box-shadow:0 8px 32px rgba(0,0,0,.25);white-space:nowrap';
  banner.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> All data cleared. Fresh workspace ready.';
  document.body.appendChild(banner);
  setTimeout(() => { banner.style.transition='opacity .4s'; banner.style.opacity='0'; setTimeout(()=>banner.remove(),400); }, 4000);
  } finally {
    // Always release the sync lock, even if something above threw —
    // otherwise auto-sync would stay permanently paused after an error.
    _isSyncing = false;
  }
}

/* ─── WIPE SUPABASE WORKSPACE — cloud only, instant, no DELETE typing needed ─── */
async function wipeSupabaseWorkspace() {
  if (!_syncReady()) {
    alert('Not connected to shared workspace — nothing to wipe.');
    return;
  }
  if (!confirm(
    'Wipe Supabase Workspace\n\n' +
    'This deletes the shared cloud row so every device sees a clean slate on next load.\n\n' +
    'Your LOCAL data (vessels, schedule, ROB) is kept in this browser session until you refresh.\n\n' +
    'Proceed?'
  )) return;

  setSyncStatus('syncing', 'Wiping cloud workspace…');
  try {
    await supabaseClient.from('abps_workspace').delete().eq('id', ABPS_WORKSPACE_ID);
    await supabaseClient.from('abps_workspace').delete().eq('id', 'nomination_email_log');
    // Also wipe all localStorage flow_ and abps_ keys so a reload starts clean too
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('abps_') || k.startsWith('flow_'))) toRemove.push(k);
    }
    toRemove.forEach(k => { try { localStorage.removeItem(k); } catch(e) {} });
    _lastKnownVersion = 0;
    // Clear ALL in-memory state that could re-inject stale data on next render
    _checklistRecords = {};
    _lastSched = [];
    _bargeStates = {};
    _bargeConfig = [];
    _lastETC = null;
    _closingV = 0; _closingM = 0;
    renderChecklist([]);
    if (typeof renderRemainingSupplyTracker === 'function') renderRemainingSupplyTracker();
    if (typeof _ciClearTemplates === 'function') _ciClearTemplates();
    _deliveryLog = {};
    try { localStorage.removeItem('abps_delivery_log_v1'); } catch(e) {}
    if (typeof renderDeliveryLog === 'function' && document.getElementById('dl-month-select')) renderDeliveryLog();
    setSyncStatus('ok', 'Cloud workspace wiped — reload any other devices');
    _flashSyncBanner && _flashSyncBanner('✓ Supabase workspace wiped. All devices will be clean on next load.', 'var(--green)');
  } catch(e) {
    setSyncStatus('error', 'Wipe failed: ' + e.message);
    alert('Wipe failed: ' + e.message);
  }
}

/* ═══ CALCULATION PARAMETERS (editable) ═══ */
const CALC_PARAMS_KEY = 'abps_calc_params_v1';
let _calcParams = { hoseHrs: 6, travelHrs: 1 };
function loadCalcParams() {
  try {
    const raw = localStorage.getItem(CALC_PARAMS_KEY);
    if (raw) { const p = JSON.parse(raw); _calcParams.hoseHrs = p.hoseHrs ?? 6; _calcParams.travelHrs = p.travelHrs ?? 1; }
  } catch(e) {}
}
function saveCalcParams() {
  try { localStorage.setItem(CALC_PARAMS_KEY, JSON.stringify(_calcParams)); } catch(e) {}
}
/* ════════════════════════════════════════ */

// FT84: One-time migration of old positional UIDs to stable name-based UIDs.
// Old format: "3_desh_abhimaan" (sno + slug) → new format: "v_desh_abhimaan" (name only).
// Safe to run multiple times (idempotent).
function _migrateChecklistUids() {
  const oldStylePattern = /^\d+_/; // starts with digits then underscore
  const toMigrate = Object.entries(_checklistRecords).filter(([uid]) => oldStylePattern.test(uid));
  if (!toMigrate.length) return;
  let migrated = 0;
  toMigrate.forEach(([oldUid, rec]) => {
    // Derive the new stable UID from vessel name
    const newUid = _clUid(rec.sno, rec.vessel);
    if (newUid === oldUid) return; // already matches new format (shouldn't happen)
    if (_checklistRecords[newUid]) {
      // Conflict: new-style key already exists. Prefer whichever is locked/completed.
      const existing = _checklistRecords[newUid];
      if (rec.lockedAt && !existing.lockedAt) {
        // Old key has a completed record — prefer it
        _checklistRecords[newUid] = Object.assign({}, rec, { uid: newUid });
      }
      // else keep existing new-style record as-is
    } else {
      // No conflict — migrate cleanly
      _checklistRecords[newUid] = Object.assign({}, rec, { uid: newUid });
    }
    delete _checklistRecords[oldUid];
    migrated++;
  });
  if (migrated > 0) {
    console.log(`ABPS FT84: migrated ${migrated} checklist record(s) to stable UIDs`);
    // Push migration to shared storage so all users benefit
    saveSharedState();
  }
}

async function init() {
  _loadSyncCfg();  // confirm Supabase sync is ready
  loadCalcParams(); // restore hose time + travel buffer
  renderCalcParamsView();
  if (typeof loadArchivesLocal === 'function') loadArchivesLocal();
  setSyncStatus('syncing', 'Loading workspace…');

  // Fix #3: load the local (synchronous, instant) nomination-email-sent
  // cache BEFORE any vessel cards get restored below, so each card's
  // "Send Nomination Email" button renders in the correct locked/unlocked
  // state on the very first paint, with no flash of an incorrect state.
  // The slower remote reconciliation still happens later, non-blocking.
  _loadNomEmailLogLocal();

  // Load saved records first
  await loadSharedRecords(true);

  // Try to load shared state
  const loaded = await loadSharedState(false);

  // FT84 FIX: Migrate old positional UIDs (format "N_slug") to new name-based UIDs ("v_slug")
  // This runs once on init to clean up any legacy data from pre-FT84 saves.
  _migrateChecklistUids();

  if (!loaded) {
    // Nothing in shared storage — leave it genuinely empty. No demo barge,
    // no sample vessels. The operator adds everything themselves from a
    // clean slate, and that blank state gets saved as-is on their first
    // edit (no seed data to accidentally keep, edit, or forget to delete).
    setSyncStatus('ok', 'Fresh empty workspace');
  }

  startAutoSync();
  startReminderAutoRefresh();
  await loadROBAudit();
  await loadManualROB();
  if (typeof _ciLoadTemplates === 'function') _ciLoadTemplates();
  if (typeof _loadDeliveryLogLocal === 'function') _loadDeliveryLogLocal();
  // Fix #3: reconcile with the remote copy of the nomination-email log
  // (the local copy was already loaded at the top of init(), before
  // vessels were restored). Once this resolves, re-check every currently
  // rendered card in case the remote log knows about a "sent" nomination
  // this device's local cache didn't have yet (e.g. sent from another
  // operator's browser).
  await _loadNomEmailLogRemote();
  document.querySelectorAll('.vcard[id^="vessel-"]').forEach(function(card) {
    const id = card.id.replace('vessel-', '');
    _refreshSendEmailButtonState(id);
  });

  // If schedule was restored from state, rebuild dependent UI.
  // Wrapped defensively: a bug in any one of these renders should never be
  // able to abort the rest of init() and leave the app half-initialized —
  // that exact failure mode previously made correctly-restored data (like
  // barge ROB) look like it had been lost, when really a later render call
  // had simply crashed before the user ever saw the value on screen.
  if (_lastSched && _lastSched.length) {
    try {
      injectChecklistFromSchedule(_lastSched);
      renderChecklist(_lastSched);
      renderLiveROBDashboard();
      if (_bargeConfig && _bargeConfig.length) {
        renderBargeTabsAndTL(_lastSched, _bargeConfig);
      }
      renderRemainingSupplyTracker();
      renderWeekCalendar(0);
      refreshScheduleKPIs();
    } catch(e) {
      console.error('init(): error rebuilding dependent UI from restored schedule —', e.message);
      setSyncStatus('error', 'Some panels failed to render — try Pull or refresh');
    }
  }
}

// init() now runs only after a successful Operator Access login —
// see _startAppAfterLogin() / _handleOperatorLogin() and the
// DOMContentLoaded listener in the Operator Access module above,
// which checks for an existing Supabase session and either skips
// the gate or waits for the operator to sign in.



// ===== next inline <script> block from original index.html =====


/* ═══════════════════════════════════════════════════════════
   CALLING INSTRUCTIONS ENGINE v3
   - Stores raw ArrayBuffer of uploaded .docx/.doc/.txt file
   - Uses mammoth.js to extract structured text from .docx
   - Uses docx.js to generate a proper .docx output
   - Strict variable replacement only — no rephrasing
   - Per-vessel auto-fill, no cross-vessel mixing
   - ETC logic: VLSFO=6h+(qty/300), MGO=6h+(qty/100)+1h travel
═══════════════════════════════════════════════════════════ */

// Store raw file blobs per key (kfk / fuj)
const _ciTemplates = { kfk: null, fuj: null }; // { text: string, fileName: string }
let _ciVesselCtx = null;

const CI_TEMPLATES_KEY = 'abps_ci_templates_v1';

// ─── ArrayBuffer <-> base64 (localStorage only stores strings/JSON) ───
function _abToBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000; // avoid call-stack blowups on large files
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
function _base64ToAb(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Uploaded Calling Instruction templates were only ever held in a plain JS
// variable — never saved anywhere — so they vanished on every reload/rebuild,
// not just an intentional reset. These persist to localStorage (surviving
// rebuilds/redeploys of this same browser) and are only ever cleared by an
// explicit Clear All Data or Wipe Cloud action, same as every other dataset.
function _ciSaveTemplates() {
  try {
    const out = {};
    ['kfk', 'fuj'].forEach(function(key) {
      const t = _ciTemplates[key];
      if (!t) { out[key] = null; return; }
      out[key] = {
        fileName: t.fileName,
        isDocx: t.isDocx,
        text: t.text || null,
        arrayBufferB64: t.arrayBuffer ? _abToBase64(t.arrayBuffer) : null
      };
    });
    localStorage.setItem(CI_TEMPLATES_KEY, JSON.stringify(out));
  } catch(e) { console.warn('Could not save Calling Instruction templates:', e.message); }
}

function _ciLoadTemplates() {
  let raw = null;
  try { raw = localStorage.getItem(CI_TEMPLATES_KEY); } catch(e) {}
  if (!raw) return;
  let saved;
  try { saved = JSON.parse(raw); } catch(e) { return; }
  ['kfk', 'fuj'].forEach(function(key) {
    const t = saved[key];
    if (!t) return;
    _ciTemplates[key] = {
      fileName: t.fileName,
      isDocx: t.isDocx,
      text: t.text || null,
      arrayBuffer: t.arrayBufferB64 ? _base64ToAb(t.arrayBufferB64) : null
    };
    const nameEl   = document.getElementById(`ci-${key}-name`);
    const statusEl = document.getElementById(`ci-${key}-status`);
    const labelEl  = document.getElementById(`ci-${key}-label`);
    const type = t.isDocx ? '.docx — XML clone mode' : '.txt — text mode';
    if (nameEl)   nameEl.textContent = t.fileName;
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--green);font-weight:700">Loaded (${type}) — ${t.fileName}</span>`;
    if (labelEl)  { labelEl.style.borderColor = 'var(--green)'; labelEl.style.background = 'var(--green-lt)'; }
  });
}

function _ciClearTemplates() {
  _ciTemplates.kfk = null;
  _ciTemplates.fuj = null;
  try { localStorage.removeItem(CI_TEMPLATES_KEY); } catch(e) {}
  ['kfk', 'fuj'].forEach(function(key) {
    const nameEl   = document.getElementById(`ci-${key}-name`);
    const statusEl = document.getElementById(`ci-${key}-status`);
    const labelEl  = document.getElementById(`ci-${key}-label`);
    if (nameEl)   nameEl.textContent = 'Click to upload .docx or .txt reference';
    if (statusEl) statusEl.textContent = `No ${key.toUpperCase()} template loaded`;
    if (labelEl)  { labelEl.style.borderColor = ''; labelEl.style.background = ''; }
  });
}

// ─── Load template — stores BOTH raw ArrayBuffer (for docx cloning) and extracted text ───
function ciLoadTemplate(key, input) {
  const file = input.files[0];
  if (!file) return;
  const nameEl   = document.getElementById(`ci-${key}-name`);
  const statusEl = document.getElementById(`ci-${key}-status`);
  const labelEl  = document.getElementById(`ci-${key}-label`);

  const setOk = (fname, type) => {
    if (nameEl)   nameEl.textContent = fname;
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--green);font-weight:700">Loaded (${type}) — ${fname}</span>`;
    if (labelEl)  { labelEl.style.borderColor = 'var(--green)'; labelEl.style.background = 'var(--green-lt)'; }
  };
  const setWarn = (msg) => {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--amber);font-weight:700"> ${msg}</span>`;
  };

  // Always read as ArrayBuffer — works for both .docx and .txt
  const reader = new FileReader();
  reader.onload = function(e) {
    const arrayBuffer = e.target.result;
    const isDocx = file.name.match(/\.docx?$/i);

    if (isDocx) {
      // Store raw ArrayBuffer for JSZip-based surgical XML replacement
      // Also extract text via mammoth for preview (if available)
      _ciTemplates[key] = { arrayBuffer, fileName: file.name, isDocx: true, text: null };
      setOk(file.name, '.docx — XML clone mode');
      _ciSaveTemplates();

      // Try to extract text for preview (non-critical)
      if (typeof mammoth !== 'undefined') {
        mammoth.extractRawText({ arrayBuffer: arrayBuffer.slice(0) })
          .then(r => { if (_ciTemplates[key]) { _ciTemplates[key].text = r.value; _ciSaveTemplates(); } })
          .catch(() => {});
      }
    } else {
      // Plain text file
      const text = new TextDecoder().decode(arrayBuffer);
      _ciTemplates[key] = { arrayBuffer: null, fileName: file.name, isDocx: false, text };
      setOk(file.name, '.txt — text mode');
      _ciSaveTemplates();
    }
  };
  reader.readAsArrayBuffer(file);
}

// ─── Helpers ───
function ciGetTemplateKey(area) {
  if (!area) return null;
  const a = area.toUpperCase();
  if (a.includes('KFK')) return 'kfk';
  if (a.includes('FUJ')) return 'fuj';
  return null;
}

function ciAreaLabel(area) {
  const map = {
    'FUJ-A':'FUJ Anchorage','FUJ-B':'FUJ Berth',
    'KFK-A':'KFK Anchorage','KFK-B':'KFK Berth',
    'FUJ Anchorage':'FUJ Anchorage','FUJ Berth':'FUJ Berth',
    'KFK Anchorage':'KFK Anchorage','KFK Berth':'KFK Berth'
  };
  return map[area] || area || '';
}

function ciOrd(d) {
  const n = d.getDate();
  const s = (n===1||n===21||n===31)?'st':(n===2||n===22)?'nd':(n===3||n===23)?'rd':'th';
  const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  return n + s + ' ' + m + "'" + String(d.getFullYear()).slice(2);
}

function ciLaycanStr(lcStr) {
  if (!lcStr) return '';
  const MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};

  // Same-month compact form, e.g. "22-24 Apr 2026" — day-day Month Year, with
  // NOTHING else around the day pair (anchored, so a year's tail digits like
  // "...2026" can never be mistaken for a day number the way a loose,
  // unanchored regex could for cross-month ranges).
  const compactSameMonth = lcStr.trim().match(/^(\d{1,2})\s*[-\u2013]\s*(\d{1,2})\s+(\w+)\s+(\d{4})$/);
  if (compactSameMonth) {
    const d1=parseInt(compactSameMonth[1]),d2=parseInt(compactSameMonth[2]),mon=MONTHS[compactSameMonth[3].toLowerCase().slice(0,3)],yr=parseInt(compactSameMonth[4]);
    const s1=(d1===1||d1===21||d1===31)?'st':(d1===2||d1===22)?'nd':(d1===3||d1===23)?'rd':'th';
    const s2=(d2===1||d2===21||d2===31)?'st':(d2===2||d2===22)?'nd':(d2===3||d2===23)?'rd':'th';
    const mN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][mon];
    return d1+s1+' \u2013 '+d2+s2+' '+mN+"'"+String(yr).slice(2);
  }

  // Single date, e.g. "30 Apr 2026"
  const sgl = lcStr.trim().match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/);
  if (sgl) {
    const d1=parseInt(sgl[1]),mon=MONTHS[sgl[2].toLowerCase().slice(0,3)],yr=parseInt(sgl[3]);
    return ciOrd(new Date(yr,mon,d1));
  }

  // Cross-month / cross-year range, e.g. "24 Jun 2026 - 4 Jul 2026" — each side
  // has its own day AND month, so reuse the same trusted parser the rest of the
  // app uses (parseLaycan) instead of a second hand-rolled regex that could
  // disagree with it. This is what previously broke: a loose, unanchored regex
  // would grab the tail of "2026" (i.e. "26") as a fake "first day".
  const lc = parseLaycan(lcStr);
  if (lc && lc.from && lc.to) {
    const f = lc.from, t = lc.to;
    const ordOf = d => { const s=(d===1||d===21||d===31)?'st':(d===2||d===22)?'nd':(d===3||d===23)?'rd':'th'; return d+s; };
    if (f.getMonth()===t.getMonth() && f.getFullYear()===t.getFullYear()) {
      return ordOf(f.getDate())+' \u2013 '+ordOf(t.getDate())+' '+MO[f.getMonth()]+"'"+String(f.getFullYear()).slice(2);
    }
    return ordOf(f.getDate())+' '+MO[f.getMonth()]+' \u2013 '+ordOf(t.getDate())+' '+MO[t.getMonth()]+"'"+String(t.getFullYear()).slice(2);
  }

  return lcStr;
}

// ─── Open modal for a specific vessel ───
function ciOpenForVessel(vid) {
  const nameEl  = document.getElementById(`v${vid}-name`);
  const typeEl  = document.getElementById(`v${vid}-type`);
  const vlsfoEl = document.getElementById(`v${vid}-vlsfo`);
  const mgoEl   = document.getElementById(`v${vid}-mgo`);
  const areaEl  = document.getElementById(`v${vid}-area`);
  const lcEl    = document.getElementById(`v${vid}-lc`);
  if (!nameEl) return;

  const vessel   = (nameEl.value || '').trim().toUpperCase();
  const type     = typeEl   ? typeEl.value   : 'VLSFO';
  // Read quantities DIRECTLY from current input values — no fallback, no cache
  // Always read directly from live DOM input — no cache, no fallback
  const vlsfoRaw = vlsfoEl ? vlsfoEl.value.trim() : '';
  const lsmgoRaw = mgoEl   ? mgoEl.value.trim()   : '';
  // Null if not entered — do NOT infer or default to nomination
  const safeVlsfo = (type === 'MGO')   ? 0 : (vlsfoRaw !== '' && !isNaN(parseFloat(vlsfoRaw)) ? parseFloat(vlsfoRaw) : 0);
  const safeLsmgo = (type === 'VLSFO') ? 0 : (lsmgoRaw !== '' && !isNaN(parseFloat(lsmgoRaw)) ? parseFloat(lsmgoRaw) : 0);
  const vlsfoQty = safeVlsfo;
  const lsmgoQty = safeLsmgo;
  const area     = areaEl   ? areaEl.value   : '';
  const lcRaw    = lcEl     ? lcEl.value     : '';
  const laycan   = ciLaycanStr(lcRaw);
  const location = ciAreaLabel(area);
  const tplKey   = ciGetTemplateKey(area);

  _ciVesselCtx = { vessel, type, vlsfoQty: safeVlsfo, lsmgoQty: safeLsmgo, area, location, laycan, lcRaw, tplKey };

  document.getElementById('ci-modal-title').textContent   = 'Calling Instructions — ' + vessel;
  document.getElementById('ci-prev-vessel').textContent   = vessel || '(no name)';
  document.getElementById('ci-prev-location').textContent = location;
  document.getElementById('ci-prev-laycan').textContent   = laycan || lcRaw || '—';
  document.getElementById('ci-prev-vlsfo').textContent    = safeVlsfo > 0 ? safeVlsfo.toLocaleString() + ' MT' : '—';
  document.getElementById('ci-prev-lsmgo').textContent    = safeLsmgo > 0 ? safeLsmgo.toLocaleString() + ' MT' : '—';
  document.getElementById('ci-prev-fueltype').textContent = type === 'BOTH' ? 'VLSFO + LSMGO' : type;

  const warnEl = document.getElementById('ci-modal-tpl-warn');
  if (tplKey && _ciTemplates[tplKey]) {
    warnEl.style.display = 'none';
  } else {
    warnEl.style.display = '';
    warnEl.innerHTML = ' No <strong>' + (tplKey ? tplKey.toUpperCase() : '?') + '</strong> template uploaded yet. Upload above the Vessel Nomination Register.';
  }

  document.getElementById('ci-output-wrap').style.display = 'none';
  document.getElementById('ci-pdf-btn').style.display     = 'none';
  document.getElementById('ci-copy-btn2').style.display   = 'none';
  document.getElementById('ci-modal-error').style.display = 'none';
  document.getElementById('ci-output-text').textContent   = '';
  document.getElementById('ci-modal').style.display       = 'flex';
}

function ciCloseModal() {
  document.getElementById('ci-modal').style.display = 'none';
  _ciVesselCtx = null;
}

document.addEventListener('DOMContentLoaded', function() {
  const modal = document.getElementById('ci-modal');
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) ciCloseModal(); });
});

// ─── STRICT TEMPLATE REPLACEMENT ENGINE ───
// Rules: ONLY replace vessel name, fuel lines, location, laycan — nothing else changes
// ══════════════════════════════════════════════════════════════
// CI REPLACEMENT ENGINE — Placeholder-based + pattern fallback
// Supports: {{VESSEL_NAME}} {{VLSFO_QTY}} {{MGO_QTY}} {{LAYCAN}} {{LOCATION}}
// Also detects pattern-based replacements for templates without placeholders
// ══════════════════════════════════════════════════════════════

// ─── Plain-text template replacement (for .txt templates + preview) ───
function ciBuildFuelLines(type,vlsfoQty,lsmgoQty){
  var v=Number(vlsfoQty)||0,m=Number(lsmgoQty)||0,lines=[];
  if((type==='VLSFO'||type==='BOTH'||type==='RMG')&&v>0) lines.push('RMG: - '+v.toLocaleString()+' MT / 380 CST / 0.5% MAX SULFUR');
  if((type==='MGO'||type==='LSMGO'||type==='BOTH')&&m>0) lines.push('MGO: - '+m.toLocaleString()+' MT / DMA / 0.1% MAX SULFUR');
  return lines.join('\n');
}
function ciApplyTemplate(tplText,ctx){
  var vessel=ctx.vessel||'',type=ctx.type||'VLSFO',vlsfoQty=ctx.vlsfoQty||0,lsmgoQty=ctx.lsmgoQty||0,location=ctx.location||'',laycan=ctx.laycan||'';
  tplText=tplText.replace(/[‘’‚‛]/g,"'").replace(/[“”]/g,'"');
  var v=Number(vlsfoQty)||0,m=Number(lsmgoQty)||0;
  if(v===0&&m===0) throw new Error('Both fuel quantities are 0.');
  var fl=ciBuildFuelLines(type,v,m),vs=v>0?v.toLocaleString()+' MT':'',ms=m>0?m.toLocaleString()+' MT':'';
  if(tplText.indexOf('{{VESSEL_NAME}}')>=0||tplText.indexOf('{{FUEL_LINES}}')>=0||tplText.indexOf('{{VLSFO_QTY}}')>=0||tplText.indexOf('{{LAYCAN}}')>=0){
    return tplText.split('{{VESSEL_NAME}}').join(vessel).split('{{FUEL_LINES}}').join(fl).split('{{VLSFO_QTY}}').join(vs).split('{{MGO_QTY}}').join(ms).split('{{LSMGO_QTY}}').join(ms).split('{{LAYCAN}}').join(laycan).split('{{LOCATION}}').join(location);
  }
  var out=tplText;
  out=out.replace(/(To\s*:\s*The Master\s*:\s*).+/gi,function(_,p){return p+vessel;});
  var done=false;
  out=out.replace(/^[ 	]*(RMG|MGO|DMA)\s*[:\-].+$/gmi,function(m){if(!done){done=true;return fl;}return '';});
  out=ciReplaceLocation(out,location);
  return out;
}

function ciReplaceLocation(text, location) {
  // Order matters: match longest/most-specific patterns first
  return text
    // Full city name + qualifier (longest match first)
    .replace(/FUJAIRAH\s+ANCHORAGE/gi,        location)
    .replace(/FUJAIRAH\s+BERTH/gi,            location)
    .replace(/KHOR\s+FAKKAN\s+ANCHORAGE/gi,  location)
    .replace(/KHOR\s+FAKKAN\s+BERTH/gi,      location)
    .replace(/KHOR-FAKKAN\s+ANCHORAGE/gi,     location)
    .replace(/KHOR-FAKKAN\s+BERTH/gi,         location)
    // Short code + qualifier
    .replace(/\bFUJ\s+ANCHORAGE\b/gi,        location)
    .replace(/\bFUJ\s+BERTH\b/gi,            location)
    .replace(/\bKFK\s+ANCHORAGE\b/gi,        location)
    .replace(/\bKFK\s+BERTH\b/gi,            location)
    .replace(/\bFUJ\s+Anchorage\b/g,         location)
    .replace(/\bFUJ\s+Berth\b/g,             location)
    .replace(/\bKFK\s+Anchorage\b/g,         location)
    .replace(/\bKFK\s+Berth\b/g,             location)
    // Full city name alone (no qualifier) — still replace
    .replace(/\bFUJAIRAH\b/gi,               location)
    .replace(/\bKHOR\s+FAKKAN\b/gi,          location)
    .replace(/\bKHOR-FAKKAN\b/gi,            location);
}

// ─── Load JSZip from CDN ───
async function ciLoadJSZip() {
  if (typeof JSZip !== 'undefined') return JSZip;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = () => resolve(JSZip);
    s.onerror = () => reject(new Error('Could not load JSZip. Check your internet connection.'));
    document.head.appendChild(s);
  });
}

// ─── Generate: preview + download ───
async function ciGenerate() {
  const ctx    = _ciVesselCtx;
  const errEl  = document.getElementById('ci-modal-error');
  const genBtn = document.getElementById('ci-gen-btn');
  errEl.style.display = 'none';

  if (!ctx || !ctx.vessel) {
    errEl.textContent = ' No vessel selected or vessel has no name.'; errEl.style.display = ''; return;
  }

  // ── Always re-read quantities from live DOM (never trust cached ctx) ──
  const vid = ctx.id;
  if (vid) {
    const liveType  = document.getElementById(`v${vid}-type`);
    const liveVlsfo = document.getElementById(`v${vid}-vlsfo`);
    const liveMgo   = document.getElementById(`v${vid}-mgo`);
    const liveArea  = document.getElementById(`v${vid}-area`);
    const liveLc    = document.getElementById(`v${vid}-lc`);
    if (liveType)  ctx.type     = liveType.value;
    if (liveArea)  { ctx.area = liveArea.value; ctx.location = ciAreaLabel(liveArea.value); ctx.tplKey = ciGetTemplateKey(liveArea.value); }
    if (liveLc)    ctx.laycan   = ciLaycanStr(liveLc.value);
    const freshType  = ctx.type || 'VLSFO';
    ctx.vlsfoQty = (freshType === 'MGO')   ? 0 : (liveVlsfo ? parseFloat(liveVlsfo.value||0)||0 : 0);
    ctx.lsmgoQty = (freshType === 'VLSFO') ? 0 : (liveMgo   ? parseFloat(liveMgo.value  ||0)||0 : 0);
    // Refresh preview panel
    const pv = document.getElementById('ci-prev-vlsfo');
    const pm = document.getElementById('ci-prev-lsmgo');
    if (pv) pv.textContent = ctx.vlsfoQty > 0 ? ctx.vlsfoQty.toLocaleString() + ' MT' : '—';
    if (pm) pm.textContent = ctx.lsmgoQty > 0 ? ctx.lsmgoQty.toLocaleString() + ' MT' : '—';
  }

  if (!ctx.tplKey || !_ciTemplates[ctx.tplKey]) {
    errEl.innerHTML = ' No <strong>' + (ctx.tplKey||'?').toUpperCase() + '</strong> template uploaded. Upload it above.';
    errEl.style.display = ''; return;
  }
  if (!ctx.laycan) {
    errEl.textContent = ' Laycan is empty — set Laycan on the vessel card first.'; errEl.style.display = ''; return;
  }

  const tpl = _ciTemplates[ctx.tplKey];

  // Preview
  let previewText;
  try {
    previewText = tpl.text ? ciApplyTemplate(tpl.text, ctx) : '(Binary .docx — preview not available. Document will download with exact formatting.)';
  } catch(previewErr) {
    errEl.textContent = ' ' + previewErr.message; errEl.style.display = ''; return;
  }
  document.getElementById('ci-output-text').textContent      = previewText;
  document.getElementById('ci-out-vessel-label').textContent = ctx.vessel;
  document.getElementById('ci-output-wrap').style.display    = '';
  document.getElementById('ci-pdf-btn').style.display        = '';
  document.getElementById('ci-copy-btn2').style.display      = '';

  genBtn.disabled = true; genBtn.textContent = '⏳ Generating…';
  try {
    if (tpl.isDocx && tpl.arrayBuffer) {
      await ciCloneDocxAndDownload(tpl.arrayBuffer, ctx);
    } else if (tpl.text) {
      await ciDownloadFromText(tpl.text, ctx);
    } else {
      throw new Error('No usable template data found.');
    }
  } catch (err) {
    errEl.textContent = ' ' + err.message;
    errEl.style.display = '';
  } finally {
    genBtn.disabled = false; genBtn.textContent = ' Generate Document';
  }
}

// ══════════════════════════════════════════════════════════════
// DOCX XML SURGERY — Paragraph-level text reconstruction
// Handles split runs: {{VESSEL_NAME}} across multiple <w:t> tags
// ══════════════════════════════════════════════════════════════
// ── Shared: load the reference docx and substitute placeholder values,
// returning the zip + formatted XML (fonts/styles/letterhead intact) ──
async function _ciCloneDocxSubstitute(arrayBuffer, ctx) {
  const JSZipLib = await ciLoadJSZip();
  const zip      = await JSZipLib.loadAsync(arrayBuffer);

  let docXml = await zip.file('word/document.xml').async('string');

  const { type, vlsfoQty, lsmgoQty } = ctx;

  // ── CORE: Reconstruct paragraph text, replace, write single run back ──
  // This handles cases where {{VESSEL_NAME}} is split like:
  //   <w:t>{{VESSEL</w:t><w:t>_NAME}}</w:t>  →  <w:t>MT PACIFIC GLORY</w:t>
  docXml = ciDocxReplaceParagraphText(docXml, ctx);

  // ════════════════════════════════════════════════════════
  // GUARANTEED QTY REPLACEMENT — bulletproof raw XML pass
  // ctx.vlsfoQty / ctx.lsmgoQty are the ONLY source of truth
  // ════════════════════════════════════════════════════════
  const vQty = ctx.vlsfoQty;
  const mQty = ctx.lsmgoQty;

  function xmlQtyReplace(xml, keyword, qty) {
    if (!qty || qty <= 0) return xml;
    xml = xml.replace(
      new RegExp('(<w:t[^>]*>[^<]*' + keyword + '[^<]*?)(\d[\d,]*(?:\.\d+)?)(\s*MT\b)', 'gi'),
      function(_, pre, _n, mt) { return pre + qty + mt; }
    );
    xml = xml.replace(
      new RegExp('(<w:t[^>]*>[^<]*' + keyword + '[^<]*<\/w:t>(?:<(?!w:t)[^>]*>)*<w:t[^>]*>[^<]*?)(\d[\d,]*(?:\.\d+)?)(\s*MT\b)', 'gi'),
      function(_, pre, _n, mt) { return pre + qty + mt; }
    );
    return xml;
  }

  if (type === 'VLSFO' || type === 'RMG') {
    docXml = xmlQtyReplace(docXml, 'RMG', vQty);
  } else if (type === 'MGO' || type === 'LSMGO') {
    docXml = xmlQtyReplace(docXml, 'MGO', mQty);
    docXml = xmlQtyReplace(docXml, 'DMA', mQty);
  } else {
    docXml = xmlQtyReplace(docXml, 'RMG', vQty);
    docXml = xmlQtyReplace(docXml, 'MGO', mQty);
    docXml = xmlQtyReplace(docXml, 'DMA', mQty);
  }

  return { zip, docXml };
}

async function ciCloneDocxAndDownload(arrayBuffer, ctx) {
  const { zip, docXml } = await _ciCloneDocxSubstitute(arrayBuffer, ctx);
  zip.file('word/document.xml', docXml);

  const outBuf = await zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  ciTriggerDownload(
    new Blob([outBuf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    'Calling_Instructions_' + ctx.vessel.replace(/\s+/g,'_') + '.docx'
  );
}

// ── Preserves the original reference file's formatting AND applies the
// operator's edits from the preview textarea. Strategy: clone + substitute
// as normal (identical output to ciCloneDocxAndDownload if nothing was
// edited), then diff the baseline preview text against the edited text
// line by line. Any line that changed gets surgically swapped into the
// matching paragraph in the docx — keeping that paragraph's original
// formatting (pPr/rPr) — using the exact same "rebuild paragraph, keep
// styling" technique ciDocxReplaceParagraphText already uses for
// placeholders. Lines that couldn't be safely, unambiguously matched
// (e.g. whole new lines inserted) are appended as a clearly-labelled
// block at the end rather than risking corrupting the document — so an
// edit is NEVER silently lost, but the original formatting is NEVER
// blindly discarded either. ──
async function ciCloneDocxWithEditsAndDownload(arrayBuffer, ctx, baselineText, editedText) {
  const { zip, docXml } = await _ciCloneDocxSubstitute(arrayBuffer, ctx);
  const { xml: patchedXml, unplacedLines } = ciDocxApplyLineEdits(docXml, baselineText, editedText);

  let finalXml = patchedXml;
  if (unplacedLines.length) {
    finalXml = ciDocxAppendPlainParagraphs(finalXml, unplacedLines);
  }

  zip.file('word/document.xml', finalXml);

  const outBuf = await zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  ciTriggerDownload(
    new Blob([outBuf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    'Calling_Instructions_' + ctx.vessel.replace(/\s+/g,'_') + '.docx'
  );
}

// Diff two texts line by line and patch changed lines directly into their
// matching paragraph in the docx XML, preserving that paragraph's original
// formatting. Returns any edited/new lines that couldn't be safely,
// unambiguously matched to a single original paragraph — these are NOT
// applied (to avoid guessing wrong and corrupting the file) and are instead
// returned so they can be appended visibly at the end of the document.
function ciDocxApplyLineEdits(xml, baselineText, editedText) {
  const xe = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const baseLines = baselineText.split('\n');
  const editLines  = editedText.split('\n');

  // Collect the set of line-level changes we can act on.
  const changes = [];      // [{oldLine, newLine}]
  const unplacedLines = [];

  if (baseLines.length === editLines.length) {
    // Same number of lines — safe positional diff, handles the overwhelming
    // majority of real edits (fixing a value, a name, a typo, a sentence).
    for (let i = 0; i < baseLines.length; i++) {
      if (baseLines[i] !== editLines[i]) {
        if (baseLines[i].trim()) changes.push({ oldLine: baseLines[i], newLine: editLines[i] });
        else if (editLines[i].trim()) unplacedLines.push(editLines[i]);
      }
    }
  } else {
    // Lines were added/removed — only touch lines whose OLD text still
    // exists unchanged somewhere and whose paired NEW text is genuinely
    // new content; anything else is appended rather than guessed at.
    const baseSet = new Set(baseLines);
    editLines.forEach(l => { if (l.trim() && !baseSet.has(l)) unplacedLines.push(l); });
  }

  // Only apply a change if the OLD line's text is unique across the whole
  // document (appears in exactly one paragraph) — otherwise we can't be
  // sure which paragraph the operator meant, so it's safer to append it
  // as a visible addition than to risk editing the wrong occurrence.
  const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/gi)];
  const paraFullText = paragraphs.map(m => {
    return [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/gi)]
      .map(t => t[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(parseInt(n))))
      .join('');
  });

  let result = xml;
  changes.forEach(({ oldLine, newLine }) => {
    const matchIdxs = [];
    paraFullText.forEach((t, idx) => { if (t === oldLine) matchIdxs.push(idx); });
    if (matchIdxs.length !== 1) { unplacedLines.push(newLine); return; }

    const pi = matchIdxs[0];
    const para = paragraphs[pi][0];
    const paraStart = result.indexOf(para);
    if (paraStart === -1) { unplacedLines.push(newLine); return; } // xml shifted underneath us — skip safely

    const rPrMatch = para.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/i);
    const rPr = rPrMatch ? '<w:rPr>' + rPrMatch[1] + '</w:rPr>' : '';
    const pPrMatch = para.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/i);
    const pPr = pPrMatch ? '<w:pPr>' + pPrMatch[1] + '</w:pPr>' : '';
    const pOpenMatch = para.match(/^(<w:p\b[^>]*>)/i);
    const pOpen = pOpenMatch ? pOpenMatch[1] : '<w:p>';
    const needsSpace = newLine.startsWith(' ') || newLine.endsWith(' ');
    const xmlSpace = needsSpace ? ' xml:space="preserve"' : '';
    const newPara = pOpen + pPr + '<w:r>' + rPr + '<w:t' + xmlSpace + '>' + xe(newLine) + '</w:t></w:r></w:p>';

    result = result.slice(0, paraStart) + newPara + result.slice(paraStart + para.length);
  });

  return { xml: result, unplacedLines };
}

// Appends plain paragraphs (default body formatting) at the end of the
// document body for any edited/new lines that couldn't be safely matched
// to an existing paragraph — guarantees an edit is visible in the output
// even when it can't be surgically placed inline.
function ciDocxAppendPlainParagraphs(xml, lines) {
  const xe = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const headerPara = '<w:p><w:pPr><w:spacing w:before="240"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>— Additional edits —</w:t></w:r></w:p>';
  const bodyParas = lines.map(l =>
    '<w:p><w:r><w:t xml:space="preserve">' + xe(l) + '</w:t></w:r></w:p>'
  ).join('');
  const bodyCloseIdx = xml.lastIndexOf('</w:body>');
  if (bodyCloseIdx === -1) return xml;
  return xml.slice(0, bodyCloseIdx) + headerPara + bodyParas + xml.slice(bodyCloseIdx);
}

// ── Process each paragraph: extract full text, replace, inject back ──
function ciDocxReplaceParagraphText(xml, ctx) {
  const { vessel, type, vlsfoQty, lsmgoQty, location, laycan } = ctx;
  const xe = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // ── STRICT: Only replace {{PLACEHOLDERS}} — no pattern guessing ──
  const vlsfoNum = (type !== 'MGO')   ? Number(vlsfoQty) : 0;
  const mgoNum   = (type !== 'VLSFO') ? Number(lsmgoQty) : 0;
  var fl2=ciBuildFuelLines(type,vlsfoNum,mgoNum);
  const valueMap={'{{VESSEL_NAME}}':vessel||'','{{FUEL_LINES}}':fl2,'{{VLSFO_QTY}}':vlsfoNum>0?vlsfoNum.toLocaleString()+' MT':'','{{MGO_QTY}}':mgoNum>0?mgoNum.toLocaleString()+' MT':'','{{LSMGO_QTY}}':mgoNum>0?mgoNum.toLocaleString()+' MT':'','{{LAYCAN}}':laycan||'','{{LOCATION}}':location||''};

  // Validate all placeholders exist in raw XML text
  const docTextAll = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/gi)]
    .map(m => m[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'))
    .join('');

  // Reconstruct placeholder text across split runs
  // Each paragraph: concatenate all <w:t> content, replace, write back
  const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/gi)];
  let result = xml;

  for (let pi = paragraphs.length - 1; pi >= 0; pi--) {
    const match = paragraphs[pi];
    const para  = match[0];
    const paraStart = match.index;
    const paraEnd   = paraStart + para.length;

    const rPrMatch = para.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/i);
    const rPr = rPrMatch ? '<w:rPr>' + rPrMatch[1] + '</w:rPr>' : '';
    const pPrMatch = para.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/i);
    const pPr = pPrMatch ? '<w:pPr>' + pPrMatch[1] + '</w:pPr>' : '';

    // Concatenate all <w:t> in this paragraph
    const allParts = [...para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/gi)].map(m =>
      m[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
          .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(parseInt(n)))
    );
    const fullText = allParts.join('');
    if (!fullText.trim()) continue;

    // Only proceed if this paragraph contains at least one placeholder
    const hasPlaceholder = Object.keys(valueMap).some(ph => fullText.includes(ph));
    if (!hasPlaceholder) continue;

    // Replace all placeholders in the full text
    let replaced = fullText;
    Object.entries(valueMap).forEach(([ph, val]) => {
      replaced = replaced.split(ph).join(val);
    });

    if (replaced === fullText) continue;

    // Rebuild paragraph with replaced text
    const pOpenMatch = para.match(/^(<w:p\b[^>]*>)/i);
    const pOpen = pOpenMatch ? pOpenMatch[1] : '<w:p>';
    const needsSpace = replaced.startsWith(' ') || replaced.endsWith(' ');
    const xmlSpace = needsSpace ? ' xml:space="preserve"' : '';
    const newPara = pOpen + pPr + '<w:r>' + rPr + '<w:t' + xmlSpace + '>' + xe(replaced) + '</w:t></w:r></w:p>';
    result = result.slice(0, paraStart) + newPara + result.slice(paraEnd);
  }
  return result;
}


function ciTriggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── Re-download button is defined below as ciDownloadPDF ──

// ══════════════════════════════════════════════════════════════
// FALLBACK: .txt template → minimal valid .docx
// ══════════════════════════════════════════════════════════════
async function _ciBuildDocxBlobFromText(text) {
  const JSZipLib = await ciLoadJSZip();
  const xe = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const lines = text.split('\n');
  const paraXml = lines.map(line => {
    if (!line.trim()) return '<w:p><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:p>';
    return `<w:p><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${xe(line)}</w:t></w:r></w:p>`;
  }).join('');

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${paraXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1418"/></w:sectPr></w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const appRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const zip = new JSZipLib();
  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', appRels);
  zip.file('word/document.xml', docXml);

  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
}

async function ciDownloadFromText(tplText, ctx) {
  const output = ciApplyTemplate(tplText, ctx);
  const blob = await _ciBuildDocxBlobFromText(output);
  ciTriggerDownload(blob, 'Calling_Instructions_' + ctx.vessel.replace(/\s+/g,'_') + '.docx');
}

// Builds the docx directly from literal text with NO re-templating pass.
// Used for the "Edit Before Download" flow so whatever the user typed in
// the preview textarea — including any hand-edited vessel name, quantity,
// or location line — is exactly what ends up in the downloaded file.
// (ciDownloadFromText() re-runs ciApplyTemplate(), which would otherwise
// silently overwrite those same lines back to the original template values.)
async function ciDownloadRawText(text, vessel) {
  const blob = await _ciBuildDocxBlobFromText(text);
  ciTriggerDownload(blob, 'Calling_Instructions_' + vessel.replace(/\s+/g,'_') + '.docx');
}


function ciOpenPreview(){
  var ctx=_ciVesselCtx,errEl=document.getElementById('ci-modal-error');
  errEl.style.display='none';
  if(!ctx||!ctx.vessel){errEl.textContent='No vessel selected.';errEl.style.display='';return;}
  var vid=ctx.id;
  if(vid){
    var lt=document.getElementById('v'+vid+'-type'),lv=document.getElementById('v'+vid+'-vlsfo'),lm=document.getElementById('v'+vid+'-mgo'),la=document.getElementById('v'+vid+'-area'),ll=document.getElementById('v'+vid+'-lc');
    if(lt)ctx.type=lt.value;if(la){ctx.area=la.value;ctx.location=ciAreaLabel(la.value);ctx.tplKey=ciGetTemplateKey(la.value);}if(ll)ctx.laycan=ciLaycanStr(ll.value);
    var ft=ctx.type||'VLSFO';ctx.vlsfoQty=ft==='MGO'?0:(lv?parseFloat(lv.value||0)||0:0);ctx.lsmgoQty=ft==='VLSFO'?0:(lm?parseFloat(lm.value||0)||0:0);
  }
  if(!ctx.tplKey||!_ciTemplates[ctx.tplKey]){errEl.innerHTML='No <strong>'+(ctx.tplKey||'?').toUpperCase()+'</strong> template uploaded.';errEl.style.display='';return;}
  if(!ctx.laycan){errEl.textContent='Laycan is empty.';errEl.style.display='';return;}
  if((Number(ctx.vlsfoQty)||0)===0&&(Number(ctx.lsmgoQty)||0)===0){errEl.textContent='Fuel quantity is 0.';errEl.style.display='';return;}
  var tpl=_ciTemplates[ctx.tplKey];
  var preview;
  try{
    preview=tpl.text?ciApplyTemplate(tpl.text,ctx)
      :['To: The Master: '+ctx.vessel,'Sub: Calling Instructions – '+ctx.vessel,'','Location: '+(ctx.location||''),'','Quantity:',ciBuildFuelLines(ctx.type,ctx.vlsfoQty,ctx.lsmgoQty),'','Laycan: '+(ctx.laycan||''),'','(Binary .docx — preview only.)'].join('\n');
  }catch(e){errEl.textContent=e.message;errEl.style.display='';return;}
  var pm=document.getElementById('ci-preview-modal');
  if(!pm){
    pm=document.createElement('div');pm.id='ci-preview-modal';
    pm.style.cssText='display:none;position:fixed;inset:0;background:rgba(13,27,42,.5);backdrop-filter:blur(4px);z-index:9600;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto';
    pm.innerHTML='<div style="background:var(--surface);border-radius:16px;width:min(720px,100%);box-shadow:0 20px 60px rgba(13,27,42,.25);overflow:hidden;margin:auto"><div style="background:linear-gradient(135deg,var(--ink-solid),#1A3A5C);color:#fff;padding:16px 20px;display:flex;align-items:center;justify-content:space-between"><div><div style="font-size:15px;font-weight:700;font-family:DM Sans,sans-serif">Edit Before Download</div><div id="ci-preview-vessel-label" style="font-size:11px;opacity:.6;margin-top:2px"></div></div><button onclick="ciClosePreview()" style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.2);color:#fff;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:16px">&#x2715;</button></div><div style="padding:18px 20px"><div style="font-size:11px;color:var(--sub);margin-bottom:8px">Review and edit. Changes apply to this download only.</div><textarea id="ci-preview-textarea" style="width:100%;height:420px;font-family:DM Mono,monospace;font-size:12px;line-height:1.8;padding:14px;border:none;box-shadow:var(--sh-in-xs);border-radius:10px;resize:vertical;outline:none;color:var(--ink);background:var(--surface)" spellcheck="false"></textarea><div style="display:flex;gap:10px;margin-top:14px;justify-content:flex-end"><button onclick="ciClosePreview()" style="padding:10px 18px;background:var(--surface);border:none;box-shadow:var(--sh-sm);border-radius:8px;font-size:13px;cursor:pointer;font-family:DM Sans,sans-serif;color:var(--sub)">Cancel</button><button onclick="ciConfirmAndGenerate()" style="padding:10px 24px;background:linear-gradient(135deg,var(--ink-solid),var(--fuel-v));color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif">Confirm &amp; Download</button></div></div></div>';
    document.body.appendChild(pm);
  }
  document.getElementById('ci-preview-textarea').value=preview;
  document.getElementById('ci-preview-vessel-label').textContent=ctx.vessel;
  ctx._originalPreviewText = preview; // baseline for diffing user edits, see ciConfirmAndGenerate()
  pm.style.display='flex';
}
function ciClosePreview(){var pm=document.getElementById('ci-preview-modal');if(pm)pm.style.display='none';}
async function ciConfirmAndGenerate(){
  var ctx=_ciVesselCtx,errEl=document.getElementById('ci-modal-error');
  var txt=(document.getElementById('ci-preview-textarea')?document.getElementById('ci-preview-textarea').value:'').trim();
  errEl.style.display='none';ciClosePreview();
  if(!txt){errEl.textContent='Empty document.';errEl.style.display='';return;}
  document.getElementById('ci-output-text').textContent=txt;
  document.getElementById('ci-out-vessel-label').textContent=ctx.vessel;
  document.getElementById('ci-output-wrap').style.display='';
  document.getElementById('ci-pdf-btn').style.display='';
  document.getElementById('ci-copy-btn2').style.display='';
  var genBtn=document.getElementById('ci-gen-btn');
  if(genBtn){genBtn.disabled=true;genBtn.textContent='Generating…';}
  var tpl=_ciTemplates[ctx&&ctx.tplKey];
  try{
    if(tpl&&tpl.isDocx&&tpl.arrayBuffer){
      // Preserve the original reference file's exact formatting/letterhead —
      // clone it and substitute the placeholder values as normal — then
      // surgically patch in whatever the operator actually edited in the
      // preview, line by line, so edits show up WITHOUT throwing away the
      // original document's fonts/styles. (Rebuilding a fresh plain-text
      // docx from scratch, as this used to do, destroyed the formatting
      // entirely and wasn't even the operator's reference file anymore.)
      var baseline = ctx._originalPreviewText || txt;
      await ciCloneDocxWithEditsAndDownload(tpl.arrayBuffer, ctx, baseline, txt);
    } else {
      await ciDownloadRawText(txt, ctx.vessel);
    }
  }catch(err){errEl.textContent=err.message;errEl.style.display='';}
  finally{if(genBtn){genBtn.disabled=false;genBtn.textContent='Preview & Generate';}}
}
// ─── Copy plain text ───
function ciCopyOutput() {
  const text = document.getElementById('ci-output-text').textContent;
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
  });
  const btn = document.getElementById('ci-copy-btn2');
  const orig = btn.textContent;
  btn.textContent = 'Copied!'; btn.style.color = 'var(--green)';
  setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 2000);
}

// ─── Re-download docx button — reuses the currently displayed text, which
// reflects any edits made via "Edit Before Download", not the raw template ───
async function ciDownloadPDF() {
  const ctx = _ciVesselCtx;
  if (!ctx) return;
  const outEl = document.getElementById('ci-output-text');
  const txt = outEl ? outEl.textContent.trim() : '';
  if (!txt) return;
  try {
    await ciDownloadRawText(txt, ctx.vessel);
  } catch(err) {
    const errEl = document.getElementById('ci-modal-error');
    errEl.textContent = ' ' + err.message; errEl.style.display = '';
  }
}



// ===== next inline <script> block from original index.html =====


/* ═══ EMAIL GENERATOR — Built-in templates per location ═══ */
var _emailVesselCtx = null;

var _EMAIL_BODY_FUJ = [
'ATTN :  OPERATIONS',
'{{AGENT}}',
'FUJAIRAH',
'',
'Good day all,',
'',
'We are nominated bunker supplier for the subject vessel at {{LOCATION}}, request you please keep us posted with her firm and consistent ETA notices basis 96/72/48/36/24/12 HRS to our common mail ID at operations@gpsbunkers.com',
'',
'NOMINATED DATE OF SUPPLY – On {{LAYCAN}}.',
'NOMINATED QUANTITY - {{VLSFO_QTY}} MT LSFO / {{MGO_QTY}} MT LSMGO',
'',
'Attached is calling instructions and pre arrival bunkering questionnaire form to be passed on to vessel\u2019s master asking him to confirm his understanding over content of calling instruction by acknowledging it with his sign and vessel\u2019s stamp.',
'',
'For our operational planning please ask vessel\u2019s master to revert with filled Q27.',
'',
'Agents are requested to revert with the following information:',
'',
'Any off signer crew change? Yes/No',
'',
'Purpose of call:',
'a) Bunkering and Owners matter',
'b) Bunkering and Cargo operations',
'c) Bunkering and then waiting for orders',
'd) Bunkering, repair and/or hull cleaning',
'',
'AND,',
'',
'In case cargo operations, please specify below:',
'a) Cargo operations terminal FOTT, VOPAK, or STS',
'b) Bunkering prior or after cargo operations',
'c) Duration of cargo operations',
'd) In case berthing not on arrival, can we plan to arrange bunkers subject to have enough window for bunkering before her berthing.',
'',
'',
'PLEASE KEEP OUR COMMON E MAIL ID - operations@gpsbunkers.com IN CC FOR ALL COMMUNICATION - WHICH IS MONITORED 24 HRS.'
].join('\n');

var _EMAIL_BODY_KFK = [
'ATTN :  OPERATIONS',
'{{AGENT}}',
'KHORFAKKAN',
'',
'Good day all,',
'',
'We are nominated bunker supplier for the subject vessel at {{LOCATION}}, request you please keep us posted with her firm and consistent ETA notices basis 96/72/48/36/24/12 HRS to our common mail ID at operations@gpsbunkers.com',
'',
'NOMINATED DATE OF SUPPLY – On {{LAYCAN}}.',
'NOMINATED QUANTITY - {{VLSFO_QTY}} MT LSFO / {{MGO_QTY}} MT LSMGO',
'',
'Attached is calling instructions and pre arrival bunkering questionnaire form to be passed on to vessel\u2019s master asking him to confirm his understanding over content of calling instruction by acknowledging it with his sign and vessel\u2019s stamp.',
'',
'For our operational planning please ask vessel\u2019s master to revert with filled Q27.',
'',
'Agents are requested to revert with the following information:',
'',
'Any off signer crew change? Yes/No',
'',
'Purpose of call:',
'a) Bunkering and Owners matter',
'b) Bunkering and Cargo operations',
'c) Bunkering and then waiting for orders',
'd) Bunkering, repair and/or hull cleaning',
'',
'AND,',
'',
'In case cargo operations, please specify below:',
'a) Cargo operations terminal FOTT, VOPAK, or STS',
'b) Bunkering prior or after cargo operations',
'c) Duration of cargo operations',
'd) In case berthing not on arrival, can we plan to arrange bunkers subject to have enough window for bunkering before her berthing.',
'',
'',
'PLEASE KEEP OUR COMMON E MAIL ID - operations@gpsbunkers.com IN CC FOR ALL COMMUNICATION - WHICH IS MONITORED 24 HRS.'
].join('\n');

function _emailApply(tpl, ctx) {
  var v = Number(ctx.vlsfoQty) || 0;
  var m = Number(ctx.lsmgoQty) || 0;
  return tpl
    .split('{{AGENT}}').join(ctx.agent || '')
    .split('{{LOCATION}}').join(ctx.location || '')
    .split('{{LAYCAN}}').join(ctx.laycan || '')
    .split('{{VLSFO_QTY}}').join(v > 0 ? v.toLocaleString() : '—')
    .split('{{MGO_QTY}}').join(m > 0 ? m.toLocaleString() : '—')
    .split('{{VESSEL_NAME}}').join(ctx.vessel || '');
}

/* ── HTML formatting layer ──────────────────────────────────────────
   Renders the exact same merged plain-text body (from _emailApply)
   as styled HTML matching the original mail screenshots: bold ATTN
   block, bold NOMINATED lines, bold+underlined section headers, the
   shared mailbox rendered as a real blue hyperlink, and a bold final
   CC line. This is purely a presentation layer — it works line-by-
   line over the already-merged text, so the wording, structure, and
   berth/anchorage content are identical to the plain-text version;
   nothing here can add, remove, or reorder a single word. ─────────── */
function _emailLineToHtml(line, colorOverride) {
  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  // Every leaf tag gets an explicit color — either the passed-in block color, or
  // plain black — never left to inherit, since Outlook's paste engine doesn't
  // reliably cascade inherited color from a wrapping element any more than it
  // cascades inherited font-weight (that's what caused the earlier bold bug).
  var textColor = colorOverride || '#000000';
  function linkifyEmail(s) {
    return s.replace(/operations@gpsbunkers\.com/g,
      '<a href="mailto:operations@gpsbunkers.com" style="color:#1565C0;text-decoration:underline;font-weight:400">operations@gpsbunkers.com</a>');
  }

  var trimmed = line.trim();

  // Blank line — let _emailBodyToHtml turn this into &nbsp; for proper paragraph
  // spacing, same as before; don't wrap it in a styled span.
  if (!trimmed) return '';

  // Bold ATTN header block: "ATTN :  OPERATIONS", the agent/RHS line, and the site name line
  if (/^ATTN\s*:/i.test(trimmed)) {
    return '<strong style="font-weight:700;color:' + textColor + '">' + escHtml(line) + '</strong>';
  }

  // Bold + underlined section headers
  if (/^Agents are requested to revert with the following information:$/i.test(trimmed) ||
      /^Purpose of call:$/i.test(trimmed) ||
      /^In case cargo operations,/i.test(trimmed)) {
    return '<strong style="font-weight:700;text-decoration:underline;color:' + textColor + '">' + escHtml(line) + '</strong>';
  }

  // Bold NOMINATED DATE / NOMINATED QUANTITY lines
  if (/^NOMINATED (DATE OF SUPPLY|QUANTITY)/i.test(trimmed)) {
    return '<strong style="font-weight:700;color:' + textColor + '">' + escHtml(line) + '</strong>';
  }

  // Bold final CC instruction line (same size as the rest of the body — bold
  // only, nothing else), with the mailbox linkified inside the bold run
  if (/^PLEASE KEEP OUR COMMON E MAIL ID/i.test(trimmed)) {
    return '<strong style="font-size:inherit;font-weight:700;color:' + textColor + '">' + linkifyEmail(escHtml(line)) + '</strong>';
  }

  // Any other line — explicitly NORMAL weight and explicit color (not left
  // unstyled). Outlook's paste engine will otherwise let unstyled runs inherit
  // whatever the destination compose window's own default style is, which is how
  // a message can come out looking entirely bold/black even when it shouldn't.
  return '<span style="font-weight:400;color:' + textColor + '">' + linkifyEmail(escHtml(line)) + '</span>';
}

function _emailBodyToHtml(body) {
  // "Dark Blue, Text 2, Lighter 10%" — Word's default-theme Text 2 (1F497D)
  // tinted 10% toward white. Applies to the calling-instructions / pre-arrival
  // questionnaire block only (from "Attached is calling instructions…" through
  // the last "d) In case berthing not on arrival…" line) — nothing else in the
  // email changes color, and bold/underline headers inside the block still work.
  var COLOR_BLOCK_START = /^Attached is calling instructions/i;
  var COLOR_BLOCK_END   = /^d\)\s*In case berthing not on arrival/i;
  var BLOCK_COLOR = '#355B8A';
  var inColorBlock = false;

  return body.split('\n').map(function(line) {
    var trimmed = line.trim();
    if (!inColorBlock && COLOR_BLOCK_START.test(trimmed)) inColorBlock = true;

    var rendered = _emailLineToHtml(line, inColorBlock ? BLOCK_COLOR : null);
    var out = rendered === '' ? '&nbsp;' : rendered;

    if (inColorBlock && COLOR_BLOCK_END.test(trimmed)) inColorBlock = false;
    return out;
  }).join('<br>');
}

function emailOpenForVessel(vid) {
  var nEl = document.getElementById('v'+vid+'-name'); if (!nEl) return;
  var typeEl  = document.getElementById('v'+vid+'-type');
  var vlsfoEl = document.getElementById('v'+vid+'-vlsfo');
  var mgoEl   = document.getElementById('v'+vid+'-mgo');
  var areaEl  = document.getElementById('v'+vid+'-area');
  var lcEl    = document.getElementById('v'+vid+'-lc');
  var agentEl = document.getElementById('v'+vid+'-agent');

  var vessel   = (nEl.value || '').trim().toUpperCase();
  var type     = typeEl  ? typeEl.value  : 'VLSFO';
  var vlsfoQty = type === 'MGO'   ? 0 : parseFloat((vlsfoEl && vlsfoEl.value) || 0) || 0;
  var lsmgoQty = type === 'VLSFO' ? 0 : parseFloat((mgoEl   && mgoEl.value)   || 0) || 0;
  var area     = areaEl  ? areaEl.value  : '';
  var location = ciAreaLabel(area);
  var laycan   = ciLaycanStr(lcEl ? lcEl.value : '');
  var agent    = agentEl ? agentEl.value : '';

  _emailVesselCtx = { id:vid, vessel:vessel, type:type, vlsfoQty:vlsfoQty, lsmgoQty:lsmgoQty,
    area:area, location:location, laycan:laycan, agent:agent };

  // Look up the typed/selected agent against the Agent Directory (case-insensitive,
  // trimmed match) so the mailto "To" field is pre-filled automatically. If the agent
  // isn't in the directory yet, leave To blank for manual entry — nothing else changes.
  var toEmails = '', toNote = '';
  if (agent && agent.trim()) {
    if (!_agents || !_agents.length) _loadAgents();
    var aKey = agent.trim().toLowerCase();
    var matchedAgent = (_agents||[]).find(function(x){ return (x.name||'').trim().toLowerCase() === aKey; });
    if (matchedAgent) {
      toEmails = matchedAgent.emails || '';
      toNote = 'Matched "' + matchedAgent.name + '" in the Agent Directory.';
    } else {
      toNote = '"' + agent + '" isn\'t in the Agent Directory yet — enter the recipient email manually, or add them via Agent Directory.';
    }
  } else {
    toNote = 'No agent selected on this nomination — enter the recipient email manually.';
  }

  var a = area.toUpperCase();
  var isKfk = a.indexOf('KFK') >= 0;
  var tpl = isKfk ? _EMAIL_BODY_KFK : _EMAIL_BODY_FUJ;
  var body = _emailApply(tpl, _emailVesselCtx);
  var siteName = isKfk ? 'KHORFAKKAN' : 'FUJAIRAH';
  var subject = 'ETA SHIP CONTACT DETAILS - ' + vessel + '- ' + siteName;

  document.getElementById('em-modal-title').textContent = vessel + ' — ' + location;
  document.getElementById('em-to').value = toEmails;
  document.getElementById('em-to-note').textContent = toNote;
  document.getElementById('em-subject').value = subject;
  document.getElementById('em-output-text').value = body;
  document.getElementById('em-output-html').innerHTML = _emailBodyToHtml(body);
  document.getElementById('em-modal-error').style.display = 'none';
  document.getElementById('em-modal').style.display = 'flex';
}

function _emailSyncPreview() {
  var body = document.getElementById('em-output-text').value;
  document.getElementById('em-output-html').innerHTML = _emailBodyToHtml(body);
}

function emailCloseModal() {
  document.getElementById('em-modal').style.display = 'none';
  _emailVesselCtx = null;
}

function emailCopyBody() {
  var text = document.getElementById('em-output-text').value;
  var html = document.getElementById('em-output-html').innerHTML;
  var btn = event.currentTarget, orig = btn.innerHTML;

  function showCopied() {
    btn.textContent = 'Copied!'; btn.style.background = 'var(--green)';
    setTimeout(function(){ btn.innerHTML = orig; btn.style.background = ''; }, 2000);
  }

  _emailWriteRichClipboard(text, html).then(showCopied).catch(showCopied);
}

// Prefer rich-text copy so pasting into Outlook/Gmail/Apple Mail keeps the bold/
// underline/color/link formatting exactly as shown in the preview. Falls back to
// plain text if the browser doesn't support multi-type ClipboardItem writes
// (e.g. older Safari/Firefox). Returns a Promise that always resolves.
function _emailWriteRichClipboard(text, html) {
  if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
    try {
      // Explicit container styles (font-weight:400 included) so Word/Outlook's paste
      // engine has no ambient/default style to fall back on for the unstyled parts.
      var wrapped = '<html><body>'
        + '<div style="font-family:Calibri,Arial,sans-serif;font-size:13px;line-height:1.65;color:#000000;font-weight:400">'
        + html + '</div></body></html>';
      var htmlBlob  = new Blob([wrapped], { type: 'text/html' });
      var plainBlob = new Blob([text], { type: 'text/plain' });
      return navigator.clipboard.write([ new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': plainBlob }) ])
        .catch(function() { _emailCopyPlainFallback(text); });
    } catch(e) { /* fall through to plain text */ }
  }
  _emailCopyPlainFallback(text);
  return Promise.resolve();
}

function _emailCopyPlainFallback(text) {
  try { navigator.clipboard.writeText(text); } catch(e) {
    var ta = document.createElement('textarea'); ta.value = text;
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  }
}

function emailCopySubject() {
  var t = document.getElementById('em-subject').value;
  try { navigator.clipboard.writeText(t); } catch(e) {}
  var btn = event.currentTarget;
  btn.textContent = 'Copied!';
  setTimeout(function(){ btn.textContent = 'Copy Subject'; }, 2000);
}

// Encodes a JS (UTF-16) string as base64 of its UTF-8 bytes, line-wrapped to 76
// chars per RFC 2045 — required for a well-formed Content-Transfer-Encoding: base64
// MIME part.
function _b64EncodeUtf8(str) {
  var utf8 = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function(_, hex) {
    return String.fromCharCode(parseInt(hex, 16));
  });
  var b64 = btoa(utf8);
  return b64.match(/.{1,76}/g).join('\r\n');
}

// THE actual fix for "I want it to open already bold/colored, no pasting."
// mailto: can never carry HTML — that's a hard platform limit — but a real .eml
// file can: it's a proper MIME email (multipart/alternative, plain + html parts)
// that Outlook/Mail.app/Thunderbird/etc. all know how to open natively, rendering
// the bold headers and blue questionnaire block exactly as shown in the preview,
// with To/Subject/Body already filled in. Opening the downloaded file is the one
// remaining click — browsers can't launch a desktop app directly for security
// reasons — but nothing needs to be selected, copied, or pasted.
function emailDownloadEML() {
  var to        = (document.getElementById('em-to').value || '').trim();
  var toHeader  = to ? to.split(';').map(function(s){ return s.trim(); }).filter(Boolean).join(', ') : '';
  var subject   = document.getElementById('em-subject').value || '';
  var plainText = document.getElementById('em-output-text').value || '';
  var htmlBody  = document.getElementById('em-output-html').innerHTML;
  var htmlFull  = '<html><head><meta charset="UTF-8"></head><body style="font-family:Calibri,Arial,sans-serif;font-size:13px;line-height:1.65;color:#000000">' + htmlBody + '</body></html>';

  var boundary = 'GPSBUNKERS_' + Date.now();
  var eml =
    (toHeader ? 'To: ' + toHeader + '\r\n' : '') +
    'Subject: ' + subject.replace(/[\r\n]+/g,' ') + '\r\n' +
    'MIME-Version: 1.0\r\n' +
    'Content-Type: multipart/alternative; boundary="' + boundary + '"\r\n' +
    '\r\n' +
    'This is a multi-part message in MIME format.\r\n' +
    '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: text/plain; charset="UTF-8"\r\n' +
    'Content-Transfer-Encoding: base64\r\n' +
    '\r\n' +
    _b64EncodeUtf8(plainText) + '\r\n' +
    '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: text/html; charset="UTF-8"\r\n' +
    'Content-Transfer-Encoding: base64\r\n' +
    '\r\n' +
    _b64EncodeUtf8(htmlFull) + '\r\n' +
    '\r\n' +
    '--' + boundary + '--';

  var blob = new Blob([eml], { type: 'message/rfc822' });
  var url  = URL.createObjectURL(blob);
  var vesselName = (_emailVesselCtx && _emailVesselCtx.vessel) ? _emailVesselCtx.vessel.replace(/[^A-Za-z0-9]+/g, '_') : 'Email';
  var a = document.createElement('a');
  a.href = url;
  a.download = vesselName + '_Calling_Instructions.eml';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);

  _emailShowEmlReminder();
}

function _emailShowEmlReminder() {
  var existing = document.getElementById('em-paste-toast');
  if (existing) existing.remove();
  var toast = document.createElement('div');
  toast.id = 'em-paste-toast';
  toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;background:#1B5E20;color:#fff;padding:12px 20px;border-radius:9px;box-shadow:var(--shadow-xl,0 8px 24px rgba(0,0,0,.35));font-family:DM Sans,sans-serif;font-size:12.5px;line-height:1.5;max-width:420px;text-align:center';
  toast.innerHTML = '<strong>Formatted email downloaded.</strong><br>Open the downloaded file (double-click it) — it opens in your mail app already bold and colored, exactly as shown in the preview. Click Forward, confirm the recipient, and Send.';
  document.body.appendChild(toast);
  setTimeout(function(){ if (toast.parentNode) toast.remove(); }, 8000);
}

function emailOpenInClient() {
  var to      = (document.getElementById('em-to').value || '').trim();
  // mailto "to" expects comma-separated addresses; the directory stores them
  // semicolon-separated, so normalize before building the link.
  var toParam = to.split(';').map(function(s){ return s.trim(); }).filter(Boolean).join(',');
  var subjectRaw = document.getElementById('em-subject').value || '';
  var textRaw    = document.getElementById('em-output-text').value || '';
  var htmlRaw    = document.getElementById('em-output-html').innerHTML;
  var subject    = encodeURIComponent(subjectRaw);
  var body       = encodeURIComponent(textRaw);

  // The body IS pre-filled below (plain text — that's the most any mailto link can
  // ever carry, in any browser or mail app). At the same moment, the fully
  // formatted version (bold headers + blue questionnaire block) is copied to the
  // clipboard, so if you want the formatting too, select all in the body
  // (Ctrl/Cmd+A) and paste (Ctrl/Cmd+V) to replace the plain text with it.
  _emailWriteRichClipboard(textRaw, htmlRaw).then(function(){
    _emailShowPasteReminder();
    window.location.href = 'mailto:' + encodeURIComponent(toParam).replace(/%2C/g,',') + '?subject=' + subject + '&body=' + body;
  });
}

function _emailShowPasteReminder() {
  var existing = document.getElementById('em-paste-toast');
  if (existing) existing.remove();
  var toast = document.createElement('div');
  toast.id = 'em-paste-toast';
  toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;background:var(--ink-solid);color:#fff;padding:12px 20px;border-radius:9px;box-shadow:var(--shadow-xl,0 8px 24px rgba(0,0,0,.35));font-family:DM Sans,sans-serif;font-size:12.5px;line-height:1.5;max-width:420px;text-align:center';
  toast.innerHTML = '<strong>Email opened with the body filled in (plain text).</strong><br>Want the bold headers and blue questionnaire block too? Select all in the body (Ctrl/Cmd+A) and paste (Ctrl/Cmd+V) — the formatted version is already on your clipboard.';
  document.body.appendChild(toast);
  setTimeout(function(){ if (toast.parentNode) toast.remove(); }, 7000);
}
