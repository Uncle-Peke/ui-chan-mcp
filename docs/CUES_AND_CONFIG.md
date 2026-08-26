# Cue と設定ファイル

README から分離した詳細リファレンス。新しい Cue を書くとき、`ui-chan.config.json` を
調整するときはここを見る。PSD のレイヤー名カタログは `docs/CUES.md`。

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
- `description`（任意） — このCueがどんな場面・気持ちを表すかの短い説明。`set_cue`の実行には一切
  使われず、`persona` MCPプロンプトが起動のたびに`cues/`の中身から動的にAI向けカタログを生成する
  ためだけに読まれる（手書きの早見表を持たないので、Cue追加時にドキュメント更新を忘れてズレる、
  ということが起きない）
- `internal`（任意・真偽値） — `true`にすると、そのCueはAI向けカタログから除外される（`set_cue`で
  直接呼べば動作はする）。IdlingCueが内部的に組み立てるための部品Cue（`cues/idling_*.json`）に付与

Cue選定・PSDレイヤー名カタログなど、**新規Cue制作のための人間向け参照ドキュメント**は
`docs/CUES.md` を参照。実行時にもAIのコンテキストにもロードされない（`context/`ではなく
あえて`docs/`に置いている）。

## 設定（ui-chan.config.json）

- `assetsDir` — PSD を探すディレクトリ（最初に見つかった `.psd` を使用）
- `window` — ウィンドウサイズ・画面端からのマージン
- `exitAfterLastAgentSec` — 最後のエージェントが切断してから終了するまでの秒数（既定 60、`0` で無効）。
  アプリは detached で起動するため、これが無いとクライアントを閉じても残り続ける。
  猶予を置くのは、Claude Code の再起動による一時的な切断で消えないようにするため
- `cuesDir` — Cueのディレクトリ（デフォルト `cues`）
- `idle.idlingCues` — アイドル中に自発的に再生される**IdlingCue**（Cue＋任意のセリフのステップ列）のプール。
  `items[].steps[]`は`{ cue?, text?, reading?, holdMs? }`で、`cue`を省略すると直前のCueを維持する。
  各 IdlingCue は `weight`（出やすさ、デフォルト 1）、`minAffinity`（必要な好感度）、`maxAffinity`（上限好感度）を持てる。
  無言の仕草（あくび、きょろきょろなど）は `weight` を高く、レアな独り言や高好感度専用セリフは `weight` を低く／`minAffinity` を高く、低好感度専用の冷たい反応は `maxAffinity` を低く設定する。
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
