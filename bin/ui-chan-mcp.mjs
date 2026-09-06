#!/usr/bin/env node
// The MCP server's entry point as an npm `bin`, so every client can start it
// the same way (`ui-chan-mcp`, or an absolute path to this file). The compiled
// server is CommonJS and has no shebang of its own; this is the two-line
// wrapper that gives it one.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
require(join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'mcp-server.js'));
