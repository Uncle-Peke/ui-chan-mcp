/** Raw PSD layer directives — the only visual vocabulary. No named wrappers
 *  (pose/face_parts/arms/etc). `find` is deliberately absent: it only ever
 *  existed to serve the now-abolished set_face's runtime slot-overwrite
 *  mechanism. The renderer keeps an internal findSelect() for lip-sync mouth
 *  switching, but that is not part of this wire type. */
export interface LayerDirectives {
  select?: string[];
  show?: string[];
  hide?: string[];
}

/** Voice color baked into a Cue. Passed through to VoiSona Talk's
 *  global_parameters largely as-is. */
/** このCue固有の声色。**感情スタイルの重みだけ**を持つ。
 *
 *  かつては alp（声質の歪め方）と huskiness（かすれ）も持てたが、81個のCueで
 *  **一度も使われないまま**だった。声の色は5つの学習済みスタイルの混ぜ方で作る
 *  のが正面玄関で、あの2つは届かない色を無理やり作る逃げ道でしかない。読み方
 *  （間・強調・語尾）は数値ではなくセリフの記法と Cue の delivery から導出する。
 *  → src/app/prosody.ts */
export interface CueVoice {
  /** Style name -> weight, e.g. { "Happy": 0.7 }. */
  style_weights?: Record<string, number>;
}

/** 見た目（レイヤー指定＋まばたき）と声色のひとまとまり。`default` の上に
 *  重ねて描く差分として持つ。Cue はこれに名前とカタログ用の情報を足したもの。
 *  「Cue 名で引いてくる」のは set_cue だけの事情なので、見た目と声の本体は
 *  名前から切り離しておく。 */
export interface Look extends LayerDirectives {
  blink?: boolean;
  voice?: CueVoice;
}

/** One complete look + voice color — the single unit of visual operation.
 *  1 file = 1 Cue, fully self-contained, no inheritance. Mirrors
 *  cue.schema.json exactly; that schema is the source of truth for the wire
 *  format, this interface just gives it a TypeScript shape. */
export interface Cue extends Look {
  /** Logical name (human-readable, unique) — the file name is the structural,
   *  sortable id (emo_anger_hi); this is its readable alias (e.g. 「激おこ」). */
  label?: string;
  /** Short human/AI-facing note on when to use this Cue. The one deliberate
   *  exception to "no catalog metadata": never read by set_cue/composeDirectives,
   *  only surfaced by the `persona` MCP prompt (see mcp-server.ts), which
   *  regenerates a live Cue catalog from whatever's actually in cues/ each
   *  time it's read — so it can never drift the way a hand-maintained
   *  reference doc can. */
  description?: string;
  /** True = excluded from that generated AI-facing catalog. Still fully
   *  callable via set_cue (not an execution guard) — just signals "not meant
   *  to be picked directly by the agent". An explicit flag on purpose, not a
   *  filename convention, which would be an implicit, easy-to-break signal.
   *  The shipped catalog no longer uses it: the fixed lines that once needed
   *  building-block Cues now carry their own looks (sequences/). */
  internal?: boolean;
}

/** Not a config field — a fixed naming convention. The Cue named "default"
 *  is composed underneath every other Cue as the shared base look: same
 *  file format, same directory, no special-casing. */
export const DEFAULT_CUE_NAME = 'default';

