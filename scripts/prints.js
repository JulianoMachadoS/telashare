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

'use strict';
/*
 * PRINTS DO README: abre o app em 3 janelas (Ana, Bruno e Carla) numa sala de verdade,
 * com telas simuladas, e fotografa cada situação em docs/prints/.
 *
 *   npm run prints
 *
 * As janelas abrem visíveis (só assim o Chromium desenha o vídeo). Não mexa nelas até terminar.
 * Precisa de internet (usa o servidor de sinalização público, como o app).
 * Refaça os prints sempre que o visual mudar.
 */
const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const APP = path.join(__dirname, '..');
const OUT = path.join(APP, 'docs', 'prints');
const W = 1280, H = 800;           // tamanho da janela fotografada
const PRINT_WIDTH = 1600;          // largura final da imagem (nítida em telas de alta resolução, sem pesar)

let fakeSources = [];
ipcMain.handle('copy-text', () => true);
ipcMain.handle('take-pending-invite', () => null);
ipcMain.handle('get-sources', () => fakeSources);
ipcMain.handle('select-source', () => true);
ipcMain.handle('pcaudio-start', () => ({ ok: false, error: 'prints' }));
ipcMain.handle('pcaudio-stop', () => true);
ipcMain.handle('get-version', () => require(path.join(APP, 'package.json')).version);
ipcMain.handle('open-project', () => true);
ipcMain.handle('open-license', () => true);
ipcMain.handle('open-link', () => true);
ipcMain.handle('open-chromium-licenses', () => true);
ipcMain.handle('check-update', () => ({ error: 'not-found' }));
ipcMain.handle('update-state', () => ({ mode: 'auto', status: 'latest' }));
ipcMain.handle('update-check', () => ({ mode: 'auto', status: 'latest' }));
ipcMain.handle('update-install', () => true);
ipcMain.handle('read-license', (_e, k) => {
  const files = { license: 'LICENSE', notice: 'NOTICE', peerjs: 'node_modules/peerjs/LICENSE' };
  try { return fs.readFileSync(path.join(APP, files[k]), 'utf8'); } catch { return null; }
});

app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (process.env.CI) app.commandLine.appendSwitch('no-sandbox');
app.on('window-all-closed', () => {});

const wait = ms => new Promise(r => setTimeout(r, ms));
const js = (w, c) => w.webContents.executeJavaScript(c);
async function until(fn, ms) { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch {} await wait(300); } return false; }

let n = 0;
function mk(x, y) {
  const part = 'prints' + (n++) + Math.random();
  const ses = session.fromPartition(part);
  ses.setPermissionRequestHandler((w, p, cb) => cb(true));
  ses.setPermissionCheckHandler(() => true);
  const w = new BrowserWindow({
    x, y, width: W, height: H, useContentSize: true, show: true, focusable: false,
    webPreferences: { partition: part, preload: path.join(APP, 'preload.js'), contextIsolation: true }
  });
  w.loadFile(path.join(APP, 'index.html'));
  return w;
}
async function ready(w) {
  await until(() => js(w, "!!(document.getElementById('hostBtn').onclick && typeof audioCtx !== 'undefined' && audioCtx)"), 30000);
  await js(w, "Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); 1");
  // sem o "bipe" do microfone falso tocando nas caixas de quem roda o script
  await js(w, "outVolume = 0; applyVolumes(); 1").catch(() => {});
  // os dispositivos simulados do Chromium se chamam "Fake Default ...": nomes de um PC comum
  await js(w, `for (const [id, t] of [['micSelect', 'Microfone (Headset USB)'], ['outSelect', 'Fones de ouvido (Headset USB)']]) {
    const o = document.getElementById(id).options[0]; if (o) o.textContent = t; } 1`);
}
const count = w => js(w, '[...peers.values()].filter(p => p.conn && p.conn.open).length');

