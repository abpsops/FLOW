/* ─── IMPORT NOMINATION: rule-based text parser ───
   _parseNominationText(text, opts) → array of draft nominations, one per
   vessel found. Pure and deterministic (same text + same opts.now → same
   drafts); nothing leaves the device. opts: now (Date — "today" for dates
   written without a year/month), areas ([{value,label}] — the Anchorage
   dropdown), agents ([names] — the Agent Directory), specs ([values]).
   Each draft: name, imo, mmsi, eta ('14 Oct 2026 06:00' — the ETA picker's
   format; 00:00 = no firm time), lc ('14-16 Oct 2026'), type, qty/qtyMin/
   qtyMax, mgo/mgoMin/mgoMax (a range plans at its max, like the card),
   area, agent, spec, remarks, low {field: reason} for anything guessed,
   and src (the text it came from). */
const _NI_MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const _NI_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const _NI_MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _niPad = function(n) { return String(n).padStart(2, '0'); };
const _niMon = function(s) { return _NI_MONTHS[String(s).slice(0, 3).toLowerCase()]; };

// IMO numbers carry a check digit: d1×7 + d2×6 + … + d6×2, last digit of the sum = d7.
function _imoValid(s) {
  s = String(s || '');
  if (!/^\d{7}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += (+s[i]) * (7 - i);
  return sum % 10 === +s[6];
}

/* ─── VESSEL IDENTIFIERS: IMO number + MMSI ───
   A nomination card has two boxes: IMO (vessel.imo — always stored, as
   before) and MMSI (vessel.mmsi — stored ONLY when set, so older vessels
   stay byte-identical). At least ONE valid identifier is wanted (it
   identifies the ship beyond doubt) — but it is never enforced: a missing
   or invalid ID warns (card, Needs Attention, bell, Generate Schedule /
   e-mails), nothing is blocked.
     IMO  = 7 digits, the last one a check digit (_imoValid)
     MMSI = 9 digits, first digit 2–7 (a ship station)
   "IMO 9321483", "IMO No. 9321483", "MMSI: 636 012 345" are accepted and
   normalised to digits — _vidNorm is THE grammar (card, import, search).
   Saved values the boxes show differently: before the MMSI box existed a
   9-digit MMSI was typed into the IMO box — such a card shows it in the
   MMSI box (IMO box empty); "IMO No. 9321483" shows as 9321483
   (_vidSplitDef in addVessel). The SAVED pair is not rewritten for that:
   until the user edits that card's IMO / MMSI boxes, every save writes the
   pair back exactly as it was (_vidOrig / _cardIdStore). So the legacy
   MMSI stays in vessel.imo, where an older app build (no MMSI box) still
   reads it, old vessels stay byte-identical, and
   loading or any other edit writes nothing new. Once the boxes are edited
   the record holds what they show (imo '' + mmsi for a moved MMSI). */
function _vidNorm(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/^(?:IMO|MMSI)(?![A-Za-z])\s*(?:no\.?|nr\.?|number|#)?\s*[:.#=\-–]?\s*/i, '');
  const d = s.replace(/[\s.\-]/g, '');
  return /^\d+$/.test(d) ? d : s;
}
function _mmsiValid(s) { return /^[2-7]\d{8}$/.test(String(s == null ? '' : s)); }
// One box → {raw, val, kind: 'empty' | 'ok' | 'bad', msg}. val = normalised (digits when it reads as digits).
function _vidCheck(raw, which) {
  const val = _vidNorm(raw);
  if (!val) return { raw: String(raw || ''), val: '', kind: 'empty', msg: '' };
  const digits = /^\d+$/.test(val);
  if (which === 'imo') {
    if (_imoValid(val)) return { raw: String(raw), val: val, kind: 'ok', msg: '' };
    return { raw: String(raw), val: val, kind: 'bad', msg: digits && val.length === 7 ? 'Not a valid IMO (check digit)' : (digits && val.length === 9 ? 'Not a valid IMO — 9 digits is an MMSI' : 'Not a valid IMO (7 digits)') };
  }
  if (_mmsiValid(val)) return { raw: String(raw), val: val, kind: 'ok', msg: '' };
  return { raw: String(raw), val: val, kind: 'bad', msg: 'MMSI must be 9 digits starting 2–7' };
}
// Both boxes → {imo, mmsi, ok}: ok = at least one valid identifier.
function _vidInfo(imoRaw, mmsiRaw) {
  const imo = _vidCheck(imoRaw, 'imo'), mmsi = _vidCheck(mmsiRaw, 'mmsi');
  return { imo: imo, mmsi: mmsi, ok: imo.kind === 'ok' || mmsi.kind === 'ok' };
}
// A saved vessel / def → what its two boxes show: a value that reads as one
// number as its digits ("IMO No. 9321483" → 9321483); legacy: 9 digits in the
// IMO box = the MMSI (shown in the MMSI box, unless that holds another number).
function _vidSplitDef(imo, mmsi) {
  imo = imo == null ? '' : String(imo); mmsi = mmsi == null ? '' : String(mmsi);
  const di = _vidNorm(imo), dm = _vidNorm(mmsi);
  const si = /^\d+$/.test(di) ? di : imo, sm = /^\d+$/.test(dm) ? dm : mmsi;
  if (/^\d{9}$/.test(di) && (!dm || dm === di)) return { imo: '', mmsi: di };
  return { imo: si, mmsi: sm };
}
// Card id → the saved {imo, mmsi} it was built from and what its boxes showed,
// when those differ (see the header above). Set by addVessel.
const _vidOrig = {};
function _vidRemember(id, def, shown) {
  const imo = def && def.imo != null ? String(def.imo) : '', mmsi = def && def.mmsi != null ? String(def.mmsi) : '';
  if (shown.imo !== imo || shown.mmsi !== mmsi) _vidOrig[id] = { imo: imo, mmsi: mmsi, shownImo: shown.imo, shownMmsi: shown.mmsi };
  else delete _vidOrig[id];
}
// A saved vessel object ({imo, mmsi}) has at least one valid identifier.
function _vidVesselOk(v) { const s = _vidSplitDef(v && v.imo, v && v.mmsi); return _vidInfo(s.imo, s.mmsi).ok; }
// Card → its two boxes as typed.
function _cardIds(id) {
  const i = document.getElementById('v' + id + '-imo'), m = document.getElementById('v' + id + '-mmsi');
  return { imo: i ? String(i.value || '') : '', mmsi: m ? String(m.value || '') : '' };
}
// Card → the {imo, mmsi} to save: what the boxes hold — or, while they still
// show exactly what addVessel made of the saved pair, that saved pair unchanged.
function _cardIdStore(id) {
  const box = _cardIds(id), o = _vidOrig[id];
  if (o && box.imo === o.shownImo && box.mmsi === o.shownMmsi) return { imo: o.imo, mmsi: o.mmsi };
  return { imo: box.imo, mmsi: box.mmsi.trim() };
}
// Fields for a vessel record: imo, plus mmsi only when there is one (no key otherwise).
function _cardIdFields(id) {
  const st = _cardIdStore(id), out = { imo: st.imo };
  if (String(st.mmsi).trim()) out.mmsi = st.mmsi;
  return out;
}

// No year written: this year, unless that's well in the past (a January ETA read in December).
function _niYear(day, mon, yrStr, now) {
  if (yrStr) { const y = +yrStr; return yrStr.length <= 2 ? 2000 + y : y; }
  const y = now.getFullYear(), d = new Date(y, mon, day);
  return (now - d) > 60 * 86400000 ? y + 1 : y;
}
// Day only ("ETA 14th", "14/1800"): this month, or next month if that day has passed.
function _niMonthFor(day, now) {
  let y = now.getFullYear(), m = now.getMonth();
  if (day < now.getDate() - 3) { m++; if (m > 11) { m = 0; y++; } }
  return { m: m, y: y };
}
function _niValidDate(y, m, d) {
  const x = new Date(y, m, d);
  return x.getFullYear() === y && x.getMonth() === m && x.getDate() === d;
}

/* A date at the START of s. → {y, m, d, len, low} or null. low = month or
   year had to be guessed beyond the usual "this year". */
function _niParseDate(s, now) {
  let r;
  const done = function(y, m, d, len, low) {
    return (m >= 0 && m <= 11 && d >= 1 && d <= 31 && _niValidDate(y, m, d)) ? { y: y, m: m, d: d, len: len, low: !!low } : null;
  };
  if ((r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/))) return done(+r[1], +r[2] - 1, +r[3], r[0].length);
  // A 4-digit year may be followed by a time frame ("16 Oct 2026 AM"); a 2-digit one followed by am/pm is a time.
  if ((r = s.match(new RegExp('^(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-./]*(?:of\\s+)?' + _NI_MON + '\\.?(?:[\\s\\-./,\']*((?:19|20)\\d{2}(?![\\d:.h]|\\s*(?:hrs?|hours|lt)\\b)|(?:0[1-9]|1[0-2])(?![\\d:.h]|\\s*(?:hrs?|hours|lt|am|pm|a\\.m|p\\.m|noon|midnight)\\b)|(?:00|1[3-9]|[2-9]\\d)(?![\\d:.h]|\\s*(?:hrs?|hours|lt)\\b)))?', 'i')))) {
    const d = +r[1], m = _niMon(r[2]);
    // "16 Oct 2000 PM" / "1930pm": a 4-digit number before am/pm that can't be
    // this year (±) is a 24h time, not the year — leave it for _niParseTime.
    if (r[3] && r[3].length === 4 && /^\s*(?:a\.?m|p\.?m)/i.test(s.slice(r[0].length))) {
      const ny = (now instanceof Date ? now : new Date()).getFullYear(), yy = +r[3];
      if (yy < ny - 1 || yy > ny + 5) {
        const r2 = s.match(new RegExp('^(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-./]*(?:of\\s+)?' + _NI_MON + '\\.?', 'i'));
        if (r2) return done(_niYear(d, m, undefined, now), m, d, r2[0].length);
      }
    }
    return done(_niYear(d, m, r[3], now), m, d, r[0].length);
  }
  if ((r = s.match(new RegExp('^' + _NI_MON + '\\.?[\\s\\-]*(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)(?:,?\\s*((?:19|20)\\d{2})(?!\\d))?', 'i')))) {
    const d = +r[2], m = _niMon(r[1]);
    return done(_niYear(d, m, r[3], now), m, d, r[0].length);
  }
  if ((r = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-]((?:19|20)\d{2}|\d{2})(?![\d:])/))) {
    let d = +r[1], m = +r[2] - 1, low = false;
    if (m > 11 && d <= 12) { const t = d; d = m + 1; m = t - 1; low = true; } // looks month-first
    return done(_niYear(d, m, r[3], now), m, d, r[0].length, low);
  }
  // "14/1800" — day + time, month implied
  if ((r = s.match(/^(\d{1,2})\s*\/\s*([01]\d|2[0-3])([0-5]\d)(?!\d)/))) {
    const d = +r[1], mm = _niMonthFor(d, now);
    const out = done(mm.y, mm.m, d, r[0].length, true);
    if (out) out.time = { h: +r[2], mi: +r[3], len: 0 };
    return out;
  }
  if ((r = s.match(/^(\d{1,2})[\/.](\d{1,2})(?![\d\/.]*\d)/))) {
    let d = +r[1], m = +r[2] - 1;
    return done(_niYear(d, m, '', now), m, d, r[0].length);
  }
  if ((r = s.match(/^(\d{1,2})(?:st|nd|rd|th)\b/i))) {
    const d = +r[1], mm = _niMonthFor(d, now);
    return done(mm.y, mm.m, d, r[0].length, true);
  }
  if ((r = s.match(/^(today|tonight|tomorrow|tmrw|tmr)\b/i))) {
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (/^to(day|night)/i.test(r[1]) ? 0 : 1));
    const out = done(t.getFullYear(), t.getMonth(), t.getDate(), r[0].length, true);
    if (out && /tonight/i.test(r[1])) out.time = { h: 22, mi: 0, len: 0, low: true };
    return out;
  }
  return null;
}
/* A time at the START of s (after separators). → {h, mi, len, low} or null. */
function _niParseTime(s) {
  const lead = s.match(/^[\s,\/@\-–]*(?:at\s+|time\s*:?\s*|hrs\s*)?/i)[0];
  const t = s.slice(lead.length);
  let r;
  if ((r = t.match(/^(\d{1,2})[:.h](\d{2})(?!\d)\s*(am|pm|a\.m\.|p\.m\.)?(?:\s*(?:hrs?|hours|lt|local|utc|gmt|z)\b)?/i))) {
    let h = +r[1]; const mi = +r[2];
    if (r[3]) { const pm = /^p/i.test(r[3]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    if (h <= 23 && mi <= 59) return { h: h, mi: mi, len: lead.length + r[0].length };
  }
  if ((r = t.match(/^([01]\d|2[0-3])([0-5]\d)(?!\d)\s*(?:hrs?|hours|h|lt|local|utc|gmt|z|[ap]\.?m\.?(?![a-z])|(?=\s|$|[,;)]))/i))) {
    return { h: +r[1], mi: +r[2], len: lead.length + r[0].length };
  }
  // "12 noon" / "11 noon" → the NOON frame; "12 midnight" → 00:00 (checked).
  if ((r = t.match(/^(1[12])\s*(noon|mid-?day)(?![a-z])/i))) {
    return { h: _etaFrame('NOON').from, mi: 0, len: lead.length + r[0].length, low: true, win: 'NOON' };
  }
  if ((r = t.match(/^12\s*midnight(?![a-z])/i))) return { h: 0, mi: 0, len: lead.length + r[0].length, low: true };
  if ((r = t.match(/^(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)/i))) {
    let h = +r[1]; const pm = /^p/i.test(r[2]);
    if (h >= 1 && h <= 12) { if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; return { h: h, mi: 0, len: lead.length + r[0].length }; }
  }
  // ETA time frames (ETA_TIME_FRAMES): "EAM", "AM", "NOON", "PM", "LPM" and
  // their spelled-out forms → {h: frame start, win: code}, flagged for checking.
  if ((r = t.match(/^(e\.?a\.?m\.?|early\s*(?:a\.?m\.?|morning|hours|hrs)|l\.?p\.?m\.?|late\s*(?:p\.?m\.?|afternoon|evening)|evening|noon|mid-?day|a\.?m\.?|morning|forenoon|p\.?m\.?|afternoon)(?![a-z])/i))) {
    const w = r[1].toLowerCase().replace(/[.\s-]/g, '');
    const win = /^(eam|early)/.test(w) ? 'EAM' : w === 'lateafternoon' ? 'PM' : /^(lpm|late|evening)/.test(w) ? 'LPM' : /^(noon|midday)/.test(w) ? 'NOON' : /^(am|morning|forenoon)/.test(w) ? 'AM' : 'PM';
    // "PM 2000 LT", "PM/1800": the stated time wins over the frame (am/pm
    // meaning applied to a 12-hour hour), still flagged for checking.
    const rest = t.slice(r[0].length).match(/^[\s,\/@\-–]*(?:(\d{1,2})[:.h](\d{2})|([01]\d|2[0-3])([0-5]\d))(?!\d)(?:\s*(?:hrs?|hours|lt|local|utc|gmt|z)\b)?/i);
    if (rest) {
      let h = +(rest[1] || rest[3]); const mi = +(rest[2] || rest[4]);
      if (h < 12 && (win === 'PM' || win === 'LPM')) h += 12;
      if (h <= 23 && mi <= 59) return { h: h, mi: mi, len: lead.length + r[0].length + rest[0].length, low: true };
    }
    return { h: _etaFrame(win).from, mi: 0, len: lead.length + r[0].length, low: true, win: win };
  }
  // "night" / "midnight" — a part of the day, not a time: flagged for checking.
  if ((r = t.match(/^(night|midnight)(?![a-z])/i))) {
    const w = r[1].toLowerCase();
    const h = { night: 22, midnight: 0 }[w];
    return { h: h, mi: 0, len: lead.length + r[0].length, low: true };
  }
  return null;
}
function _niFmtDT(dt, tm) {
  return _niPad(dt.d) + ' ' + _NI_MO[dt.m] + ' ' + dt.y + ' ' + (tm ? _niPad(tm.h) + ':' + _niPad(tm.mi) : '00:00');
}
// Laycan at the start of s → {text: '14-16 Oct 2026', low} or null.
function _niParseLaycan(s, now) {
  let r;
  const out = function(a, b, low) {
    if (!a || !b) return null;
    const da = new Date(a.y, a.m, a.d), db = new Date(b.y, b.m, b.d);
    if (db < da) return null;
    const text = (a.m === b.m && a.y === b.y) ? a.d + '-' + b.d + ' ' + _NI_MO[a.m] + ' ' + a.y
      : a.d + ' ' + _NI_MO[a.m] + ' ' + a.y + ' - ' + b.d + ' ' + _NI_MO[b.m] + ' ' + b.y;
    return { text: text, low: !!(low || a.low || b.low), start: { y: a.y, m: a.m, d: a.d } };
  };
  const SEP = '\\s*(?:-|–|—|to|till|until|\\/|&)\\s*';
  // 14-16 Oct [2026]
  if ((r = s.match(new RegExp('^(\\d{1,2})(?:st|nd|rd|th)?' + SEP + '(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-./]*' + _NI_MON + '\\.?(?:[\\s,\'\\-./]*((?:19|20)\\d{2}|\\d{2})(?!\\d))?', 'i')))) {
    const m = _niMon(r[3]), y = _niYear(+r[1], m, r[4], now);
    return out(_niValidDate(y, m, +r[1]) ? { y: y, m: m, d: +r[1] } : null, _niValidDate(y, m, +r[2]) ? { y: y, m: m, d: +r[2] } : null);
  }
  // 14-16.10[.2026] / 14-16/10
  if ((r = s.match(/^(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{4}|\d{2}))?(?!\d)/i))) {
    const m = +r[3] - 1, y = _niYear(+r[1], m, r[4], now);
    return out(_niValidDate(y, m, +r[1]) ? { y: y, m: m, d: +r[1] } : null, _niValidDate(y, m, +r[2]) ? { y: y, m: m, d: +r[2] } : null);
  }
  // two full dates: "14 Oct - 16 Oct 2026", "30/10 - 02/11", "Oct 30 to Nov 2"
  const a = _niParseDate(s, now);
  if (a) {
    const rest = s.slice(a.len), sep = rest.match(new RegExp('^' + SEP));
    if (sep) {
      const b = _niParseDate(rest.slice(sep[0].length), now);
      if (b) {
        // "14 Oct - 16 Oct 2026": a year on the second date only applies to both
        if (b.y !== a.y && !/\d{4}/.test(s.slice(0, a.len))) { const ay = _niYear(a.d, a.m, String(b.y), now); if (_niValidDate(ay, a.m, a.d)) a.y = ay; if (new Date(a.y, a.m, a.d) > new Date(b.y, b.m, b.d)) a.y--; }
        return out(a, b);
      }
    }
    return out(a, a, true); // a single day: a one-day laycan
  }
  return null;
}

