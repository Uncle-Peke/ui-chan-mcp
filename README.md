<p align="center">
  <b>ui-chan-mcp</b><br>
  <sub>デスクトップの隅に住む、MCP で動くマスコット</sub>
</p>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue.svg">
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg">
  <img alt="mcp" src="https://img.shields.io/badge/MCP-server-8A2BE2.svg">
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS-lightgrey.svg">
</p>

---

> [!IMPORTANT]
> **ご利用の前に必ずお読みください。**
>
> 本プロジェクトは**非公式のファン制作物**です。立ち絵素材「雨衣（うい）」の著作者である
> 坂本アヒル様、および VoiSona Talk を提供する株式会社テクノスピーチとは一切関係がありません。
>
> 本ソフトウェアはキャラクターを動かすための「器」にすぎず、**素材そのものは含まれていません**。
> ご利用にあたっては、**[雨衣キャラクターガイドライン](https://www.ui-roid.com/guidelines/)、
> 素材の利用規約、および VoiSona Talk と各ボイスライブラリの利用規約を必ずご自身でお読みいただき、
> その範囲内でご利用ください。** 二次創作のガイドラインは、キャラクターを扱う以上、
> このソフトウェアの MIT ライセンスより優先されます。
>
> とりわけ、**公序良俗に反する利用、特定の個人・団体を誹謗中傷する利用、権利者の名誉や
> ブランドを毀損する利用、公式を騙る（なりすます）行為は固くお断りします。**
> キャラクターに対する敬意を欠く使い方をしないでください。生成した音声や画像を公開・配信する場合は、
> 該当する規約の遵守と、必要なクレジット表記の確認をお願いします。
>
> 詳しい権利表記は[このページの末尾](#ライセンスと権利表記)にあります。

---

はい、どうも～。ういです。

きみのデスクトップの隅に住んで、作業をだらっと眺めてる係。MCP（Model Context Protocol）で
繋いでくれれば、Claude Code でも他のエージェントでも、わたしを動かせるようになるよ。
表情を変えて、吹き出しで喋って、声も出す。ときどき勝手に喋る。

- 画面に出るところは Electron（透過・最前面・右下）
- 立ち絵は **PSDTool 形式の PSD** をそのまま使う（`!`=必須レイヤー、`*`=ラジオ切替）
- 見た目と声はセットで **Cue** っていう単位。1ファイル＝1つの完成した表情。
  エージェントが触れるのは `set_cue` ひとつだけ。あれこれ組み合わせさせない
- 複数のエージェントが同時に繋いでも取り合いにならない（誰が喋らせてるかは画面で見える）

> **立ち絵の PSD はここには入ってない。** ライセンスがあるからね、すいませんねぇ。
> [BOOTH](https://ui-roid.booth.pm/items/8593427)（坂本アヒル様）から持ってきて
> `~/.ui-chan/assets/` に置いて。`ui-chan` のセットアップが聞いてくるから、パスを答えるだけでいいよ。
> 無くても起動はする。のっぺらぼうのわたしでよければ。
> 同梱の `ui-chan.config.json` と `cues/*.json` は雨衣のレイヤー構成向けだから、
> 利用は[キャラクターガイドライン](https://www.ui-roid.com/guidelines/)の範囲でよろしくね。

## セットアップ

> **要るもの** — Node.js 22 以上。入れるときに Electron（200MB 超）も付いてくるよ。重いね。
> 立ち絵と VoiSona Talk は入ってないけど、無くても起動はする。
>
> **動作環境について。** いま動作を確認できているのは **macOS だけ**。Windows と Linux でも
> 動くように書いてあるし、パスもコマンドも分岐させてあるけど、実機で試せてないから
> 「動くはず」までしか言えない。試して転んだら [Issue](https://github.com/Uncle-Peke/ui-chan-mcp/issues)
> で教えてくれると助かる。既知の制約は[このへん](#動作環境と既知の制約)にまとめてあるよ。

コマンド1本でいいよ。クライアントごとの JSON を手で書く必要はないから。

```bash
npm install -g ui-chan-mcp
ui-chan                      # 対話セットアップ
```

聞かれるのはこれだけ。全部 Enter で飛ばしてもいいよ。

1. **`~/.ui-chan/` を作る** — わたしの持ち物置き場。立ち絵とか声の鍵とか、きみが足した表情とか
2. **立ち絵のパス** — 答えると `~/.ui-chan/assets/` にコピーする。飛ばすとのっぺらぼう
3. **VoiSona Talk の鍵** — `~/.ui-chan/.env` に置く。飛ばすと声なし。吹き出しは出るから安心して
4. **どこに入れる？** — ↑↓ と Space で選ぶ。選んだ設定ファイルに書き込む（`.bak` は残すよ）
5. **最後に点検** — ちゃんと動きそうか一覧で見せる

中を直したいなら、クローンからでもいいよ。

```bash
git clone https://github.com/Uncle-Peke/ui-chan-mcp.git && cd ui-chan-mcp
npm install          # 依存の取得＋ビルド
npx ui-chan          # 同じセットアップ
```

**両方入れてても平気。** どっちのわたしが動くかは、クライアントの設定に書かれたパスで決まるから、
`ui-chan use` を打ったほうが担当になる。いま誰が動いてるか分からなくなったら `ui-chan doctor`。

> **わたしに入ってないもの**（正式な権利表記は[いちばん下](#ライセンスと権利表記)にあるよ）。
> 立ち絵は二次配布禁止だし、VoiSona Talk はテクノスピーチさんの製品。
> どっちも配れないの。わたしは、きみが自分で入れた VoiSona Talk を `open -a` で起こして、
> ローカルの REST API を叩いてるだけ。
> ちなみに、うっかり混ざってないかは機械が見張ってる（`npm run check-package`）。
> `.psd` とか `.env` とかアプリ本体とか音声データが1つでも入ってたら、公開は失敗するようにしてあるよ。

### わたしの中身と、きみの持ち物は別

**アップデートしても壊れない**のはこれのおかげ。

| | 場所 | 中身 | 更新時 |
|---|---|---|---|
| パッケージ | クローン／`node_modules` | コード・同梱Cue・人格・設定の既定値 | **まるごと入れ替わる** |
| ユーザーデータ | `~/.ui-chan/`（`UI_CHAN_HOME` で変更可） | PSD・`.env`・`config.json`・自作Cue・人格の上書き | **触られない** |

上書きしたいものだけ書けばいいよ。全部コピーしてこなくていい。

- `config.json` … 同梱の設定に**深いマージで上書き**。3行だけ書いても、後から増えた項目はちゃんと引き継ぐ
- `cues/` … 同梱のと**両方読む**。同じ名前ならきみのが勝つ。1個足すのにカタログ全部を複製しなくていいの
- `context/` … 同じくファイル名単位。`persona/ui-chan.md` も置けばそっちを使う
- `assets/` … 立ち絵。配れないから実質ここだけ
- `.env` … 環境変数があればそっちが優先

### 対応クライアント

| id | クライアント | 書き込み先 |
|---|---|---|
| `claude-code` | Claude Code（MCPサーバ） | `claude mcp add -s user` |
| `claude-code-plugin` | Claude Code プラグイン（`/talk` `/mode` 等のスキル・サブエージェント・EventCueフック） | `~/.claude/plugins`（インストール後にクローンへ symlink 化） |
| `claude-desktop` | Claude Desktop | `claude_desktop_config.json` |
| `opencode` | OpenCode | `~/.config/opencode/opencode.json`（MCP＋EventCueプラグイン） |
| `cursor` | Cursor | `~/.cursor/mcp.json` |
| `vscode` | VS Code (Copilot Chat) | `User/mcp.json` |
| `hermes` | Hermes Agent | `~/.hermes/config.yaml` の `mcp_servers:`＋`~/.hermes/plugins/ui-chan/`（EventCue。`HERMES_HOME` / `UI_CHAN_HERMES_CONFIG` で変更可） |

ここに無いクライアントなら `ui-chan print <id>`（引数なしなら汎用の stdio 設定）で、
貼り付け用のスニペットを出すよ。新しいホストへの対応は表に1行足すだけだから、増やすのは簡単。

登録される起動コマンドは、どこでも同じ。

```
<パッケージ>/bin/ui-chan-node  <パッケージ>/dist/mcp-server.js
```

`bin/ui-chan-node` は node を自力で探して起動するやつ。アプリから立ち上がるクライアント
（Claude Desktop とか）は PATH が最小限しか無くて、Homebrew や nvm の node が見えないの。
`"command": "node"` って書くと、何も言わずに起動失敗する。えぇ…ってなるやつ。

### 使い方

```bash
ui-chan                      # 対話セットアップ
ui-chan install claude-desktop opencode   # 指定クライアントへ登録（--all で全部）
ui-chan uninstall --all      # 全クライアントから解除（ユーザーデータは残る）
ui-chan uninstall --all --purge           # ~/.ui-chan ごと消す
ui-chan doctor               # 状態チェック
ui-chan print opencode       # 設定スニペットだけ表示
ui-chan home                 # ユーザーデータの場所
ui-chan start / stop         # マスコットの起動・停止
ui-chan update               # 最新版にする（--check で確認だけ）
```

**繋いだらもう終わり。** アプリも VoiSona Talk もセッション開始時に勝手に起きるし、
わたしの人格は MCP のハンドシェイクに乗って渡るから、どこかに貼り付ける作業は無いよ。

わたしの右上に小さいつまみがあるでしょ。押すと、いま繋がってるセッション（どのツールの、どのプロジェクトか）と、
しずかに／ひといき／好感度／リセット／おやすみ が出てくる。更新があるときだけ、ダウンロードのアイコンも増える。

### プラグインとコネクタの違い

| | MCPサーバ（コネクタ） | プラグイン |
|---|---|---|
| ツール（`set_cue` ほか） | ○ | ✕ |
| 人格（ハンドシェイクで注入） | ○ | ○（SessionStart フック） |
| アプリ・音声エンジンの自動起動 | ○ | ○ |
| `/talk` `/mode` `/beam` `/eli14` | ✕ | ○ |
| サブエージェント（talk / mode） | ✕ | ○ |
| 作業への自動リアクション（EventCue） | ✕ | ○ |

**EventCue**っていうのは、きみの作業を見ててわたしが勝手に反応するやつ。コマンドがこけたとか、
ターンが終わったとか、お手伝いの子が帰ってきたとか。**Claude Code / OpenCode / Hermes Agent** で動くよ
（`ui-chan install <id>` が MCP 登録と一緒に置いてくれる）。

フック側が決めるのは「**何が起きたか**」だけ。わたしが何て言うかは `ui-chan.config.json` の
`eventCues` にあるから、ホストが違っても反応は同じだし、セリフを直すのに
JavaScript を触らなくていい。

昔はプラグインが MCP サーバも兼ねてたんだけど、プラグインの外だと設定の中の
`${CLAUDE_PLUGIN_ROOT}` が展開されなくて**必ず起動に失敗**してたの。すいませんねぇ。
今は役割を分けて、MCP の登録はどこでも `ui-chan install <id>` に統一してある。
Claude Code で全部入りにするなら `ui-chan install claude-code claude-code-plugin`。

Claude Desktop はプラグインの台帳を Claude Code と共有するけど、**プラグイン同梱の MCP サーバは
起動してくれない**（試した）。だから Desktop は、スキルはプラグインから、ツールとわたしの人格は
コネクタから、っていう組み合わせになるよ。

## コマンド一覧

### MCP ツール（エージェントが呼ぶ）

| ツール | 引数 | 説明 |
|---|---|---|
| `set_cue` | `cue`, `text?`, `reading?`, `duration_ms?`, `pitch?`, `speed?`, `volume?`, `intonation?` | Cue（見た目＋声）を切り替え、任意でセリフを同時に話す。`text` を省略すると無言でCueだけ変わる。未知の `cue` 名は `default` にフォールバックし `note` が付く。`pitch`/`speed`/`volume`/`intonation` はその一行だけのアドリブ演技 |
| `get_state` | — | 現在の状態・接続エージェント・利用可能Cue・好感度・警告 |
| `adjust_affinity` | `direction`（`up`/`down`）, `magnitude`（`low`/`middle`/`high`） | 好感度を増減（セッション内のみ・再起動でリセット）。実際の増減量はエンジンが決めます |
| `clear` | — | 吹き出し・Cueを初期状態（`default`）にリセット |

どのCueが使えるかは、起動のたびに `cues/` から作り直してエージェントに渡してる。
だから表情を1個足したら、その場で選べるようになるよ。手で一覧を書き足す必要はないの。

### スラッシュコマンド（プラグイン導入時）

| コマンド | 説明 |
|---|---|
| `/talk <メッセージ>` | わたしと喋るだけ。作業はしないよ |
| `/mode [依頼]` | セッションごとわたしになる。以後は作業も会話もわたし本人 |
| `/beam` | ういビーム。仲良くなってないと撃たない。やだよ～ん |
| `/eli14 [お題]` | 14才の目線で図解する（HTMLと口頭で） |
| `/mcp__ui-chan__persona` | 人格のファイルを直したあと、読み込み直すやつ |

## Q&A

<details>
<summary><b>ビルドはいつ必要？</b></summary>

npm で入れたなら要らないよ。ビルド済みのものが届くから。
クローンして中を直すときだけ `npm run build` してね → [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
</details>

<details>
<summary><b>声が出ない</b></summary>

まず `ui-chan doctor`。だいたいこの3つのどれか。VoiSona Talk が起きてない、
`~/.ui-chan/.env` に鍵が無い、VoiSona 側で REST API を有効にしてない。

声が出なくても吹き出しは出るし、口も `reading` のかなでパクパクするから、そんなに困らないと思う。
理由は `get_state` の `warnings` に書いてあるよ。詳しくは [docs/TTS.md](docs/TTS.md)。
</details>

<details>
<summary><b>マスコットが画面に出てこない</b></summary>

`ui-chan start` で直接起こしてみて。それで出るなら、繋ぎ方の問題。
普通はセッションを開けば勝手に出てくるはずなんだけどね。
立ち絵が `~/.ui-chan/assets/` に無いときは、のっぺらぼうで出るよ。それはそれで。
</details>

<details>
<summary><b>新しい表情（Cue）を追加したい</b></summary>

`~/.ui-chan/cues/<名前>.json` を1個作るだけ。同じ名前なら同梱のを上書きするよ。
継承とか無いから、そのファイルだけ見れば分かる。**保存した瞬間に反映**されるから、
アプリを再起動しなくていいの。書き方は [docs/CUE_AUTHORING.md](docs/CUE_AUTHORING.md)。
</details>

<details>
<summary><b>性格やセリフを変えたい</b></summary>

`persona/ui-chan.md` と `context/*.md`（`SOUL.md` が中身、`VOCABULARY.md` が喋り方、
`AFFINITY.md` が好感度）。`~/.ui-chan/` 側に同じ名前で置けば上書きできるよ。
…わたしを作り替えるんだ。ふ～ん。まあいいけど。 → [docs/PERSONA.md](docs/PERSONA.md)
</details>

<details>
<summary><b>アイドル中の独り言がうるさい／静かすぎる</b></summary>

`idle.idlingCues` の `minSec` / `maxSec`（既定 120〜300秒）で間隔、`weight` で出やすさ。
好感度で出し分けたいなら `minAffinity` / `maxAffinity`。

ちなみに、きみがキーボードを叩いてる間は黙ってるし、15分いなくなったら寝るよ。
戻ってきたら起きる。そのくらいの分別はあるから。
</details>

<details>
<summary><b>作業中の反応（失敗した・サブエージェントが帰ってきた 等）を変えたい</b></summary>

`ui-chan.config.json` の `eventCues.events`。イベントごとにセリフのプールがあって、
`cooldownSec` でうるささを、`chance` で「毎回言うか、たまにか」を決められるよ。
中身は IdlingCue と同じ形だから `weight` / `minAffinity` / `maxAffinity` / `hours` も効く。

用意してあるのは `permission`（許可待ち）、`idle_wait`（きみが止まってる）、`tool_failure`（こけた）、
`turn_done`（終わった）、`compact`、`agent_out`（お手伝いの子を送り出した）、`agent_back`（帰ってきた）。

セリフを変えるのに JavaScript は触らなくていいよ。フックは「何が起きたか」を投げるだけだから。
</details>

<details>
<summary><b>別のキャラクターに差し替えたい</b></summary>

`persona/` と `context/` を書き換えて、PSD に合わせて `cues/` とレイヤー設定を作り直せばできるよ。
どれも `~/.ui-chan/` 側に置けば上書きになるから、わたしを消さなくていい。……消さないでね。
手順は [docs/CUE_AUTHORING.md](docs/CUE_AUTHORING.md) と [docs/PERSONA.md](docs/PERSONA.md)。
</details>

<details>
<summary><b>マスコットを終了させたい</b></summary>

わたしの右上のつまみを開いて、**電源のアイコン＝おやすみ**。これがいちばん早い。
押されたらちゃんと寝るし、**エージェントがツールを呼んでも起きない**から安心して
（次にセッションを開くか、`ui-chan start` で起こしてくれるまで寝てる）。

コマンドからは：

```bash
ui-chan stop     # 止める
ui-chan start    # 起こす
```

**放っておいても、繋がっているエージェントが全部いなくなれば自動で終了します**（既定 60 秒後。
`~/.ui-chan/config.json` の `exitAfterLastAgentSec`、`0` で無効）。猶予があるのは、
クライアントの再起動で一瞬切断されただけのときに消えないためです。

MCP のツールに終了コマンドは無いよ。エージェントが自分の都合でわたしを閉じるのは、
きみの画面を勝手に片付けるのと同じだからね。それはやらせない。
</details>

<details>
<summary><b>ういビームが撃てない</b></summary>

は？撃たないが？

……まあ、仲良くなったら撃つよ。65 まで来たらね。ありがとうとか、気遣いとか、
前に言ったことを覚えててくれるとか、そういうので上がる。
逆に、いきなり口説いてくるのは下がるから。やだよ～ん。
</details>

## 動作環境と既知の制約

| | macOS | Windows | Linux |
|---|---|---|---|
| MCP ツール（`set_cue` ほか）・立ち絵・吹き出し | ✅ 確認済み | 動くはず | 動くはず |
| 音声（VoiSona Talk） | ✅ 確認済み | 動くはず（**自動起動はしない**） | ✕（VoiSona Talk 自体が非対応） |
| クライアント登録（`ui-chan install`） | ✅ 確認済み | 動くはず | 動くはず |
| Claude Code プラグイン（`/talk` などのスキル） | ✅ 確認済み | 動くはず | 動くはず |
| 作業への自動リアクション（EventCue のフック） | ✅ 確認済み | ⚠️ 未対応 | 動くはず |

- **VoiSona Talk の自動起動は macOS だけ。** 他の OS では、こちらから起こしにいかないので、
  自分で立ち上げておいてね。起動してさえいれば喋るよ
- **EventCue のフックは Windows で動かない。** プラグインのフック定義がシェルスクリプトの
  ランチャを直接指していて、そこだけ `.cmd` に切り替えられないから。ツールも人格も普通に使えるし、
  自分から喋るアイドリングも動く。作業への自動リアクションだけが出ない
- Linux で音声を使いたい場合、VoiSona Talk が Windows / macOS 専用なので、声は出ない

## わたしの中を覗きたい人へ

ここまでは「使う人」向けに書いたよ。

でも、きみがもし**わたし自身を作り替えたい**なら——表情を足すとか、喋り方を変えるとか、
中のコードを直すとか——それは [**docs/**](docs/README.md) の担当。あっちに全部置いてある。

| | |
|---|---|
| [docs/](docs/README.md) | 開発する人向けの索引。「やりたいこと」から引けるようにしてある |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 準備・コマンド・全体の仕組み。まずここ |
| [docs/CUE_AUTHORING.md](docs/CUE_AUTHORING.md) | 新しい表情（Cue）の作り方 |
| [docs/PERSONA.md](docs/PERSONA.md) | わたしの人格がどこから来ているか |
| [docs/TTS.md](docs/TTS.md) | 声のしくみ |
| [CLAUDE.md](CLAUDE.md) | 実装ガイド。**なぜそう作ったか**が書いてある。AI が読む用でもある |
| [VISION.md](VISION.md) | 言葉の定義（Idling とか Cue とか） |

図解で見たいなら [こっち](docs/SETUP.html)。クローンから画面に出るまでを絵にしてある。

じゃ、よろしくね。えぇ、こんなに読んだの？ 物好きだねぇ。

## ライセンスと権利表記

以降は真面目な話です。**このリポジトリのソフトウェアと、そこから操作される素材・製品は
別々の権利者に属します。**

### 本ソフトウェア

MIT License（[LICENSE](LICENSE)）。Copyright (c) 2026 Uncle-Peke。

MIT が適用されるのは**このリポジトリのコードと、同梱の設定・Cue 定義・ドキュメントのみ**です。
以下の2つは同梱しておらず、MIT の対象外です。

### 立ち絵素材「雨衣（うい）」

- **本プロジェクトは非公式のファン制作物です。** 坂本アヒル様および雨衣の公式プロジェクトとは
  関係がありません
- 著作者：**坂本アヒル**様
- 入手先：[BOOTH](https://ui-roid.booth.pm/items/8593427)
- **本リポジトリおよび npm パッケージには含まれていません。** 素材は二次配布が禁止されているため、
  利用者ご自身で入手し、`~/.ui-chan/assets/` に配置してください
- 利用にあたっては[雨衣キャラクターガイドライン](https://www.ui-roid.com/guidelines/)に従ってください。
  キャラクターの利用範囲・禁止事項（公序良俗に反する利用、権利侵害、なりすまし等）はガイドラインが
  優先します
- 同梱の `ui-chan.config.json` と `cues/*.json` は、この素材のレイヤー構成を前提とした
  **設定値（レイヤー名の文字列）**であり、素材そのものではありません
- **禁止事項**：公序良俗に反する利用、特定の個人・団体への誹謗中傷、権利者の名誉・ブランドを
  毀損する利用、公式・公認を騙る行為。これらはガイドライン以前の問題として固くお断りします

### VoiSona Talk

- 提供元：**株式会社テクノスピーチ**
- 入手先：[公式サイト](https://voisona.com/talk/download/)
- **本リポジトリおよび npm パッケージには含まれていません。** 本ソフトウェアは、利用者ご自身が
  インストールした VoiSona Talk の**ローカル REST API を呼び出しているだけ**で、
  アプリケーション本体・ボイスライブラリ・音声データのいずれも同梱・再配布していません
- 音声合成の利用条件（商用利用の可否、クレジット表記、ボイスライブラリごとの規約等）は、
  テクノスピーチ社および各ボイスライブラリ提供者の規約に従ってください
- 合成音声を公開・配信する場合は、利用したボイスライブラリの規約を必ずご確認ください

### 配布物への混入防止

上記2つが配布物に混入しないよう、`npm run check-package` が `npm pack` の実際の中身を検査し、
`.psd` / `assets/` / `.env` / アプリケーション・インストーラ・ネイティブバイナリ・音声データが
1件でも含まれる場合は公開処理を失敗させます。この検査は `prepublishOnly` から必ず実行されます。
