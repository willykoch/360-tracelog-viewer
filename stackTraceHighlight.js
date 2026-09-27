// Highlighter for .NET-style exception stack traces embedded in trace messages,
// e.g.:
//   ModifyOverflowPolicy failed! with System.Security.SecurityException: Requested registry access is not allowed.
//      at System.ThrowHelper.ThrowSecurityException(ExceptionResource resource)
//      at Microsoft.Win32.RegistryKey.OpenSubKey(String name, Boolean writable)
//   The Zone of the assembly that failed was:
//   MyComputer

const STACK_FRAME_RE = /^(\s*)at\s+(.+)$/;
const SEPARATOR_RE = /^---.*---$/;
const FRAME_DETAIL_RE = /^(.+?)\(([^)]*)\)(?:\s+in\s+(.+):line\s+(\d+))?\s*$/;
const EXCEPTION_TYPE_RE = /\b((?:[A-Za-z_][\w]*\.)+[A-Za-z_]\w*Exception)\b/;

export function looksLikeStackTrace(message) {
  return /(^|\r?\n)\s*at\s+\S/.test(message);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function highlightFrame(indent, rest) {
  const m = rest.match(FRAME_DETAIL_RE);
  if (!m) {
    return `${escapeHtml(indent)}<span class="text-gray-500">at</span> ${escapeHtml(rest)}`;
  }
  const [, methodPath, params, file, lineNo] = m;
  const lastDot = methodPath.lastIndexOf('.');
  const nsHtml = lastDot === -1
    ? ''
    : `<span class="text-gray-400">${escapeHtml(methodPath.slice(0, lastDot + 1))}</span>`;
  const methodName = lastDot === -1 ? methodPath : methodPath.slice(lastDot + 1);
  const methodHtml = `<span class="text-sky-300 font-semibold">${escapeHtml(methodName)}</span>`;
  const paramsHtml = params ? `<span class="text-amber-200">${escapeHtml(params)}</span>` : '';
  const locationHtml = file
    ? ` <span class="text-gray-500">in</span> <span class="text-gray-400 italic">${escapeHtml(file)}</span><span class="text-gray-500">:line</span> <span class="text-sky-300">${escapeHtml(lineNo)}</span>`
    : '';

  return `${escapeHtml(indent)}<span class="text-gray-500">at</span> ${nsHtml}${methodHtml}<span class="text-gray-500">(</span>${paramsHtml}<span class="text-gray-500">)</span>${locationHtml}`;
}

function highlightHeaderLine(line) {
  const m = line.match(EXCEPTION_TYPE_RE);
  if (!m) return `<span class="text-gray-200">${escapeHtml(line)}</span>`;
  const before = line.slice(0, m.index);
  const type = m[1];
  const after = line.slice(m.index + type.length);
  return `<span class="text-gray-200">${escapeHtml(before)}</span><span class="text-rose-400 font-semibold">${escapeHtml(type)}</span><span class="text-amber-200">${escapeHtml(after)}</span>`;
}

export function highlightStackTrace(message) {
  const lines = message.split(/\r\n|\n/);
  return lines
    .map((line) => {
      const frame = line.match(STACK_FRAME_RE);
      if (frame) return highlightFrame(frame[1], frame[2]);
      if (SEPARATOR_RE.test(line.trim())) return `<span class="text-gray-500 italic">${escapeHtml(line)}</span>`;
      return highlightHeaderLine(line);
    })
    .join('\n');
}

export function stackTraceBadge() {
  return `<span class="px-1 py-0.5 rounded text-[10px] font-mono bg-red-900 text-red-300">STACK TRACE</span>`;
}
