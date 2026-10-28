/**
 * Structured JSON logging to stderr with secret redaction.
 *
 * stdout belongs to the stdio transport, so every log line goes to stderr. Each entry is one
 * JSON object per line. Values are passed through `redact` before serialisation, so a token that
 * ends up in a log call by mistake is masked rather than written out.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_KEY_RE = /(token|secret|password|passwd|authorization|api[_-]?key|cookie|credential|private[_-]?key|session)/i;

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bsk-(?:proj-|svcacct-|admin-|ant-)?[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bxox[abprse]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\bhf_[A-Za-z0-9]{30,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /(?<=\b(?:bearer|basic|token)\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
];
const PEM_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/g;
const PEM_END = /-----END [A-Z ]*PRIVATE KEY-----/g;

export const REDACTED = "[redacted]";

/**
 * Mask each PEM private key block, from a BEGIN line to the first END line after it. The
 * regular expression this replaces (BEGIN, a lazy match, END) rescanned the rest of the
 * text from every BEGIN marker, so many markers without an END took seconds; searching for
 * END once per block and stopping when there is none is linear.
 */
function redactPem(value: string): string {
  const parts: string[] = [];
  let pos = 0;
  for (;;) {
    PEM_BEGIN.lastIndex = pos;
    const begin = PEM_BEGIN.exec(value);
    if (begin === null) break;
    PEM_END.lastIndex = begin.index + begin[0].length;
    const end = PEM_END.exec(value);
    if (end === null) break;
    parts.push(value.slice(pos, begin.index), REDACTED);
    pos = end.index + end[0].length;
  }
  if (parts.length === 0) return value;
  parts.push(value.slice(pos));
  return parts.join("");
}

export function redactString(value: string): string {
  let out = redactPem(value);
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/** Deep-copy a value, masking secret-looking keys and token-looking strings. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (typeof value === "string") return redactString(value);
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_RE.test(key) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export function createLogger(
  level: LogLevel = "info",
  write: (line: string) => void = (line) => process.stderr.write(line + "\n"),
  base: Record<string, unknown> = {},
): Logger {
  const threshold = LEVELS[level];
  const emit = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    if (LEVELS[lvl] < threshold) return;
    const entry = {
      ts: new Date().toISOString(),
      level: lvl,
      msg: redactString(msg),
      ...(redact({ ...base, ...(fields ?? {}) }) as Record<string, unknown>),
    };
    write(JSON.stringify(entry));
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (fields) => createLogger(level, write, { ...base, ...fields }),
  };
}
