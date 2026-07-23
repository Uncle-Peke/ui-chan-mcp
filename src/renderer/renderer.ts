import type { AmbientConfig, LipSyncConfig, RenderCommand, TtsAudio } from '../shared/types';
import { PsdStage } from './psd-stage';

interface UiChanApi {
  getInit(): Promise<{
    config: {
      assetsDir: string;
      window: { width: number; height: number };
      lipSync?: LipSyncConfig;
      ambient?: AmbientConfig;
    };
    psdAvailable: boolean;
    psdFile: string | null;
  }>;
  readPsd(): Promise<Uint8Array | null>;
  ready(): void;
  reportWarnings(warnings: string[]): void;
  onCommand(cb: (cmd: RenderCommand) => void): void;
}

declare global {
  interface Window {
    uiChan: UiChanApi;
  }
}

const EYE_CLOSE_PATH = '!目/*閉じ';
// The mouth folder used by lip sync's findSelect() lookups. Not configurable
// via a "slots" catalog anymore (that catalog was set_face-only and is gone);
// this is the one fixed PSD convention the renderer still needs to know.
const LIP_MOUTH_FOLDER = '!口';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const bubble = document.getElementById('bubble')!;
const placeholder = document.getElementById('placeholder')!;

// The shared PSD compositing core. Blink / lip-sync / bubble stay in this file.
const stage = new PsdStage(canvas);
function draw(): void {
  stage.draw();
}
function reportWarnings(): void {
  window.uiChan.reportWarnings(stage.getWarnings());
}

// ---- Cue-transition crossfade (tween) ----
// Because a look is discrete sprite swaps (a mouth あ→ん can't be interpolated),
// we tween at the raster level: freeze the pre-change frame onto an overlay
// canvas stacked over the main one, repaint the new look underneath, then fade
// the frozen old frame out. Any cue pair dissolves smoothly; blink/lip-sync
// (which repaint the main canvas) show through the fading overlay fine.
// Duration comes from config.ambient.cueFadeMs (0 = hard cut).
const overlay = document.createElement('canvas');
overlay.style.cssText =
  'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0';
const overlayCtx = overlay.getContext('2d');
canvas.parentElement?.insertBefore(overlay, canvas.nextSibling);
let fadeToken = 0;
function crossfade(): void {
  const fadeMs = ambientConfig?.cueFadeMs ?? 170;
  if (!overlayCtx || fadeMs <= 0 || canvas.width === 0 || canvas.height === 0) return;
  overlay.width = canvas.width;
  overlay.height = canvas.height;
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  overlayCtx.drawImage(canvas, 0, 0); // snapshot the current (old) look
  overlay.style.transition = 'none';
  overlay.style.opacity = '1';
  const token = ++fadeToken;
  window.requestAnimationFrame(() => {
    if (token !== fadeToken) return;
    overlay.style.transition = `opacity ${fadeMs}ms ease-out`;
    overlay.style.opacity = '0';
  });
}

let blinkEnabled = false;
let blinkTimer: number | null = null;
let blinking = false;
// Blink timing, populated from config in init(); undefined until then falls
// back to the same constants this file used before they became configurable.
let ambientConfig: AmbientConfig | null = null;

