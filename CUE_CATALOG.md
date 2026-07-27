# CUE_CATALOG — Cueカタログ設計（あるべき一覧とMECE方針）

現在の Cue 群を **MECE（漏れなく・ダブりなく）に整理**するための設計ドキュメント。
「表情をこの世に何個あるか」から逆算し、心理学モデルを**構造の背骨**として採用する。
ここは *あるべき姿* の定義。実ファイル（`cues/*.json`）の現状との対応・被り・欠番を可視化し、
統合／新規／改名の判断材料にする。実装はこの後。

> 関連: `VISION.md`（製品ビジョン・ユビキタス言語）／ `docs/CUES.md`（Cue *作成*用の生レイヤーパス参照）。
> 本ファイルは *分類* の設計であり、両者とは役割が違う。

## 方針（なぜこの構造か）

1. **敵は「数」ではなく「被り＋フラットな羅列」。** 66個フラットで境界が曖昧だと、AI（`set_cue`）が
   毎回どれを選ぶか判別できず選択がブレる（＝MCPツールが多すぎて使えない問題と同じ）。
2. **重複統合は表現力の損失ゼロ。** 同義Cueはどちらを選んでも同じ＝表現に何も足していない。消しても幅は狭まらない。
3. **幅（網羅）は "別物の表情" を全部残して守る。** 心理学モデルは *埋める格子* ではなく **抜けチェックの点検表**として使う。
4. **使いこなせるかは "数" ではなく "構造" で解く。** ファミリー分類＋強度ラダー＋鋭いdescriptionで
   `family → cue` と辿れるようにする（`buildCueCatalog` をグループ化出力に）。
5. Plutchik を背骨に選ぶ理由: Ekman6 / Cowen-Keltner16 は **平たいリスト**。Plutchik は **2軸グリッド＋関係性**で、
   *構造そのものから表現が生成される*（強度ラダー＝既存の `_strong`、隣接ブレンド＝`love`/`contempt`）。

## 分類軸（背骨）

| 層 | 数 | 内容 |
|---|---|---|
| ① 基本感情 | **8** | 喜 / 信頼 / 恐 / 驚 / 悲 / 嫌悪 / 怒 / 期待（Plutchik） |
| ② 強度 | 各 **最大3** | 弱 / 無印 / 強（全感情に3段作る義務は無い＝点検表） |
| ③ ブレンド（隣接dyad） | **8** | 8基本の隣り合わせ。愛/服従/畏敬/失望/自責/侮蔑/攻撃/楽観 |
| ④ 自己意識感情 | **4** | 照れ / 恥 / 罪悪感 / 誇り（感情の輪の外。ツンデレの核） |
| ⑤ システム表情 | 可変（~10） | 思考/説明/配信/眠気/作業結果/特殊 等。心理学に無い**マスコット固有軸** |

> 「隣接なら6では？」への答え = **8**。Ekman6 には輪の順序が無く隣接を定義できない。Plutchik が *あえて8* に
> しているのは、8で輪が閉じて隣接が8つの意味あるブレンドになるから。6に削ると輪が壊れブレンドが破綻する。

## 命名規則

- **論理名** = 分類上のスロット（例: 「喜び・強」「侮蔑」）。人間・カタログ用。
- **物理名** = Cueファイル名 `cues/<物理名>.json`（例: `happy_strong`）。`set_cue` に渡す実名。
- **強度**: 無印 = 素の名前（`happy` = 中）。極だけ接尾辞 `_weak` / `_strong` を足す（既存 `_strong` 準拠、改名コスト最小）。
  全感情に3段は作らない — 要る所だけ。
- **状態記号**: ✅既存流用 / ⚠️被り(統合候補) / ⛔欠番(新規要検討) / 🔀別層へ移動

---

## ① 基本感情 × 強度

