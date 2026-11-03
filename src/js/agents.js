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

// Agents removed (or renamed away) are kept in _agents as tombstones
// {name, emails:'', deleted:true, updatedAt} so the deletion syncs instead of
// being re-added by the next merge. Anything that lists, counts or looks up
// agents must go through _activeAgents(); only sync/storage sees tombstones.
function _activeAgents() {
  return (_agents || []).filter(function(a) { return a && !a.deleted; });
}
function _agentKey(name) { return String(name || '').trim().toLowerCase(); }

// Merge of an incoming (cloud/remote) agent list into the local Agent
// Directory, per agent, keyed by name (case-insensitive, trimmed) rather than
// id, since ids are assigned independently per device/session. The copy with
// the newer updatedAt wins outright — including a tombstone, which is how a
// delete/rename/email removal propagates. Entries from before updatedAt
// existed (both 0) keep the old additive behaviour: emails are unioned, and a
// remote agent not present locally is added, so an agency added anywhere is
// never silently lost.
function _mergeAgents(remoteAgents) {
  if (!Array.isArray(remoteAgents) || !remoteAgents.length) return;
  const byName = {};
  _agents.forEach(function(a) { byName[_agentKey(a.name)] = a; });
  let changed = false;
  remoteAgents.forEach(function(r) {
    if (!r) return;
    const key = _agentKey(r.name);
    if (!key) return;
    const existing = byName[key];
    const rAt = Number(r.updatedAt) || 0;
    if (existing) {
      const lAt = Number(existing.updatedAt) || 0;
      if (rAt > lAt || (rAt === lAt && r.deleted && !existing.deleted)) {
        // Remote is newer (or same age but a tombstone — deterministic tie-break
        // so every device converges on the same answer).
        if (existing.name !== r.name || existing.emails !== (r.emails||'') || !!existing.deleted !== !!r.deleted || lAt !== rAt) {
          existing.name = r.name; existing.emails = r.emails || ''; existing.updatedAt = rAt;
          if (r.deleted) existing.deleted = true; else delete existing.deleted;
          changed = true;
        }
      } else if (rAt === lAt && !r.deleted && !existing.deleted) {
        const localEmails  = (existing.emails||'').split(';').map(function(e){return e.trim();}).filter(Boolean);
        const remoteEmails = (r.emails||'').split(';').map(function(e){return e.trim();}).filter(Boolean);
        const merged = Array.from(new Set(localEmails.concat(remoteEmails)));
        const mergedStr = merged.join('; ');
        if (mergedStr !== existing.emails) { existing.emails = mergedStr; changed = true; }
      }
    } else {
      // Unknown here — add it (tombstones too, so they keep propagating).
      const newAgent = { id: _agentNextId++, name: r.name, emails: r.emails||'' };
      if (rAt) newAgent.updatedAt = rAt;
      if (r.deleted) newAgent.deleted = true;
      _agents.push(newAgent);
      byName[key] = newAgent;
      changed = true;
    }
  });
  if (changed) {
    _saveAgents();
    if (document.getElementById('page-agents') && document.getElementById('page-agents').classList.contains('active')) renderAgentDirectory();
  }
}

// Populates <datalist id="agent-directory-list"> from _agents so every "Agent" field
// (vessel nomination cards, Edit Record modal) behaves like a searchable combobox:
// type to filter/pick a known agent, or just keep typing a name that isn't listed yet.
function _refreshAgentDatalist() {
  const dl = document.getElementById('agent-directory-list');
  if (!dl) return;
  const names = Array.from(new Set(_activeAgents().map(a => a.name).filter(Boolean))).sort();
  dl.innerHTML = names.map(n => '<option value="' + esc(n) + '">').join('');
}

function renderAgentDirectory() {
  _loadAgents();
  filterAgents(document.getElementById('agent-search') ? document.getElementById('agent-search').value : '');
  // KPI: count unique emails
  const allEmails = new Set();
  _activeAgents().forEach(a => {
    (a.emails||'').split(';').forEach(e => { const t = e.trim().toLowerCase(); if (t) allEmails.add(t); });
  });
  const kpiEmails = document.getElementById('kpi-total-emails');
  if (kpiEmails) kpiEmails.textContent = allEmails.size;
  const kpiTotal = document.getElementById('kpi-total-agents');
  if (kpiTotal) kpiTotal.textContent = _activeAgents().length;
}

