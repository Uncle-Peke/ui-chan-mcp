import type { Cue, EditorCueListItem } from '../../shared/types';
import { $, setStatus } from './bridge';
import { speak } from './speak';
import { applyLook, currentDirectives, shared } from './stage';
import { voiceSliders } from './voice';

// The Cue tab: author one agent-facing Cue (cues/<name>.json) — its look on the
// shared layer tree, its voice on the sliders, and its catalog fields.

let cueList: EditorCueListItem[] = [];
let currentName: string | null = null; // null = unsaved / new
const voice = voiceSliders($('voice-styles'), 'style');

function loadCueIntoForm(name: string, cue: Cue): void {
  currentName = name;
  applyLook(cue);
  ($('cue-name') as HTMLInputElement).value = name;
  ($('label') as HTMLInputElement).value = cue.label ?? '';
  ($('description') as HTMLInputElement).value = cue.description ?? '';
  ($('blink') as HTMLInputElement).checked = cue.blink ?? shared.defaultCue.blink ?? false;
  ($('internal') as HTMLInputElement).checked = cue.internal ?? false;
  voice.load(cue.voice);
  ($('delete') as HTMLButtonElement).disabled = false;
  setStatus(`編集中: ${name}`);
}

function newCue(): void {
  currentName = null;
  applyLook({}); // default look
  ($('cue-name') as HTMLInputElement).value = '';
  ($('label') as HTMLInputElement).value = '';
  ($('description') as HTMLInputElement).value = '';
  ($('blink') as HTMLInputElement).checked = shared.defaultCue.blink ?? false;
  ($('internal') as HTMLInputElement).checked = false;
  voice.load(undefined);
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
  const { select = [], show = [], hide = [] } = currentDirectives();
  if (select.length) cue.select = select;
  if (show.length) cue.show = show;
  if (hide.length) cue.hide = hide;
  const blink = ($('blink') as HTMLInputElement).checked;
  if (blink !== (shared.defaultCue.blink ?? false)) cue.blink = blink;
  const v = voice.read();
  if (v) cue.voice = v;
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
  // 固定セリフ（sequences/）は見た目を自前で持つので、Cue を消しても壊れない。
  if (!confirm(`${currentName} を削除しますか？`)) return;
  const res = await window.uiEditor.deleteCue(currentName);
  if (!res.ok) {
    setStatus(res.error, 'err');
    return;
  }
  await refreshCueList();
  newCue();
  setStatus(`削除しました`, 'ok');
}

async function testSpeak(): Promise<void> {
  const text = ($('test-text') as HTMLInputElement).value.trim();
  if (!text) {
    setStatus('試し喋りするセリフを入力してください', 'err');
    return;
  }
  setStatus('合成中…');
  const ok = await speak(text, voice.read(), { onStart: () => setStatus('再生中') });
  if (!ok) setStatus('TTSを利用できません（.env の資格情報やエンジン起動を確認）', 'err');
}

export async function initCueTab(): Promise<void> {
  voice.build(shared.styles);
  await refreshCueList();
  newCue();

  $('new').addEventListener('click', newCue);
  $('duplicate').addEventListener('click', duplicate);
  $('save').addEventListener('click', save);
  $('delete').addEventListener('click', del);
  $('test-speak').addEventListener('click', testSpeak);
  $('show-internal').addEventListener('change', renderCueList);
}
