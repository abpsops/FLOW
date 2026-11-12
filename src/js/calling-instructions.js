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
// not just an intentional reset. They persist across reloads and are only
// ever cleared by an explicit Clear All Data or Wipe Cloud action.
// Storage is IndexedDB: the .docx bytes used to go into localStorage as
// base64, which could fill the ~5 MB quota — after which every OTHER
// localStorage save in the app failed (mostly in silent catches).
const CI_IDB_NAME = 'flow_ci_templates', CI_IDB_STORE = 'templates';
function _ciIdbOpen() {
  return new Promise(function(resolve, reject) {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is not available')); return; }
    const req = indexedDB.open(CI_IDB_NAME, 1);
    req.onupgradeneeded = function() { req.result.createObjectStore(CI_IDB_STORE); };
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error || new Error('IndexedDB open failed')); };
  });
}
function _ciIdbTx(mode, fn) {
  return _ciIdbOpen().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction(CI_IDB_STORE, mode);
      const store = tx.objectStore(CI_IDB_STORE);
      let result;
      const req = fn(store);
      if (req) req.onsuccess = function() { result = req.result; };
      tx.oncomplete = function() { db.close(); resolve(result); };
      tx.onerror = tx.onabort = function() { db.close(); reject(tx.error || new Error('IndexedDB transaction failed')); };
    });
  });
}
function _ciTemplateRecord(t) {
  return t ? { fileName: t.fileName, isDocx: t.isDocx, text: t.text || null, arrayBuffer: t.arrayBuffer || null } : null;
}
async function _ciSaveTemplates() {
  try {
    await _ciIdbTx('readwrite', function(store) {
      ['kfk', 'fuj'].forEach(function(key) { store.put(_ciTemplateRecord(_ciTemplates[key]), key); });
    });
    return true;
  } catch(e) {
    console.error('Could not save Calling Instruction templates:', e);
    if (typeof showToast === 'function') showToast('Calling Instruction template could not be saved on this device (' + (e && e.message || 'storage error') + ') — it will be lost on reload.', 'warning', 8000);
    return false;
  }
}

function _ciShowLoadedTemplate(key, t) {
  const nameEl   = document.getElementById(`ci-${key}-name`);
  const statusEl = document.getElementById(`ci-${key}-status`);
  const labelEl  = document.getElementById(`ci-${key}-label`);
  const type = t.isDocx ? '.docx — XML clone mode' : '.txt — text mode';
  if (nameEl)   nameEl.textContent = t.fileName;
  if (statusEl) statusEl.innerHTML = `<span style="color:var(--green);font-weight:700">Loaded (${type}) — ${esc(t.fileName)}</span>`;
  if (labelEl)  { labelEl.style.borderColor = 'var(--green)'; labelEl.style.background = 'var(--green-lt)'; }
}

async function _ciLoadTemplates() {
  // One-time migration from the old localStorage (base64) copy. The old key
  // is removed only after the IndexedDB write succeeded.
  let raw = null;
  try { raw = localStorage.getItem(CI_TEMPLATES_KEY); } catch(e) {}
  if (raw) {
    let saved = null;
    try { saved = JSON.parse(raw); } catch(e) {}
    if (saved) {
      ['kfk', 'fuj'].forEach(function(key) {
        const t = saved[key];
        if (!t) return;
        _ciTemplates[key] = {
          fileName: t.fileName,
          isDocx: t.isDocx,
          text: t.text || null,
          arrayBuffer: t.arrayBufferB64 ? _base64ToAb(t.arrayBufferB64) : null
        };
      });
      if (await _ciSaveTemplates()) { try { localStorage.removeItem(CI_TEMPLATES_KEY); } catch(e) {} }
    } else {
      try { localStorage.removeItem(CI_TEMPLATES_KEY); } catch(e) {} // unreadable — drop it
    }
  } else {
    try {
      const got = {};
      await _ciIdbTx('readonly', function(store) {
        ['kfk', 'fuj'].forEach(function(key) {
          const r = store.get(key);
          r.onsuccess = function() { got[key] = r.result || null; };
        });
      });
      ['kfk', 'fuj'].forEach(function(key) { if (got[key]) _ciTemplates[key] = got[key]; });
    } catch(e) {
      console.error('Could not load Calling Instruction templates:', e);
      if (typeof showToast === 'function') showToast('Saved Calling Instruction templates could not be loaded (' + (e && e.message || 'storage error') + ').', 'warning', 8000);
    }
  }
  ['kfk', 'fuj'].forEach(function(key) { if (_ciTemplates[key]) _ciShowLoadedTemplate(key, _ciTemplates[key]); });
}

