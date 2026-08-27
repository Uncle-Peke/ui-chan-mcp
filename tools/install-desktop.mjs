#!/usr/bin/env node
// Register this repo's MCP server with the Claude Desktop app.
//
//   npm run install-desktop          # add / update the entry
//   npm run install-desktop -- --remove
//
// Claude Code gets the whole plugin (skills, hooks, agents); Claude Desktop has
// no plugin system, so it gets the MCP server — which since the persona rides
// on the handshake `instructions` is enough for her to *be* ういちゃん there,
// not just a set of tools. This script exists so that "install for Desktop" is
// one command instead of hand-editing JSON in a Library path.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_KEY = 'ui-chan';

/** Where Claude Desktop keeps its config, per platform. */
function configPath() {
  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json',
    );
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
      'Claude',
      'claude_desktop_config.json',
    );
  }
  return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

const file = configPath();
const remove = process.argv.includes('--remove');

let config = {};
if (existsSync(file)) {
  try {
    config = JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    console.error(`❌ ${file} が JSON として読めません。手で直してから再実行してください。`);
    process.exit(1);
  }
  // Never rewrite someone's config without a way back.
  copyFileSync(file, `${file}.bak`);
} else {
  mkdirSync(path.dirname(file), { recursive: true });
}

config.mcpServers ??= {};

if (remove) {
  if (!config.mcpServers[SERVER_KEY]) {
    console.log('登録されていません。何もしませんでした。');
    process.exit(0);
  }
  delete config.mcpServers[SERVER_KEY];
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`✅ ${SERVER_KEY} を削除しました → ${file}`);
  console.log('   Claude Desktop を再起動してください。');
  process.exit(0);
}

// bin/ui-chan-node rather than this process's node: Desktop is GUI-launched
// and inherits launchd's minimal PATH, and a node pinned here would break the
// day the user's node moves (a Homebrew upgrade, a version manager switch).
const entry = {
  command: path.join(projectRoot, 'bin', 'ui-chan-node'),
  args: [path.join(projectRoot, 'dist', 'mcp-server.js')],
};
// TTS credentials stay in .env (gitignored); the server loads that itself, so
// nothing secret is written into the Desktop config.
config.mcpServers[SERVER_KEY] = entry;
writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);

console.log(`✅ Claude Desktop に登録しました → ${file}`);
console.log(`   command: ${entry.command}`);
console.log(`   args:    ${entry.args[0]}`);
if (!existsSync(path.join(projectRoot, 'dist', 'mcp-server.js'))) {
  console.log('\n⚠️  dist/ がまだありません。`npm install` を実行してください。');
}
console.log('\nClaude Desktop を再起動すると、ういちゃんとして喋りはじめます。');
