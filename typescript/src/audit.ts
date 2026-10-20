/**
 * One audit log entry per tool call, in one shape a SIEM can parse.
 *
 * `audited` wraps a tool handler. After the handler returns it writes a single `audit` entry with
 * the tool name, the outcome (`ok`, `refused` or `error`), the duration, the client id on the HTTP
 * transport and, for successful calls, the resolved target (the real path, or the host of the
 * URL). Argument values, file contents and response bodies are never part of the entry; a refused
 * call has no target because the model-supplied value was not accepted.
 */

import type { Logger } from "./logger.js";

export type AuditOutcome = "ok" | "refused" | "error";

interface ToolResultLike {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

/** Error results for unexpected failures, as opposed to deliberate refusals. */
const internalErrors = new WeakSet<object>();

/** Mark a result as an unexpected failure, so the audit entry says `error` rather than `refused`. */
export function markInternalError<T extends object>(result: T): T {
  internalErrors.add(result);
  return result;
}

export function auditTarget(result: ToolResultLike): string | null {
  if (result.isError) return null;
  const out = result.structuredContent;
  if (!out) return null;
  if (typeof out["path"] === "string") return out["path"];
  if (typeof out["url"] === "string") {
    try {
      return new URL(out["url"]).host;
    } catch {
      return null;
    }
  }
  return null;
}

export function auditOutcome(result: ToolResultLike): AuditOutcome {
  if (!result.isError) return "ok";
  return internalErrors.has(result) ? "error" : "refused";
}

// The SDK passes `extra` (with `authInfo` on the HTTP transport) as the last callback argument.
type Handler = (...args: any[]) => Promise<any>;

export function audited<H extends Handler>(tool: string, log: Logger, handler: H): H {
  const wrapped = async (...args: unknown[]) => {
    const extra = args[args.length - 1] as { authInfo?: { clientId?: string } } | undefined;
    const start = performance.now();
    let result: ToolResultLike;
    try {
      result = await handler(...args);
    } catch (err) {
      log.info("audit", {
        event: "audit",
        tool,
        outcome: "error",
        duration_ms: Math.round(performance.now() - start),
        client_id: extra?.authInfo?.clientId ?? null,
        target: null,
      });
      throw err;
    }
    log.info("audit", {
      event: "audit",
      tool,
      outcome: auditOutcome(result),
      duration_ms: Math.round(performance.now() - start),
      client_id: extra?.authInfo?.clientId ?? null,
      target: auditTarget(result),
    });
    return result;
  };
  return wrapped as H;
}