export interface MascotConfig {
  assetsDir: string;
  cuesDir?: string;
  personaFile?: string;
  window: {
    width: number;
    height: number;
    margin: number;
    /** ドラッグを離したとき、いちばん近い画面の隅がこの距離以内なら、その隅の
     *  定位置（`margin` を空けた位置）に吸い付く。px、0 で無効。既定 320。
     *  距離は「彼女の実ピクセルの隅と、その隅の定位置」の間で測る
     *  （→ `snapToCorner()`）。 */
    snapDistance?: number;
    /** 隅に吸い付いたとき、画面の左右の縁に **`margin` に加えて** 空ける逃げしろ
     *  （px、既定 12）。彼女の身体の箱は `default` の見た目で一度だけ測って
     *  固定してある（ポーズごとに測り直すと着地点が Cue 次第で変わるため）ので、
     *  腕を広げる Cue はその箱より外へ出る——指先が画面の縁で欠けるのはこれ。
     *  縦は下端揃えで伸びる余地がないので、横だけ。 */
    snapGap?: number;
    /** 吸い付きにかける時間（ms、既定 220、0 で即座に移動）。即座に飛ぶと
     *  「窓が瞬間移動した」であって「吸い寄せられた」に見えないので、
     *  easeOutCubic で寄せる（動き出しが速く、着地でふっと止まる）。 */
    snapDurationMs?: number;
  };
  port: number;
  lipSync?: LipSyncConfig;
  tts?: TtsConfig;
  idle?: IdleConfig;
  affinity?: AffinityConfig;
  speech?: SpeechTimingConfig;
  ambient?: AmbientConfig;
  interactions?: InteractionsConfig;
  eventCues?: EventCuesConfig;
}

/** Direct physical interaction with the mascot — the fidget. FidgetCues PREEMPT
 *  whatever's playing (a poked ういちゃん cuts off mid-line to react), and are
 *  affinity-gated, so touching her reads the relationship's temperature.
 *  See VISION.md. */
export interface InteractionsConfig {
  /** Minimum gap between reactions, ms. Default 600. Stops mashing from
   *  spamming interruptions. */
  cooldownMs?: number;
  /** Reactions to being poked *repeatedly*. The plain `poke` pool is gated on
   *  affinity, so a cold "触んないで" is unreachable once she likes you — but
   *  being prodded over and over is annoying at any temperature, and that is
   *  the one irritation the user creates on purpose. */
  spam?: SpamInteractionConfig;
}

export interface SpamInteractionConfig {
  /** How many pokes inside `withinMs` count as "being pestered". Default 3. */
  count?: number;
  /** The window those pokes have to fall in, ms. Default 4000. */
  withinMs?: number;
}

/** Timing for the speech bubble/queue when `set_cue`'s `duration_ms` is
 *  omitted. All fields optional — each has the same default it was
 *  hardcoded to before this became configurable. */
export interface SpeechTimingConfig {
  /** Base display time for a text-driven (no synthesized audio) line, ms. Default 1500. */
  baseMs?: number;
  /** Added per character of `text` on top of baseMs. Default 120. */
  msPerChar?: number;
  /** Floor for the text-driven display time, ms. Default 2500. */
  minMs?: number;
  /** Ceiling for the text-driven display time, ms. Default 20000. */
  maxMs?: number;
  /** Extra ms held after synthesized audio actually finishes playing. Default 600. */
  audioPaddingMs?: number;
  /** Floor for the audio-driven display time, ms. Default 1500. */
  audioMinMs?: number;
}

/** Timing for the renderer's Blink loop — per VISION.md's ubiquitous
 *  language, Blink is the one loop that plays independently of Cue/Idling
 *  (during both Idling and Cue playback), so it stays renderer-local and
 *  outside the IdlingCue system. All fields optional — same defaults as
 *  before this became configurable. */
export interface AmbientConfig {
  /** Random gap between blinks, ms: picked uniformly in [min, max]. Default 3500. */
  blinkMinIntervalMs?: number;
  /** Default 7000. */
  blinkMaxIntervalMs?: number;
  /** How long the eyes stay closed for one blink, ms. Default 130. */
  blinkDurationMs?: number;
  /** Cue-transition crossfade: how long the previous look dissolves into the
   *  new one on set_cue, ms. Default 170. Set 0 to disable (hard cut). */
  cueFadeMs?: number;
}

export interface AffinityConfig {
  /** Starting value each time the app boots (session-only; not persisted). */
  default: number;
  min: number;
  max: number;
  /** ういビーム fires only when affinity >= beamThreshold; below it she refuses. */
  beamThreshold: number;
  /** Band boundaries (inclusive lower bound). Highest matching band wins. */
  bands: { atLeast: number; name: string; note?: string }[];
  /** Base magnitude `b` the agent's low/middle/high choice maps to. The agent
   *  only picks direction + magnitude; the *actual* change is computed by the
   *  engine's asymmetric curve (see state.ts adjustAffinity), never chosen by
   *  the agent. Omitted keys fall back to the built-in 3/6/12 defaults. Raise
   *  these to make the whole courtship move faster. */
  steps?: Record<string, number>;
}

