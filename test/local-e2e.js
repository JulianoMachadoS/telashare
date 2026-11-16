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

/*
 * TelaShare - testes LOCAIS de ponta a ponta
 * ============================================
 * ATENÇÃO: são testes LOCAIS. Rodam várias janelas do app no MESMO computador,
 * cada uma simulando um participante. Eles NÃO testam:
 *   - conexão entre redes/casas diferentes (firewall, NAT, VPN, TURN);
 *     aqui a conexão é sempre "rede local";
 *   - captura de tela real (usa um canvas no lugar da tela);
 *   - áudio do PC (loopback), que só existe no Windows;
 *   - qualidade do som para o ouvido (só mede níveis numéricos).
 *
 * Usam o servidor público real do PeerJS (precisa de internet) e um microfone
 * falso do Chromium que emite um bipe.
 *
 * Rodar:  npm test                (todos, leva ~5 minutos)
 *         npm test -- 4 27 28     (só os módulos indicados, pelo número do teste)
 */
const { app, BrowserWindow, session, ipcMain } = require('electron');
// handlers que o main.js real registra
let lastCopied = '';
ipcMain.handle('copy-text', (_e, t) => { lastCopied = String(t); return true; });
ipcMain.handle('take-pending-invite', () => null);
ipcMain.handle('get-sources', () => []);
ipcMain.handle('select-source', () => true);
ipcMain.handle('get-version', () => '0.0.0-teste');
ipcMain.handle('open-project', () => true);
ipcMain.handle('open-license', () => true);
const openedLinks = [];
ipcMain.handle('open-link', (_e, k) => { openedLinks.push(k); return true; });
ipcMain.handle('open-chromium-licenses', () => true);
let updateReply = { error: 'not-found' };
ipcMain.handle('check-update', () => updateReply);
// atualização automática (#44): por padrão, como o .exe portátil (modo manual)
let updateStateReply = { mode: 'manual', status: 'idle' };
const updateCalls = [];
ipcMain.handle('update-state', () => updateStateReply);
ipcMain.handle('update-check', () => { updateCalls.push('check'); return updateStateReply; });
ipcMain.handle('update-install', () => { updateCalls.push('install'); return true; });
ipcMain.handle('read-license', (_e, k) => {
  const files = { license: 'LICENSE', notice: 'NOTICE', peerjs: 'node_modules/peerjs/LICENSE' };
  try { return require('fs').readFileSync(path.join(APP, files[k]), 'utf8'); } catch { return null; }
});
const path = require('path');
const APP = path.join(__dirname, '..');
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
// No CI (Linux) o sandbox do Chromium não funciona sem privilégios
if (process.env.CI) app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
let n = 0;
function mk() {
  const part = 'teste' + (n++) + Math.random();
  const ses = session.fromPartition(part);
  ses.setPermissionRequestHandler((w, p, cb) => cb(true));
  ses.setPermissionCheckHandler(() => true);
  const w = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false, partition: part, preload: path.join(APP, 'preload.js'), contextIsolation: true } });
  w.webContents.on('console-message', e => { if (/Uncaught|TypeError|ReferenceError/.test(e.message)) console.log('  ERRO JS:', e.message); });
  w.loadFile(path.join(APP, 'index.html'));
  return w;
}
const js = (w, c) => w.webContents.executeJavaScript(c);
const wait = ms => new Promise(r => setTimeout(r, ms));
// Espera o app terminar de iniciar (botões ligados). Na primeira janela, que abre "a frio" no CI,
// a inicialização pode passar de 2,5 s, e um clique antes disso se perde.
const ready = async ws => {
  await wait(2500);
  for (const w of ws) {
    await until(async () => { try { return await js(w, "!!(document.getElementById('hostBtn').onclick && typeof audioCtx !== 'undefined' && audioCtx)"); } catch { return false; } }, 30000);
    await js(w, 'window.__alerts=[]; window.alert=m=>window.__alerts.push(m); 1');
    // As janelas de teste ficam ocultas e o Chromium pode marcá-las como "escondidas", o que
    // pausaria o vídeo das telas (#46) no meio de outros testes. Aqui elas contam como visíveis;
    // o teste 35 simula o app escondido de propósito.
    await js(w, "Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); 1");
  }
};
const host = (w, room) => js(w, `nameInput.value='Host'; roomInput.value='${room}'; hostBtn.click(); 1`);
const join = (w, room, nm) => js(w, `nameInput.value='${nm}'; roomInput.value='${room}'; joinBtn.click(); 1`);
const count = w => js(w, `[...peers.values()].filter(p => p.conn && p.conn.open && p.audioEl && p.audioEl.srcObject).length`);
const alerts = w => js(w, '__alerts');
async function until(fn, ms) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(500); } return false; }
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log((ok ? '✅ PASSOU ' : '❌ FALHOU ') + name + (extra ? ' — ' + extra : '')); };
const destroy = ws => ws.forEach(w => w.destroy());
// Em caso de falha, mostra o estado de cada janela (ajuda a entender falhas que só acontecem no CI)
const dump = async ws => { for (const w of ws) { try { console.log('  ESTADO', JSON.stringify(await js(w, `({ id: peer && peer.id, host: isHost, open: !!(peer && peer.open), status: status.textContent,
  peers: [...peers.values()].map(p => ({ n: p.name, conn: !!(p.conn && p.conn.open), mic: !!p.micCall, audio: !!(p.audioEl && p.audioEl.srcObject), pc: p.conn && p.conn.peerConnection && p.conn.peerConnection.connectionState })),
  roster: typeof roster !== 'undefined' ? [...roster.keys()] : null, pending: typeof pending !== 'undefined' ? [...pending.keys()] : null, toasts: toastLog, alerts: __alerts })`))); } catch (e) { console.log('  ESTADO erro', e.message); } } };
