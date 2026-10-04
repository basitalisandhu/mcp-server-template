import { describe, expect, it } from "vitest";
import { createLogger, redact, redactString, REDACTED } from "../src/logger.js";

describe("logger redaction", () => {
  it("masks secret-looking keys", () => {
    const out = redact({ authorization: "Bearer abc", api_key: "k", nested: { password: "p", ok: "fine" } }) as Record<string, unknown>;
    expect(out["authorization"]).toBe(REDACTED);
    expect(out["api_key"]).toBe(REDACTED);
    expect((out["nested"] as Record<string, unknown>)["password"]).toBe(REDACTED);
    expect((out["nested"] as Record<string, unknown>)["ok"]).toBe("fine");
  });

  it("masks token-looking values inside strings", () => {
    const gh = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0";
    expect(redactString(`token ${gh} here`)).not.toContain(gh);
    expect(redactString("Authorization: Bearer abcdefghijklmnopqrstuvwxyz")).toContain(REDACTED);
    expect(redactString("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----")).toBe(REDACTED);
    expect(redactString("plain text")).toBe("plain text");
  });

  it("writes one JSON object per line to the sink, honouring the level", () => {
    const lines: string[] = [];
    const log = createLogger("info", (l) => lines.push(l), { server: "t" });
    log.debug("hidden");
    log.info("shown", { secret: "x", count: 2 });
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(entry["msg"]).toBe("shown");
    expect(entry["secret"]).toBe(REDACTED);
    expect(entry["count"]).toBe(2);
    expect(entry["server"]).toBe("t");
    expect(typeof entry["ts"]).toBe("string");
  });

  it("serialises errors without stack traces", () => {
    const out = redact(new Error("boom sk-ant-" + "x".repeat(40))) as Record<string, unknown>;
    expect(out["name"]).toBe("Error");
    expect(out["message"]).toContain(REDACTED);
    expect(out["stack"]).toBeUndefined();
  });
});
