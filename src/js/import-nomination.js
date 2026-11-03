/* ─── IMPORT NOMINATION: panel (paste / drop / pick → Read → review → Add) ───
   Nothing is saved until "Add": each added row goes through addVessel(def)
   — so nomUid, sync, the trader RPC path and the email log all behave as for
   a hand-made card — then one normal saveSharedState(). */
let _niDrafts = [];    // rows in the review table
let _niImage = null;   // screenshot waiting to be read (Blob/File)
let _niImageUrl = '';
let _niSourceText = '';
let _niBusy = false;

// Tesseract.js, pinned. Loaded only when an image is read; the worker, the
// WebAssembly core and the English model are fetched from the same pinned
// jsdelivr URLs (vercel.json CSP: script/connect jsdelivr, worker blob:,
// 'wasm-unsafe-eval'). The image itself never leaves the device.
const _NI_OCR = {
  lib: 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js',
  sri: 'sha384-r1ru3tcf6FhnCFR4B7pIFG+BhFF9LlFtz/P1y4pblWn3AGs9y3lBx5SKLNf4+rED',
  worker: 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
  core: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',
  lang: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int'
};

function _niStatus(msg, isErr) {
  const el = document.getElementById('nimp-status');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('er', !!isErr);
}

function _niSetImage(file) {
  if (!file || !/^image\//.test(file.type || '')) { _niStatus('That file is not an image.', true); return; }
  if (file.size > 15 * 1024 * 1024) { _niStatus('Image is too large (max 15 MB).', true); return; }
  _niImage = file;
  if (_niImageUrl) { try { URL.revokeObjectURL(_niImageUrl); } catch (e) {} }
  _niImageUrl = URL.createObjectURL(file);
  const box = document.getElementById('nimp-img');
  document.getElementById('nimp-thumb').src = _niImageUrl;
  document.getElementById('nimp-img-name').textContent = (file.name && file.name !== 'image.png' ? file.name + ' · ' : '') + Math.max(1, Math.round(file.size / 1024)) + ' KB';
  if (box) box.hidden = false;
  _niStatus('Screenshot ready — click Read.');
}
function niClearImage() {
  _niImage = null;
  if (_niImageUrl) { try { URL.revokeObjectURL(_niImageUrl); } catch (e) {} _niImageUrl = ''; }
  const box = document.getElementById('nimp-img');
  if (box) box.hidden = true;
  const f = document.getElementById('nimp-file');
  if (f) f.value = '';
  _niStatus('');
}
function niPickFile(input) { if (input.files && input.files[0]) _niSetImage(input.files[0]); }
function niReset() {
  niClearImage();
  const t = document.getElementById('nimp-text');
  if (t) t.value = '';
  _niDrafts = []; _niSourceText = '';
  _niRenderReview();
}

// Paste / drop: an image goes to the OCR slot, text into the textarea.
function _niInitPanel() {
  const zone = document.getElementById('nimp-zone'), ta = document.getElementById('nimp-text');
  if (!zone || zone._niReady) return;
  zone._niReady = true;
  zone.addEventListener('paste', function(e) {
    const cd = e.clipboardData;
    if (!cd) return;
    const img = Array.from(cd.files || []).find(function(f) { return /^image\//.test(f.type); }) ||
      Array.from(cd.items || []).filter(function(it) { return it.kind === 'file' && /^image\//.test(it.type); }).map(function(it) { return it.getAsFile(); }).filter(Boolean)[0];
    if (img) { e.preventDefault(); _niSetImage(img); return; }
    if (e.target !== ta) {   // zone itself focused: put the text in the box
      const txt = cd.getData('text/plain');
      if (txt) { e.preventDefault(); ta.value = (ta.value ? ta.value + '\n' : '') + txt; ta.focus(); }
    }
  });
  zone.addEventListener('keydown', function(e) {
    if (e.target === zone && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); document.getElementById('nimp-file').click(); }
  });
  ['dragenter', 'dragover'].forEach(function(ev) { zone.addEventListener(ev, function(e) { e.preventDefault(); zone.classList.add('drag'); }); });
  ['dragleave', 'dragend'].forEach(function(ev) { zone.addEventListener(ev, function(e) { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag'); }); });
  zone.addEventListener('drop', function(e) {
    e.preventDefault(); zone.classList.remove('drag');
    const dt = e.dataTransfer;
    const img = dt && Array.from(dt.files || []).find(function(f) { return /^image\//.test(f.type); });
    if (img) { _niSetImage(img); return; }
    const txt = dt && dt.getData('text/plain');
    if (txt) ta.value = (ta.value ? ta.value + '\n' : '') + txt;
    else if (dt && dt.files && dt.files.length) _niStatus('Drop an image or text.', true);
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _niInitPanel); else _niInitPanel();

function _niLoadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (_niLoadTesseract._p) return _niLoadTesseract._p;
  _niLoadTesseract._p = new Promise(function(resolve, reject) {
    const s = document.createElement('script');
    s.src = _NI_OCR.lib; s.integrity = _NI_OCR.sri; s.crossOrigin = 'anonymous';
    s.onload = function() { window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCR engine did not load')); };
    s.onerror = function() { _niLoadTesseract._p = null; reject(new Error('Could not load the OCR engine — check your connection.')); };
    document.head.appendChild(s);
  });
  return _niLoadTesseract._p;
}
// Cheap clean-up before OCR: grey-scale, dark screenshots inverted (dark-mode
// WhatsApp), small images upscaled — Tesseract reads ~2× text far better.
async function _niPrepImage(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const big = Math.max(bmp.width, bmp.height);
    let scale = big < 1400 ? Math.min(2.5, 1800 / big) : 1;
    if (bmp.width * bmp.height * scale * scale > 16e6) scale = Math.sqrt(16e6 / (bmp.width * bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h), a = px.data;
    let sum = 0;
    for (let i = 0; i < a.length; i += 4) { const y = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]; a[i] = a[i + 1] = a[i + 2] = y; sum += y; }
    if (sum / (a.length / 4) < 110) for (let i = 0; i < a.length; i += 4) { a[i] = a[i + 1] = a[i + 2] = 255 - a[i]; }
    g.putImageData(px, 0, 0);
    return await new Promise(function(res) { c.toBlob(function(b) { res(b || blob); }, 'image/png'); });
  } catch (e) { return blob; }
}
// OCR slips inside numbers: O→0, l/I→1 (only in tokens that are otherwise digits).
function _niOcrClean(t) {
  return String(t || '').replace(/\b[0-9OoIl]{3,}(?=(?:LT|lt|hrs?|HRS?|MT|mt|mts|MTS)?\b)/g, function(w) {
    return (w.match(/\d/g) || []).length >= 2 ? w.replace(/[Oo]/g, '0').replace(/[Il]/g, '1') : w;
  })
    // A superscript "th"/"st" after a day is read as a quote or degree sign:
    // "6/8" Oct" → "6/8th Oct" (otherwise "6/8" is taken as 6 August).
    .replace(new RegExp('(\\d)\\s?["“”\'’`°*^]+(?=\\s*' + _NI_MON + ')', 'gi'), '$1th')
    // Grade names with l/I/1 and O/0 confusions: "Visfo", "VLSF0", "LSMG0", "IsmGo".
    .replace(/\b[Vv][LlIi1|][Ss5][Ff][Oo0]\b/g, 'VLSFO')
    .replace(/\b[LlIi1|][Ss5][Mm][Gg][Oo0]\b/g, 'LSMGO')
    .replace(/\b([Mm][Gg])0\b/g, '$1O');
}
async function _niOcr(blob) {
  _niStatus('Loading OCR engine…');
  const T = await _niLoadTesseract();
  const img = await _niPrepImage(blob);
  // A worker that can't start (blocked download, no WebAssembly) never
  // settles on its own — give up after a while instead of spinning forever.
  let fail, lastTick = Date.now();
  const failed = new Promise(function(_, rej) { fail = rej; });
  const dog = setInterval(function() { if (Date.now() - lastTick > 90000) fail(new Error('the OCR engine stopped responding (offline or blocked?)')); }, 5000);
  let worker = null;
  try {
    worker = await Promise.race([failed, T.createWorker('eng', 1, {
      workerPath: _NI_OCR.worker, corePath: _NI_OCR.core, langPath: _NI_OCR.lang,
      errorHandler: function(e) { fail(e instanceof Error ? e : new Error(String(e))); },
      logger: function(m) {
        if (!m) return;
        lastTick = Date.now();
        if (m.status === 'recognizing text') _niStatus('Reading screenshot… ' + Math.round((m.progress || 0) * 100) + '%');
        else if (/load|initializ/i.test(m.status || '')) _niStatus('Loading OCR engine (first time only)…');
      }
    })]);
    lastTick = Date.now();
    const out = await Promise.race([failed, worker.recognize(img)]);
    return _niOcrClean((out && out.data && out.data.text) || '');
  } finally {
    clearInterval(dog);
    if (worker) { try { await worker.terminate(); } catch (e) {} }
  }
}

async function niRead() {
  if (_niBusy) return;
  const ta = document.getElementById('nimp-text'), btn = document.getElementById('nimp-read');
  _niBusy = true; if (btn) btn.disabled = true;
  try {
    if (_niImage) {
      let txt = '';
      try { txt = await _niOcr(_niImage); }
      catch (e) { _niStatus('Could not read the screenshot: ' + (e && e.message || e), true); return; }
      if (!txt.trim()) { _niStatus('No text found in the screenshot.', true); return; }
      // OCR text lands in the box so it can be checked / corrected and read again
      ta.value = txt.trim();
      niClearImage();
    }
    const text = ta.value;
    if (!text.trim()) { _niStatus('Paste a nomination (text or screenshot) first.', true); return; }
    _niSourceText = text;
    _niDrafts = _parseNominationText(text).map(function(d) {
      d.qtyText = d.qty ? _qtyInputText(d.qty, d.qtyMin, d.qtyMax) : '';
      d.mgoText = d.mgo ? _qtyInputText(d.mgo, d.mgoMin, d.mgoMax) : '';
      d.pick = true;
      return d;
    });
    _niStatus(_niDrafts.length ? 'Found ' + _niDrafts.length + ' nomination' + (_niDrafts.length === 1 ? '' : 's') + ' — check and add below.' : 'No nomination found in that text.', !_niDrafts.length);
    _niRenderReview();
  } finally { _niBusy = false; if (btn) btn.disabled = false; }
}

// Same vessel already in the register? Same IMO or MMSI, or same name with ETA/laycan within ±2 days.
function _niNormName(n) { return String(n || '').toUpperCase().replace(/^(?:M\s*\/\s*[VT]|M\.\s*[VT]\.?|MV|MT)\.?\s+/, '').replace(/[^A-Z0-9]+/g, ' ').trim(); }
function _niWhen(eta, lc) {
  const e = eta ? parseDT(eta) : null;
  if (e) return e;
  const l = lc ? parseLaycan(lc) : null;
  return l ? new Date((l.from.getTime() + l.to.getTime()) / 2) : null;
}
function _niFindDuplicate(d) {
  let vs = [];
  try { vs = captureCurrentState().vessels || []; } catch (e) {}
  const nm = _niNormName(d.name), imo = String(d.imo || '').replace(/\D/g, ''), mmsi = String(d.mmsi || '').replace(/\D/g, ''), when = _niWhen(d.eta, d.lc);
  return vs.find(function(v) {
    const vs2 = _vidSplitDef(v.imo, v.mmsi);
    const vImo = String(vs2.imo || '').replace(/\D/g, ''), vMmsi = String(vs2.mmsi || '').replace(/\D/g, '');
    if (imo && vImo && imo === vImo) return true;
    if (mmsi && vMmsi && mmsi === vMmsi) return true;
    if (!nm || _niNormName(v.name) !== nm) return false;
    const vw = _niWhen(v.eta, v.lc);
    return !when || !vw || Math.abs(vw - when) <= 2 * 86400000;
  }) || null;
}
// What's wrong with a row that would stop it being added (empty = fine).
function _niProblems(d) {
  const p = [];
  if (!String(d.name || '').trim()) p.push('vessel name');
  if (d.eta && !parseDT(d.eta)) p.push('ETA format (e.g. 14 Oct 2026 06:00)');
  if (d.lc && !parseLaycan(d.lc)) p.push('laycan format (e.g. 14-16 Oct 2026)');
  if (!d.eta && !d.lc) p.push('an ETA or laycan');
  if (!_parseQtyInput(d.qtyText).ok) p.push('VLSFO quantity');
  if (!_parseQtyInput(d.mgoText).ok) p.push('LSMGO quantity');
  return p;
}

const _NI_FIELDS = [
  // key, label, low-flag key, input kind
  ['name', 'Vessel', 'name'], ['imo', 'IMO', 'imo'], ['mmsi', 'MMSI', 'mmsi'], ['eta', 'ETA', 'eta'], ['lc', 'Laycan', 'lc'],
  ['qtyText', 'VLSFO (MT)', 'qty'], ['mgoText', 'LSMGO (MT)', 'mgo'], ['area', 'Location', 'area'],
  ['agent', 'Agent', 'agent'], ['spec', 'ISO 8217', 'spec']
];
const _NI_REMARKS = ['remarks', 'Remarks', 'remarks'];   // full width, on the row's second line
function _niCell(d, i, f) {
  const k = f[0], low = d.low && d.low[f[2]];
  const miss = (k === 'name' && !String(d.name || '').trim()) || ((k === 'eta' || k === 'lc') && !d.eta && !d.lc);
  const cls = miss ? 'nimp-miss' : ((k === 'imo' || k === 'mmsi') ? _niIdCls(d, k) : (low ? 'nimp-low' : ''));
  const lbl = f[1] + ' for row ' + (i + 1) + (low ? ' (check: ' + low + ')' : '');
  const common = ' data-i="' + i + '" data-k="' + k + '" class="' + cls + '" aria-label="' + esc(lbl) + '"' + (low ? ' title="' + esc(low) + '"' : '') + ' oninput="_niEdit(this)" onchange="_niEdit(this)"';
  let inner;
  if (k === 'area') {
    inner = '<select' + common + '>' + AREA_OPTIONS.map(function(o) { return '<option value="' + esc(o.value) + '"' + (o.value === d.area ? ' selected' : '') + '>' + esc(o.short || o.value) + '</option>'; }).join('') + '</select>';
  } else if (k === 'spec') {
    inner = '<select' + common + '>' + ['ISO 8217:2010', 'ISO 8217:2017'].map(function(o) { return '<option value="' + o + '"' + (o === d.spec ? ' selected' : '') + '>' + o.replace('ISO 8217:', '') + '</option>'; }).join('') + '</select>';
  } else {
    const ph = { eta: 'e.g. 14 Oct 2026 06:00', lc: 'e.g. 14-16 Oct 2026', qtyText: 'e.g. 500-600', mgoText: 'e.g. 50', imo: '7 digits', mmsi: '9 digits' }[k] || '';
    inner = '<input type="text" autocomplete="off"' + (k === 'agent' ? ' list="agent-directory-list"' : '') + ' value="' + esc(d[k] == null ? '' : d[k]) + '" placeholder="' + esc(ph) + '"' + common + '>';
  }
  // ETA: a time-frame select under the date ("Exact time" or EAM / AM / NOON / PM / LPM).
  if (k === 'eta') {
    inner += '<select class="nimp-win" data-i="' + i + '" data-k="etaWin" aria-label="ETA time frame for row ' + (i + 1) + '" onchange="_niEdit(this)">' +
      '<option value="">Exact time</option>' + _etaFrameOptionsHTML(_etaFrame(d.etaWin) ? _etaFrame(d.etaWin).code : '', true) + '</select>';
  }
  if (k === 'remarks') return inner;
  return '<td data-label="' + esc(f[1]) + '"' + (k === 'name' ? ' class="nimp-wide"' : '') + '>' + inner + '</td>';
}
// IMO / MMSI cells of a review row: red = an invalid number, amber = neither box holds a valid one (never blocks Add).
function _niIdCls(d, k) {
  const info = _vidInfo(d.imo, d.mmsi), c = info[k];
  if (c.kind === 'bad') return 'nimp-idbad';
  if (!info.ok) return 'nimp-low';
  return (d.low && d.low[k]) ? 'nimp-low' : '';
}
function _niIdNote(d) {
  const info = _vidInfo(d.imo, d.mmsi), bad = [];
  if (info.imo.kind === 'bad') bad.push(info.imo.msg);
  if (info.mmsi.kind === 'bad') bad.push(info.mmsi.msg);
  if (bad.length) return '<span class="idbad">' + esc(bad.join(' · ')) + (info.ok ? '' : ' — add a valid IMO or MMSI') + '</span>';
  if (!info.ok) return '<span class="idmiss">No IMO or MMSI — add one</span>';
  return '';
}
function _niMsgHtml(d) {
  const out = [];
  const dup = _niFindDuplicate(d);
  if (dup) out.push('<span class="dup">Possible duplicate: ' + esc(dup.name || '') + (dup.eta ? ' · ETA ' + esc(dup.eta) : (dup.lc ? ' · ' + esc(dup.lc) : '')) + (dup.imo ? ' · IMO ' + esc(dup.imo) : '') + (dup.mmsi ? ' · MMSI ' + esc(dup.mmsi) : '') + ' is already in the register</span>');
  const p = _niProblems(d);
  if (p.length) out.push('<span class="bad">Needs ' + esc(p.join(', ')) + '</span>');
  const idn = _niIdNote(d);
  if (idn) out.push(idn);
  const lows = Object.keys(d.low || {}).filter(function(k) { return d.low[k] && !((k === 'imo' || k === 'mmsi') && idn); }).map(function(k) { return d.low[k]; });
  if (lows.length) out.push('<span class="why">Check: ' + esc(lows.join(' · ')) + '</span>');
  return out.join('');
}
function _niRenderReview() {
  const box = document.getElementById('nimp-results');
  if (!box) return;
  if (!_niDrafts.length) { box.innerHTML = ''; return; }
  const n = _niDrafts.filter(function(d) { return d.pick; }).length;
  let h = '<div class="nimp-res-hdr"><strong>' + _niDrafts.length + ' draft nomination' + (_niDrafts.length === 1 ? '' : 's') + '</strong>' +
    '<span>— nothing is saved until you add.</span><span class="nimp-legend"><i></i>guessed — please check</span>' +
    '<span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">' +
    '<button type="button" class="btn btn-ghost btn-sm" onclick="niReset()">Discard</button>' +
    '<button type="button" class="btn btn-primary btn-sm" id="nimp-add-all" onclick="niAddDrafts()"' + (n ? '' : ' disabled') + '>Add ' + n + ' nomination' + (n === 1 ? '' : 's') + '</button></span></div>';
  h += '<div class="nimp-tblwrap"><table class="nimp-tbl"><colgroup><col style="width:30px"><col style="width:14%"><col style="width:8%"><col style="width:9%"><col style="width:12%"><col style="width:11%"><col style="width:7%"><col style="width:7%"><col style="width:8%"><col><col style="width:8%"><col style="width:62px"></colgroup><thead><tr><th><span style="position:absolute;left:-9999px">Include</span></th>' +
    _NI_FIELDS.map(function(f) { return '<th>' + esc(f[1]) + '</th>'; }).join('') + '<th></th></tr></thead><tbody>';
  _niDrafts.forEach(function(d, i) {
    h += '<tr class="nimp-row" id="nimp-row-' + i + '"><td class="nimp-pick" data-label="Include"><input type="checkbox" aria-label="Include row ' + (i + 1) + '"' + (d.pick ? ' checked' : '') + ' onchange="_niTogglePick(' + i + ',this.checked)"></td>' +
      _NI_FIELDS.map(function(f) { return _niCell(d, i, f); }).join('') +
      '<td class="nimp-addc"><button type="button" class="btn btn-secondary btn-sm" onclick="niAddDrafts([' + i + '])" aria-label="Add row ' + (i + 1) + '">Add</button></td></tr>' +
      '<tr class="nimp-msg"><td></td><td colspan="' + (_NI_FIELDS.length + 1) + '"><div class="nimp-rem">' + _niCell(d, i, _NI_REMARKS) + '</div><div class="nimp-flag" id="nimp-msg-' + i + '">' + _niMsgHtml(d) + '</div></td></tr>';
  });
  h += '</tbody></table></div>';
  // The original text is shown as text (esc), never as markup.
  h += '<details class="nimp-src"><summary>Original text</summary><pre>' + esc(_niSourceText) + '</pre></details>';
  box.innerHTML = h;
}
function _niEdit(el) {
  const i = +el.dataset.i, k = el.dataset.k, d = _niDrafts[i];
  if (!d) return;
  d[k] = el.value;
  // Time frame chosen → the ETA moves to the frame's start; an explicit time typed
  // into the ETA box that doesn't match the frame's start drops the frame.
  if (k === 'etaWin' || k === 'eta') {
    const row = document.getElementById('nimp-row-' + i);
    const etaEl = row && row.querySelector('[data-k="eta"]'), winEl = row && row.querySelector('[data-k="etaWin"]');
    const t = parseDT(d.eta || '');
    if (k === 'etaWin' && _etaFrame(d.etaWin) && t) { d.eta = _etaPickerStr(_etaFrameStart(t, d.etaWin)); if (etaEl) etaEl.value = d.eta; }
    if (k === 'eta' && _etaFrame(d.etaWin) && t && /\d:\d\d/.test(d.eta) && (t.getHours() !== _etaFrame(d.etaWin).from || t.getMinutes() !== 0)) { d.etaWin = ''; if (winEl) winEl.value = ''; }
    if (k === 'etaWin' && d.low && d.low.eta && etaEl) { delete d.low.eta; etaEl.classList.remove('nimp-low'); etaEl.removeAttribute('title'); }
  }
  const lowKey = (_NI_FIELDS.concat([_NI_REMARKS]).find(function(f) { return f[0] === k; }) || [])[2];
  if (lowKey && d.low && d.low[lowKey]) { delete d.low[lowKey]; el.classList.remove('nimp-low'); el.removeAttribute('title'); }
  if (k === 'name') el.classList.toggle('nimp-miss', !String(el.value).trim());
  if (k === 'imo' || k === 'mmsi') {
    const row = document.getElementById('nimp-row-' + i);
    if (row) row.querySelectorAll('[data-k="imo"],[data-k="mmsi"]').forEach(function(x) {
      ['nimp-low', 'nimp-idbad'].forEach(function(c) { x.classList.remove(c); });
      const c = _niIdCls(d, x.dataset.k);
      if (c) x.classList.add(c);
    });
  }
  if (k === 'eta' || k === 'lc') {
    const row = document.getElementById('nimp-row-' + i);
    if (row) row.querySelectorAll('[data-k="eta"],[data-k="lc"]').forEach(function(x) { x.classList.toggle('nimp-miss', !d.eta && !d.lc); });
  }
  const msg = document.getElementById('nimp-msg-' + i);
  if (msg) msg.innerHTML = _niMsgHtml(d);
}
function _niTogglePick(i, on) {
  if (_niDrafts[i]) _niDrafts[i].pick = !!on;
  const n = _niDrafts.filter(function(d) { return d.pick; }).length, b = document.getElementById('nimp-add-all');
  if (b) { b.textContent = 'Add ' + n + ' nomination' + (n === 1 ? '' : 's'); b.disabled = !n; }
}
// Draft → addVessel(def): same shape captureCurrentState() saves.
function _niDraftToDef(d) {
  const v = _parseQtyInput(d.qtyText), m = _parseQtyInput(d.mgoText);
  const def = {
    name: String(d.name || '').trim().toUpperCase(), imo: _vidNorm(d.imo), eta: String(d.eta || '').trim(), lc: String(d.lc || '').trim(),
    area: d.area || 'FUJ-A', spec: d.spec || 'ISO 8217:2010', agent: String(d.agent || '').trim(), remarks: String(d.remarks || '').trim(),
    type: v.qty > 0 && m.qty > 0 ? 'BOTH' : (m.qty > 0 ? 'MGO' : 'VLSFO'), qty: v.qty, mgo: m.qty
  };
  if (v.min != null) { def.qtyMin = v.min; def.qtyMax = v.max; }
  if (m.min != null) { def.mgoMin = m.min; def.mgoMax = m.max; }
  // MMSI only when given (like a hand-made card); a number in the wrong box moves to the right one.
  const mm = _vidNorm(d.mmsi);
  if (mm) def.mmsi = mm;
  if (/^\d{9}$/.test(def.imo) && !def.mmsi) { def.mmsi = def.imo; def.imo = ''; }
  if (/^\d{7}$/.test(def.mmsi || '') && !def.imo) { def.imo = def.mmsi; delete def.mmsi; }
  // Time-frame ETA: keep the frame; the ETA itself sits at the frame's start.
  const t = def.eta ? parseDT(def.eta) : null;
  if (t && _etaFrame(d.etaWin)) { def.etaWin = _etaFrame(d.etaWin).code; def.eta = _etaPickerStr(_etaFrameStart(t, def.etaWin)); }
  return def;
}
function niAddDrafts(only) {
  const idx = (only || _niDrafts.map(function(_, i) { return i; }).filter(function(i) { return _niDrafts[i].pick; }));
  const ok = [], bad = [], dups = [];
  idx.forEach(function(i) {
    const d = _niDrafts[i];
    if (!d) return;
    if (_niProblems(d).length) bad.push(i); else { ok.push(i); if (_niFindDuplicate(d)) dups.push(String(d.name || '').toUpperCase()); }
  });
  if (bad.length) {
    const r0 = document.getElementById('nimp-row-' + bad[0]);
    const f0 = r0 && (r0.querySelector('.nimp-miss') || r0.querySelector('input[type="text"]'));
    if (f0) f0.focus();
    _niStatus(bad.length + ' row' + (bad.length === 1 ? ' needs' : 's need') + ' fixing first (see the red notes).', true);
    if (!ok.length) return;
  }
  if (!ok.length) return;
  if (dups.length && !confirm('These look like nominations already in the register:\n\n• ' + dups.join('\n• ') + '\n\nAdd them anyway?')) return;
  ok.forEach(function(i) { addVessel(_niDraftToDef(_niDrafts[i])); });
  const added = ok.length;
  _niDrafts = _niDrafts.filter(function(_, i) { return ok.indexOf(i) < 0; });
  _niRenderReview();
  saveSharedState();
  const msg = 'Added ' + added + ' nomination' + (added === 1 ? '' : 's') + (bad.length ? ' — ' + bad.length + ' still need fixing' : '') + '.';
  _niStatus(msg, !!bad.length);
  if (typeof showToast === 'function') showToast(msg, 'success');
  if (!_niDrafts.length) { const t = document.getElementById('nimp-text'); if (t) t.value = ''; _niSourceText = ''; }
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
  const remarks = def.remarks || '';
  // IMO / MMSI boxes (a legacy 9-digit MMSI saved in the IMO box shows in the MMSI box;
  // the saved pair itself is kept until these boxes are edited — _vidRemember / _cardIdStore).
  const ids = _vidSplitDef(def.imo, def.mmsi);
  _vidRemember(id, def, ids);
  // ETA given only as a part of the day (AM / PM …) — see ETA_TIME_FRAMES.
  const etaWin = _etaFrame(def.etaWin) ? _etaFrame(def.etaWin).code : '';
  const refuelChk = def.refuelChk || false;
  const sts = !!def.sts;
  const lcOnly = !!def.lcOnly;
  const rfv = def.rfv || 0, rfm = def.rfm || 0, rfvr = def.rfvr || 750, rfmr = def.rfmr || 275;

  const c = document.createElement('div');
  c.className = 'vcard'; c.id = `vessel-${id}`;
  c.dataset.nomUid = nomUid;
  c._newerFields = _newerBuildFields(def, _VESSEL_KEYS); // saved back unchanged (see _newerBuildFields)
  if (sts) c.setAttribute('data-sts', '1');
  // Every field value below is user/sync data — esc() it (see esc() header).
  c.innerHTML = `
  <div class="vcard-hdr">
    <div class="vhdr-l"><span class="vnum">VESSEL ${String(id).padStart(2,'0')}</span><span class="vid-badge" id="v${id}-idbadge"></span><label class="sts-chk" title="Tick if this nomination is a ship-to-ship (STS) supply"><input type="checkbox" id="v${id}-sts" ${sts ? 'checked' : ''} onchange="toggleSts(${id})" aria-label="STS operation">STS</label><label class="sts-chk" title="Tick to supply this vessel only once its laycan opens — an early arrival waits for the laycan"><input type="checkbox" id="v${id}-lconly" ${lcOnly ? 'checked' : ''} onchange="toggleLcOnly(${id})" aria-label="Supply within laycan only">Laycan only</label></div>
    <div style="display:flex;gap:6px;align-items:center">
      <button class="send-email-btn" id="v${id}-send-email-btn" onclick="sendNominationEmailForCard(${id})">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>
        Send Nomination Email
      </button>
      <button class="cancel-email-btn" id="v${id}-cancel-email-btn" onclick="sendNominationCancelledEmailForCard(${id})">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        Cancel Nomination
      </button>
      <button class="rm-btn" onclick="rmV(${id})"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Remove</button>
    </div>
  </div>
  <div class="g4 mb10 vrow-ids">
    <div class="field vname-field"><label>Vessel Name</label><input type="text" id="v${id}-name" value="${esc(name)}" oninput="clearTimeout(upd._t);upd._t=setTimeout(saveSharedState,1500);clearTimeout(window._trBanner${id});window._trBanner${id}=setTimeout(function(){renderVesselTrackRecordBanner('v${id}-name','v${id}-track-record')},400);_vidRender(${id});_vidSyncAlertsSoon()"><div id="v${id}-track-record"></div></div>
    <div class="field vid-field" role="group" aria-labelledby="v${id}-ids-lbl">
      <label id="v${id}-ids-lbl" for="v${id}-imo" title="At least one of the two is required">IMO Number / MMSI <span class="vid-req" aria-hidden="true">*</span><span class="vid-sub"> — at least one</span></label>
      <div class="vid-pair">
        <div class="vid-box vid-box-imo"><span class="vid-mini" aria-hidden="true">IMO</span><input type="text" class="vid-in" id="v${id}-imo" value="${esc(ids.imo)}" placeholder="7 digits" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="IMO number (7 digits)" aria-describedby="v${id}-idmsg" oninput="vidInput(${id},'imo')" onchange="vidCommit(${id},'imo')" onblur="vidCommit(${id},'imo')"></div>
        <div class="vid-box vid-box-mmsi"><span class="vid-mini" aria-hidden="true">MMSI</span><input type="text" class="vid-in" id="v${id}-mmsi" value="${esc(ids.mmsi)}" placeholder="9 digits" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="MMSI (9 digits)" aria-describedby="v${id}-idmsg" oninput="vidInput(${id},'mmsi')" onchange="vidCommit(${id},'mmsi')" onblur="vidCommit(${id},'mmsi')"></div>
      </div>
      <div class="vid-msg" id="v${id}-idmsg" aria-live="polite"></div>
      <div class="vid-look" id="v${id}-idlook"><span>Look up</span><a id="v${id}-look-vf" target="_blank" rel="noopener" title="Find the ship on VesselFinder (new tab) to copy its MMSI / IMO">VesselFinder</a><a id="v${id}-look-mt" target="_blank" rel="noopener" title="Find the ship on MarineTraffic (new tab) to copy its MMSI / IMO">MarineTraffic</a></div>
    </div>
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
      <label for="v${id}-vlsfo">VLSFO Qty (MT)</label>
      <input type="text" id="v${id}-vlsfo" value="${esc(_qtyInputText(qty, def.qtyMin, def.qtyMax))}" placeholder="500 or 500-600" autocomplete="off" aria-describedby="v${id}-hvq" oninput="upd(${id})">
      <span class="hint" id="v${id}-hvq" aria-live="polite"></span>
    </div>
    <div class="field" id="v${id}-mw" style="display:none">
      <label for="v${id}-mgo">MGO Qty (MT)</label>
      <input type="text" id="v${id}-mgo" value="${esc(_qtyInputText(mgoQ, def.mgoMin, def.mgoMax))}" placeholder="100 or 100-150" autocomplete="off" aria-describedby="v${id}-hmq" oninput="upd(${id})">
      <span class="hint" id="v${id}-hmq" aria-live="polite"></span>
    </div>
    <div class="field">
      <label>ISO Spec</label>
      <select id="v${id}-spec" onchange="saveSharedState()">
        <option value="ISO 8217:2010" ${spec==='ISO 8217:2010'?'selected':''}>ISO 8217:2010</option>
        <option value="ISO 8217:2017" ${spec==='ISO 8217:2017'?'selected':''}>ISO 8217:2017</option>
      </select>
    </div>
    <div class="field"><label>Agent</label><input type="text" id="v${id}-agent" list="agent-directory-list" placeholder="Type to search agent directory…" value="${esc(agent)}" oninput="clearTimeout(upd._t);upd._t=setTimeout(saveSharedState,1500)"></div>
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
        <input type="text" id="v${id}-lc" value="${esc(lc)}" placeholder="e.g. 22-24 Apr ${new Date().getFullYear()}…" oninput="upd(${id})" autocomplete="off" readonly style="cursor:pointer;background:var(--surface)" onclick="openLaycanPicker(${id})">
        <button type="button" class="cal-btn" onclick="openLaycanPicker(${id})"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></button>
      </div>
      <span class="hint" id="v${id}-hlc"></span>
    </div>
    <div class="field">
      <label>Actual ETA <span style="font-weight:400;color:var(--muted)">— date &amp; time</span></label>
      <div class="input-with-cal">
        <input type="text" id="v${id}-eta" value="${esc(eta)}" placeholder="${etaWin ? 'Select date…' : 'Select date &amp; time…'}" oninput="upd(${id})" autocomplete="off" readonly style="cursor:pointer;background:var(--surface)" onclick="openETAPicker(${id})">
        <button type="button" class="cal-btn" onclick="openETAPicker(${id})">🕐</button>
      </div>
      <div class="tf-row">
        <label class="tf-chk" title="The nomination gives only a part of the day for the ETA"><input type="checkbox" id="v${id}-etawin-chk" ${etaWin ? 'checked' : ''} onchange="toggleEtaWin(${id})">Time frame only (AM / PM…)</label>
        <select class="tf-sel" id="v${id}-etawin" aria-label="ETA time frame" onchange="etaWinChanged(${id})" ${etaWin ? '' : 'hidden'}>${_etaFrameOptionsHTML(etaWin || 'AM')}</select>
      </div>
      <span class="hint" id="v${id}-het"></span>
    </div>
  </div>
  <div class="lc-box" id="v${id}-lcbox"></div>
  <div class="etc-prev" id="v${id}-prev"></div>
  <div class="field" style="margin-top:10px">
    <label>Remarks <span style="font-weight:400;color:var(--muted)">— optional, included in nomination emails</span></label>
    <textarea id="v${id}-remarks" rows="2" oninput="clearTimeout(upd._t);upd._t=setTimeout(saveSharedState,1500)" style="width:100%;resize:vertical">${esc(remarks)}</textarea>
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
        <div class="field"><label>VLSFO to Load (MT)</label><input type="number" id="v${id}-rfv" value="${esc(rfv)}" min="0" step="50" oninput="calcRefuelTime(${id})"></div>
        <div class="field"><label>MGO to Load (MT)</label><input type="number" id="v${id}-rfm" value="${esc(rfm)}" min="0" step="50" oninput="calcRefuelTime(${id})"></div>
        <div class="field"><label>VLSFO Load Rate (MT/hr)</label><input type="number" id="v${id}-rfvr" value="${esc(rfvr)}" min="1" step="10" oninput="calcRefuelTime(${id})"></div>
        <div class="field"><label>MGO Load Rate (MT/hr)</label><input type="number" id="v${id}-rfmr" value="${esc(rfmr)}" min="1" step="10" oninput="calcRefuelTime(${id})"></div>
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
  _qtyHints(id);
  _vidRender(id); // IMO / MMSI state, header badge, look-up links
  if (lc || eta) upd(id);
  populateBargeDropdowns();
  // Show the track record immediately for a restored/existing nomination
  // too, not just when someone types a new name — a card can load with a
  // vessel name already filled in from saved state.
  if (name) renderVesselTrackRecordBanner('v' + id + '-name', 'v' + id + '-track-record');
  // Fix #3: if this card is being restored from saved state and its
  // nomination already has emailSent=true in the (already-loaded) local
  // log cache, lock the button immediately so it never flashes as
  // sendable for a moment after reload.
  if (typeof _refreshSendEmailButtonState === 'function') _refreshSendEmailButtonState(id);
  if (typeof _refreshCancelEmailButtonState === 'function') _refreshCancelEmailButtonState(id);
  // FT84 FIX (Issue 4): Restore per-vessel manual barge assignment from saved state.
  // The card's select has no options until populateBargeDropdowns() has run, so
  // def.bargeId is applied AFTER the dropdown is populated.
  if (def.bargeId) {
    const bargeSel = document.getElementById(`v${id}-barge`);
    if (bargeSel && Array.from(bargeSel.options).some(o => String(o.value) === String(def.bargeId))) {
      bargeSel.value = String(def.bargeId);
    }
  }
  // Barge assignment and the barge-refuelling slot are operator planning
  // fields — trader_update_vessels() keeps the operator's values for them,
  // so don't let a trader edit what the server will ignore.
  if (typeof isTrader === 'function' && isTrader()) {
    ['barge', 'refuel-chk', 'rfv', 'rfm', 'rfvr', 'rfmr'].forEach(function(f) {
      const el = document.getElementById(`v${id}-${f}`);
      if (el) { el.disabled = true; el.title = 'Set by operators'; }
    });
  }
  renumberVessels();
  // Explicit refresh (in addition to the #vc MutationObserver) so a newly
  // added nomination shows up in the Operational Activity card immediately,
  // even if this card was added before the observer had a chance to attach.
  if (typeof refreshNominationKPIs === 'function') refreshNominationKPIs();
  if (typeof refreshDashboard === 'function') refreshDashboard();
}

/* How a vessel's times classify: the ETA the planner works from, whether it
   is late / early against the laycan, and whether it counts as "no firm ETA".
   One place, shared by the nomination cards (getVessels) and the planner,
   so they can never disagree. */
function _planVesselTimes(eta, winHrs, lc, hasFrame, lcOnly) {
  // "Laycan only": a vessel due before its laycan opens is supplied once it
  // does — planned as ready at the laycan start (its time frame is over by then).
  const held = !!(lcOnly && lc && lc.from && eta && addHrs(eta, winHrs || 0) < lc.from);
  const effectiveETA = held ? new Date(lc.from.getTime()) : eta || (lc ? new Date((lc.from.getTime()+lc.to.getTime())/2) : null);
  const isDelayed = !!(lc && eta && eta > lc.to);
  // Mirrors isDelayed, just the opposite side of the laycan window —
  // arriving BEFORE it opens instead of after it closes. A time frame is
  // early only when even its END is before the laycan opens.
  const isEarly = !held && !!(lc && eta && addHrs(eta, winHrs) < lc.from);
  // ETA at exactly 00:00 = no firm ETA — scheduled last, after all firm-ETA vessels.
  // Not for a time frame: EAM starts at 00:00 but is a real arrival window.
  const noFirmETA = !!(eta && !hasFrame && eta.getHours() === 0 && eta.getMinutes() === 0);
  return { effectiveETA, isDelayed, isEarly, noFirmETA, held };
}

/* quiet: report an unreadable card by throwing (message in the Error) instead
   of alert()ing — for callers that read the cards in the background. */
function getVessels(quiet) {
  const out = [];
  document.querySelectorAll('.vcard[id^="vessel-"]').forEach(c => {
    const id = c.id.replace('vessel-','');
    const name = (document.getElementById(`v${id}-name`)?.value || '').trim().replace(/\s+/g,' ');
    const lcR  = document.getElementById(`v${id}-lc`)?.value   || '';
    const etR  = document.getElementById(`v${id}-eta`)?.value  || '';
    const type = document.getElementById(`v${id}-type`)?.value;
    // vq/mq = planning figure (top of a range) — the scheduler only ever uses these.
    const vqP  = type==='MGO'   ? null : _cardQty(id, 'vlsfo');
    const mqP  = type==='VLSFO' ? null : _cardQty(id, 'mgo');
    const vq   = vqP ? vqP.qty : 0;
    const mq   = mqP ? mqP.qty : 0;
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
    const eta0 = etR ? parseDT(etR)    : null;
    // Time-frame ETA (AM / PM …): planned from the frame START; worst case
    // the vessel arrives at the frame END (winHrs later).
    const etaWin = eta0 ? _cardEtaWin(id) : '';
    const eta = (eta0 && etaWin) ? _etaFrameStart(eta0, etaWin) : eta0;
    const winHrs = etaWin ? _etaFrameHrs(etaWin) : 0;
    const fail = msg => { if (quiet) throw new Error(msg); alert(msg); throw new Error(); };
    if (etR && !eta) fail(`"${name}": cannot read Actual ETA "${etR}". Use the calendar picker.`);
    if (!eta && !lc) fail(`"${name}": please enter at least an Actual ETA or Nominated Laycan.`);
    const lcOnly = _cardLcOnly(id);
    const { effectiveETA, isDelayed, isEarly, noFirmETA, held } = _planVesselTimes(eta, winHrs, lc, !!etaWin, lcOnly);
    const paq     = document.getElementById(`v${id}-paq`)?.value    || 'no';
    const bargeId = document.getElementById(`v${id}-barge`)?.value  || '';
    const nomUid  = c.dataset.nomUid || '';
    const imo     = document.getElementById(`v${id}-imo`)?.value     || '';
    const mmsi    = (document.getElementById(`v${id}-mmsi`)?.value   || '').trim();
    const remarks = document.getElementById(`v${id}-remarks`)?.value || '';
    const sts     = _cardSts(id);
    out.push({id, name, sts, lc, eta, effectiveETA, vq, mq, type, spec, agent, mani, area, isDelayed, isEarly, noFirmETA, paq, bargeId, lcOnly, held,
              refuel: refuelChk && (rfv>0||rfm>0), rfv, rfm, rfvr, rfmr, nomUid, imo, mmsi, remarks, etaWin, winHrs,
              vqMin: vqP && vqP.min != null ? vqP.min : null, mqMin: mqP && mqP.min != null ? mqP.min : null});
  });
  return out;
}

/* The planner's inputs that live outside the vessel and barge rows: transit
   and hose-up hours, and a barge's Unavailable blocks. planSchedule() takes
   them as a plain object so it never reads app state itself. */
function _planCtxLive() {
  const hoseHrs = _calcParams.hoseHrs, travelHrs = _calcParams.travelHrs;
  return { hoseHrs, travelHrs, blocksFor: b => _blocksForBarge(b.id, b.name) };
}

/* Earliest start ≥ `start` for a job on `barge` that doesn't touch any of its
   Unavailable blocks (with transit either side, like any other job). Returns
   {start, block} — block = the first one it had to wait for, or null. */
function _schedStartOutsideBlocks(barge, start, vq, mq, winEnd, P) {
  const blocks = P.blocksFor(barge)
    .map(bk => ({ s: new Date(bk.start), e: new Date(bk.end), bk }))
    .filter(x => !isNaN(x.s.getTime()) && !isNaN(x.e.getTime()) && x.e > x.s);
  if (!blocks.length) return { start, block: null };
  const tr = P.travelHrs || 0;
  let s = start, hit = null;
  for (let guard = 0; guard < 50; guard++) {
    // Time-frame ETA: the job can't finish before frame end + supply time.
    const e = calcETC(winEnd && winEnd > s ? winEnd : s, vq, mq, barge.vtph, barge.mtph, P.hoseHrs);
    const b = blocks.find(x => s < addHrs(x.e, tr) && addHrs(e, tr) > x.s);
    if (!b) break;
    if (!hit) hit = b.bk;
    s = addHrs(b.e, tr);
  }
  return { start: s, block: hit };
}

/* When a vessel's supply ends if it starts at `start` — normally start +
   hose-up + pumping (calcETC). A time-frame ETA can arrive as late as the
   frame END, so the barge stays committed until max(start, frame end) +
   the same supply time (worst case). */
// A held vessel (Laycan only, due before the laycan) is ready at the laycan
// opening: its arrival frame is over by then, so there is no frame end to wait for.
function _vesselFrameEnd(v) { return (v && v.winHrs && v.effectiveETA && !v.held) ? addHrs(v.effectiveETA, v.winHrs) : null; }
function _vesselJobETC(start, v, vtph, mtph, P) {
  const we = _vesselFrameEnd(v);
  return calcETC(we && we > start ? we : start, v.vq, v.mq, vtph, mtph, P.hoseHrs);
}

