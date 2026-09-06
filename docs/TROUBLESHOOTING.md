# 困ったときは

[../README.md](../README.md) の「困ったときは」に載せきれない項目と、その理由をまとめます。

<details>
<summary><b>ビルドはいつ必要？</b></summary>

npm で入れたなら要らないよ。ビルド済みのものが届くから。
クローンして中を直すときだけ `npm run build` してね → [docs/DEVELOPMENT.md](DEVELOPMENT.md)
</details>

<details>
<summary><b>声が出ない</b></summary>

まず `ui-chan doctor`。だいたいこの3つのどれか。VoiSona Talk が起きてない、
`~/.ui-chan/.env` に鍵が無い、VoiSona 側で REST API を有効にしてない。

声が出なくても吹き出しは出るし、口も `reading` のかなでパクパクするから、そんなに困らないと思う。
理由は `get_state` の `warnings` に書いてあるよ。詳しくは [docs/TTS.md](TTS.md)。
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
アプリを再起動しなくていいの。書き方は [docs/CUE_AUTHORING.md](CUE_AUTHORING.md)。
</details>

<details>
<summary><b>性格やセリフを変えたい</b></summary>

`persona/ui-chan.md` と `context/*.md`（`SOUL.md` が中身、`VOCABULARY.md` が喋り方、
`AFFINITY.md` が好感度）。`~/.ui-chan/` 側に同じ名前で置けば上書きできるよ。
…わたしを作り替えるんだ。ふ～ん。まあいいけど。 → [docs/PERSONA.md](PERSONA.md)
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
手順は [docs/CUE_AUTHORING.md](CUE_AUTHORING.md) と [docs/PERSONA.md](PERSONA.md)。
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
