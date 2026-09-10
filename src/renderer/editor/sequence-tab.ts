import type {
  CueSequence,
  Delivery,
  EditorSequenceListItem,
  EventCueGroup,
  Look,
  SequenceStep,
} from '../../shared/types';
import { $, setStatus } from './bridge';
import { deliveryPanel } from './delivery';
import { speak, stopSpeaking } from './speak';
import { applyLook, currentDirectives, onTreeEdit, shared } from './stage';
import { voiceSliders } from './voice';

// The three fixed-line tabs — アイドリング / イベント / つつき. They edit the same
// thing (one CueSequence file under sequences/), so it is one editor that only
// changes how its list is grouped and where a new file may go.
//
// Each step owns its look: the shared layer tree and this tab's voice sliders
// edit the selected step directly. A step with no look inherits the previous
// step's (the "引き継ぐ" box), which is how two lines share one face.

export type SequenceKind = 'idling' | 'event' | 'fidget';

type Body = Omit<CueSequence, 'name'> & Record<string, unknown>;

interface Working {
  /** sequences/ からの相対パス。null はまだ保存していない新規。 */
  rel: string | null;
  body: Body;
  step: number;
  dirty: boolean;
}

const POOLS: Record<SequenceKind, string[]> = {
  idling: ['idling', 'away', 'wake'],
  event: ['event'],
  fidget: ['poke', 'spam'],
};
const NAME_RE = /^[A-Za-z0-9_-]+$/;
const STEP_KEYS = ['look', 'text', 'reading', 'holdMs', 'delivery'];

let kind: SequenceKind = 'idling';
let items: EditorSequenceListItem[] = [];
let settings: Record<string, EventCueGroup> = {};
/** 編集中のデータはタブごとに持つ——タブを行き来しても消えない。 */
const works: Partial<Record<SequenceKind, Working>> = {};
/** 選んでいるステップの見た目を画面で触ったか。触っていなければ、保存のとき
 *  ファイルにあった look をそのまま書く（開いて保存しただけで差分が出ない）。 */
let lookTouched = false;
let playingStep: number | null = null;
let playingAll = false;
let stopRequested = false;
let holdDone: (() => void) | null = null;
const voice = voiceSliders($('seq-voice-styles'), 'seqstyle');
const delivery = deliveryPanel();

const input = (id: string) => $(id) as HTMLInputElement;
const current = (): Working | undefined => works[kind];
const steps = (): SequenceStep[] => current()?.body.steps ?? [];
const dirOf = (rel: string) => rel.slice(0, rel.lastIndexOf('/'));
const nameOf = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1, -'.json'.length);

// ---- list ----

function eventNames(): string[] {
  const fromFiles = items.flatMap((i) => (i.event ? [i.event] : []));
  return [...new Set([...Object.keys(settings), ...fromFiles])].sort();
}

function settingsSummary(event: string): string {
  const g = settings[event] ?? {};
  const parts = [`cooldown ${g.cooldownSec ?? 90}秒`, `chance ${g.chance ?? 1}`];
  if (g.throttleKey) parts.push(`throttle ${g.throttleKey}`);
  return parts.join(' / ');
}

function groups(): { label: string; note?: string; items: EditorSequenceListItem[] }[] {
  const mine = items.filter((i) => POOLS[kind].includes(i.pool));
  if (kind === 'idling') {
    return [
      { label: 'IdlingCue', items: mine.filter((i) => i.pool === 'idling') },
      {
        label: '在席（離席したとき・戻ったとき）',
        items: mine.filter((i) => i.pool === 'away' || i.pool === 'wake'),
      },
    ];
  }
  if (kind === 'fidget') {
    return [
      { label: 'つつかれたとき（poke）', items: mine.filter((i) => i.pool === 'poke') },
      { label: '何度もつつかれたとき（spam）', items: mine.filter((i) => i.pool === 'spam') },
    ];
  }
  return eventNames().map((event) => ({
    label: event,
    note: settingsSummary(event),
    items: mine.filter((i) => i.event === event),
  }));
}

