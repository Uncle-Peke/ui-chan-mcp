import {
  type DerivedDelivery,
  derivedDelivery,
  hasClippedWord,
  wantsStretch,
} from '../../app/prosody';
import type { Delivery } from '../../shared/types';
import { $ } from './bridge';
import { shared } from './stage';

// The delivery panel: one line's performance, shown against what the app would
// derive on its own. A knob only lands in `delivery` when its box is ticked —
// "what you didn't write stays derived" is the contract (docs/design/PROSODY.md),
// so the panel shows the derived value (◆) instead of pretending it's zero.
//
// The derived values come from `derivedDelivery()`, the same function the
// synthesizer uses (tts.ts), so what the panel calls 自動 is exactly what plays.

type Knob = 'intonation' | 'speed' | 'pitch' | 'volume' | 'stretchSec' | 'clipSec';

const KNOBS: {
  key: Knob;
  label: string;
  min: number;
  max: number;
  step: number;
  digits: number;
}[] = [
  { key: 'intonation', label: '抑揚', min: 0, max: 2, step: 0.05, digits: 2 },
  { key: 'speed', label: '話速', min: 0.5, max: 2, step: 0.01, digits: 2 },
  { key: 'pitch', label: '高さ ¢', min: -300, max: 300, step: 10, digits: 0 },
  { key: 'volume', label: '音量 dB', min: -8, max: 8, step: 0.5, digits: 1 },
  { key: 'stretchSec', label: '〜 伸ばし', min: 0, max: 0.8, step: 0.05, digits: 2 },
  { key: 'clipSec', label: 'っ 詰め', min: 0, max: 0.4, step: 0.01, digits: 2 },
];

/** 保存するときのキーの順番。これ以外のキー（$comment など）は後ろに残す。 */
const ORDER = [...KNOBS.map((k) => k.key), 'ending', 'words'];

export interface DeliveryPanel {
  /** 導出値を計算し直す（声色やセリフが変わったとき）。`load` より先に呼ぶ。 */
  refresh(styleWeights: Record<string, number> | undefined, text: string): void;
  load(d: Delivery | undefined): void;
  /** 画面の内容を delivery にする。触っていなければ `original` をそのまま返す
   *  （開いて保存しただけでファイルが変わらないように）。words が読めなければ投げる。 */
  read(original: Delivery | undefined): Delivery | undefined;
  onChange(fn: (() => void) | null): void;
}

export function deliveryPanel(): DeliveryPanel {
  let auto: DerivedDelivery = derivedDelivery(undefined, shared.intonationFallback);
  let touched = false;
  let changed: (() => void) | null = null;
  const rows = new Map<
    Knob,
    {
      box: HTMLInputElement;
      range: HTMLInputElement;
      val: HTMLElement;
      mark: HTMLElement;
      hint: HTMLElement;
      row: HTMLElement;
    }
  >();
  const ending = $('dl-ending') as HTMLSelectElement;
  const words = $('dl-words') as HTMLTextAreaElement;

  const fmt = (k: (typeof KNOBS)[number], v: number) => v.toFixed(k.digits);
  const pct = (k: (typeof KNOBS)[number], v: number) =>
    Math.min(Math.max(((v - k.min) / (k.max - k.min)) * 100, 0), 100);

  function touch(): void {
    touched = true;
    changed?.();
  }

  function paint(k: (typeof KNOBS)[number]): void {
    const r = rows.get(k.key);
    if (!r) return;
    const derived = auto[k.key];
    if (!r.box.checked) r.range.value = String(derived);
    r.row.classList.toggle('auto', !r.box.checked);
    // 自動のあいだは導出値そのものを見せる——スライダーは刻み（step）に丸めるので、
    // その値を出すと「自動なのに導出値と違う数字」になる。
    r.val.textContent = fmt(k, r.box.checked ? Number(r.range.value) : derived);
    r.mark.style.left = `${pct(k, derived)}%`;
    r.mark.title = `自動 ${fmt(k, derived)}`;
  }

  const host = $('delivery-panel');
  host.replaceChildren();
  for (const k of KNOBS) {
    const row = document.createElement('div');
    row.className = 'dl-row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.title = 'この行だけ上書きする';
    const label = document.createElement('label');
    label.textContent = k.label;
    const track = document.createElement('div');
    track.className = 'dl-track';
    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(k.min);
    range.max = String(k.max);
    range.step = String(k.step);
    const mark = document.createElement('span');
    mark.className = 'dl-mark';
    mark.textContent = '◆';
    track.append(range, mark);
    const val = document.createElement('span');
    val.className = 'dl-val';
    const hint = document.createElement('div');
    hint.className = 'dl-hint';
    row.append(box, label, track, val, hint);
    host.append(row);
    rows.set(k.key, { box, range, val, mark, hint, row });

    box.addEventListener('change', () => {
      paint(k);
      touch();
    });
    // 動かしたら、それは上書きしたいということ。
    range.addEventListener('input', () => {
      box.checked = true;
      paint(k);
      touch();
    });
  }
  ending.addEventListener('change', touch);
  words.addEventListener('input', touch);

  return {
    refresh(styleWeights, text) {
      auto = derivedDelivery(styleWeights, shared.intonationFallback);
      for (const k of KNOBS) paint(k);
      const stretch = rows.get('stretchSec');
      if (stretch)
        stretch.hint.textContent = wantsStretch(text) ? '' : 'この行には 〜 が無いので効きません';
      const clip = rows.get('clipSec');
      if (clip)
        clip.hint.textContent = hasClippedWord(text)
          ? ''
          : 'この行には語末の っ が無いので効きません';
    },
    load(d) {
      touched = false;
      for (const k of KNOBS) {
        const r = rows.get(k.key);
        if (!r) continue;
        const v = d?.[k.key];
        r.box.checked = v !== undefined;
        if (v !== undefined) r.range.value = String(v);
        paint(k);
      }
      ending.value = d?.ending ?? '';
      words.value = d?.words ? JSON.stringify(d.words) : '';
    },
    read(original) {
      if (!touched) return original;
      const out: Record<string, unknown> = {};
      for (const k of KNOBS) {
        const r = rows.get(k.key);
        if (r?.box.checked) out[k.key] = Number(Number(r.range.value).toFixed(k.digits));
      }
      if (ending.value) out.ending = ending.value;
      const raw = words.value.trim();
      if (raw) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          throw new Error(`words が JSON として読めません: ${e instanceof Error ? e.message : e}`);
        }
        if (!Array.isArray(parsed)) throw new Error('words は配列で書いてください');
        out.words = parsed;
      }
      for (const [key, v] of Object.entries(original ?? {})) if (!ORDER.includes(key)) out[key] = v;
      return Object.keys(out).length ? (out as Delivery) : undefined;
    },
    onChange(fn) {
      changed = fn;
    },
  };
}
