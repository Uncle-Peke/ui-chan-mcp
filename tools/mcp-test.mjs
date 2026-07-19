// End-to-end test: talks to the MCP server over stdio like a real agent would.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = new Client({ name: 'mcp-test-agent', version: '1.0.0' });
await client.connect(
  new StdioClientTransport({
    command: 'node',
    args: [path.join(projectRoot, 'dist', 'mcp-server.js')],
  }),
);

const tools = await client.listTools();
console.log('tools:', tools.tools.map((t) => t.name).join(', '));

for (const [name, args] of [
  [
    'set_cue',
    {
      cue: 'excited',
      text: 'MCP経由のテストだよ！',
      reading: 'えむしーぴーけいゆのてすとだよ！',
      duration_ms: 6000,
    },
  ],
  ['get_state', {}],
]) {
  const res = await client.callTool({ name, arguments: args });
  console.log(`--- ${name}:`, res.content[0].text.slice(0, 400));
}

await client.close();
process.exit(0);
