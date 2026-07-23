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
export interface CueVoice {
  /** Style name -> weight, e.g. { "Happy": 0.7 }. */
  style_weights?: Record<string, number>;
  alp?: number;
  huskiness?: number;
}

/** One complete look + voice color — the single unit of visual operation.
 *  1 file = 1 Cue, fully self-contained, no inheritance. Mirrors
 *  cue.schema.json exactly; that schema is the source of truth for the wire
 *  format, this interface just gives it a TypeScript shape. */
export interface Cue extends LayerDirectives {
  blink?: boolean;
  voice?: CueVoice;
  /** Short human/AI-facing note on when to use this Cue. The one deliberate
   *  exception to "no catalog metadata": never read by set_cue/composeDirectives,
   *  only surfaced by the `persona` MCP prompt (see mcp-server.ts), which
   *  regenerates a live Cue catalog from whatever's actually in cues/ each
   *  time it's read — so it can never drift the way a hand-maintained
   *  reference doc can. */
  description?: string;
  /** True = excluded from that generated AI-facing catalog. Still fully
   *  callable via set_cue (not an execution guard) — just signals "this is
   *  an internal building block for the IdlingCue system, not meant to be
   *  picked directly". An explicit flag on purpose, not a filename
   *  convention (e.g. an "idling_" prefix), which would be an implicit,
   *  easy-to-break signal. */
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
  window: { width: number; height: number; margin: number };
  port: number;
  lipSync?: LipSyncConfig;
  tts?: TtsConfig;
  idle?: IdleConfig;
  affinity?: AffinityConfig;
  speech?: SpeechTimingConfig;
  ambient?: AmbientConfig;
  interactions?: InteractionsConfig;
}

/** Direct physical interaction with the mascot — the fidget. Reactions PREEMPT
 *  whatever's playing (a poked ういちゃん cuts off mid-line to react), and are
 *  affinity-gated like IdlingCue, so touching her reads the relationship's
 *  temperature. See VISION.md. */
export interface InteractionsConfig {
  /** Reaction pool for hover (pointer over her actual pixels). Same shape as
   *  IdlingCue (steps + weight + affinity gates); a Cue may speak or be silent. */
  hover?: IdlingCue[];
  /** Minimum gap between interaction reactions, ms. Default 2500. Stops rapid
   *  hover in/out from spamming interruptions. */
  cooldownMs?: number;
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
  /** Pool of IdlingCues to pick from. */
  items: IdlingCue[];
}

/** An IdlingCue is a whole little sequence — Cue and (optionally) speech
 *  that move together over several steps, not a single frozen look. A
 *  subtype of Cue in the ubiquitous-language sense: each step wears a real
 *  Cue, it's just strung together as a short performance instead of one
 *  static look. */
export interface IdlingCue {
  /** Optional label, for logs. */
  name?: string;
  /** Ordered steps, played one after another. */
  steps: IdlingCueStep[];
  /** Relative selection weight. Default 1. Higher = picked more often. */
  weight?: number;
  /** Only play this IdlingCue when affinity >= this value. */
  minAffinity?: number;
  /** Only play this IdlingCue when affinity <= this value. */
  maxAffinity?: number;
  /** Local time-of-day gate `[fromHour, toHour]` (0–23, inclusive). Only play
   *  when the current hour is in the window. Wraps past midnight when from > to
   *  (e.g. [22, 4] = 22:00–04:59). Omitted = any time. Lets ういの自発発話
   *  react to the real clock (おはよう / おやすみ / もう寝たら？) with no agent
   *  or memory involved — pure body autonomy. See VISION.md. */
  hours?: [number, number];
}

export interface IdlingCueStep {
  /** Cue to switch to for this step (must exist in the loaded Cue set). Omitted = keep whatever Cue the previous step left. */
  cue?: string;
  /** Optional line to speak on this step. reading is the hiragana for lip-sync. */
  text?: string;
  reading?: string;
  /** How long this step lasts before advancing to the next, in ms (default 2000). */
  holdMs?: number;
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
  /** Cue name -> baked voice color, loaded from each Cue file's `voice` field. */
  cueVoice?: Record<string, CueVoice>;
}

/** Ad-lib voice parameters for a single line, from set_cue's optional
 *  arguments. Layered on top of the Cue's baked voice.style_weights/alp/huskiness. */
export interface VoiceAdlib {
  pitch?: number;
  speed?: number;
  volume?: number;
  intonation?: number;
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
  voice?: VoiceAdlib;
  /** The Cue this line's baked voice color synthesizes with — fixed to the
   *  Cue given in the same set_cue call that produced this line, so a later
   *  set_cue can't retroactively change an in-flight line's voice. */
  cue: string;
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
  connectedAgents: { name: string; connectedAt: string }[];
  availableCues: string[];
  tts?: {
    enabled: boolean;
    hasCredentials?: boolean;
    coolingDown?: boolean;
    lastError?: string | null;
    lastSuccessAt?: string | null;
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
  | { type: 'preview_cue'; cue: string }
  | { type: 'set_affinity'; value: number }
  | { type: 'interact'; kind?: string };

export interface WsRequest {
  id: number;
  type: 'hello' | 'tool' | 'screenshot' | 'debug';
  agent?: string;
  /** TTS credentials forwarded from the agent side (mcp.json env); kept in memory only */
  tts?: { username: string; password: string };
  tool?: 'set_cue' | 'get_state' | 'clear' | 'adjust_affinity';
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
  | { type: 'no-psd'; assetsDir: string };

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
  internal: boolean;
  description?: string;
}

/** VoiSona style names + default weights for the editor's voice sliders. */
export interface EditorStyles {
  style_names: string[];
  default_style_weights: number[];
}

export type EditorWriteResult = { ok: true } | { ok: false; error: string };
