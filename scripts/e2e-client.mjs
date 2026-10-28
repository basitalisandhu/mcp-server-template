// A minimal MCP client for scripts/e2e-quickstart.sh: start a stdio server, call the bundled
// tools the way a client configured from the README would, and check the answers.
//   node scripts/e2e-client.mjs <sdk-dir> <allowed-dir> <command> [args...]
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [sdkDir, allowedDir, command, ...args] = process.argv.slice(2);
const load = (p) => import(pathToFileURL(path.join(sdkDir, "dist", "esm", p)).href);
const { Client } = await load("client/index.js");
const { StdioClientTransport } = await load("client/stdio.js");

const transport = new StdioClientTransport({
  command,
  args,
  env: { ...process.env, MCP_ALLOWED_DIRS: allowedDir },
  stderr: "pipe",
});
const client = new Client({ name: "e2e-quickstart", version: "0.0.0" });
await client.connect(transport);
try {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["fetch_url", "health", "list_directory", "read_file"]);
  const text = (r) => r.content.map((c) => c.text ?? "").join("");
  const health = await client.callTool({ name: "health", arguments: {} });
  assert.notEqual(health.isError, true, text(health));
  const listing = await client.callTool({ name: "list_directory", arguments: { path: "." } });
  assert.notEqual(listing.isError, true, text(listing));
  assert.match(text(listing), /adding-a-tool\.md/);
  const read = await client.callTool({ name: "read_file", arguments: { path: "adding-a-tool.md" } });
  assert.notEqual(read.isError, true, text(read));
  const escape = await client.callTool({ name: "read_file", arguments: { path: "../README.md" } });
  assert.equal(escape.isError, true, "a path outside MCP_ALLOWED_DIRS must be refused");
  const fetchDenied = await client.callTool({ name: "fetch_url", arguments: { url: "http://169.254.169.254/latest/meta-data/" } });
  assert.equal(fetchDenied.isError, true, "fetch with no allowed hosts must be refused");
  console.log(`${command} ${args.join(" ")}: tools, boundary and SSRF refusal as documented`);
} finally {
  await client.close();
}
