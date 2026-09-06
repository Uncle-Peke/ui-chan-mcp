// `ui-chan doctor` — everything that has to be in place before the mascot can
// run, reported in one pass instead of one failure at a time. Reads through the
// same package/home resolution the app itself uses (dist/shared/paths.js), so
// what it reports is what the running app will actually see.

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { CLIENTS, serverCommand } from './clients.mjs';
import { homeDir } from './home.mjs';

const require = createRequire(import.meta.url);

export function loadPaths(pkgRoot) {
  const mod = path.join(pkgRoot, 'dist', 'shared', 'paths.js');
  if (!fs.existsSync(mod)) return null;
  const { resolvePaths, loadEnvFiles } = require(mod);
  loadEnvFiles(pkgRoot);
  return resolvePaths(pkgRoot);
}

export async function doctor(pkgRoot, { quiet = false } = {}) {
  const out = [];
  const ok = (m) => out.push(['ok', m]);
  const warn = (m) => out.push(['warn', m]);
  const bad = (m) => out.push(['bad', m]);

  const paths = loadPaths(pkgRoot);
  if (!paths) {
    bad('dist/ がありません — `npm install`（または `npm run build`）を実行してください');
  } else {
    const KIND_LABEL = {
      git: 'git クローン',
      'npm-global': 'npm グローバル',
      'npm-local': 'npm（プロジェクト依存）',
      copy: 'コピー配置',
    };
    ok(`このコピー: ${pkgRoot}（${KIND_LABEL[paths.kind] ?? paths.kind}）`);
  }

  const home = homeDir();
  if (fs.existsSync(home)) ok(`ユーザーデータ: ${home}`);
  else warn(`ユーザーデータ未作成: ${home} — \`ui-chan setup\` で作成できます`);

  const psd = paths
    ? require(path.join(pkgRoot, 'dist', 'app', 'assets.js')).findPsd(paths.assetsDirs)
    : null;
  if (psd) ok(`立ち絵PSD: ${psd}`);
  else
    warn(
      `立ち絵PSDがありません — ${path.join(home, 'assets')} に置いてください（無くても起動します）`,
    );

  const tts = paths?.config?.tts ?? {};
  if (paths && !tts.enabled) {
    ok('TTS は無効設定');
  } else if (process.env.UI_CHAN_TTS_USERNAME && process.env.UI_CHAN_TTS_PASSWORD) {
    ok('TTS の資格情報あり');
    try {
      await fetch(`${tts.url}/docs/talk_api.html`, { signal: AbortSignal.timeout(1500) });
      ok(`VoiSona Talk 起動中 (${tts.url})`);
    } catch {
      warn(`VoiSona Talk に未接続 (${tts.url}) — 起動時に自動起動を試みます（macOS のみ）`);
    }
  } else {
    warn(
      `TTS の資格情報がありません — ${path.join(home, '.env')} に記入してください（音声なしで動きます）`,
    );
  }

  const cmd = serverCommand(pkgRoot);
  for (const c of CLIENTS) {
    let st;
    try {
      st = c.status(cmd, pkgRoot);
    } catch (e) {
      st = { installed: false, detail: e.message };
    }
    // A machine can hold several copies of ui-chan (an npm install plus a
    // clone). Whichever one a client's entry points at is the one that runs, so
    // a registration aimed elsewhere is the single most confusing state there
    // is — you edit the clone and the npm copy answers.
    const elsewhere =
      st.installed && st.target && !String(st.target).startsWith(pkgRoot) ? st.target : null;
    if (elsewhere) {
      warn(`${c.label}: 別のコピーを指しています → ${elsewhere}（\`ui-chan use\` でこちらに切替）`);
    } else {
      (st.installed ? ok : warn)(
        `${c.label}: ${st.installed ? '登録済み' : '未登録'} (${st.detail})`,
      );
    }
  }

  if (!quiet) {
    const icon = { ok: '✅', warn: '⚠️ ', bad: '❌' };
    console.log('\nui-chan doctor\n');
    for (const [level, msg] of out) console.log(`  ${icon[level]} ${msg}`);
    console.log(
      out.some(([l]) => l === 'bad')
        ? '\n先に上の ❌ を解消してください。\n'
        : '\n起動できます。\n',
    );
  }
  return out;
}
