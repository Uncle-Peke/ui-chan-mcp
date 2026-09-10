# Cue・固定セリフを書く / 設定を変える

> **新しい表情（Cue）を足すとき**、**独り言や反応のセリフ（固定セリフ）を書くとき**、**設定を調整するとき**に読みます。
> 使えるレイヤー名の早見表は [PSD_LAYERS.md](PSD_LAYERS.md)、カタログ全体の方針は [design/CUE_CATALOG.md](design/CUE_CATALOG.md)。

---

## `01` Cue（cues/）

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
- `voice` が持てるのは `style_weights` だけです（`alp`/`huskiness` は廃止）
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
  直接呼べば動作はする）。エージェントに直接選ばせたくないCueに付ける（同梱のCueには今は無い。
  固定セリフの見た目はシーケンス側が自前で持つので、そのための部品Cueは要らない）

Cue選定・PSDレイヤー名カタログなど、**新規Cue制作のための人間向け参照ドキュメント**は
`docs/PSD_LAYERS.md` を参照。実行時にもAIのコンテキストにもロードされない（`context/`ではなく
あえて`docs/`に置いている）。

---

## `02` 固定セリフ（sequences/）

アイドル中の独り言（IdlingCue）、作業中の反応（EventCue）、つつかれたときの反応（FidgetCue）は、
**`sequences/` に 1 本 = 1 ファイル**で置きます（`sequence.schema.json` 準拠）。**ディレクトリで種類が
決まり**、ファイル名がそのまま名前になります。保存すると即時リロードされます。

| 置き場所 | 種類 |
|---|---|
| `sequences/idling/<名前>.json` | IdlingCue |
| `sequences/presence/away.json` / `wake.json` | 離席したとき／戻ってきたとき |
| `sequences/fidget/poke/<名前>.json` | つつかれたとき |
| `sequences/fidget/spam/<名前>.json` | 何度もつつかれたとき |
| `sequences/event/<イベント名>/<名前>.json` | EventCue |

```jsonc
{
  "weight": 2,          // 出やすさ（省略時 1）
  "maxAffinity": 34,    // 好感度がこれ以下のときだけ（minAffinity・hours もある）
  "steps": [
    {
      "look": {         // 見た目と声色。Cue ファイルと同じ書き方（default からの差分）
        "select": ["!目/*…"],
        "voice": { "style_weights": { "Angry": 0.5, "Normal": 0.5 } }
      },
      "text": "……なに？",
      "reading": "……なに？",
      "delivery": { "ending": "flat" }  // この一行だけの演技指定
    }
  ]
}
```

- **各ステップは見た目と声を自分で持ちます。** `cues/` の Cue を名前で借りる書き方はありません
  ——借りていた頃は、エージェント向けに Cue を直すと固定セリフの声まで一緒に変わっていました
- `look` を省略したステップは、直前のステップの見た目と声のまま続きます（`{}` は `default`）
- `text` のあるステップはセリフを喋り終えてから次へ、無いステップは `holdMs`（既定 2000）だけ続きます
- **`delivery`** は `ending` / `speed` / `pitch` / `stretchSec` / `words` など、その一行だけの演技指定。
  `set_cue` には無い口で、**人が事前に書いた行**だけが持てる → [design/PROSODY.md](design/PROSODY.md)
- 無言の仕草（あくび、きょろきょろなど）は `weight` を高く、レアな独り言や高好感度専用セリフは
  `weight` を低く／`minAffinity` を高く、低好感度専用の冷たい反応は `maxAffinity` を低く設定する
- ホーム（`~/.ui-chan/sequences/`）に同じ相対パスで置けば、そのファイルだけが差し替わります

---

## `03` 設定（ui-chan.config.json）

- `assetsDir` — PSD を探すディレクトリ（最初に見つかった `.psd` を使用）
- `window` — ウィンドウサイズ・画面端からのマージン
- `cuesDir` — Cueのディレクトリ（デフォルト `cues`）
- `idle.idlingCues` / `interactions` / `eventCues` — 固定セリフの**出し方**（間隔、離席の判定、
  連打の判定、`cooldownSec`・`chance`）。セリフそのものは `sequences/`（→ `02`）
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

---

<sub>次に読むなら [PSD_LAYERS.md](PSD_LAYERS.md)（レイヤー名を引く） / [TTS.md](TTS.md)（声色の指定）</sub>
