import type { SetCueArgs } from '../shared/set-cue-schema';
import type {
  AffinityResult,
  ClearResult,
  Cue,
  CueState,
  IdlingCue,
  IdlingCueStep,
  LayerDirectives,
  MascotConfig,
  RenderCommand,
  SetCueResult,
  SpeechItem,
  SpeechTimingConfig,
  TtsAudio,
  VoiceAdlib,
} from '../shared/types';
import { DEFAULT_AFFINITY_STEPS, DEFAULT_CUE_NAME } from '../shared/types';

const MAX_QUEUE = 20;

type EnqueueResult =
  | { ok: true; displayed: boolean; queue_length: number }
  | { ok: false; error: string };

function pickAdlib(args: SetCueArgs): VoiceAdlib | undefined {
  const { pitch, speed, volume, intonation } = args;
  if (
    pitch === undefined &&
    speed === undefined &&
    volume === undefined &&
    intonation === undefined
  ) {
    return undefined;
  }
  return { pitch, speed, volume, intonation };
}

/** LEN(text): the one place a display duration gets guessed from text length
 *  alone. Used only when the caller didn't pin an explicit duration —
 *  `startSpeech()` still refines this further once real TTS audio length is
 *  known, so this is a first estimate, not the final word. */
function estimateSpeechDurationMs(text: string, speech?: SpeechTimingConfig): number {
  const estimated = (speech?.baseMs ?? 1500) + text.length * (speech?.msPerChar ?? 120);
  return Math.min(Math.max(estimated, speech?.minMs ?? 2500), speech?.maxMs ?? 20000);
}

/** Every idle timer in this class follows the same "hold an id, clear-then-null
 *  it" shape (mirrors renderer.ts's clearTimeoutSafe for the browser side). */
function clearTimeoutSafe(id: NodeJS.Timeout | null): null {
  if (id !== null) clearTimeout(id);
  return null;
}

/** Random idle gap in ms, picked uniformly in [minSec, maxSec] (minSec floored to 1s). */
function randomDelayMs(minSec?: number, maxSec?: number): number {
  const min = Math.max(minSec ?? 0, 1);
  const max = Math.max(maxSec ?? min, min);
  return (min + Math.random() * (max - min)) * 1000;
}

/** Is `hour` inside the inclusive [from, to] window? A window with from > to
 *  wraps past midnight (e.g. [22, 4] covers 22,23,0,1,2,3,4). Undefined = always. */
function hourInWindow(hour: number, window?: [number, number]): boolean {
  if (!window) return true;
  const [from, to] = window;
  return from <= to ? hour >= from && hour <= to : hour >= from || hour <= to;
}

