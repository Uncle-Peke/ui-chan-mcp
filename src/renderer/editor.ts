import type {
  Cue,
  EditorCueListItem,
  EditorStyles,
  LipSyncConfig,
  TtsAudio,
} from '../shared/types';
import { type LNode, PsdStage } from './psd-stage';

// ---- window bridge (editor-preload.ts) ----
interface UiEditorApi {
  getInit(): Promise<{ psdAvailable: boolean; lipSync: LipSyncConfig | null }>;
  readPsd(): Promise<Uint8Array | null>;
  listCues(): Promise<EditorCueListItem[]>;
  readCue(name: string): Promise<Cue | null>;
  readDefault(): Promise<Cue>;
  writeCue(name: string, cue: Cue): Promise<{ ok: true } | { ok: false; error: string }>;
  deleteCue(name: string): Promise<{ ok: true } | { ok: false; error: string }>;
  cueRefs(name: string): Promise<string[]>;
  listStyles(): Promise<EditorStyles | null>;
  synthesize(text: string, voice: Cue['voice']): Promise<TtsAudio | null>;
}
declare global {
  interface Window {
    uiEditor: UiEditorApi;
  }
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const canvas = $('canvas') as HTMLCanvasElement;
const stage = new PsdStage(canvas);

// The default look, captured once as the diff baseline. Every saved Cue is the
// delta between the live tree and this baseline (mirrors composeDirectives).
let defaultCue: Cue = {};
let baseline: Map<LNode, boolean> = new Map();
let styles: EditorStyles | null = null;
let cueList: EditorCueListItem[] = [];
let currentName: string | null = null; // null = unsaved / new
let lipConfig: LipSyncConfig | null = null;
const LIP_MOUTH_FOLDER = '!口';
// Voice preserved verbatim when the TTS engine is unreachable (no sliders to
// rebuild it from) so editing a cue's look never silently drops its voice.
let preservedVoice: Cue['voice'];

let statusTimer: number | null = null;
function setStatus(msg: string, kind: 'ok' | 'err' | '' = ''): void {
  const el = $('status');
  el.textContent = msg;
  el.className = kind;
  if (statusTimer !== null) window.clearTimeout(statusTimer);
  statusTimer = null;
  // Transient success toasts (保存しました / 削除しました …) fade after a few
  // seconds; errors and persistent state labels (編集中 / 新規Cue) stay put.
  if (kind === 'ok') {
    statusTimer = window.setTimeout(() => {
      el.textContent = '';
      el.className = '';
      statusTimer = null;
    }, 3000);
  }
}

// ---- layer tree UI ----

function buildTree(): void {
  const container = $('tree');
  container.replaceChildren();
  container.append(renderNodes(stage.root, ''));
}

/** Re-sync every tree input's checked state from the live node visibility,
 *  without tearing down the DOM (keeps folders' open/closed state). Needed
 *  because a select can cascade into other groups via a layer-name hide
 *  dependency (e.g. 腕組み → 奥の腕/*(非表示)). */
function syncTreeInputs(): void {
  for (const input of document.querySelectorAll<HTMLInputElement>('#tree input[data-path]')) {
    const chain = stage.walkPath(input.dataset.path ?? '');
    if (chain) input.checked = chain[chain.length - 1].visible;
  }
}

function renderNodes(nodes: LNode[], groupName: string): HTMLElement {
  const ul = document.createElement('div');
  ul.className = 'tree-group';
  for (const node of nodes) {
    ul.append(renderNode(node, groupName));
  }
  return ul;
}

function renderNode(node: LNode, groupName: string): HTMLElement {
  const path = stage.nodePath(node);
  const row = document.createElement('div');
  row.className = 'tree-node';

  if (node.name.startsWith('!')) {
    // Required folder: structural, collapsible, not directly toggled.
    const det = document.createElement('details');
    det.open = true;
    const sum = document.createElement('summary');
    sum.textContent = node.name;
    det.append(sum);
    if (node.children.length) det.append(renderNodes(node.children, path));
    row.append(det);
    return row;
  }

  const label = document.createElement('label');
  const input = document.createElement('input');
  input.dataset.path = path;
  input.checked = node.visible;
  if (node.name.startsWith('*')) {
    input.type = 'radio';
    input.name = `radio:${groupName}`;
    input.addEventListener('change', () => {
      stage.selectPath(path);
      stage.draw();
      syncTreeInputs();
    });
  } else {
    input.type = 'checkbox';
    input.addEventListener('change', () => {
      stage.setVisible(path, input.checked);
      stage.draw();
      syncTreeInputs();
    });
  }
  label.append(input, document.createTextNode(` ${node.name}`));
  row.append(label);
  // A radio option (or normal layer) can itself contain sub-layers/nested radios.
  if (node.children.length) row.append(renderNodes(node.children, path));
  return row;
}

// ---- voice sliders ----

function buildVoiceSliders(): void {
  const host = $('voice-styles');
  host.replaceChildren();
  if (!styles) {
    const note = document.createElement('div');
    note.className = 'muted';
    note.textContent =
      'TTSエンジンに接続できません（スタイル編集・試し喋りは無効。既存の声色は保持されます）';
    host.append(note);
    return;
  }
  styles.style_names.forEach((name) => {
    host.append(sliderRow(`style:${name}`, name, 0, 1, 0.05, 0));
  });
}

function sliderRow(
  id: string,
  labelText: string,
  min: number,
  max: number,
  step: number,
  value: number,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'slider-row';
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'range';
  input.id = id;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const out = document.createElement('span');
  out.className = 'slider-val';
  out.textContent = value.toFixed(2);
  input.addEventListener('input', () => {
    out.textContent = Number(input.value).toFixed(2);
  });
  row.append(label, input, out);
  return row;
}

function setSlider(id: string, value: number): void {
  const input = document.getElementById(id) as HTMLInputElement | null;
  if (!input) return;
  input.value = String(value);
  const out = input.parentElement?.querySelector('.slider-val');
  if (out) out.textContent = value.toFixed(2);
}

function readSlider(id: string): number {
  const input = document.getElementById(id) as HTMLInputElement | null;
  return input ? Number(input.value) : 0;
}

/** Build the voice block from the sliders, or preserve the loaded one when the
 *  engine (and thus the style sliders) is unavailable. */
function buildVoice(): Cue['voice'] {
  if (!styles) return preservedVoice;
  const style_weights: Record<string, number> = {};
  for (const name of styles.style_names) {
    const w = readSlider(`style:${name}`);
    if (w > 0) style_weights[name] = w;
  }
  const voice: NonNullable<Cue['voice']> = {};
  if (Object.keys(style_weights).length) voice.style_weights = style_weights;
  const alp = readSlider('alp');
  const huskiness = readSlider('huskiness');
  if (alp !== 0) voice.alp = alp;
  if (huskiness !== 0) voice.huskiness = huskiness;
  return Object.keys(voice).length ? voice : undefined;
}

function loadVoiceIntoSliders(voice: Cue['voice']): void {
  preservedVoice = voice;
  if (!styles) return;
  for (const name of styles.style_names) {
    setSlider(`style:${name}`, voice?.style_weights?.[name] ?? 0);
  }
  setSlider('alp', voice?.alp ?? 0);
  setSlider('huskiness', voice?.huskiness ?? 0);
}

// ---- load / new ----

/** Restore the tree to the default look, then overlay a cue's directives. */
function applyLook(cue: Cue): void {
  stage.restoreVisibility(baseline);
  stage.applyDirectives(cue);
  stage.draw();
  buildTree();
}

function loadCueIntoForm(name: string, cue: Cue): void {
  currentName = name;
  applyLook(cue);
  ($('cue-name') as HTMLInputElement).value = name;
  ($('label') as HTMLInputElement).value = cue.label ?? '';
  ($('description') as HTMLInputElement).value = cue.description ?? '';
  ($('blink') as HTMLInputElement).checked = cue.blink ?? defaultCue.blink ?? false;
  ($('internal') as HTMLInputElement).checked = cue.internal ?? false;
  loadVoiceIntoSliders(cue.voice);
  ($('delete') as HTMLButtonElement).disabled = false;
  setStatus(`編集中: ${name}`);
}

function newCue(): void {
  currentName = null;
  applyLook({}); // default look
  ($('cue-name') as HTMLInputElement).value = '';
  ($('label') as HTMLInputElement).value = '';
  ($('description') as HTMLInputElement).value = '';
  ($('blink') as HTMLInputElement).checked = defaultCue.blink ?? false;
  ($('internal') as HTMLInputElement).checked = false;
  loadVoiceIntoSliders(undefined);
  ($('delete') as HTMLButtonElement).disabled = true;
  setStatus('新規Cue');
}

/** Turn the current look/voice/fields into an unsaved copy under a new name —
 *  a fast starting point for a variant (e.g. happy → happy_copy → happy_strong).
 *  Keeps everything on screen as-is; only detaches it from the source file so a
 *  save writes a new cue instead of overwriting the original. */
function duplicate(): void {
  const src = currentName;
  currentName = null;
  const nameInput = $('cue-name') as HTMLInputElement;
  nameInput.value = src ? `${src}_copy` : '';
  ($('delete') as HTMLButtonElement).disabled = true;
  nameInput.focus();
  nameInput.select();
  setStatus(src ? `"${src}" を複製。名前を付けて保存` : '複製: 名前を付けて保存');
}

// ---- cue list ----

// Structural names (emo_/mix_/self_/sys_/pose_) group by their prefix so the
// list reads as a taxonomy, not a flat dump. Each row shows the logical label
// with the structural id underneath.
const GROUP_LABELS: Record<string, string> = {
  emo: '基本感情 (emo)',
  mix: 'ブレンド (mix)',
  self: '自己意識 (self)',
  sys: 'システム (sys)',
  pose: 'ポーズ (pose)',
  idling: '内部/Idling',
};

function renderCueList(): void {
  const host = $('cue-list');
  host.replaceChildren();
  const showInternal = ($('show-internal') as HTMLInputElement).checked;
  let lastGroup = '';
  for (const item of cueList) {
    if (item.internal && !showInternal) continue;
    const group = item.name.split('_')[0];
    if (group !== lastGroup) {
      lastGroup = group;
      const h = document.createElement('div');
      h.className = 'cue-group';
      h.textContent = GROUP_LABELS[group] ?? group;
      host.append(h);
    }
    const btn = document.createElement('button');
    btn.className = `cue-item${item.internal ? ' internal' : ''}`;
    const label = document.createElement('span');
    label.className = 'cue-label';
    label.textContent = item.label ?? item.name;
    const id = document.createElement('span');
    id.className = 'cue-id';
    id.textContent = item.name;
    btn.append(label, id);
    if (item.description) btn.title = item.description;
    btn.addEventListener('click', async () => {
      const cue = await window.uiEditor.readCue(item.name);
      if (cue) loadCueIntoForm(item.name, cue);
    });
    host.append(btn);
  }
}

async function refreshCueList(): Promise<void> {
  cueList = await window.uiEditor.listCues();
  renderCueList();
}

// ---- save / delete / test-speak ----

function buildCueFromForm(): Cue {
  const cue: Cue = {};
  const label = ($('label') as HTMLInputElement).value.trim();
  if (label) cue.label = label;
  const description = ($('description') as HTMLInputElement).value.trim();
  if (description) cue.description = description;
  const { select = [], show = [], hide = [] } = stage.diffFrom(baseline);
  if (select.length) cue.select = select;
  if (show.length) cue.show = show;
  if (hide.length) cue.hide = hide;
  const blink = ($('blink') as HTMLInputElement).checked;
  if (blink !== (defaultCue.blink ?? false)) cue.blink = blink;
  const voice = buildVoice();
  if (voice) cue.voice = voice;
  if (($('internal') as HTMLInputElement).checked) cue.internal = true;
  return cue;
}

async function save(): Promise<void> {
  const name = ($('cue-name') as HTMLInputElement).value.trim();
  if (!name) {
    setStatus('Cue名を入力してください', 'err');
    return;
  }
  const exists = cueList.some((c) => c.name === name);
  if (name !== currentName && exists && !confirm(`"${name}" は既に存在します。上書きしますか？`)) {
    return;
  }
  const cue = buildCueFromForm();
  const res = await window.uiEditor.writeCue(name, cue);
  if (!res.ok) {
    setStatus(res.error, 'err');
    return;
  }
  currentName = name;
  ($('delete') as HTMLButtonElement).disabled = false;
  await refreshCueList();
  setStatus(`保存しました: ${name}.json`, 'ok');
}

async function del(): Promise<void> {
  if (!currentName) return;
  const refs = await window.uiEditor.cueRefs(currentName);
  const warn = refs.length
    ? `\n\n⚠ このCueは次のシーケンス(IdlingCue/FidgetCue)から参照されています: ${refs.join(', ')}\n削除するとそれらが壊れます。`
    : '';
  if (!confirm(`${currentName} を削除しますか？${warn}`)) return;
  const res = await window.uiEditor.deleteCue(currentName);
  if (!res.ok) {
    setStatus(res.error, 'err');
    return;
  }
  await refreshCueList();
  newCue();
  setStatus(`削除しました`, 'ok');
}

let previewAudio: HTMLAudioElement | null = null;
let lipTimer: number | null = null;
let lipMouth: string | null = null;

/** Drive the mouth radio from the synthesized audio's phoneme timeline, in
 *  sync with playback — the same viseme mapping the mascot renderer uses, so
 *  試し喋り previews lip-sync too, not just audio. */
function setLipMouth(vowel: string): void {
  if (!lipConfig) return;
  const name = lipConfig.mouths[vowel] ?? lipConfig.mouths.n;
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

async function testSpeak(): Promise<void> {
  const text = ($('test-text') as HTMLInputElement).value.trim();
  if (!text) {
    setStatus('試し喋りするセリフを入力してください', 'err');
    return;
  }
  setStatus('合成中…');
  const audio = await window.uiEditor.synthesize(text, buildVoice());
  if (!audio) {
    setStatus('TTSを利用できません（.env の資格情報やエンジン起動を確認）', 'err');
    return;
  }
  const bytes = Uint8Array.from(atob(audio.wavBase64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  previewAudio?.pause();
  stopLip();
  // Snapshot the current look so lip-sync's mouth changes revert cleanly.
  const savedLook = stage.snapshotVisibility();
  const el = new Audio(url);
  previewAudio = el;
  const finish = (): void => {
    stopLip();
    stage.restoreVisibility(savedLook);
    stage.draw();
    URL.revokeObjectURL(url);
  };
  el.addEventListener('ended', finish);
  el.play().catch(finish);
  lipTimer = window.setInterval(() => {
    if (el.ended) return;
    const ms = el.currentTime * 1000;
    let v = 'n';
    for (const f of audio.timeline) {
      if (f.t <= ms) v = f.v;
      else break;
    }
    setLipMouth(v);
  }, lipConfig?.audioPollMs ?? 33);
  setStatus('再生中');
}

// ---- init ----

async function init(): Promise<void> {
  const initData = await window.uiEditor.getInit();
  lipConfig = initData.lipSync;
  if (!initData.psdAvailable) {
    setStatus('assets/ に .psd が見つかりません', 'err');
    return;
  }
  const buffer = await window.uiEditor.readPsd();
  if (!buffer) {
    setStatus('PSDの読み込みに失敗しました', 'err');
    return;
  }
  stage.loadPsd(buffer);

  defaultCue = await window.uiEditor.readDefault();
  stage.applyDirectives(defaultCue);
  baseline = stage.snapshotVisibility();
  stage.draw();
  window.addEventListener('resize', () => stage.draw());

  // Static alp / huskiness sliders live in the HTML host next to the styles.
  $('static-voice').append(
    sliderRow('alp', 'alp', -1, 1, 0.05, 0),
    sliderRow('huskiness', 'huskiness', -20, 20, 1, 0),
  );
  styles = await window.uiEditor.listStyles();
  buildVoiceSliders();

  await refreshCueList();
  newCue();

  $('new').addEventListener('click', newCue);
  $('duplicate').addEventListener('click', duplicate);
  $('save').addEventListener('click', save);
  $('delete').addEventListener('click', del);
  $('test-speak').addEventListener('click', testSpeak);
  $('show-internal').addEventListener('change', renderCueList);
}

init().catch((e) => setStatus(String(e), 'err'));