/** 新規・複製で選べる置き場所。在席（away / wake）は名前が固定なので作れない。 */
function writableDirs(): { dir: string; label: string }[] {
  if (kind === 'idling') return [{ dir: 'idling', label: 'IdlingCue（idling/）' }];
  if (kind === 'fidget') {
    return [
      { dir: 'fidget/poke', label: 'poke（fidget/poke/）' },
      { dir: 'fidget/spam', label: 'spam（fidget/spam/）' },
    ];
  }
  return eventNames().map((ev) => ({ dir: `event/${ev}`, label: `${ev}（event/${ev}/）` }));
}

function gates(it: EditorSequenceListItem): string {
  const g: string[] = [];
  if (it.weight !== undefined) g.push(`w${it.weight}`);
  if (it.minAffinity !== undefined) g.push(`好感度≥${it.minAffinity}`);
  if (it.maxAffinity !== undefined) g.push(`好感度≤${it.maxAffinity}`);
  if (it.hours) g.push(`${it.hours[0]}〜${it.hours[1]}時`);
  return g.join(' ');
}

function renderList(): void {
  const host = $('seq-list');
  host.replaceChildren();
  const active = current()?.rel;
  for (const g of groups()) {
    const h = document.createElement('div');
    h.className = 'cue-group';
    h.textContent = g.label;
    if (g.note) {
      const note = document.createElement('small');
      note.textContent = g.note;
      h.append(note);
    }
    host.append(h);
    for (const it of g.items) {
      const btn = document.createElement('button');
      btn.className = `cue-item${it.rel === active ? ' active' : ''}`;
      const label = document.createElement('span');
      label.className = 'cue-label';
      label.textContent = it.firstText ?? `（無言・${it.steps}ステップ）`;
      const id = document.createElement('span');
      id.className = 'cue-id';
      id.textContent = [it.name, gates(it), it.fromHome ? '手元の版' : '']
        .filter(Boolean)
        .join('  ');
      btn.append(label, id);
      btn.title = it.rel;
      btn.addEventListener('click', () => void open(it.rel));
      host.append(btn);
    }
  }
}

async function refresh(): Promise<void> {
  items = await window.uiEditor.listSequences();
  renderList();
}

// ---- open / form ----

function confirmDiscard(): boolean {
  const w = current();
  return !w?.dirty || confirm('保存していない変更を破棄しますか？');
}

async function open(rel: string): Promise<void> {
  if (current()?.rel === rel) return;
  if (!confirmDiscard()) return;
  const seq = await window.uiEditor.readSequence(rel);
  if (!seq) {
    setStatus(`読めませんでした: ${rel}`, 'err');
    return;
  }
  works[kind] = { rel, body: seq as Body, step: 0, dirty: false };
  loadForm(0);
  setStatus(`編集中: ${rel}`);
}

function showEmpty(): void {
  $('seq-empty').hidden = false;
  $('seq-editor').hidden = true;
  $('steps-strip').hidden = true;
  ($('seq-delete') as HTMLButtonElement).disabled = true;
  applyLook({});
  renderList();
}

function loadForm(step: number): void {
  const w = current();
  if (!w) {
    showEmpty();
    return;
  }
  $('seq-empty').hidden = true;
  $('seq-editor').hidden = false;
  $('steps-strip').hidden = false;

  const dirSel = $('seq-dir') as HTMLSelectElement;
  dirSel.replaceChildren();
  const dirs = writableDirs();
  const dir = w.rel ? dirOf(w.rel) : null;
  if (dir && !dirs.some((d) => d.dir === dir)) dirs.unshift({ dir, label: dir });
  for (const d of dirs) dirSel.append(new Option(d.label, d.dir, false, d.dir === dir));
  dirSel.disabled = w.rel !== null;
  input('seq-name').value = w.rel ? nameOf(w.rel) : '';
  input('seq-name').readOnly = w.rel !== null;
  const item = items.find((i) => i.rel === w.rel);
  $('seq-origin').textContent = w.rel
    ? `${w.rel}（${item?.fromHome ? '手元の版' : '同梱の版'}）`
    : '未保存の新規';
  showEventSettings();
  ($('seq-delete') as HTMLButtonElement).disabled = w.rel === null;

  for (const [id, key] of META)
    input(id).value = w.body[key] === undefined ? '' : String(w.body[key]);
  input('seq-hour-from').value = w.body.hours ? String(w.body.hours[0]) : '';
  input('seq-hour-to').value = w.body.hours ? String(w.body.hours[1]) : '';
  markSaved(!w.dirty);
  loadStep(Math.min(step, steps().length - 1));
  renderList();
}

