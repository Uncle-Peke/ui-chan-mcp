import { $, setStatus } from './editor/bridge';
import { initCueTab } from './editor/cue-tab';
import {
  initSequenceTabs,
  leaveSequenceTab,
  type SequenceKind,
  showSequenceTab,
} from './editor/sequence-tab';
import { stopSpeaking } from './editor/speak';
import { buildTree, onTreeEdit, shared, stage } from './editor/stage';
import type { LNode } from './psd-stage';

// 雨衣ちゃんのデバッグルーム — entry point. Loads the PSD and the `default` look
// once (every tab edits looks as a diff against it), then hands off to the tabs:
// Cue (agent-facing, cues/) and the three kinds of fixed lines (sequences/).

type Tab = 'cue' | SequenceKind;
let currentTab: Tab = 'cue';
/** The Cue tab's state *is* the live tree (it has no working copy of its own),
 *  so leaving it snapshots the tree and coming back restores it. */
let cueLook: Map<LNode, boolean> | null = null;

async function switchTab(next: Tab): Promise<void> {
  if (next === currentTab) return;
  if (currentTab !== 'cue' && !leaveSequenceTab()) return;
  stopSpeaking();
  if (currentTab === 'cue') cueLook = stage.snapshotVisibility();
  currentTab = next;

  for (const tab of document.querySelectorAll<HTMLButtonElement>('#tabs .tab')) {
    tab.classList.toggle('active', tab.dataset.tab === next);
  }
  const isCue = next === 'cue';
  $('cue-list-section').hidden = !isCue;
  $('cue-form').hidden = !isCue;
  $('seq-list-section').hidden = isCue;
  $('seq-form').hidden = isCue;
  if (isCue) {
    $('steps-strip').hidden = true;
    onTreeEdit(null);
    if (cueLook) {
      stage.restoreVisibility(cueLook);
      buildTree();
    }
    setStatus('');
  } else {
    await showSequenceTab(next);
  }
}

async function init(): Promise<void> {
  const initData = await window.uiEditor.getInit();
  shared.lipConfig = initData.lipSync;
  shared.intonationFallback = initData.intonationFallback;
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

  shared.defaultCue = await window.uiEditor.readDefault();
  stage.applyDirectives(shared.defaultCue);
  shared.baseline = stage.snapshotVisibility();
  stage.draw();
  // プレビューの枠が変わったら描き直す——窓のリサイズだけでなく、下のステップ
  // 列が出入りしたときも。描き直さないと、canvas が引き伸ばされて見える。
  new ResizeObserver(() => stage.draw()).observe($('preview-wrap'));

  shared.styles = await window.uiEditor.listStyles();
  await initCueTab();
  await initSequenceTabs();
  for (const tab of document.querySelectorAll<HTMLButtonElement>('#tabs .tab')) {
    tab.addEventListener('click', () => void switchTab(tab.dataset.tab as Tab));
  }
}

init().catch((e) => setStatus(String(e), 'err'));