// Anchorage / berth: the Anchorage dropdown's own options, reached through synonyms.
function _niArea(text, areas) {
  const t = ' ' + String(text || '').toLowerCase().replace(/[_]/g, ' ') + ' ';
  const has = function(v) { return areas.some(function(o) { return o.value === v; }); };
  let site = null, kind = null, low = false, note = '';
  const ex = t.match(/\b(fuj|kfk)\s*-?\s*([ab])\b/);
  if (ex) { site = ex[1].toUpperCase(); kind = ex[2].toUpperCase(); }
  if (!site) {
    if (/\bkhor\s*-?\s*fak+an\b|\bkhorfak+an\b|\bkfk\b|\bkhor\b/.test(t)) site = 'KFK';
    else if (/\bfuj[ae]i?rah\b|\bfuj\b|\bfjr\b/.test(t)) site = 'FUJ';
  }
  if (/\bopl\b|outside\s+port\s+limits?/.test(t)) {
    if (!site) site = 'FUJ';
    kind = kind || 'A'; low = true; note = 'Location given as OPL';
  }
  if (!site) return null;
  if (!kind) {
    if (/\bberth\b|\bjetty\b|\bterminal\b|\balongside\b|\bwharf\b|\bquay\b|\bin\s+port\b/.test(t)) kind = 'B';
    else kind = 'A'; // anchorage is where most supplies happen; also the card default
  }
  let v = site + '-' + kind;
  if (!has(v)) { const alt = areas.find(function(o) { return o.value.indexOf(site) === 0; }); if (!alt) return null; v = alt.value; low = true; }
  return { value: v, low: low, note: note };
}