export type AffinityDirection = 'up' | 'down';
export const AFFINITY_MAGNITUDES = ['low', 'middle', 'high'] as const;
export type AffinityMagnitude = (typeof AFFINITY_MAGNITUDES)[number];
/** Built-in base magnitudes if config.affinity.steps is absent. */
export const DEFAULT_AFFINITY_STEPS: Record<AffinityMagnitude, number> = {
  low: 3,
  middle: 6,
  high: 12,
};

export interface IdleConfig {
  /** Seconds of inactivity (no speech, no tool calls) before reverting to the default Cue. 0 or omitted = disabled */
  revertAfterSec?: number;
  /** Occasional IdlingCues — short Cue+line sequences played during Idling.
   *  Covers both silent ambient motion (yawn, look-around, ...) and speaking bits
   *  (the umbrella gag, chatter, ...). Each item has a weight (rarity) and an
   *  optional minAffinity threshold so some lines only appear when affinity is high. */
  idlingCues?: IdlingCuesConfig;
}

export interface IdlingCuesConfig {
  enabled: boolean;
  /** Random idle gap before playing one, in seconds: picked uniformly in [minSec, maxSec]. Resets on any activity. */
  minSec: number;
  maxSec: number;
  /** Optional: also require the *user* to be idle (see SystemIdleConfig). */
  systemIdle?: SystemIdleConfig;
}

/** Gate IdlingCues on how long the user has left the keyboard and mouse alone
 *  (Electron's `powerMonitor.getSystemIdleTime()`), not just on how long since
 *  ういちゃん last did something.
 *
 *  Without this the Idling countdown only ever measures ういちゃん's own
 *  activity, so she talks over someone who is mid-keystroke and keeps talking
 *  to an empty chair. The gate turns OS idle time into a *window*: too little
 *  and the user is working (stay out of the way), too much and they're gone
 *  (there is no one to talk to). Both edges matter — a lower bound alone still
 *  leaves her performing to an empty desk. */
export interface SystemIdleConfig {
  enabled: boolean;
  /** Below this much OS idle the user is considered actively working: stay quiet. */
  minSec: number;
  /** The first IdlingCue after the user goes quiet fires somewhere in
   *  [minSec, firstMaxSec] of OS idle, so she doesn't come in on the exact
   *  same beat every time. Defaults to minSec (no jitter). */
  firstMaxSec?: number;
  /** At this much OS idle the user counts as away: play sequences/presence/away.json once, then
   *  stay silent until input comes back. 0 / omitted disables the away state
   *  (and with it the "keeps talking to an empty chair" half of the fix). */
  awaySec?: number;
}

/** A CueSequence is a whole little performance — Cue and (optionally) speech
 *  moving together over several steps, not a single frozen look — plus the
 *  gates that decide when it may play. It's the shared shape underneath the two
 *  ways ういちゃん performs a sequence rather than a static Cue: as an IdlingCue
 *  (self-initiated during Idling) or as a FidgetCue (fired by a poke).
 *  Same data, same playback; only the trigger and priority differ. */
export interface CueSequence {
  /** ファイル名（拡張子なし）。ローダが埋める——ファイルの中には書かない。 */
  name?: string;
  /** Ordered steps, played one after another. */
  steps: SequenceStep[];
  /** Relative selection weight. Default 1. Higher = picked more often. */
  weight?: number;
  /** Only play when affinity >= this value. */
  minAffinity?: number;
  /** Only play when affinity <= this value. */
  maxAffinity?: number;
  /** Local time-of-day gate `[fromHour, toHour]` (0–23, inclusive). Only play
   *  when the current hour is in the window. Wraps past midnight when from > to
   *  (e.g. [22, 4] = 22:00–04:59). Omitted = any time. Lets ういの自発発話
   *  react to the real clock (おはよう / おやすみ / もう寝たら？) with no agent
   *  or memory involved — pure body autonomy. See VISION.md. */
  hours?: [number, number];
}

