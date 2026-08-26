#!/usr/bin/env node
// Pre-flight check for a fresh clone: everything that has to be in place before
// the mascot can actually run, reported up front instead of one failure at a
// time (missing build, missing PSD, missing TTS credentials, engine not up).
//
//   npm run doctor
//
// Exits 0 even with warnings — only a missing build is a hard error, since
// nothing works without dist/.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ok = (m) => console.log(`  ✅ ${m}`);
const warn = (m) => console.log(`  ⚠️  ${m}`);
const err = (m) => console.log(`  ❌ ${m}`);

try {
  process.loadEnvFile(path.join(projectRoot, '.env'));
} catch {
  /* no .env — the shell environment may still carry the credentials */
}

const config = JSON.parse(readFileSync(path.join(projectRoot, 'ui-chan.config.json'), 'utf-8'));
let fatal = false;

console.log('\nui-chan doctor\n');

// 1. build output
if (existsSync(path.join(projectRoot, 'dist', 'mcp-server.js'))) {
  ok('ビルド済み (dist/)');
} else {
  err('dist/ がありません — `npm install`（または `npm run build`）を実行してください');
  fatal = true;
}

// 2. mascot art
const assetsDir = path.join(projectRoot, 'assets');
const psd = existsSync(assetsDir)
  ? readdirSync(assetsDir)
      .filter((f) => f.toLowerCase().endsWith('.psd'))
      .sort()[0]
  : undefined;
if (psd) {
  ok(`立ち絵PSD: assets/${psd}`);
} else {
  warn('assets/ に PSD がありません — アプリはプレースホルダ表示で起動します');
}

// 3. TTS credentials
const tts = config.tts ?? {};
if (!tts.enabled) {
  ok('TTS は無効設定 (ui-chan.config.json の tts.enabled = false)');
} else if (process.env.UI_CHAN_TTS_USERNAME && process.env.UI_CHAN_TTS_PASSWORD) {
  ok('TTS の資格情報あり (.env または環境変数)');
} else {
  warn(
    '.env / 環境変数に UI_CHAN_TTS_USERNAME と UI_CHAN_TTS_PASSWORD がありません — 音声なしで動きます\n' +
      '     （`cp .env.example .env` して記入してください）',
  );
}

// 4. TTS engine
if (tts.enabled) {
  const url = tts.url;
  try {
    await fetch(`${url}/docs/talk_api.html`, { signal: AbortSignal.timeout(1500) });
    ok(`VoiSona Talk 起動中 (${url})`);
  } catch {
    warn(
      `VoiSona Talk に接続できません (${url}) — MCP サーバ起動時に自動起動を試みます（macOS のみ）`,
    );
  }
}

console.log(fatal ? '\n先に上の ❌ を解消してください。\n' : '\n起動できます: npm run app\n');
