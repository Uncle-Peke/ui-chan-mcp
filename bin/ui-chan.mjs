#!/usr/bin/env node
// `ui-chan` — the one command that installs, checks, and removes ういちゃん.
//
// Why a CLI instead of a README full of per-client JSON: every MCP host wants
// the same stdio server described in its own dialect, and the interesting part
// (where the PSD and the credentials live) is identical for all of them. So the
// user answers the interesting questions once, and the client registry
// (tools/setup/clients.mjs) writes the dialects.
//
//   ui-chan                 対話セットアップ（TUI）
//   ui-chan setup           同上
//   ui-chan install <id...> クライアントへ登録（--all で全部）
//   ui-chan uninstall <id...>  登録解除（--all / --purge でユーザーデータも削除）
//   ui-chan status | doctor    現在の状態
//   ui-chan print <id>      設定スニペットを表示するだけ（未対応クライアント用）
//   ui-chan home            ユーザーデータの場所を表示
//   ui-chan start | stop    マスコットアプリの起動 / 停止
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIENTS, findClient, serverCommand } from '../tools/setup/clients.mjs';
import { doctor } from '../tools/setup/doctor.mjs';
import {
  ensureHome,
  hasPsd,
  homeDir,
  importPsd,
  migrateFrom,
  readEnvFile,
  writeCredentials,
} from '../tools/setup/home.mjs';
import { ask, askHidden, confirm, say, select } from '../tools/setup/prompt.mjs';
import { checkUpdate, runUpdate } from '../tools/setup/update.mjs';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const version = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf-8')).version;

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function clientItems() {
  const cmd = serverCommand(pkgRoot);
  return CLIENTS.map((c) => {
    let st;
    try {
      st = c.status(cmd, pkgRoot);
    } catch (e) {
      st = { installed: false, detail: e.message };
    }
    return {
      value: c.id,
      label: c.label,
      hint: `${st.installed ? '登録済み' : '未登録'}${c.unverified ? ' / 設定パス未検証' : ''}`,
      checked: st.installed,
    };
  });
}

function installTo(ids) {
  const cmd = serverCommand(pkgRoot);
  for (const id of ids) {
    const c = findClient(id);
    if (!c) {
      say(`  ❌ 不明なクライアント: ${id}`);
      continue;
    }
    try {
      const where = c.install(cmd, pkgRoot);
      say(`  ✅ ${c.label} → ${where}`);
      if (c.note) say(`     ${dim(c.note)}`);
    } catch (e) {
      say(`  ❌ ${c.label}: ${e.message}`);
      say(`     ${dim('手動で入れる場合はこの内容を設定に足してください:')}`);
      say(indent(c.snippet(cmd, pkgRoot)));
    }
  }
}

function uninstallFrom(ids) {
  for (const id of ids) {
    const c = findClient(id);
    if (!c) continue;
    try {
      const where = c.uninstall(serverCommand(pkgRoot), pkgRoot);
      say(where ? `  ✅ ${c.label} から削除 (${where})` : `  ・ ${c.label}: 登録なし`);
    } catch (e) {
      say(`  ❌ ${c.label}: ${e.message}`);
    }
  }
}

const indent = (text) =>
  text
    .split('\n')
    .map((l) => `     ${l}`)
    .join('\n');

async function setupWizard() {
  say(`\n${bold(`ういちゃん セットアップ  v${version}`)}\n`);
  say(dim(`パッケージ: ${pkgRoot}`));

  // 1. user data dir — the half that survives updates
  const { home, created } = ensureHome();
  say(`${created ? '✅ 作成しました' : '✅ 既にあります'}: ${home}`);
  const moved = migrateFrom(pkgRoot);
  if (moved.length > 0) say(`  ↪︎ 旧レイアウトから移行: ${moved.join(', ')}`);

  // 2. mascot art (licensed — never shipped in the package)
  if (hasPsd()) {
    say('✅ 立ち絵PSD: 配置済み');
  } else {
    say(`\n${bold('立ち絵PSD')}（未配置。無くてもプレースホルダで動きます）`);
    const src = await ask(`PSD のパス（Enter でスキップ / 後から ${home}/assets に置いてもOK）:`);
    if (src) {
      try {
        say(`✅ ${importPsd(src)}`);
      } catch (e) {
        say(`⚠️  ${e.message}`);
      }
    }
  }

  // 3. TTS credentials
  const env = readEnvFile();
  if (env.UI_CHAN_TTS_USERNAME && env.UI_CHAN_TTS_PASSWORD) {
    say('✅ VoiSona Talk の資格情報: 設定済み');
  } else {
    say(`\n${bold('VoiSona Talk の資格情報')}（音声を使わないなら Enter でスキップ）`);
    const user = await ask('ユーザー名:');
    if (user) {
      const pass = await askHidden('パスワード:');
      say(`✅ ${writeCredentials(user, pass)}`);
    }
  }

  // 4. clients
  say('');
  const picked = await select(bold('どのクライアントに入れますか（Space で選択）'), clientItems(), {
    multi: true,
  });
  if (picked === null) {
    say('\n中止しました。');
    return;
  }
  const before = new Set(clientItems().filter((i) => i.checked).map((i) => i.value));
  const toAdd = picked.filter((id) => !before.has(id));
  const toRemove = [...before].filter((id) => !picked.includes(id));
  if (toAdd.length > 0) {
    say('');
    installTo(toAdd);
  }
  if (toRemove.length > 0 && (await confirm(`\n選択を外した ${toRemove.join(', ')} を解除しますか?`, false))) {
    uninstallFrom(toRemove);
  }

  say('');
  await doctor(pkgRoot);
  say(dim('クライアントは再起動してください（Claude Desktop は ⌘Q で完全終了）。\n'));
}