// Agent Directory match: exact, contains, or most shared words; else the raw text (flagged).
function _niAgent(raw, agents) {
  const clean = String(raw || '').split(/\s+(?:tel|ph|phone|mob|mobile|email|e-mail|contact|attn|pic)\b|\+\d|[\w.]+@|\s{2,}|\s[|\/]\s|;|,/i)[0].replace(/^[\s:\-–]+|[\s.,:\-–]+$/g, '');
  if (!clean) return null;
  if (/^(tba|tbc|tbn|tbd|n\/?a|nil|none|to\s+be\s+(?:advised|confirmed|nominated|named))\.?$/i.test(clean)) return { value: '', low: false, tbc: true };
  const STOP = /\b(the|shipping|ships?|services?|llc|l\.l\.c|fze|fzc|fzco|co|ltd|limited|agency|agencies|agents?|marine|maritime|and|&|uae|fujairah|dubai|group|international|intl)\b/g;
  const norm = function(s) { return String(s).toLowerCase().replace(STOP, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); };
  const n = norm(clean);
  let best = null, score = 0;
  (agents || []).forEach(function(name) {
    const a = norm(name);
    if (!a) return;
    let sc = 0;
    if (a === n) sc = 1;
    else if (n.length >= 3 && a.length >= 3 && (a.indexOf(n) >= 0 || n.indexOf(a) >= 0)) sc = 0.9;
    else {
      const A = a.split(' '), N = n.split(' ');
      const common = N.filter(function(w) { return w.length > 1 && A.indexOf(w) >= 0; }).length;
      sc = common / Math.max(A.length, N.length);
    }
    if (sc > score) { score = sc; best = name; }
  });
  if (best && score >= 0.5) return { value: best, low: false };
  return { value: clean.slice(0, 80), low: true };
}

