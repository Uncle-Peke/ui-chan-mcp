import type { AccentWord, Delivery, LexiconEntry } from '../../shared/types';
import { $ } from './bridge';

// The ACC lane: the engine's own reading of the line, word by word, with each
// mora drawn high or low. Clicking a mora flips it and writes the word into the
// step's `delivery.words` — the same override `tts.lexicon` uses, scoped to
// this one line.
//
// It is for fixing a word the engine gets **wrong**, not for emphasis. Changing
// an accent to stress a word was tried and failed by ear: it reads as a
// different word, not a stressed one (docs/design/PROSODY.md). Emphasis is
// `**bold**` in the text.

export interface AccentLane {
  /** Re-analyze the selected step after `delayMs` (typing restarts the wait). */
  schedule(delayMs?: number): void;
}

export function accentLane(deps: {
  /** The selected step as it is on screen, or null when nothing is open. */
  line(): { text: string; reading: string; delivery?: Delivery } | null;
  /** The step's current word overrides. */
  overrides(): LexiconEntry[];
  /** Set (hl) or drop (null) one word's override. false = it couldn't. */
  setOverride(surface: string, hl: string | null): boolean;
  warn(message: string): void;
}): AccentLane {
  const host = $('acc-words');
  let timer: number | null = null;
  /** Bumped per request so a slow, stale analysis can't overwrite a newer one. */
  let ticket = 0;
  let shown: AccentWord[] = [];

  function note(message: string): void {
    host.classList.remove('busy');
    const span = document.createElement('span');
    span.className = 'muted';
    span.textContent = message;
    host.replaceChildren(span);
  }

  async function analyze(): Promise<void> {
    const line = deps.line();
    if (!line) return note('');
    if (!line.text.trim()) return note('（セリフの無いステップ）');
    const mine = ++ticket;
    // 中身は入れ替えずに薄くするだけ。「解析中…」に差し替えると、そのたびに
    // レーンの見た目が跳ねる。
    host.classList.add('busy');
    const words = await window.uiEditor.analyze(
      line.text,
      line.reading.trim() || undefined,
      line.delivery,
    );
    if (mine !== ticket) return;
    if (!words) return note('TTSエンジンに接続できないので解析できません');
    shown = words;
    host.classList.remove('busy');
    render();
  }

  function render(): void {
    host.replaceChildren();
    const overridden = new Set(deps.overrides().map((e) => e.word));
    const seen = new Map<string, number>();
    shown.forEach((w, i) => {
      if (!w.hl) {
        // Punctuation: shows where phrases break and where the question rises.
        const sep = document.createElement('span');
        sep.className = `acc-sep${w.isQuestion ? ' acc-q' : ''}`;
        sep.textContent = w.surface;
        if (w.isQuestion) sep.title = '語尾が上がる（is_question）';
        host.append(sep);
        return;
      }
      const nth = (seen.get(w.surface) ?? 0) + 1;
      seen.set(w.surface, nth);
      const chip = document.createElement('div');
      chip.className = `acc-word${w.phraseHead && i > 0 ? ' head' : ''}${overridden.has(w.surface) ? ' overridden' : ''}`;
      const surface = document.createElement('div');
      surface.className = 'acc-surface';
      surface.textContent = w.surface;
      if (overridden.has(w.surface)) {
        const drop = document.createElement('button');
        drop.type = 'button';
        drop.className = 'acc-x';
        drop.textContent = '×';
        drop.title = 'この語の上書きを外す';
        drop.addEventListener('click', () => {
          // 枠はすぐ外す。高低は、続く解析し直しがエンジンの読みに戻す。
          if (deps.setOverride(w.surface, null)) render();
        });
        surface.append(drop);
      }
      const morae = document.createElement('div');
      morae.className = 'acc-morae';
      w.morae.forEach((mora, k) => {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = `acc-mora ${w.hl[k] === 'h' ? 'h' : 'l'}`;
        cell.textContent = mora;
        cell.title = 'クリックで高低を切り替え';
        cell.addEventListener('click', () => {
          // The override matches the first occurrence of the word in the line
          // (prosody.ts applyLexicon), so a later repeat can't be told apart.
          if (nth > 1)
            deps.warn(`「${w.surface}」は行内に複数あり、上書きは最初の1つにだけ効きます`);
          const hl = w.hl.slice(0, k) + (w.hl[k] === 'h' ? 'l' : 'h') + w.hl.slice(k + 1);
          if (!deps.setOverride(w.surface, hl)) return;
          w.hl = hl; // show it now; the re-analysis that follows confirms it
          render();
        });
        morae.append(cell);
      });
      chip.append(surface, morae);
      host.append(chip);
    });
  }

  return {
    schedule(delayMs = 400) {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void analyze();
      }, delayMs);
    },
  };
}
