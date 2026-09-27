// Highlighter for the custom "si-pdx://" protocol-handler URIs logged by the
// VSTO client (mscorlib / AsyncVoidMethodBuilder.Start): this is the URI
// Windows hands to the 360 client when a file is opened for edit — e.g. a Word
// document produced from a P360 template — so it can check the file out from
// (and back into) the File Center. Logged as a single line:
//   Arguments received: si-pdx://si.px360.file/checkin?fileId=921593&comment=&vxtoken=…&endpoint=https%3A%2F%2F…&jobid=

const URI_RE = /\b(si-[a-z0-9-]+):\/\/(\S+)/i;
const LONG_VALUE_THRESHOLD = 40;

export function splitProtocolUri(message) {
  const m = message.match(URI_RE);
  if (!m) return null;
  const start = m.index;
  const end = start + m[0].length;
  return {
    prefix: message.slice(0, start),
    scheme: m[1],
    rest: m[2],
    suffix: message.slice(end),
  };
}

function parsePathAndQuery(rest) {
  const qIdx = rest.indexOf('?');
  const pathPart = qIdx === -1 ? rest : rest.slice(0, qIdx);
  const queryPart = qIdx === -1 ? '' : rest.slice(qIdx + 1);
  const segments = pathPart.split('/');
  const action = segments.length > 1 ? segments.pop() : null;
  const target = segments.join('/');

  const params = queryPart
    ? queryPart.split('&').map((pair) => {
        const eq = pair.indexOf('=');
        const key = eq === -1 ? pair : pair.slice(0, eq);
        const rawValue = eq === -1 ? '' : pair.slice(eq + 1);
        let decoded = rawValue;
        try {
          decoded = decodeURIComponent(rawValue);
        } catch {
          // leave as raw if it's not validly percent-encoded
        }
        return { key, value: decoded };
      })
    : [];

  return { target, action, params };
}

export function extractUriAction(rest) {
  return parsePathAndQuery(rest).action || '?';
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function highlightProtocolUri(scheme, rest) {
  const { target, action, params } = parsePathAndQuery(rest);

  let out = `<span class="text-violet-400 font-semibold">${escapeHtml(scheme)}</span><span class="text-gray-500">://</span>`;
  out += `<span class="text-sky-300">${escapeHtml(target)}</span>`;
  if (action) out += `<span class="text-gray-500">/</span><span class="text-amber-300 font-semibold">${escapeHtml(action)}</span>`;

  if (params.length) {
    out += `<span class="text-gray-500">?</span>`;
    out += params
      .map(({ key, value }) => {
        const shown = value.length > LONG_VALUE_THRESHOLD
          ? `<span class="text-orange-300" title="${escapeHtml(value)}">${escapeHtml(value.slice(0, LONG_VALUE_THRESHOLD))}…</span><span class="text-gray-600"> (${value.length} chars)</span>`
          : `<span class="text-orange-300">${escapeHtml(value)}</span>`;
        return `<span class="text-emerald-300">${escapeHtml(key)}</span><span class="text-gray-500">=</span>${shown}`;
      })
      .join('<span class="text-gray-500">&amp;</span>');
  }
  return out;
}

export function protocolUriBadge(action) {
  return `<span class="px-1 py-0.5 rounded text-[10px] font-mono bg-cyan-900 text-cyan-300">FILE CENTER: ${escapeHtml(action.toUpperCase())}</span>`;
}
