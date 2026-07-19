#!/usr/bin/env node
// Stop a running ui-chan Electron display app.
// Cross-platform wrapper around pkill/taskkill; no-op if nothing is running.

import { execSync } from 'node:child_process';

const commands = {
  darwin: 'pkill -f "ui-chan-mcp/node_modules/electron"',
  linux: 'pkill -f "ui-chan-mcp/node_modules/electron"',
  win32: 'taskkill /F /FI "IMAGENAME eq electron.exe" /FI "COMMANDLINE eq *ui-chan-mcp*"',
};

const cmd = commands[process.platform];
if (!cmd) {
  console.error(`[stop-app] unsupported platform: ${process.platform}`);
  process.exit(1);
}

try {
  execSync(cmd, { stdio: 'ignore' });
  console.log('[stop-app] stopped ui-chan app');
} catch {
  console.log('[stop-app] no running ui-chan app found');
}
