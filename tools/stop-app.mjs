#!/usr/bin/env node
// Stop a running ui-chan Electron display app. No-op if nothing is running.
// macOS only, like the rest of ui-chan.

import { execSync } from 'node:child_process';

const commands = {
  darwin: 'pkill -f "ui-chan-mcp/node_modules/electron"',
};

const cmd = commands[process.platform];
if (!cmd) {
  console.error(`[stop-app] ui-chan は macOS 専用です (${process.platform})`);
  process.exit(1);
}

try {
  execSync(cmd, { stdio: 'ignore' });
  console.log('[stop-app] stopped ui-chan app');
} catch {
  console.log('[stop-app] no running ui-chan app found');
}
