import { setStatus } from './editor/bridge';
import { initCueTab } from './editor/cue-tab';
import { shared, stage } from './editor/stage';

// 雨衣ちゃんのデバッグルーム — entry point. Loads the PSD and the `default` look
// once (every tab edits looks as a diff against it), then hands off to the tabs.

async function init(): Promise<void> {
  const initData = await window.uiEditor.getInit();
  shared.lipConfig = initData.lipSync;
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
  window.addEventListener('resize', () => stage.draw());

  shared.styles = await window.uiEditor.listStyles();
  await initCueTab();
}

init().catch((e) => setStatus(String(e), 'err'));
