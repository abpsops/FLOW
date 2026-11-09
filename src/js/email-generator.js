/* ═══ EMAIL GENERATOR — Built-in templates per location ═══ */
var _emailVesselCtx = null;
var _emailFileName = ''; // the .eml name when the dialog is not a vessel's calling instructions (e.g. the Voyage Schedule)

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
'NOMINATED QUANTITY - {{QTY_LINE}}',
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
'NOMINATED QUANTITY - {{QTY_LINE}}',
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
  // Build the quantity line to match how it's actually written by hand:
  // only the grade(s) genuinely nominated appear at all — no dangling
  // "/ — MT LSMGO" when a vessel only takes VLSFO (or vice versa).
  var qtyParts = [];
  if (v > 0) qtyParts.push((ctx.vlsfoTxt || v.toLocaleString()) + ' MT LSFO');
  if (m > 0) qtyParts.push((ctx.lsmgoTxt || m.toLocaleString()) + ' MT LSMGO');
  var qtyLine = qtyParts.length ? qtyParts.join(' / ') : '—';
  return tpl
    .split('{{AGENT}}').join(ctx.agent || '')
    .split('{{LOCATION}}').join(ctx.location || '')
    .split('{{LAYCAN}}').join(ctx.laycan || '')
    .split('{{QTY_LINE}}').join(qtyLine)
    .split('{{VLSFO_QTY}}').join(v > 0 ? v.toLocaleString() : '—')
    .split('{{MGO_QTY}}').join(m > 0 ? m.toLocaleString() : '—')
    .split('{{VESSEL_NAME}}').join(ctx.vessel || '')
    .split('{{IMO}}').join(ctx.imo || '')
    .split('{{MMSI}}').join(ctx.mmsi || '');
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

  // Bold NOMINATED DATE / NOMINATED QUANTITY lines — always plain black,
  // never the blue block color, even though they now sit inside the blue
  // range (between the intro paragraph and "Attached is..."). These are
  // the two administrative data lines the manual template keeps visually
  // distinct from the surrounding instructional text.
  if (/^NOMINATED (DATE OF SUPPLY|QUANTITY)/i.test(trimmed)) {
    return '<strong style="font-weight:700;color:#000000">' + escHtml(line) + '</strong>';
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
  // tinted 10% toward white. Applies to the whole informational body — from
  // the "We are nominated bunker supplier…" intro paragraph through the
  // last "d) In case berthing not on arrival…" line — matching the manual
  // template exactly. The ATTN header block and the two bold NOMINATED
  // lines stay outside this range (and outside the color) either way, by
  // virtue of coming before the intro paragraph / being caught by their
  // own bold-black branches in _emailLineToHtml.
  var COLOR_BLOCK_START = /^We are nominated bunker supplier/i;
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
  var vqP = _parseQtyInput(vlsfoEl && vlsfoEl.value), mqP = _parseQtyInput(mgoEl && mgoEl.value);
  var vlsfoQty = type === 'MGO'   ? 0 : vqP.qty;
  var lsmgoQty = type === 'VLSFO' ? 0 : mqP.qty;
  var area     = areaEl  ? areaEl.value  : '';
  var location = ciAreaLabel(area);
  var laycan   = ciLaycanStr(lcEl ? lcEl.value : '');
  var agent    = agentEl ? agentEl.value : '';
  var vids     = _cardIds(vid);

  _emailFileName = '';
  _emailVesselCtx = { id:vid, vessel:vessel, type:type, vlsfoQty:vlsfoQty, lsmgoQty:lsmgoQty, vlsfoTxt:_qtyShow(vqP), lsmgoTxt:_qtyShow(mqP),
    area:area, location:location, laycan:laycan, agent:agent, imo:vids.imo.trim(), mmsi:vids.mmsi.trim() };
  // No valid IMO / MMSI: a warning, the e-mail is still generated.
  _vidWarnCard(vid, 'the e-mail is generated without it.');

  // Look up the typed/selected agent against the Agent Directory (case-insensitive,
  // trimmed match) so the mailto "To" field is pre-filled automatically. If the agent
  // isn't in the directory yet, leave To blank for manual entry — nothing else changes.
  var toEmails = '', toNote = '';
  if (agent && agent.trim()) {
    if (!_agents || !_agents.length) _loadAgents();
    var aKey = agent.trim().toLowerCase();
    var matchedAgent = _activeAgents().find(function(x){ return (x.name||'').trim().toLowerCase() === aKey; });
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
  _emailRawHtml = null;
  document.getElementById('em-output-html').innerHTML = _emailBodyToHtml(body);
  document.getElementById('em-modal-error').style.display = 'none';
  document.getElementById('em-modal').style.display = 'flex';
}

function _emailSyncPreview() {
  document.getElementById('em-output-html').innerHTML = _emailRebuildFormatted();
}

function emailCloseModal() {
  _emailRawHtml = null;
  document.getElementById('em-modal').style.display = 'none';
  _emailVesselCtx = null;
  _emailFileName = '';
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
    'X-Unsent: 1\r\n' + // Outlook opens the file as a new, editable message instead of a received one
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
  var vesselName = (_emailVesselCtx && _emailVesselCtx.vessel) ? _emailVesselCtx.vessel.replace(/[^A-Za-z0-9]+/g, '_') : 'Email';
  // Only claim "downloaded" when the save actually worked (it can fail in the app).
  _flowSaveOrShareBlob(blob, _emailFileName || (vesselName + '_Calling_Instructions.eml')).then(function(ok) {
    if (ok) _emailShowEmlReminder();
  });
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
