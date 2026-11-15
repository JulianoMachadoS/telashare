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
const ready = async ws => { await wait(2500); for (const w of ws) await js(w, 'window.__alerts=[]; window.alert=m=>window.__alerts.push(m); 1'); };
const host = (w, room) => js(w, `nameInput.value='Host'; roomInput.value='${room}'; hostBtn.click(); 1`);
const join = (w, room, nm) => js(w, `nameInput.value='${nm}'; roomInput.value='${room}'; joinBtn.click(); 1`);
const count = w => js(w, `[...peers.values()].filter(p => p.conn && p.conn.open && p.audioEl && p.audioEl.srcObject).length`);
const alerts = w => js(w, '__alerts');
async function until(fn, ms) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(500); } return false; }
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log((ok ? '✅ PASSOU ' : '❌ FALHOU ') + name + (extra ? ' — ' + extra : '')); };
const destroy = ws => ws.forEach(w => w.destroy());
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
  console.log(`\nRESULTADO: ${results.filter(Boolean).length}/${results.length} passaram (testes LOCAIS: mesmo computador, sem rede real entre casas)`);
  app.exit(results.length && results.every(Boolean) ? 0 : 1);
});