/* Quantities per grade. VLSFO field: VLSFO/LSFO/0.5%/RMG; IFO/FO without a
   0.5% marker is assumed VLSFO but flagged; HSFO/3.5% is never put in the
   VLSFO field (noted instead). LSMGO field: LSMGO/MGO/DMA/MDO/gasoil. */
function _niQuantities(text) {
  let t = String(text || '')
    .replace(/(\d),(\d{3})(?!\d)/g, '$1$2')
    .replace(/\bISO\s*[-:]?\s*8217\s*[:\-\/]?\s*\(?(?:\d{4})?\)?/gi, ' ')
    .replace(/\b(\d{2,3})\s*cst\b/gi, ' ')
    .replace(/\b(RM[GEK]|IFO|HFO)\s*-?\s*(180|380|500|700)\b/gi, '$1')
    .replace(/\b0[.,]5\s*%\s*(?:s\b|sulph?ur\b|max\b)?/gi, ' VLSFO ')
    .replace(/\b0[.,]1\s*%\s*(?:s\b|sulph?ur\b|max\b)?/gi, ' LSMGO ')
    .replace(/\b3[.,]5\s*%\s*(?:s\b|sulph?ur\b|max\b)?/gi, ' HSFO ');
  const vlsLike = /\b(vlsfo|lsfo|vls\s*fo|ulsfo)\b/i.test(t);
  const GR = /\b(V\.?L\.?S\.?F\.?O\.?|ULSFO|LSFO|VLS\s*FO|HSFO|HSHFO|RM[GEK]|IFO|HFO|fuel\s*oil|FO|ULSMGO|LSMGO|LS\s*MGO|MGO|MDO|DM[AB]|LSGO|gas\s*oil|gasoil)\b/gi;
  const res = { v: null, m: null, notes: [], low: {} };
  const Q = '(\\d+(?:\\.\\d+)?)(?:\\s*(?:-|–|—|\\/|to)\\s*(\\d+(?:\\.\\d+)?))?\\s*(mts?\\b|m\\/t\\b|metric\\s+tons?\\b|tons?\\b|tonnes?\\b|t\\b|cbm\\b|m3\\b)?';
  const take = function(r, follow) {
    let a = parseFloat(r[1]), b = r[2] != null ? parseFloat(r[2]) : null;
    if (!(a > 0) || a > 20000 || (b != null && b > 20000)) return null;
    // "14/10" right after a grade is a date, not a range
    if (!r[3] && b != null && a <= 31 && b <= 12 && b < a) return null;
    if (new RegExp('^\\s*(?:st|nd|rd|th)?\\s*' + _NI_MON, 'i').test(follow) || /^\s*[:h]\d/.test(follow)) return null;
    if (b != null && b < a) { const x = a; a = b; b = x; }
    const q = { qty: b != null ? b : a, min: b != null && b !== a ? a : null, max: b != null && b !== a ? b : null, cbm: /cbm|m3/i.test(r[3] || ''), unit: !!r[3] };
    return q;
  };
  t.split(/\r?\n/).forEach(function(line) {
    const ks = [];
    let k;
    GR.lastIndex = 0;
    while ((k = GR.exec(line))) ks.push({ s: k.index, e: k.index + k[0].length, w: k[0] });
    ks.forEach(function(kw, i) {
      const isM = /mgo|mdo|dm[ab]|lsgo|gas\s*oil|gasoil/i.test(kw.w);
      const isHS = /hsfo|hshfo/i.test(kw.w);
      const after = line.slice(kw.e, i + 1 < ks.length ? ks[i + 1].s : line.length);
      let r = after.match(new RegExp('^[\\s:=\\-–—>@()]*(?:(?:qty|quantity|abt\\.?|about|approx\\.?|ca\\.?|min\\.?|max\\.?|~|\\+\\/-|±|req(?:uired)?|of)\\s*[:.]?\\s*)*' + Q, 'i'));
      let q = r ? take(r, after.slice(r[0].length)) : null;
      if (!q) {
        const before = line.slice(i > 0 ? ks[i - 1].e : 0, kw.s);
        r = before.match(new RegExp('(?:^|[^\\d.])' + Q + '\\s*(?:of\\s+)?(?:grade\\s+)?$', 'i'));
        if (r) q = take(r, '');
      }
      if (!q) return;
      const slot = isM ? 'm' : 'v';
      if (isHS) { res.notes.push('HSFO ' + (q.min != null ? q.min + '–' + q.max : q.qty) + ' MT requested — not VLSFO, check grade'); res.low.qty = 'HSFO requested'; return; }
      if (res[slot] && (res[slot].unit || !q.unit)) return; // first mention (with a unit) wins
      res[slot] = q;
      if (!isM && /^(rm[gek]|ifo|hfo|fo|fuel\s*oil)$/i.test(kw.w.replace(/\./g, '')) && !vlsLike) { res.low.qty = 'Grade given as ' + kw.w.toUpperCase() + ' — assumed VLSFO'; res.notes.push(res.low.qty); }
      if (q.cbm) { res.low[slot === 'v' ? 'qty' : 'mgo'] = 'Quantity in cbm — check MT'; res.notes.push((isM ? 'LSMGO' : 'VLSFO') + ' quantity given in cbm'); }
    });
  });
  // A quantity with no grade at all → VLSFO, flagged.
  if (!res.v && !res.m && !res.low.qty) {
    const r = t.match(new RegExp('\\b(?:qty|quantity|qtty|bunkers?)\\s*[:\\-–=]?\\s*(?:abt\\.?|about|approx\\.?)?\\s*' + Q, 'i')) ||
              t.match(new RegExp('(?:^|[^\\d.\\/])' + '(\\d+(?:\\.\\d+)?)(?:\\s*(?:-|–|—|\\/|to)\\s*(\\d+(?:\\.\\d+)?))?\\s*(mts?\\b|m\\/t\\b|tons?\\b|tonnes?\\b)', 'i'));
    const q = r ? take(r, '') : null;
    if (q) { res.v = q; res.low.qty = 'Grade not stated — assumed VLSFO'; }
  }
  return res;
}

