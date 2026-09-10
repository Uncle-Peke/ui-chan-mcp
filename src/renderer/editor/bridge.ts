import type {
  Cue,
  CueSequence,
  Delivery,
  EditorCueListItem,
  EditorSequenceListItem,
  EditorStyles,
  EditorWriteResult,
  EventCueGroup,
  LipSyncConfig,
  TtsAudio,
} from '../../shared/types';

// ---- window bridge (editor-preload.ts) ----
export interface UiEditorApi {
  getInit(): Promise<{ psdAvailable: boolean; lipSync: LipSyncConfig | null }>;
  readPsd(): Promise<Uint8Array | null>;
  listCues(): Promise<EditorCueListItem[]>;
  readCue(name: string): Promise<Cue | null>;
  readDefault(): Promise<Cue>;
  writeCue(name: string, cue: Cue): Promise<EditorWriteResult>;
  deleteCue(name: string): Promise<EditorWriteResult>;
  listStyles(): Promise<EditorStyles | null>;
  synthesize(
    text: string,
    voice: Cue['voice'],
    delivery?: Delivery,
    reading?: string,
  ): Promise<TtsAudio | null>;
  listSequences(): Promise<EditorSequenceListItem[]>;
  readSequence(rel: string): Promise<CueSequence | null>;
  writeSequence(rel: string, seq: Omit<CueSequence, 'name'>): Promise<EditorWriteResult>;
  deleteSequence(rel: string): Promise<EditorWriteResult>;
  eventSettings(): Promise<Record<string, EventCueGroup>>;
}
declare global {
  interface Window {
    uiEditor: UiEditorApi;
  }
}

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

let statusTimer: number | null = null;
export function setStatus(msg: string, kind: 'ok' | 'err' | '' = ''): void {
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
