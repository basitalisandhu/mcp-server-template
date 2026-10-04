import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadSettings, type Settings } from "../src/config.js";
import { createLogger, type Logger } from "../src/logger.js";
import { createServer } from "../src/server.js";

export const TEST_TOKEN = "unit-test-shared-token-0123456789abcdef0123456789";

export function testSettings(env: Record<string, string> = {}): Settings {
  return loadSettings({ MCP_ALLOW_PRIVATE_NETWORKS: "true", ...env });
}

export function captureLogger(): { log: Logger; lines: string[] } {
  const lines: string[] = [];
  return { log: createLogger("debug", (line) => lines.push(line)), lines };
}

export async function connectedClient(settings: Settings, fetchImpl?: typeof fetch): Promise<{ client: Client; lines: string[]; close: () => Promise<void> }> {
  const { log, lines } = captureLogger();
  const deps: Parameters<typeof createServer>[0] = { settings, log };
  if (fetchImpl) deps.fetchImpl = fetchImpl;
  const server = createServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return {
    client,
    lines,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