/** A CueSequence played self-initiated during Idling (yawn, chatter, greetings). */
export type IdlingCue = CueSequence;
/** A CueSequence fired by a direct physical interaction (a poke) — the fidget. */
export type FidgetCue = CueSequence;
/** A CueSequence fired by something that happened in the session around her —
 *  a command failed, a subagent came back, the agent is waiting on the user.
 *  The trigger lives outside the app (a Claude Code hook posts `event_cue`),
 *  but the *reaction* — which lines exist, how often she'll say one, whether
 *  affinity or the clock gates it — lives in the app (sequences/event/<name>/ plus
 *  the settings below), exactly like an IdlingCue.
 *  See VISION.md. */
export type EventCue = CueSequence;

/** EventCue settings, one per event the outside world can report. */
export interface EventCuesConfig {
  /** Master switch. Default true. */
  enabled?: boolean;
  /** Event name (`tool_failure`, `agent_back`, …) → how often it may speak. */
  events: Record<string, EventCueGroup>;
}

/** EventCue のイベントごとの設定。セリフそのものは
 *  sequences/event/<イベント名>/ に置く（→ src/app/sequences.ts）。 */
export interface EventCueGroup {
  /** Minimum seconds between two lines from this throttle group. Default 90. */
  cooldownSec?: number;
  /** Probability (0–1) that a fire actually speaks. Default 1. Use it for
   *  events that happen every turn, so reacting stays a beat and not a tic. */
  chance?: number;
  /** Share one cooldown with other events by giving them the same key.
   *  Defaults to the event's own name — which is what keeps a send-off from
   *  silencing the matching return. */
  throttleKey?: string;
}

/** シーケンスの1ステップ。見た目と声色は**自分で持つ**——エージェント向けの
 *  Cue を名前で参照する口は無い（→ src/app/sequences.ts）。 */
export interface SequenceStep {
  /** このステップの見た目と声色（default からの差分）。**省略すると直前の
   *  ステップの見た目と声のまま**続く。`{}` は default そのもの。 */
  look?: Look;
  /** Optional line to speak on this step. reading is the hiragana for lip-sync. */
  text?: string;
  reading?: string;
  /** How long this step lasts before advancing to the next, in ms (default 2000). Ignored for a step with `text` (waits for the line to finish). */
  holdMs?: number;
  /** この一行だけの演技指定（→ Delivery）。 */
  delivery?: Delivery;
}

/**
 * 固定セリフ1行ぶんの演技指定。**すべて任意**で、書かなかったものは感情からの
 * 導出値（`src/app/prosody.ts`）がそのまま残る。書いたものは**上書き**する
 * ——加算ではないので、書いた値がそのまま出る。
 *
 * これは `set_cue` には無い。AI に数値を渡すと1回の呼び出しで「何を言うか」とは
 * 別に「数値をいくつにするか」を考えることになり、思考時間が跳ね上がる——という
 * のが数値パラメータを廃止した理由だった。**ここにはその理由が当てはまらない**：
 * IdlingCue / EventCue / FidgetCue のセリフは人間が事前に書いた固定の行で、AI は
 * 一切関与しない。しかも同じ行が何度も再生されるので、チューニングの費用対効果が
 * いちばん高く、TSML の解析結果もキャッシュが効く。
 *
 * 強調（`**語**`）・間（`、` `…`）・伸ばし（`〜`）・詰め（`っ`）は `text` の書き方
 * でそのまま指定できるので、ここには無い。→ docs/design/PROSODY.md
 */
