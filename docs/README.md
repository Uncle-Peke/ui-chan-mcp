# ドキュメント索引（開発者向け）

**ういちゃんMCP そのものを直す人**のための資料です。使うだけなら [../README.md](../README.md) へ。

| やりたいこと | 読むもの |
|---|---|
| 開発を始める（準備・コマンド・全体像） | [DEVELOPMENT.md](DEVELOPMENT.md) |
| コードを直す（設計判断と、その理由） | [../CLAUDE.md](../CLAUDE.md) |
| 用語を確認する（Idling / Cue / EventCue …） | [../VISION.md](../VISION.md) |
| 新しい表情（Cue）を足す | [CUE_AUTHORING.md](CUE_AUTHORING.md) → レイヤー名は [PSD_LAYERS.md](PSD_LAYERS.md) |
| 設定（`ui-chan.config.json`）を変える | [CUE_AUTHORING.md](CUE_AUTHORING.md) |
| 性格・口調を変える | [PERSONA.md](PERSONA.md) |
| 音声合成の詳細を知る | [TTS.md](TTS.md) |
| Cueカタログの設計方針を知る | [design/CUE_CATALOG.md](design/CUE_CATALOG.md) |

[SETUP.html](SETUP.html) だけは例外で、**使う人向け**の図解セットアップページの実体です
（公開しているアーティファクトと同じ内容）。README を直したらこちらも直してください。

**注意：`persona/` と `context/` はドキュメントではありません。** あそこに置いた Markdown は
そのまま AI のコンテキストに注入されるので、編集するとういちゃんの振る舞いが変わります
（人間向けの制作資料をあそこに置かないこと。理由は [PERSONA.md](PERSONA.md)）。
