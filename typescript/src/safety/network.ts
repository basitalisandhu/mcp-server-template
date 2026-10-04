/**
 * Bounded network access for the fetch tool.
 *
 * Only http(s) URLs whose host is on the allowlist are contacted; loopback, link-local and
 * private ranges are refused unless explicitly enabled; redirects are not followed; responses
 * are capped in size and time. These are the server-side request forgery (SSRF) controls.
 */

import { isIP } from "node:net";

export class UrlDeniedError extends Error {
  override readonly name = "UrlDeniedError";
}

export interface NetworkPolicy {
  readonly allowedHosts: readonly string[];
  readonly allowPrivateNetworks: boolean;
  readonly maxResponseBytes: number;
  readonly timeoutMs: number;
}

export function isPrivateAddress(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const version = isIP(h);
  if (version === 4) {
    const [a = 0, b = 0] = h.split(".").map((n) => Number.parseInt(n, 10));
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (version === 6) {
    return (
      h === "::" ||
      h === "::1" ||
      h.startsWith("fe80:") ||
      h.startsWith("fc") ||
      h.startsWith("fd") ||
      h.startsWith("::ffff:")
    );
  }
  return false;
}

/** Validate a model-supplied URL against the policy and return the parsed URL. */
export function assertSafeUrl(raw: string, policy: NetworkPolicy): URL {
  if (policy.allowedHosts.length === 0) {
    throw new UrlDeniedError("network access is disabled: no allowed hosts configured");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlDeniedError("not a valid absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlDeniedError(`scheme not allowed: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new UrlDeniedError("credentials in URLs are not allowed");
  }
  const hostname = url.hostname.toLowerCase();
  const hostWithPort = url.port ? `${hostname}:${url.port}` : hostname;
  const allowed = policy.allowedHosts.some((h) => h === hostname || h === hostWithPort);
  if (!allowed) {
    throw new UrlDeniedError(`host not on the allowlist: ${hostname}`);
  }
  if (!policy.allowPrivateNetworks && isPrivateAddress(hostname)) {
    throw new UrlDeniedError("private and loopback addresses are blocked");
  }
  return url;
}

export interface FetchResult {
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
}

/** GET a URL that passed `assertSafeUrl`, with a timeout, a size cap and no redirects. */
export async function fetchBounded(url: URL, policy: NetworkPolicy, fetchImpl: typeof fetch = fetch): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "text/*, application/json;q=0.9, */*;q=0.1", "user-agent": "secure-mcp-server/0.1" },
    });
    const contentType = response.headers.get("content-type") ?? "";
    const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(declared) && declared > policy.maxResponseBytes) {
      throw new UrlDeniedError(`response larger than ${policy.maxResponseBytes} bytes`);
    }
    const reader = response.body?.getReader();
    if (!reader) return { status: response.status, contentType, body: "", truncated: false };
    const chunks: Uint8Array[] = [];
    let received = 0;
    let truncated = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      received += value.byteLength;
      if (received > policy.maxResponseBytes) {
        truncated = true;
        chunks.push(value.subarray(0, value.byteLength - (received - policy.maxResponseBytes)));
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks).toString("utf8");
    return { status: response.status, contentType, body, truncated };
  } catch (err) {
    if (err instanceof UrlDeniedError) throw err;
    if ((err as Error).name === "AbortError") throw new UrlDeniedError(`request timed out after ${policy.timeoutMs} ms`);
    throw new UrlDeniedError(`request failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
