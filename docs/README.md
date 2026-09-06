# ドキュメント索引

使うだけなら [../README.md](../README.md) で足ります。ここは「もう少し知りたい人」と
「中を直す人」のための資料です。

## 使う人向け

| やりたいこと | 読むもの |
|---|---|
| 図解でセットアップを見る | [SETUP.html](SETUP.html) |
| どのアプリにどう入るのか、詳しく知る | [CLIENTS.md](CLIENTS.md) |
| うまく動かないので調べる | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) |
| 声のしくみと設定を知る | [TTS.md](TTS.md) |

## 作る人向け

| やりたいこと | 読むもの |
|---|---|
| 開発を始める（準備・コマンド・全体像） | [DEVELOPMENT.md](DEVELOPMENT.md) |
| コードを直す（設計判断と、その理由） | [../CLAUDE.md](../CLAUDE.md) |
| 用語を確認する（Idling / Cue / EventCue …） | [../VISION.md](../VISION.md) |
| 新しい表情（Cue）を足す | [CUE_AUTHORING.md](CUE_AUTHORING.md) → レイヤー名は [PSD_LAYERS.md](PSD_LAYERS.md) |
| 性格・口調を変える | [PERSONA.md](PERSONA.md) |
| エージェント側から見た操作面を知る | [TOOLS.md](TOOLS.md) |
| Cueカタログの設計方針を知る | [design/CUE_CATALOG.md](design/CUE_CATALOG.md) |

**注意：`persona/` と `context/` はドキュメントではありません。** あそこに置いた Markdown は
そのまま AI のコンテキストに注入されるので、編集するとういちゃんの振る舞いが変わります
（人間向けの制作資料をあそこに置かないこと。理由は [PERSONA.md](PERSONA.md)）。
