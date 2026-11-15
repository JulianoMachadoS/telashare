const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  getSources: () => ipcRenderer.invoke('get-sources'),
  selectSource: (id, withAudio) => ipcRenderer.invoke('select-source', id, withAudio),
  platform: process.platform
});
