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
 * MEDIÇÃO DE DESEMPENHO (#69): quanto o app gasta de CPU e memória em 3 cenários.
 * Serve de referência para o front novo (#68), que não pode ficar mais pesado.
 *
 *   npm run perf                  → 3 rodadas, mostra a mediana
 *   npm run perf -- --rodadas 5   → mais rodadas
 *   npm run perf -- --salvar      → grava em perf/<sistema>-<arquitetura>.json
 *
 * As janelas ficam VISÍVEIS de propósito: escondidas, o Chromium não desenha e a interface
 * pareceria mais leve do que é. Não mexa nelas enquanto mede.
 * Os números dependem do computador: compare só medições feitas na mesma máquina.
 */
const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def; };
const ROUNDS = Math.max(1, parseInt(opt('rodadas', 3), 10) || 3);
const SAVE = !!opt('salvar', false);
const WARM_MS = 8000;      // tempo para estabilizar antes de medir
const MEASURE_MS = 20000;  // janela de medição
const SAMPLE_MS = 1000;

// handlers que o main.js real registra (aqui sem efeito)
ipcMain.handle('copy-text', () => true);
ipcMain.handle('take-pending-invite', () => null);
ipcMain.handle('get-sources', () => []);
ipcMain.handle('select-source', () => true);
ipcMain.handle('pcaudio-start', () => ({ ok: false, error: 'medição' }));
ipcMain.handle('pcaudio-stop', () => true);
ipcMain.handle('get-version', () => '0.0.0-medicao');
ipcMain.handle('open-project', () => true);
ipcMain.handle('open-license', () => true);
ipcMain.handle('open-link', () => true);
ipcMain.handle('open-chromium-licenses', () => true);
ipcMain.handle('check-update', () => ({ error: 'not-found' }));
ipcMain.handle('update-state', () => ({ mode: 'manual', status: 'idle' }));
ipcMain.handle('update-check', () => ({ mode: 'manual', status: 'idle' }));
ipcMain.handle('update-install', () => true);
ipcMain.handle('read-license', () => null);

app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (process.env.CI) app.commandLine.appendSwitch('no-sandbox');
// entre um cenário e outro todas as janelas fecham: o app não pode encerrar nessa hora
app.on('window-all-closed', () => {});

const wait = ms => new Promise(r => setTimeout(r, ms));
const js = (w, c) => w.webContents.executeJavaScript(c);
async function until(fn, ms) { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch {} await wait(300); } return false; }

let n = 0;
function mk(x) {
  const part = 'perf' + (n++) + Math.random();
  const ses = session.fromPartition(part);
  ses.setPermissionRequestHandler((w, p, cb) => cb(true));
  ses.setPermissionCheckHandler(() => true);
  const w = new BrowserWindow({
    x, y: 40, width: 1100, height: 720, show: true, focusable: false,
    webPreferences: { partition: part, preload: path.join(APP, 'preload.js'), contextIsolation: true }
  });
  w.loadFile(path.join(APP, 'index.html'));
  return w;
}
async function ready(w) {
  await until(() => js(w, "!!(document.getElementById('hostBtn').onclick && typeof audioCtx !== 'undefined' && audioCtx)"), 30000);
  // as janelas contam como visíveis (como o app em uso), mesmo se o sistema achar que estão cobertas
  await js(w, "Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); 1");
}
const count = w => js(w, '[...peers.values()].filter(p => p.conn && p.conn.open && p.audioEl && p.audioEl.srcObject).length');

// Tela falsa: 1280x720 a 30 fps, com movimento (o codificador trabalha como numa tela real)
const FAKE_SCREEN = `(async () => {
  openPicker = async () => 'tela-falsa';
  shareAudioChk.checked = false;
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d'); let f = 0;
    setInterval(() => {
      f++; g.fillStyle = '#20232a'; g.fillRect(0, 0, 1280, 720);
      g.fillStyle = '#e8b04a'; g.fillRect((f * 9) % 1280, 200 + 120 * Math.sin(f / 15), 220, 160);
      g.fillStyle = '#fff'; g.font = '48px sans-serif'; g.fillText('quadro ' + f, 60, 90);
    }, 33);
    return c.captureStream(30);
  };
  await startShare();
  return !!screenStream;
})()`;

// Uma amostra a cada segundo durante a janela de medição
async function measure(wins) {
  app.getAppMetrics(); // zera a base da CPU
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < MEASURE_MS) {
    await wait(SAMPLE_MS);
    const m = app.getAppMetrics();
    let cpu = 0, cpuPages = 0, mem = 0, memPages = 0;
    for (const p of m) {
      const c = p.cpu.percentCPUUsage, kb = p.memory.workingSetSize;
      cpu += c; mem += kb;
      if (p.type === 'Tab') { cpuPages += c; memPages += kb; }
    }
    samples.push({ cpu, cpuPages, mem: mem / 1024, memPages: memPages / 1024 });
  }
  let heap = 0;
  for (const w of wins) heap += await js(w, 'performance.memory ? performance.memory.usedJSHeapSize : 0') / 1048576;
  const avg = k => samples.reduce((s, x) => s + x[k], 0) / samples.length;
  const max = k => Math.max(...samples.map(x => x[k]));
  return {
    cpuTotal: avg('cpu'), cpuPaginas: avg('cpuPages'),
    memTotal: avg('mem'), memTotalPico: max('mem'), memPaginas: avg('memPages'),
    heapJs: heap
  };
}

