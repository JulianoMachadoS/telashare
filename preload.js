const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  getSources: () => ipcRenderer.invoke('get-sources'),
  selectSource: (id, withAudio) => ipcRenderer.invoke('select-source', id, withAudio),
  copyText: text => ipcRenderer.invoke('copy-text', text),
  takePendingInvite: () => ipcRenderer.invoke('take-pending-invite'),
  onInvite: cb => ipcRenderer.on('invite', (_e, room) => cb(room)),
  platform: process.platform
});
