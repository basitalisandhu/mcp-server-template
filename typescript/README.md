# secure-mcp-server (TypeScript)

TypeScript reference implementation of the [secure MCP server template](../README.md), built on `@modelcontextprotocol/sdk` and zod. See the repository README for the quickstart, the controls and the threat model; this file covers what is specific to the TypeScript side.

```bash
cd typescript
npm ci
npm run build          # tsc, strict settings
npm test               # vitest: config, logger, paths, network, tools, http
npm run dev            # run from source with tsx (stdio transport)
npm run inspect        # open the MCP Inspector against dist/index.js
```

Layout: `src/config.ts` (settings from the environment), `src/logger.ts` (JSON lines on stderr with redaction), `src/safety/paths.ts` (`resolveInside`, `readBounded`), `src/safety/network.ts` (`assertSafeUrl`, `fetchBounded`), `src/tools/index.ts` (the four tools), `src/server.ts` (server factory), `src/http.ts` (express app with bearer auth, rate limit, body cap and Host validation) and `src/index.ts` (entry point).