const destroy = ws => ws.forEach(w => { try { w.destroy(); } catch {} });
const rid = () => 'perf' + Math.random().toString(36).slice(2, 8);

const SCENARIOS = {
  async parado() {
    const A = mk(20); await ready(A);
    await wait(WARM_MS);
    const r = await measure([A]); destroy([A]); return r;
  },
  async salaComVoz() {
    const A = mk(20), B = mk(160); await ready(A); await ready(B);
    const room = rid();
    await js(A, `nameInput.value='Anfitriao'; roomInput.value='${room}'; hostBtn.click(); 1`);
    await until(() => js(A, '!!(peer && peer.open)'), 20000);
    await js(B, `nameInput.value='Amigo'; roomInput.value='${room}'; joinBtn.click(); 1`);
    if (!(await until(async () => (await count(A)) === 1 && (await count(B)) === 1, 30000))) throw new Error('as duas janelas não se conectaram');
    await wait(WARM_MS);
    const r = await measure([A, B]); destroy([A, B]); return r;
  },
  async salaComTela() {
    const A = mk(20), B = mk(160); await ready(A); await ready(B);
    const room = rid();
    await js(A, `nameInput.value='Anfitriao'; roomInput.value='${room}'; hostBtn.click(); 1`);
    await until(() => js(A, '!!(peer && peer.open)'), 20000);
    await js(B, `nameInput.value='Amigo'; roomInput.value='${room}'; joinBtn.click(); 1`);
    if (!(await until(async () => (await count(A)) === 1 && (await count(B)) === 1, 30000))) throw new Error('as duas janelas não se conectaram');
    if (!(await js(A, FAKE_SCREEN))) throw new Error('não conseguiu compartilhar a tela falsa');
    const vendo = await until(() => js(B, "(() => { const v = document.querySelector('.tile video'); return !!(v && v.videoWidth > 0 && !v.paused); })()"), 30000);
    if (!vendo) throw new Error('quem assiste não recebeu o vídeo da tela');
    await wait(WARM_MS);
    const r = await measure([A, B]); destroy([A, B]); return r;
  }
};

const median = xs => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = (v, d = 1) => v.toFixed(d);

app.whenReady().then(async () => {
  console.log(`TelaShare: medição de desempenho — ${ROUNDS} rodada(s) por cenário, ${MEASURE_MS / 1000} s cada`);
  console.log(`Máquina: ${os.platform()} ${os.arch()}, ${os.cpus().length} núcleos (${(os.cpus()[0] || {}).model || '?'}), ${Math.round(os.totalmem() / 1073741824)} GB\n`);
  const result = {};
  let failed = false;
  for (const [name, run] of Object.entries(SCENARIOS)) {
    const rounds = [];
    for (let i = 0; i < ROUNDS; i++) {
      try { rounds.push(await run()); }
      catch (e) { console.log(`  ⚠️ ${name}, rodada ${i + 1}: ${e.message}`); failed = true; }
      await wait(1500);
    }
    if (!rounds.length) continue;
    const keys = Object.keys(rounds[0]);
    result[name] = Object.fromEntries(keys.map(k => [k, Number(median(rounds.map(r => r[k])).toFixed(2))]));
    result[name].rodadas = rounds.length;
    const r = result[name];
    console.log(`${name.padEnd(12)} CPU ${fmt(r.cpuTotal).padStart(6)}% (páginas ${fmt(r.cpuPaginas)}%) · memória ${fmt(r.memTotal, 0)} MB (pico ${fmt(r.memTotalPico, 0)}, páginas ${fmt(r.memPaginas, 0)}) · heap JS ${fmt(r.heapJs)} MB`);
  }
  const out = {
    data: new Date().toISOString(),
    versao: require(path.join(APP, 'package.json')).version,
    electron: process.versions.electron,
    maquina: { sistema: os.platform(), arquitetura: os.arch(), nucleos: os.cpus().length, cpu: (os.cpus()[0] || {}).model, memoriaGB: Math.round(os.totalmem() / 1073741824) },
    config: { rodadas: ROUNDS, medicaoSegundos: MEASURE_MS / 1000, aquecimentoSegundos: WARM_MS / 1000 },
    cenarios: result
  };
  console.log('\nCPU: soma de todos os processos do app (100% = 1 núcleo inteiro). Memória: conjunto de trabalho somado.');
  if (SAVE) {
    const dir = path.join(APP, 'perf');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${os.platform()}-${os.arch()}.json`);
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
    console.log('Gravado em ' + path.relative(APP, file));
  }
  app.exit(failed ? 1 : 0);
});