export interface Delivery {
  /** ピッチ変動の倍率（0〜2）。導出値を上書き。 */
  intonation?: number;
  /** 話速（0.2〜5）。導出値を上書き。 */
  speed?: number;
  /** 高さ（cent、-600〜600）。導出値を上書き。 */
  pitch?: number;
  /** 音量（dB、-8〜8）。 */
  volume?: number;
  /** `〜` で伸ばす母音の長さ（秒）。導出値を上書き。 */
  stretchSec?: number;
  /** 語末の `っ` で詰める母音の長さ（秒）。既定 0.15 を上書き。 */
  clipSec?: number;
  /** 語尾の扱い。`flat` は `？` があっても上げない（呆れ・詰問・断定）、
   *  `rise` は `？` が無くても上げる（甘え・確認）。 */
  ending?: 'flat' | 'rise';
  /** この行だけの読み・アクセント上書き。`tts.lexicon` と同じ形で、
   *  同じ語が両方にあるときはこちらが勝つ。 */
  words?: LexiconEntry[];
}

export interface TtsConfig {
  enabled: boolean;
  provider: 'voisona-talk';
  url: string;
  /** macOS app name used to auto-launch the engine when unreachable */
  app_name?: string;
  username?: string;
  password?: string;
  voice_name?: string;
  voice_version?: string;
  language?: string;
  /** ピッチ変動の倍率（0〜2、既定1）。**この子の声の性質**として1箇所だけで持つ。
   *  Cue にも行にも数値を置かないのは意図的だが、これは「どの場面でどう変える
   *  数値か」ではなく「この声はこういう声だ」という定数なので、声の設定として置く。
   *
   *  1 より上げているのは、上手い読みと下手な読みを比較した研究（郡史郎「ナレー
   *  ションのじょうずさに関する一考察」）で、差が出るのは**際立たせ方の大きさ**
   *  だと分かっているため。規則どおりに読むだけでは足りず、はっきりやるほうが
   *  上手く聞こえる。 */
  intonation?: number;
  /** 読み・アクセントを常に上書きする語（固有名詞など）。「うい」は品詞解析で
   *  連体詞に落ちて頭高になるので、名前が毎回わずかに変な抑揚で呼ばれる。行ごとの
   *  演出ではなく固定の誤りなので、AI ではなくアプリが直す。→ app/prosody.ts */
  lexicon?: LexiconEntry[];
}

export interface LexiconEntry {
  word: string;
  pronunciation?: string;
  /** 通常（単独・助詞や接尾辞が続く場合）のモーラ単位の高低。 */
  hl?: string;
  /** **文頭でないとき**（前に語があるとき）の高低。同じ語でも位置で別物になる
   *  ことがある：「ねえ」は単体・文頭なら呼びかけ（高→低）だが、文中・文末の
   *  「〜だよねぇ？」は同意を求める平ら（低）になる。 */
  hlMidSentence?: string;
  /** **直後に `？` が続くとき**の高低。感動詞は表記が同じでも読みが複数あり、
   *  エンジンは既定の型しか選べない。「はあ」の既定は `hl`（高→低）＝溜め息で、
   *  威嚇の「はぁ？」（低→高）にはならない。`is_question` は付いていても、語自身が
   *  下降型だと打ち消される。同じ問題は「へえ」「ふーん」「え」にもある。 */
  hlBeforeQuestion?: string;
  /** **複合語の前部要素になったとき**の高低。日本語では複合語で前部要素の
   *  アクセントが消え、核が後部要素へ移る（「うい」＋「ビーム」＝ うい が平らに
   *  なり山は「ビーム」側）。接尾辞（「ういちゃん」の「ちゃん」）は複合語では
   *  ないので、ここには当てはめない。 */
  hlInCompound?: string;
}

export interface TtsAudio {
  wavBase64: string;
  durationMs: number;
  /** phoneme-timed lip sync frames: t = ms from audio start, v = vowel (a/i/u/e/o/n) */
  timeline: { t: number; v: string }[];
}

