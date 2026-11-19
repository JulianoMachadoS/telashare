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
/* INTERFACE: barra lateral escondida, janela "Sobre" (licenças) e atualizações */

// =====================================================================
// BARRA LATERAL ESCONDIDA (#37): a área das telas ocupa a janela toda e fica só uma barra
// mínima com o essencial (mostrar a barra, status, mudo, compartilhar e sair). Ctrl+B alterna.
// =====================================================================
function setSidebarHidden(h) {
  document.body.classList.toggle('sidebar-hidden', h);
  $('miniBar').classList.toggle('hidden', !h);
  store.set('sidebarHidden', h);
  syncMiniBar();
}
function toggleSidebar() { setSidebarHidden(!document.body.classList.contains('sidebar-hidden')); }

// Os botões da barra mínima espelham os botões da barra lateral
function syncMiniBar() {
  if ($('miniBar').classList.contains('hidden')) return;
  const inRoom = !$('roomBox').classList.contains('hidden');
  const m = $('miniMute');
  m.textContent = micMuted ? '🔇' : '🎤';
  m.classList.toggle('on', micMuted);
  m.title = micMuted ? 'Microfone mudo (clique para ligar)' : 'Microfone ligado (clique para mutar)';
  const s = $('miniShare');
  s.textContent = screenStream ? '⏹️' : '🖥️';
  s.title = screenStream ? 'Parar compartilhamento' : 'Compartilhar tela';
  s.disabled = $('shareBtn').disabled;
  $('miniLeave').classList.toggle('hidden', !inRoom);
  const badge = $('connBadge');
  $('miniDot').className = 'bdot ' + (['good', 'warn', 'bad', 'wait'].find(c => badge.classList.contains(c)) || '');
  $('miniDot').title = $('connText').textContent;
}

function initSidebarToggle() {
  $('hideSidebarBtn').onclick = () => setSidebarHidden(true);
  $('miniShow').onclick = () => setSidebarHidden(false);
  $('miniMute').onclick = () => $('muteBtn').click();
  $('miniShare').onclick = () => $('shareBtn').click();
  $('miniLeave').onclick = () => $('leaveBtn').click();
  // qualquer mudança nos botões/selo da barra lateral atualiza a barra mínima
  const obs = new MutationObserver(syncMiniBar);
  for (const id of ['muteBtn', 'shareBtn', 'roomBox', 'connBadge']) {
    obs.observe($(id), { attributes: true, childList: true, characterData: true, subtree: true });
  }
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); toggleSidebar(); }
  });
  setSidebarHidden(store.get('sidebarHidden', false));
}

// =====================================================================
// SOBRE (informações, licenças e repositório)
// =====================================================================
const licenseCache = {};
async function loadLicense(key) {
  if (!(key in licenseCache)) {
    let t = null;
    try { t = await window.native.readLicense(key); } catch {}
    licenseCache[key] = t || 'Texto não encontrado. Veja a licença em https://github.com/JulianoMachadoS/telashare';
  }
  return licenseCache[key];
}

async function showLicenseTab(key) {
  document.querySelectorAll('#about .tab').forEach(b => b.classList.toggle('active', b.dataset.lic === key));
  const third = key === 'third';
  $('thirdParty').classList.toggle('hidden', !third);
  $('licenseText').classList.toggle('hidden', third);
  if (!third) {
    $('licenseText').textContent = await loadLicense(key);
    $('licenseText').scrollTop = 0;
  }
}

// ---------- aviso de nova versão ----------
let updateInfo = null;
async function checkUpdate(manual = false) {
  const box = $('updateText');
  box.textContent = 'Verificando...';
  $('updateDownload').classList.add('hidden');
  let current = '0.0.0';
  try { current = await window.native.getVersion(); } catch {}
  let r;
  try { r = await window.native.checkUpdate(); } catch { r = { error: 'offline' }; }
  updateInfo = r;
  if (!r || r.error) {
    box.textContent = r && r.error === 'not-found'
      ? 'Não foi possível verificar: nenhuma versão pública encontrada no GitHub.'
      : 'Não foi possível verificar agora (sem internet?).';
    return;
  }
  if (isNewer(r.tag, current)) {
    box.innerHTML = '';
    const strong = document.createElement('strong');
    strong.textContent = `Nova versão ${r.tag} disponível!`;
    box.append(strong, document.createTextNode(` Você está na v${current}. ` +
      'Dica: a versão com instalador (TelaShare-Setup) se atualiza sozinha.'));
    $('updateDownload').classList.remove('hidden');
    $('aboutBtn').classList.add('has-update');
    if (!manual) showToast(`⬆️ Nova versão ${r.tag} disponível. Clique no botão "i" para baixar.`, 'info', 8000);
  } else {
    box.textContent = `✅ Você está na versão mais recente (v${current}).`;
    $('aboutBtn').classList.remove('has-update');
  }
}

