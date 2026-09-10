import { contextBridge, ipcRenderer } from 'electron';
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
} from '../shared/types';

// Bridge for the Cue editor renderer (editor.ts). Mirrors preload.ts's shape
// but exposes editor-only, file-mutating operations under window.uiEditor.
contextBridge.exposeInMainWorld('uiEditor', {
  getInit: (): Promise<{ psdAvailable: boolean; lipSync: LipSyncConfig | null }> =>
    ipcRenderer.invoke('editor:get-init'),
  readPsd: (): Promise<Uint8Array | null> => ipcRenderer.invoke('editor:read-psd'),
  listCues: (): Promise<EditorCueListItem[]> => ipcRenderer.invoke('editor:list-cues'),
  readCue: (name: string): Promise<Cue | null> => ipcRenderer.invoke('editor:read-cue', name),
  readDefault: (): Promise<Cue> => ipcRenderer.invoke('editor:read-default'),
  writeCue: (name: string, cue: Cue): Promise<EditorWriteResult> =>
    ipcRenderer.invoke('editor:write-cue', name, cue),
  deleteCue: (name: string): Promise<EditorWriteResult> =>
    ipcRenderer.invoke('editor:delete-cue', name),
  listStyles: (): Promise<EditorStyles | null> => ipcRenderer.invoke('editor:list-styles'),
  synthesize: (
    text: string,
    voice: Cue['voice'],
    delivery?: Delivery,
    reading?: string,
  ): Promise<TtsAudio | null> =>
    ipcRenderer.invoke('editor:synthesize', text, voice, delivery, reading),
  listSequences: (): Promise<EditorSequenceListItem[]> =>
    ipcRenderer.invoke('editor:list-sequences'),
  readSequence: (rel: string): Promise<CueSequence | null> =>
    ipcRenderer.invoke('editor:read-sequence', rel),
  writeSequence: (rel: string, seq: Omit<CueSequence, 'name'>): Promise<EditorWriteResult> =>
    ipcRenderer.invoke('editor:write-sequence', rel, seq),
  deleteSequence: (rel: string): Promise<EditorWriteResult> =>
    ipcRenderer.invoke('editor:delete-sequence', rel),
  eventSettings: (): Promise<Record<string, EventCueGroup>> =>
    ipcRenderer.invoke('editor:event-settings'),
});
