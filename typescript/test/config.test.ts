import { describe, expect, it } from "vitest";
import { loadSettings, MIN_TOKEN_LENGTH } from "../src/config.js";
import { TEST_TOKEN } from "./helpers.js";

describe("settings", () => {
  it("defaults to stdio, loopback and no file or network access", () => {
    const s = loadSettings({});
    expect(s.transport).toBe("stdio");
    expect(s.host).toBe("127.0.0.1");
    expect(s.allowedDirs).toEqual([]);
    expect(s.allowedHosts).toEqual([]);
    expect(s.allowPrivateNetworks).toBe(false);
    expect(s.rateLimitPerMinute).toBeGreaterThan(0);
  });

  it("requires a long token for the http transport", () => {
    expect(() => loadSettings({ MCP_TRANSPORT: "http" })).toThrow(/MCP_AUTH_TOKEN/);
    expect(() => loadSettings({ MCP_TRANSPORT: "http", MCP_AUTH_TOKEN: "short" })).toThrow(new RegExp(String(MIN_TOKEN_LENGTH)));
    expect(loadSettings({ MCP_TRANSPORT: "http", MCP_AUTH_TOKEN: TEST_TOKEN }).authToken).toBe(TEST_TOKEN);
  });

  it("parses lists and bounded integers", () => {
    const s = loadSettings({ MCP_ALLOWED_DIRS: "/a, /b", MCP_ALLOWED_HOSTS: "Docs.Example.com,api.example.com:8443", MCP_PORT: "8080", MCP_RATE_LIMIT_PER_MINUTE: "5" });
    expect(s.allowedDirs).toEqual(["/a", "/b"]);
    expect(s.allowedHosts).toEqual(["docs.example.com", "api.example.com:8443"]);
    expect(s.port).toBe(8080);
    expect(s.rateLimitPerMinute).toBe(5);
    expect(() => loadSettings({ MCP_PORT: "70000" })).toThrow(/MCP_PORT/);
    expect(() => loadSettings({ MCP_TRANSPORT: "sse" })).toThrow(/MCP_TRANSPORT/);
    expect(() => loadSettings({ LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
  });
});
