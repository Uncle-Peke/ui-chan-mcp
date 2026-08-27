#!/usr/bin/env node
// Make the *cloned repo* the single source of truth for the Claude Code
// plugin, too.
//
// `claude plugin install` copies the plugin into
// ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/, so the repo and
// what Claude Code actually loads drift apart the moment you edit anything —
// you have to re-run marketplace update + reinstall to catch up. The Desktop
// connector has no such problem: it points at dist/ in the working tree.
//
// This replaces that copied directory with a symlink to the working tree, so
// both clients read the same files. Re-running `claude plugin install` puts a
// fresh copy back; just run this again.
import { existsSync, lstatSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_ID = 'ui-chan@ui-chan';
const registry = path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json');
const cacheRoot = path.join(os.homedir(), '.claude', 'plugins', 'cache');
const remove = process.argv.includes('--remove');

if (!existsSync(registry)) {
  console.error(
    '❌ プラグイン台帳が見つかりません。先に Claude Code でプラグインを入れてください:',
  );
  console.error(`   claude plugin marketplace add ${projectRoot}`);
  console.error('   claude plugin install ui-chan@ui-chan');
  process.exit(1);
}

const entry = JSON.parse(readFileSync(registry, 'utf-8')).plugins?.[PLUGIN_ID]?.[0];
if (!entry?.installPath) {
  console.error(`❌ ${PLUGIN_ID} が入っていません。先に入れてください:`);
  console.error(`   claude plugin marketplace add ${projectRoot}`);
  console.error('   claude plugin install ui-chan@ui-chan');
  process.exit(1);
}

const target = entry.installPath;
// Never rm -rf outside the plugin cache, whatever the registry claims.
if (
  path.resolve(target) !== target ||
  !path.resolve(target).startsWith(`${cacheRoot}${path.sep}`)
) {
  console.error(`❌ 想定外のパスなので触りません: ${target}`);
  process.exit(1);
}

const isLink = existsSync(target) && lstatSync(target).isSymbolicLink();

if (remove) {
  if (!isLink) {
    console.log('リンクされていません（コピーのままです）。何もしませんでした。');
    process.exit(0);
  }
  unlinkSync(target);
  console.log(`✅ リンクを外しました → ${target}`);
  console.log('   コピーを戻すには: claude plugin install ui-chan@ui-chan -y');
  process.exit(0);
}

if (isLink) {
  console.log(`すでにリンク済みです → ${target}`);
  process.exit(0);
}

rmSync(target, { recursive: true, force: true });
symlinkSync(projectRoot, target);
console.log(`✅ 作業ツリーにリンクしました`);
console.log(`   ${target}`);
console.log(`   → ${projectRoot}`);
console.log('   以後、リポジトリを直して `npm run build` すれば Claude Code にも即反映されます。');
console.log('   （新しいセッションから有効。解除は npm run link-plugin -- --remove）');
