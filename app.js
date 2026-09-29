import { parseTraceLog } from './parser.js';
import { splitSqlTag, highlightSql, sqlTagBadge } from './sqlHighlight.js';
import { splitQueryDesc, extractEntity, splitInvokeXml, extractInvokeLabel, splitStatementXml, summarizeStatements, splitRecordsXml, extractRecordsSummary, prettyPrintXml, highlightXml, queryDescBadge, invokeBadge, statementBadge, recordsBadge } from './xmlHighlight.js';
import { looksLikeStackTrace, highlightStackTrace, stackTraceBadge } from './stackTraceHighlight.js';
import { looksLikeClientMarker, highlightClientMarker, clientMarkerBadge } from './clientTraceHighlight.js';
import { splitProtocolUri, extractUriAction, highlightProtocolUri, protocolUriBadge } from './protocolUriHighlight.js';

const state = {
  rows: [],
  filtered: [],
  q: '',
  level: '',
  sev: '',
  subsystem: '',
  module: '',
  filterSql: false,
  filterXml: false,
  sortKey: null,
  sortDir: 1,
  selected: null,
  source: 'server', // 'server' | 'handle' | 'file'
  fileHandle: null, // FileSystemFileHandle, when source === 'handle'
};

const SEV_COLORS = {
  info: 'bg-emerald-500',
  event: 'bg-sky-500',
  warning: 'bg-amber-500',
  error: 'bg-rose-500',
  detailed: 'bg-gray-500',
};
function sevColor(sev) {
  return SEV_COLORS[sev] || 'bg-gray-500';
}

const els = {
  fileInfo: document.getElementById('fileInfo'),
  rowCount: document.getElementById('rowCount'),
  openBtn: document.getElementById('openBtn'),
  fileInput: document.getElementById('fileInput'),
  exportBtn: document.getElementById('exportBtn'),
  exportMenu: document.getElementById('exportMenu'),
  reloadBtn: document.getElementById('reloadBtn'),
  searchInput: document.getElementById('searchInput'),
  levelFilter: document.getElementById('levelFilter'),
  severityFilter: document.getElementById('severityFilter'),
  subsystemFilter: document.getElementById('subsystemFilter'),
  moduleFilter: document.getElementById('moduleFilter'),
  contentFilter: document.getElementById('contentFilter'),
  clearFiltersBtn: document.getElementById('clearFiltersBtn'),
  tbody: document.getElementById('tbody'),
  detailPanel: document.getElementById('detailPanel'),
  detailBody: document.getElementById('detailBody'),
  closeDetailBtn: document.getElementById('closeDetailBtn'),
};

function urlStateInit() {
  const p = new URLSearchParams(location.search);
  state.q = p.get('q') || '';
  state.level = p.get('level') || '';
  state.sev = p.get('sev') || '';
  state.subsystem = p.get('subsystem') || '';
  state.module = p.get('module') || '';
  state.filterSql = p.get('sql') === '1';
  state.filterXml = p.get('xml') === '1';
  state.sortKey = p.get('sort') || null;
  state.sortDir = p.get('dir') === 'desc' ? -1 : 1;
  const rowParam = p.get('row');
  state.selected = rowParam !== null ? Number(rowParam) : null;
  els.searchInput.value = state.q;
}

