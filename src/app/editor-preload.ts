import { contextBridge, ipcRenderer } from 'electron';
import type {
  Cue,
  EditorCueListItem,
  EditorStyles,
  EditorWriteResult,
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
  cueRefs: (name: string): Promise<string[]> => ipcRenderer.invoke('editor:cue-refs', name),
  listStyles: (): Promise<EditorStyles | null> => ipcRenderer.invoke('editor:list-styles'),
  synthesize: (text: string, voice: Cue['voice']): Promise<TtsAudio | null> =>
    ipcRenderer.invoke('editor:synthesize', text, voice),
});
