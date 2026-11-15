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
 * Rodar:  npm test        (leva ~4 minutos)
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

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  console.log('TelaShare: testes LOCAIS (várias janelas no mesmo computador)\n');
  // 1. Caso normal (3 rodadas)
  for (let i = 1; i <= 3; i++) {
    const room = rid(), A = mk(), B = mk(); await ready([A, B]);
    await host(A, room); await wait(2500); await join(B, room, 'Amigo');
    const ok = await until(async () => (await count(A)) === 1 && (await count(B)) === 1, 20000);
    check(`1.${i} Criar sala + entrar (voz conectada nos dois lados)`, ok);
    destroy([A, B]);
  }
  // 2. Amigo entra antes do anfitrião criar
  { const room = rid(), A = mk(), B = mk(); await ready([A, B]);
    await join(B, room, 'Amigo'); await wait(5000); await host(A, room);
    const ok = await until(async () => (await count(A)) === 1 && (await count(B)) === 1, 30000);
    check('2. Entrar antes da sala existir', ok, JSON.stringify(await alerts(B)));
    destroy([A, B]); }
  // 3. Sala inexistente
  { const C = mk(); await ready([C]);
    await join(C, rid(), 'X');
    const ok = await until(async () => (await alerts(C)).some(a => a.startsWith('Sala não encontrada')), 60000);
    check('3. Código errado mostra "Sala não encontrada"', ok);
    destroy([C]); }
  // 4. Três pessoas (malha completa)
  { const room = rid(), A = mk(), B = mk(), C = mk(); await ready([A, B, C]);
    await host(A, room); await wait(2500); await join(B, room, 'B'); await wait(1000); await join(C, room, 'C');
    const ok = await until(async () => (await count(A)) === 2 && (await count(B)) === 2 && (await count(C)) === 2, 30000);
    check('4. Três pessoas, todos conectados a todos', ok, `A=${await count(A)} B=${await count(B)} C=${await count(C)}`);
    destroy([A, B, C]); }
  // 5. Sair da sala
  { const room = rid(), A = mk(), B = mk(); await ready([A, B]);
    await host(A, room); await wait(2500); await join(B, room, 'Amigo');
    await until(async () => (await count(A)) === 1, 20000);
    await js(B, 'leaveBtn.click(); 1');
    const ok = await until(async () => (await count(A)) === 0, 15000);
    check('5. Quem sai some da lista do anfitrião', ok);
    destroy([A, B]); }

  // 6. Áudio chega e o volume acima de 100% aumenta de verdade
  { const room = rid(), A = mk(), B = mk(); await ready([A, B]);
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
  { const room = rid(), A = mk(), B = mk(); await ready([A, B]);
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
  { const room = rid(), A = mk(), B = mk(); await ready([A, B]);
    await host(A, room); await wait(2500); await join(B, room, 'Amigo');
    await until(async () => (await count(A)) === 1, 20000);
    const t0 = Date.now();
    await js(B, 'leaveBtn.click(); 1');
    const gone = await until(async () => (await js(A, 'peers.size')) === 0, 15000);
    check('11. "Sair da sala" remove rápido', gone && Date.now() - t0 < 4000, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
    destroy([A, B]); }
  // 12. Ninguém é removido por engano em 20s de conexão parada
  { const room = rid(), A = mk(), B = mk(); await ready([A, B]);
    await host(A, room); await wait(2500); await join(B, room, 'Amigo');
    await until(async () => (await count(A)) === 1, 20000);
    await wait(20000);
    check('12. Conexão estável por 20s sem remoções falsas', (await count(A)) === 1 && (await count(B)) === 1);
    destroy([A, B]); }

  // 13. Indicador de mudo
  { const room = rid(), A = mk(), B = mk(); await ready([A, B]);
    await host(A, room); await wait(2500); await join(B, room, 'Amigo');
    await until(async () => (await count(A)) === 1, 20000);
    await wait(1000);
    const liMuted = () => js(A, 'document.querySelector("#peerList li").classList.contains("muted")');
    await js(B, 'muteBtn.click(); 1');
    const on = await until(liMuted, 5000);
    await js(B, 'muteBtn.click(); 1');
    const off = await until(async () => !(await liMuted()), 5000);
    check('13. Indicador de mudo aparece e some para os outros', on && off);
  // 14. Ducking: o som das telas abaixa quando alguém fala (bipe do microfone falso)
    const duckSeen = await js(A, `(async () => { let min = 1; const t = Date.now();
      while (Date.now() - t < 4000) { min = Math.min(min, duckFactor); await new Promise(r => setTimeout(r, 30)); }
      return min; })()`);
    await js(A, 'duckChk.checked = false; duckChk.onchange(); 1');
    const noDuck = await js(A, `(async () => { let min = 1; const t = Date.now();
      while (Date.now() - t < 3000) { min = Math.min(min, duckFactor); await new Promise(r => setTimeout(r, 30)); }
      return min; })()`);
    check('14. Ducking abaixa o som das telas quando alguém fala (e desliga na opção)', duckSeen === 0.3 && noDuck === 1, `ligado=${duckSeen} desligado=${noDuck}`);
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
  { const room = rid(), A = mk(), C = mk(); await ready([A, C]);
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
  { const A = mk(); await ready([A]);
    const t = await js(A, 'document.getElementById("legal").innerText');
    check('17. Aviso legal visível com licença e link do projeto original',
      /AGPLv3/.test(t) && /github\.com\/JulianoMachadoS\/telashare/.test(t) && /Juliano Machado da Silva/.test(t), t.replace(/\n/g, ' | '));
    destroy([A]); }

  // 18. Botão ℹ️: janela Sobre com licenças e link do repositório
  { const A = mk(); await ready([A]);
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
  console.log(`\nRESULTADO: ${results.filter(Boolean).length}/${results.length} passaram (testes LOCAIS: mesmo computador, sem rede real entre casas)`);
  app.exit(results.every(Boolean) ? 0 : 1);
});
