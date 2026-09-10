import fsSync from 'node:fs';
import type {
  AccentWord,
  CueVoice,
  Delivery,
  LexiconEntry,
  TtsAudio,
  TtsConfig,
} from '../shared/types';
import {
  applyEnding,
  applyLexicon,
  buildDurations,
  derivedDelivery,
  emphasisTargets,
  emphasize,
  forSpeech,
  INTONATION_FALLBACK,
  needsTsml,
  tsmlWords,
  wantsStretch,
} from './prosody';

const RETRY_COOLDOWN_MS = 60_000;
/** The engine simply not being up yet is a transient, self-healing condition
 *  (the MCP bridge relaunches VoiSona Talk), so it must not silence the mascot
 *  for a full minute the way a real synthesis error does. */
const UNREACHABLE_COOLDOWN_MS = 5_000;
const SYNTH_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 150;
const VOWELS = new Set(['a', 'i', 'u', 'e', 'o']);

interface VoiceInfo {
  voice_name: string;
  voice_version: string;
  style_names: string[];
  default_style_weights: number[];
}

/** 解析結果は同じ文字列に対して常に同じなので使い回す。IdlingCue と EventCue は
 *  固定文で何度も再生されるため、実測 +0.5 秒の往復がそこでは実質ゼロになる。 */
const TSML_CACHE_MAX = 200;

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

/** Tell "the engine isn't up" apart from a genuine synthesis failure: a dead
 *  port makes fetch reject (ECONNREFUSED) or time out, never return an HTTP
 *  status, so only those two shapes count as unreachable. */