async function uninstallWizard(argv) {
  const all = argv.includes('--all');
  const purge = argv.includes('--purge');
  const ids = argv.filter((a) => !a.startsWith('-'));
  let targets = all ? CLIENTS.map((c) => c.id) : ids;
  if (targets.length === 0) {
    const picked = await select(bold('どこから解除しますか（Space で選択）'), clientItems(), {
      multi: true,
    });
    if (picked === null) return say('中止しました。');
    targets = picked;
  }
  uninstallFrom(targets);

  if (purge) {
    const home = homeDir();
    if (await confirm(`\n${home} を完全に削除しますか（PSD・資格情報・自作Cueも消えます）?`, false)) {
      fs.rmSync(home, { recursive: true, force: true });
      say(`  ✅ 削除: ${home}`);
    }
  } else {
    say(dim(`\nユーザーデータ (${homeDir()}) は残しています。消すなら --purge。`));
  }
}

function runApp(argv) {
  const electron = require('electron');
  const child = spawn(electron, [pkgRoot, ...argv], { detached: true, stdio: 'ignore' });
  child.unref();
  say(`✅ マスコットを起動しました (pid ${child.pid})`);
}

async function main() {
  const [cmd = 'setup', ...argv] = process.argv.slice(2);
  switch (cmd) {
    case 'setup':
      return setupWizard();
    case 'install': {
      const ids = argv.includes('--all') ? CLIENTS.map((c) => c.id) : argv.filter((a) => !a.startsWith('-'));
      if (ids.length === 0) {
        const picked = await select(bold('どのクライアントに入れますか'), clientItems(), {
          multi: true,
        });
        if (picked === null) return say('中止しました。');
        return installTo(picked);
      }
      return installTo(ids);
    }
    case 'uninstall':
    case 'remove':
      return uninstallWizard(argv);
    case 'doctor':
    case 'status':
      return void (await doctor(pkgRoot));
    case 'print': {
      const c = findClient(argv[0]);
      if (!c) {
        say(`対応クライアント: ${CLIENTS.map((x) => x.id).join(', ')}`);
        say('\n未対応クライアント向けの汎用 stdio 設定:');
        say(JSON.stringify({ mcpServers: { 'ui-chan': serverCommand(pkgRoot) } }, null, 2));
        return;
      }
      return say(c.snippet(serverCommand(pkgRoot), pkgRoot));
    }
    case 'update': {
      const bi = argv.indexOf('--branch');
      const branch = bi >= 0 ? argv[bi + 1] : undefined;
      if (argv.includes('--check')) {
        const st = checkUpdate(pkgRoot, { fetch: true, branch });
        if (!st.ok) return say(`確認できません: ${st.reason}`);
        if (!st.available) return say('最新です');
        const where =
          st.via === 'npm'
            ? `${st.name} ${st.current} → ${st.latest}`
            : st.via === 'gh'
              ? `${st.slug}${st.branch ? `#${st.branch}` : ''} / gh 経由${st.installedSha ? '' : '・現在のバージョン不明'}`
              : `${st.behind} コミット (${st.upstream})`;
        return say(`更新あり: ${where}${st.blocked ? ` ※${st.blocked}` : ''}`);
      }
      const res = await runUpdate(pkgRoot, { log: (m) => say(`  ${m}`), branch });
      if (!res.ok) {
        say(`❌ 更新できません: ${res.reason}`);
        process.exitCode = 1;
        return;
      }
      if (!res.updated) return say('✅ 最新です');
      say(`✅ 更新しました: ${res.from} → ${res.to}`);
      // The running app is the old build; bring it back on the new one.
      if (!argv.includes('--no-restart')) {
        spawn(process.execPath, [path.join(pkgRoot, 'tools', 'stop-app.mjs')], { stdio: 'ignore' });
        setTimeout(() => runApp([]), 1500);
      }
      return;
    }
    case 'use': {
      // Point every client that already has ui-chan registered at *this* copy.
      // The npm install and a clone can coexist happily; what can't is being
      // unsure which one a session is actually talking to.
      const cmd = serverCommand(pkgRoot);
      const registered = CLIENTS.filter((c) => {
        try {
          return c.status(cmd, pkgRoot).installed;
        } catch {
          return false;
        }
      });
      if (registered.length === 0) {
        return say('登録済みのクライアントがありません（先に `ui-chan install` を）。');
      }
      say(`このコピーに切り替えます: ${pkgRoot}\n`);
      installTo(registered.map((c) => c.id));
      say(dim('\nクライアントを再起動すると反映されます。'));
      return;
    }
    case 'home':
      return say(homeDir());
    case 'start':
    case 'app':
      return runApp(argv);
    case 'stop':
      return void spawn(process.execPath, [path.join(pkgRoot, 'tools', 'stop-app.mjs')], {
        stdio: 'inherit',
      });
    case '--version':
    case '-v':
      return say(version);
    default:
      say(`ui-chan v${version}

  ui-chan                  対話セットアップ
  ui-chan install [id...]  クライアントへ登録（--all）
  ui-chan uninstall [...]  解除（--all / --purge でユーザーデータも削除）
  ui-chan doctor           状態チェック
  ui-chan print <id>       設定スニペットのみ表示
  ui-chan update           最新版を取得して再ビルド（--check で確認のみ、
                           --branch <名前> で追従先を指定＝gh 経路のみ）
  ui-chan use              登録済みクライアントの参照先を「このコピー」に切り替える
  ui-chan home             ユーザーデータの場所
  ui-chan start | stop     マスコットの起動 / 停止

  対応クライアント: ${CLIENTS.map((c) => c.id).join(', ')}`);
  }
}

main().catch((e) => {
  say(`\n❌ ${e.stack ?? e.message}`);
  process.exit(1);
});