function syncUrl() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.level) p.set('level', state.level);
  if (state.sev) p.set('sev', state.sev);
  if (state.subsystem) p.set('subsystem', state.subsystem);
  if (state.module) p.set('module', state.module);
  if (state.filterSql) p.set('sql', '1');
  if (state.filterXml) p.set('xml', '1');
  if (state.sortKey) {
    p.set('sort', state.sortKey);
    if (state.sortDir === -1) p.set('dir', 'desc');
  }
  if (state.selected !== null && state.selected !== undefined) p.set('row', state.selected);
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function applyFilters() {
  const q = state.q.trim().toLowerCase();
  state.filtered = state.rows.filter((r) => {
    if (state.level && r.level !== state.level) return false;
    if (state.sev && r.severity !== state.sev) return false;
    if (state.subsystem && r.subsystemRaw !== state.subsystem) return false;
    if (state.module && r.module !== state.module) return false;
    if (state.filterSql || state.filterXml) {
      const matchesSql = state.filterSql && r._isSql;
      const matchesXml = state.filterXml && r._isXml;
      if (!matchesSql && !matchesXml) return false;
    }
    if (q) {
      const hay = (r.message + ' ' + r.routine + ' ' + r.module + ' ' + r.subsystem + ' ' + r.user).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (state.sortKey) {
    const k = state.sortKey;
    state.filtered.sort((a, b) => {
      const av = a[k], bv = b[k];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * state.sortDir;
      return String(av).localeCompare(String(bv)) * state.sortDir;
    });
  }
}

function render() {
  applyFilters();
  els.rowCount.textContent = `${state.filtered.length} / ${state.rows.length} records`;

  const html = state.filtered.map((r) => {
    const isSel = r._idx === state.selected;
    return `<tr class="row-hover border-b border-gray-900 cursor-pointer ${isSel ? 'bg-blue-950' : ''}" data-idx="${r._idx}">
      <td class="text-center"><span class="inline-block w-2 h-2 rounded-full ${sevColor(r.severity)}" title="${escapeHtml(r.severity)}${r.eventLevel ? ' / ' + escapeHtml(r.eventLevel) : ''}"></span></td>
      <td class="px-2 py-0.5 text-gray-400 font-mono">${r.time}</td>
      <td class="px-2 py-0.5 text-gray-500 font-mono">${r.tick}</td>
      <td class="px-2 py-0.5 cell-clip text-gray-400" title="${escapeHtml(r.user)}">${escapeHtml(shortUser(r.user))}</td>
      <td class="px-2 py-0.5 cell-clip" title="${escapeHtml(r.subsystem)}">${escapeHtml(r.subsystemRaw)}</td>
      <td class="px-2 py-0.5 cell-clip" title="${escapeHtml(r.module)}">${escapeHtml(r.module)}</td>
      <td class="px-2 py-0.5 cell-clip text-gray-400" title="${escapeHtml(r.routine)}">${escapeHtml(r.routine)}</td>
      <td class="px-2 py-0.5 cell-clip" title="${escapeHtml(r.message.slice(0, 500))}">${renderMessageCell(r)}</td>
      <td class="px-2 py-0.5"><span class="px-1.5 py-0.5 rounded text-[10px] ${r.level === 'detailed' ? 'bg-gray-700 text-gray-300' : 'bg-blue-900 text-blue-300'}">${r.level}</span></td>
    </tr>`;
  }).join('');
  els.tbody.innerHTML = html;

  document.querySelectorAll('#tbody tr').forEach((tr) => {
    tr.addEventListener('click', () => {
      const idx = Number(tr.dataset.idx);
      state.selected = state.selected === idx ? null : idx;
      syncUrl();
      render();
      if (state.selected !== null) showDetail(state.rows[state.selected]);
      else hideDetail();
    });
  });

  syncUrl();
}

function firstLine(msg) {
  const nl = msg.indexOf('\n');
  const line = nl === -1 ? msg : msg.slice(0, nl) + ' […]';
  return line.length > 400 ? line.slice(0, 400) + ' […]' : line;
}

function renderMessageCell(r) {
  const sql = splitSqlTag(r.message);
  if (sql) return `${sqlTagBadge(sql.tag)} <span class="font-mono">${highlightSql(firstLine(sql.query))}</span>`;

  const inv = splitInvokeXml(r.message);
  if (inv) return `${invokeBadge(extractInvokeLabel(inv.xml))} ${escapeHtml(firstLine(r.message))}`;

  const qd = splitQueryDesc(r.message);
  if (qd) return `${queryDescBadge(extractEntity(qd.xml))} ${escapeHtml(firstLine(r.message))}`;

  const st = splitStatementXml(r.message);
  if (st) return `${statementBadge(summarizeStatements(st))} ${escapeHtml(firstLine(r.message))}`;

  const rec = splitRecordsXml(r.message);
  if (rec) return `${recordsBadge(extractRecordsSummary(rec.xml))} ${escapeHtml(firstLine(r.message))}`;

  if (looksLikeStackTrace(r.message)) return `${stackTraceBadge()} ${escapeHtml(firstLine(r.message))}`;

  if (looksLikeClientMarker(r.message)) return `${clientMarkerBadge()} ${highlightClientMarker(firstLine(r.message))}`;

  const pu = splitProtocolUri(r.message);
  if (pu) return `${protocolUriBadge(extractUriAction(pu.rest))} ${escapeHtml(firstLine(r.message))}`;

  return escapeHtml(firstLine(r.message));
}

function shortUser(u) {
  return u.replace(/^IIS APPPOOL\\/, '');
}

function showDetail(r) {
  els.detailPanel.classList.remove('hidden');
  els.detailBody.innerHTML = `
    <div class="grid grid-cols-2 gap-x-6 gap-y-1 mb-3 text-gray-400">
      <div><span class="text-gray-600">Severity:</span> ${escapeHtml(r.severity)}${r.eventLevel ? ' (' + escapeHtml(r.eventLevel) + ')' : ''}</div>
      <div><span class="text-gray-600">Level:</span> ${escapeHtml(r.level)}</div>
      <div><span class="text-gray-600">Date/Time:</span> ${r.date} ${r.time}</div>
      <div><span class="text-gray-600">Tick:</span> ${r.tick}</div>
      <div><span class="text-gray-600">User:</span> ${escapeHtml(r.user)}</div>
      <div><span class="text-gray-600">PID:</span> ${escapeHtml(r.pid)}</div>
      <div><span class="text-gray-600">SubSystem:</span> ${escapeHtml(r.subsystemRaw)} <span class="text-gray-600">(${escapeHtml(r.subsystemArea)})</span></div>
      <div><span class="text-gray-600">Module / Routine:</span> ${escapeHtml(r.module)} / ${escapeHtml(r.routine)}</div>
      ${r.subsystemContext ? `<div class="col-span-2"><span class="text-gray-600">Job context:</span> ${escapeHtml(r.subsystemContext)}</div>` : ''}
    </div>
    ${renderMessageDetail(r)}
  `;
}

function renderXmlBlock(badgeHtml, block) {
  const prefixText = block.prefix.trim();
  const suffixText = block.suffix.trim();
  const prefixHtml = prefixText
    ? `<pre class="whitespace-pre-wrap font-mono text-[11px] text-gray-400 mb-1">${escapeHtml(prefixText)}</pre>`
    : '';
  const suffixHtml = suffixText
    ? `<div class="mt-1 text-gray-500 text-[11px] font-mono break-all">${suffixText.length > 400 ? escapeHtml(suffixText.slice(0, 400)) + `… (${suffixText.length} bytes total, trailing payload truncated)` : escapeHtml(suffixText)}</div>`
    : '';
  return `<div class="mb-1">${badgeHtml}</div>
    ${prefixHtml}
    <pre class="whitespace-pre-wrap font-mono text-[11px] bg-gray-950 border border-gray-800 rounded p-2">${highlightXml(prettyPrintXml(block.xml))}</pre>
    ${suffixHtml}`;
}

function renderXmlSegments(badgeHtml, segments) {
  const parts = segments.map((seg) => {
    if (seg.type === 'xml') {
      return `<pre class="whitespace-pre-wrap font-mono text-[11px] bg-gray-950 border border-gray-800 rounded p-2 mb-1">${highlightXml(prettyPrintXml(seg.xml))}</pre>`;
    }
    const text = seg.text.trim();
    if (!text) return '';
    const shown = text.length > 400 ? escapeHtml(text.slice(0, 400)) + `… (${text.length} chars total, truncated)` : escapeHtml(text);
    return `<pre class="whitespace-pre-wrap font-mono text-[11px] text-gray-400 mb-1">${shown}</pre>`;
  });
  return `<div class="mb-1">${badgeHtml}</div>${parts.join('')}`;
}

function renderMessageDetail(r) {
  const sql = splitSqlTag(r.message);
  if (sql) {
    return `<div class="mb-1">${sqlTagBadge(sql.tag)}</div>
      <pre class="whitespace-pre-wrap font-mono text-[11px] bg-gray-950 border border-gray-800 rounded p-2">${highlightSql(sql.query)}</pre>`;
  }

  const inv = splitInvokeXml(r.message);
  if (inv) return renderXmlBlock(invokeBadge(extractInvokeLabel(inv.xml)), inv);

  const qd = splitQueryDesc(r.message);
  if (qd) return renderXmlBlock(queryDescBadge(extractEntity(qd.xml)), qd);

  const st = splitStatementXml(r.message);
  if (st) return renderXmlSegments(statementBadge(summarizeStatements(st)), st);

  const rec = splitRecordsXml(r.message);
  if (rec) return renderXmlBlock(recordsBadge(extractRecordsSummary(rec.xml)), rec);

  if (looksLikeStackTrace(r.message)) {
    return `<div class="mb-1">${stackTraceBadge()}</div>
      <pre class="whitespace-pre-wrap font-mono text-[11px] bg-gray-950 border border-gray-800 rounded p-2">${highlightStackTrace(r.message)}</pre>`;
  }

  if (looksLikeClientMarker(r.message)) {
    return `<div class="mb-1">${clientMarkerBadge()}</div>
      <pre class="whitespace-pre-wrap font-mono text-[11px] bg-gray-950 border border-gray-800 rounded p-2">${highlightClientMarker(r.message)}</pre>`;
  }

  const pu = splitProtocolUri(r.message);
  if (pu) {
    const prefixText = pu.prefix.trim();
    return `<div class="mb-1">${protocolUriBadge(extractUriAction(pu.rest))}</div>
      ${prefixText ? `<div class="text-gray-400 text-[11px] mb-1">${escapeHtml(prefixText)}</div>` : ''}
      <pre class="whitespace-pre-wrap break-all font-mono text-[11px] bg-gray-950 border border-gray-800 rounded p-2">${highlightProtocolUri(pu.scheme, pu.rest)}</pre>`;
  }

  return `<pre class="whitespace-pre-wrap font-mono text-[11px] text-gray-200 bg-gray-950 border border-gray-800 rounded p-2">${escapeHtml(r.message)}</pre>`;
}

function hideDetail() {
  els.detailPanel.classList.add('hidden');
}

function buildSeverityButtons() {
  const sevs = [...new Set(state.rows.map((r) => r.severity))].sort();
  const container = els.severityFilter;
  sevs.forEach((sev) => {
    const btn = document.createElement('button');
    btn.dataset.sev = sev;
    btn.className = 'px-2 py-1 rounded text-xs flex items-center gap-1';
    btn.innerHTML = `<span class="inline-block w-1.5 h-1.5 rounded-full ${sevColor(sev)}"></span>${sev}`;
    container.appendChild(btn);
  });
  updatePillStyles();
}

function buildSubsystemOptions() {
  const areas = new Map(); // area -> Set(subsystemRaw)
  for (const r of state.rows) {
    if (!areas.has(r.subsystemArea)) areas.set(r.subsystemArea, new Set());
    areas.get(r.subsystemArea).add(r.subsystemRaw);
  }
  const sortedAreas = [...areas.keys()].sort();

  const groups = sortedAreas.map((area) => {
    const subs = [...areas.get(area)].sort();
    // A lone subsystem that equals its own area (e.g. "SI.Util") needs no group wrapper.
    if (subs.length === 1 && subs[0] === area) {
      return `<option value="${escapeHtml(subs[0])}">${escapeHtml(subs[0])}</option>`;
    }
    const opts = subs.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    return `<optgroup label="${escapeHtml(area)}">${opts}</optgroup>`;
  });

  els.subsystemFilter.innerHTML = '<option value="">All subsystems</option>' + groups.join('');
  els.subsystemFilter.value = state.subsystem;
}

function buildModuleOptions() {
  const modules = [...new Set(state.rows.map((r) => r.module))].sort();
  els.moduleFilter.innerHTML = '<option value="">All modules</option>' +
    modules.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  els.moduleFilter.value = state.module;
}

function updatePillStyles() {
  document.querySelectorAll('#levelFilter button').forEach((b) => {
    b.classList.toggle('bg-blue-700', b.dataset.level === state.level);
    b.classList.toggle('text-white', b.dataset.level === state.level);
    b.classList.toggle('text-gray-400', b.dataset.level !== state.level);
  });
  document.querySelectorAll('#severityFilter button').forEach((b) => {
    b.classList.toggle('bg-blue-700', b.dataset.sev === state.sev);
    b.classList.toggle('text-white', b.dataset.sev === state.sev);
    b.classList.toggle('text-gray-400', b.dataset.sev !== state.sev);
  });
  document.querySelectorAll('#contentFilter button').forEach((b) => {
    const active = (b.dataset.content === 'sql' && state.filterSql) || (b.dataset.content === 'xml' && state.filterXml);
    b.classList.toggle('bg-blue-700', active);
    b.classList.toggle('text-white', active);
    b.classList.toggle('text-gray-400', !active);
  });
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    const arrow = th.querySelector('.sort-arrow');
    const active = th.dataset.sort === state.sortKey;
    arrow.classList.toggle('active', active);
    arrow.textContent = active && state.sortDir === -1 ? '▴' : '▾';
  });
}

function wireEvents() {
  els.searchInput.addEventListener('input', () => {
    state.q = els.searchInput.value;
    render();
  });
  els.levelFilter.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.level = btn.dataset.level;
    updatePillStyles();
    render();
  });
  els.severityFilter.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.sev = btn.dataset.sev;
    updatePillStyles();
    render();
  });
  els.subsystemFilter.addEventListener('change', () => {
    state.subsystem = els.subsystemFilter.value;
    render();
  });
  els.moduleFilter.addEventListener('change', () => {
    state.module = els.moduleFilter.value;
    render();
  });
  els.contentFilter.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.content === 'sql') state.filterSql = !state.filterSql;
    else if (btn.dataset.content === 'xml') state.filterXml = !state.filterXml;
    updatePillStyles();
    render();
  });
  els.clearFiltersBtn.addEventListener('click', () => {
    state.q = ''; state.level = ''; state.sev = ''; state.subsystem = ''; state.module = '';
    state.filterSql = false; state.filterXml = false;
    els.searchInput.value = '';
    els.subsystemFilter.value = '';
    els.moduleFilter.value = '';
    updatePillStyles();
    render();
  });
  els.closeDetailBtn.addEventListener('click', () => {
    state.selected = null;
    syncUrl();
    hideDetail();
    render();
  });
  els.reloadBtn.addEventListener('click', reload);
  els.openBtn.addEventListener('click', openFile);
  els.fileInput.addEventListener('change', onFileInputChange);
  els.exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    els.exportMenu.classList.toggle('hidden');
  });
  els.exportMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-format]');
    if (!btn) return;
    exportData(btn.dataset.format);
  });
  document.addEventListener('click', () => els.exportMenu.classList.add('hidden'));
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) state.sortDir *= -1;
      else { state.sortKey = key; state.sortDir = 1; }
      updatePillStyles();
      render();
    });
  });
}

