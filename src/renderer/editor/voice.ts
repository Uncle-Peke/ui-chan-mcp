import type { Cue, EditorStyles } from '../../shared/types';

// 声色は**感情スタイルの重みだけ**。alp / huskiness のスライダーは撤去した——
// 81個のCueで一度も使われず、しかも声質を直に歪める逃げ道なので、正面玄関
// （5つの学習済みスタイルの混ぜ方）に一本化する。

export interface VoiceSliders {
  build(styles: EditorStyles | null): void;
  /** The voice block from the sliders, or the loaded one verbatim when the
   *  engine (and thus the style sliders) is unavailable. */
  read(): Cue['voice'];
  load(voice: Cue['voice']): void;
  onInput(fn: (() => void) | null): void;
}

/** One set of style sliders. Each tab that edits a voice gets its own set —
 *  `idPrefix` keeps their element ids apart. */
export function voiceSliders(host: HTMLElement, idPrefix: string): VoiceSliders {
  let styles: EditorStyles | null = null;
  // Voice preserved verbatim when the TTS engine is unreachable (no sliders to
  // rebuild it from) so editing a look never silently drops its voice.
  let preserved: Cue['voice'];
  let changed: (() => void) | null = null;
  const id = (name: string) => `${idPrefix}:${name}`;

  function sliderRow(name: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'slider-row';
    const label = document.createElement('label');
    label.textContent = name;
    const input = document.createElement('input');
    input.type = 'range';
    input.id = id(name);
    input.min = '0';
    input.max = '1';
    input.step = '0.05';
    input.value = '0';
    const out = document.createElement('span');
    out.className = 'slider-val';
    out.textContent = (0).toFixed(2);
    input.addEventListener('input', () => {
      out.textContent = Number(input.value).toFixed(2);
      changed?.();
    });
    row.append(label, input, out);
    return row;
  }

  function setSlider(name: string, value: number): void {
    const input = document.getElementById(id(name)) as HTMLInputElement | null;
    if (!input) return;
    input.value = String(value);
    const out = input.parentElement?.querySelector('.slider-val');
    if (out) out.textContent = value.toFixed(2);
  }

  function readSlider(name: string): number {
    const input = document.getElementById(id(name)) as HTMLInputElement | null;
    return input ? Number(input.value) : 0;
  }

  return {
    build(s) {
      styles = s;
      host.replaceChildren();
      if (!styles) {
        const note = document.createElement('div');
        note.className = 'muted';
        note.textContent =
          'TTSエンジンに接続できません（スタイル編集・試し喋りは無効。既存の声色は保持されます）';
        host.append(note);
        return;
      }
      for (const name of styles.style_names) host.append(sliderRow(name));
    },
    read() {
      if (!styles) return preserved;
      const style_weights: Record<string, number> = {};
      for (const name of styles.style_names) {
        const w = readSlider(name);
        if (w > 0) style_weights[name] = w;
      }
      return Object.keys(style_weights).length ? { style_weights } : undefined;
    },
    load(voice) {
      preserved = voice;
      if (!styles) return;
      for (const name of styles.style_names) setSlider(name, voice?.style_weights?.[name] ?? 0);
    },
    onInput(fn) {
      changed = fn;
    },
  };
}