const rid = () => 'suite' + Math.floor(Math.random() * 1e9);
// Filtro de módulos: "npm test -- 4 27" roda só os testes 4 e 27 (sem números = todos)
const ONLY = process.argv.slice(2).join(',').split(/[,\s]+/).filter(a => /^\d+$/.test(a));
const want = (...ids) => !ONLY.length || ids.some(id => ONLY.includes(String(id)));

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  console.log('TelaShare: testes LOCAIS (várias janelas no mesmo computador)' + (ONLY.length ? ` — só os módulos ${ONLY.join(', ')}` : '') + '\n');
  // 1. Caso normal (3 rodadas)
  if (want(1)) for (let i = 1; i <= 3; i++) {
    const room = rid(), A = mk(), B = mk(); await ready([A, B]);
    await host(A, room); await wait(2500); await join(B, room, 'Amigo');
    const ok = await until(async () => (await count(A)) === 1 && (await count(B)) === 1, 20000);
    check(`1.${i} Criar sala + entrar (voz conectada nos dois lados)`, ok);
    if (!ok) await dump([A, B]);
    destroy([A, B]);
  }
  // 2. Amigo entra antes do anfitrião criar
  if (want(2)) { const room = rid(), A = mk(), B = mk(); await ready([A, B]);
    await join(B, room, 'Amigo'); await wait(5000); await host(A, room);
    const ok = await until(async () => (await count(A)) === 1 && (await count(B)) === 1, 30000);
    check('2. Entrar antes da sala existir', ok, JSON.stringify(await alerts(B)));
    destroy([A, B]); }
  // 3. Sala inexistente
  if (want(3)) { const C = mk(); await ready([C]);
    await join(C, rid(), 'X');
    const ok = await until(async () => (await alerts(C)).some(a => a.startsWith('Sala não encontrada')), 60000);
    check('3. Código errado mostra "Sala não encontrada"', ok);
    destroy([C]); }
  // 4. Três pessoas (malha completa)
  if (want(4)) { const room = rid(), A = mk(), B = mk(), C = mk(); await ready([A, B, C]);
    await host(A, room); await wait(2500); await join(B, room, 'B'); await wait(1000); await join(C, room, 'C');
    const ok = await until(async () => (await count(A)) === 2 && (await count(B)) === 2 && (await count(C)) === 2, 30000);
    check('4. Três pessoas, todos conectados a todos', ok, `A=${await count(A)} B=${await count(B)} C=${await count(C)}`);
    destroy([A, B, C]); }
  // 5. Sair da sala
  if (want(5)) { const room = rid(), A = mk(), B = mk(); await ready([A, B]);
    await host(A, room); await wait(2500); await join(B, room, 'Amigo');
    await until(async () => (await count(A)) === 1, 20000);
    await js(B, 'leaveBtn.click(); 1');
    const ok = await until(async () => (await count(A)) === 0, 15000);
    check('5. Quem sai some da lista do anfitrião', ok);
    destroy([A, B]); }

  // 6. Áudio chega e o volume acima de 100% aumenta de verdade
  if (want(6, 7, 8, 9)) { const room = rid(), A = mk(), B = mk(); await ready([A, B]);
    await host(A, room); await wait(2500); await join(B, room, 'Amigo');
    await until(async () => (await count(A)) === 1, 20000);
    await wait(2000);
    // mede ANTES (sinal recebido) e DEPOIS do volume da pessoa no mesmo instante
    const measure = vol => js(A, `(async () => {
      const p = [...peers.values()][0];
      p.vol = ${vol}; applyVolumes();
      await new Promise(r => setTimeout(r, 400));
      const pre = audioCtx.createAnalyser(); pre.fftSize = 32768; p.voiceSrc.connect(pre);
      const post = audioCtx.createAnalyser(); post.fftSize = 32768; p.voiceGain.connect(post);
      const b1 = new Float32Array(32768), b2 = new Float32Array(32768);
      let pk1 = 0, pk2 = 0; const t = Date.now();
      while (Date.now() - t < 2500) {
        pre.getFloatTimeDomainData(b1); post.getFloatTimeDomainData(b2);
        for (const v of b1) pk1 = Math.max(pk1, Math.abs(v));
        for (const v of b2) pk2 = Math.max(pk2, Math.abs(v));
        await new Promise(r => setTimeout(r, 20));
      }
      p.voiceSrc.disconnect(pre); p.voiceGain.disconnect(post);
      return { pk1, pk2 }; })()`);
    const v1 = await measure(1), v3 = await measure(3), v0 = await measure(0);
    check('6a. Voz do amigo chega no anfitrião', v1.pk1 > 0.01, 'pico=' + v1.pk1.toFixed(3));
    const k3 = v3.pk2 / v3.pk1;
    check('6b. Volume 300% multiplica por 3', Math.abs(k3 - 3) < 0.15, `300% → ${(k3 * 100).toFixed(0)}%`);
    check('6c. Volume 0% silencia', v0.pk2 < 0.001, 'pico=' + v0.pk2.toFixed(4));
    // ganho do microfone no envio: mede ANTES e DEPOIS do ganho no mesmo instante
    // e compara a proporção (o volume do bipe do microfone falso varia entre medições)
    const micRatio = g => js(B, `(async () => {
      setGain(micGain, ${g}); await new Promise(r => setTimeout(r, 700));
      const pre = audioCtx.createAnalyser(); pre.fftSize = 32768; micSource.connect(pre);
      const post = audioCtx.createAnalyser(); post.fftSize = 32768; muteGain.connect(post);
      const b1 = new Float32Array(32768), b2 = new Float32Array(32768);
      let pk1 = 0, pk2 = 0; const t = Date.now();
      while (Date.now() - t < 2500) {
        pre.getFloatTimeDomainData(b1); post.getFloatTimeDomainData(b2);
        for (const v of b1) pk1 = Math.max(pk1, Math.abs(v));
        for (const v of b2) pk2 = Math.max(pk2, Math.abs(v));
        await new Promise(r => setTimeout(r, 20));
      }
      micSource.disconnect(pre); muteGain.disconnect(post);
      return { pk1, pk2 }; })()`);
    const micPeak = async g => (await micRatio(g)).pk2;
    const r2 = await micRatio(0.2), r5 = await micRatio(0.5);
    const g2 = r2.pk2 / r2.pk1, g5 = r5.pk2 / r5.pk1;
    check('6d. Ganho do microfone aplica a proporção certa', Math.abs(g2 - 0.2) < 0.03 && Math.abs(g5 - 0.5) < 0.06,
      `ganho 20% → ${(g2 * 100).toFixed(0)}% | ganho 50% → ${(g5 * 100).toFixed(0)}%`);
    // limitador: tom sintético de amplitude 1,0 com ganho 400% (sinal 4x acima do máximo)
    const lim = await js(B, `(async () => {
      const o = audioCtx.createOscillator(); o.frequency.value = 440;
      const an = audioCtx.createAnalyser(); an.fftSize = 32768;
      setGain(micGain, 4); micSource.disconnect(); o.connect(micGain); muteGain.connect(an); o.start();
      await new Promise(r => setTimeout(r, 1500));
      const buf = new Float32Array(32768); an.getFloatTimeDomainData(buf);
      let pk = 0; for (const v of buf) pk = Math.max(pk, Math.abs(v));
      o.stop(); o.disconnect(); muteGain.disconnect(an); micSource.connect(micGain);
      return pk; })()`);
    check('6e. Limitador segura o pico abaixo de 1,0 com ganho 400%', lim > 0.9 && lim <= 0.98, `pico=${lim.toFixed(3)}`);
    await micPeak(1);
    // 7. Indicador de conexão
    await wait(2500);
    const badgeA = await js(A, 'connBadge.className + " | " + connText.textContent');
    const netA = await js(A, 'document.querySelector("#peerList .net").className + " | " + document.querySelector("#peerList .net").textContent');
    check('7a. Selo mostra "Conectado"', /good/.test(badgeA) && /Conectado · 1 pessoa/.test(badgeA), badgeA);
    check('7b. Participante mostra ping e tipo de conexão', /\d+ ms/.test(netA), netA);
    // 8. Botões de teste não dão erro
    const errs = await js(B, `(async () => { const e = [];
      try { await testOutput(); } catch (x) { e.push('testOutput: ' + x.message); }
      try { toggleMonitor(); await new Promise(r => setTimeout(r, 300)); toggleMonitor(); } catch (x) { e.push('monitor: ' + x.message); }
      try { recordTest(); await new Promise(r => setTimeout(r, 7500)); } catch (x) { e.push('rec: ' + x.message); }
      e.push(...__alerts); return e; })()`);
    const recLabel = await js(B, 'recBtn.textContent');
    check('8. Testar som / ouvir microfone / gravar teste funcionam', errs.length === 0 && /Reproduzindo|Gravar teste/.test(recLabel), JSON.stringify(errs) + ' ' + recLabel);
    // 9. Saída do amigo some: selo volta
    B.destroy();
    const gone = await until(async () => (await js(A, 'connText.textContent')).includes('aguardando'), 20000);
    check('9. Quando o amigo fecha o app, o selo do anfitrião atualiza', gone, await js(A, 'connText.textContent'));
    A.destroy(); }

  // 10. Amigo compartilhando a tela fecha o app: tela e nome somem
  if (want(10)) { const room = rid(), A = mk(), B = mk(); await ready([A, B]);
    await host(A, room); await wait(2500); await join(B, room, 'Amigo');
    await until(async () => (await count(A)) === 1, 20000);
    await js(B, `(() => { const c = document.createElement('canvas'); c.width = 320; c.height = 180;
      const g = c.getContext('2d'); setInterval(() => { g.fillStyle = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6,'0'); g.fillRect(0,0,320,180); }, 100);
      screenStream = c.captureStream(10); for (const p of peers.values()) callScreen(p.id); return 1; })()`);
    const shown = await until(async () => (await js(A, 'document.querySelectorAll(".tile").length')) === 1, 15000);
    check('10a. Tela do amigo aparece para o anfitrião', shown);
    const t0 = Date.now();
    B.destroy();
    const gone = await until(async () => (await js(A, 'document.querySelectorAll(".tile").length + peers.size')) === 0, 20000);
    check('10b. Amigo fecha o app: tela e nome somem', gone, `${((Date.now() - t0) / 1000).toFixed(1)}s, tiles=${await js(A, 'document.querySelectorAll(".tile").length')} peers=${await js(A, 'peers.size')}`);
    A.destroy(); }
  // 11. Amigo clica em "Sair da sala": some na hora
  if (want(11)) { const room = rid(), A = mk(), B = mk(); await ready([A, B]);
    await host(A, room); await wait(2500); await join(B, room, 'Amigo');
    await until(async () => (await count(A)) === 1, 20000);
    const t0 = Date.now();
    await js(B, 'leaveBtn.click(); 1');
    const gone = await until(async () => (await js(A, 'peers.size')) === 0, 15000);
    check('11. "Sair da sala" remove rápido', gone && Date.now() - t0 < 4000, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
    destroy([A, B]); }
  // 12. Ninguém é removido por engano em 20s de conexão parada
  if (want(12)) { const room = rid(), A = mk(), B = mk(); await ready([A, B]);
    await host(A, room); await wait(2500); await join(B, room, 'Amigo');
    await until(async () => (await count(A)) === 1, 20000);
    await wait(20000);
    check('12. Conexão estável por 20s sem remoções falsas', (await count(A)) === 1 && (await count(B)) === 1);
    destroy([A, B]); }

  // 13. Indicador de mudo
  if (want(13, 14, 15)) { const room = rid(), A = mk(), B = mk(); await ready([A, B]);
    await host(A, room); await wait(2500); await join(B, room, 'Amigo');
    await until(async () => (await count(A)) === 1, 20000);
    await wait(1000);
    const liMuted = () => js(A, 'document.querySelector("#peerList li").classList.contains("muted")');
    await js(B, 'muteBtn.click(); 1');
    const on = await until(liMuted, 5000);
    await js(B, 'muteBtn.click(); 1');
    const off = await until(async () => !(await liMuted()), 5000);
    check('13. Indicador de mudo aparece e some para os outros', on && off);
  // 14. Ducking: o som das telas abaixa quando alguém fala.
  //     Usa uma "voz" SINTÉTICA com ritmo controlado (300 ms de som a cada 1,5 s) no lugar do
  //     bipe do microfone falso, cujo ritmo muda de máquina para máquina (no CI ele quase não
  //     tinha pausas e o ducking nunca "soltava").
    await js(A, `(() => {
      const p = [...peers.values()][0];
      try { p.voiceSrc.disconnect(p.analyser); } catch {}
      const o = audioCtx.createOscillator(); o.frequency.value = 300;
      const g = audioCtx.createGain(); g.gain.value = 0;
      o.connect(g).connect(p.analyser); o.start();
      const on = () => { g.gain.value = 0.5; setTimeout(() => (g.gain.value = 0), 300); };
      on(); window.__voz = setInterval(on, 1500);
      return 1; })()`);
    // acompanha o ducking por 5 s: tem que abaixar E voltar, várias vezes
    const watchDuck = () => js(A, `(async () => { let changes = 0, last = duckFactor, min = 1, max = 0, spoke = false, quiet = false; const t = Date.now();
      while (Date.now() - t < 5000) {
        if (duckFactor !== last) { changes++; last = duckFactor; }
        min = Math.min(min, duckFactor); max = Math.max(max, duckFactor);
        const li = document.querySelector('#peerList li');
        if (li && li.classList.contains('speaking')) spoke = true; else quiet = true;
        await new Promise(r => setTimeout(r, 20)); }
      return { changes, min, max, spoke, quiet }; })()`);
    await js(A, 'duckChk.checked = true; duckChk.onchange(); 1');
    const duckOn = await watchDuck();
    await js(A, 'duckChk.checked = false; duckChk.onchange(); 1');
    await wait(300); // deixa o timer de 50 ms aplicar a mudança antes de medir
    const duckOff = await watchDuck();
    check('14. Ducking abaixa e volta quando alguém fala (e desliga na opção)',
      duckOn.min === 0.3 && duckOn.max === 1 && duckOn.changes >= 4 && duckOff.min === 1,
      `ligado: ${duckOn.changes} mudanças, ${duckOn.min}–${duckOn.max} | desligado: mín ${duckOff.min}`);
  // 14b. App MINIMIZADO: o Windows para o requestAnimationFrame quando a janela não está
  //      visível. Aqui ele é desligado de propósito, para simular isso em qualquer sistema.
    await js(A, 'duckChk.checked = true; duckChk.onchange(); window.requestAnimationFrame = () => 0; 1');
    await wait(300);
    const minimized = await watchDuck();
    check('14b. Com o app minimizado, ducking e indicador de "falando" continuam funcionando',
      minimized.changes >= 4 && minimized.spoke && minimized.quiet,
      `ducking mudou ${minimized.changes}x | falando=${minimized.spoke} | silêncio=${minimized.quiet}`);
    await js(A, 'clearInterval(window.__voz); 1');
  // 15. Qualidade adaptativa: aplica os níveis no envio da tela
    await js(B, `(() => { const c = document.createElement('canvas'); c.width = 640; c.height = 360;
      const g = c.getContext('2d'); setInterval(() => { g.fillStyle = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6,'0'); g.fillRect(0,0,640,360); }, 100);
      screenStream = c.captureStream(10); for (const p of peers.values()) callScreen(p.id); return 1; })()`);
    await until(async () => (await js(B, '[...peers.values()][0].screenOut.peerConnection.connectionState')) === 'connected', 15000);
    // espera o app aplicar a configuração inicial da tela (senão ela pode sobrescrever o nível do teste)
    await until(async () => await js(B, `(() => { const s = [...peers.values()][0].screenOut.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
      const e = s && s.getParameters().encodings[0]; return !!(e && e.maxBitrate); })()`), 10000);
    const enc = await js(B, `(async () => { const pc = [...peers.values()][0].screenOut.peerConnection; const out = [];
      for (const lvl of [2, 0]) { applyEncoding(pc, lvl); await new Promise(r => setTimeout(r, 500));
        const e = pc.getSenders().find(s => s.track && s.track.kind === 'video').getParameters().encodings[0];
        out.push(e.scaleResolutionDownBy + '/' + e.maxBitrate); }
      return out; })()`);
    check('15. Qualidade adaptativa aplica e restaura resolução/bitrate', enc[0] === '2/1350000' && enc[1] === '1/4500000', JSON.stringify(enc));
    destroy([A, B]); }
  // 16. Convite: copiar e entrar pelo link
  if (want(16)) { const room = rid(), A = mk(), C = mk(); await ready([A, C]);
    await host(A, room);
    await until(async () => (await js(A, '!!(peer && peer.open && roomCode)')), 15000);
    await js(A, 'copyInvite()');
    const copied = lastCopied;
    await js(C, `nameInput.value = 'Convidado'; handleInvite('${room}'); 1`);
    const ok = await until(async () => (await count(A)) === 1, 20000);
    check('16a. Convite copiado contém o link da sala', copied.includes('telashare://sala/' + room), copied.split('\n')[1]);
    check('16b. Abrir o convite entra na sala', ok);
    destroy([A, C]); }

  // 17. Aviso legal visível (AGPLv3, Seção 5d)
  if (want(17)) { const A = mk(); await ready([A]);
    const t = await js(A, 'document.getElementById("legal").innerText');
    check('17. Aviso legal visível com licença e link do projeto original',
      /AGPLv3/.test(t) && /github\.com\/JulianoMachadoS\/telashare/.test(t) && /Juliano Machado da Silva/.test(t), t.replace(/\n/g, ' | '));
    destroy([A]); }

  // 18. Botão ℹ️: janela Sobre com licenças e link do repositório
  if (want(18)) { const A = mk(); await ready([A]);
    await js(A, 'aboutBtn.click(); 1'); await wait(500);
    const visible = await js(A, '!about.classList.contains("hidden")');
    const head = await js(A, 'about.innerText');
    const lic = await js(A, 'licenseText.textContent.slice(0, 200)');
    await js(A, 'document.querySelector("[data-lic=notice]").click(); 1'); await wait(300);
    const notice = await js(A, 'licenseText.textContent');
    await js(A, 'document.querySelector("[data-lic=third]").click(); 1'); await wait(200);
    await js(A, 'document.querySelector("[data-lic-view=peerjs]").click(); 1'); await wait(300);
    const peer = await js(A, 'thirdText.textContent');
    await js(A, 'document.querySelector("#about [data-link=project]").click(); 1'); await wait(300);
    await js(A, 'document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); 1'); await wait(200);
    const closed = await js(A, 'about.classList.contains("hidden")');
    check('18a. Botão ℹ️ abre a janela Sobre com versão e repositório', visible && /TelaShare v/.test(head) && /github\.com\/JulianoMachadoS\/telashare/.test(head));
    check('18b. Mostra a licença AGPLv3 completa', /GNU AFFERO GENERAL PUBLIC LICENSE/.test(lic));
    check('18c. Mostra o NOTICE', /Projeto original/.test(notice) && /Juliano Machado da Silva/.test(notice));
    check('18d. Mostra a licença de terceiros (PeerJS, MIT)', /MIT License/.test(peer));
    check('18e. Botão do repositório pede para abrir o link do projeto pai', openedLinks.includes('project'));
    check('18f. Esc fecha a janela Sobre', closed);
    destroy([A]); }

  // 19. Nomes repetidos: três pessoas chamadas "Juliano"
  if (want(19)) { const room = rid(), A = mk(), B = mk(), C = mk(); await ready([A, B, C]);
    await js(A, `nameInput.value='Juliano'; roomInput.value='${room}'; hostBtn.click(); 1`); await wait(2500);
    await join(B, room, 'Juliano'); await wait(1000); await join(C, room, 'Juliano');
    await until(async () => (await count(A)) === 2, 30000); await wait(1500);
    const names = await js(A, `[...document.querySelectorAll('#peerList .nm')].map(e => e.textContent)`);
    const colors = await js(A, `[...document.querySelectorAll('#peerList .av')].map(e => e.style.background)`);
    const idx = await js(A, `[...peers.values()].map(p => p.colorIdx)`);
    check('19a. Nomes repetidos aparecem diferentes na lista (com #id)', names.length === 2 && new Set(names).size === 2 && names.every(n => /^Juliano #[a-z0-9]{4}$/.test(n)), JSON.stringify(names));
    check('19b. Cada pessoa tem uma cor diferente (cores distintas da paleta)', colors.length === 2 && new Set(colors).size === 2 && new Set(idx).size === 2, JSON.stringify({ colors, idx }));
    await js(A, `const r = document.querySelector('#peerList li input[type=range]'); r.value = 250; r.oninput(); 1`);
    const keys = await js(A, `Object.keys(localStorage).filter(k => k.startsWith('ts_pvol'))`);
    const vols = await js(A, `[...peers.values()].map(p => p.vol)`);
    check('19c. Volume salvo por instalação, sem misturar pessoas de mesmo nome', keys.length === 1 && /^ts_pvol_dev_/.test(keys[0]) && vols.includes(2.5) && vols.includes(1), JSON.stringify({ keys, vols }));
    destroy([A, B, C]); }
  // 20. Sons de aviso
  if (want(20)) { const room = rid(), A = mk(), B = mk(); await ready([A, B]);
    await host(A, room); await wait(2500); await join(B, room, 'Amigo');
    await until(async () => (await count(A)) === 1, 20000); await wait(1000);
    await js(B, 'muteBtn.click(); 1'); await wait(300);
    await js(B, 'leaveBtn.click(); 1'); await until(async () => (await js(A, 'peers.size')) === 0, 10000);
    const sa = await js(A, 'soundLog.slice()'), sb = await js(B, 'soundLog.slice()');
    check('20a. Sons: alguém entrou / saiu', sa.includes('join') && sa.includes('leave'), JSON.stringify(sa));
    check('20b. Sons: mudo', sb.includes('mute'), JSON.stringify(sb));
    const before = await js(A, 'soundLog.length');
    await js(A, 'soundChk.checked = false; muteBtn.click(); muteBtn.click(); 1'); await wait(200);
    check('20c. Desligar os sons silencia os avisos', (await js(A, 'soundLog.length')) === before);
    check('20d. Quem saiu de propósito não dispara reconexão', !(await js(A, 'rejoining')) && !(await js(B, 'rejoining')));
    destroy([A, B]); }
  // 21. Reconexão automática: a conexão do amigo cai de repente (sem "bye")
  if (want(21)) { const room = rid(), A = mk(), B = mk(); await ready([A, B]);
    await host(A, room); await wait(2500); await join(B, room, 'Amigo');
    await until(async () => (await count(A)) === 1, 20000); await wait(1000);
    await js(B, 'rejoinCfg = { max: 5, delays: [1000, 2000, 3000, 4000, 5000] }; 1');
    await js(B, `for (const p of peers.values()) [p.conn && p.conn.peerConnection, p.micCall && p.micCall.peerConnection].forEach(pc => pc && pc.close()); 1`);
    const started = await until(async () => await js(B, 'rejoining'), 15000);
    const back = await until(async () => (await count(A)) === 1 && (await count(B)) === 1 && !(await js(B, 'rejoining')), 60000);
    const sb = await js(B, 'soundLog.slice()'), tb = await js(B, 'toastLog.slice()');
    check('21a. Conexão caiu: o app começa a reconectar sozinho', started);
    check('21b. Reconectou e a voz voltou nos dois lados', back, `A=${await count(A)} B=${await count(B)}`);
    check('21c. Avisos de "conexão perdida" e "reconectado" (som e mensagem)', sb.includes('warn') && sb.includes('ok') && tb.some(t => /Reconectado/.test(t)), JSON.stringify({ sb, tb }));
    destroy([A, B]); }
  // 22. Reconexão com limite: o anfitrião sumiu de vez
  if (want(22)) { const room = rid(), A = mk(), B = mk(); await ready([A, B]);
    await host(A, room); await wait(2500); await join(B, room, 'Amigo');
    await until(async () => (await count(B)) === 1, 20000); await wait(1000);
    await js(B, 'rejoinCfg = { max: 2, delays: [500, 500] }; 1');
    A.destroy();
    const gaveUp = await until(async () => (await alerts(B)).some(a => /Não foi possível reconectar/.test(a)), 120000);
    const out = await js(B, '!peer && !rejoining && !connectBox.classList.contains("hidden")');
    check('22. Desiste após o limite de tentativas e volta para a tela inicial', gaveUp && out, JSON.stringify(await alerts(B)));
    destroy([B]); }
  // 23. Aviso de nova versão na janela Sobre
  if (want(23)) { updateReply = { tag: 'v9.9.9', url: 'https://example.invalid' };
    const A = mk(); await ready([A]); await wait(1000);
    const badge = await js(A, 'aboutBtn.classList.contains("has-update")');
    await js(A, 'aboutBtn.click(); 1'); await wait(300);
    const txt = await js(A, 'updateText.textContent');
    const dl = await js(A, '!updateDownload.classList.contains("hidden")');
    check('23a. Nova versão: bolinha no botão i, aviso e botão de baixar', badge && /v9\.9\.9/.test(txt) && dl && (await js(A, 'toastLog.some(t => /Nova versão/.test(t))')), txt);
    updateReply = { tag: 'v0.0.0' };
    await js(A, 'updateCheck.click(); 1'); await wait(500);
    check('23b. Sem versão nova: "versão mais recente"', /mais recente/.test(await js(A, 'updateText.textContent')) && !(await js(A, 'aboutBtn.classList.contains("has-update")')));
    updateReply = { error: 'not-found' };
    await js(A, 'updateCheck.click(); 1'); await wait(500);
    check('23c. Sem acesso às versões: mensagem clara em vez de erro', /Não foi possível verificar/.test(await js(A, 'updateText.textContent')));
    destroy([A]); }
  // 24. Microfone desconectado
  if (want(24)) { const A = mk(); await ready([A]); await wait(500);
    const r = await js(A, `(async () => {
      const old = micRaw.getAudioTracks()[0];
      old.dispatchEvent(new Event('ended'));
      for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 100)); const t = micRaw && micRaw.getAudioTracks()[0]; if (t && t !== old && t.readyState === 'live') break; }
      const t = micRaw && micRaw.getAudioTracks()[0];
      return { novo: !!t && t !== old && t.readyState === 'live', toasts: toastLog.slice() }; })()`);
    check('24. Microfone desconectado: avisa e passa para o microfone padrão', r.novo && r.toasts.some(t => /Microfone desconectado/.test(t)) && r.toasts.some(t => /Usando agora/.test(t)), JSON.stringify(r));
    destroy([A]); }
  // 25. 🎲 código aleatório + 26. ocultar a minha prévia
  if (want(25, 26)) { const A = mk(); await ready([A]);
    await js(A, 'diceBtn.click(); 1'); const c1 = await js(A, 'roomInput.value');
    await js(A, 'diceBtn.click(); 1'); const c2 = await js(A, 'roomInput.value');
    const ok = [c1, c2].every(c => /^[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{2}$/.test(c));
    check('25. 🎲 gera códigos aleatórios válidos e diferentes', ok && c1 !== c2 && (await js(A, `sanitizeRoom('${c1}') === '${c1}'`)), `${c1} / ${c2}`);
    await js(A, `(() => { const c = document.createElement('canvas'); c.width = 320; c.height = 180; c.getContext('2d').fillRect(0, 0, 320, 180);
      localPreview = c.captureStream(5); showTile('__local__', localPreview, true); applyPreviewHidden(); return 1; })()`);
    await js(A, 'document.querySelector(".tile .prevBtn").click(); 1'); await wait(200);
    const hidden = await js(A, '({ c: tileEl("__local__").classList.contains("collapsed"), src: tileEl("__local__").querySelector("video").srcObject === null })');
    await js(A, 'document.querySelector(".tile .prevBtn").click(); 1'); await wait(200);
    const shown = await js(A, '({ c: tileEl("__local__").classList.contains("collapsed"), src: tileEl("__local__").querySelector("video").srcObject === localPreview })');
    check('26. Ocultar a minha prévia (libera o vídeo) e mostrar de novo', hidden.c && hidden.src && !shown.c && shown.src, JSON.stringify({ hidden, shown }));
    destroy([A]); }
  // 27. (#31) Só a ligação entre dois convidados cai: o par é religado sozinho
  if (want(27)) { const room = rid(), A = mk(), B = mk(), C = mk(); await ready([A, B, C]);
    await host(A, room); await wait(2500); await join(B, room, 'B'); await wait(1000); await join(C, room, 'C');
    const full = () => until(async () => (await count(A)) === 2 && (await count(B)) === 2 && (await count(C)) === 2, 40000);
    const mesh = await full();
    const cId = await js(C, 'peer.id'), bId = await js(B, 'peer.id');
    // derruba SÓ o par B↔C, do lado de B (como se a rede entre os dois piscasse)
    await js(B, `(() => { const p = peers.get('${cId}'); [p.conn.peerConnection, p.micCall && p.micCall.peerConnection].forEach(pc => pc && pc.close()); return 1; })()`);
    const dropped = await until(async () => !(await js(B, `!!(peers.get('${cId}') && peers.get('${cId}').conn && peers.get('${cId}').conn.open)`)), 15000);
    const healed = await full();
    const voice = await js(B, `!!(peers.get('${cId}') && peers.get('${cId}').voiceStream && peers.get('${cId}').voiceStream.getAudioTracks()[0].readyState === 'live')`)
      && await js(C, `!!(peers.get('${bId}') && peers.get('${bId}').voiceStream && peers.get('${bId}').voiceStream.getAudioTracks()[0].readyState === 'live')`);
    const noRejoin = !(await js(B, 'rejoining')) && !(await js(C, 'rejoining'));
    const toasts = (await js(B, 'toastLog.slice()')).concat(await js(C, 'toastLog.slice()'));
    check('27a. (#31) Ligação B↔C cai e é religada sozinha, com voz nos dois sentidos', mesh && dropped && healed && voice,
      `antes=${mesh} caiu=${dropped} religou=${healed} voz=${voice} | A=${await count(A)} B=${await count(B)} C=${await count(C)}`);
    check('27b. (#31) Religar um par não derruba a sala nem dispara a reconexão geral', noRejoin && (await count(A)) === 2);
    check('27c. (#31) Avisos "caiu, religando" e "religado"', toasts.some(t => /caiu\. Religando/.test(t)) && toasts.some(t => /Religado com/.test(t)), JSON.stringify(toasts));
    // quem sai de propósito não é religado: some do roster de todos
    await js(C, 'leaveBtn.click(); 1');
    const forgot = await until(async () => !(await js(A, `roster.has('${cId}')`)) && !(await js(B, `roster.has('${cId}') || pending.has('${cId}')`)), 20000);
    check('27d. (#31) Quem saiu de propósito não é religado', forgot);
    destroy([A, B, C]); }
  // 28. (#32) O anfitrião sai e volta: a sala não se divide
  if (want(28)) { const room = rid(), A = mk(), B = mk(), C = mk(); await ready([A, B, C]);
    await host(A, room); await wait(2500); await join(B, room, 'B'); await wait(1000); await join(C, room, 'C');
    const all = (ws, n) => until(async () => { for (const w of ws) if ((await count(w)) !== n) return false; return true; }, 45000);
    const mesh = await all([A, B, C], 2);
    // a) sai e cria a sala de novo logo em seguida (o caso relatado)
    await js(A, 'leaveBtn.click(); 1'); await wait(1500);
    await host(A, room);
    const back = await all([A, B, C], 2);
    check('28a. (#32) Anfitrião sai e cria a sala de novo: os três voltam a se ver e ouvir', mesh && back,
      `antes=${mesh} | A=${await count(A)} B=${await count(B)} C=${await count(C)} hostA=${await js(A, 'isHost')}`);
    // b) o anfitrião sai de vez: um convidado assume a sala e uma pessoa nova consegue entrar
    await js(A, 'leaveBtn.click(); 1');
    const claimed = await until(async () => ((await js(B, 'isHost')) ? 1 : 0) + ((await js(C, 'isHost')) ? 1 : 0) === 1, 40000);
    const D = mk(); await ready([D]);
    await join(D, room, 'D');
    const withD = await all([B, C, D], 2);
    const tb = (await js(B, 'toastLog.slice()')).concat(await js(C, 'toastLog.slice()'));
    check('28b. (#32) Anfitrião sai de vez: um convidado assume a sala e quem chega encontra todos', claimed && withD && tb.some(t => /agora mantém a sala/.test(t)),
      `assumiu=${claimed} | B=${await count(B)} C=${await count(C)} D=${await count(D)}`);
    // c) o antigo anfitrião clica em "Criar sala" de novo: a sala já existe, então ele entra nela
    await host(A, room);
    const four = await all([A, B, C, D], 3);
    check('28c. (#32) Antigo anfitrião volta com "Criar sala": entra na sala existente e todos se veem', four && !(await js(A, 'isHost')) && !(await alerts(A)).length,
      `A=${await count(A)} B=${await count(B)} C=${await count(C)} D=${await count(D)} alertas=${JSON.stringify(await alerts(A))}`);
    destroy([A, B, C, D]); }
  // 29. (#30) A ligação direta entre dois convidados falha (simula NAT/firewall bloqueando)
  //     Bloqueio simulado: as ligações entre B e C vão para um ID que não existe e nunca abrem.
  if (want(29)) {
    const block = (w, n) => js(w, `(() => { window.__block = ${n}; if (!window.__rc) { window.__rc = Peer.prototype.connect;
      Peer.prototype.connect = function (id, o) {
        if (!String(id).startsWith('telashare-') && window.__block > 0) { window.__block--; return window.__rc.call(this, 'telashare-bloqueado-' + Math.random().toString(36).slice(2), o); }
        return window.__rc.call(this, id, o); }; } return 1; })()`);
    const fast = (w, extra) => js(w, `pairTimeoutMs = 2500; pairCfg = { max: 2, delays: [300, 300], slow: 2000 }; ${extra || ''} 1`);
    const all = (ws, n, ms) => until(async () => { for (const w of ws) if ((await count(w)) !== n) return false; return true; }, ms);
    // a) as 3 primeiras tentativas falham: o app tenta de novo e conecta
    { const room = rid(), A = mk(), B = mk(), C = mk(); await ready([A, B, C]);
      for (const w of [B, C]) { await block(w, 3); await fast(w); }
      await host(A, room); await wait(2500); await join(B, room, 'B'); await wait(1000); await join(C, room, 'C');
      const ok = await all([A, B, C], 2, 60000);
      check('29a. (#30) Ligação entre convidados falha nas primeiras tentativas e o app tenta de novo até conectar', ok,
        `A=${await count(A)} B=${await count(B)} C=${await count(C)}`);
      destroy([A, B, C]); }
    // b) bloqueada de vez: os dois são avisados e veem a pessoa na lista com aviso
    { const room = rid(), A = mk(), B = mk(), C = mk(); await ready([A, B, C]);
      for (const w of [B, C]) { await block(w, 1e9); await fast(w, 'pairWarnMs = 5000;'); }
      await host(A, room); await wait(2500); await join(B, room, 'Bia'); await wait(1000); await join(C, room, 'Caio');
      const warned = await until(async () =>
        (await js(B, 'toastLog.some(t => /Sem conexão direta com Caio/.test(t)) && !!document.querySelector("#peerList li.missing")')) &&
        (await js(C, 'toastLog.some(t => /Sem conexão direta com Bia/.test(t)) && !!document.querySelector("#peerList li.missing")')), 40000);
      if (!warned) console.log("  DEBUG", JSON.stringify(await Promise.all([A, B, C].map(w => js(w, `({ id: peer && peer.id, host: isHost, peers: [...peers.values()].map(p => p.name + ":" + !!(p.conn && p.conn.open)), roster: [...roster.keys()], toasts: toastLog, alerts: __alerts, status: status.textContent })`)))));
      const item = await js(B, '(document.querySelector("#peerList li.missing") || {}).textContent || ""');
      check('29b. (#30) Sem ligação direta: os dois são avisados e a pessoa aparece na lista com ⚠️', warned && /Caio/.test(item) && (await count(A)) === 2,
        `item="${item}" A=${await count(A)}`);
      // c) a rede "libera": a tentativa lenta conecta e o aviso some
      for (const w of [B, C]) await js(w, 'window.__block = 0; 1');
      const healed = await all([A, B, C], 2, 40000);
      const cleared = healed && await until(async () => !(await js(B, '!!document.querySelector("#peerList li.missing")')) && !(await js(C, '!!document.querySelector("#peerList li.missing")')), 10000);
      check('29c. (#30) Depois do limite, continua tentando devagar: quando a rede libera, conecta e o aviso some', healed && cleared,
        `B=${await count(B)} C=${await count(C)}`);
      destroy([A, B, C]); }
  }
  // 30. (#33) A chamada da TELA falha (a voz continua): a tela tem que chegar mesmo assim
  if (want(30)) { const room = rid(), A = mk(), B = mk(); await ready([A, B]);
    await host(A, room); await wait(2500); await join(B, room, 'Amigo');
    await until(async () => (await count(A)) === 1, 20000);
    await js(B, 'screenCfg.delays = [500, 500, 500, 500, 500]; 1');
    await js(A, 'screenCfg.waitMs = 4000; 1');
    // A recusa as 2 primeiras chamadas de tela (como se a conexão do vídeo falhasse)
    await js(A, `(() => { window.__drop = 2; const orig = handleIncomingCall;
      handleIncomingCall = call => { if (call.metadata && call.metadata.kind === 'screen' && window.__drop > 0) { window.__drop--; setTimeout(() => call.close(), 300); return; } orig(call); };
      return 1; })()`);
    const tiles = () => js(A, 'document.querySelectorAll(".tile").length');
    await js(B, `(() => { const c = document.createElement('canvas'); c.width = 320; c.height = 180;
      const g = c.getContext('2d'); setInterval(() => { g.fillStyle = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6,'0'); g.fillRect(0,0,320,180); }, 100);
      screenStream = c.captureStream(10); for (const p of peers.values()) callScreen(p.id); return 1; })()`);
    const shown = await until(async () => (await tiles()) === 1, 30000);
    check('30a. (#33) Chamada de tela falha nas primeiras vezes e é refeita até a tela aparecer', shown,
      `tiles=${await tiles()} recusadas=${2 - (await js(A, 'window.__drop'))}`);
    // a conexão do vídeo cai depois de aparecer (do lado de quem assiste): quem assiste pede de novo
    await js(A, `(() => { const p = [...peers.values()][0]; p.screenIn.peerConnection.close(); return 1; })()`);
    const back = await until(async () => (await js(A, `(() => { const p = [...peers.values()][0]; return !!(tileEl(p.id) && p.screenIn && p.screenIn.peerConnection.connectionState === 'connected'); })()`)), 40000);
    check('30b. (#33) Vídeo da tela cai depois de conectado: volta sozinho, com a voz intacta', back && (await count(A)) === 1,
      `tiles=${await tiles()} voz=${await count(A)}`);
    destroy([A, B]); }
  // 31. (#35) Compartilhar com áudio do PC não pode reenviar as vozes da sala.
  //     O áudio do PC (loopback) só existe no Windows: aqui a captura é simulada e o teste confere
  //     que o app PEDE para excluir o próprio som e AVISA quando o sistema não consegue.
  if (want(31)) { const A = mk(); await ready([A]);
    const share = (selfExcluded, withAudio) => js(A, `(async () => {
      openPicker = async () => 'tela-falsa';
      shareAudioChk.checked = ${withAudio};
      window.__gdm = null;
      navigator.mediaDevices.getDisplayMedia = async opts => {
        window.__gdm = JSON.parse(JSON.stringify(opts));
        const c = document.createElement('canvas'); c.width = 320; c.height = 180; c.getContext('2d').fillRect(0, 0, 320, 180);
        const tracks = [c.captureStream(5).getVideoTracks()[0]];
        if (opts.audio) {
          const o = audioCtx.createOscillator(); const d = audioCtx.createMediaStreamDestination(); o.connect(d); o.start();
          const t = d.stream.getAudioTracks()[0];
          const orig = t.getSettings.bind(t);
          t.getSettings = () => Object.assign(orig(), { restrictOwnAudio: ${selfExcluded} });
          tracks.push(t);
        }
        return new MediaStream(tracks);
      };
      toastLog.length = 0;
      await startShare();
      const r = { pedido: window.__gdm && window.__gdm.audio, separado: screenAudioExcludesSelf, toasts: toastLog.slice(), enviando: !!screenStream && screenStream.getAudioTracks().length };
      stopShare();
      return r; })()`);
    const ok = await share(true, true);
    const bad = await share(false, true);
    const mute = await share(true, false);
    check('31a. (#35) Com "Incluir áudio", o app pede a captura SEM o som do próprio app (restrictOwnAudio)',
      ok.pedido && ok.pedido.restrictOwnAudio === true && ok.pedido.echoCancellation === false && ok.separado === true && ok.enviando === 1 && !ok.toasts.some(t => /não conseguiu separar/.test(t)), JSON.stringify(ok));
    check('31b. (#35) Se o sistema não separar o som da chamada, quem compartilha é avisado', bad.separado === false && bad.toasts.some(t => /não conseguiu separar/.test(t)), JSON.stringify(bad.toasts));
    check('31c. (#35) Sem "Incluir áudio", nenhum áudio é capturado nem aviso aparece', mute.pedido === false && mute.enviando === 0 && !mute.toasts.length, JSON.stringify(mute));
    const mainSrc = require('fs').readFileSync(path.join(APP, 'main.js'), 'utf8');
    check('31d. (#35) O app liga o recurso do Chromium que exclui o próprio som (RestrictOwnAudio)', /appendSwitch\('enable-features', '[^']*RestrictOwnAudio/.test(mainSrc));
    destroy([A]); }
  // 32. (#34) Diagnóstico: diz quais ligações existem, quais faltam e o que aconteceu
  if (want(32)) {
    const block = (w, n) => js(w, `(() => { window.__block = ${n}; if (!window.__rc) { window.__rc = Peer.prototype.connect;
      Peer.prototype.connect = function (id, o) {
        if (!String(id).startsWith('telashare-') && window.__block > 0) { window.__block--; return window.__rc.call(this, 'telashare-bloqueado-' + Math.random().toString(36).slice(2), o); }
        return window.__rc.call(this, id, o); }; } return 1; })()`);
    const room = rid(), A = mk(), B = mk(), C = mk(); await ready([A, B, C]);
    for (const w of [B, C]) { await block(w, 1e9); await js(w, 'pairTimeoutMs = 2500; pairCfg = { max: 2, delays: [300, 300], slow: 60000 }; pairWarnMs = 4000; 1'); }
    await host(A, room); await wait(2500); await join(B, room, 'Bia'); await wait(1000); await join(C, room, 'Caio');
    await until(async () => await js(B, 'unreachable.size === 1'), 40000);
    lastCopied = '';
    await js(B, 'diagBtn.click(); 1');
    await until(async () => lastCopied.length > 0, 5000);
    const d = lastCopied;
    const hostLine = /- Host \(ID da sala\)[\s\S]*?dados: aberto \[connected\/(connected|completed) · host→host/.test(d);
    const voice = /voz: \[connected/.test(d);
    const missing = /SEM ligação comigo:\s*\n- Caio \([0-9a-f]{8}\) · avisado · tentativas: \d+/.test(d);
    const events = /entrei na sala/.test(d) && /Host \(ID da sala\) ligado/.test(d) && /Caio .*SEM conexão direta/.test(d);
    const noIp = !/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(d) && !/[0-9a-f]{1,4}:[0-9a-f]{1,4}:[0-9a-f]{1,4}:/i.test(d);
    check('32a. (#34) Diagnóstico mostra versão, sala e cada ligação (dados e voz, com tipo de conexão)', /^TelaShare v0\.0\.0-teste/.test(d) && d.includes('Sala: ' + room) && hostLine && voice, hostLine + ' ' + voice);
    check('32b. (#34) Diagnóstico lista quem está na sala SEM ligação comigo', missing);
    check('32c. (#34) Diagnóstico traz os últimos eventos (entrou, ligou, sem conexão direta)', events);
    check('32d. (#34) Diagnóstico não expõe endereços IP', noIp);
    if (process.env.MOSTRAR || !(hostLine && voice && missing && events && noIp)) console.log(d.split('\n').map(l => '    | ' + l).join('\n'));
    destroy([A, B, C]); }
  // 33. (#44) Atualização automática na versão instalada (o electron-updater é simulado:
  //     o teste envia os mesmos avisos que o processo principal envia)
  if (want(33)) {
    updateStateReply = { mode: 'auto', status: 'idle' }; updateCalls.length = 0;
    const A = mk(); await ready([A]); await wait(500);
    const send = st => A.webContents.send('update-status', Object.assign({ mode: 'auto' }, st));
    const ui = () => js(A, '({ txt: updateText.textContent, btn: !updateDownload.classList.contains("hidden") ? updateDownload.textContent : null, dot: aboutBtn.classList.contains("has-update"), toasts: toastLog.slice() })');
    await js(A, 'updateCheck.click(); 1'); await wait(200);
    send({ status: 'downloading', version: '9.9.9', percent: 42 }); await wait(200);
    const dl = await ui();
    send({ status: 'ready', version: '9.9.9' }); await wait(200);
    const rd = await ui();
    check('33a. (#44) Versão instalada: mostra o download em andamento e depois "Reiniciar e atualizar"',
      /Baixando a versão v9\.9\.9\.\.\. 42%/.test(dl.txt) && dl.btn === null && dl.dot &&
      /v9\.9\.9 pronta para instalar/.test(rd.txt) && /Reiniciar e atualizar/.test(rd.btn || '') && rd.toasts.some(t => /v9\.9\.9 baixada/.test(t)) && updateCalls.includes('check'),
      JSON.stringify({ dl, rd: rd.txt, btn: rd.btn, calls: updateCalls }));
    // em uma sala: pede confirmação; recusando, não reinicia
    const room = rid(); await host(A, room);
    await until(async () => await js(A, '!!(peer && peer.open)'), 15000);
    await js(A, 'window.confirm = () => false; updateDownload.click(); 1'); await wait(500);
    const refused = !updateCalls.includes('install') && (await js(A, '!!peer'));
    await js(A, 'window.confirm = () => true; updateDownload.click(); 1'); await wait(800);
    const installed = updateCalls.includes('install') && (await js(A, '!peer'));
    check('33b. (#44) "Reiniciar e atualizar" pergunta antes de sair da sala e só então instala', refused && installed, JSON.stringify({ refused, installed, calls: updateCalls }));
    send({ status: 'latest' }); await wait(200);
    const lt = await ui();
    send({ status: 'error', error: 'HttpError: 404' }); await wait(200);
    const er = await ui();
    check('33c. (#44) Mensagens de "versão mais recente" e de erro (ex.: repositório privado)',
      /mais recente \(v0\.0\.0-teste\)/.test(lt.txt) && !lt.dot && /Não foi possível verificar/.test(er.txt), JSON.stringify({ lt: lt.txt, er: er.txt }));
    updateStateReply = { mode: 'manual', status: 'idle' };
    destroy([A]); }
  // 34. (#44) O pacote do instalador está configurado para se atualizar pelo GitHub
  if (want(34)) {
    const pkg = JSON.parse(require('fs').readFileSync(path.join(APP, 'package.json'), 'utf8'));
    const b = pkg.build || {};
    const pub = [].concat(b.publish || [])[0] || {};
    const mainSrc = require('fs').readFileSync(path.join(APP, 'main.js'), 'utf8');
    check('34. (#44) Instalador NSIS + portátil, publicação no GitHub e electron-updater só na versão instalada',
      [].concat(b.win.target).includes('nsis') && [].concat(b.win.target).includes('portable') &&
      pub.provider === 'github' && pub.owner === 'JulianoMachadoS' && pub.repo === 'telashare' &&
      !!(pkg.dependencies || {})['electron-updater'] && b.files.some(f => /^node_modules\/\*\*/.test(f)) &&
      /!IS_PORTABLE/.test(mainSrc) && /require\('electron-updater'\)/.test(mainSrc) && /--publish never/.test(pkg.scripts.dist),
      JSON.stringify({ target: b.win.target, pub, dist: pkg.scripts.dist }));
  }
  // 35. (#46) App escondido: quem compartilha para de enviar o VÍDEO (o som continua)
  //     "Escondido" é simulado mudando document.visibilityState (como ao minimizar).
  if (want(35)) { const room = rid(), A = mk(), B = mk(); await ready([A, B]);
    await host(A, room); await wait(2500); await join(B, room, 'Amigo');
    await until(async () => (await count(A)) === 1, 20000);
    // B compartilha uma tela com vídeo E som
    await js(B, `(() => { const c = document.createElement('canvas'); c.width = 320; c.height = 180;
      const g = c.getContext('2d'); setInterval(() => { g.fillStyle = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6,'0'); g.fillRect(0,0,320,180); }, 100);
      const o = audioCtx.createOscillator(); const d = audioCtx.createMediaStreamDestination(); o.connect(d); o.start();
      screenStream = new MediaStream([c.captureStream(10).getVideoTracks()[0], d.stream.getAudioTracks()[0]]);
      for (const p of peers.values()) callScreen(p.id); return 1; })()`);
    await until(async () => (await js(A, 'document.querySelectorAll(".tile").length')) === 1, 20000);
    await wait(2000);
    const stats = () => js(A, `(async () => { const p = [...peers.values()][0]; const st = await p.screenIn.peerConnection.getStats(); let v = 0, a = 0;
      st.forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'video') v = r.framesDecoded || 0; if (r.type === 'inbound-rtp' && r.kind === 'audio') a = r.packetsReceived || 0; }); return { v, a }; })()`);
    const active = () => js(B, `(() => { const s = [...peers.values()][0].screenOut.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video'); return s.getParameters().encodings[0].active !== false; })()`);
    const delta = async ms => { const x = await stats(); await wait(ms); const y = await stats(); return { v: y.v - x.v, a: y.a - x.a }; };
    const setVis = v => js(A, `Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => '${v}' }); document.dispatchEvent(new Event('visibilitychange')); 1`);
    const before = await delta(2000);
    await setVis('hidden'); await wait(3500);
    const hiddenActive = await active();
    const hidden = await delta(2500);
    await setVis('visible');
    const resumed = await until(async () => await active(), 5000) && await until(async () => (await delta(1000)).v > 3, 8000);
    check('35a. (#46) App escondido: quem compartilha para de enviar o vídeo e aqui para de decodificar',
      before.v > 5 && !hiddenActive && hidden.v <= 2, JSON.stringify({ antes: before, escondido: hidden, enviando: hiddenActive }));
    check('35b. (#46) O som da tela e a voz continuam com o vídeo pausado', hidden.a > 20 && (await count(A)) === 1, JSON.stringify({ somDaTela: hidden.a, voz: await count(A) }));
    check('35c. (#46) Voltando para o app, o vídeo volta sozinho', resumed);
    // opção desligada: não pausa
    await js(A, 'pauseHiddenChk.checked = false; pauseHiddenChk.onchange(); 1');
    await setVis('hidden'); await wait(3500);
    const offActive = await active();
    const off = await delta(2000);
    await setVis('visible');
    check('35d. (#46) Com a opção desligada, o vídeo continua mesmo com o app escondido', offActive && off.v > 5, JSON.stringify({ off, enviando: offActive }));
    destroy([A, B]); }
  // 36. (#47) Tela em foco: a tela destacada fica grande e as outras viram miniaturas leves
  if (want(36)) { const THUMB_BR = 300000; const room = rid(), A = mk(), B = mk(), C = mk(); await ready([A, B, C]);
    await host(A, room); await wait(2500); await join(B, room, 'Bia'); await wait(1000); await join(C, room, 'Caio');
    await until(async () => (await count(A)) === 2 && (await count(B)) === 2 && (await count(C)) === 2, 40000);
    const share = w => js(w, `(() => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
      const g = c.getContext('2d'); setInterval(() => { g.fillStyle = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6,'0'); g.fillRect(0,0,1280,720); }, 100);
      currentQuality = QUALITY['1080_30']; screenStream = c.captureStream(10); for (const p of peers.values()) callScreen(p.id); return 1; })()`);
    await share(B); await share(C);
    await until(async () => (await js(A, 'document.querySelectorAll(".tile").length')) === 2, 30000);
    const aId = await js(A, 'peer.id'), bId = await js(B, 'peer.id'), cId = await js(C, 'peer.id');
    // como B e C estão enviando a tela deles para A
    const enc = (w) => js(w, `(() => { const p = peers.get('${aId}'); const pc = p && p.screenOut && p.screenOut.peerConnection; if (!pc || pc.connectionState !== 'connected') return null;
      const e = pc.getSenders().find(s => s.track && s.track.kind === 'video').getParameters().encodings[0];
      return { scale: e.scaleResolutionDownBy, br: e.maxBitrate, fps: e.maxFramerate, active: e.active !== false, mode: p.viewMode || 'full' }; })()`);
    await until(async () => (await enc(B)) && (await enc(C)), 20000); await wait(1500);
    const grid0 = await enc(B);
    // "normal" = sem miniatura; a qualidade adaptativa (#15) pode ter baixado até a escala 2 sozinha
    const isFull = e => e && e.mode === 'full' && e.active && e.scale <= 2 && e.br > THUMB_BR && e.fps > 10;
    // A destaca a tela de B
    await js(A, `tileEl('${bId}').querySelector('.focusBtn').click(); 1`);
    const thumbed = await until(async () => { const c = await enc(C); return c && c.scale >= 4 && c.br <= 300000 && c.fps <= 10; }, 10000);
    const layout = await js(A, `({ focus: grid.classList.contains('focus'), big: tileEl('${bId}').classList.contains('focused'), small: !tileEl('${cId}').classList.contains('focused') })`);
    const bFull = await enc(B), cThumb = await enc(C);
    check('36a. (#47) Destacar uma tela: ela fica grande e as outras viram miniaturas', layout.focus && layout.big && layout.small, JSON.stringify(layout));
    check('36b. (#47) A miniatura é enviada em qualidade bem menor; a tela em foco continua normal',
      thumbed && isFull(bFull) && cThumb.mode === 'thumb', JSON.stringify({ grade: grid0, emFoco: bFull, miniatura: cThumb }));
    // trocar o foco para C: os papéis se invertem
    await js(A, `tileEl('${cId}').querySelector('video').click(); 1`);
    const swapped = await until(async () => { const b = await enc(B), c = await enc(C); return b && c && b.mode === 'thumb' && b.scale >= 4 && isFull(c); }, 10000);
    // voltar para a grade: as duas normais
    await js(A, `tileEl('${cId}').querySelector('.focusBtn').click(); 1`);
    const back = await until(async () => { const b = await enc(B), c = await enc(C); return b && c && isFull(b) && isFull(c); }, 10000);
    check('36c. (#47) Trocar o foco inverte as qualidades; voltar para a grade restaura as duas', swapped && back && !(await js(A, 'grid.classList.contains("focus")')));
    // app escondido tem prioridade sobre o foco: nada é enviado
    await js(A, `tileEl('${bId}').querySelector('.focusBtn').click(); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); 1`);
    const allOff = await until(async () => { const b = await enc(B), c = await enc(C); return b && c && !b.active && !c.active; }, 10000);
    check('36d. (#47) Com o app escondido, nem a tela em foco nem as miniaturas são enviadas', allOff);
    destroy([A, B, C]); }
  // 37. (#37) Esconder a barra lateral: barra mínima com o essencial, Ctrl+B e preferência salva
  if (want(37)) { const room = rid(), A = mk(); await ready([A]);
    await host(A, room);
    await until(async () => await js(A, '!!(peer && peer.open)'), 15000);
    const st = () => js(A, `({ hidden: document.body.classList.contains('sidebar-hidden'), sideW: sidebar.offsetWidth, mini: !miniBar.classList.contains('hidden'),
      stageW: stage.offsetWidth, winW: window.innerWidth, mute: miniMute.textContent, muted: micMuted, leave: !miniLeave.classList.contains('hidden'),
      saved: localStorage.getItem('ts_sidebarHidden') })`);
    const open0 = await st();
    await js(A, 'hideSidebarBtn.click(); 1'); await wait(200);
    const closed = await st();
    check('37a. (#37) Esconder a barra: as telas ocupam a janela toda e aparece a barra mínima',
      !open0.hidden && open0.sideW > 200 && closed.hidden && closed.sideW === 0 && closed.mini && closed.stageW === closed.winW && closed.leave && closed.saved === 'true',
      JSON.stringify({ open0, closed }));
    await js(A, 'miniMute.click(); 1'); await wait(300);
    const m1 = await st();
    await js(A, 'miniMute.click(); 1'); await wait(300);
    const m2 = await st();
    check('37b. (#37) O mudo da barra mínima funciona e mostra o estado', m1.muted && m1.mute === '🔇' && !m2.muted && m2.mute === '🎤', JSON.stringify({ m1: [m1.muted, m1.mute], m2: [m2.muted, m2.mute] }));
    await js(A, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true })); 1`); await wait(200);
    const shown = await st();
    await js(A, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true })); 1`); await wait(200);
    const hiddenAgain = await st();
    check('37c. (#37) Ctrl+B mostra e esconde a barra', !shown.hidden && shown.sideW > 200 && !shown.mini && hiddenAgain.hidden && hiddenAgain.mini);
    // a preferência vale na próxima abertura
    await js(A, 'location.reload(); 1').catch(() => {}); await wait(3500);
    await until(async () => { try { return await js(A, "!!document.getElementById('hostBtn').onclick"); } catch { return false; } }, 20000);
    const reopened = await st();
    await js(A, 'miniShow.click(); 1');
    check('37d. (#37) A barra continua escondida depois de reabrir o app', reopened.hidden && reopened.mini && !reopened.leave, JSON.stringify(reopened));
    destroy([A]); }
  // 38. (#48) Voltar para a última sala com um clique
  if (want(38)) { const room = rid(), A = mk(), B = mk(); await ready([A, B]);
    const btn = w => js(w, '({ show: !rejoinBtn.classList.contains("hidden"), txt: rejoinBtn.textContent })');
    const first = await btn(B);
    await host(A, room); await wait(2500); await join(B, room, 'Amigo');
    await until(async () => (await count(A)) === 1 && (await count(B)) === 1, 20000);
    await js(B, 'leaveBtn.click(); 1'); await wait(500);
    const after = await btn(B);
    await js(B, 'rejoinBtn.click(); 1');
    const back = await until(async () => (await count(A)) === 1 && (await count(B)) === 1, 30000);
    check('38a. (#48) Depois de sair, aparece "Voltar para a sala" e um clique volta para ela (sala ainda aberta)',
      !first.show && after.show && after.txt.includes(room) && /agora há pouco/.test(after.txt) && back && !(await js(B, 'isHost')),
      JSON.stringify({ first, after, back }));
    // todos saem: quem clicar primeiro abre a sala de novo, e o outro entra nela
    await js(B, 'leaveBtn.click(); 1'); await js(A, 'leaveBtn.click(); 1'); await wait(2500);
    await js(B, 'rejoinBtn.click(); 1');
    await until(async () => await js(B, '!!(peer && peer.open && isHost)'), 20000);
    await js(A, 'rejoinBtn.click(); 1');
    const reopened = await until(async () => (await count(A)) === 1 && (await count(B)) === 1, 30000);
    check('38b. (#48) Sala vazia: o primeiro a voltar abre a sala de novo e o outro entra nela', reopened && (await js(B, 'isHost')) && !(await js(A, 'isHost')) && !(await alerts(A)).length && !(await alerts(B)).length,
      `A=${await count(A)} B=${await count(B)} alertas=${JSON.stringify((await alerts(A)).concat(await alerts(B)))}`);
    destroy([A, B]); }
  // 39. (#49) Lembrar tamanho e posição da janela (módulo window-state.js do app)
  if (want(39)) {
    const ws = require(path.join(APP, 'window-state.js'));
    const os = require('os'), fs = require('fs');
    const one = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }];
    const two = one.concat([{ workArea: { x: 1920, y: 0, width: 1920, height: 1040 } }]);
    const d0 = ws.fit(null, one);
    const keep = ws.fit({ x: 2100, y: 80, width: 1400, height: 900, maximized: true }, two);
    const gone = ws.fit({ x: 2100, y: 80, width: 1400, height: 900 }, one); // o 2º monitor foi desconectado
    const tiny = ws.fit({ x: 10, y: 10, width: 300, height: 200 }, one);
    const huge = ws.fit({ x: 0, y: 0, width: 5000, height: 4000 }, one);
    check('39a. (#49) Restaura posição e tamanho; monitor desconectado abre centralizado; respeita mínimo e tamanho da tela',
      d0.width === 1280 && d0.height === 800 && d0.x === undefined &&
      keep.x === 2100 && keep.y === 80 && keep.width === 1400 && keep.maximized === true &&
      gone.x === undefined && gone.width === 1400 &&
      tiny.width === 900 && tiny.height === 600 && huge.width === 1920 && huge.height === 1040,
      JSON.stringify({ d0, keep, gone, tiny, huge }));
    // salva de verdade quando a janela muda e ao fechar
    const file = path.join(os.tmpdir(), 'telashare-teste-' + Date.now(), 'window-state.json');
    const w = new BrowserWindow({ show: false, width: 1000, height: 700, x: 120, y: 90 });
    ws.track(w, file);
    w.setBounds({ x: 150, y: 110, width: 1100, height: 750 });
    await wait(1200);
    const saved = ws.load(file);
    w.setBounds({ x: 160, y: 120, width: 1050, height: 720 });
    w.close(); await wait(300);
    const onClose = ws.load(file);
    check('39b. (#49) Salva o tamanho e a posição quando a janela muda e ao fechar',
      saved && saved.width === 1100 && saved.height === 750 && saved.x === 150 &&
      onClose && onClose.width === 1050 && onClose.x === 160 && onClose.maximized === false,
      JSON.stringify({ saved, onClose }));
    try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch {}
  }
  // 40. (#55) Várias mudanças de qualidade da tela ao mesmo tempo: a última pedida é a que vale
  if (want(40)) { const room = rid(), A = mk(), B = mk(); await ready([A, B]);
    await host(A, room); await wait(2500); await join(B, room, 'Amigo');
    await until(async () => (await count(A)) === 1, 20000);
    await js(B, `(() => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
      const g = c.getContext('2d'); setInterval(() => { g.fillStyle = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6,'0'); g.fillRect(0,0,1280,720); }, 100);
      currentQuality = QUALITY['1080_30']; screenStream = c.captureStream(10); for (const p of peers.values()) callScreen(p.id); return 1; })()`);
    await until(async () => (await js(B, '[...peers.values()][0].screenOut.peerConnection.connectionState')) === 'connected', 20000);
    await wait(1500);
    const rapid = last => js(B, `(async () => { const p = [...peers.values()][0]; const pc = p.screenOut.peerConnection;
      p.viewMode = 'full'; const modes = ['thumb', 'off', 'full', 'thumb'];
      for (let i = 0; i < 24; i++) applyEncoding(pc, i % 3, modes[i % 4]);
      applyEncoding(pc, ${last.level}, '${last.mode}');
      await new Promise(r => setTimeout(r, 1500));
      const e = pc.getSenders().find(s => s.track && s.track.kind === 'video').getParameters().encodings[0];
      return { active: e.active !== false, scale: e.scaleResolutionDownBy, br: e.maxBitrate, fps: e.maxFramerate }; })()`);
    const r1 = await rapid({ level: 0, mode: 'full' });
    const r2 = await rapid({ level: 1, mode: 'thumb' });
    const r3 = await rapid({ level: 0, mode: 'off' });
    check('40. (#55) 25 mudanças seguidas de qualidade: a última pedida é a que fica valendo',
      r1.active && r1.scale === 1 && r1.br === 4500000 && r1.fps === 30 &&
      r2.active && r2.scale === 4 && r2.br === 300000 && r2.fps === 10 &&
      !r3.active, JSON.stringify({ r1, r2, r3 }));
    destroy([A, B]); }
  // 42. (#57) A chamada de VOZ trava (nunca é atendida): o app tem que refazer até ter áudio
  //     a) quem liga percebe e refaz; b) quem recebe percebe e pede para ligar de novo.
  //     No código antigo, os nomes apareciam mas o áudio nunca chegava (A=0, B=0).
  if (want(42)) {
    for (const lado of ['a', 'b']) {
      const room = rid(), A = mk(), B = mk(); await ready([A, B]);
      // A (anfitrião) ignora a 1ª chamada de voz: ela fica travada, sem resposta
      await js(A, `(() => { window.__drop = 1; const orig = handleIncomingCall;
        handleIncomingCall = call => { if (call.metadata && call.metadata.kind === 'mic' && window.__drop > 0) { window.__drop--; return; } orig(call); };
        micCfg.connectMs = 4000; return 1; })()`);
      // b) quem liga (B, o convidado) demora para perceber: quem recebe (A) é quem pede
      await js(B, `micCfg.connectMs = ${lado === 'a' ? 4000 : 600000}; 1`);
      await host(A, room); await wait(2500); await join(B, room, 'Amigo');
      const names = await until(async () => (await js(A, 'peers.size')) === 1 && (await js(A, '[...peers.values()][0].helloed === true')), 20000);
      const ok = await until(async () => (await count(A)) === 1 && (await count(B)) === 1, 40000);
      const log = (await js(A, 'diagLog.slice()')).concat(await js(B, 'diagLog.slice()')).filter(l => /voz com/.test(l));
      check(lado === 'a' ? '42a. (#57) Voz travada: quem liga percebe, refaz a chamada e o áudio chega nos dois lados'
                         : '42b. (#57) Voz travada: quem recebe percebe, pede de novo e o áudio chega nos dois lados',
        names && ok && (await js(A, 'window.__drop')) === 0 && log.length > 0, JSON.stringify({ names, ok, A: await count(A), B: await count(B), log }));
      destroy([A, B]);
    }
  }
  // 43. (#57) Duas pessoas entram EXATAMENTE ao mesmo tempo: todos têm que se ver e se ouvir
  if (want(43)) {
    let ok = 0; const rounds = 3, info = [];
    for (let i = 0; i < rounds; i++) {
      const room = rid(), A = mk(), B = mk(), C = mk(); await ready([A, B, C]);
      await host(A, room); await wait(2500);
      await Promise.all([join(B, room, 'B'), join(C, room, 'C')]);
      const r = await until(async () => (await count(A)) === 2 && (await count(B)) === 2 && (await count(C)) === 2, 45000);
      info.push(`${await count(A)}/${await count(B)}/${await count(C)}`);
      if (!r) await dump([A, B, C]);
      if (r) ok++;
      destroy([A, B, C]);
    }
    check(`43. (#57) Duas pessoas entrando ao mesmo tempo: todos se veem e se ouvem (${rounds} rodadas)`, ok === rounds, info.join(' | '));
  }
  console.log(`\nRESULTADO: ${results.filter(Boolean).length}/${results.length} passaram (testes LOCAIS: mesmo computador, sem rede real entre casas)`);
  app.exit(results.length && results.every(Boolean) ? 0 : 1);
});