function ingest(buf, { filename, mtime }) {
  const { rows, skipped } = parseTraceLog(buf);
  rows.forEach((r, i) => {
    r._idx = i;
    r._isSql = !!splitSqlTag(r.message);
    r._isXml = !!(splitQueryDesc(r.message) || splitInvokeXml(r.message) || splitStatementXml(r.message) || splitRecordsXml(r.message));
  });
  state.rows = rows;

  const mtimeText = mtime ? `modified ${new Date(mtime).toLocaleString()}` : null;
  els.fileInfo.textContent = [filename, `${(buf.byteLength / 1024).toFixed(0)} KB`, mtimeText, skipped ? `${skipped} malformed records skipped` : null]
    .filter(Boolean)
    .join(' · ');

  els.severityFilter.querySelectorAll('button:not([data-sev=""])').forEach((b) => b.remove());
  buildSeverityButtons();
  buildSubsystemOptions();
  buildModuleOptions();

  render();
  if (state.selected !== null && state.rows[state.selected]) showDetail(state.rows[state.selected]);
}

async function loadFromServer() {
  els.fileInfo.textContent = 'loading…';
  const res = await fetch('/api/logfile?_=' + Date.now());
  if (!res.ok) {
    els.fileInfo.textContent = 'No log file on the server — click "Open…" to load one from your machine.';
    return;
  }
  const filename = res.headers.get('X-Log-Filename');
  const mtime = res.headers.get('X-Log-Mtime');
  const buf = await res.arrayBuffer();
  state.source = 'server';
  state.fileHandle = null;
  ingest(buf, { filename, mtime });
}

