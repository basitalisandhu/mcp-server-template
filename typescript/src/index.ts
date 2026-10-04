#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadSettings } from "./config.js";
import { createLogger } from "./logger.js";
import { createServer } from "./server.js";
import { startHttp } from "./http.js";

async function main(): Promise<void> {
  const settings = loadSettings();
  const log = createLogger(settings.logLevel, undefined, { server: settings.serverName });
  log.info("starting", {
    transport: settings.transport,
    file_access: settings.allowedDirs.length > 0,
    network_access: settings.allowedHosts.length > 0,
  });
  if (settings.transport === "http") {
    await startHttp({ settings, log: log.child({ transport: "http" }) });
    return;
  }
  const server = createServer({ settings, log: log.child({ transport: "stdio" }) });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("stdio transport connected");
}

main().catch((err: unknown) => {
  // Settings errors are the usual cause; print them plainly on stderr and exit non-zero.
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(JSON.stringify({ level: "error", msg: message }) + "\n");
  process.exit(1);
});