### 喜び Joy
| 強度 | 論理名 | 物理名 | 現Cue | 状態 |
|---|---|---|---|---|
| 弱 | 平穏 serenity | `smile` | smile（微笑み） | ✅ |
| 無印 | 喜び joy | `happy` | happy（うれしい） | ✅ |
| 強 | 恍惚 ecstasy | `happy_strong` | happy_strong（大喜び） | ✅ |
| 変種 | はしゃぎ | `kyakkya` | kyakkya（きゃっきゃ） | ⚠️ happy_strong と近い（要差別化 or 統合） |

### 信頼 Trust
| 強度 | 論理名 | 物理名 | 現Cue | 状態 |
|---|---|---|---|---|
| 弱 | 容認 | — | — | ⛔（表情に出にくい。要否検討） |
| 無印 | 信頼 | — | — | ⛔ |
| 強 | 敬愛 admiration | `uioji` | uioji（愛でる・ういおじ化） | ✅ 強寄り（溺愛） |

### 恐れ Fear
| 強度 | 論理名 | 物理名 | 現Cue | 状態 |
|---|---|---|---|---|
| 弱 | 不安 apprehension | `yabe` | yabe（冷や汗・やべっ） | ✅ 弱寄り（システム焦りとも重なる） |
| 無印 | 恐れ fear | `scared` | scared（怖い） | ✅ |
| 強 | 恐怖 terror | `scared_strong` | scared_strong（強い恐怖） | ✅ |

### 驚き Surprise
| 強度 | 論理名 | 物理名 | 現Cue | 状態 |
|---|---|---|---|---|
| 弱 | 放心 distraction | `kyoton` | kyoton（きょとん・ぽかーん） | ✅（システム放心とも） |
| 無印 | 驚き surprise | `surprised` | surprised / **odoroki** | ⚠️ **被り**（surprised と odoroki 同義 → 統合） |
| 強 | 驚愕 amazement | `surprised_strong` | surprised_strong / **shock** | ⚠️ shock は失望寄りにも（下記④失望と要仕分け） |

### 悲しみ Sadness
| 強度 | 論理名 | 物理名 | 現Cue | 状態 |
|---|---|---|---|---|
| 弱 | 憂い pensiveness | — | — | ⛔（しんみり。欠番） |
| 無印 | 悲しみ sadness | `sad` | sad（悲しい） | ✅ |
| 強 | 悲嘆 grief | `sad_strong` | sad_strong / **naku** | ⚠️ 近い（naku=涙で差別化する前提なら両立可） |

### 嫌悪 Disgust
| 強度 | 論理名 | 物理名 | 現Cue | 状態 |
|---|---|---|---|---|
| 弱 | 退屈 boredom | — | （nemui の退屈成分） | 🔀 退屈は⑤眠気/退屈へ |
| 無印 | 嫌悪 disgust | — | — | ⛔（純粋な「うわ、無理」。欠番） |
| 強 | 強い嫌悪 loathing | — | — | ⛔ |
| 注 | — | — | — | 塩対応(jito/shiozake)は嫌悪単体でなく**⑥侮蔑ブレンド**へ |

### 怒り Anger
| 強度 | 論理名 | 物理名 | 現Cue | 状態 |
|---|---|---|---|---|
| 弱 | 苛立ち annoyance | `mutto` | mutto（むっ） / **fuman**（不満） | ⚠️ **被り** → 統合 |
| 無印 | 怒り anger | `angry` | angry（怒り） | ✅ |
| 強 | 激怒 rage | `gekioko` | gekioko（激おこ） | ✅ |

### 期待 Anticipation
| 強度 | 論理名 | 物理名 | 現Cue | 状態 |
|---|---|---|---|---|
| 弱 | 関心 interest | — | （思考系はシステムへ） | 🔀 |
| 無印 | 期待 anticipation | `excited` | excited（ワクワク・興奮） | ✅（⑧楽観とも重なる） |
| 強 | 警戒/決意 vigilance | `yaruki` | yaruki（やる気・気合い） | ✅ 強寄り |

---

## ③ ブレンド（隣接dyad）8