function showEventSettings(): void {
  const dir = ($('seq-dir') as HTMLSelectElement).value;
  $('seq-event-settings').textContent = dir.startsWith('event/')
    ? `出し方（ui-chan.config.json）: ${settingsSummary(dir.slice('event/'.length))}`
    : '';
}

const META = [
  ['seq-weight', 'weight'],
  ['seq-min', 'minAffinity'],
  ['seq-max', 'maxAffinity'],
] as const;

function flushMeta(): void {
  const w = current();
  if (!w) return;
  for (const [id, key] of META) {
    const v = input(id).value.trim();
    if (v === '') delete w.body[key];
    else w.body[key] = Number(v);
  }
  const from = input('seq-hour-from').value.trim();
  const to = input('seq-hour-to').value.trim();
  if (from !== '' && to !== '') w.body.hours = [Number(from), Number(to)];
  else delete w.body.hours;
}

// ---- steps ----

/** そのステップが実際に着る見た目：自前の look か、さかのぼって最初に見つかる
 *  look。どこにも無ければ default（{}）。 */
function effectiveLook(i: number): Look {
  for (let j = i; j >= 0; j--) {
    const look = steps()[j]?.look;
    if (look) return look;
  }
  return {};
}

function showLook(look: Look): void {
  applyLook(look);
  input('step-blink').checked = look.blink ?? shared.defaultCue.blink ?? false;
  voice.load(look.voice);
}

function loadStep(i: number): void {
  const w = current();
  if (!w) return;
  w.step = i;
  const st = steps()[i];
  lookTouched = false;
  showLook(effectiveLook(i));
  input('step-inherit').checked = !st.look;
  input('step-text').value = st.text ?? '';
  input('step-reading').value = st.reading ?? '';
  input('step-hold').value = st.holdMs === undefined ? '' : String(st.holdMs);
  refreshDerived();
  delivery.load(st.delivery);
  $('step-title').textContent = `ステップ ${i + 1} / ${steps().length}`;
  renderSteps();
}

/** 演技パネルの「自動」の値を、いま画面にある声色とセリフで計算し直す。 */
function refreshDerived(): void {
  delivery.refresh(voice.read()?.style_weights, input('step-text').value);
}

function lookFromScreen(): Look {
  const look: Look = {};
  const { select = [], show = [], hide = [] } = currentDirectives();
  if (select.length) look.select = select;
  if (show.length) look.show = show;
  if (hide.length) look.hide = hide;
  const blink = input('step-blink').checked;
  if (blink !== (shared.defaultCue.blink ?? false)) look.blink = blink;
  const v = voice.read();
  if (v) look.voice = v;
  return look;
}

/** 画面のステップをデータへ書き戻す。キーの順番（look, text, reading, holdMs,
 *  delivery, そのほか）は移行時と同じに揃え、$comment などの知らないキーは残す。
 *  delivery の JSON が読めなければ何も書かずに false。 */
function flushStep(): boolean {
  const w = current();
  const st = steps()[w?.step ?? -1];
  if (!w || !st) return true;
  const next: SequenceStep & Record<string, unknown> = {};
  if (!input('step-inherit').checked)
    next.look = lookTouched || !st.look ? lookFromScreen() : st.look;
  const text = input('step-text').value;
  if (text.trim()) next.text = text;
  const reading = input('step-reading').value;
  if (reading.trim()) next.reading = reading;
  const hold = input('step-hold').value.trim();
  if (hold) next.holdMs = Number(hold);
  let d: Delivery | undefined;
  try {
    d = delivery.read(st.delivery);
  } catch (e) {
    setStatus(`ステップ ${w.step + 1}: ${e instanceof Error ? e.message : e}`, 'err');
    return false;
  }
  if (d) next.delivery = d;
  for (const [k, v] of Object.entries(st)) if (!STEP_KEYS.includes(k)) next[k] = v;
  steps()[w.step] = next;
  return true;
}

function renderSteps(): void {
  const host = $('steps-list');
  host.replaceChildren();
  const w = current();
  steps().forEach((st, i) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `step-card${i === w?.step ? ' active' : ''}${i === playingStep ? ' playing' : ''}`;
    const no = document.createElement('span');
    no.className = 'step-no';
    no.textContent = `${i + 1}${st.look ? '' : '  ↪ 引き継ぎ'}`;
    const text = document.createElement('span');
    text.className = 'step-text';
    text.textContent = st.text ?? `（無言 ${st.holdMs ?? 2000}ms）`;
    card.append(no, text);
    card.addEventListener('click', () => selectStep(i));
    host.append(card);
  });
}

