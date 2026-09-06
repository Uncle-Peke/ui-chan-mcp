# 貢献について

> **Issue や Pull Request を送る前に読みます。** 何を歓迎していて、何をお断りしているかを先に書きます。

---

## `01` 歓迎するもの

- **バグ報告** — 特に **OpenCode / Hermes Agent の EventCue**。実装はしてありますが、実機での発火を確認できていません
- **新しいクライアントへの対応** — `tools/setup/clients.mjs` に1エントリ追加するだけです
- **新しい Cue（表情）** — `cues/<名前>.json` を1ファイル。書式は [docs/CUE_AUTHORING.md](docs/CUE_AUTHORING.md)
- ドキュメントの誤りや分かりにくさの指摘

## `02` お断りするもの

> [!IMPORTANT]
> **立ち絵素材そのもの（`.psd`）、そこから切り出した画像、音声データを含む PR は受け取れません。**
> 二次配布が禁止されているためです。`npm run check-package` が機械的に弾きます。

キャラクターの尊厳を損なう変更、公序良俗に反する用途のための機能追加もお断りします。
判断に迷う場合は、実装の前に Issue で相談してください。

## `03` 設計上、再提案をお断りしているもの

過去に検討して却下したものがあります。理由は [CLAUDE.md](CLAUDE.md) の "Rejected designs" に
書いてありますので、提案の前に目を通してください。

- Cue 間の継承（`extends`）
- `pose` / `face_parts` のような名前付きラッパー（生の PSD レイヤーパスを直接使う方針です）
- `set_face` / `set_pose` のような実行時に部品を組み合わせるツール

## `04` 開発の手順

```bash
git clone https://github.com/Uncle-Peke/ui-chan-mcp.git && cd ui-chan-mcp
npm install
npx ui-chan          # 対話セットアップ
npx ui-chan use      # npm 版も入れている場合、参照先をこのクローンへ
```

送る前に、CI と同じ検証を手元で通してください。

```bash
npx tsc -p tsconfig.json --noEmit   # 型
npx biome check .                   # lint / format
npm run validate-cues               # Cue のスキーマ検証
npm run check-package               # 配布物に素材が混ざっていないか
```

詳しくは [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)、設計の背景は [CLAUDE.md](CLAUDE.md)、
ドキュメントを書くときは [docs/STYLE.md](docs/STYLE.md) を参照してください。

## `05` コミットメッセージ

`feat:` `fix:` `docs:` `ci:` `chore:` などの接頭辞を付け、**何をしたかではなく、なぜそうしたか**を
本文に書いてください。この方針は既存の履歴を見ると分かります。

---

<sub>本プロジェクトは非公式のファン制作物です。詳しくは [README](README.md#ライセンスと権利表記) を。</sub>