| 論理名 | 構成 | 物理名 | 現Cue | 状態 |
|---|---|---|---|---|
| 愛 love | 喜+信頼 | `love` / `deredere` | love（恋ときめき） / deredere（とろけ） | ⚠️ 近い（love=無印 / deredere=強、で両立余地） |
| 服従 submission | 信頼+恐 | — | — | ⛔（マスコット的に不要かも） |
| 畏敬 awe | 恐+驚 | `kantan` | kantan（感嘆・おおー） | ✅ |
| 失望 disappointment | 驚+悲 | `gennari` | gennari（げんなり） / （shock の負の面） | ✅ |
| 自責 remorse | 悲+嫌悪 | `zetsubou` | zetsubou（絶望・虚無） | ✅（罪悪感 suimasenne は④へ） |
| 侮蔑 contempt | 嫌悪+怒 | `jito` | **jito** / **shiozake**（塩対応・呆れ） | ⚠️ **被り** → 統合。kotowaru は「断り」変種 |
| 攻撃 aggressiveness | 怒+期待 | — | — | ⛔ |
| 楽観 optimism | 期待+喜 | — | （excited と重複） | ⛔ or excited に吸収 |

---

## ④ 自己意識感情 4

| 論理名 | 物理名 | 現Cue | 状態 |
|---|---|---|---|
| 照れ embarrassment | `shy` / `tere` / `tere_max` / `fun_tere` | shy（恥ずかしい） / tere（褒められ照れ） / tere_max（真っ赤） / fun_tere（照れ隠し） | ⚠️ shy≈tere 被り。tere_max=強、fun_tere=ツンデレ変種で残す |
| 恥 shame | — | — | ⛔ or 照れ・強に統合 |
| 罪悪感 guilt | `suimasenne` | suimasenne（すいませんねぇ） / troubled（申し訳） | ✅（troubled と要仕分け） |
| 誇り pride | `smug` / `doya` | **smug**（ドヤ顔） / **doya**（〜だが？） | ⚠️ **被り** → 統合。smug_arms_crossed / smug_hands_on_hips は🔀ポーズ変種 |

---

## ⑤ システム表情（マスコット固有・感情外）

| 論理名 | 物理名 | 現Cue | 状態 |
|---|---|---|---|
| 素・相槌 | `normal` | normal | ✅ |
| 無・真顔・悟り | `magao` | magao | ✅ |
| 思考・集中 | `thinking` | **thinking** / **kangae**（調査中） | ⚠️ **被り** → 統合。normal_think(頬杖)は🔀ポーズ |
| 説明・案内 | `setsumei` | setsumei | ✅ |
| 登場・挨拶 | `toujou` | toujou | ✅ |
| 語りかけ・カメラ目線 | `yobikake` | yobikake | ✅ |
| 配信・実況 | `haishin` | haishin | ✅ |
| 眠気・退屈 | `sleepy` | **sleepy** / **nemui**（眠い・退屈） | ⚠️ **被り** → 統合 |
| 混乱・目が回る | `panic` | **dizzy** / **panic** | ⚠️ **被り** → 統合 |
| 焦り・あわあわ | `awawa` | awawa | ✅（yabe と近い） |
| 困り・気まずい | `troubled` | troubled | ✅（suimasenne と近い） |
| 脱力・ほへ | `hoke` | hoke | ✅ |
| 含み笑い・いたずら | `fukumiwarai` | fukumiwarai | ✅（amusement/mischief） |
| 安心・ほっと | `relief` | relief | ✅ |
| 爆笑 | `bakushou` | bakushou | ✅（amusement） |
| 作業成功 | `success` | success | ✅ |
| 雨 | `ame` | ame | ✅（情景） |
| ういビーム | `beam` | beam | ✅（特殊アクション） |
| ビーム拒否 | `kotowaru` | kotowaru | ✅（侮蔑の変種でも） |

