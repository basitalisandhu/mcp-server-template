/**
 * Runtime settings, read once from the environment at start-up.
 *
 * Every security-relevant default is the safe one: stdio transport, HTTP bound to loopback,
 * no file system roots, no network hosts, private networks blocked.
 */

export type Transport = "stdio" | "http";

export interface Settings {
  readonly serverName: string;
  readonly serverVersion: string;
  readonly transport: Transport;
  /** Interface the HTTP transport binds to. Loopback unless MCP_HOST says otherwise. */
  readonly host: string;
  readonly port: number;
  /** Shared bearer token for the HTTP transport. Required when transport is "http". */
  readonly authToken: string | undefined;
  /** Host names (with optional port) the HTTP transport accepts in the Host header. */
  readonly allowedHttpHosts: readonly string[];
  /** Directories the file tools may read. Empty means the file tools refuse every path. */
  readonly allowedDirs: readonly string[];
  /** Hosts (optionally host:port) the fetch tool may contact. Empty means the tool is disabled. */
  readonly allowedHosts: readonly string[];
  /** Let the fetch tool reach loopback and private ranges. Off by default (SSRF guard). */
  readonly allowPrivateNetworks: boolean;
  readonly maxFileBytes: number;
  readonly maxResponseBytes: number;
  readonly fetchTimeoutMs: number;
  /** HTTP request body cap for the MCP endpoint. */
  readonly maxBodyBytes: number;
  /** Requests per minute per client address on the HTTP transport. */
  readonly rateLimitPerMinute: number;
  readonly logLevel: "debug" | "info" | "warn" | "error";
}

export const MIN_TOKEN_LENGTH = 32;

function intFrom(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function listFrom(env: NodeJS.ProcessEnv, key: string): string[] {
  const raw = env[key];
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function boolFrom(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const transportRaw = (env["MCP_TRANSPORT"] ?? "stdio").toLowerCase();
  if (transportRaw !== "stdio" && transportRaw !== "http") {
    throw new Error('MCP_TRANSPORT must be "stdio" or "http"');
  }
  const transport: Transport = transportRaw;
  const host = env["MCP_HOST"] ?? "127.0.0.1";
  const authToken = env["MCP_AUTH_TOKEN"];
  if (transport === "http") {
    if (!authToken || authToken.length < MIN_TOKEN_LENGTH) {
      throw new Error(
        `MCP_AUTH_TOKEN must be set to at least ${MIN_TOKEN_LENGTH} characters when MCP_TRANSPORT=http ` +
          "(generate one with: openssl rand -hex 32)",
      );
    }
  }
  const logLevelRaw = (env["LOG_LEVEL"] ?? "info").toLowerCase();
  if (!["debug", "info", "warn", "error"].includes(logLevelRaw)) {
    throw new Error("LOG_LEVEL must be debug, info, warn or error");
  }
  return {
    serverName: env["MCP_SERVER_NAME"] ?? "secure-mcp-server",
    serverVersion: env["MCP_SERVER_VERSION"] ?? "0.2.0",
    transport,
    host,
    port: intFrom(env, "MCP_PORT", 3000, 0, 65535),
    authToken,
    allowedHttpHosts: listFrom(env, "MCP_ALLOWED_HTTP_HOSTS"),
    allowedDirs: listFrom(env, "MCP_ALLOWED_DIRS"),
    allowedHosts: listFrom(env, "MCP_ALLOWED_HOSTS").map((h) => h.toLowerCase()),
    allowPrivateNetworks: boolFrom(env, "MCP_ALLOW_PRIVATE_NETWORKS", false),
    maxFileBytes: intFrom(env, "MCP_MAX_FILE_BYTES", 1_000_000, 1, 100_000_000),
    maxResponseBytes: intFrom(env, "MCP_MAX_RESPONSE_BYTES", 1_000_000, 1, 100_000_000),
    fetchTimeoutMs: intFrom(env, "MCP_FETCH_TIMEOUT_MS", 10_000, 100, 120_000),
    maxBodyBytes: intFrom(env, "MCP_MAX_BODY_BYTES", 1_000_000, 1024, 100_000_000),
    rateLimitPerMinute: intFrom(env, "MCP_RATE_LIMIT_PER_MINUTE", 120, 1, 100_000),
    logLevel: logLevelRaw as Settings["logLevel"],
  };
}