export interface SpeechItem {
  text: string;
  durationMs: number;
  agent: string;
  reading?: string;
  /** 固定セリフだけが持つ、この行の演技指定。 */
  delivery?: Delivery;
  /** The Cue this line was spoken under — a label for get_state. */
  cue: string;
  /** この行を合成する声色。**積んだ時点で**解決して持たせる——後から別の
   *  set_cue が来ても、読み上げ待ちの行の声が塗り替わらないように。 */
  voice?: CueVoice;
  /** Internal bookkeeping only — not part of the wire format (JSON.stringify
   *  drops function values, so it never reaches get_state's output). Lets an
   *  IdlingCue step advance exactly when THIS line actually finishes playing
   *  (real TTS audio duration if synthesized, otherwise the text-length
   *  estimate) instead of guessing a separate holdMs that can drift out of
   *  sync with the real speech. */
  onComplete?: () => void;
}

export interface LipSyncConfig {
  mouths: Record<string, string>;
  charsPerSec?: number;
  /** How often (ms) the audio-driven lip sync path re-checks the playing
   *  audio's current time against the phoneme timeline. Default 33. */
  audioPollMs?: number;
}

/** No `priority` field — set_cue always wins unconditionally, overwriting
 *  whatever Cue was active before. */
export interface CueState {
  cue: string;
  agent: string | null;
}

export interface MascotStateSnapshot {
  psdLoaded: boolean;
  psdFile: string | null;
  cue: CueState;
  currentSpeech: SpeechItem | null;
  speechQueue: SpeechItem[];
  connectedAgents: ConnectedAgent[];
  availableCues: string[];
  tts?: {
    enabled: boolean;
    hasCredentials?: boolean;
    coolingDown?: boolean;
    lastError?: string | null;
    lastSuccessAt?: string | null;
    /** The engine's REST port didn't answer at all (as opposed to a synthesis
     *  error) — usually just VoiSona Talk not being up yet. */
    engineUnreachable?: boolean;
  };
  warnings: string[];
  affinity: AffinitySnapshot;
}

export interface AffinitySnapshot {
  value: number;
  /** Band name for the current value (e.g. "cold" / "normal" / "dere"). */
  band: string;
  /** Whether affinity is high enough to fire ういビーム. */
  beamReady: boolean;
}

// set_cue's argument type lives in ./set-cue-schema (zod-derived, single
// source shared with the MCP tool's inputSchema) rather than here.

// WebSocket bridge protocol (MCP stdio bridge <-> Electron app)
/** Debug-only commands over the raw WebSocket. These are intentionally not
 *  exposed as MCP tools — they exist for manual Cue/IdlingCue verification. */
export type DebugAction =
  | { type: 'trigger_idle'; name?: string }
  | { type: 'trigger_chatter' }
  | { type: 'list_idle' }
  | { type: 'list_event_cues' }
  | { type: 'trigger_event'; event: string }
  | { type: 'preview_cue'; cue: string }
  /** 任意のステップ列をその場で再生する。固定セリフのチューニングでは「プールから
   *  ランダムに1つ」ではなく**この行を今すぐ**鳴らす必要があるので、名前でも
   *  イベント名でもなく、ステップ列そのものを受け取る。 */
  | { type: 'preview_sequence'; steps: SequenceStep[]; name?: string }
  | { type: 'set_affinity'; value: number }
  | { type: 'interact'; kind?: string }
  /** 更新の有無を強制する（撮影と手元確認用。実際の判定は6時間ごとの
   *  update-check.mjs が行う）。 */
  | { type: 'fake_update'; available: boolean; behind?: number }
  /** パネルのボタンを押す。IPC は外から叩けないので、手元確認用の入口。 */
  | { type: 'panel'; kind: string; value?: number };

/** Who is on the other end of one WebSocket connection.
 *
 *  MCP has no session id, and a stdio server is one process per client session,
 *  so *the connection itself* is the session. What identifies it usefully to a
 *  human is the client's own name plus the directory it was started in — that
 *  is what tells two Claude Code windows apart. Everything here is best-effort:
 *  a client that says nothing still connects, it just shows as its name. */
export interface ConnectedAgent {
  /** Unique per connection — the only thing that can tell two sessions of the
   *  same client in the same directory apart, so it (not `name`) is what the
   *  panel matches "who is she speaking for" against. */
  id: number;
  name: string;
  connectedAt: string;
  /** MCP clientInfo name/version, when the client sent one. */
  client?: string;
  clientVersion?: string;
  /** The directory the client launched the MCP server in, and its basename. */
  cwd?: string;
  project?: string;
  /** The bridge process, so two sessions of the same client in the same
   *  project are still distinguishable. */
  pid?: number;
}