### ポーズ変種（感情×ポーズ = 別軸。件数を食うので注意）
`normal_arms_crossed`（退屈腕組み） / `normal_umbrella`（傘） / `happy_banzai`（万歳） /
`smug_arms_crossed` / `smug_hands_on_hips`（ドヤ独り言） / `normal_think`（頬杖考え）
→ 「感情」ではなく「感情＋ポーズ」の組。カタログ上は感情スロットに紐づけつつ、*ポーズ変種*として別扱い。

### 内部（IdlingCueのビルディングブロック・AI非公開）
`idling_yawn_1..3` / `idling_doze_1..3` / `idling_lookaround_1..3` / `idling_giggle_1..2` /
`idling_sigh_1..2` / `idling_ponder` — `internal: true`。カタログ対象外。

---

## 被り（統合候補）サマリ

| ペア/群 | 論理スロット | 方針案 |
|---|---|---|
| surprised / odoroki | 驚き・無印 | 統合（1つに） |
| sleepy / nemui | 眠気・退屈 | 統合 |
| dizzy / panic | 混乱 | 統合 |
| jito / shiozake | 侮蔑（塩対応） | 統合 |
| shy / tere | 照れ・無印 | 統合 or 「恥ずかしい」vs「褒められ照れ」で明確に弁別 |
| smug / doya | 誇り・無印 | 統合 |
| mutto / fuman | 苛立ち | 統合 |
| kangae / thinking | 思考 | 統合（normal_think は頬杖ポーズ変種で残す） |
| troubled / suimasenne | 困り / 罪悪感 | 弁別（困り＝気まずい / すいません＝申し訳）or 統合 |
| love / deredere | 愛 | 強度差で両立（love=無印 / deredere=強） |
| sad_strong / naku | 悲嘆 | 涙の有無で弁別して両立 |
| surprised_strong / shock | 驚愕 / 失望 | shock を「負の驚き＝失望」に寄せて弁別 |

## 欠番（新規要検討）サマリ

- **悲しみ・弱**（しんみり・憂い）
- **嫌悪・無印/強**（純粋な「うわ無理」/ 強い嫌悪） ※塩対応は侮蔑に振ったので嫌悪単体が空く
- **信頼・弱/無印**（表情に出にくい。不要判断もあり）
- ブレンド: **服従 / 攻撃 / 楽観**（マスコット的に不要な可能性大 → 欠番のままでよいか判断）
- **恥 shame**（照れ・強に統合でよいか）

---

# あるべき最終リスト（統合後の目標セット）

方針: **明確な同義だけ統合（→で示す5組）。微妙に違うものは description を鋭くして両立（表現力を残す）。欠番は候補として明記（CEはこの子が遭遇する場面に限定）。**
物理名 = `cues/<name>.json`。`(merge: X→)` = X を統合して消す。`(差別化)` = 隣接と弁別して残す。`⛔候補` = 欠番（作るか要判断）。`[pose]` = ポーズ変種。

## ① 基本感情

**喜び** `smile`(平穏) / `happy`(喜び) / `happy_strong`(恍惚) / `kyakkya`(はしゃぎ・差別化: happy_strong=感情の高さ, kyakkya=子供っぽい多動)
**信頼** `uioji`(敬愛・溺愛) ／ 弱・無印 ⛔候補（表情に出にくい＝不要濃厚）
**恐れ** `yabe`(不安・冷や汗) / `scared`(恐れ) / `scared_strong`(恐怖)
**驚き** `kyoton`(放心) / `surprised`(驚き)（merge: odoroki→） / `surprised_strong`(驚愕)
**悲しみ** `sad`(悲しみ) / `sad_strong`(悲嘆) / `naku`(涙・差別化: sad_strong=表情の強さ, naku=泣く動作) ／ 弱(しんみり) ⛔候補
**嫌悪** ⛔候補: 純粋な嫌悪「うわ無理」（塩対応は侮蔑へ振ったので単体嫌悪が空く）
**怒り** `mutto`(苛立ち)（merge: fuman→） / `angry`(怒り) / `gekioko`(激怒)
**期待** `excited`(期待・ワクワク) / `yaruki`(決意・気合い)

