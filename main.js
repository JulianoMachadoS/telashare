const { app, BrowserWindow, session, desktopCapturer, ipcMain } = require('electron');
const path = require('path');

let win;
let chosenSourceId = null;
let chosenWithAudio = true;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1e1f22',
    autoHideMenuBar: true,
    title: 'TelaShare',
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

  createWindow();
});

app.on('window-all-closed', () => app.quit());
