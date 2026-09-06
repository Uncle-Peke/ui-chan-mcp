#!/usr/bin/env node
// Publish guard: nothing third-party-licensed may ride along in the tarball.
//
// Two hard constraints, both other people's terms, not ours:
//   - the mascot PSD is licensed art with redistribution forbidden. It lives in
//     ~/.ui-chan/assets, never in the package.
//   - VoiSona Talk (and its voice libraries) is TechnoSpeech's product. ui-chan
//     only *talks to* a copy the user installed themselves, over its local REST
//     API — no binary, installer or voice data is ever bundled.
//
// `files` in package.json already excludes both, but "we remembered not to
// include it" is not a safety property. This asks npm what the tarball would
// actually contain and fails if anything license-bound or secret is in it.
//
// Runs from `prepublishOnly`, so it cannot be skipped by publishing normally.
// This is now the *only* thing standing between a mistake and the registry:
// the package is public, so `npm publish` will succeed unless this fails.
import { execFileSync } from 'node:child_process';

const FORBIDDEN = [
  { re: /\.psd$/i, why: '立ち絵PSD（二次配布禁止）' },
  { re: /^assets\//, why: 'assets/（ライセンス素材の置き場）' },
  { re: /(^|\/)\.env$/, why: '.env（資格情報）' },
  { re: /\.(bak|pem|key)$/i, why: '鍵・バックアップ' },
  // VoiSona Talk 本体・ボイスライブラリ・インストーラの類（同梱は規約違反）
  { re: /\.(app|dmg|pkg|exe|msi|deb|rpm)$/i, why: 'アプリ・インストーラ（同梱不可）' },
  { re: /\.(dll|dylib|so|node)$/i, why: 'ネイティブバイナリ' },
  { re: /\.(wav|mp3|ogg|flac|ttsl|vvlib)$/i, why: '音声データ・ボイスライブラリ' },
  { re: /voisona/i, why: 'VoiSona Talk 由来のファイル' },
];

// `npm pack` は既定で `prepare`（＝ビルド）を走らせ、その出力が JSON の前後に
// 混ざる。npm のバージョンによって stdout に来たり stderr に来たりするので、
// 手元で通って CI でだけ落ちる、という厄介な壊れ方をした。
//
// 対処は2段構え。まず `--ignore-scripts` で混ざる原因そのものを断つ（ここが
// 見たいのは「いまディスクにあるファイルのうち何が詰められるか」であって、
// ビルドし直す必要はない）。そのうえで、それでも前後に出力が付いた場合に
// そなえ、括弧の深さを数えて JSON 配列だけを切り出す。
function extractJsonArray(raw) {
  const start = raw.indexOf('[');
  if (start < 0) throw new Error(`JSON が見つかりません:\n${raw.slice(0, 400)}`);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return JSON.parse(raw.slice(start, i + 1));
  }
  throw new Error(`JSON 配列が閉じていません:\n${raw.slice(0, 400)}`);
}

const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  encoding: 'utf-8',
  maxBuffer: 32 * 1024 * 1024,
});
const parsed = extractJsonArray(out);
if (!Array.isArray(parsed) || !parsed[0]?.files) {
  console.error(
    '❌ npm pack の結果にファイル一覧がありません。npm のバージョンを確認してください。',
  );
  process.exit(1);
}
const files = parsed[0].files.map((f) => f.path);

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