// Telas simuladas (desenhos genéricos, feitos aqui mesmo)
const SCENES = {
  // um jogo de plataforma qualquer
  jogo: `(g, f) => {
    const sky = g.createLinearGradient(0, 0, 0, 720); sky.addColorStop(0, '#3b82c4'); sky.addColorStop(1, '#a5d8f3');
    g.fillStyle = sky; g.fillRect(0, 0, 1280, 720);
    g.fillStyle = '#fff8'; for (let i = 0; i < 5; i++) { const x = (i * 300 - f * 0.6) % 1500 + 100; g.beginPath(); g.ellipse(x, 110 + i * 25, 90, 28, 0, 0, 7); g.fill(); }
    g.fillStyle = '#4c9a4a'; g.beginPath(); g.moveTo(0, 560); for (let x = 0; x <= 1280; x += 40) g.lineTo(x, 520 + 40 * Math.sin((x + f * 3) / 140)); g.lineTo(1280, 720); g.lineTo(0, 720); g.fill();
    g.fillStyle = '#7a4b2a'; g.fillRect(0, 640, 1280, 80);
    for (let i = 0; i < 6; i++) { const x = (i * 260 - f * 3) % 1560 + 200; g.fillStyle = '#c98b2c'; g.fillRect(x, 430, 70, 70); g.strokeStyle = '#7a4b2a'; g.lineWidth = 4; g.strokeRect(x, 430, 70, 70); }
    const y = 560 - Math.abs(Math.sin(f / 12)) * 120; g.fillStyle = '#e4572e'; g.fillRect(380, y - 70, 54, 70); g.fillStyle = '#fff'; g.fillRect(410, y - 58, 12, 12);
    g.fillStyle = '#0008'; g.fillRect(24, 24, 330, 64); g.fillStyle = '#fff'; g.font = 'bold 30px sans-serif'; g.fillText('Fase 3   ★ ' + (120 + (f >> 3)), 44, 67);
  }`,
  // um roteiro de viagem numa página de documento
  documento: `(g, f) => {
    g.fillStyle = '#e9edf2'; g.fillRect(0, 0, 1280, 720);
    g.fillStyle = '#fff'; g.fillRect(250, 30, 780, 700);
    g.fillStyle = '#1f2937'; g.font = 'bold 40px sans-serif'; g.fillText('Roteiro da viagem', 310, 110);
    g.font = '24px sans-serif'; g.fillStyle = '#4b5563';
    const lines = ['Sexta: saída às 7h, parada para café na serra', 'Sábado: trilha da cachoeira (levar lanche)', 'Domingo: feira de artesanato e almoço', 'Dividir gasolina: 4 pessoas', 'Quem leva a caixa de som?'];
    lines.forEach((l, i) => { g.fillStyle = '#2563eb'; g.fillRect(310, 165 + i * 62, 10, 10); g.fillStyle = '#4b5563'; g.fillText(l, 340, 177 + i * 62); });
    if ((f >> 4) % 2) { g.fillStyle = '#1f2937'; g.fillRect(650, 418, 3, 30); }
    g.fillStyle = '#fde68a'; g.fillRect(310, 500, 600, 120); g.fillStyle = '#92400e'; g.font = 'italic 22px sans-serif'; g.fillText('Orçamento estimado: R$ 380 por pessoa', 340, 570);
  }`
};
const shareScene = scene => `(async () => {
  openPicker = async () => 'tela-falsa';
  shareAudioChk.checked = false;
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d'); const draw = ${SCENES[scene]}; let f = 0;
    draw(g, 0); setInterval(() => draw(g, ++f), 33);
    return c.captureStream(30);
  };
  await startShare();
  return !!screenStream;
})()`;
// miniatura de uma cena, para a janela "Escolha o que compartilhar"
const thumbOf = scene => `(() => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720; (${SCENES[scene]})(c.getContext('2d'), 40);
  const t = document.createElement('canvas'); t.width = 320; t.height = 180; t.getContext('2d').drawImage(c, 0, 0, 320, 180); return t.toDataURL('image/png'); })()`;
const blankThumb = (bg, fg) => `(() => { const t = document.createElement('canvas'); t.width = 320; t.height = 180; const g = t.getContext('2d');
  g.fillStyle = '${bg}'; g.fillRect(0, 0, 320, 180); g.fillStyle = '${fg}'; g.fillRect(20, 20, 280, 18); for (let i = 0; i < 6; i++) g.fillRect(20, 54 + i * 18, 120 + (i * 37) % 160, 8); return t.toDataURL('image/png'); })()`;