function filterAgents(q) {
  if (!_agents.length) _loadAgents();
  const query = (q || '').toLowerCase().trim();
  const active = _activeAgents();
  const filtered = query ? active.filter(a =>
    (a.name||'').toLowerCase().includes(query) || (a.emails||'').toLowerCase().includes(query)
  ) : active;

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
    // Names/emails sync from the shared cloud workspace — escape everything.
    const emailPills = (a.emails||'').split(';').map(e => e.trim()).filter(Boolean).map(e =>
      `<a href="mailto:${esc(encodeURIComponent(e).replace(/%40/g, '@'))}" style="display:inline-flex;align-items:center;gap:4px;padding:2px 9px;background:var(--azure-lt);border:1px solid var(--azure-bd);border-radius:20px;font-size:11px;font-family:'DM Mono',monospace;color:var(--azure);text-decoration:none;transition:all .13s;white-space:nowrap" onmouseover="this.style.background='var(--azure)';this.style.color='#fff'" onmouseout="this.style.background='var(--azure-lt)';this.style.color='var(--azure)'">${esc(e)}</a>`
    ).join(' ');
    return `<tr>
      <td style="color:var(--muted);font-family:'DM Mono',monospace;font-size:11px">${String(i+1).padStart(2,'0')}</td>
      <td style="font-weight:600;color:var(--ink);font-size:13px">${esc(a.name)}</td>
      <td><div style="display:flex;flex-wrap:wrap;gap:5px">${emailPills}</div></td>
      <td>
        <div style="display:flex;gap:5px">
          <button onclick="openEditAgentModal(${Number(a.id)})" style="display:flex;align-items:center;gap:4px;padding:4px 9px;border:none;box-shadow:var(--sh-xs);border-radius:5px;background:var(--surface2);color:var(--sub);font-size:11px;cursor:pointer;font-family:DM Sans,sans-serif;transition:all .13s" onmouseover="this.style.background='var(--azure-lt)';this.style.color='var(--azure)';this.style.boxShadow='var(--sh-sm)'" onmouseout="this.style.background='var(--surface2)';this.style.color='var(--sub)';this.style.boxShadow='var(--sh-xs)'">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit
          </button>
          <button onclick="deleteAgent(${Number(a.id)})" style="display:flex;align-items:center;gap:4px;padding:4px 9px;border:none;box-shadow:var(--sh-xs);border-radius:5px;background:var(--surface2);color:var(--muted);font-size:11px;cursor:pointer;font-family:DM Sans,sans-serif;transition:all .13s" onmouseover="this.style.background='var(--red-lt)';this.style.color='var(--red)';this.style.boxShadow='var(--sh-sm)'" onmouseout="this.style.background='var(--surface2)';this.style.color='var(--muted)';this.style.boxShadow='var(--sh-xs)'">
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
  const a = _activeAgents().find(x => x.id === id); if (!a) return;
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
  const now = Date.now();
  // A tombstone under the name being saved would shadow the live entry in
  // the per-name merge — drop it; the newer live entry supersedes it.
  _agents = _agents.filter(x => !(x.deleted && _agentKey(x.name) === _agentKey(name)));
  if (_agentEditId) {
    const idx = _agents.findIndex(x => x.id === _agentEditId);
    if (idx > -1) {
      const oldName = _agents[idx].name;
      // Renamed: leave a tombstone for the old name so other devices drop it
      // instead of merging it back in as a separate agent.
      if (_agentKey(oldName) && _agentKey(oldName) !== _agentKey(name)) {
        _agents.push({ id: _agentNextId++, name: oldName, emails: '', deleted: true, updatedAt: now });
      }
      _agents[idx].name = name; _agents[idx].emails = emails; _agents[idx].updatedAt = now;
    }
  } else {
    _agents.push({ id: _agentNextId++, name, emails, updatedAt: now });
  }
  _saveAgents();
  closeAgentModal();
  renderAgentDirectory();
}

function deleteAgent(id) {
  const a = _activeAgents().find(x => x.id === id); if (!a) return;
  if (!confirm('Remove ' + a.name + ' from the directory?')) return;
  // Tombstone, not removal — otherwise the next cloud merge re-adds it.
  a.deleted = true; a.emails = ''; a.updatedAt = Date.now();
  _saveAgents();
  renderAgentDirectory();
}

// btn is passed from the onclick: the global `event` is gone by the time the
// clipboard promise resolves, which made every copy report failure.
function copyAllAgentEmails(btn) {
  const active = _activeAgents();
  if (!active.length) { alert('No agents loaded.'); return; }
  const all = [];
  active.forEach(a => { (a.emails||'').split(';').forEach(e => { const t = e.trim(); if (t) all.push(t); }); });
  const text = all.join('; ');
  // navigator.clipboard is missing on non-secure origins and some WebViews —
  // fall back to the legacy textarea + execCommand('copy') route.
  const copy = (navigator.clipboard && navigator.clipboard.writeText)
    ? navigator.clipboard.writeText(text)
    : new Promise((resolve, reject) => {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        let ok = false; try { ok = document.execCommand('copy'); } catch(e) {}
        ta.remove();
        ok ? resolve() : reject(new Error('copy failed'));
      });
  copy.then(() => {
    if (!btn) return;
    const orig = btn.innerHTML;
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
    btn.style.background = 'var(--green-lt)'; btn.style.borderColor = 'var(--green-bd)'; btn.style.color = 'var(--green)';
    setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; btn.style.borderColor = ''; btn.style.color = ''; }, 2000);
  }).catch(() => { alert('Clipboard copy failed. Please copy manually.'); });
}

// Init agents on page load
(function() { _loadAgents(); })();
