/**
 * Optional streamable HTTP transport.
 *
 * Off by default (MCP_TRANSPORT=stdio). When enabled it binds to 127.0.0.1 unless MCP_HOST says
 * otherwise, validates the Host header (DNS rebinding protection), requires a bearer token on
 * every MCP request, rate-limits per client address and caps the request body. Each request gets
 * its own server and transport (stateless mode), so nothing is shared between clients.
 */

import { timingSafeEqual, createHash } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import express, { type Request, type Response, type NextFunction } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { Settings } from "./config.js";
import type { Logger } from "./logger.js";
import { createServer, type ServerDeps } from "./server.js";

/** Verifies a single shared bearer token with a constant-time comparison. */
export class SharedTokenVerifier implements OAuthTokenVerifier {
  private readonly expected: Buffer;

  constructor(token: string) {
    this.expected = createHash("sha256").update(token).digest();
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const given = createHash("sha256").update(token).digest();
    if (!timingSafeEqual(given, this.expected)) {
      throw new InvalidTokenError("invalid token");
    }
    // One year: the shared token has no expiry of its own; rotate it by restarting the server.
    return { token: "[shared]", clientId: "shared-token", scopes: ["mcp"], expiresAt: Math.floor(Date.now() / 1000) + 365 * 24 * 3600 };
  }
}

/** Fixed-window rate limiter keyed by client address. In-memory, per process. */
export function rateLimit(perMinute: number, now: () => number = Date.now) {
  const windows = new Map<string, { start: number; count: number }>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const t = now();
    let w = windows.get(key);
    if (!w || t - w.start >= 60_000) {
      w = { start: t, count: 0 };
      windows.set(key, w);
    }
    w.count += 1;
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (t - v.start >= 60_000) windows.delete(k);
    }
    if (w.count > perMinute) {
      res.set("Retry-After", String(Math.ceil((w.start + 60_000 - t) / 1000)));
      res.status(429).json({ error: "rate_limited", message: `more than ${perMinute} requests per minute` });
      return;
    }
    next();
  };
}

export function createHttpApp(deps: ServerDeps): express.Express {
  const { settings, log } = deps;
  if (!settings.authToken) throw new Error("MCP_AUTH_TOKEN is required for the HTTP transport");
  const verifier = new SharedTokenVerifier(settings.authToken);

  const appOptions: Parameters<typeof createMcpExpressApp>[0] = { host: settings.host };
  if (settings.allowedHttpHosts.length > 0) appOptions.allowedHosts = [...settings.allowedHttpHosts];
  // createMcpExpressApp adds Host header validation (DNS rebinding protection) for loopback binds
  // and a JSON body parser; our stricter body limit below runs first because it is registered on
  // the same path before the MCP handler reads req.body.
  const app = createMcpExpressApp(appOptions);
  app.disable("x-powered-by");

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/mcp", rateLimit(settings.rateLimitPerMinute));
  app.use("/mcp", requireBearerAuth({ verifier }));
  app.use("/mcp", (req, res, next) => {
    const declared = Number.parseInt(req.headers["content-length"] ?? "0", 10);
    if (Number.isFinite(declared) && declared > settings.maxBodyBytes) {
      res.status(413).json({ error: "payload_too_large", message: `body larger than ${settings.maxBodyBytes} bytes` });
      return;
    }
    next();
  });

  app.post("/mcp", async (req, res) => {
    const server = createServer(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error("mcp request failed", { error: err });
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "internal error" }, id: null });
    }
  });

  // Stateless servers do not keep SSE streams or sessions, so GET and DELETE have nothing to serve.
  app.get("/mcp", (_req, res) => {
    res.status(405).set("Allow", "POST").json({ error: "method_not_allowed" });
  });
  app.delete("/mcp", (_req, res) => {
    res.status(405).set("Allow", "POST").json({ error: "method_not_allowed" });
  });

  app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === "entity.too.large" || err.status === 413) {
      res.status(413).json({ error: "payload_too_large" });
      return;
    }
    log.error("unhandled error", { error: err });
    res.status(err.status ?? 500).json({ error: "internal_error" });
  });
  return app;
}

export function startHttp(deps: ServerDeps): Promise<HttpServer> {
  const { settings, log } = deps;
  const app = createHttpApp(deps);
  return new Promise((resolve, reject) => {
    const server = app.listen(settings.port, settings.host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : settings.port;
      log.info("http transport listening", { host: settings.host, port, rate_limit_per_minute: settings.rateLimitPerMinute, max_body_bytes: settings.maxBodyBytes });
      resolve(server);
    });
    server.on("error", reject);
  });
}

export function logForHttp(log: Logger): Logger {
  return log.child({ transport: "http" });
}
