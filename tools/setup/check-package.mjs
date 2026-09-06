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
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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

// **実際に tarball を作って、その中身を見る。**
//
// 以前は `npm pack --json` の出力を解釈していたが、環境差で二度こけた：
// (1) `prepare`（ビルド）の出力が JSON の前後に混ざり、しかも npm の版で
// stdout か stderr かが変わる。(2) npm 11 は `[{...}]`、npm 12 は
// `{"名前": {...}}` と形そのものが変わる。どちらも「手元では通って CI で
// だけ落ちる」壊れ方をした。
//
// この検査はライセンス素材の混入を止める最後の砦なので、npm の表示仕様に
// 依存させない。tar が読める実体だけを見る。
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-chan-pack-'));
let files;
try {
  // --ignore-scripts: ビルドし直す必要はない（見たいのは、いまディスクに
  // あるもののうち何が詰められるか）。--pack-destination: 作業ツリーを汚さない。
  const packed = execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', tmp], {
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const tgz = fs
    .readdirSync(tmp)
    .filter((f) => f.endsWith('.tgz'))
    .map((f) => path.join(tmp, f))[0];
  if (!tgz) {
    console.error(`❌ tarball が作られませんでした:\n${packed}`);
    process.exit(1);
  }
  // tar の一覧は "package/<パス>" 形式。ディレクトリ行（末尾 /）は捨てる。
  files = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 })
    .split('\n')
    .filter((l) => l && !l.endsWith('/'))
    .map((l) => l.replace(/^package\//, ''));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (files.length === 0) {
  console.error('❌ tarball の中身を読めませんでした。');
  process.exit(1);
}

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