async function loadFromFile(file) {
  const buf = await file.arrayBuffer();
  ingest(buf, { filename: file.name, mtime: file.lastModified });
}

async function openFile() {
  if ('showOpenFilePicker' in window) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'TraceLog files', accept: { 'application/octet-stream': ['.log', '.trc'] } }],
        excludeAcceptAllOption: false,
        multiple: false,
      });
      const file = await handle.getFile();
      state.source = 'handle';
      state.fileHandle = handle;
      await loadFromFile(file);
    } catch (err) {
      if (err.name !== 'AbortError') console.error(err);
    }
    return;
  }
  // Fallback for browsers without the File System Access API: plain picker,
  // but the resulting File is a frozen snapshot — Reload can't refresh it.
  els.fileInput.click();
}

async function onFileInputChange() {
  const file = els.fileInput.files[0];
  if (!file) return;
  state.source = 'file';
  state.fileHandle = null;
  await loadFromFile(file);
  els.fileInput.value = '';
}

async function reload() {
  if (state.source === 'handle' && state.fileHandle) {
    const file = await state.fileHandle.getFile();
    await loadFromFile(file);
  } else if (state.source === 'server') {
    await loadFromServer();
  } else {
    // A plain <input type=file> selection can't be silently re-read; re-prompt.
    await openFile();
  }
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const EXPORT_COLS = ['severity', 'user', 'pid', 'subsystem', 'module', 'routine', 'message', 'level', 'tick', 'date', 'time'];

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportData(format) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  if (format === 'json') {
    const rows = state.filtered.map((r) => Object.fromEntries(EXPORT_COLS.map((c) => [c, r[c]])));
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json;charset=utf-8' });
    downloadBlob(blob, `tracelog-export-${stamp}.json`);
    return;
  }

  const lines = [EXPORT_COLS.join(',')];
  for (const r of state.filtered) {
    lines.push(EXPORT_COLS.map((c) => csvEscape(r[c])).join(','));
  }
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `tracelog-export-${stamp}.csv`);
}

urlStateInit();
wireEvents();
loadFromServer();
