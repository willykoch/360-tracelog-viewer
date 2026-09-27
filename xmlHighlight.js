// Highlighter/pretty-printer for the XML the P360 business layer passes around:
//   - <QUERYDESC NAMESPACE="SIRIUS" ENTITY="..."> ... </QUERYDESC>, the core
//     metadata query descriptor that gets converted to SQL.
//   - <invoke ...>/<invokes>...</invokes>, DispatchManager's routed BL calls,
//     which often embed a QUERYDESC (or other XML) inside a <parameter dtype="xml">.
// These get logged either minified (no whitespace at all) or already indented,
// sometimes with mixed single/double-quoted attributes and CDATA sections, and
// sometimes wrapped in free-text ("Invoke Start (routing/serialized) routing://…
// \r\n[1] <QUERYDESC…" or "...\r\n[2] <invokes>...") followed by trailing
// payload after the closing tag — so we split out just the XML block, re-indent
// it consistently, then colorize it.

// NAMESPACE/ENTITY aren't always the first attributes (e.g. SELECTTYPE can come
// first), so match the whole opening tag and check its attributes regardless of
// order, rather than anchoring on a fixed attribute sequence.
const QUERYDESC_OPEN_RE = /<QUERYDESC\b[^>]*>/g;
const QUERYDESC_END = '</QUERYDESC>';
const HAS_SIRIUS_NAMESPACE = /\bNAMESPACE=["']SIRIUS["']/;
const HAS_ENTITY_ATTR = /\bENTITY=["']/;

export function splitQueryDesc(message) {
  QUERYDESC_OPEN_RE.lastIndex = 0;
  let m;
  while ((m = QUERYDESC_OPEN_RE.exec(message)) !== null) {
    const openTag = m[0];
    if (!HAS_SIRIUS_NAMESPACE.test(openTag) || !HAS_ENTITY_ATTR.test(openTag)) continue;
    const start = m.index;
    const endIdx = message.indexOf(QUERYDESC_END, start);
    if (endIdx === -1) return null;
    const xmlEnd = endIdx + QUERYDESC_END.length;
    return {
      prefix: message.slice(0, start),
      xml: message.slice(start, xmlEnd),
      suffix: message.slice(xmlEnd),
    };
  }
  return null;
}

export function extractEntity(xml) {
  const m = xml.match(/ENTITY=["']([^"']*)["']/);
  return m ? m[1] : '?';
}

// <invoke .../> (a single routed BL call) or <invokes ...>...</invokes> (one or
// more <invoke> calls batched together). The wrapper tag name never nests
// inside itself in this format, so the first matching close tag is the right one.
const INVOKE_START = /<(invokes|invoke)(?=[\s>])/;

export function splitInvokeXml(message) {
  const m = message.match(INVOKE_START);
  if (!m) return null;
  const rootTag = m[1];
  const start = m.index;
  const endTag = `</${rootTag}>`;
  let endIdx = message.indexOf(endTag, start);
  if (endIdx === -1) {
    const selfClosed = message.slice(start).match(/^<[^>]*\/>/);
    if (!selfClosed) return null;
    const xmlEnd = start + selfClosed[0].length;
    return { prefix: message.slice(0, start), xml: message.slice(start, xmlEnd), suffix: message.slice(xmlEnd) };
  }
  const xmlEnd = endIdx + endTag.length;
  return {
    prefix: message.slice(0, start),
    xml: message.slice(start, xmlEnd),
    suffix: message.slice(xmlEnd),
  };
}

function routingTail(routing) {
  const parts = routing.split('//');
  return parts[parts.length - 1];
}

export function extractInvokeLabel(xml) {
  const routings = [...xml.matchAll(/routing=["']([^"']*)["']/g)];
  if (routings.length === 0) return null;
  if (routings.length === 1) return routingTail(routings[0][1]);
  return `${routings.length} calls (first: ${routingTail(routings[0][1])})`;
}

// <RECORDS>...</RECORDS> / <RECORDS /> — a returned result set, logged after a
// short free-text prefix ("Foo.Bar returning: ", "Return action: ", …).
const RECORDS_START = /<RECORDS(?=[\s>/])/;

export function splitRecordsXml(message) {
  const m = message.match(RECORDS_START);
  if (!m) return null;
  const start = m.index;
  const openTag = message.slice(start).match(/^<[^>]*>/);
  let xmlEnd;
  if (openTag && openTag[0].endsWith('/>')) {
    xmlEnd = start + openTag[0].length;
  } else {
    const endIdx = message.indexOf('</RECORDS>', start);
    if (endIdx === -1) return null;
    xmlEnd = endIdx + '</RECORDS>'.length;
  }
  return {
    prefix: message.slice(0, start),
    xml: message.slice(start, xmlEnd),
    suffix: message.slice(xmlEnd),
  };
}

export function extractRecordsSummary(xml) {
  const countAttr = xml.match(/RECORDCOUNT="(\d+)"/);
  const count = countAttr ? Number(countAttr[1]) : (xml.match(/<RECORD\b/g) || []).length;
  return `${count} record${count === 1 ? '' : 's'}`;
}

// <INSERTSTATEMENT>/<UPDATESTATEMENT>/<DELETESTATEMENT NAMESPACE="SIRIUS" ENTITY="...">
// are the metadata write-side counterpart to QUERYDESC, logged around SI.Biz.Core
// write operations (e.g. "Start actionxml: <INSERTSTATEMENT ...>...</INSERTSTATEMENT>").
// Several can be grouped under one <BATCH ID="..."> wrapper, and — unlike QUERYDESC/
// invoke — a single message can contain more than one top-level block back to back
// (e.g. a BATCH followed later by another bare statement), so this returns an
// ordered list of text/xml segments rather than a single prefix/xml/suffix split.
const STATEMENT_TAGS = ['BATCH', 'INSERTSTATEMENT', 'UPDATESTATEMENT', 'DELETESTATEMENT'];
const STATEMENT_ROOT_RE = new RegExp(`<(${STATEMENT_TAGS.join('|')})\\b`, 'g');

export function splitStatementXml(message) {
  STATEMENT_ROOT_RE.lastIndex = 0;
  const segments = [];
  let cursor = 0;
  let m;
  while ((m = STATEMENT_ROOT_RE.exec(message)) !== null) {
    if (m.index < cursor) continue; // inside a block already consumed below
    const tag = m[1];

    // DELETESTATEMENT in particular is often self-closing, e.g.
    // <DELETESTATEMENT ENTITY="File" ID="..." NAMESPACE="SIRIUS" PRIMARYKEYVALUE="..." />
    const openTag = message.slice(m.index).match(/^<[^>]*>/);
    let xmlEnd;
    if (openTag && openTag[0].endsWith('/>')) {
      xmlEnd = m.index + openTag[0].length;
    } else {
      const endTag = `</${tag}>`;
      const endIdx = message.indexOf(endTag, m.index);
      if (endIdx === -1) continue; // unclosed/truncated — skip, keep scanning
      xmlEnd = endIdx + endTag.length;
    }
    if (m.index > cursor) segments.push({ type: 'text', text: message.slice(cursor, m.index) });
    segments.push({ type: 'xml', xml: message.slice(m.index, xmlEnd) });
    cursor = xmlEnd;
    STATEMENT_ROOT_RE.lastIndex = xmlEnd;
  }
  if (segments.length === 0) return null;
  if (cursor < message.length) segments.push({ type: 'text', text: message.slice(cursor) });
  return segments;
}

export function summarizeStatements(segments) {
  const allXml = segments.filter((s) => s.type === 'xml').map((s) => s.xml).join('');
  const counts = { INSERTSTATEMENT: 0, UPDATESTATEMENT: 0, DELETESTATEMENT: 0 };
  const re = /<(INSERTSTATEMENT|UPDATESTATEMENT|DELETESTATEMENT)\b/g;
  let m;
  while ((m = re.exec(allXml)) !== null) counts[m[1]]++;
  const total = counts.INSERTSTATEMENT + counts.UPDATESTATEMENT + counts.DELETESTATEMENT;

  if (total === 1) {
    const type = counts.INSERTSTATEMENT ? 'INSERT' : counts.UPDATESTATEMENT ? 'UPDATE' : 'DELETE';
    const em = allXml.match(/ENTITY=["']([^"']*)["']/);
    return `${type}: ${em ? em[1] : '?'}`;
  }
  const parts = [];
  if (counts.INSERTSTATEMENT) parts.push(`${counts.INSERTSTATEMENT} insert${counts.INSERTSTATEMENT > 1 ? 's' : ''}`);
  if (counts.UPDATESTATEMENT) parts.push(`${counts.UPDATESTATEMENT} update${counts.UPDATESTATEMENT > 1 ? 's' : ''}`);
  if (counts.DELETESTATEMENT) parts.push(`${counts.DELETESTATEMENT} delete${counts.DELETESTATEMENT > 1 ? 's' : ''}`);
  return parts.join(', ') || 'statement';
}

const CDATA_TOKEN_RE = /<!\[CDATA\[[\s\S]*?\]\]>/;

function isCData(tok) {
  return tok.startsWith('<![CDATA[');
}
function isTag(tok) {
  return tok[0] === '<' && !isCData(tok);
}
function isContent(tok) {
  return tok !== undefined && (tok[0] !== '<' || isCData(tok));
}

function tokenize(xml) {
  return xml.match(new RegExp(`${CDATA_TOKEN_RE.source}|<[^>]+>|[^<]+`, 'g')) || [];
}

export function prettyPrintXml(xml) {
  const collapsed = xml.replace(/>\s+</g, '><').trim();
  const tokens = tokenize(collapsed);
  const INDENT = '  ';
  let depth = 0;
  const lines = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!isTag(tok)) continue; // stray top-level text/CDATA shouldn't occur in this format

    if (tok.startsWith('</')) {
      depth = Math.max(0, depth - 1);
      lines.push(INDENT.repeat(depth) + tok);
      continue;
    }
    if (tok.endsWith('/>')) {
      lines.push(INDENT.repeat(depth) + tok);
      continue;
    }

    const next = tokens[i + 1];
    const afterNext = tokens[i + 2];
    if (next && next.startsWith('</')) {
      // empty element written as <TAG></TAG>
      lines.push(INDENT.repeat(depth) + tok + next);
      i += 1;
    } else if (isContent(next) && afterNext && afterNext.startsWith('</')) {
      // leaf element with simple text or CDATA content, e.g. <METAITEM ...>Recno</METAITEM>
      lines.push(INDENT.repeat(depth) + tok + next + afterNext);
      i += 2;
    } else {
      lines.push(INDENT.repeat(depth) + tok);
      depth++;
    }
  }
  return lines.join('\n');
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const TAG_RE = /^<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>$/;
const ATTR_RE = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function highlightTag(tok) {
  const m = tok.match(TAG_RE);
  if (!m) return `<span class="text-gray-500">${escapeHtml(tok)}</span>`;
  const [, closingSlash, name, attrsBlob, selfClosingSlash] = m;

  let attrsHtml = '';
  ATTR_RE.lastIndex = 0;
  let am;
  while ((am = ATTR_RE.exec(attrsBlob)) !== null) {
    const attrName = am[1];
    const attrValue = am[2] !== undefined ? am[2] : am[3];
    attrsHtml += ` <span class="text-sky-300">${escapeHtml(attrName)}</span><span class="text-gray-500">=</span><span class="text-orange-300">"${escapeHtml(attrValue)}"</span>`;
  }

  return `<span class="text-gray-500">&lt;${closingSlash}</span><span class="text-rose-400 font-semibold">${escapeHtml(name)}</span>${attrsHtml}<span class="text-gray-500">${selfClosingSlash}&gt;</span>`;
}

function highlightCData(tok) {
  const inner = tok.slice('<![CDATA['.length, -']]>'.length);
  return `<span class="text-gray-500">&lt;![CDATA[</span><span class="text-orange-300">${escapeHtml(inner)}</span><span class="text-gray-500">]]&gt;</span>`;
}

export function highlightXml(prettyXml) {
  const tokens = tokenize(prettyXml);
  let out = '';
  for (const tok of tokens) {
    if (isCData(tok)) out += highlightCData(tok);
    else if (isTag(tok)) out += highlightTag(tok);
    else out += `<span class="text-gray-100">${escapeHtml(tok)}</span>`;
  }
  return out;
}

export function queryDescBadge(entity) {
  return `<span class="px-1 py-0.5 rounded text-[10px] font-mono bg-teal-900 text-teal-300">XML QUERYDESC: ${escapeHtml(entity)}</span>`;
}

export function invokeBadge(label) {
  return `<span class="px-1 py-0.5 rounded text-[10px] font-mono bg-indigo-900 text-indigo-300">XML INVOKE${label ? ': ' + escapeHtml(label) : ''}</span>`;
}

export function statementBadge(summary) {
  return `<span class="px-1 py-0.5 rounded text-[10px] font-mono bg-fuchsia-900 text-fuchsia-300">XML ${escapeHtml(summary)}</span>`;
}

export function recordsBadge(summary) {
  return `<span class="px-1 py-0.5 rounded text-[10px] font-mono bg-lime-900 text-lime-300">XML RECORDS: ${escapeHtml(summary)}</span>`;
}
