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
  TtsAudio,
  VoiceAdlib,
} from '../shared/types';
import { DEFAULT_CUE_NAME } from '../shared/types';

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

/** Every idle timer in this class follows the same "hold an id, clear-then-null
 *  it" shape (mirrors renderer.ts's clearTimeoutSafe for the browser side). */
function clearTimeoutSafe(id: NodeJS.Timeout | null): null {
  if (id !== null) clearTimeout(id);
  return null;
}

/** Random idle gap in ms, picked uniformly in [minSec, maxSec] (minSec floored to 1s). */
function randomDelayMs(minSec: number | undefined, maxSec: number | undefined): number {
  const min = Math.max(minSec ?? 0, 1);
  const max = Math.max(maxSec ?? min, min);
  return (min + Math.random() * (max - min)) * 1000;
}

export class UiChanState {
  private cues: Record<string, Cue>;
  private cueState: CueState;
  private speechQueue: SpeechItem[] = [];
  private currentSpeech: SpeechItem | null = null;
  private speechTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private chatterTimer: NodeJS.Timeout | null = null;
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
    this.scheduleChatter();
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

  adjustAffinity(delta: number, reason?: string): AffinityResult {
    if (typeof delta !== 'number' || Number.isNaN(delta)) {
      return { ok: false, error: 'delta must be a number' };
    }
    const before = this.affinity;
    this.affinity = this.clampAffinity(this.affinity + delta);
    return {
      ok: true,
      affinity: this.affinity,
      band: this.affinityBand(),
      delta: this.affinity - before,
      beamReady: this.affinitySnapshot().beamReady,
      reason: reason ?? null,
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
    this.setCueState(cueName, agent);
    this.applyVisual();

    if (args.text) {
      const speechResult = this.enqueueSpeech(
        args.text,
        args.duration_ms,
        agent,
        args.reading,
        pickAdlib(args),
        cueName,
      );
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

  /** Queue a line without touching the idle timers (used by chatter/IdlingCues). */
  private enqueueSpeech(
    text: string,
    durationMs: number | undefined,
    agent: string,
    reading: string | undefined,
    voice: VoiceAdlib | undefined,
    cue: string,
  ): EnqueueResult {
    if (this.speechQueue.length >= MAX_QUEUE) {
      return { ok: false, error: `speech queue is full (${MAX_QUEUE})` };
    }
    const speech = this.config.speech;
    const estimated = (speech?.baseMs ?? 1500) + text.length * (speech?.msPerChar ?? 120);
    const duration =
      durationMs ?? Math.min(Math.max(estimated, speech?.minMs ?? 2500), speech?.maxMs ?? 20000);
    this.speechQueue.push({ text, durationMs: duration, agent, reading, voice, cue });
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
    this.setCueState(DEFAULT_CUE_NAME, null);
    this.emit({ type: 'speech', text: null });
    this.applyVisual();
    // clear() is itself activity: without this, chatter/IdlingCue timers left
    // over from before the clear could still fire on their old schedule.
    this.scheduleChatter();
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
    this.scheduleChatter();
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
    this.scheduleChatter();
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
        const item = idlingCues.items[Math.floor(Math.random() * idlingCues.items.length)];
        this.performIdlingCue(item, 'idling-cue');
      },
      randomDelayMs(idlingCues.minSec, idlingCues.maxSec),
    );
  }

  /** Play an IdlingCue: a sequence of Cue(+line) steps that move together,
   *  then ease back to default. Any real activity cancels it. Shared by both
   *  the IdlingCue pool and chatter (chatter is just IdlingCues on a slower,
   *  separately-configured cadence) — `source` tags who's playing it, for
   *  `cue.agent` / speech `agent` bookkeeping. */
  private performIdlingCue(cue: IdlingCue, source: string): void {
    if (!cue.steps?.length) return;
    this.idleTimer = clearTimeoutSafe(this.idleTimer);
    this.idlingCueActive = true;
    this.playIdlingCueStep(cue.steps, 0, source);
  }

  private playIdlingCueStep(steps: IdlingCueStep[], i: number, source: string): void {
    // cancelled by real activity while waiting between steps
    if (!this.idlingCueActive) return;
    if (i >= steps.length) {
      this.idlingCueActive = false;
      // don't cut off a line that's still being read
      if (!this.isSpeaking()) this.revertToDefault();
      this.scheduleChatter();
      this.scheduleIdlingCue();
      return;
    }
    const step = steps[i];
    if (step.cue && this.cues[step.cue]) {
      this.setCueState(step.cue, source);
      this.applyVisual();
    }
    if (step.text) {
      this.enqueueSpeech(step.text, undefined, source, step.reading, undefined, this.cueState.cue);
    }
    this.idlingCueHoldTimer = clearTimeoutSafe(this.idlingCueHoldTimer);
    this.idlingCueHoldTimer = setTimeout(() => {
      this.idlingCueHoldTimer = null;
      this.playIdlingCueStep(steps, i + 1, source);
    }, step.holdMs ?? 2000);
  }

  /** Ease back to the default Cue, dropping any hold. */
  private revertToDefault(): void {
    this.setCueState(DEFAULT_CUE_NAME, null);
    this.applyVisual();
  }

  /** (Re)start the idle-chatter countdown. Any activity postpones it, so the
   *  mascot only speaks up after a genuine lull (never over ongoing work).
   *  Chatter entries are IdlingCues too (usually a single {cue, text} step) —
   *  just drawn from their own pool on their own (much slower) cadence. */
  private scheduleChatter(): void {
    this.chatterTimer = clearTimeoutSafe(this.chatterTimer);
    const chatter = this.config.idle?.chatter;
    if (!chatter?.enabled || !chatter.items?.length) return;
    this.chatterTimer = setTimeout(
      () => {
        this.chatterTimer = null;
        // still (or again) busy — don't talk over speech or an IdlingCue; wait for the next lull
        if (this.isBusy()) {
          this.scheduleChatter();
          return;
        }
        const item = chatter.items[Math.floor(Math.random() * chatter.items.length)];
        this.performIdlingCue(item, 'idle-chatter');
      },
      randomDelayMs(chatter.minSec, chatter.maxSec),
    );
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
