// Parses Public 360 / traceview.exe binary .log files.
//
// Format (reverse-engineered, no spec available):
//   - 64-byte fixed header:
//       bytes 0-3  header size, u32LE (always 0x40 / 64 so far)
//       bytes 4-7  valid body length, u32LE — how many bytes of the fixed-size
//                  ring buffer are actually current data; the rest is unused.
//       ...unused/padding, ends with \r\n
//   - The file itself is always a fixed size (e.g. 3,200,000 bytes) regardless of
//     how much was actually logged, so anything past the valid-length boundary is
//     leftover space. When a session only writes a little into a freshly-cleared
//     buffer, that leftover is all zero and harmless either way. But when the
//     buffer was previously used for a much longer capture and only partially
//     overwritten, the leftover is STALE, non-zero bytes from that earlier run —
//     parsing it as records produces a flood of spurious "malformed" fragments
//     (garbled short binary junk, not real trace text). Always truncate to the
//     declared valid length before splitting into records.
//   - Records separated by 0x17 (ETB)
//   - Each record has exactly 11 fields separated by the 3-byte sequence 0x13 0x13 0x13 (DC3 x3):
//       0 severity   ("info" | "event" | "warning" | "error" ...)
//       1 user
//       2 pid          (raw string, includes app-domain path)
//       3 subsystem
//       4 module
//       5 routine
//       6 message
//       7 level        ("overview" | "detailed")
//       8 tick
//       9 date         (YYYY-MM-DD)
//      10 time         (HH:MM:SS)
//   - File is a fixed-size ring buffer; trailing bytes after the last record are
//     NUL padding and must be discarded.
//   - "event" rows often carry a suffix on the message field: "...?Information?0?0"
//     (event level + two numeric codes). The legacy client does not strip this either,
//     but we split it out for a friendlier display while keeping the raw text available.

const HEADER_SIZE = 64;
const RECORD_SEP = 0x17;
const FIELD_SEP = [0x13, 0x13, 0x13];
const FIELD_COUNT = 11;

function splitBytes(buf, sepByte) {
  const parts = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === sepByte) {
      parts.push(buf.subarray(start, i));
      start = i + 1;
    }
  }
  parts.push(buf.subarray(start));
  return parts;
}

function splitFieldSep(buf) {
  const parts = [];
  let start = 0;
  let i = 0;
  while (i <= buf.length - 3) {
    if (buf[i] === 0x13 && buf[i + 1] === 0x13 && buf[i + 2] === 0x13) {
      parts.push(buf.subarray(start, i));
      i += 3;
      start = i;
    } else {
      i++;
    }
  }
  parts.push(buf.subarray(start));
  return parts;
}

const decoder = new TextDecoder('windows-1252');

function isAllZero(buf) {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

const EVENT_SUFFIX_RE = /\?([A-Za-z]+)\?(-?\d+)\?(-?\d+)$/;

// The subsystem field is usually a plain dotted namespace ("SI.Data.MetaX"), but
// for background-job/system-triggered entries it also embeds the acting user and a
// job description ahead of it, comma-separated (e.g.
// "workflowuser, (Job) Execute mass operations [351], SI.Biz.Core.MassOperation").
// We split that off so filtering/grouping works on the real subsystem name, while
// keeping the original string around for full context in the detail view.
function deriveSubsystemInfo(subsystem) {
  const parts = subsystem.split(',');
  const raw = parts[parts.length - 1].trim();
  const context = parts.length > 1 ? parts.slice(0, -1).join(',').trim() : null;
  const segments = raw.split('.');
  const area = segments.length >= 3 ? segments.slice(0, 2).join('.') : raw;
  return { subsystemRaw: raw, subsystemContext: context, subsystemArea: area };
}

export function parseTraceLog(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let body = bytes.subarray(HEADER_SIZE);

  const validLength = new DataView(arrayBuffer).getUint32(4, true);
  if (validLength > 0 && validLength <= body.length) {
    body = body.subarray(0, validLength);
  }

  const rawRecords = splitBytes(body, RECORD_SEP);

  const rows = [];
  let skipped = 0;

  for (const rec of rawRecords) {
    if (rec.length === 0 || isAllZero(rec)) continue;
    const fields = splitFieldSep(rec);
    if (fields.length !== FIELD_COUNT) {
      skipped++;
      continue;
    }
    const text = fields.map((f) => decoder.decode(f));
    const [severity, user, pid, subsystem, module, routine, rawMessage, level, tick, date, time] = text;

    let message = rawMessage;
    let eventLevel = null;
    const m = rawMessage.match(EVENT_SUFFIX_RE);
    if (m) {
      eventLevel = m[1];
      message = rawMessage.slice(0, m.index);
    }

    const { subsystemRaw, subsystemContext, subsystemArea } = deriveSubsystemInfo(subsystem);

    rows.push({
      severity,
      user,
      pid,
      subsystem,
      subsystemRaw,
      subsystemContext,
      subsystemArea,
      module,
      routine,
      message,
      rawMessage,
      eventLevel,
      level,
      tick: Number(tick),
      date,
      time,
    });
  }

  return { rows, skipped };
}
