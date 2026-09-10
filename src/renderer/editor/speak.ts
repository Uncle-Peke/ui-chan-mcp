import type { Cue, Delivery } from '../../shared/types';
import { shared, stage } from './stage';

const LIP_MOUTH_FOLDER = '!口';

let lipTimer: number | null = null;
let lipMouth: string | null = null;
/** Ends whatever line is playing now — so starting another one (or leaving the
 *  tab) never strands a caller waiting on an `ended` that will not come. */
let finishCurrent: (() => void) | null = null;

/** Drive the mouth radio from the synthesized audio's phoneme timeline, in
 *  sync with playback — the same viseme mapping the mascot renderer uses, so
 *  a preview shows lip-sync too, not just audio. */
function setLipMouth(vowel: string): void {
  const lip = shared.lipConfig;
  if (!lip) return;
  const name = lip.mouths[vowel] ?? lip.mouths.n;
  if (!name || name === lipMouth) return;
  lipMouth = name;
  stage.findSelect(LIP_MOUTH_FOLDER, name);
  stage.draw();
}

function stopLip(): void {
  if (lipTimer !== null) window.clearInterval(lipTimer);
  lipTimer = null;
  lipMouth = null;
}

/** Stop the line that is playing, if any. */
export function stopSpeaking(): void {
  finishCurrent?.();
}

/**
 * Synthesize one line and play it on the preview, mouth included. Resolves
 * when the line has finished (or was cut off); `false` means the engine could
 * not be reached and nothing played. The look on the stage is restored
 * afterwards, so lip-sync's mouth changes never leak into what gets saved.
 */
export async function speak(
  text: string,
  voice: Cue['voice'],
  opts: { onStart?: () => void; delivery?: Delivery; reading?: string } = {},
): Promise<boolean> {
  const audio = await window.uiEditor.synthesize(text, voice, opts.delivery, opts.reading);
  if (!audio) return false;
  stopSpeaking();
  const bytes = Uint8Array.from(atob(audio.wavBase64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  // Snapshot the current look so lip-sync's mouth changes revert cleanly.
  const savedLook = stage.snapshotVisibility();
  const el = new Audio(url);
  return new Promise((resolve) => {
    const finish = (): void => {
      if (finishCurrent !== finish) return;
      finishCurrent = null;
      el.pause();
      stopLip();
      stage.restoreVisibility(savedLook);
      stage.draw();
      URL.revokeObjectURL(url);
      resolve(true);
    };
    finishCurrent = finish;
    el.addEventListener('ended', finish);
    el.play().then(() => opts.onStart?.(), finish);
    lipTimer = window.setInterval(() => {
      if (el.ended) return;
      const ms = el.currentTime * 1000;
      let v = 'n';
      for (const f of audio.timeline) {
        if (f.t <= ms) v = f.v;
        else break;
      }
      setLipMouth(v);
    }, shared.lipConfig?.audioPollMs ?? 33);
  });
}
