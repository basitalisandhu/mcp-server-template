import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectedClient, testSettings } from "./helpers.js";

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-tools-"));
  await fs.writeFile(path.join(root, "notes.txt"), "line one\nline two\n");
  await fs.mkdir(path.join(root, "dir"));
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("tools over an in-memory transport", () => {
  it("lists exactly the four read-only tools with fixed descriptions", async () => {
    const { client, close } = await connectedClient(testSettings());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["fetch_url", "health", "list_directory", "read_file"]);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.description?.length ?? 0).toBeGreaterThan(20);
      expect(t.inputSchema).toBeDefined();
    }
    await close();
  });

  it("health reports capabilities", async () => {
    const { client, close } = await connectedClient(testSettings({ MCP_ALLOWED_DIRS: root }));
    const result = await client.callTool({ name: "health", arguments: {} });
    const out = result.structuredContent as Record<string, unknown>;
    expect(out["status"]).toBe("ok");
    expect(out["file_access"]).toBe(true);
    expect(out["network_access"]).toBe(false);
    expect(out["transport"]).toBe("stdio");
    await close();
  });

  it("read_file is bounded to the allowed directories", async () => {
    const { client, lines, close } = await connectedClient(testSettings({ MCP_ALLOWED_DIRS: root, MCP_MAX_FILE_BYTES: "20" }));
    const ok = await client.callTool({ name: "read_file", arguments: { path: "notes.txt" } });
    expect(ok.isError).toBeFalsy();
    expect((ok.structuredContent as { content: string }).content).toBe("line one\nline two\n");
    const escape = await client.callTool({ name: "read_file", arguments: { path: "../../../etc/passwd" } });
    expect(escape.isError).toBe(true);
    expect(JSON.stringify(escape.content)).toContain("outside the allowed directories");
    await fs.writeFile(path.join(root, "big.txt"), "x".repeat(21));
    const big = await client.callTool({ name: "read_file", arguments: { path: "big.txt" } });
    expect(big.isError).toBe(true);
    const missing = await client.callTool({ name: "read_file", arguments: { path: "nope.txt" } });
    expect(missing.isError).toBe(true);
    expect(JSON.stringify(missing.content)).toContain("not found");
    expect(lines.some((l) => l.includes("read_file refused"))).toBe(true);
    await close();
  });

  it("read_file refuses everything when no directories are configured", async () => {
    const { client, close } = await connectedClient(testSettings());
    const r = await client.callTool({ name: "read_file", arguments: { path: "notes.txt" } });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toContain("disabled");
    await close();
  });

  it("rejects input that fails the schema before the handler runs", async () => {
    const { client, lines, close } = await connectedClient(testSettings({ MCP_ALLOWED_DIRS: root }));
    const empty = await client.callTool({ name: "read_file", arguments: { path: "" } });
    expect(empty.isError).toBe(true);
    expect(JSON.stringify(empty.content)).toMatch(/validation/i);
    const missing = await client.callTool({ name: "read_file", arguments: { nope: 1 } });
    expect(missing.isError).toBe(true);
    expect(lines.some((l) => l.includes("read_file refused"))).toBe(false);
    await close();
  });

  it("list_directory returns sorted entries", async () => {
    const { client, close } = await connectedClient(testSettings({ MCP_ALLOWED_DIRS: root }));
    const r = await client.callTool({ name: "list_directory", arguments: { path: "." } });
    const out = r.structuredContent as { entries: { name: string; type: string }[] };
    expect(out.entries.map((e) => e.name)).toContain("notes.txt");
    expect(out.entries.find((e) => e.name === "dir")?.type).toBe("directory");
    await close();
  });

  it("fetch_url is disabled without an allowlist and uses the policy with one", async () => {
    const { client, close } = await connectedClient(testSettings());
    const off = await client.callTool({ name: "fetch_url", arguments: { url: "https://docs.example.com/" } });
    expect(off.isError).toBe(true);
    await close();

    const fetchImpl: typeof fetch = async (input) => new Response("body text", { status: 200, headers: { "content-type": "text/plain", "x-url": String(input) } });
    const on = await connectedClient(testSettings({ MCP_ALLOWED_HOSTS: "docs.example.com" }), fetchImpl);
    const ok = await on.client.callTool({ name: "fetch_url", arguments: { url: "https://docs.example.com/page" } });
    expect(ok.isError).toBeFalsy();
    expect((ok.structuredContent as { body: string }).body).toBe("body text");
    const denied = await on.client.callTool({ name: "fetch_url", arguments: { url: "https://evil.example.com/" } });
    expect(denied.isError).toBe(true);
    const meta = await on.client.callTool({ name: "fetch_url", arguments: { url: "http://169.254.169.254/latest" } });
    expect(meta.isError).toBe(true);
    await on.close();
  });
});
