import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeUrl, fetchBounded, isPrivateAddress, UrlDeniedError, type NetworkPolicy } from "../src/safety/network.js";

const policy = (over: Partial<NetworkPolicy> = {}): NetworkPolicy => ({
  allowedHosts: ["docs.example.com", "api.example.com:8443"],
  allowPrivateNetworks: false,
  maxResponseBytes: 1000,
  timeoutMs: 2000,
  ...over,
});

describe("isPrivateAddress", () => {
  it("classifies loopback, private, link-local and public addresses", () => {
    for (const h of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "localhost", "foo.localhost", "db.internal"]) {
      expect(isPrivateAddress(h), h).toBe(true);
    }
    for (const h of ["8.8.8.8", "172.32.0.1", "93.184.216.34", "docs.example.com", "2606:4700::1111"]) {
      expect(isPrivateAddress(h), h).toBe(false);
    }
  });
});

describe("assertSafeUrl", () => {
  it("accepts allowlisted hosts and rejects everything else", () => {
    expect(assertSafeUrl("https://docs.example.com/page", policy()).hostname).toBe("docs.example.com");
    expect(assertSafeUrl("https://api.example.com:8443/v1", policy()).port).toBe("8443");
    expect(() => assertSafeUrl("https://api.example.com/v1", policy())).toThrow(UrlDeniedError);
    expect(() => assertSafeUrl("https://evil.example.com/", policy())).toThrow(/allowlist/);
    expect(() => assertSafeUrl("ftp://docs.example.com/", policy())).toThrow(/scheme/);
    expect(() => assertSafeUrl("file:///etc/passwd", policy())).toThrow(/scheme/);
    expect(() => assertSafeUrl("not a url", policy())).toThrow(/valid/);
    expect(() => assertSafeUrl("https://user:pw@docs.example.com/", policy())).toThrow(/credentials/);
    expect(() => assertSafeUrl("https://docs.example.com/", policy({ allowedHosts: [] }))).toThrow(/disabled/);
  });

  it("blocks private addresses unless explicitly allowed", () => {
    expect(() => assertSafeUrl("http://127.0.0.1:8080/", policy({ allowedHosts: ["127.0.0.1:8080"] }))).toThrow(/private/);
    expect(() => assertSafeUrl("http://169.254.169.254/latest/meta-data", policy({ allowedHosts: ["169.254.169.254"] }))).toThrow(/private/);
    expect(assertSafeUrl("http://127.0.0.1:8080/", policy({ allowedHosts: ["127.0.0.1:8080"], allowPrivateNetworks: true })).hostname).toBe("127.0.0.1");
  });
});

describe("fetchBounded", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/big") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.write("x".repeat(2500));
        res.end("x".repeat(2500));
      } else if (req.url === "/declared") {
        res.writeHead(200, { "content-type": "text/plain", "content-length": "5000" });
        res.end("x".repeat(5000));
      } else if (req.url === "/slow") {
        setTimeout(() => res.end("late"), 1500);
      } else if (req.url === "/redirect") {
        res.writeHead(302, { location: "http://169.254.169.254/" });
        res.end();
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const local = () => policy({ allowedHosts: [`127.0.0.1:${port}`], allowPrivateNetworks: true, timeoutMs: 500 });

  it("returns the body and content type", async () => {
    const url = assertSafeUrl(`http://127.0.0.1:${port}/ok`, local());
    const r = await fetchBounded(url, local());
    expect(r.status).toBe(200);
    expect(r.contentType).toContain("application/json");
    expect(JSON.parse(r.body)).toEqual({ ok: true });
    expect(r.truncated).toBe(false);
  });

  it("truncates oversized bodies and rejects oversized declared lengths", async () => {
    const r = await fetchBounded(assertSafeUrl(`http://127.0.0.1:${port}/big`, local()), local());
    expect(r.truncated).toBe(true);
    expect(r.body.length).toBe(1000);
    await expect(fetchBounded(assertSafeUrl(`http://127.0.0.1:${port}/declared`, local()), local())).rejects.toThrow(/larger than/);
  });

  it("times out and does not follow redirects", async () => {
    await expect(fetchBounded(assertSafeUrl(`http://127.0.0.1:${port}/slow`, local()), local())).rejects.toThrow(/timed out/);
    const r = await fetchBounded(assertSafeUrl(`http://127.0.0.1:${port}/redirect`, local()), local());
    expect(r.status).toBe(302);
    expect(r.body).toBe("");
  });
});