export interface WsRequest {
  id: number;
  type: 'hello' | 'tool' | 'screenshot' | 'debug';
  agent?: string;
  /** Identity sent with `hello` (see ConnectedAgent). */
  identity?: Omit<ConnectedAgent, 'name' | 'connectedAt'>;
  /** TTS credentials forwarded from the agent side (mcp.json env); kept in memory only */
  tts?: { username: string; password: string };
  tool?: 'set_cue' | 'get_state' | 'clear' | 'adjust_affinity' | 'event_cue';
  args?: Record<string, unknown>;
  debug?: DebugAction;
}

export interface WsResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

// IPC main -> renderer
export type RenderCommand =
  | { type: 'apply'; directives: LayerDirectives; blink: boolean }
  | {
      type: 'speech';
      text: string | null;
      reading?: string | null;
      audio?: TtsAudio | null;
    }
  | { type: 'no-psd'; assetsDir: string }
  /** Who is connected right now, and who ういちゃん spoke for last. Drives the
   *  collapsible connections panel in the renderer — deliberately a render
   *  command like any other, so the panel can never disagree with the app. */
  | { type: 'connections'; agents: ConnectedAgent[]; active: number | null }
  /** Whether a newer ui-chan is waiting upstream. The panel shows its update
   *  entry only when this is true — nothing to announce, nothing on screen. */
  | { type: 'update'; available: boolean; behind?: number; blocked?: string | null }
  /** 現在の好感度。歯車の中のスライダーは、開いた瞬間に一度読むだけだった
   *  ので、パネルを開いたままエージェントが adjust_affinity を呼ぶと表示だけ
   *  古い値で取り残される。好感度が動くのを見たくて開けている場所が嘘をつく
   *  わけにいかないので、connections と同じく変わるたびに撒く。 */
  | { type: 'affinity'; value: number; band: string; beamReady: boolean }
  /** Paint a backdrop behind her, for screenshots. The window is transparent by
   *  design, which makes a capture unusable anywhere that isn't white — so the
   *  backdrop is applied just long enough to take the picture. */
  | { type: 'backdrop'; style: string | null }
  /** 彼女がいま画面のどちら側に居るか。見た目の3つを一度に決める：
   *  接続パネルを同じ側へ寄せ、吹き出しを画面の内側へ伸ばし、左に居るときは
   *  立ち絵を左右反転して画面の内側を向かせる。窓は隅に吸い付くと透明帯ぶん
   *  画面外へはみ出すので、窓の縁を基準にした要素は放っておくと画面の外に
   *  出てしまう——この一報がその全部の基準になる。 */
  | { type: 'side'; side: 'left' | 'right' };

// ---- Explicit per-tool result types (replaces the loose ToolResultInfo
// index signature; each tool's actual return shape is now checked by tsc). ----
export type ToolResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string };

export type SetCueResult = ToolResult<{
  cue: string;
  note?: string;
  displayed?: boolean;
  queue_length?: number;
}>;

export type AffinityResult = ToolResult<{
  affinity: number;
  band: string;
  delta?: number;
  beamReady: boolean;
}>;

export type ClearResult = { ok: true } | { ok: false; error: string };

// ---- Cue editor (npm run editor) IPC payloads ----
// The editor is a separate Electron window; these cross the editor-preload
// contextBridge. Kept here so the preload, editor-main, and editor renderer
// share one contract.

/** One row in the editor's cue list (the `default` base is excluded). */
export interface EditorCueListItem {
  name: string;
  label?: string;
  internal: boolean;
  description?: string;
}

/** VoiSona style names + default weights for the editor's voice sliders. */
export interface EditorStyles {
  style_names: string[];
  default_style_weights: number[];
}

export type EditorWriteResult = { ok: true } | { ok: false; error: string };
