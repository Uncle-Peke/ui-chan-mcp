import type { CueVoice, TtsAudio, TtsConfig, VoiceAdlib } from '../shared/types';

const RETRY_COOLDOWN_MS = 60_000;
const SYNTH_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 150;
const VOWELS = new Set(['a', 'i', 'u', 'e', 'o']);

interface VoiceInfo {
  voice_name: string;
  voice_version: string;
  style_names: string[];
  default_style_weights: number[];
}

interface SynthesisInfo {
  state: string;
  duration?: number;
  phonemes?: string[];
  phoneme_durations?: number[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Build lip sync frames from VoiSona's phoneme timing. Consonants open the
 * mouth into the following vowel's shape at the consonant's start; silence,
 * N and cl close it.
 */
export function buildTimeline(phonemes: string[], durations: number[]): TtsAudio['timeline'] {
  const frames: { t: number; v: string }[] = [];
  let t = 0;
  let pendingStart: number | null = null;
  for (let i = 0; i < phonemes.length; i++) {
    const p = phonemes[i];
    const d = (durations[i] ?? 0.05) * 1000;
    if (VOWELS.has(p.toLowerCase())) {
      frames.push({ t: pendingStart ?? t, v: p.toLowerCase() });
      pendingStart = null;
    } else if (p === 'sil' || p === 'pau' || p === 'N' || p === 'cl') {
      frames.push({ t, v: 'n' });
      pendingStart = null;
    } else if (pendingStart === null) {
      pendingStart = t;
    }
    t += d;
  }
  // Collapse consecutive frames with the same mouth shape (e.g. several
  // vowels/consonants in a row that all resolve to the same viseme) down to
  // their first occurrence — the renderer only needs to know when the mouth
  // shape *changes*.
  const deduped: TtsAudio['timeline'] = [];
  for (const frame of frames) {
    if (deduped.length === 0 || deduped[deduped.length - 1].v !== frame.v) deduped.push(frame);
  }
  return deduped;
}

/**
 * VoiSona Talk REST API client (docs: http://localhost:32766/docs/talk_api.html).
 * Synthesizes to memory, retrieves the WAV plus phoneme timing, and lets the
 * renderer play audio in exact sync with the mouth.
 */
export class VoiSonaTalkClient {
  private disabledUntil = 0;
  private voiceCache: VoiceInfo | null = null;
  private runtimeUsername: string | null = null;
  private runtimePassword: string | null = null;
  private lastError: string | null = null;
  private lastSuccessAt: string | null = null;

  constructor(private cfg: TtsConfig) {}

  status(): {
    enabled: boolean;
    hasCredentials: boolean;
    coolingDown: boolean;
    lastError: string | null;
    lastSuccessAt: string | null;
  } {
    return {
      enabled: this.cfg.enabled,
      hasCredentials: this.hasCredentials(),
      coolingDown: Date.now() < this.disabledUntil,
      lastError: this.lastError,
      lastSuccessAt: this.lastSuccessAt,
    };
  }

  /** Credentials arrive from the MCP bridge (mcp.json env) and live in memory only. */
  setCredentials(username: string, password: string): void {
    if (username !== this.runtimeUsername || password !== this.runtimePassword) {
      this.runtimeUsername = username;
      this.runtimePassword = password;
      this.disabledUntil = 0; // new credentials: retry immediately
    }
  }

  hasCredentials(): boolean {
    return Boolean(this.runtimeUsername ?? process.env.UI_CHAN_TTS_USERNAME ?? this.cfg.username);
  }

  private base(): string {
    return `${this.cfg.url}/api/talk/v1`;
  }

  private headers(): Record<string, string> {
    const user =
      this.runtimeUsername ?? process.env.UI_CHAN_TTS_USERNAME ?? this.cfg.username ?? '';
    const pass =
      this.runtimePassword ?? process.env.UI_CHAN_TTS_PASSWORD ?? this.cfg.password ?? '';
    return {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
    };
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(this.base() + path, {
      headers: this.headers(),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
    return res.json() as Promise<T>;
  }

  private async resolveVoice(): Promise<VoiceInfo | null> {
    if (this.voiceCache) return this.voiceCache;
    const lang = this.cfg.language ?? 'ja_JP';
    const list = await this.get<{
      items: { voice_name: string; voice_version: string; languages: string[] }[];
    }>('/voices');
    const items = list.items ?? [];
    const picked =
      (this.cfg.voice_name && items.find((v) => v.voice_name === this.cfg.voice_name)) ||
      items.find((v) => v.languages?.includes(lang)) ||
      items[0];
    if (!picked) return null;
    const detail = await this.get<{ style_names?: string[]; default_style_weights?: number[] }>(
      `/voices/${encodeURIComponent(picked.voice_name)}/${encodeURIComponent(picked.voice_version)}`,
    );
    this.voiceCache = {
      voice_name: picked.voice_name,
      voice_version: picked.voice_version,
      style_names: detail.style_names ?? [],
      default_style_weights:
        detail.default_style_weights ?? (detail.style_names ?? []).map((_, i) => (i === 0 ? 1 : 0)),
    };
    return this.voiceCache;
  }

  /** The voice's style names + default weights, for the editor's slider UI.
   *  Returns null if the engine is unreachable or has no styles. */
  async listStyles(): Promise<{ style_names: string[]; default_style_weights: number[] } | null> {
    if (!this.hasCredentials()) return null;
    try {
      const voice = await this.resolveVoice();
      if (!voice || voice.style_names.length === 0) return null;
      return {
        style_names: voice.style_names,
        default_style_weights: voice.default_style_weights,
      };
    } catch {
      return null;
    }
  }

  /** Convert a { name: weight } style_weights map into the positional array
   *  VoiSona expects (ordered by voice.style_names). Pure name lookup — no
   *  blending, no defaults mixed in. */
  private styleWeights(
    target: Record<string, number> | undefined,
    voice: VoiceInfo,
  ): number[] | undefined {
    if (!target || voice.style_names.length === 0) return undefined;
    const vec = voice.style_names.map((name) => {
      const hit = Object.entries(target).find(([k]) => k.toLowerCase() === name.toLowerCase());
      return hit ? hit[1] : 0;
    });
    return vec.some((w) => w !== 0) ? vec : undefined;
  }

  /** Synthesize one line of speech in the given Cue's baked voice color,
   *  layered with this line's ad-lib pitch/speed/volume/intonation. Thin
   *  wrapper that resolves the Cue name to its saved voice color, then defers
   *  to synthesizeWithVoice. */
  synthesize(text: string, cue: string, adlib?: VoiceAdlib): Promise<TtsAudio | null> {
    return this.synthesizeWithVoice(text, this.cfg.cueVoice?.[cue], adlib);
  }

  /** Synthesize with an explicit voice color instead of a saved Cue name — used
   *  by the editor's "試し喋り" to preview an in-progress, not-yet-saved voice. */
  async synthesizeWithVoice(
    text: string,
    cueVoice: CueVoice | undefined,
    adlib?: VoiceAdlib,
  ): Promise<TtsAudio | null> {
    if (!this.cfg.enabled || !this.hasCredentials() || Date.now() < this.disabledUntil) return null;
    try {
      const voice = await this.resolveVoice();
      const weights = voice ? this.styleWeights(cueVoice?.style_weights, voice) : undefined;
      const globalParameters = {
        ...(weights ? { style_weights: weights } : {}),
        ...(cueVoice?.alp !== undefined ? { alp: cueVoice.alp } : {}),
        ...(cueVoice?.huskiness !== undefined ? { huskiness: cueVoice.huskiness } : {}),
        ...(adlib?.pitch !== undefined ? { pitch: adlib.pitch } : {}),
        ...(adlib?.speed !== undefined ? { speed: adlib.speed } : {}),
        ...(adlib?.volume !== undefined ? { volume: adlib.volume } : {}),
        ...(adlib?.intonation !== undefined ? { intonation: adlib.intonation } : {}),
      };
      const res = await fetch(`${this.base()}/speech-syntheses`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          force_enqueue: true,
          destination: 'memory',
          language: this.cfg.language ?? 'ja_JP',
          text,
          ...(voice ? { voice_name: voice.voice_name, voice_version: voice.voice_version } : {}),
          ...(Object.keys(globalParameters).length > 0
            ? { global_parameters: globalParameters }
            : {}),
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`POST /speech-syntheses: HTTP ${res.status}`);
      const { uuid } = (await res.json()) as { uuid: string };

      const deadline = Date.now() + SYNTH_TIMEOUT_MS;
      let info: SynthesisInfo;
      for (;;) {
        info = await this.get<SynthesisInfo>(`/speech-syntheses/${uuid}`);
        if (info.state === 'succeeded') break;
        if (info.state === 'failed') throw new Error('synthesis failed');
        if (Date.now() > deadline) throw new Error('synthesis timed out');
        await sleep(POLL_INTERVAL_MS);
      }

      const wavRes = await fetch(`${this.base()}/speech-syntheses/${uuid}/wav`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!wavRes.ok) throw new Error(`GET wav: HTTP ${wavRes.status}`);
      const wav = Buffer.from(await wavRes.arrayBuffer());

      fetch(`${this.base()}/speech-syntheses/${uuid}`, {
        method: 'DELETE',
        headers: this.headers(),
      }).catch(() => {});

      const durations = info.phoneme_durations ?? [];
      const durationMs = Math.round((info.duration ?? durations.reduce((a, b) => a + b, 0)) * 1000);
      this.lastError = null;
      this.lastSuccessAt = new Date().toISOString();
      return {
        wavBase64: wav.toString('base64'),
        durationMs,
        timeline: buildTimeline(info.phonemes ?? [], durations),
      };
    } catch (e) {
      this.disabledUntil = Date.now() + RETRY_COOLDOWN_MS;
      this.lastError = e instanceof Error ? e.message : String(e);
      console.error(
        `[ui-chan] VoiSona Talk synthesis failed (retrying after ${RETRY_COOLDOWN_MS / 1000}s): ${this.lastError}`,
      );
      return null;
    }
  }
}