// Vessel prefixes: MV, M/V, M.V., MT, M/T, M.T. ("MT" after a number is the unit).
const _NI_PREFIX = /(^|[^A-Za-z0-9\/])(M\s*\/\s*[VvTt]|M\.\s*[VvTt]\.?|MV|mv|Mv|MT|M\/Y|MY)\.?\s*[:\-]?\s+(?=[A-Za-z0-9])/g;
const _NI_NAME_STOP = /^(imo|mmsi|eta|etb|etd|ata|laycan|l\/c|lc|laydays|qty|quantity|vlsfo|lsfo|ulsfo|lsmgo|mgo|mdo|dma|ifo|hsfo|rmg|fo|at|for|in|on|to|from|with|via|agent|agents|fujairah|fuj|kfk|khor|opl|anchorage|berth|abt|about|approx|bunkers?|nomination|nominated|arriving|arrival|expected|grade|mt|mts|will|is|has|and|pls|please|req|requires|needs|location|port|spec|iso|eta:|dwt|flag|call|sign|loa|grt|nrt)$/i;
// Words that end a name even on a labelled line ("Name: On Peace" keeps "On").
const _NI_NAME_STOP_STRONG = /^(imo|mmsi|eta|etb|etd|ata|laycan|l\/c|laydays|qty|quantity|vlsfo|lsfo|ulsfo|lsmgo|mgo|mdo|dma|ifo|hsfo|rmg|agent|agents|location|port|spec|iso|dwt|flag|loa|grt|nrt)$/i;
function _niCleanName(raw, labelled) {
  // Names are words — tags, quotes and control characters are never part of one.
  let s = String(raw || '').replace(/<[^>]*>?/g, ' ').replace(/[<>"`\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(?:M\s*\/\s*[VT]|M\.\s*[VT]\.?|MV|MT|M\/Y)\.?\s+/i, '');
  const words = [];
  const parts = s.split(/(\s+|\/|\(|\)|,|;|\||:|\s[-–—]\s|\t)/);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p || /^\s+$/.test(p)) continue;
    if (/^(\/|\(|\)|,|;|\||:|\s[-–—]\s|\t)$/.test(p)) { if (words.length) break; else continue; }
    const w = p.replace(/[.,]+$/, '');
    if (!w) continue;
    if ((labelled ? _NI_NAME_STOP_STRONG : _NI_NAME_STOP).test(w)) break;
    if (/^\d{3,}$/.test(w) && words.length) break;     // "OCEAN STAR 500 VLSFO"
    if (!/^[A-Za-z0-9][A-Za-z0-9'&.\-]*$/.test(w)) break;
    words.push(w);
    if (words.length >= 6) break;
  }
  return words.join(' ').toUpperCase().slice(0, 60);
}
// Name from one line: "Vessel: …" label, or a prefix anywhere. → {name, low} or null.
function _niNameFromLine(line, anywhere) {
  let r = line.match(/^\s*(?:[-*•]\s*|\d+[.)]\s*)?(?:name\s+of\s+(?:the\s+)?vessel|vessel(?:'?s)?(?:\s*name)?|ship(?:'?s)?(?:\s*name)?|vsl(?:\s*name)?|m\/?v\s*name|name)\s*[:\-–=]\s*(.+)$/i);
  if (r) { const n = _niCleanName(r[1], true); if (n) return { name: n, low: false, label: true }; }
  _NI_PREFIX.lastIndex = 0;
  let m;
  while ((m = _NI_PREFIX.exec(line))) {
    const start = m.index + m[1].length;
    if (!anywhere && line.slice(0, start).replace(/^\s*(?:[-*•]\s*|\d+[.)]\s*)?/, '').trim()) break;
    const pre = line.slice(0, start);
    if (/^m\s*t$|^mt$/i.test(m[2].replace(/[\s.\/]/g, '')) && /\d\s*$|\d\s*(?:-|–|\/|to)\s*\d+\s*$/i.test(pre)) continue; // "500 MT" is a unit
    if (/^mt$/.test(m[2])) continue; // lower-case "mt" is always the unit
    const n = _niCleanName(line.slice(m.index + m[0].length));
    if (n && !_NI_NAME_STOP.test(n.split(' ')[0])) return { name: n, low: false };
  }
  return null;
}
// "IMO / MMSI: 9321483 / 636012345", "MMSI/IMO No.: 636012345, 9321483", "MMSI: 9321483 / 636012345":
// an IMO and/or MMSI label, then two 7- or 9-digit numbers split by / , ; & + "and" "or".
const _NI_ID_NUM = '(\\d{3}[ .\\-]?\\d{3}[ .\\-]?\\d{3}|\\d{3}[ .\\-]?\\d{4})(?![\\d])';
const _NI_ID_PAIR = new RegExp('\\b(?:IMO|MMSI)(?![A-Za-z])\\s*(?:no\\.?|nr\\.?|number|#)?(?:\\s*(?:\\/|&|\\+|,|and|or)\\s*(?:IMO|MMSI)(?![A-Za-z])\\s*(?:nos?\\.?|nr\\.?|numbers?|#)?)?\\s*[:\\-–=.]?\\s*' +
  _NI_ID_NUM + '\\s*(?:\\/|,|;|&|\\+|\\band\\b|\\bor\\b)\\s*' + _NI_ID_NUM, 'i');
// ALL-CAPS line that's just a name (no prefix) — the last resort, flagged.
const _NI_NOT_NAME = /\b(NOMINATION|NOMINATIONS|BUNKER|BUNKERS|DEAR|REGARDS|THANKS|FUJAIRAH|KHOR|FAKKAN|ANCHORAGE|BERTH|VLSFO|LSFO|LSMGO|MGO|ETA|LAYCAN|AGENT|AGENTS|ATTN|URGENT|IMPORTANT|NOTE|REMARKS|SUBJECT|CONFIRMED|CANCELLED|AMENDED|REVISED|UPDATE|DETAILS|QUANTITY|SPEC|ISO|LOCATION|TO|CC|FROM|BEST|OPS|OPERATIONS|TEAM|ALL|PLS|PLEASE|KINDLY|GOOD|DAY|MORNING|HI|HELLO)\b/;
function _niCapsName(lines) {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^[A-Z][A-Z0-9 .'\-&]{2,40}$/.test(l) && l.split(/\s+/).length <= 5 && !_NI_NOT_NAME.test(l) && /[A-Z]{3,}/.test(l)) {
      const n = _niCleanName(l);
      if (n) return { name: n, low: true, line: i };
    }
  }
  return null;
}

