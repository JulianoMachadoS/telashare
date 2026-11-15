/*
 * TelaShare - Compartilhamento de tela e áudio P2P
 * Projeto original: https://github.com/JulianoMachadoS/telashare
 * Copyright (C) 2026 Juliano Machado da Silva
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see https://www.gnu.org/licenses/.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  getSources: () => ipcRenderer.invoke('get-sources'),
  selectSource: (id, withAudio) => ipcRenderer.invoke('select-source', id, withAudio),
  copyText: text => ipcRenderer.invoke('copy-text', text),
  openProject: () => ipcRenderer.invoke('open-project'),
  openLicense: () => ipcRenderer.invoke('open-license'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  openLink: key => ipcRenderer.invoke('open-link', key),
  readLicense: key => ipcRenderer.invoke('read-license', key),
  openChromiumLicenses: () => ipcRenderer.invoke('open-chromium-licenses'),
  takePendingInvite: () => ipcRenderer.invoke('take-pending-invite'),
  onInvite: cb => ipcRenderer.on('invite', (_e, room) => cb(room)),
  platform: process.platform
});
