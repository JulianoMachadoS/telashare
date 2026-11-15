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

const { app, BrowserWindow, session, desktopCapturer, ipcMain, clipboard, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');

// Mostra os IPs locais reais nas conexões WebRTC (em vez de nomes .local ocultos).
// Necessário para conectar via VPN (Radmin/Tailscale/ZeroTier) e rede local.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

const PROTOCOL = 'telashare';
const PROJECT_URL = 'https://github.com/JulianoMachadoS/telashare';
const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';
// Endereços que a janela "Sobre" pode abrir no navegador (nada fora desta lista)
const EXTERNAL_LINKS = {
  project: PROJECT_URL,
  issues: PROJECT_URL + '/issues',
  releases: PROJECT_URL + '/releases',
  license: LICENSE_URL,
  peerjs: 'https://github.com/peers/peerjs',
  electron: 'https://github.com/electron/electron',
  chromium: 'https://www.chromium.org/'
};
// Textos de licença que a janela "Sobre" pode mostrar
const LICENSE_FILES = {
  license: () => path.join(__dirname, 'LICENSE'),
  notice: () => path.join(__dirname, 'NOTICE'),
  peerjs: () => path.join(__dirname, 'node_modules', 'peerjs', 'LICENSE'),
  // vêm junto com o Electron, ao lado do executável
  electron: () => path.join(path.dirname(process.execPath), 'LICENSE.electron.txt')
};
let win;
let chosenSourceId = null;
let chosenWithAudio = true;
let pendingInvite = null;

// ---------- link de convite: telashare://sala/<codigo> ----------
function findInvite(argv) {
  const url = (argv || []).find(a => typeof a === 'string' && a.toLowerCase().startsWith(PROTOCOL + '://'));
  if (!url) return null;
  const m = url.match(/^telashare:\/\/(?:sala\/)?([a-z0-9_-]+)/i);
  return m ? m[1].toLowerCase() : null;
}

function registerProtocol() {
  try {
    if (process.defaultApp) {
      // modo desenvolvimento (npm start)
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1] || '.')]);
    } else {
      // .exe portátil: o Electron roda de uma pasta temporária, então registramos o .exe original
      const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
      app.setAsDefaultProtocolClient(PROTOCOL, exe, []);
    }
  } catch (e) {
    console.warn('Não foi possível registrar o protocolo', e);
  }
}

function deliverInvite(room) {
  if (!room) return;
  if (win && !win.isDestroyed() && win.webContents && !win.webContents.isLoading()) {
    win.webContents.send('invite', room);
  } else {
    pendingInvite = room;
  }
}

// Só uma janela do app: se abrir pelo link com o app já aberto, entrega o convite para a janela existente
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    deliverInvite(findInvite(argv));
  });
  // macOS
  app.on('open-url', (e, url) => { e.preventDefault(); deliverInvite(findInvite([url])); });
  pendingInvite = findInvite(process.argv);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1e1f22',
    autoHideMenuBar: true,
    title: 'TelaShare',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  win.setMenu(null);
  // links nunca abrem dentro do app
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  if (!gotLock) return;
  const ses = session.defaultSession;

  // Libera microfone / câmera / tela sem perguntar
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(true));
  ses.setPermissionCheckHandler(() => true);

  // Quando a página chama getDisplayMedia, entrega a fonte escolhida no seletor
  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const source = sources.find(s => s.id === chosenSourceId) || sources[0];
      const resp = { video: source };
      // 'loopback' = captura todo o áudio do sistema (Windows)
      if (chosenWithAudio && process.platform === 'win32') resp.audio = 'loopback';
      callback(resp);
    } catch (e) {
      console.error(e);
      callback({});
    }
  });

  ipcMain.handle('get-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false
    });
    return sources
      .filter(s => s.name !== 'TelaShare')
      .map(s => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() }));
  });

  ipcMain.handle('select-source', (_e, id, withAudio) => {
    chosenSourceId = id;
    chosenWithAudio = !!withAudio;
    return true;
  });

  // Avisos legais (AGPLv3, Seção 5d): só abre os endereços fixos do projeto e da licença
  ipcMain.handle('open-project', () => shell.openExternal(PROJECT_URL));
  ipcMain.handle('open-license', () => shell.openExternal(LICENSE_URL));
  ipcMain.handle('open-link', (_e, key) => {
    if (EXTERNAL_LINKS[key]) shell.openExternal(EXTERNAL_LINKS[key]);
  });
  ipcMain.handle('read-license', (_e, key) => {
    const f = LICENSE_FILES[key];
    if (!f) return null;
    try { return fs.readFileSync(f(), 'utf8'); } catch { return null; }
  });
  // licenças do Chromium (HTML grande) abrem no navegador a partir do arquivo local
  ipcMain.handle('open-chromium-licenses', async () => {
    const f = path.join(path.dirname(process.execPath), 'LICENSES.chromium.html');
    if (fs.existsSync(f)) return shell.openPath(f);
    return shell.openExternal(EXTERNAL_LINKS.chromium);
  });
  ipcMain.handle('get-version', () => app.getVersion());

  // Aviso de nova versão: consulta a última release no GitHub (uma requisição pequena,
  // ao abrir o app e quando o usuário clica em "Verificar agora")
  ipcMain.handle('check-update', async () => {
    try {
      const r = await net.fetch('https://api.github.com/repos/JulianoMachadoS/telashare/releases/latest', {
        headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'TelaShare' }
      });
      // 404 = ainda não há release pública (ou o repositório é privado)
      if (r.status === 404) return { error: 'not-found' };
      if (!r.ok) return { error: 'http-' + r.status };
      const j = await r.json();
      return { tag: j.tag_name, url: j.html_url, published: j.published_at };
    } catch {
      return { error: 'offline' };
    }
  });

  ipcMain.handle('copy-text', (_e, text) => { clipboard.writeText(String(text)); return true; });

  // O renderer pede o convite pendente quando termina de carregar
  ipcMain.handle('take-pending-invite', () => {
    const r = pendingInvite;
    pendingInvite = null;
    return r;
  });

  registerProtocol();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
