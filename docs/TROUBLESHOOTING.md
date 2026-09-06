# 困ったときは

> **動かない、または思った通りにならないとき**に読みます。
> まず `ui-chan doctor` を実行してから、症状の近いものを開いてください。

---

## `01` 動かない

<details>
<summary><b>マスコットが画面に出てこない</b></summary>

`ui-chan start` で直接起こしてみて。それで出るなら、繋ぎ方の問題。
普通はセッションを開けば勝手に出てくるはずなんだけどね。
立ち絵が `~/.ui-chan/assets/` に無いときは、のっぺらぼうで出るよ。それはそれで。
</details>

<details>
<summary><b>声が出ない</b></summary>

よくある原因は次の3つです。VoiSona Talk が起きてない、
`~/.ui-chan/.env` に鍵が無い、VoiSona 側で REST API を有効にしてない。

声が出なくても吹き出しは出るし、口も `reading` のかなでパクパクするから、そんなに困らないと思う。
理由は `get_state` の `warnings` に書いてあるよ。詳しくは [docs/TTS.md](TTS.md)。
</details>

<details>
<summary><b>ビルドはいつ必要？</b></summary>

npm で入れたなら要らないよ。ビルド済みのものが届くから。
クローンして中を直すときだけ `npm run build` が要ります → [DEVELOPMENT.md](DEVELOPMENT.md)
</details>

---

## `02` うるさい・静かすぎる

<details>
<summary><b>アイドル中の独り言がうるさい／静かすぎる</b></summary>

`idle.idlingCues` の `minSec` / `maxSec`（既定 120〜300秒）で間隔、`weight` で出やすさ。
好感度で出し分けたいなら `minAffinity` / `maxAffinity`。

なお、キー入力やマウス操作がある間は黙っています。15分離席すると寝て、戻ると起きます
（`idle.idlingCues.systemIdle`）。
</details>

<details>
<summary><b>作業中の反応（失敗した・サブエージェントが帰ってきた 等）を変えたい</b></summary>

`ui-chan.config.json` の `eventCues.events`。イベントごとにセリフのプールがあって、
`cooldownSec` でうるささを、`chance` で「毎回言うか、たまにか」を決められるよ。
中身は IdlingCue と同じ形だから `weight` / `minAffinity` / `maxAffinity` / `hours` も効く。

用意してあるのは `permission`（許可待ち）、`idle_wait`（入力待ち）、`tool_failure`（こけた）、
`turn_done`（終わった）、`compact`、`agent_out`（お手伝いの子を送り出した）、`agent_back`（帰ってきた）。

セリフを変えるのに JavaScript は触らなくていいよ。フックは「何が起きたか」を投げるだけだから。
</details>

<details>
<summary><b>マスコットを終了させたい</b></summary>

マスコット右上のつまみを開いて、**電源のアイコン ⏻** を押します。これが最短です。
**エージェントがツールを呼んでも起き直しません**（次にセッションを開くか、
`ui-chan start` で起動するまで停止したままです）。

コマンドからは：

```bash
ui-chan stop     # 止める
ui-chan start    # 起こす
```

**放っておいても、繋がっているエージェントが全部いなくなれば自動で終了します**（既定 60 秒後。
`~/.ui-chan/config.json` の `exitAfterLastAgentSec`、`0` で無効）。猶予があるのは、
クライアントの再起動で一瞬切断されただけのときに消えないためです。

MCP ツールに終了コマンドはありません。エージェントが自分の都合でマスコットを閉じるのは、
ユーザーの画面を勝手に片付けることに等しいためです。
</details>

---

## `03` 中身を変えたい

<details>
<summary><b>新しい表情（Cue）を追加したい</b></summary>

`~/.ui-chan/cues/<名前>.json` を1個作るだけ。同じ名前なら同梱のを上書きするよ。
継承とか無いから、そのファイルだけ見れば分かる。**保存した瞬間に反映**されるから、
アプリを再起動しなくていいの。書き方は [docs/CUE_AUTHORING.md](CUE_AUTHORING.md)。
</details>

<details>
<summary><b>性格やセリフを変えたい</b></summary>

`persona/ui-chan.md` と `context/*.md`（`SOUL.md` が価値観、`VOCABULARY.md` が語彙と口癖、
`AFFINITY.md` が好感度の機微）。`~/.ui-chan/` 側に同じ名前で置けば上書きできます。
→ [PERSONA.md](PERSONA.md)
</details>

<details>
<summary><b>別のキャラクターに差し替えたい</b></summary>

`persona/` と `context/` を書き換え、PSD に合わせて `cues/` とレイヤー設定を作り直します。
どれも `~/.ui-chan/` 側に置けば上書きになるため、同梱物を削る必要はありません。
手順は [CUE_AUTHORING.md](CUE_AUTHORING.md) と [PERSONA.md](PERSONA.md)。
</details>

<details>
<summary><b>ういビームが撃てない</b></summary>

好感度が閾値（65）に達していません。感謝、気遣い、以前の発言を覚えていること、といった
振る舞いで上がります。直球の好意表現はむしろ下がります（`context/AFFINITY.md`）。

</details>

---

<sub>次に読むなら [TTS.md](TTS.md)（声まわりを詳しく） / [CLIENTS.md](CLIENTS.md)（どこに何が登録されているか）</sub>
