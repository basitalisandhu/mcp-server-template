import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { audited, auditOutcome, auditTarget, markInternalError } from "../src/audit.js";
import { captureLogger, connectedClient, testSettings } from "./helpers.js";

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-audit-"));
  await fs.writeFile(path.join(root, "notes.txt"), "secret file content\n");
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function auditEntries(lines: string[]): Record<string, unknown>[] {
  return lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((e) => e["event"] === "audit");
}

describe("audit log", () => {
  it("writes exactly one entry per call, with the resolved target and no content", async () => {
    const { client, lines, close } = await connectedClient(testSettings({ MCP_ALLOWED_DIRS: root }));
    await client.callTool({ name: "read_file", arguments: { path: "notes.txt" } });
    const entries = auditEntries(lines);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry["tool"]).toBe("read_file");
    expect(entry["outcome"]).toBe("ok");
    expect(entry["target"]).toBe(await fs.realpath(path.join(root, "notes.txt")));
    expect(typeof entry["duration_ms"]).toBe("number");
    expect(entry["client_id"]).toBeNull();
    expect(JSON.stringify(entry)).not.toContain("secret file content");
    await close();
  });

  it("records a refusal without the requested value", async () => {
    const { client, lines, close } = await connectedClient(testSettings({ MCP_ALLOWED_DIRS: root }));
    await client.callTool({ name: "read_file", arguments: { path: "../../../etc/passwd" } });
    const [entry] = auditEntries(lines);
    expect(entry?.["outcome"]).toBe("refused");
    expect(entry?.["target"]).toBeNull();
    expect(JSON.stringify(entry)).not.toContain("passwd");
    await close();
  });

  it("records the host, not the URL, for fetch_url", async () => {
    const fetchImpl: typeof fetch = async () => new Response("response body", { status: 200, headers: { "content-type": "text/plain" } });
    const { client, lines, close } = await connectedClient(testSettings({ MCP_ALLOWED_HOSTS: "docs.example.com" }), fetchImpl);
    await client.callTool({ name: "fetch_url", arguments: { url: "https://docs.example.com/page?q=private" } });
    await client.callTool({ name: "health", arguments: {} });
    const entries = auditEntries(lines);
    expect(entries.map((e) => [e["tool"], e["outcome"], e["target"]])).toEqual([
      ["fetch_url", "ok", "docs.example.com"],
      ["health", "ok", null],
    ]);
    expect(JSON.stringify(entries)).not.toContain("private");
    expect(JSON.stringify(entries)).not.toContain("response body");
    await close();
  });

  it("classifies outcomes and reads the client id from authInfo", async () => {
    expect(auditOutcome({})).toBe("ok");
    expect(auditOutcome({ isError: true })).toBe("refused");
    expect(auditOutcome(markInternalError({ isError: true }))).toBe("error");
    expect(auditTarget({ structuredContent: { url: "not a url" } })).toBeNull();
    const { log, lines } = captureLogger();
    const handler = audited("t", log, async (_args: unknown, _extra: unknown) => ({ structuredContent: { path: "/x" } }));
    await handler({}, { authInfo: { clientId: "shared-token" } });
    const failing = audited("boom", log, async () => {
      throw new Error("raw detail");
    });
    await expect(failing({}, {})).rejects.toThrow("raw detail");
    const entries = auditEntries(lines);
    expect(entries.map((e) => [e["tool"], e["outcome"], e["client_id"], e["target"]])).toEqual([
      ["t", "ok", "shared-token", "/x"],
      ["boom", "error", null, null],
    ]);
    expect(JSON.stringify(entries)).not.toContain("raw detail");
  });
});