const _NI_ETA_LBL = /\b(?:ETA\/?ETB|E\.?T\.?A\.?|ETB|ETA|arriv(?:al|ing|es)|expected(?:\s+(?:on|at|arrival))?|date\s+of\s+(?:arrival|supply|delivery)|supply\s+date|delivery\s+date|del\.?\s*date)\b\.?(?:\s*(?:fuj(?:airah)?|kfk|khor\s*fakkan|opl|anchorage|on|at|is|abt|about|approx))*\s*[:\-–=]?\s*/i;
const _NI_LC_LBL = /\b(?:lay\s*can|l\s*\/\s*c|lay\s*days|laydays|lc\s*:|delivery\s+(?:window|dates?|range)|supply\s+(?:window|range)|window|(?:supply\s+|delivery\s+|fixture\s+)?dates(?=\s*[:\-–=]))\b\s*[:\-–=]?\s*/i;
const _NI_BOILER = /^(dear|hi\b|hello|good\s+(day|morning|afternoon|evening)|greetings|pls\s+(find|note|see)|please\s+(find|note|see|be\s+advised|nominate|arrange|confirm)|kindly|thanks|thank\s+you|many\s+thanks|regards|best|br\b|rgds|brgds|sent\s+from|from\s*:|to\s*:|cc\s*:|subject\s*:|re\s*:|fw\s*:|fwd\s*:|date\s*:|sincerely|tel\b|tel\s*:|mob|phone|email|e-mail|www\.|https?:|on\s+behalf|as\s+agents?\s+only|bunker\s+nomination|nomination\b|new\s+nomination|we\s+(are\s+pleased|confirm)|following|below)/i;