const clean = w => js(w, "document.getElementById('toasts').innerHTML = ''; 1");
async function shot(w, name) {
  await clean(w); await wait(400);
  let img = await w.webContents.capturePage();
  if (img.getSize().width !== PRINT_WIDTH) img = img.resize({ width: PRINT_WIDTH, quality: 'best' });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, img.toPNG());
  console.log(`  📸 ${path.relative(APP, file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('TelaShare: gerando os prints do README (não mexa nas janelas)');
  const room = 'noite-de-jogo';
  const A = mk(40, 40), B = mk(80, 80), C = mk(120, 120);
  try {
    for (const w of [A, B, C]) await ready(w);

    // 1. Tela inicial
    await js(B, `nameInput.value = 'Bruno'; roomInput.value = '${room}'; 1`);
    await shot(B, '01-inicio.png');

    // todos entram na sala (código único por execução, mostrado como "noite-de-jogo")
    const real = room + '-' + Math.random().toString(36).slice(2, 6);
    await js(A, `nameInput.value = 'Ana'; roomInput.value = '${real}'; hostBtn.click(); 1`);
    await until(() => js(A, '!!(peer && peer.open)'), 20000);
    await js(B, `roomInput.value = '${real}'; joinBtn.click(); 1`);
    await js(C, `nameInput.value = 'Carla'; roomInput.value = '${real}'; joinBtn.click(); 1`);
    if (!(await until(async () => (await count(A)) === 2 && (await count(B)) === 2 && (await count(C)) === 2, 45000))) throw new Error('as 3 janelas não se conectaram');
    for (const w of [A, B, C]) await js(w, `roomName.textContent = '${room}'; 1`);

    // 2. Bruno assistindo a tela da Ana
    if (!(await js(A, shareScene('jogo')))) throw new Error('Ana não conseguiu compartilhar');
    const tileOk = (w, k) => until(() => js(w, `[...document.querySelectorAll('.tile video')].filter(v => v.videoWidth > 0).length >= ${k}`), 30000);
    if (!(await tileOk(B, 1))) throw new Error('Bruno não recebeu a tela da Ana');
    await wait(6000); // qualidade da conexão e nomes estabilizam
    await shot(B, '02-sala-tela.png');
    // a lista de participantes fica no fim da barra lateral
    await js(B, "document.getElementById('sidebar').scrollTop = 1e6; 1"); await wait(500);
    await shot(B, '03-participantes.png');
    await js(B, "document.getElementById('sidebar').scrollTop = 0; 1");

    // 3. Duas telas: Ana em destaque, Carla pequena
    if (!(await js(C, shareScene('documento')))) throw new Error('Carla não conseguiu compartilhar');
    if (!(await tileOk(B, 2))) throw new Error('Bruno não recebeu a tela da Carla');
    const anaId = await js(A, 'peer.id');
    await js(B, `toggleFocus('${anaId}'); 1`);
    await wait(3000);
    await shot(B, '04-foco.png');

    // 4. Mini barra (barra lateral escondida, Ctrl+B)
    await js(B, 'setSidebarHidden(true); 1'); await wait(800);
    await shot(B, '05-mini-barra.png');
    await js(B, 'setSidebarHidden(false); 1');

    // 5. Escolher o que compartilhar
    fakeSources = [
      { id: 's1', name: 'Tela inteira', thumb: await js(B, thumbOf('jogo')) },
      { id: 's2', name: 'Jogo de plataforma', thumb: await js(B, thumbOf('jogo')) },
      { id: 's3', name: 'Roteiro da viagem - Editor de texto', thumb: await js(B, thumbOf('documento')) },
      { id: 's4', name: 'Navegador', thumb: await js(B, blankThumb('#f8fafc', '#94a3b8')) },
      { id: 's5', name: 'Terminal', thumb: await js(B, blankThumb('#111827', '#4ade80')) },
      { id: 's6', name: 'Bloco de notas', thumb: await js(B, blankThumb('#fffbeb', '#d97706')) }
    ];
    await js(B, "window.native.getSources().then(() => {}); openPicker().then(() => {}); 1");
    await wait(1500);
    await shot(B, '06-escolher-tela.png');
    await js(B, "document.getElementById('pickerCancel').click(); 1");

    // 6. Sobre o app
    await js(B, 'openAbout(); 1'); await wait(1200);
    await shot(B, '07-sobre.png');
    console.log('Pronto.');
  } catch (e) {
    console.log('❌ ' + e.message);
    process.exitCode = 1;
  }
  for (const w of [A, B, C]) { try { await js(w, 'leaveRoom && leaveRoom(); 1'); } catch {} }
  await wait(500);
  app.exit(process.exitCode || 0);
});