// ---------- atualização automática (#44, só na versão instalada) ----------
// O processo principal (electron-updater) baixa a versão nova em segundo plano e avisa aqui.
let updateReadyToasted = false;
let updateCurrent = '';
function renderAutoUpdate(st) {
  const box = $('updateText'), btn = $('updateDownload');
  btn.classList.add('hidden');
  const cur = updateCurrent;
  switch (st && st.status) {
    case 'checking':
      box.textContent = 'Verificando...';
      break;
    case 'downloading':
      box.textContent = `⬇️ Baixando a versão v${st.version}... ${st.percent || 0}%`;
      $('aboutBtn').classList.add('has-update');
      break;
    case 'ready': {
      box.innerHTML = '';
      const strong = document.createElement('strong');
      strong.textContent = `Versão v${st.version} pronta para instalar.`;
      box.append(strong, document.createTextNode(' Reinicie para atualizar, ou ela será instalada quando você fechar o TelaShare.'));
      btn.textContent = '🔄 Reiniciar e atualizar';
      btn.classList.remove('hidden');
      $('aboutBtn').classList.add('has-update');
      if (!updateReadyToasted) {
        updateReadyToasted = true;
        showToast(`⬆️ Versão v${st.version} baixada. Clique no "i" para reiniciar e atualizar (ou feche o app quando quiser).`, 'info', 10000);
      }
      break;
    }
    case 'latest':
      box.textContent = `✅ Você está na versão mais recente (${cur}). As atualizações são automáticas.`;
      $('aboutBtn').classList.remove('has-update');
      break;
    case 'error':
      box.textContent = 'Não foi possível verificar agora (sem internet ou sem acesso às versões no GitHub).';
      break;
    default:
      box.textContent = 'As atualizações são automáticas: o app verifica ao abrir e a cada 4 horas.';
  }
}

async function installUpdate() {
  if (peer && !confirm('Reiniciar agora para atualizar?\nVocê vai sair da sala (dá para entrar de novo depois).')) return;
  if (peer) leaveRoom();
  await window.native.updateInstall();
}

async function initUpdates() {
  try { updateCurrent = 'v' + (await window.native.getVersion()); } catch {}
  let st = null;
  try { st = await window.native.updateState(); } catch {}
  if (st && st.mode === 'auto') {
    window.native.onUpdateStatus(renderAutoUpdate);
    renderAutoUpdate(st);
    $('updateCheck').onclick = () => window.native.updateCheck();
    $('updateDownload').onclick = installUpdate;
  } else {
    // .exe portátil (ou rodando pelo código): aviso de nova versão + botão de download
    $('updateCheck').onclick = () => checkUpdate(true);
    $('updateDownload').onclick = () => window.native.openLink('releases');
    checkUpdate(false); // uma consulta ao abrir; mostra aviso se houver versão nova
  }
}

function openAbout() {
  $('about').classList.remove('hidden');
  showLicenseTab('license');
}
function closeAbout() { $('about').classList.add('hidden'); }

function initAbout() {
  $('aboutBtn').onclick = openAbout;
  $('aboutClose').onclick = closeAbout;
  $('aboutX').onclick = closeAbout;
  $('about').addEventListener('click', e => { if (e.target === $('about')) closeAbout(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('about').classList.contains('hidden')) closeAbout(); });
  document.querySelectorAll('#about [data-link]').forEach(b => (b.onclick = () => window.native.openLink(b.dataset.link)));
  document.querySelectorAll('#about [data-lic]').forEach(b => (b.onclick = () => showLicenseTab(b.dataset.lic)));
  document.querySelectorAll('#about [data-lic-view]').forEach(b => (b.onclick = async () => {
    $('thirdText').classList.remove('hidden');
    $('thirdText').textContent = await loadLicense(b.dataset.licView);
    $('thirdText').scrollTop = 0;
  }));
  $('chromiumLic').onclick = () => window.native.openChromiumLicenses();
}
