import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('uiChan', {
  getInit: () => ipcRenderer.invoke('ui-chan:get-init'),
  readPsd: () => ipcRenderer.invoke('ui-chan:read-psd'),
  ready: () => ipcRenderer.send('ui-chan:ready'),
  reportWarnings: (warnings: string[]) => ipcRenderer.send('ui-chan:warnings', warnings),
  onCommand: (cb: (cmd: unknown) => void) =>
    ipcRenderer.on('ui-chan:command', (_ev, cmd) => cb(cmd)),
  interaction: (kind: string) => ipcRenderer.send('ui-chan:interaction', kind),
  panelAction: (kind: string, value?: number) =>
    ipcRenderer.invoke('ui-chan:panel-action', kind, value),
  setClickThrough: (on: boolean) => ipcRenderer.send('ui-chan:click-through', on),
  dragStart: () => ipcRenderer.send('ui-chan:drag-start'),
  dragEnd: () => ipcRenderer.send('ui-chan:drag-end'),
  reportBodyBox: (insets: { left: number; top: number; right: number; bottom: number }) =>
    ipcRenderer.send('ui-chan:body-box', insets),
});
