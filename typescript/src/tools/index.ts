/**
 * Tool registrations.
 *
 * Every tool has a fixed, reviewed description (the model reads it, so it is part of the attack
 * surface), a strict zod input schema, read-only annotations and structured output. Model-supplied
 * values never reach the file system or the network without passing the safety helpers.
 */

import path from "node:path";
import { promises as fs } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Settings } from "../config.js";
import type { Logger } from "../logger.js";
import { PathDeniedError, readBounded, resolveInside } from "../safety/paths.js";
import { assertSafeUrl, fetchBounded, UrlDeniedError, type NetworkPolicy } from "../safety/network.js";

const startedAt = Date.now();

export interface ToolDeps {
  settings: Settings;
  log: Logger;
  fetchImpl?: typeof fetch;
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

function toolError(err: unknown): ReturnType<typeof errorResult> {
  if (err instanceof PathDeniedError || err instanceof UrlDeniedError) return errorResult(err.message);
  if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") return errorResult("not found");
  return errorResult("internal error");
}

export function registerTools(server: McpServer, deps: ToolDeps): void {
  const { settings, log } = deps;
  const policy: NetworkPolicy = {
    allowedHosts: settings.allowedHosts,
    allowPrivateNetworks: settings.allowPrivateNetworks,
    maxResponseBytes: settings.maxResponseBytes,
    timeoutMs: settings.fetchTimeoutMs,
  };

  server.registerTool(
    "health",
    {
      title: "Health",
      description: "Report the server's name, version, transport, uptime and which optional capabilities are enabled. Takes no input and changes nothing.",
      inputSchema: {},
      outputSchema: {
        status: z.literal("ok"),
        name: z.string(),
        version: z.string(),
        transport: z.string(),
        uptime_seconds: z.number(),
        file_access: z.boolean(),
        network_access: z.boolean(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const output = {
        status: "ok" as const,
        name: settings.serverName,
        version: settings.serverVersion,
        transport: settings.transport,
        uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
        file_access: settings.allowedDirs.length > 0,
        network_access: settings.allowedHosts.length > 0,
      };
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    },
  );

  server.registerTool(
    "read_file",
    {
      title: "Read file",
      description: "Read a UTF-8 text file from one of the directories this server was configured to expose (MCP_ALLOWED_DIRS). Paths are resolved inside those directories; symlinks that point outside are refused; files larger than the configured cap are refused.",
      inputSchema: {
        path: z.string().min(1).max(4096).describe("File path, relative to an allowed directory or absolute inside one"),
      },
      outputSchema: { path: z.string(), bytes: z.number(), content: z.string() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path: requested }) => {
      try {
        const resolved = await resolveInside(settings.allowedDirs, requested);
        const content = await readBounded(resolved, settings.maxFileBytes);
        log.info("read_file", { path: resolved, bytes: Buffer.byteLength(content) });
        const output = { path: resolved, bytes: Buffer.byteLength(content), content };
        return { content: [{ type: "text", text: content }], structuredContent: output };
      } catch (err) {
        log.warn("read_file refused", { path: requested, error: err });
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "list_directory",
    {
      title: "List directory",
      description: "List the entries of a directory inside one of the allowed directories (MCP_ALLOWED_DIRS). Returns names and types only; never follows symlinks outside the allowed roots.",
      inputSchema: {
        path: z.string().min(1).max(4096).describe("Directory path, relative to an allowed directory or absolute inside one"),
      },
      outputSchema: { path: z.string(), entries: z.array(z.object({ name: z.string(), type: z.enum(["file", "directory", "other"]) })) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path: requested }) => {
      try {
        const resolved = await resolveInside(settings.allowedDirs, requested);
        const dirents = await fs.readdir(resolved, { withFileTypes: true });
        const entries = dirents
          .slice(0, 1000)
          .map((d) => ({ name: d.name, type: d.isFile() ? ("file" as const) : d.isDirectory() ? ("directory" as const) : ("other" as const) }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const output = { path: resolved, entries };
        return { content: [{ type: "text", text: entries.map((e) => `${e.type === "directory" ? "d" : "-"} ${path.posix.basename(e.name)}`).join("\n") }], structuredContent: output };
      } catch (err) {
        log.warn("list_directory refused", { path: requested, error: err });
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "fetch_url",
    {
      title: "Fetch URL",
      description: "GET an http(s) URL whose host is on this server's allowlist (MCP_ALLOWED_HOSTS) and return the body as text. Private and loopback addresses are blocked, redirects are not followed, and the response is capped in size and time.",
      inputSchema: {
        url: z.string().url().max(2048).describe("Absolute http or https URL on an allowlisted host"),
      },
      outputSchema: { url: z.string(), status: z.number(), content_type: z.string(), truncated: z.boolean(), body: z.string() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ url: requested }) => {
      try {
        const url = assertSafeUrl(requested, policy);
        const result = await fetchBounded(url, policy, deps.fetchImpl);
        log.info("fetch_url", { host: url.hostname, status: result.status, bytes: result.body.length, truncated: result.truncated });
        const output = { url: url.toString(), status: result.status, content_type: result.contentType, truncated: result.truncated, body: result.body };
        return { content: [{ type: "text", text: result.body }], structuredContent: output };
      } catch (err) {
        log.warn("fetch_url refused", { url: requested, error: err });
        return toolError(err);
      }
    },
  );
}
