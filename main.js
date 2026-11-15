const { app, BrowserWindow, session, desktopCapturer, ipcMain, clipboard } = require('electron');
const path = require('path');

// Mostra os IPs locais reais nas conexões WebRTC (em vez de nomes .local ocultos).
// Necessário para conectar via VPN (Radmin/Tailscale/ZeroTier) e rede local.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

const PROTOCOL = 'telashare';
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
