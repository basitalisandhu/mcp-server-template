import http, { type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpApp, rateLimit, SharedTokenVerifier } from "../src/http.js";
import { captureLogger, TEST_TOKEN, testSettings } from "./helpers.js";

let server: Server;
let base: string;
let lines: string[];

beforeAll(async () => {
  const settings = testSettings({ MCP_TRANSPORT: "http", MCP_AUTH_TOKEN: TEST_TOKEN, MCP_PORT: "0", MCP_RATE_LIMIT_PER_MINUTE: "50", MCP_MAX_BODY_BYTES: "2048" });
  const captured = captureLogger();
  lines = captured.lines;
  const app = createHttpApp({ settings, log: captured.log });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as { port: number };
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const initialize = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });

describe("http transport", () => {
  it("serves an unauthenticated health endpoint only", async () => {
    const r = await fetch(`${base}/healthz`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "ok" });
  });

  it("rejects requests without or with a wrong bearer token", async () => {
    const none = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: initialize });
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toContain("Bearer");
    const wrong = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer " + "x".repeat(48) }, body: initialize });
    expect(wrong.status).toBe(401);
    const basic = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: "Basic abc" }, body: initialize });
    expect(basic.status).toBe(401);
  });

  it("rejects a Host header that is not loopback (DNS rebinding protection)", async () => {
    // fetch() drops a custom Host header, so use node:http to send one.
    const { port } = new URL(base);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port: Number(port), path: "/mcp", method: "POST", headers: { host: "evil.example.com", "content-type": "application/json", authorization: `Bearer ${TEST_TOKEN}`, "content-length": Buffer.byteLength(initialize) } },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.end(initialize);
    });
    expect(status).toBe(403);
  });

  it("rejects bodies over the limit", async () => {
    const big = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { pad: "x".repeat(3000) } });
    const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TEST_TOKEN}` }, body: big });
    expect(r.status).toBe(413);
  });

  it("answers GET and DELETE with 405 in stateless mode", async () => {
    const r = await fetch(`${base}/mcp`, { method: "GET", headers: { authorization: `Bearer ${TEST_TOKEN}` } });
    expect(r.status).toBe(405);
  });

  it("completes a full MCP session with the SDK client and the right token", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${TEST_TOKEN}` } } });
    const client = new Client({ name: "test", version: "0" });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("health");
    const health = await client.callTool({ name: "health", arguments: {} });
    expect((health.structuredContent as { transport: string }).transport).toBe("http");
    await client.close();
    expect(lines.some((l) => l.includes(TEST_TOKEN))).toBe(false);
  });

  it("rate-limits per client address", async () => {
    let clock = 0;
    const limiter = rateLimit(2, () => clock);
    const statuses: number[] = [];
    const mkRes = () => ({ status: (s: number) => ({ json: () => statuses.push(s) }), set: () => undefined }) as never;
    const req = { ip: "10.0.0.1", socket: { remoteAddress: "10.0.0.1" } } as never;
    let passed = 0;
    for (let i = 0; i < 4; i++) limiter(req, mkRes(), () => passed++);
    expect(passed).toBe(2);
    expect(statuses).toEqual([429, 429]);
    clock = 61_000;
    limiter(req, mkRes(), () => passed++);
    expect(passed).toBe(3);
  });

  it("verifier accepts only the exact token", async () => {
    const v = new SharedTokenVerifier(TEST_TOKEN);
    const info = await v.verifyAccessToken(TEST_TOKEN);
    expect(info.clientId).toBe("shared-token");
    expect(info.token).not.toBe(TEST_TOKEN);
    await expect(v.verifyAccessToken(TEST_TOKEN + "x")).rejects.toThrow(/invalid token/);
    await expect(v.verifyAccessToken("")).rejects.toThrow();
  });
});
