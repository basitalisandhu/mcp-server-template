// Seeded fuzz and scaling tests for every reader of untrusted input. URLs, paths and log
// values come from a model that reads untrusted text: they must be refused with the
// module's own error, never another exception, and never slowly. The private-address table
// in test-cases/private-addresses.json is shared with the Python tests.
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { redact, redactString } from "../src/logger.js";
import { assertSafeUrl, isPrivateAddress, UrlDeniedError, type NetworkPolicy } from "../src/safety/network.js";
import { PathDeniedError, readBounded, resolveInside } from "../src/safety/paths.js";

const cases = JSON.parse(readFileSync(new URL("../../test-cases/private-addresses.json", import.meta.url), "utf8")) as { hosts: Record<string, boolean> };

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function mutate(next: () => number, text: string): string {
  const chars = [...text];
  const n = 1 + Math.floor(next() * 5);
  for (let i = 0; i < n; i++) {
    const pos = Math.floor(next() * (chars.length + 1));
    const op = next();
    if (op < 0.4) chars.splice(pos, 0, "[]:@/\\%?#. \t\u0000é0x9"[Math.floor(next() * 19)]!);
    else if (op < 0.7) chars.splice(pos, 1);
    else chars.splice(pos, 0, ...chars.slice(pos, pos + 1 + Math.floor(next() * 7)));
  }
  return chars.join("");
}

describe("private-address table shared with Python", () => {
  for (const [host, isPrivate] of Object.entries(cases.hosts)) {
    it(`${host} is ${isPrivate ? "private" : "public"}`, () => {
      expect(isPrivateAddress(host)).toBe(isPrivate);
    });
  }
});

describe("assertSafeUrl", () => {
  const policy: NetworkPolicy = {
    allowedHosts: ["docs.example.com", "127.1", "2130706433", "0x7f.1", "localhost.", "[::1]", "::1"],
    allowPrivateNetworks: false,
    maxResponseBytes: 1000,
    timeoutMs: 1000,
  };

  it("only ever throws UrlDeniedError, and never lets a private address through", () => {
    const next = rng(9728);
    const seeds = ["https://docs.example.com/a?b=c", "http://[::1]:8080/", "http://127.1/", "http://user:pw@docs.example.com/", "https://docs.example.com:443/x"];
    for (let i = 0; i < 5000; i++) {
      const url = mutate(next, seeds[Math.floor(next() * seeds.length)]!);
      let parsed: URL;
      try {
        parsed = assertSafeUrl(url, policy);
      } catch (error) {
        expect(error, url).toBeInstanceOf(UrlDeniedError);
        continue;
      }
      expect(isPrivateAddress(parsed.hostname), url).toBe(false);
    }
  });

  it.each(["http://127.1/", "http://2130706433/", "http://0x7f.1/", "http://localhost./", "http://[::1"])("denies %s even when allowlisted", (url) => {
    expect(() => assertSafeUrl(url, policy)).toThrow(UrlDeniedError);
  });
});

describe("resolveInside", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "template-fuzz-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  symlinkSync("loop", path.join(dir, "loop"));
  symlinkSync(path.join(dir, "b"), path.join(dir, "a"));
  symlinkSync(path.join(dir, "a"), path.join(dir, "b"));
  writeFileSync(path.join(dir, "bin.dat"), Buffer.from(Array.from({ length: 2560 }, (_, i) => i % 256)));

  it("only ever throws PathDeniedError or a not-found error, and stays inside the root", async () => {
    const next = rng(7);
    const requests = ["loop", "loop/x", "a/b/c", "x".repeat(300), "y/".repeat(3000), "..\\..", "bin.dat", ""];
    for (let i = 0; i < 300; i++) requests.push(Array.from({ length: Math.floor(next() * 30) }, () => "./ab\\~\u0001é"[Math.floor(next() * 9)]).join(""));
    const realRoot = await import("node:fs/promises").then((fs) => fs.realpath(dir));
    for (const requested of requests) {
      let resolved: string;
      try {
        resolved = await resolveInside([dir], requested);
      } catch (error) {
        expect(error, requested).toBeInstanceOf(PathDeniedError);
        continue;
      }
      expect(path.relative(realRoot, resolved).startsWith(".."), requested).toBe(false);
      try {
        await readBounded(resolved, 1_000_000);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        expect(error instanceof PathDeniedError || ["ENOENT", "ENOTDIR", "ELOOP", "ENAMETOOLONG", "EISDIR"].includes(code ?? ""), `${requested}: ${String(error)}`).toBe(true);
      }
    }
  });
});

describe("redaction", () => {
  it("handles deep values", () => {
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 100_000; i++) {
      const child = {};
      deep.a = child;
      deep = child;
    }
    expect(JSON.stringify(redact(root))).toContain("[truncated]");
  });

  it("redacts PEM blocks in linear time", () => {
    // 20,000 BEGIN markers with no END took about 2 s with the lazy regular expression.
    const text = ("-----BEGIN RSA PRIVATE " + "KEY-----").repeat(20_000);
    const started = performance.now();
    expect(redactString(text)).toBe(text);
    expect(performance.now() - started).toBeLessThan(500);
    // Built from parts so secret scanners do not read the test as a committed key.
    const key = ["-----BEGIN", "EC PRIVATE", "KEY-----\nnot-a-key\n-----END", "EC PRIVATE", "KEY-----"].join(" ").replace(/ \n/g, "\n").replace(/\n /g, "\n");
    expect(redactString(`a ${key} b ${key} c`)).toBe("a [redacted] b [redacted] c");
  });
});