function _niParseBlock(text, opts, ctx) {
  const now = opts.now, lines = String(text).split(/\r?\n/);
  const d = { name: '', imo: '', mmsi: '', eta: '', etaWin: '', lc: '', type: 'VLSFO', qty: 0, qtyMin: null, qtyMax: null, mgo: 0, mgoMin: null, mgoMax: null,
              area: '', agent: '', spec: '', remarks: '', low: {}, src: String(text).trim() };
  const used = {};          // line index → consumed by a field
  const notes = [];
  // ── name
  let nm = null;
  for (let i = 0; i < lines.length && !nm; i++) { nm = _niNameFromLine(lines[i], false); if (nm) { nm.line = i; } }
  for (let i = 0; i < lines.length && !nm; i++) { nm = _niNameFromLine(lines[i], true); if (nm) { nm.line = i; } }
  if (!nm) nm = _niCapsName(lines);
  if (nm) { d.name = nm.name; if (nm.low) d.low.name = 'Guessed from an all-caps line'; used[nm.line] = 1; }
  // ── IMO + MMSI given together: "IMO / MMSI: 9321483 / 636012345", "MMSI/IMO 636012345, 9321483",
  //    or two numbers after one label (an "IMO/MMSI" table column becomes "MMSI: …"). Each number
  //    goes by its length — 7 digits = IMO, 9 digits = MMSI; a second IMO / MMSI is flagged.
  let r = text.match(_NI_ID_PAIR);
  if (r) {
    const extra = [];
    [r[1], r[2]].forEach(function(raw) {
      const n = raw.replace(/[\s.\-]/g, '');
      if (n.length === 7 && !d.imo) { d.imo = n; if (!_imoValid(n)) d.low.imo = 'IMO check digit does not match'; }
      else if (n.length === 9 && !d.mmsi) { d.mmsi = n; if (!_mmsiValid(n)) d.low.mmsi = 'MMSI must be 9 digits starting 2–7'; }
      else extra.push(n);
    });
    extra.forEach(function(n) { const k = n.length === 7 ? 'imo' : 'mmsi'; d.low[k] = 'Two ' + (k === 'imo' ? 'IMO numbers' : 'MMSIs') + ' given — ' + n + ' not used, check which is right'; });
  }
  // ── MMSI ("MMSI: 636012345", "MMSI No. 636012345", "MMSI 636 012 345")
  r = d.mmsi ? null : text.match(/\bMMSI\s*(?:no\.?|nr\.?|number|#)?\s*[:\-–=.]?\s*(\d{3}[ ]?\d{3}[ ]?\d{3}|\d{5,12})(?![\d])/i);
  if (r) { d.mmsi = r[1].replace(/\s/g, ''); if (!_mmsiValid(d.mmsi)) d.low.mmsi = 'MMSI must be 9 digits starting 2–7'; }
  // ── IMO ("IMO 9321483", "IMO No: 9321483", "IMO: 9321483")
  r = d.imo ? null : text.match(/\bIMO\s*(?:no\.?|nr\.?|number|#)?\s*[:\-–=.]?\s*(\d{7})\b/i);
  const r9 = (r || d.imo) ? null : text.match(/\bIMO\s*(?:no\.?|nr\.?|number|#)?\s*[:\-–=.]?\s*(\d{9})\b/i);
  if (d.imo) { /* from an IMO / MMSI pair above */ }
  else if (r) { d.imo = r[1]; if (!_imoValid(r[1])) d.low.imo = 'IMO check digit does not match'; }
  else if (r9 && !d.mmsi) { d.mmsi = r9[1]; d.low.mmsi = '9 digits given as "IMO" — taken as the MMSI' + (_mmsiValid(r9[1]) ? '' : ' (must start 2–7)'); }
  else {
    const all = String(text).match(/(?:^|[^\d\/.\-+])(\d{7})(?![\d\/.\-])/g) || [];
    const ok = all.map(function(x) { return x.replace(/\D/g, ''); }).filter(_imoValid);
    if (ok.length) d.imo = ok[0];
  }
  // 7 digits given as "MMSI" (e.g. one "IMO / MMSI" column): the IMO number — as on the card.
  if (/^\d{7}$/.test(d.mmsi) && (!d.imo || d.imo === d.mmsi)) {
    if (!d.imo) { d.imo = d.mmsi; if (_imoValid(d.imo)) delete d.low.imo; else d.low.imo = 'IMO check digit does not match'; }
    d.mmsi = ''; delete d.low.mmsi;
  }
  lines.forEach(function(l, i) { if (/\b(?:IMO|MMSI)\b/i.test(l) && i !== nm?.line) used[i] = used[i] || 2; });
  // ── ETA / laycan (labelled)
  lines.forEach(function(l, i) {
    let m = l.match(_NI_LC_LBL);
    if (m && !d.lc) {
      const lc = _niParseLaycan(l.slice(m.index + m[0].length), now);
      if (lc) { d.lc = lc.text; d._lcStart = lc.start; if (lc.low) d.low.lc = 'Month or year guessed'; used[i] = 1; }
    }
    m = l.match(_NI_ETA_LBL);
    if (m && !d.eta) {
      const rest = l.slice(m.index + m[0].length);
      if (/^\s*(tba|tbc|tbn|n\/a|unknown)\b/i.test(rest)) { used[i] = 1; return; }
      const lc = new RegExp('^\\d{1,2}(?:st|nd|rd|th)?\\s*(?:-|–|—|to)\\s*\\d{1,2}(?:st|nd|rd|th)?\\b').test(rest) ? _niParseLaycan(rest, now) : null;
      if (lc && lc.text.indexOf('-') > 0 && !d.lc) { d.lc = lc.text; d._lcStart = lc.start; d.low.lc = 'ETA given as a range — used as laycan'; used[i] = 1; return; }
      const dt = _niParseDate(rest, now);
      if (dt) {
        const tm = dt.time || _niParseTime(rest.slice(dt.len));
        d.eta = _niFmtDT(dt, tm);
        if (tm && tm.win) { d.etaWin = tm.win; d.low.eta = (dt.low ? 'Month guessed · ' : '') + 'ETA time frame ' + _etaFrameTxt(tm.win) + ' — planned from its start'; }
        else if (dt.low || (tm && tm.low)) d.low.eta = 'Month or time guessed';
        else if (!tm) d.low.eta = 'No time given — set as no firm ETA (00:00)';
        used[i] = 1;
      }
    }
  });
  // ── unlabelled date (WhatsApp one-liners): first date in the text → ETA
  if (!d.eta && !d.lc) {
    for (let i = 0; i < lines.length && !d.eta; i++) {
      const l = lines[i];
      const re = new RegExp('(?:^|[\\s(,])(?=\\d{1,2}(?:st|nd|rd|th)?[\\s\\-./]*' + _NI_MON + '|\\d{1,2}[\\/.]\\d{1,2}(?:[\\/.]\\d{2,4})?(?![\\d\\/.])|' + _NI_MON + '\\.?\\s*\\d{1,2}\\b|\\d{4}-\\d{2}-\\d{2})', 'gi');
      let m;
      while ((m = re.exec(l)) && !d.eta) {
        // A match at the start of the line is zero-width: step past it, or a
        // rejected token there ("0.5% VLSFO…", "31/02") is matched forever.
        if (!m[0]) re.lastIndex++;
        const pos = m.index + m[0].length, rest = l.slice(pos);
        const pre = l.slice(0, pos);
        if (/\d\s*$/.test(pre) || /(?:vlsfo|lsmgo|mgo|qty)\s*[:\-]?\s*$/i.test(pre)) continue;
        // "on 6/7/8" (a list of days) and "6/7/8/9" are not dates.
        if (/^\d{1,2}\/\d{1,2}\/\d(?!\d)|^\d{1,2}(?:\/\d{1,2}){3,}/.test(rest)) continue;
        const dt = _niParseDate(rest, now);
        if (!dt) continue;
        const tm = dt.time || _niParseTime(rest.slice(dt.len));
        d.eta = _niFmtDT(dt, tm);
        if (tm && tm.win) d.etaWin = tm.win;
        d.low.eta = 'Date found without an "ETA" label' + (tm && tm.win ? ' · time frame ' + _etaFrameTxt(tm.win) : '');
      }
    }
  }
  // Only dates/laycan given (common in trader fixtures): plan from the first day.
  if (!d.eta && d._lcStart) { d.eta = _niFmtDT(d._lcStart, null); d.low.eta = 'No ETA given — set to the first laycan day, please check'; }
  delete d._lcStart;
  // ── quantities
  const q = _niQuantities(text);
  if (q.v) { d.qty = q.v.qty; d.qtyMin = q.v.min; d.qtyMax = q.v.max; }
  if (q.m) { d.mgo = q.m.qty; d.mgoMin = q.m.min; d.mgoMax = q.m.max; }
  Object.keys(q.low).forEach(function(k) { d.low[k] = q.low[k]; });
  q.notes.forEach(function(n) { notes.push(n); });
  d.type = d.qty > 0 && d.mgo > 0 ? 'BOTH' : (d.mgo > 0 ? 'MGO' : 'VLSFO');
  if (!q.v && !q.m && !d.low.qty) d.low.qty = 'No quantity found';
  // ── location
  let ar = null;
  lines.forEach(function(l, i) {
    const m = l.match(/^\s*(?:location|port|place|area|anchorage|supply\s+(?:location|port)|delivery\s+(?:location|port|place)|loc)\s*[:\-–=]\s*(.+)$/i);
    if (m && !ar) { ar = _niArea(m[1], opts.areas); if (ar) used[i] = 1; }
  });
  if (!ar) ar = _niArea(text, opts.areas);
  if (!ar && ctx && ctx.area) ar = ctx.area;
  if (ar) { d.area = ar.value; if (ar.low) d.low.area = ar.note || 'Check location'; if (ar.note) notes.push(ar.note); }
  else { d.area = (opts.areas[0] && opts.areas[0].value) || ''; d.low.area = 'No location found — default used'; }
  // ── agent
  let ag = null;
  lines.forEach(function(l, i) { if (!ag) { ag = _niAgentIn(l, opts); if (ag && /^\s*(?:local\s+)?(?:agents?|agency)/i.test(l)) used[i] = 1; } });
  if (!ag && ctx && ctx.agent) ag = ctx.agent;
  if (ag) { d.agent = ag.value; if (ag.tbc) notes.push('Agent TBC'); else if (ag.low) d.low.agent = 'Not in the Agent Directory'; }
  // ── spec
  r = text.match(/\bISO\s*[-:]?\s*8217\s*[:\-\/]?\s*\(?(\d{4})\)?|\b8217\s*[:\-\/]\s*(\d{4})\b|\bISO\s*(20\d\d)\b|\b(20(?:10|17))\s*specs?\b/i);
  const yr = r ? (r[1] || r[2] || r[3] || r[4]) : (ctx && ctx.specYear);
  if (yr) {
    const want = 'ISO 8217:' + yr;
    if (opts.specs.indexOf(want) >= 0) d.spec = want;
    else { d.spec = +yr < 2017 ? opts.specs[0] : opts.specs[opts.specs.length - 1]; d.low.spec = want + ' requested — not a listed spec'; notes.push(want + ' requested'); }
  } else d.spec = opts.specs[0] || '';
  // ── remarks: a labelled line, plus leftover lines that say something
  const FIELD = new RegExp('\\b(?:imo|mmsi|eta|etb|laycan|l\\/c|qty|quantity|vlsfo|lsfo|lsmgo|mgo|mdo|dma|ifo|hsfo|gas\\s*oil|agents?|location|anchorage|berth|fujairah|khor\\s*fakkan|kfk|opl|iso\\s*8217|spec)\\b', 'i');
  const rem = [];
  let signedOff = false;
  lines.forEach(function(l, i) {
    const t = l.trim();
    if (!t || signedOff) return;
    if (/^(regards|best\s+regards|br\b|rgds|brgds|thanks|thank\s+you|many\s+thanks|sincerely|cheers)/i.test(t)) { signedOff = true; return; }
    const m = t.match(/^(?:remarks?|rmks?|notes?|comments?|special\s+(?:instructions?|requests?))\s*[:\-–=]\s*(.+)$/i);
    if (m) { rem.push(m[1].trim()); return; }
    const acc = t.match(/^(?:acc(?:ount)?|a\/c|buyer|customer|client|charterers?)\s*[:\-–=]\s*(.+)$/i);
    if (acc) { rem.unshift('Account: ' + acc[1].trim()); return; }
    if (/^[^:]{2,40}:\s*$/.test(t)) return; // a heading such as "Fixture details:" 
    if (used[i] || FIELD.test(t) || _NI_BOILER.test(t) || (nm && nm.line === i)) return;
    if (t.replace(/[^A-Za-z]/g, '').length < 4) return;
    rem.push(t);
  });
  d.remarks = rem.concat(notes).map(function(s) { return s.replace(/[\u0000-\u001f]/g, ' ').slice(0, 160); }).slice(0, 5).join(' · ');
  if (!d.name) d.low.name = 'No vessel name found';
  if (!d.eta && !d.lc) d.low.eta = 'No ETA or laycan found';
  return d;
}

/* Tables pasted from Excel / Word (tab- or |-separated, with a header row):
   each data row is rewritten as labelled lines and parsed like any block. */
const _NI_COLS = [
  ['name', /vessel|ship|^name$|vsl|^m\/?v$/i], ['mmsi', /mmsi/i], ['imo', /imo/i], ['lc', /lay\s*can|l\/c|window|lay\s*days/i],
  ['eta', /eta|etb|arriv|^date|supply\s*date/i], ['mgo', /mgo|dma|gas\s*oil|gasoil|mdo|lsgo/i],
  ['vlsfo', /vlsfo|lsfo|0\.5|^fo\b|ifo|fuel|rmg/i], ['qty', /qty|quantity|amount/i], ['grade', /grade|product|type/i],
  ['area', /location|port|anch|area|place|berth/i], ['agent', /agent|agency/i], ['spec', /spec|iso/i], ['remarks', /remark|note|comment/i]
];
function _niTable(text) {
  const lines = String(text).split(/\r?\n/);
  const splitRow = function(l) {
    if (l.indexOf('\t') >= 0) return l.split('\t').map(function(c) { return c.trim(); });
    if ((l.match(/\|/g) || []).length >= 2) return l.replace(/^\s*\||\|\s*$/g, '').split('|').map(function(c) { return c.trim(); });
    return null;
  };
  for (let h = 0; h < lines.length; h++) {
    const cells = splitRow(lines[h]);
    if (!cells || cells.length < 3) continue;
    const map = {};
    cells.forEach(function(c, ci) {
      for (let k = 0; k < _NI_COLS.length; k++) {
        if (_NI_COLS[k][1].test(c) && map[_NI_COLS[k][0]] == null) { map[_NI_COLS[k][0]] = ci; break; }
      }
    });
    if (map.name == null || Object.keys(map).length < 3) continue;
    const rows = [], outside = lines.slice(0, h);
    for (let i = h + 1; i < lines.length; i++) {
      const rc = splitRow(lines[i]);
      if (!rc) { if (lines[i].trim()) outside.push(lines[i]); continue; }
      if (rc.every(function(c) { return /^[\s\-:|=]*$/.test(c); })) continue; // markdown --- row
      const g = function(k) { return map[k] != null ? (rc[map[k]] || '') : ''; };
      if (!g('name')) continue;
      const out = ['Vessel: ' + g('name').replace(/^(?:M\s*\/\s*[VT]|M\.\s*[VT]\.?|MV|MT)\.?\s+/i, '')];
      if (g('imo')) out.push('IMO: ' + g('imo'));
      if (g('mmsi')) out.push('MMSI: ' + g('mmsi'));
      if (g('eta')) out.push('ETA: ' + g('eta'));
      if (g('lc')) out.push('Laycan: ' + g('lc'));
      if (g('vlsfo')) out.push('VLSFO: ' + g('vlsfo'));
      if (g('mgo')) out.push('LSMGO: ' + g('mgo'));
      if (g('qty')) out.push((g('grade') || 'Qty') + ': ' + g('qty'));
      if (g('area')) out.push('Location: ' + g('area'));
      if (g('agent')) out.push('Agent: ' + g('agent'));
      if (g('spec')) out.push('Spec: ISO ' + g('spec').replace(/^\s*iso\s*/i, ''));
      if (g('remarks')) out.push('Remarks: ' + g('remarks'));
      rows.push({ text: out.join('\n'), src: lines[i] });
    }
    if (rows.length) return { rows: rows, outside: outside.join('\n') };
  }
  return null;
}

// "Agent: X" anywhere in a line; "agent X" (no colon) only when X is in the directory.
function _niAgentIn(line, opts) {
  const m = String(line).match(/(?:^|[\s,;|(])(?:local\s+)?(?:agents?|agency|ship\s*agents?)(?:\s+details)?(\s*[:\-–=]\s*|\s+(?:is\s+)?)(.+)$/i);
  if (!m) return null;
  const a = _niAgent(m[2], opts.agents);
  return a && (/[:\-–=]/.test(m[1]) || !a.low) ? a : null;
}
// Context shared by every vessel in a paste (lines before the first vessel).
function _niContext(text, opts) {
  if (!String(text || '').trim()) return {};
  const ctx = {};
  const ar = _niArea(text, opts.areas);
  if (ar) ctx.area = ar;
  String(text).split('\n').forEach(function(l) { if (!ctx.agent) { const a = _niAgentIn(l, opts); if (a) ctx.agent = a; } });
  const s = String(text).match(/8217\s*[:\-\/]?\s*\(?(\d{4})/);
  if (s) ctx.specYear = s[1];
  return ctx;
}

function _parseNominationText(text, opts) {
  opts = Object.assign({}, opts || {});
  opts.now = opts.now instanceof Date ? opts.now : new Date();
  if (!opts.areas) opts.areas = (typeof AREA_OPTIONS !== 'undefined') ? AREA_OPTIONS : [{ value: 'FUJ-A' }, { value: 'FUJ-B' }, { value: 'KFK-A' }, { value: 'KFK-B' }];
  if (!opts.agents) opts.agents = (typeof _activeAgents === 'function') ? _activeAgents().map(function(a) { return a.name; }).filter(Boolean) : [];
  if (!opts.specs) opts.specs = ['ISO 8217:2010', 'ISO 8217:2017'];
  const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/[\u00a0\u2007\u202f]/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  if (!src.trim()) return [];
  // 1) a table with a header row
  const tb = _niTable(src);
  if (tb) {
    const ctx = _niContext(tb.outside, opts);
    return tb.rows.map(function(r) { const dd = _niParseBlock(r.text, opts, ctx); dd.src = r.src.trim(); return dd; });
  }
  // 2) split at lines that start a new vessel ("Vessel: …", "MV …", "2) MT …")
  const lines = src.split('\n');
  const starts = [];
  let lastName = null;
  lines.forEach(function(l, i) {
    const n = _niNameFromLine(l, false);
    if (n && n.name !== lastName) { starts.push(i); lastName = n.name; }
  });
  let blocks = [];
  if (starts.length >= 2) {
    // lines just above a vessel line that belong to it (blank-line separated) stay with it
    const head = lines.slice(0, starts[0]).join('\n');
    starts.forEach(function(s, k) { blocks.push(lines.slice(s, k + 1 < starts.length ? starts[k + 1] : lines.length).join('\n')); });
    const ctx = _niContext(head, opts);
    return blocks.map(function(b) { return _niParseBlock(b, opts, ctx); });
  }
  // 3) blank-line separated paragraphs, each naming its own vessel
  const paras = src.split(/\n\s*\n/).filter(function(p) { return p.trim(); });
  const named = paras.map(function(p) { return p.split('\n').map(function(l) { return _niNameFromLine(l, true); }).filter(Boolean)[0] || null; });
  const distinct = named.filter(Boolean).map(function(n) { return n.name; }).filter(function(n, i, a) { return a.indexOf(n) === i; });
  if (distinct.length >= 2) {
    let head = [], cur = null;
    paras.forEach(function(p, i) {
      if (named[i] && (!cur || named[i].name !== cur.name)) { cur = { name: named[i].name, text: p }; blocks.push(cur); }
      else if (cur) cur.text += '\n\n' + p;
      else head.push(p);
    });
    const ctx = _niContext(head.join('\n'), opts);
    return blocks.map(function(b) { return _niParseBlock(b.text, opts, ctx); });
  }
  // 4) one nomination
  return [_niParseBlock(src, opts, null)];
}