function randomDelayMs(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// ---- timer bookkeeping ----
// Every timer in this file follows the same "hold an id, clear-then-null it"
// shape; these two helpers replace the repeated `if (x!==null) clear(x); x=null`
// stanza with a single assignment at each call site.
function clearTimeoutSafe(id: number | null): null {
  if (id !== null) window.clearTimeout(id);
  return null;
}
function clearIntervalSafe(id: number | null): null {
  if (id !== null) window.clearInterval(id);
  return null;
}

function scheduleBlink(): void {
  blinkTimer = clearTimeoutSafe(blinkTimer);
  blinkTimer = window.setTimeout(
    () => {
      blinkTimer = null;
      if (blinkEnabled && stage.loaded && !blinking && stage.walkPath(EYE_CLOSE_PATH)) {
        blinking = true;
        const saved = stage.snapshotVisibility();
        stage.selectPath(EYE_CLOSE_PATH);
        draw();
        window.setTimeout(() => {
          stage.restoreVisibility(saved);
          blinking = false;
          draw();
          scheduleBlink();
        }, ambientConfig?.blinkDurationMs ?? 130);
      } else {
        scheduleBlink();
      }
    },
    randomDelayMs(
      ambientConfig?.blinkMinIntervalMs ?? 3500,
      ambientConfig?.blinkMaxIntervalMs ?? 7000,
    ),
  );
}

// ---- lip sync ----

let lipConfig: LipSyncConfig | null = null;
let lipTimer: number | null = null;
let lipFrames: string[] = [];
let lipIndex = 0;
let lipCurrentMouth: string | null = null;

const VOWEL_ROWS: Record<string, string> = {
  a: 'あかがさざただなはばぱまやらわぁゃ',
  i: 'いきぎしじちぢにひびぴみりゐぃ',
  u: 'うくぐすずつづぬふぶぷむゆるゔぅゅ',
  e: 'えけげせぜてでねへべぺめれゑぇ',
  o: 'おこごそぞとどのほぼぽもよろをぉょ',
};

function vowelOf(c: string): string | null {
  for (const [v, row] of Object.entries(VOWEL_ROWS)) {
    if (row.includes(c)) return v;
  }
  return null;
}

function toLipFrames(s: string): string[] {
  const frames: string[] = [];
  let altOpen = true;
  for (const ch of s) {
    let c = ch;
    const code = c.codePointAt(0)!;
    if (code >= 0x30a1 && code <= 0x30f6) c = String.fromCodePoint(code - 0x60); // katakana -> hiragana
    if ('ゃゅょぁぃぅぇぉ'.includes(c)) {
      const v = vowelOf(c);
      if (frames.length > 0 && v) frames[frames.length - 1] = v; // merge small kana into previous mora
      continue;
    }
    if (c === 'ー') {
      frames.push(frames.length > 0 ? frames[frames.length - 1] : 'n');
      continue;
    }
    if (c === 'っ' || c === 'ん') {
      frames.push('n');
      continue;
    }
    const v = vowelOf(c);
    if (v) {
      frames.push(v);
      continue;
    }
    if (/\s|[、。！？!?.,…・〜～「」『』()（）]/.test(c)) {
      frames.push('n');
      continue;
    }
    // kanji or other unreadable characters: alternate open/close
    frames.push(altOpen ? 'a' : 'n');
    altOpen = !altOpen;
  }
  return frames;
}

function setLipMouth(vowel: string): void {
  if (!lipConfig) return;
  const name = lipConfig.mouths[vowel] ?? lipConfig.mouths.n;
  if (!name || name === lipCurrentMouth) return;
  lipCurrentMouth = name;
  stage.findSelect(LIP_MOUTH_FOLDER, name);
  draw();
}

function stopLipSync(): void {
  lipTimer = clearIntervalSafe(lipTimer);
  lipFrames = [];
  lipIndex = 0;
  lipCurrentMouth = null;
}

function startLipSync(text: string, reading?: string | null): void {
  stopLipSync();
  if (!lipConfig || !stage.loaded) return;
  lipFrames = toLipFrames(reading && reading.trim().length > 0 ? reading : text);
  if (lipFrames.length === 0) return;
  const interval = 1000 / (lipConfig.charsPerSec ?? 9);
  lipTimer = window.setInterval(() => {
    if (lipIndex >= lipFrames.length) {
      setLipMouth('n');
      lipTimer = clearIntervalSafe(lipTimer);
      return;
    }
    setLipMouth(lipFrames[lipIndex++]);
  }, interval);
}

// ---- TTS audio playback with phoneme-timed lip sync ----

let audioEl: HTMLAudioElement | null = null;
let audioUrl: string | null = null;
let audioTimer: number | null = null;

function stopAudio(): void {
  audioTimer = clearIntervalSafe(audioTimer);
  if (audioEl) {
    audioEl.pause();
    audioEl = null;
  }
  if (audioUrl) {
    URL.revokeObjectURL(audioUrl);
    audioUrl = null;
  }
}

function startAudioLipSync(
  audio: TtsAudio,
  fallbackText: string,
  fallbackReading?: string | null,
): void {
  stopAudio();
  const bytes = Uint8Array.from(atob(audio.wavBase64), (c) => c.charCodeAt(0));
  audioUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  audioEl = new Audio(audioUrl);
  const el = audioEl;
  el.play().catch(() => {
    // audio blocked or broken: fall back to kana-driven lip sync
    stopAudio();
    startLipSync(fallbackText, fallbackReading);
  });
  audioTimer = window.setInterval(() => {
    if (!audioEl) return;
    if (audioEl.ended) {
      setLipMouth('n');
      audioTimer = clearIntervalSafe(audioTimer);
      return;
    }
    const ms = audioEl.currentTime * 1000;
    let v = 'n';
    for (const f of audio.timeline) {
      if (f.t <= ms) v = f.v;
      else break;
    }
    setLipMouth(v);
  }, lipConfig?.audioPollMs ?? 33);
}

let hideTextTimer: number | null = null;
function setSpeech(text: string | null): void {
  hideTextTimer = clearTimeoutSafe(hideTextTimer);
  if (text !== null) {
    bubble.textContent = text;
    bubble.classList.add('visible');
  } else {
    bubble.classList.remove('visible');
    hideTextTimer = window.setTimeout(() => {
      bubble.textContent = '';
    }, 250);
  }
}

async function init(): Promise<void> {
  const initData = await window.uiChan.getInit();

  window.uiChan.onCommand((cmd) => {
    if (cmd.type === 'apply') {
      if (!stage.loaded) return;
      crossfade(); // freeze the current look, then dissolve to the new one
      blinkEnabled = cmd.blink;
      stage.applyDirectives(cmd.directives);
      reportWarnings();
      lipCurrentMouth = null; // let the next lip tick re-assert its mouth
      draw();
    } else if (cmd.type === 'speech') {
      setSpeech(cmd.text);
      if (cmd.text !== null) {
        if (cmd.audio) {
          stopLipSync();
          startAudioLipSync(cmd.audio, cmd.text, cmd.reading);
        } else {
          startLipSync(cmd.text, cmd.reading);
        }
      } else {
        stopAudio();
        stopLipSync();
      }
    }
  });

  if (!initData.psdAvailable) {
    placeholder.style.display = 'block';
    const dirEl = document.getElementById('assets-dir');
    if (dirEl) dirEl.textContent = `${initData.config.assetsDir}/`;
    window.uiChan.ready();
    return;
  }

  const buffer = await window.uiChan.readPsd();
  if (!buffer) {
    placeholder.style.display = 'block';
    window.uiChan.ready();
    return;
  }
  stage.loadPsd(buffer);
  lipConfig = initData.config.lipSync ?? null;
  ambientConfig = initData.config.ambient ?? null;
  draw();
  scheduleBlink();
  window.addEventListener('resize', draw);
  window.uiChan.ready();
}

init().catch((e) => {
  placeholder.style.display = 'block';
  placeholder.replaceChildren();
  const h1 = document.createElement('h1');
  h1.textContent = 'ui-chan: 読み込みエラー';
  const p = document.createElement('p');
  p.textContent = String(e);
  placeholder.append(h1, p);
  window.uiChan.ready();
});