function selectStep(i: number): void {
  const w = current();
  if (!w || i === w.step || playingAll) return;
  if (!flushStep()) return;
  loadStep(i);
}

function markSaved(saved: boolean): void {
  $('seq-save').classList.toggle('dirty', !saved);
}

function markDirty(): void {
  const w = current();
  if (!w) return;
  w.dirty = true;
  markSaved(false);
}

/** 見た目か声を画面で触った。引き継ぎ中だったなら、そのステップ自前の look に
 *  切り替わる（見えているものをそのまま自分の見た目にする）。 */
function lookChanged(): void {
  if (!current()) return;
  lookTouched = true;
  input('step-inherit').checked = false;
  refreshDerived();
  markDirty();
}

function inheritToggled(): void {
  const w = current();
  if (!w) return;
  if (input('step-inherit').checked) {
    // 直前までの見た目を映す（自分の look は保存時に消える）。
    showLook(w.step > 0 ? effectiveLook(w.step - 1) : {});
    refreshDerived();
    lookTouched = false;
  } else {
    lookTouched = true; // 見えている見た目を、このステップ自前の look にする
  }
  markDirty();
}

function addStep(): void {
  const w = current();
  if (!w || !flushStep()) return;
  steps().splice(w.step + 1, 0, {});
  markDirty();
  loadStep(w.step + 1);
}

function removeStep(): void {
  const w = current();
  if (!w) return;
  if (steps().length <= 1) {
    setStatus('ステップは最低1つ要ります', 'err');
    return;
  }
  steps().splice(w.step, 1);
  markDirty();
  loadStep(Math.min(w.step, steps().length - 1));
}

function moveStep(delta: number): void {
  const w = current();
  if (!w || !flushStep()) return;
  const to = w.step + delta;
  if (to < 0 || to >= steps().length) return;
  const list = steps();
  [list[w.step], list[to]] = [list[to], list[w.step]];
  markDirty();
  loadStep(to);
}

// ---- playback ----

/** 1ステップを本番と同じ順で見せる：見た目を着て、セリフがあれば喋り終える
 *  まで、無ければ holdMs だけ待つ。 */
async function playStep(i: number): Promise<boolean> {
  const st = steps()[i];
  const look = effectiveLook(i);
  playingStep = i;
  renderSteps();
  applyLook(look);
  if (st.text) {
    const ok = await speak(st.text, look.voice, { delivery: st.delivery, reading: st.reading });
    if (!ok) {
      setStatus('TTSを利用できません（.env の資格情報やエンジン起動を確認）', 'err');
      return false;
    }
  } else {
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, st.holdMs ?? 2000);
      holdDone = () => {
        window.clearTimeout(timer);
        resolve();
      };
    });
    holdDone = null;
  }
  return true;
}

function finishPlayback(back: number): void {
  playingStep = null;
  playingAll = false;
  $('seq-play-all').textContent = '▶ 全部再生';
  loadStep(back);
}

async function playThis(): Promise<void> {
  const w = current();
  if (!w || playingAll || !flushStep()) return;
  const back = w.step;
  setStatus('再生中');
  if (await playStep(back)) setStatus('');
  finishPlayback(back);
}

async function playAll(): Promise<void> {
  const w = current();
  if (!w) return;
  if (playingAll) {
    stopPlayback();
    return;
  }
  if (!flushStep()) return;
  const back = w.step;
  playingAll = true;
  stopRequested = false;
  $('seq-play-all').textContent = '■ 止める';
  for (let i = 0; i < steps().length && !stopRequested; i++) {
    setStatus(`再生中 ${i + 1} / ${steps().length}`);
    if (!(await playStep(i))) break;
  }
  if (!stopRequested) setStatus('');
  finishPlayback(back);
}

function stopPlayback(): void {
  stopRequested = true;
  stopSpeaking();
  holdDone?.();
}

// ---- new / duplicate / delete / save ----

