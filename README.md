# ui-chan-mcp

デスクトップマスコットを MCP（Model Context Protocol）経由で操作するサーバ。
Claude Code や任意の MCP 対応エージェントから、マスコットの見た目（顔＋腕）と声をまとめて切り替え、
吹き出しでセリフを話させることができます。

- 表示層は Electron（透過・最前面・画面右下）
- 立ち絵は **PSDTool 形式の PSD**（`!`=必須レイヤー、`*`=ラジオ切替）をそのまま利用
- 見た目＋声は **Cue**（1ファイル=1つの完成した見た目＋声）という単位で管理。エージェント向けの
  視覚操作ツールは `set_cue` ただ1つ
- 発話キュー・複数エージェント同時接続に対応

## 素材について（重要）

立ち絵 PSD はリポジトリに **含まれていません**（著作権保護された素材のため）。
`assets/` ディレクトリに PSDTool 対応の PSD ファイルを置くと動きます。
PSD が無い場合はアプリに案内が表示されます。

同梱の `ui-chan.config.json` と `cues/*.json` は
[雨衣（うい）立ち絵素材（坂本アヒル様）](https://www.ui-roid.com/) のレイヤー構成向けに書かれています。
利用時は[雨衣キャラクターガイドライン](https://www.ui-roid.com/guidelines/)の範囲でどうぞ。
別の PSD を使う場合は `npm run dump-psd -- path/to/file.psd` でレイヤー名を確認し、
`ui-chan.config.json`（`cues/default.json` が土台）と `cues/*.json`（見た目＋声）を書き換えてください。

## セットアップ

```bash
npm install
npm run build
# 立ち絵PSDを assets/ に配置
```

### Claude Code プラグインとして使う（推奨）

このリポジトリ自体が Claude Code プラグイン兼マーケットプレイスです。
事前に `npm install && npm run build` を済ませたうえで：

```
/plugin marketplace add /path/to/ui-chan-mcp
/plugin install ui-chan@ui-chan
```

プラグインを有効にすると：

- **MCP サーバが自動登録**される（`.mcp.json`、手動の `claude mcp add` 不要）
- **セッション開始時に人格を自動注入**（SessionStart フックが persona/ と context/ を読み込む。
  最初から常にういちゃんとして振る舞う）
- **`/ui-chan:persona`** — 人格ファイル編集後の再読み込み
- **`/ui-chan:ui-beam`** — ういビーム（ファンサービス必殺技）
- **ui-chan エージェント** — 「ういちゃんにリアクションさせる」用のサブエージェント

VoiSona Talk の認証情報はシェル環境変数で渡します（プラグインが環境を継承します）：

```bash
# ~/.zshrc など
export UI_CHAN_TTS_USERNAME="you@example.com"
export UI_CHAN_TTS_PASSWORD="api-password"
```

### Claude Code への登録（プラグインを使わない場合）

プロジェクトの `.mcp.json`（またはユーザー設定の `mcpServers`）に定義します。
**VoiSona Talk の認証情報はここ（エージェント定義側）に書き、本サーバの config には持たせません**：

```json
{
  "mcpServers": {
    "ui-chan": {
      "command": "node",
      "args": ["/path/to/ui-chan-mcp/dist/mcp-server.js"],
      "env": {
        "UI_CHAN_TTS_USERNAME": "VoiSonaログインのメールアドレス",
        "UI_CHAN_TTS_PASSWORD": "VoiSonaのAPIタブで設定したパスワード"
      }
    }
  }
}
```

CLI で登録する場合：

```bash
claude mcp add ui-chan \
  -e UI_CHAN_TTS_USERNAME="you@example.com" \
  -e UI_CHAN_TTS_PASSWORD="api-password" \
  -- node /path/to/ui-chan-mcp/dist/mcp-server.js
```

音声を使わないなら `env` ごと省略できます。表示アプリはツール呼び出し時に自動起動されます
（手動起動は `npm run app`）。MCP サーバ起動時に VoiSona Talk が起動していなければ
自動で起動します（macOS、`tts.enabled: true` のとき）。

## MCP ツール

| ツール | 引数 | 説明 |
|---|---|---|
| `set_cue` | `cue`, `text?`, `reading?`, `duration_ms?`, `pitch?`, `speed?`, `volume?`, `intonation?` | Cue（見た目＋声）を切り替え、任意でセリフを同時に話す。`text` を省略すると無言でCueだけ変わる。未知の`cue`名は`default`にフォールバックし`note`が付く。`pitch`/`speed`/`volume`/`intonation` はその一行だけのアドリブ演技パラメータ |
| `get_state` | — | 現在の状態・接続エージェント・利用可能なCue一覧・好感度（`affinity`）一覧 |
| `adjust_affinity` | `delta`, `reason?` | 好感度を相対的に増減（セッション内のみ・再起動でリセット）。褒められたら＋、旦那面・塩鮭案件で−。ういビームの発射可否を左右 |
| `clear` | — | 吹き出し・Cueを初期状態（`default`）にリセット |

Cueの一覧は `get_state` の `availableCues` で取得できます（`cues/*.json` のファイル名がそのままCue名）。

## アーキテクチャ

```
Agent (Claude Code 等) ──stdio──▶ dist/mcp-server.js ──WebSocket(127.0.0.1:8123)──▶ Electron アプリ
                                   （未起動なら自動起動）                          ├─ 状態管理（発話キュー・アイドル）
                                                                                  └─ レンダラ（PSD合成・吹き出し・まばたき）
```

- MCP サーバは薄いブリッジで、状態は Electron 側に一元化。複数エージェントが同時接続しても矛盾しません
- ポートは `ui-chan.config.json` の `port` または環境変数 `UI_CHAN_PORT` で変更可能
- エージェント名は MCP クライアント情報から自動取得（`UI_CHAN_AGENT_NAME` で上書き可）

## Cue（cues/）

見た目＋声のセットは **`cues/<Cue名>.json` に 1 Cue = 1 ファイル**で管理します
（`cue.schema.json` 準拠）。ファイル名がそのまま `set_cue` の `cue` 名になり、ファイルを追加すれば
新しいCueが増えます。継承なし・完全に自己完結（同じレイヤー指定が複数ファイルに重複してもよい）。
**保存すると即時リロード**され、表示中のCueにもすぐ反映されるので、アプリを再起動せずに調整できます。

```json
{
  "select": ["!眉/*上がり", "!目/*にっこり2", "!口/*あは", "!頬・顔色/*頬2"],
  "blink": false,
  "voice": {
    "style_weights": { "Happy": 0.7, "Bashful": 0.3 }
  }
}
```

- `select / show / hide` — 生の PSD レイヤーパス指定（全Cue共通の `cues/default.json` に上書きされる
  差分だけ書けばよい）。顔・腕・エフェクトを区別せず、そのCueに必要なレイヤーパスを並べるだけでよい
- `blink` — まばたきの有効化（目が開いているCueのみ true 推奨）
- `voice.style_weights` — スタイル名 → 重みのオブジェクト。省略すればデフォルトの声
- `voice.alp` / `voice.huskiness` — このCue固有の声色パラメータ（VoiSona の `global_parameters` にそのまま渡る）
- 強さ違い（例: 「激おこ」）は intensity ではなく別ファイル（例 `gekioko.json`）として作る
- JSON が壊れている、または `cue.schema.json` に適合しないファイルはスキップされ、`get_state` の
  `warnings` に出ます
- `cues/default.json` は全Cue共通の下地（旧`config.base`＋腕の基本ポーズに相当）で、他のCueと
  同じ形式の1ファイル。`set_cue`はこの`default`のdirectivesの上に指定されたCueのdirectivesを重ねて合成する

Cue選定・新規Cue追加のための場面別早見表・PSDレイヤー名カタログは `context/CUES.md` を参照
（実行時にはロードされない、制作用の参照ドキュメント）。

## 設定（ui-chan.config.json）

- `assetsDir` — PSD を探すディレクトリ（最初に見つかった `.psd` を使用）
- `window` — ウィンドウサイズ・画面端からのマージン
- `cuesDir` — Cueのディレクトリ（デフォルト `cues`）
- `idle.chatter` / `idle.idlingCues` — アイドル中に自発的に再生される**IdlingCue**（Cue＋任意のセリフの
  ステップ列）。`items[].steps[]`は`{ cue?, text?, reading?, holdMs? }`で、`cue`を省略すると直前のCueを
  維持する。`chatter`と`idlingCues`は同じ仕組みで、周期（`minSec`/`maxSec`）が違うだけ：`chatter`は
  滅多に喋らない独り言用（デフォルト180〜360秒に1回）、`idlingCues`はあくび・きょろきょろ等の無言の
  仕草も含めた頻繁な生存感用（デフォルト12〜30秒に1回）
- `lipSync` — リップシンク設定。`mouths` は母音（a/e/i/o/u/n）→ 口レイヤー名、`charsPerSec` は口を
  動かす速度、`audioPollMs`（デフォルト33）は音声駆動リップシンクが再生位置をチェックする間隔。
  読みのかなを母音に変換して口形を切り替える。漢字など読めない文字はパクパク
  （開閉交互）にフォールバック。発話終了時・無音区間は `n`（閉じ口）に自動復帰
- `speech` — `set_cue`の`duration_ms`省略時の表示時間算出パラメータ。テキスト駆動は
  `baseMs + 文字数*msPerChar` を `minMs`〜`maxMs` にクランプ、音声駆動は合成音声の長さ +
  `audioPaddingMs`（`audioMinMs`床）
- `ambient` — レンダラーのBlink（`blinkMinIntervalMs`/`blinkMaxIntervalMs`/`blinkDurationMs`）の
  タイミング。VISION.mdの語彙でBlinkはCue/Idling外で唯一独立ループする演出なので、IdlingCueとは
  別枠でレンダラー側に残る

レイヤーパスは `/` 区切りで PSD のレイヤー名と完全一致。存在しないパスは無視され、
`get_state` の `warnings` に報告されます（別 PSD への差し替えを安全にするため）。

## 人格（ペルソナ）の注入

MCP が提供できるのはツール（＝身体）だけで、**キャラクターの人格はエージェント側のコンテキストに
入れる必要があります**。人格は 2 ヶ所で定義します：

- `persona/ui-chan.md`（`personaFile` で変更可）— 基本人格とツール使用方針（「reading を必ず付ける」「セリフは 1〜2 文で区切る」等）
- `context/*.md` — 追加コンテキスト。`SOUL.md`（価値観・内面）、`VOCABULARY.md`（語彙・口癖・NGワード）、
  `CUES.md`（Cue早見表）など、Markdown を置いた分だけファイル名順で全部読み込まれます

読み込ませる方法は 3 つ（上ほど推奨）：

0. **プラグイン（自動）** — プラグインを入れていれば SessionStart フックが毎セッション自動注入します。以下の 1・2 は不要

1. **MCP プロンプト（手動・どの MCP クライアントでも）** — 本サーバは `persona` プロンプトを公開しており、
   Claude Code ではスラッシュコマンド **`/mcp__ui-chan__persona`** で会話に読み込めます。
   ファイルは呼び出しのたびに読まれるので、編集が即反映されます
2. **常時適用（Claude Code）** — プロジェクトの `CLAUDE.md` に
   `@/path/to/ui-chan-mcp/persona/ui-chan.md` と書いてインポートすれば、
   セッション開始時から常にういちゃんとして振る舞います

別キャラクターの PSD に差し替える場合は、`persona/` の Markdown も丸ごと書き換えてください。

## 音声合成（VoiSona Talk 連携）

[VoiSona Talk](https://voisona.com/talk/download/)（テクノスピーチ、無料）の REST API 経由で、
`set_cue` のセリフを実際に喋らせることができます。合成は `destination: memory` で行い、
WAV と音素タイミング（`phonemes` / `phoneme_durations`）を取得してアプリ側で再生するため、
**口パクは音素単位で音声と完全同期**します。吹き出しの表示時間も音声の実時間に一致します。

API リファレンスは REST API 有効化後に http://localhost:32766/docs/talk_api.html で読めます。

### 有効化手順

1. VoiSona Talk を起動してログインし、ボイスライブラリを 1 つ以上ダウンロード
2. メニュー「編集 > 環境設定」の **API タブ** で待ち受けポート（デフォルト 32766）と API 用パスワードを設定し、「REST API を有効にする」をチェック
3. 認証情報を **mcp.json の `env`** に設定（上記「Claude Code への登録」参照）。
   本サーバの config はディスク上に認証情報を持たず、MCP ブリッジ経由でメモリ上にのみ渡されます

`ui-chan.config.json` 側の設定は接続先とボイス選択だけです：

```json
"tts": {
  "enabled": true,
  "provider": "voisona-talk",
  "url": "http://127.0.0.1:32766",
  "voice_name": "使いたいボイス名（空なら日本語対応の最初のボイス）",
  "language": "ja_JP",
  "app_name": "VoiSona Talk"
}
```

- `enabled` — TTS のマスタースイッチ。true でも認証情報が届くまでは音声なしで動きます
- `app_name` — MCP サーバ起動時に API へ到達できないとき `open -a` で起動するアプリ名（macOS）

### Cueと声のトーンの連動

`set_cue(cue)` が顔と声の両方を駆動します。各Cueファイル（`cues/<cue>.json`）の `voice` ブロックが
そのCueの声を決めます：

- `voice.style_weights` はスタイル名 → 重みのオブジェクト（`{"Happy": 0.7, "Bashful": 0.3}`）。
  ブレンド計算はせず、ボイスの `style_names` の並び順に変換して VoiSona の `global_parameters.style_weights`
  にそのまま渡ります
- `voice.alp` / `voice.huskiness` もCueに焼き込め、同じく `global_parameters` に素通しされます
- そのセリフ一行だけの演技（`pitch`/`speed`/`volume`/`intonation`）は `set_cue` の引数として渡します。
  Cueの `voice` と `set_cue` のアドリブパラメータはどちらも同じ `global_parameters` にマージされて送られます
- スタイル名はボイスごとに異なるので `GET {url}/api/talk/v1/voices/{voice_name}/{voice_version}` の
  `style_names` で確認して合わせてください。一致しない場合はデフォルトのトーンで喋ります

利用可能なボイス名は `GET {url}/api/talk/v1/voices`（Basic 認証）で確認できます。

- 雨衣（うい）ちゃんのボイスが発売されたら、`voice_name` を差し替えるだけで対応できる想定です
- エンジンに接続できない場合は音声なしで動き続けます（60 秒のクールダウン後に再試行）。その間のリップシンクはテキスト読み駆動（`set_cue` の `reading`）にフォールバックします

## 開発ツール

```bash
npm run dump-psd -- assets/ui_sozai.psd   # PSDレイヤー構造のダンプ
node tools/ws-test.mjs set_cue '{"cue":"happy","text":"テスト","reading":"てすと"}' # WebSocket直叩きテスト
node tools/mcp-test.mjs                       # MCP stdio 経由のE2Eテスト
```

アプリの終了は Dock アイコンから、または `pkill -f "ui-chan-mcp/node_modules/electron"`。
