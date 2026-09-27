// Highlighter for client-side "####" debug markers.
//
// Unlike the server-side SI.Biz.Core, these come from the 360 Client for
// Windows (Office/VSTO add-ins — Word2007, Outlook, etc.), a much older,
// hand-instrumented codebase. Developers prefixed ad-hoc debug prints with
// "####" to make them easy to grep out of noisy client logs, e.g. the
// SI.Biz.Core.ClientAccess.Client auth/challenge-logon dialog flow:
//   #### Connect before dialog (14)
//   #### FormLoad (14) Uri: https://…/logon.ashx and handle ready: True
//   #### DocumentCompleted - 3 (14) LogonResponse: /user@domain
//   #### FormClosing (14) Reason: UserClosing LogonResponse: /user@domain
// There's no strict grammar — just a marker, a short phase description, an
// optional "(id)" correlating one dialog session's steps, and zero or more
// loose "Label: value" pairs — so this highlights structurally rather than
// fully parsing it.

const MARKER_RE = /^\s*(#{3,})\s*/;

export function looksLikeClientMarker(message) {
  return MARKER_RE.test(message);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const TOKEN_RE = /(\(\d+\))|\b([A-Z][A-Za-z0-9_]*):(?=\s|$)/g;

export function highlightClientMarker(message) {
  const m = message.match(MARKER_RE);
  const marker = m[1];
  const rest = message.slice(m[0].length);

  let out = `<span class="text-violet-400 font-semibold">${escapeHtml(marker)}</span> `;
  let lastIndex = 0;
  let tm;
  TOKEN_RE.lastIndex = 0;
  while ((tm = TOKEN_RE.exec(rest)) !== null) {
    out += escapeHtml(rest.slice(lastIndex, tm.index));
    lastIndex = TOKEN_RE.lastIndex;
    if (tm[1]) {
      out += `<span class="text-sky-300">${escapeHtml(tm[1])}</span>`;
    } else {
      out += `<span class="text-emerald-300 font-semibold">${escapeHtml(tm[2])}:</span>`;
    }
  }
  out += escapeHtml(rest.slice(lastIndex));
  return out;
}

export function clientMarkerBadge() {
  return `<span class="px-1 py-0.5 rounded text-[10px] font-mono bg-violet-900 text-violet-300" title="Client-side (VSTO Office add-in) debug trace marker">####</span>`;
}