function isUnreachable(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return true;
  const cause = (e as { cause?: { code?: string } }).cause?.code ?? '';
  return ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH'].includes(cause);
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
  private engineUnreachable = false;
  /** 解析ずみ TSML のキャッシュ（挿入順の LRU 相当）。 */
  private tsmlCache = new Map<string, string | null>();

  constructor(private cfg: TtsConfig) {}

  status(): {
    enabled: boolean;
    hasCredentials: boolean;
    coolingDown: boolean;
    lastError: string | null;
    lastSuccessAt: string | null;
    engineUnreachable: boolean;
  } {
    return {
      enabled: this.cfg.enabled,
      hasCredentials: this.hasCredentials(),
      coolingDown: Date.now() < this.disabledUntil,
      lastError: this.lastError,
      lastSuccessAt: this.lastSuccessAt,
      engineUnreachable: this.engineUnreachable,
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

  /** エディタの ACC レーン用：この行をエンジンに解析させ、語ごとの読みと
   *  モーラの高低を返す。辞書（tts.lexicon）と行の words、語尾の指定を当てた
   *  後の、**実際に合成に使われる形**。`text` は合成に渡すのと同じもの
   *  （ttsTextFor 済み）を受け取る。 */
  async analyzeWords(text: string, delivery?: Delivery): Promise<AccentWord[] | null> {
    if (!this.cfg.enabled || !this.hasCredentials() || Date.now() < this.disabledUntil) return null;
    const lexicon = [...(this.cfg.lexicon ?? []), ...(delivery?.words ?? [])];
    const tsml = await this.analyzed(
      forSpeech(text),
      emphasisTargets(text),
      lexicon,
      delivery?.ending,
    );
    return tsml ? tsmlWords(tsml) : null;
  }

  /**
   * 文字列 → TSML（エンジン自身の「この日本語をこう読む」という理解）→ 演出を
   * 当てた TSML。**AI に TSML を書かせない**のがここの肝で、`pos` や `phoneme` は
   * エンジンが決めることなので、必ず解析させてから差分だけを当てる。
   *
   * 失敗したら null を返す：抑揚が付かないのは劣化だが、喋らないのは故障。
   */
  private async analyzed(
    spoken: string,
    targets: string[],
    lexicon: LexiconEntry[],
    ending?: 'flat' | 'rise',
  ): Promise<string | null> {
    // キャッシュキーは「同じ TSML になる条件」を全部含める。語の上書きと語尾の
    // 扱いで結果が変わるので、文字列と強調だけでは足りない。
    const key = `${spoken}\u0000${targets.join('\u0001')}\u0000${ending ?? ''}\u0000${JSON.stringify(lexicon)}`;
    const hit = this.tsmlCache.get(key);
    if (hit !== undefined) return hit;
    try {
      const res = await fetch(`${this.base()}/text-analyses`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          force_enqueue: true,
          language: this.cfg.language ?? 'ja_JP',
          text: spoken,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const { uuid } = (await res.json()) as { uuid: string };
      const deadline = Date.now() + SYNTH_TIMEOUT_MS;
      let info: { state: string; analyzed_text?: string };
      for (;;) {
        info = await this.get(`/text-analyses/${uuid}`);
        if (info.state === 'succeeded') break;
        if (info.state === 'failed') return null;
        if (Date.now() > deadline) return null;
        await sleep(POLL_INTERVAL_MS);
      }
      // 使い終わった依頼は残さない（合成側と同じ後始末）。
      fetch(`${this.base()}/text-analyses/${uuid}`, {
        method: 'DELETE',
        headers: this.headers(),
      }).catch(() => {});
      let tsml = info.analyzed_text;
      if (!tsml) return null;
      tsml = applyLexicon(tsml, lexicon);
      for (const t of targets) tsml = emphasize(tsml, t);
      if (ending) tsml = applyEnding(tsml, ending);
      if (this.tsmlCache.size >= TSML_CACHE_MAX) {
        this.tsmlCache.delete(this.tsmlCache.keys().next().value as string);
      }
      this.tsmlCache.set(key, tsml);
      return tsml;
    } catch {
      return null;
    }
  }

  /** 1行を、渡された声色で合成する。声は呼び出し側が解決して渡す——
   *  マスコットは積んだ時点の Cue から、エディタは編集中のスライダーから。
   *  Cue 名から引く口は持たない（名前を知っているのは set_cue だけなので）。 */
  async synthesize(
    text: string,
    cueVoice: CueVoice | undefined,
    delivery?: Delivery,
  ): Promise<TtsAudio | null> {
    if (!this.cfg.enabled || !this.hasCredentials() || Date.now() < this.disabledUntil) return null;
    try {
      const voice = await this.resolveVoice();
      // 記法の翻訳。太字も辞書語も無い行は、ここで何も起きず今までの経路を通る。
      const spoken = forSpeech(text);
      // 行ごとの上書きは全部ここで解決する。書かれていないものは導出値のまま。
      // 語の上書きは config のあとに置く——applyLexicon は順に当てるので、
      // 同じ語があれば後勝ち＝行の指定のほうが強い。
      const lexicon = [...(this.cfg.lexicon ?? []), ...(delivery?.words ?? [])];
      const styles = cueVoice?.style_weights;
      // 書かなかった項目の値。エディタの「自動」表示も同じ関数を見る。
      const auto = derivedDelivery(styles, this.cfg.intonation ?? INTONATION_FALLBACK);
      const needs = needsTsml(text, lexicon) || !!delivery?.ending || !!delivery?.words?.length;
      const tsml = needs
        ? await this.analyzed(spoken, emphasisTargets(text), lexicon, delivery?.ending)
        : null;
      // 語尾伸ばしは音素長で当てる。TSML から音素列を再現できるので、往復は
      // 増えない（→ prosody.ts の phonemeSequence）。
      // 伸ばし（`〜`）と詰め（`っ`）を1つの配列にまとめる。どちらも書き方が指示。
      const stretch = tsml
        ? buildDurations(tsml, {
            ...(wantsStretch(text) ? { stretchSec: delivery?.stretchSec ?? auto.stretchSec } : {}),
            ...(delivery?.clipSec !== undefined ? { clipSec: delivery.clipSec } : {}),
          })
        : null;
      const weights = voice ? this.styleWeights(styles, voice) : undefined;
      const globalParameters = {
        ...(weights ? { style_weights: weights } : {}),
        // 演技は全部ここで感情から導出する。Cue にも行にも数値は置かない。
        intonation: delivery?.intonation ?? auto.intonation,
        speed: delivery?.speed ?? auto.speed,
        pitch: delivery?.pitch ?? auto.pitch,
        ...(delivery?.volume !== undefined ? { volume: delivery.volume } : {}),
      };
      const res = await fetch(`${this.base()}/speech-syntheses`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          force_enqueue: true,
          destination: 'memory',
          language: this.cfg.language ?? 'ja_JP',
          // analyzed_text を渡すと text は無視される。渡せなかったとき（解析
          // 失敗・エンジンの機嫌）に黙って素の読みへ落ちるよう、text も必ず送る。
          text: spoken,
          ...(tsml ? { analyzed_text: tsml } : {}),
          ...(stretch ? { phoneme_durations: stretch } : {}),
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
      // 一時デバッグ: UI_CHAN_DUMP=1 のとき、送った内容と鳴らした音を落とす。
      if (process.env.UI_CHAN_DUMP === '1') {
        try {
          const dir = '/tmp/ui-chan-dump';
          fsSync.mkdirSync(dir, { recursive: true });
          const stamp = String(Date.now());
          fsSync.writeFileSync(`${dir}/${stamp}.wav`, wav);
          fsSync.writeFileSync(
            `${dir}/${stamp}.json`,
            JSON.stringify({ spoken, tsml, stretch, globalParameters }, null, 2),
          );
        } catch {
          /* ignore */
        }
      }
      this.lastError = null;
      this.lastSuccessAt = new Date().toISOString();
      this.engineUnreachable = false;
      return {
        wavBase64: wav.toString('base64'),
        durationMs,
        timeline: buildTimeline(info.phonemes ?? [], durations),
      };
    } catch (e) {
      this.engineUnreachable = isUnreachable(e);
      const cooldown = this.engineUnreachable ? UNREACHABLE_COOLDOWN_MS : RETRY_COOLDOWN_MS;
      this.disabledUntil = Date.now() + cooldown;
      this.lastError = e instanceof Error ? e.message : String(e);
      console.error(
        this.engineUnreachable
          ? `[ui-chan] VoiSona Talk not reachable at ${this.cfg.url} (retrying in ${cooldown / 1000}s): ${this.lastError}`
          : `[ui-chan] VoiSona Talk synthesis failed (retrying after ${cooldown / 1000}s): ${this.lastError}`,
      );
      return null;
    }
  }
}