function _ciClearTemplates() {
  _ciTemplates.kfk = null;
  _ciTemplates.fuj = null;
  try { localStorage.removeItem(CI_TEMPLATES_KEY); } catch(e) {}
  _ciIdbTx('readwrite', function(store) { store.clear(); }).catch(function(e) {
    console.error('Could not clear Calling Instruction templates:', e);
  });
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
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--green);font-weight:700">Loaded (${type}) — ${esc(fname)}</span>`;
    if (labelEl)  { labelEl.style.borderColor = 'var(--green)'; labelEl.style.background = 'var(--green-lt)'; }
  };
  const setWarn = (msg) => {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--amber);font-weight:700"> ${esc(msg)}</span>`;
  };

  // Legacy binary .doc isn't a zip — the JSZip clone path can't open it and
  // used to fail only later, at generate time. Reject it up front.
  if (/\.doc$/i.test(file.name)) {
    setWarn('Legacy .doc files are not supported — open it in Word and "Save As" .docx, then upload that.');
    input.value = '';
    return;
  }

  // Always read as ArrayBuffer — works for both .docx and .txt
  const reader = new FileReader();
  reader.onload = function(e) {
    const arrayBuffer = e.target.result;
    const isDocx = /\.docx$/i.test(file.name);

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
  // A range ("500-600") plans at its top figure; the text keeps the range.
  const vqP = _parseQtyInput(vlsfoRaw), mqP = _parseQtyInput(lsmgoRaw);
  const safeVlsfo = (type === 'MGO')   ? 0 : vqP.qty;
  const safeLsmgo = (type === 'VLSFO') ? 0 : mqP.qty;
  const vlsfoQty = safeVlsfo;
  const lsmgoQty = safeLsmgo;
  const area     = areaEl   ? areaEl.value   : '';
  const lcRaw    = lcEl     ? lcEl.value     : '';
  const laycan   = ciLaycanStr(lcRaw);
  const location = ciAreaLabel(area);
  const tplKey   = ciGetTemplateKey(area);

  // id = the vessel card number: ciGenerate/ciOpenPreview re-read the live
  // inputs `v${id}-…` through it, which never happened while it was unset.
  const cids = _cardIds(vid); // {{IMO}} / {{MMSI}}
  _ciVesselCtx = { id: vid, vessel, type, vlsfoQty: safeVlsfo, lsmgoQty: safeLsmgo, vlsfoTxt: _qtyShow(vqP), lsmgoTxt: _qtyShow(mqP), area, location, laycan, lcRaw, tplKey, eta: _cardEtaTxt(vid), imo: cids.imo.trim(), mmsi: cids.mmsi.trim() };

  document.getElementById('ci-modal-title').textContent   = 'Calling Instructions — ' + vessel;
  document.getElementById('ci-prev-vessel').textContent   = vessel || '(no name)';
  document.getElementById('ci-prev-location').textContent = location;
  document.getElementById('ci-prev-laycan').textContent   = laycan || lcRaw || '—';
  document.getElementById('ci-prev-vlsfo').textContent    = safeVlsfo > 0 ? _qtyShow(vqP) + ' MT' : '—';
  document.getElementById('ci-prev-lsmgo').textContent    = safeLsmgo > 0 ? _qtyShow(mqP) + ' MT' : '—';
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
  document.getElementById('ci-pdf2-btn').style.display    = 'none';
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
// Supports: {{VESSEL_NAME}} {{VLSFO_QTY}} {{MGO_QTY}} {{LAYCAN}} {{LOCATION}} {{ETA}} {{IMO}} {{MMSI}}
// Also detects pattern-based replacements for templates without placeholders
// ══════════════════════════════════════════════════════════════

// ─── Plain-text template replacement (for .txt templates + preview) ───
// vTxt/mTxt: optional display text for a ranged nomination ("500–600").
function ciBuildFuelLines(type,vlsfoQty,lsmgoQty,vTxt,mTxt){
  var v=Number(vlsfoQty)||0,m=Number(lsmgoQty)||0,lines=[];
  if((type==='VLSFO'||type==='BOTH'||type==='RMG')&&v>0) lines.push('RMG: - '+(vTxt||v.toLocaleString())+' MT / 380 CST / 0.5% MAX SULFUR');
  if((type==='MGO'||type==='LSMGO'||type==='BOTH')&&m>0) lines.push('MGO: - '+(mTxt||m.toLocaleString())+' MT / DMA / 0.1% MAX SULFUR');
  return lines.join('\n');
}
// "500–600" for a range, else the number — what people see for a card's qty box.
function _qtyShow(q) { return q.min != null ? _fmtQtyRange(q.min, q.max) : Number(q.qty || 0).toLocaleString(); }
// Re-read a card's quantities into a CI / email context (live, never cached).
function _ctxQtyFromCard(ctx, vid) {
  const t = ctx.type || 'VLSFO', vq = _cardQty(vid, 'vlsfo'), mq = _cardQty(vid, 'mgo');
  ctx.vlsfoQty = t === 'MGO' ? 0 : vq.qty;   ctx.vlsfoTxt = _qtyShow(vq);
  ctx.lsmgoQty = t === 'VLSFO' ? 0 : mq.qty; ctx.lsmgoTxt = _qtyShow(mq);
}
function ciApplyTemplate(tplText,ctx){
  var vessel=ctx.vessel||'',type=ctx.type||'VLSFO',vlsfoQty=ctx.vlsfoQty||0,lsmgoQty=ctx.lsmgoQty||0,location=ctx.location||'',laycan=ctx.laycan||'';
  tplText=tplText.replace(/[‘’‚‛]/g,"'").replace(/[“”]/g,'"');
  var v=Number(vlsfoQty)||0,m=Number(lsmgoQty)||0;
  if(v===0&&m===0) throw new Error('Both fuel quantities are 0.');
  var fl=ciBuildFuelLines(type,v,m,ctx.vlsfoTxt,ctx.lsmgoTxt),vs=v>0?(ctx.vlsfoTxt||v.toLocaleString())+' MT':'',ms=m>0?(ctx.lsmgoTxt||m.toLocaleString())+' MT':'';
  if(tplText.indexOf('{{VESSEL_NAME}}')>=0||tplText.indexOf('{{FUEL_LINES}}')>=0||tplText.indexOf('{{VLSFO_QTY}}')>=0||tplText.indexOf('{{LAYCAN}}')>=0||tplText.indexOf('{{ETA}}')>=0||tplText.indexOf('{{IMO}}')>=0||tplText.indexOf('{{MMSI}}')>=0){
    // {{ETA}}: the card's ETA as text — "16 Oct 2026 AM (06:00–12:00)" for a time frame.
    // {{IMO}} / {{MMSI}}: the card's identifiers ('' when not filled in).
    return tplText.split('{{VESSEL_NAME}}').join(vessel).split('{{FUEL_LINES}}').join(fl).split('{{VLSFO_QTY}}').join(vs).split('{{MGO_QTY}}').join(ms).split('{{LSMGO_QTY}}').join(ms).split('{{LAYCAN}}').join(laycan).split('{{LOCATION}}').join(location).split('{{ETA}}').join(ctx.eta||'').split('{{IMO}}').join(ctx.imo||'').split('{{MMSI}}').join(ctx.mmsi||'');
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
    if (document.getElementById(`v${vid}-imo`)) { const li = _cardIds(vid); ctx.imo = li.imo.trim(); ctx.mmsi = li.mmsi.trim(); }
    if (liveVlsfo || liveMgo) _ctxQtyFromCard(ctx, vid);
    else { ctx.vlsfoQty = 0; ctx.lsmgoQty = 0; }
    // Refresh preview panel
    const pv = document.getElementById('ci-prev-vlsfo');
    const pm = document.getElementById('ci-prev-lsmgo');
    if (pv) pv.textContent = ctx.vlsfoQty > 0 ? ctx.vlsfoTxt + ' MT' : '—';
    if (pm) pm.textContent = ctx.lsmgoQty > 0 ? ctx.lsmgoTxt + ' MT' : '—';
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
  document.getElementById('ci-pdf2-btn').style.display       = '';
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
  const warnings = [];
  docXml = ciDocxReplaceParagraphText(docXml, ctx, warnings);

  // ════════════════════════════════════════════════════════
  // GUARANTEED QTY REPLACEMENT — bulletproof raw XML pass
  // ctx.vlsfoQty / ctx.lsmgoQty are the ONLY source of truth
  // ════════════════════════════════════════════════════════
  const vQty = ctx.vlsfoQty;
  const mQty = ctx.lsmgoQty;

  // Regex sources are plain strings, so every backslash must be doubled —
  // with single '\d' / '\s' / '\b' the pattern silently became 'd', 's', 'b'
  // and never matched, leaving the template's old quantity in the file.
  function xmlQtyReplace(xml, keyword, qty, txt) {
    if (!qty || qty <= 0) return xml;
    const kw = String(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const qtyStr = txt || Number(qty).toLocaleString(); // same formatting as the preview (a range stays a range)
    xml = xml.replace(
      new RegExp('(<w:t[^>]*>[^<]*' + kw + '[^<]*?)(\\d[\\d,]*(?:\\.\\d+)?)(\\s*MT\\b)', 'gi'),
      function(_, pre, _n, mt) { return pre + qtyStr + mt; }
    );
    // Keyword and number split across runs. Only when the keyword's own run
    // has no "MT" (else pass 1 handled it) and never across a paragraph end —
    // otherwise e.g. the RMG qty would overwrite the next line's MGO figure.
    xml = xml.replace(
      new RegExp('(<w:t[^>]*>[^<]*' + kw + '(?:(?!MT\\b)[^<])*<\\/w:t>(?:<(?!w:t\\b|\\/w:p>)[^>]*>)*<w:t[^>]*>[^<]*?)(\\d[\\d,]*(?:\\.\\d+)?)(\\s*MT\\b)', 'gi'),
      function(_, pre, _n, mt) { return pre + qtyStr + mt; }
    );
    return xml;
  }

  const vTxt = ctx.vlsfoTxt, mTxt = ctx.lsmgoTxt;
  if (type === 'VLSFO' || type === 'RMG') {
    docXml = xmlQtyReplace(docXml, 'RMG', vQty, vTxt);
  } else if (type === 'MGO' || type === 'LSMGO') {
    docXml = xmlQtyReplace(docXml, 'MGO', mQty, mTxt);
    docXml = xmlQtyReplace(docXml, 'DMA', mQty, mTxt);
  } else {
    docXml = xmlQtyReplace(docXml, 'RMG', vQty, vTxt);
    docXml = xmlQtyReplace(docXml, 'MGO', mQty, mTxt);
    docXml = xmlQtyReplace(docXml, 'DMA', mQty, mTxt);
  }

  return { zip, docXml, warnings };
}

// Asks before downloading when the substitution couldn't reproduce the
// preview faithfully (see ciDocxReplaceParagraphText). Returns false to abort.
function _ciConfirmDocxWarnings(warnings) {
  if (!warnings || !warnings.length) return true;
  return confirm('The downloaded .docx may not exactly match the preview:\n\n• ' + warnings.join('\n• ') +
    '\n\nTip: put {{VESSEL_NAME}}, {{FUEL_LINES}}, {{LOCATION}} and {{LAYCAN}} placeholders in the template for an exact result.\n\nDownload anyway?');
}

async function ciCloneDocxAndDownload(arrayBuffer, ctx) {
  const { zip, docXml, warnings } = await _ciCloneDocxSubstitute(arrayBuffer, ctx);
  if (!_ciConfirmDocxWarnings(warnings)) return;
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
  const { zip, docXml, warnings } = await _ciCloneDocxSubstitute(arrayBuffer, ctx);
  if (!_ciConfirmDocxWarnings(warnings)) return;
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
function ciDocxReplaceParagraphText(xml, ctx, warnings) {
  const { vessel, type, vlsfoQty, lsmgoQty, location, laycan } = ctx;
  const xe = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // Placeholders when the template has them; otherwise the SAME pattern
  // fallback ciApplyTemplate() uses for the preview (master/vessel line,
  // fuel lines, location). Before, the download only ever did placeholders,
  // so a placeholder-less template downloaded unchanged while the preview
  // showed the new vessel/location/quantities.
  const vlsfoNum = (type !== 'MGO')   ? Number(vlsfoQty) : 0;
  const mgoNum   = (type !== 'VLSFO') ? Number(lsmgoQty) : 0;
  var fl2=ciBuildFuelLines(type,vlsfoNum,mgoNum,ctx.vlsfoTxt,ctx.lsmgoTxt);
  const vS = ctx.vlsfoTxt || vlsfoNum.toLocaleString(), mS = ctx.lsmgoTxt || mgoNum.toLocaleString();
  const valueMap={'{{VESSEL_NAME}}':vessel||'','{{FUEL_LINES}}':fl2,'{{VLSFO_QTY}}':vlsfoNum>0?vS+' MT':'','{{MGO_QTY}}':mgoNum>0?mS+' MT':'','{{LSMGO_QTY}}':mgoNum>0?mS+' MT':'','{{LAYCAN}}':laycan||'','{{LOCATION}}':location||'','{{ETA}}':ctx.eta||'','{{IMO}}':ctx.imo||'','{{MMSI}}':ctx.mmsi||''};

  // Validate all placeholders exist in raw XML text
  const docTextAll = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/gi)]
    .map(m => m[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'))
    .join('');

  // Same trigger as ciApplyTemplate(): any of these means "placeholder template".
  const usePlaceholders = ['{{VESSEL_NAME}}','{{FUEL_LINES}}','{{VLSFO_QTY}}','{{LAYCAN}}','{{ETA}}','{{IMO}}','{{MMSI}}'].some(ph => docTextAll.includes(ph));

  // Reconstruct placeholder text across split runs
  // Each paragraph: concatenate all <w:t> content, replace, write back
  const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/gi)];
  let result = xml;

  // Fallback mode: like the preview, the FIRST fuel-line paragraph gets all
  // fuel lines (as line breaks) and later fuel-line paragraphs are emptied.
  const fuelRe = /^[ \t]*(RMG|MGO|DMA)\s*[:\-].+$/i;
  const normQ = t => t.replace(/[‘’‚‛]/g,"'").replace(/[“”]/g,'"');
  const paraText = p => [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/gi)].map(m =>
      m[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
          .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(parseInt(n)))).join('');
  let firstFuelIdx = -1;
  if (!usePlaceholders) {
    firstFuelIdx = paragraphs.findIndex(m => fuelRe.test(normQ(paraText(m[0]))));
  }
  let fallbackHits = 0;

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

    if (!usePlaceholders) {
      const norm = normQ(fullText);
      let out = norm.replace(/(To\s*:\s*The Master\s*:\s*).+/gi, (_, p) => p + (vessel || ''));
      let lines = null;
      if (fuelRe.test(out)) lines = pi === firstFuelIdx ? fl2.split('\n') : [''];
      else out = ciReplaceLocation(out, location || '');
      if (!lines && out === norm) continue; // nothing to change in this paragraph
      fallbackHits++;
      // Rebuilding collapses the paragraph to one run; if it also holds a
      // tab/line break/image/field/link, that content would be lost — leave
      // it untouched and tell the user rather than silently mangle it.
      if (/<w:(tab|br|cr|drawing|pict|fldChar|fldSimple|hyperlink|object)\b/i.test(para)) {
        if (warnings) warnings.push('"' + fullText.trim().slice(0, 60) + '" could not be updated (complex formatting in that line).');
        continue;
      }
      const pOpenM = para.match(/^(<w:p\b[^>]*>)/i);
      const body = (lines || [out]).map(l => '<w:t xml:space="preserve">' + xe(l) + '</w:t>').join('<w:br/>');
      const newP = (pOpenM ? pOpenM[1] : '<w:p>') + pPr + '<w:r>' + rPr + body + '</w:r></w:p>';
      result = result.slice(0, paraStart) + newP + result.slice(paraEnd);
      continue;
    }

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
  if (!usePlaceholders && !fallbackHits && warnings) {
    warnings.push('This template has no {{PLACEHOLDERS}} and no recognisable vessel / fuel / location lines, so the file is the template unchanged.');
  }
  return result;
}


// ── Shared file-save helper ──────────────────────────────────────────
// Browsers handle <a download> + blob URLs fine, but Android's WebView
// (which is what the packaged app runs in) silently does nothing with
// that same trick — no download manager, nowhere to write to. So: if
// we're running inside the native app, hand the file to Capacitor's
// Filesystem plugin (writes to app cache) then open the OS Share sheet
// so the operator can save it to Downloads / send it on. In a normal
// browser tab, use the original technique unchanged.
async function _flowSaveOrShareBlob(blob, filename) {
  // One place to make every export's name safe: vessel names like "M/T ..."
  // put a "/" in the name, which Filesystem.writeFile treats as a directory
  // (and fails) and browsers mangle. Allow only word chars, dot, dash, space.
  const name = String(filename || 'FLOW_export').replace(/[^\w.\- ]+/g, '_').replace(/^\.+/, '') || 'FLOW_export';
  // Plugins are injected by the native shell; the CDN plugin scripts aren't used.
  const cap = window.Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  if (isNative) {
    const plugins = cap.Plugins || {};
    const Filesystem = plugins.Filesystem, Share = plugins.Share;
    try {
      if (!Filesystem || !Filesystem.writeFile) throw new Error('file storage is not available in this app build');
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(reader.error || new Error('could not read the file'));
        reader.readAsDataURL(blob);
      });
      const written = await Filesystem.writeFile({ path: name, data: base64, directory: 'CACHE' });
      if (Share && Share.share) {
        await Share.share({ title: name, url: written.uri });
      }
      return true;
    } catch (e) {
      // No <a download> fallback here: inside the app's WebView it does
      // nothing at all, so falling back just hid the failure.
      console.error('Native save failed:', e);
      if (typeof showToast === 'function') showToast('Could not save "' + name + '": ' + ((e && e.message) || e), 'error', 8000);
      return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}

function ciTriggerDownload(blob, filename) {
  return _flowSaveOrShareBlob(blob, filename);
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
    if(document.getElementById('v'+vid+'-imo')){var li=_cardIds(vid);ctx.imo=li.imo.trim();ctx.mmsi=li.mmsi.trim();}
    if(lv||lm)_ctxQtyFromCard(ctx,vid);else{ctx.vlsfoQty=0;ctx.lsmgoQty=0;}
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
  document.getElementById('ci-pdf2-btn').style.display='';
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

// ─── Download as PDF — the same text as the .docx (the generated document, with any
// edits made before generating), as a real text PDF on A4: long lines wrap, blank lines
// are kept, pages break as needed and are numbered. ───
async function ciDownloadCallingPdf(btn) {
  const ctx = _ciVesselCtx;
  const outEl = document.getElementById('ci-output-text');
  const txt = outEl ? outEl.textContent.replace(/\r/g, '').replace(/\s+$/, '') : '';
  if (!ctx || !txt) return;
  const errEl = document.getElementById('ci-modal-error');
  const label = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Preparing…'; }
  try {
    const jsPDF = await _loadJsPDF();
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 18, LH = 5.2;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10.5); pdf.setTextColor(0, 0, 0);
    let y = M;
    txt.split('\n').forEach(function(line) {
      const parts = line.trim() ? pdf.splitTextToSize(line.replace(/\t/g, '    '), W - 2 * M) : [''];
      parts.forEach(function(part) {
        if (y + LH > H - M) { pdf.addPage(); y = M; }
        if (part) pdf.text(part, M, y + 4);
        y += LH;
      });
    });
    const pages = pdf.internal.getNumberOfPages();
    if (pages > 1) for (let i = 1; i <= pages; i++) { pdf.setPage(i); pdf.setFontSize(8); pdf.setTextColor(120, 120, 120); pdf.text('Page ' + i + ' of ' + pages, W / 2, H - 8, { align: 'center' }); }
    const name = 'Calling_Instructions_' + String(ctx.vessel || 'Vessel').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') + '.pdf';
    await _flowSaveOrShareBlob(pdf.output('blob'), name);
  } catch (err) {
    if (errEl) { errEl.textContent = 'Could not create the PDF: ' + ((err && err.message) || err); errEl.style.display = ''; }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = label; }
  }
}
