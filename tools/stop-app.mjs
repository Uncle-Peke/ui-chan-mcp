#!/usr/bin/env node
// Stop a running ui-chan Electron display app.
// Cross-platform wrapper around pkill/taskkill; no-op if nothing is running.

import { execSync } from 'node:child_process';

// taskkill の /FI は COMMANDLINE を受け付けない（IMAGENAME・PID・WINDOWTITLE のみ）ので、
// 「ui-chan のものだけ殺す」を taskkill 単体では書けない。PowerShell でコマンドラインを
// 見て絞る。ここを IMAGENAME だけにすると、無関係な Electron アプリまで巻き添えにする。
const WIN =
  'powershell -NoProfile -Command "' +
  "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | " +
  "Where-Object { $_.CommandLine -like '*ui-chan*' } | " +
  'ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"';

const commands = {
  darwin: 'pkill -f "ui-chan-mcp/node_modules/electron"',
  linux: 'pkill -f "ui-chan-mcp/node_modules/electron"',
  win32: WIN,
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
