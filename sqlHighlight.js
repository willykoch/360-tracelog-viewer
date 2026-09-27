// Lightweight T-SQL syntax highlighter for "[Sql Reader]" / "[Sql NonQuery]" / "[Sql Scalar]" messages.
// No external deps — traceview messages are single statements, not full scripts.

// The "* " marker is usually present before inline SQL text ("[Sql Reader] * select …"),
// but a stored-procedure call is logged as just the tag + bare proc name, no "*"
// and no visible SQL text at all (e.g. "[Sql Reader] sec_wrap_usp_contact_has_role_flag").
const SQL_TAG_RE = /^\[Sql (Reader|NonQuery|Scalar)\]\s*(?:\*\s*)?/;
const BARE_PROC_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function splitSqlTag(message) {
  const m = message.match(SQL_TAG_RE);
  if (!m) return null;
  return { tag: m[1], query: message.slice(m[0].length) };
}

const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'APPLY', 'ON',
  'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'LIKE', 'ORDER', 'BY', 'GROUP', 'HAVING',
  'AS', 'DISTINCT', 'TOP', 'EXEC', 'EXECUTE', 'DECLARE', 'CAST', 'CONVERT',
  'UNION', 'ALL', 'EXISTS', 'BETWEEN', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'ASC', 'DESC', 'WITH', 'NOLOCK', 'DEFAULT', 'PRIMARY', 'KEY', 'FOREIGN',
  'REFERENCES', 'CREATE', 'ALTER', 'DROP', 'TABLE', 'INDEX', 'VIEW', 'PROCEDURE',
  'TRIGGER', 'RETURNS', 'RETURN', 'BEGIN', 'IF', 'WHILE', 'GO',
]);
const SCHEMAS = new Set(['dbo', 'sys', 'information_schema']);

const TOKEN_RE =
  /(--[^\n]*)|(\/\*[\s\S]*?\*\/)|('(?:[^']|'')*')|(\[[^\]\r\n]*\])|(@[A-Za-z_][A-Za-z0-9_]*)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|([(),;.=<>!+\-*/%|])/g;

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function highlightSql(sql) {
  const trimmed = sql.trim();
  if (BARE_PROC_NAME_RE.test(trimmed)) {
    // No SQL text was logged, just the stored procedure name — render it as an
    // implied EXEC call so it doesn't look like an inert, unhighlighted string.
    return `<span class="text-purple-400 font-semibold">EXEC</span> <span class="text-yellow-300">${escapeHtml(trimmed)}</span>`;
  }

  let out = '';
  let lastIndex = 0;
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(sql)) !== null) {
    out += escapeHtml(sql.slice(lastIndex, m.index));
    lastIndex = TOKEN_RE.lastIndex;
    const [full, comment, blockComment, string, bracket, variable, number, word, punct] = m;

    if (comment || blockComment) {
      out += `<span class="text-gray-500 italic">${escapeHtml(full)}</span>`;
    } else if (string) {
      out += `<span class="text-orange-300">${escapeHtml(full)}</span>`;
    } else if (bracket) {
      out += `<span class="text-cyan-300">${escapeHtml(full)}</span>`;
    } else if (variable) {
      out += `<span class="text-pink-300">${escapeHtml(full)}</span>`;
    } else if (number) {
      out += `<span class="text-sky-300">${escapeHtml(full)}</span>`;
    } else if (word) {
      const upper = word.toUpperCase();
      const followedByParen = /^\s*\(/.test(sql.slice(TOKEN_RE.lastIndex, TOKEN_RE.lastIndex + 10));
      if (KEYWORDS.has(upper)) {
        out += `<span class="text-purple-400 font-semibold">${escapeHtml(full)}</span>`;
      } else if (SCHEMAS.has(word.toLowerCase())) {
        out += `<span class="text-purple-300">${escapeHtml(full)}</span>`;
      } else if (followedByParen) {
        out += `<span class="text-yellow-300">${escapeHtml(full)}</span>`;
      } else {
        out += `<span class="text-gray-100">${escapeHtml(full)}</span>`;
      }
    } else if (punct) {
      out += `<span class="text-gray-500">${escapeHtml(full)}</span>`;
    }
  }
  out += escapeHtml(sql.slice(lastIndex));
  return out;
}

const TAG_BADGE_COLORS = {
  Reader: 'bg-cyan-900 text-cyan-300',
  NonQuery: 'bg-amber-900 text-amber-300',
  Scalar: 'bg-violet-900 text-violet-300',
};

export function sqlTagBadge(tag) {
  const cls = TAG_BADGE_COLORS[tag] || 'bg-gray-700 text-gray-300';
  return `<span class="px-1 py-0.5 rounded text-[10px] font-mono ${cls}">SQL ${tag.toUpperCase()}</span>`;
}