/** Pick one item by weight. If all weights are 0/undefined, falls back to uniform. */
function weightedPick<T extends { weight?: number }>(items: T[]): T | undefined {
  const weights = items.map((item) => Math.max(item.weight ?? 1, 0));
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  let roll = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Keep only the last select per radio group (everything but the final path
 *  segment), matching the renderer's last-wins-per-folder behavior. */
function dedupeSelectsByGroup(selects: string[]): string[] {
  const lastIndexByGroup = new Map<string, number>();
  selects.forEach((path, i) => {
    const group = path.slice(0, path.lastIndexOf('/'));
    lastIndexByGroup.set(group, i);
  });
  return selects.filter((_, i) => [...lastIndexByGroup.values()].includes(i));
}

export class UiChanState {
  private cues: Record<string, Cue>;
  private cueState: CueState;
  private speechQueue: SpeechItem[] = [];
  private currentSpeech: SpeechItem | null = null;
  private speechTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private idlingCueTimer: NodeJS.Timeout | null = null;
  private idlingCueHoldTimer: NodeJS.Timeout | null = null;
  private idlingCueActive = false;
  private affinity: number;
  private lastCueWarning: string | null = null;

  constructor(
    private config: MascotConfig,
    cues: Record<string, Cue>,
    private emit: (cmd: RenderCommand) => void,
    private synthesize?: (
      text: string,
      cue: string,
      adlib?: VoiceAdlib,
    ) => Promise<TtsAudio | null>,
  ) {
    this.cues = cues;
    this.cueState = { cue: DEFAULT_CUE_NAME, agent: null };
    this.affinity = this.clampAffinity(config.affinity?.default ?? 30);
    this.scheduleIdlingCue();
  }

  /** Swap in a freshly (re)loaded Cue set (e.g. after a hot-reload) and
   *  re-render immediately so edits to the currently-worn Cue show up live.
   *  If the Cue currently being worn no longer exists in the new set, fall
   *  back to default rather than silently drawing default while claiming
   *  to still wear the deleted name (cues.ts always guarantees "default"
   *  itself survives, even as an empty Cue). */
  setCues(cues: Record<string, Cue>): void {
    this.cues = cues;
    if (!this.cues[this.cueState.cue]) {
      this.lastCueWarning = `cue "${this.cueState.cue}" disappeared on reload — fell back to "${DEFAULT_CUE_NAME}".`;
      this.setCueState(DEFAULT_CUE_NAME, this.cueState.agent);
    }
    this.applyVisual();
  }

  listCues(): string[] {
    return Object.keys(this.cues);
  }

  private isSpeaking(): boolean {
    return this.currentSpeech !== null || this.speechQueue.length > 0;
  }

  private isBusy(): boolean {
    return this.isSpeaking() || this.idlingCueActive;
  }

  private clampAffinity(v: number): number {
    const min = this.config.affinity?.min ?? 0;
    const max = this.config.affinity?.max ?? 100;
    if (Number.isNaN(v)) return min;
    return Math.min(Math.max(Math.round(v), min), max);
  }

  private affinityBand(): string {
    const bands = this.config.affinity?.bands ?? [];
    let best = 'normal';
    let bestAt = Number.NEGATIVE_INFINITY;
    for (const b of bands) {
      if (this.affinity >= b.atLeast && b.atLeast >= bestAt) {
        best = b.name;
        bestAt = b.atLeast;
      }
    }
    return best;
  }

  affinitySnapshot(): { value: number; band: string; beamReady: boolean } {
    const threshold = this.config.affinity?.beamThreshold ?? 65;
    return {
      value: this.affinity,
      band: this.affinityBand(),
      beamReady: this.affinity >= threshold,
    };
  }

  /**
   * Affinity change engine.
   *
   * GOAL (the feel we're modelling): うい is a tsundere on a slow burn. Getting
   * her to like you should be *earned* — the reward is the climb — while cooling
   * off should be quick and cheap. Concretely:
   *   1. Down is easier than up.                       (quick to lose)
   *   2. Up must not spike; rising is gradual.         (the reward is the grind)
   *   3. Climbing *high* is especially hard.           (dere/ういビーム = a real prize)
   *   4. Falling back to 0 (her guarded neutral) is easy — she resets to cool.
   *   5. No single call can move her far.              (agent can't cheat to the top)
   *
   * DESIGN CHOICE: the agent must NOT hand us a raw number (it would just slam
   * +100). It states only a DIRECTION (up/down) and a coarse MAGNITUDE
   * (low/middle/high → base `b`, from config.affinity.steps). We compute the
   * actual step from an asymmetric curve of the current value `a` (max `M`):
   *
   *     up:   Δ = +b · (1 − a/M)      lower `a` ⇒ larger gain; as a→M the gain
   *                                   → 0, so the top is asymptotic and hard to
   *                                   reach. Max possible gain is `b` (at a=0),
   *                                   which caps a single call → satisfies (2)(3)(5).
   *
   *     down: Δ = −b · (1 + a/M)      higher `a` ⇒ bigger drop (a fall from grace
   *                                   hurts more the warmer she was); as a→0 the
   *                                   drop → −b and clamps at the floor, so she
   *                                   slides back to 0 readily → satisfies (1)(4).
   *
   * The two curves mirror each other around `b`: at any a>0, |down| > |up|, so
   * down always outpaces up (1). `b` (config) is the single knob for overall
   * pace — raise it to make the whole courtship faster. clampAffinity() rounds
   * and bounds to [min,max]; near the top an `up` may round to 0 (intended — she
   * won't budge further without more, bigger moments).
   *
   * NOTE: keep the math here, not in the AI-facing tool description / AFFINITY.md
   * — the agent only needs "pick direction + magnitude", not the formula.
   */
  adjustAffinity(direction: string, magnitude: string): AffinityResult {
    if (direction !== 'up' && direction !== 'down') {
      return { ok: false, error: 'direction must be "up" or "down"' };
    }
    const steps: Record<string, number> = {
      ...DEFAULT_AFFINITY_STEPS,
      ...(this.config.affinity?.steps ?? {}),
    };
    const base = steps[magnitude];
    if (typeof base !== 'number') {
      return { ok: false, error: `magnitude must be one of ${Object.keys(steps).join('/')}` };
    }
    const max = this.config.affinity?.max ?? 100;
    const frac = max > 0 ? this.affinity / max : 0;
    const delta = direction === 'up' ? base * (1 - frac) : -base * (1 + frac);
    const before = this.affinity;
    this.affinity = this.clampAffinity(this.affinity + delta);
    return {
      ok: true,
      affinity: this.affinity,
      band: this.affinityBand(),
      delta: this.affinity - before,
      beamReady: this.affinitySnapshot().beamReady,
    };
  }

  /** Debug: set affinity to an absolute value (clamped to config bounds). */
  setAffinity(value: number): AffinityResult {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return { ok: false, error: 'value must be a number' };
    }
    const before = this.affinity;
    this.affinity = this.clampAffinity(value);
    return {
      ok: true,
      affinity: this.affinity,
      band: this.affinityBand(),
      delta: this.affinity - before,
      beamReady: this.affinitySnapshot().beamReady,
    };
  }

  /** The single visual+speech entry point. Cue and line are confirmed
   *  together in one call, so there is no window where the face and the
   *  voice disagree about which Cue is "current". */
  setCue(args: SetCueArgs, agent: string): SetCueResult {
    this.cancelIdlingCue();

    let cueName = args.cue;
    let note: string | undefined;
    if (!this.cues[cueName]) {
      note = `unknown cue "${cueName}" — fell back to "${DEFAULT_CUE_NAME}". Use get_state to list available cues.`;
      cueName = DEFAULT_CUE_NAME;
    }
    this.lastCueWarning = note ?? null;
    this.applyCueLook(cueName, agent);

    if (args.text) {
      const speechResult = this.enqueueSpeech(args.text, cueName, agent, {
        durationMs: args.duration_ms,
        reading: args.reading,
        voice: pickAdlib(args),
      });
      this.scheduleIdleRevert();
      if (!speechResult.ok) {
        // The Cue switch above already happened (and stays), even though the
        // line itself couldn't be queued — say so, or a retry reads as a
        // silent no-op and an agent may re-apply the same Cue pointlessly.
        return { ok: false, error: `${speechResult.error} (cue "${cueName}" was applied)` };
      }
      return note ? { ...speechResult, cue: cueName, note } : { ...speechResult, cue: cueName };
    }

    this.holdVisual(args.duration_ms);
    return note ? { ok: true, cue: cueName, note } : { ok: true, cue: cueName };
  }

  private setCueState(cue: string, agent: string | null): void {
    this.cueState = { cue, agent };
  }

  /** Switch to a Cue and render it — the visual half of "apply a Cue",
   *  shared by set_cue and every IdlingCue/chatter step. */
  private applyCueLook(cueName: string, agent: string | null): void {
    this.setCueState(cueName, agent);
    this.applyVisual();
  }

  /** Queue a line without touching the idle timers (used by IdlingCues).
   *  Duration resolution happens in exactly one place: an explicit `durationMs`
   *  wins, otherwise `estimateSpeechDurationMs` (LEN(text)) — later refined
   *  again in `startSpeech()` once real TTS audio length is known. Every
   *  caller that needs to know when this line is actually done (not just
   *  "queued") passes `onComplete`, invoked once, whether the line played or
   *  the queue was full. */
  private enqueueSpeech(
    text: string,
    cue: string,
    agent: string,
    opts?: {
      durationMs?: number;
      reading?: string;
      voice?: VoiceAdlib;
      onComplete?: () => void;
    },
  ): EnqueueResult {
    const { durationMs, reading, voice, onComplete } = opts ?? {};
    if (this.speechQueue.length >= MAX_QUEUE) {
      onComplete?.(); // don't strand a caller waiting on a line that never got queued
      return { ok: false, error: `speech queue is full (${MAX_QUEUE})` };
    }
    const duration = durationMs ?? estimateSpeechDurationMs(text, this.config.speech);
    this.speechQueue.push({ text, durationMs: duration, agent, reading, voice, cue, onComplete });
    const immediate = this.currentSpeech === null;
    this.pumpSpeech();
    return {
      ok: true,
      displayed: immediate,
      queue_length: this.speechQueue.length + (this.currentSpeech && !immediate ? 1 : 0),
    };
  }

  private pumpSpeech(): void {
    if (this.currentSpeech !== null) return;
    const next = this.speechQueue.shift();
    if (!next) return;
    this.currentSpeech = next;
    void this.startSpeech(next);
  }

  private async startSpeech(item: SpeechItem): Promise<void> {
    let audio: TtsAudio | null = null;
    if (this.synthesize) {
      audio = await this.synthesize(item.text, item.cue, item.voice).catch(() => null);
    }
    if (this.currentSpeech !== item) return; // cleared while synthesizing
    const speech = this.config.speech;
    const durationMs = audio
      ? Math.max(audio.durationMs + (speech?.audioPaddingMs ?? 600), speech?.audioMinMs ?? 1500)
      : item.durationMs;
    this.emit({
      type: 'speech',
      text: item.text,
      reading: item.reading ?? null,
      audio,
    });
    this.speechTimer = setTimeout(() => {
      this.currentSpeech = null;
      this.speechTimer = null;
      this.emit({ type: 'speech', text: null });
      // restore the Cue's mouth after lip sync
      this.applyVisual();
      item.onComplete?.();
      this.pumpSpeech();
      this.scheduleIdleRevert();
    }, durationMs);
  }

  clear(): ClearResult {
    this.speechTimer = clearTimeoutSafe(this.speechTimer);
    this.idleTimer = clearTimeoutSafe(this.idleTimer);
    this.cancelIdlingCue();
    this.speechQueue = [];
    this.currentSpeech = null;
    this.applyCueLook(DEFAULT_CUE_NAME, null);
    this.emit({ type: 'speech', text: null });
    // clear() is itself activity: without this, the IdlingCue timer left
    // over from before the clear could still fire on its old schedule.
    this.scheduleIdlingCue();
    return { ok: true };
  }

  /** Assert a freshly-set Cue and let it STICK: cancel any pending revert so
   *  it can't be yanked back, and postpone chatter/IdlingCues. Unlike
   *  scheduleIdleRevert it does NOT arm a new revert by default — a silent
   *  set_cue holds until the next spoken line ends (or idle takes over) —
   *  unless overrideHoldMs is given (set_cue's duration_ms with no text),
   *  in which case it eases back to default after that many ms. */
  private holdVisual(overrideHoldMs?: number): void {
    this.scheduleIdlingCue();
    this.idleTimer = clearTimeoutSafe(this.idleTimer);
    if (overrideHoldMs && overrideHoldMs > 0) {
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        if (this.isSpeaking()) return;
        this.revertToDefault();
      }, overrideHoldMs);
    }
  }

  /** (Re)start the idle countdown. Fires only when nothing is being said; any activity postpones it. */
  private scheduleIdleRevert(): void {
    this.scheduleIdlingCue();
    this.idleTimer = clearTimeoutSafe(this.idleTimer);
    // A held IdlingCue governs its own lifetime — don't yank it back early.
    if (this.idlingCueActive) return;
    const sec = this.config.idle?.revertAfterSec ?? 0;
    if (sec <= 0) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      // still talking (or queued) — the speech-end handler reschedules
      if (this.isSpeaking()) return;
      this.revertToDefault();
    }, sec * 1000);
  }

  /** Cancel any held IdlingCue (called when real activity happens). */
  private cancelIdlingCue(): void {
    this.idlingCueHoldTimer = clearTimeoutSafe(this.idlingCueHoldTimer);
    this.idlingCueActive = false;
  }

  /** (Re)start the IdlingCue countdown. Occasionally plays a short Cue
   *  sequence (silent ambient motion or a speaking bit — same mechanism
   *  either way) so the desk has some life beyond chatter. */
  private eligibleIdlingCues(): IdlingCue[] {
    const items = this.config.idle?.idlingCues?.items ?? [];
    const hour = new Date().getHours();
    return items.filter(
      (item) =>
        (item.minAffinity === undefined ? true : this.affinity >= item.minAffinity) &&
        (item.maxAffinity === undefined ? true : this.affinity <= item.maxAffinity) &&
        hourInWindow(hour, item.hours),
    );
  }

  private scheduleIdlingCue(): void {
    this.idlingCueTimer = clearTimeoutSafe(this.idlingCueTimer);
    const idlingCues = this.config.idle?.idlingCues;
    if (!idlingCues?.enabled || !idlingCues.items?.length) return;
    this.idlingCueTimer = setTimeout(
      () => {
        this.idlingCueTimer = null;
        // busy (talking, queued, or already playing one) — wait for the next lull
        if (this.isBusy()) {
          this.scheduleIdlingCue();
          return;
        }
        const eligible = this.eligibleIdlingCues();
        if (eligible.length === 0) {
          this.scheduleIdlingCue();
          return;
        }
        const item = weightedPick(eligible);
        if (item) this.performIdlingCue(item, 'idling-cue');
      },
      randomDelayMs(idlingCues.minSec, idlingCues.maxSec),
    );
  }

  /** Play an IdlingCue: a sequence of Cue(+line) steps that move together,
   *  then ease back to default. Any real activity cancels it. `source` tags
   *  who's playing it, for `cue.agent` / speech `agent` bookkeeping. */
  private performIdlingCue(cue: IdlingCue, source: string): void {
    if (!cue.steps?.length) return;
    this.idleTimer = clearTimeoutSafe(this.idleTimer);
    this.idlingCueActive = true;
    this.playIdlingCueStep(cue.steps, 0, source);
  }

  /** Advance one step of an IdlingCue. A step with `text` waits for that
   *  exact line to actually finish (real TTS duration if synthesized,
   *  otherwise LEN(text)) before moving on — `holdMs` is not used for a
   *  speaking step, so there is no separately-guessed number that can drift
   *  out of sync with what's really being said. A silent step (no `text`)
   *  has nothing to wait for, so `holdMs` (default 2000) is what times it. */
  private playIdlingCueStep(steps: IdlingCueStep[], i: number, source: string): void {
    // cancelled by real activity while waiting between steps
    if (!this.idlingCueActive) return;
    if (i >= steps.length) {
      this.idlingCueActive = false;
      // don't cut off a line that's still being read
      if (!this.isSpeaking()) this.revertToDefault();
      this.scheduleIdlingCue();
      return;
    }
    const step = steps[i];
    const cueName = step.cue && this.cues[step.cue] ? step.cue : this.cueState.cue;
    const advance = () => this.playIdlingCueStep(steps, i + 1, source);

    this.applyCueLook(cueName, source);
    if (step.text) {
      this.enqueueSpeech(step.text, cueName, source, {
        reading: step.reading,
        onComplete: advance,
      });
    } else {
      this.idlingCueHoldTimer = clearTimeoutSafe(this.idlingCueHoldTimer);
      this.idlingCueHoldTimer = setTimeout(advance, step.holdMs ?? 2000);
    }
  }

  /** Ease back to the default Cue, dropping any hold. */
  private revertToDefault(): void {
    this.applyCueLook(DEFAULT_CUE_NAME, null);
  }

  /** default Cue's directives, then the currently-selected Cue's directives
   *  layered on top (later entries win on shared radio groups) — a Cue is the
   *  only thing ever composited on top of the shared base. blink falls back
   *  to default's own blink when the selected Cue doesn't say either way, so
   *  a new Cue file that simply omits `blink` inherits the base look's blink
   *  behavior instead of silently going blink-less. */
  private composeDirectives(cueName: string): { directives: LayerDirectives; blink: boolean } {
    const base = this.cues[DEFAULT_CUE_NAME] ?? {};
    const cue = this.cues[cueName] ?? base;
    return {
      directives: {
        select: [...(base.select ?? []), ...(cue.select ?? [])],
        show: [...(base.show ?? []), ...(cue.show ?? [])],
        hide: [...(base.hide ?? []), ...(cue.hide ?? [])],
      },
      blink: cue.blink ?? base.blink ?? false,
    };
  }

  applyVisual(): void {
    const { directives, blink } = this.composeDirectives(this.cueState.cue);
    this.emit({ type: 'apply', directives, blink });
  }

  /** Debug: force-run one IdlingCue immediately (or the named one).
   *  Honors minAffinity/weight filters unless a specific name is requested. */
  triggerIdleAction(name?: string): { ok: true; name?: string } | { ok: false; error: string } {
    const idlingCues = this.config.idle?.idlingCues;
    if (!idlingCues?.enabled || !idlingCues.items?.length) {
      return { ok: false, error: 'idlingCues are disabled or empty' };
    }
    let item: IdlingCue | undefined;
    if (name) {
      item = idlingCues.items.find((a) => a.name === name);
      if (!item) {
        const names = idlingCues.items.map((a) => a.name).filter(Boolean);
        return { ok: false, error: `unknown idlingCue "${name}". known: ${names.join(', ')}` };
      }
    }
    item ??= weightedPick(this.eligibleIdlingCues());
    if (!item?.steps?.length) {
      return { ok: false, error: 'selected idlingCue has no steps' };
    }
    this.cancelIdlingCue();
    this.performIdlingCue(item, 'debug');
    this.scheduleIdlingCue();
    return { ok: true, name: item.name };
  }

  /** Debug: list configured IdlingCues. */
  listIdle(): {
    idlingCues: {
      name?: string;
      stepCount: number;
      weight?: number;
      minAffinity?: number;
      maxAffinity?: number;
    }[];
  } {
    return {
      idlingCues:
        this.config.idle?.idlingCues?.items.map((a) => ({
          name: a.name,
          stepCount: a.steps?.length ?? 0,
          weight: a.weight,
          minAffinity: a.minAffinity,
          maxAffinity: a.maxAffinity,
        })) ?? [],
    };
  }

  /** Debug: preview the directives a Cue would produce without wearing it.
   *  `select` is deduped to only the winning entry per radio group (the same
   *  last-wins rule the renderer applies) so the output shows what actually
   *  ends up on screen instead of the raw base+Cue concatenation. */
  previewCue(cueName: string): {
    cue: string;
    exists: boolean;
    fallback: string | null;
    directives: LayerDirectives;
    blink: boolean;
  } {
    const exists = Boolean(this.cues[cueName]);
    const targetCue = exists ? cueName : DEFAULT_CUE_NAME;
    const { directives, blink } = this.composeDirectives(targetCue);
    return {
      cue: cueName,
      exists,
      fallback: exists ? null : `unknown cue "${cueName}" — previewing default`,
      directives: { ...directives, select: dedupeSelectsByGroup(directives.select ?? []) },
      blink,
    };
  }

  snapshot(): {
    cue: CueState;
    currentSpeech: SpeechItem | null;
    speechQueue: SpeechItem[];
    cueWarning: string | null;
  } {
    return {
      cue: { ...this.cueState },
      currentSpeech: this.currentSpeech,
      speechQueue: [...this.speechQueue],
      cueWarning: this.lastCueWarning,
    };
  }
}