function newSequence(): void {
  if (!confirmDiscard()) return;
  works[kind] = { rel: null, body: { steps: [{ look: {} }] }, step: 0, dirty: true };
  loadForm(0);
  input('seq-name').focus();
  setStatus('新規：置き場所と名前を決めて保存');
}

function duplicate(): void {
  const w = current();
  if (!w || !flushStep()) return;
  flushMeta();
  const src = w.rel ? nameOf(w.rel) : '';
  works[kind] = { rel: null, body: structuredClone(w.body), step: w.step, dirty: true };
  loadForm(w.step);
  input('seq-name').value = src ? `${src}_copy` : '';
  input('seq-name').focus();
  input('seq-name').select();
  setStatus(src ? `"${src}" を複製。名前を付けて保存` : '複製: 名前を付けて保存');
}

async function del(): Promise<void> {
  const w = current();
  if (!w?.rel) return;
  if (!confirm(`${w.rel} を削除しますか？`)) return;
  const res = await window.uiEditor.deleteSequence(w.rel);
  if (!res.ok) {
    setStatus(res.error, 'err');
    return;
  }
  delete works[kind];
  await refresh();
  showEmpty();
  setStatus('削除しました', 'ok');
}

async function save(): Promise<void> {
  const w = current();
  if (!w || !flushStep()) return;
  flushMeta();
  let rel = w.rel;
  if (!rel) {
    const name = input('seq-name').value.trim();
    const dir = ($('seq-dir') as HTMLSelectElement).value;
    if (!NAME_RE.test(name)) {
      setStatus('名前は半角英数字・_・- で付けてください', 'err');
      return;
    }
    if (!dir) {
      setStatus('置き場所を選んでください', 'err');
      return;
    }
    rel = `${dir}/${name}.json`;
    if (items.some((i) => i.rel === rel) && !confirm(`${rel} は既にあります。上書きしますか？`))
      return;
  }
  const res = await window.uiEditor.writeSequence(rel, w.body);
  if (!res.ok) {
    setStatus(res.error, 'err');
    return;
  }
  w.rel = rel;
  w.dirty = false;
  await refresh();
  loadForm(w.step);
  setStatus(`保存しました: ${rel}`, 'ok');
}

// ---- tab lifecycle ----

/** タブに入ったとき。このタブで編集中のものがあればそれを、無ければ空の画面を出す。 */
export async function showSequenceTab(k: SequenceKind): Promise<void> {
  kind = k;
  onTreeEdit(lookChanged);
  voice.onInput(lookChanged);
  await refresh();
  if (current()) loadForm(current()?.step ?? 0);
  else showEmpty();
}

/** タブを離れるとき。画面の内容をデータへ書き戻してから離れる（編集中の
 *  データはタブごとに残る）。delivery が壊れていて書き戻せないときは離れない。 */
export function leaveSequenceTab(): boolean {
  if (playingAll || playingStep !== null) stopPlayback();
  if (current() && !flushStep()) return false;
  flushMeta();
  onTreeEdit(null);
  voice.onInput(null);
  return true;
}

export async function initSequenceTabs(): Promise<void> {
  voice.build(shared.styles);
  settings = await window.uiEditor.eventSettings();

  for (const id of [
    'step-text',
    'step-reading',
    'step-hold',
    'seq-name',
    'seq-weight',
    'seq-min',
    'seq-max',
    'seq-hour-from',
    'seq-hour-to',
  ]) {
    $(id).addEventListener('input', markDirty);
  }
  delivery.onChange(markDirty);
  $('step-text').addEventListener('input', refreshDerived);
  $('step-blink').addEventListener('change', lookChanged);
  $('step-inherit').addEventListener('change', inheritToggled);
  $('seq-dir').addEventListener('change', () => {
    showEventSettings();
    markDirty();
  });
  $('step-add').addEventListener('click', addStep);
  $('step-remove').addEventListener('click', removeStep);
  $('step-up').addEventListener('click', () => moveStep(-1));
  $('step-down').addEventListener('click', () => moveStep(1));
  $('step-play').addEventListener('click', () => void playThis());
  $('seq-play-all').addEventListener('click', () => void playAll());
  $('seq-new').addEventListener('click', newSequence);
  $('seq-duplicate').addEventListener('click', duplicate);
  $('seq-delete').addEventListener('click', () => void del());
  $('seq-save').addEventListener('click', () => void save());
}
