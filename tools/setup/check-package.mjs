#!/usr/bin/env node
// Publish guard: the mascot PSD is licensed art that may not be redistributed.
// It lives in ~/.ui-chan/assets (never in the package) and `files` in
// package.json does not list `assets` — but "we remembered not to include it"
// is not a safety property. This asks npm what the tarball would actually
// contain and refuses to publish if anything license-bound or secret is in it.
//
// Runs from `prepublishOnly`, so it cannot be skipped by publishing normally.
import { execFileSync } from 'node:child_process';

const FORBIDDEN = [
  { re: /\.psd$/i, why: '立ち絵PSD（二次配布禁止）' },
  { re: /^assets\//, why: 'assets/（ライセンス素材の置き場）' },
  { re: /(^|\/)\.env$/, why: '.env（資格情報）' },
  { re: /\.(bak|pem|key)$/i, why: '鍵・バックアップ' },
];

const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf-8' });
const files = JSON.parse(out)[0].files.map((f) => f.path);

const hits = files.flatMap((path) => {
  const rule = FORBIDDEN.find((r) => r.re.test(path));
  return rule ? [`${path}  ← ${rule.why}`] : [];
});

if (hits.length > 0) {
  console.error('\n❌ 配布物に含めてはいけないファイルが入っています:\n');
  for (const h of hits) console.error(`   ${h}`);
  console.error('\npackage.json の "files" を確認してください。\n');
  process.exit(1);
}

console.log(`✅ 配布物チェック OK（${files.length} ファイル / ライセンス素材・秘密情報なし）`);