## ③ ブレンド（隣接dyad）

**愛** `love`(恋・ときめき) / `deredere`(とろけ・差別化: love=ときめき, deredere=蕩ける強)
**畏敬** `kantan`(感嘆・おおー)
**失望** `gennari`(げんなり) ／ `shock`(負の驚き＝驚愕×失望・差別化: surprised_strong=純驚き, shock=ショック)
**自責** `zetsubou`(絶望・虚無)
**侮蔑** `jito`(ジト目で見る) / `shiozake`(ふ〜んと受け流す・差別化: jito=睨む, shiozake=受け流す)
**服従 / 攻撃 / 楽観** ⛔ 欠番のまま（マスコット的に不要と判断）

## ④ 自己意識感情

**照れ** `shy`(恥ずかしい) / `tere`(褒められ照れ・差別化: shy=気恥ずかしさ, tere=嬉しさ混じり) / `tere_max`(真っ赤・強) / `fun_tere`(照れ隠し・ツンデレ変種)
**罪悪感** `suimasenne`(申し訳・すいませんねぇ)
**誇り** `smug`(ドヤ顔・独り言) / `doya`(決め台詞「〜だが？」・差別化: smug=顔, doya=セリフ) / `smug_arms_crossed`[pose] / `smug_hands_on_hips`[pose]
**恥 shame** ⛔ 照れ・強（tere_max）に統合でよい

## ⑤ システム表情

`normal`(素・相槌) / `magao`(無・真顔) / `thinking`(思考)（merge: kangae→） / `setsumei`(説明) / `toujou`(登場) / `yobikake`(語りかけ) / `haishin`(配信) / `sleepy`(眠気)（merge: nemui→） / `dizzy`(混乱)（merge: panic→） / `awawa`(焦り) / `troubled`(困り・気まずい・差別化: suimasenne=申し訳) / `hoke`(脱力) / `fukumiwarai`(含み笑い) / `relief`(安心) / `bakushou`(爆笑) / `success`(作業成功) / `ame`(雨・情景) / `beam`(ういビーム) / `kotowaru`(ビーム拒否)
**[pose]** `normal_arms_crossed` / `normal_umbrella` / `happy_banzai` / `normal_think`
**[internal]** `idling_*`（AI非公開・IdlingCue部品）

## 統合サマリ（この目標セットで消えるCue = 5個）

| 消す | 統合先 | 理由 |
|---|---|---|
| `odoroki` | `surprised` | 同義（驚き） |
| `fuman` | `mutto` | 同義（苛立ち・不満） |
| `kangae` | `thinking` | 同義（考え中） |
| `nemui` | `sleepy` | 同義（眠い） |
| `panic` | `dizzy` | 同義（混乱・目が回る） |

→ AI向け 66 → **61**。残りの近接ペア（jito/shiozake, shy/tere, smug/doya, love/deredere, sad_strong/naku, troubled/suimasenne, surprised_strong/shock）は **description を弁別的に書き直して両立**（もっと減らしたければ更に統合可）。

## 欠番候補（作るか要判断・CEはこの子の場面に限定）

- 悲しみ・弱（しんみり・憂い）
- 嫌悪・単体（「うわ無理」＝純粋な嫌悪）
- （信頼弱/無印・ブレンド服従/攻撃/楽観・恥 は不要と判断＝作らない）

---

## 未決事項（次に決める）

1. 被り群を1つずつ「統合／弁別」決定（MEを立てる）。
2. 欠番を「新規作成／不要」判断（CEの範囲＝この子が遭遇する場面に限定）。
3. 強度接尾辞を `_weak`/`_strong` で確定するか（無印=素の名前）。
4. ポーズ変種の扱い（感情スロットにぶら下げるか、別カタログにするか）。
5. `buildCueCatalog` をこの階層でグループ化出力する実装（AIが family→cue で辿れる）。
