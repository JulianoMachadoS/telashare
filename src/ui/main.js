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
/* INTERFACE: liga a tela ao núcleo (preenche o contrato `ui`) e inicia o app */

// Preferências lidas direto dos campos da tela, no momento em que o núcleo pergunta
const PREFS = {
  name: () => $('nameInput').value.trim(),
  turnUrl: () => $('turnUrl').value,
  turnUser: () => $('turnUser').value,
  turnPass: () => $('turnPass').value,
  mic: () => $('micSelect').value,
  out: () => $('outSelect').value,
  micVol: () => +$('micVol').value,
  outVol: () => +$('outVol').value,
  shareVol: () => +$('shareVol').value,
  echo: () => $('echoChk').checked,
  noise: () => $('noiseChk').checked,
  agc: () => $('agcChk').checked,
  duck: () => $('duckChk').checked,
  sounds: () => $('soundChk').checked,
  soundVol: () => +$('soundVol').value,
  shareAudio: () => $('shareAudioChk').checked,
  quality: () => $('qualitySelect').value,
  pauseHidden: () => $('pauseHiddenChk').checked
};

Object.assign(ui, {
  pref: key => (PREFS[key] ? PREFS[key]() : undefined),
  alert: msg => window.alert(msg),
  toast: renderToast,
  status: t => { $('status').textContent = t; },
  badge: paintBadge,
  lockForm,
  roomEntered: paintRoomEntered,
  roomLeft: paintRoomLeft,
  renderPeers: paintPeerList,
  peerMuted: paintMuted,
  peerSpeaking: paintSpeaking,
  peerNet: paintNet,
  tileNames: updateAllTileNames,
  screenShown: (id, stream, isLocal) => { showTile(id, stream, isLocal); if (isLocal) applyPreviewHidden(); },
  screenRemoved: removeTile,
  paintFocus,
  sendQuality: paintSendQuality,
  shareChanged: paintShareBtn,
  muteChanged: paintMuteBtn,
  monitorChanged: paintMonitorBtn,
  recordState: paintRecBtn,
  micWarn: show => $('micWarn').classList.toggle('hidden', !show),
  devices: (inputs, outputs, wantMic, wantOut) => {
    fillSelect($('micSelect'), inputs, wantMic);
    fillSelect($('outSelect'), outputs, wantOut);
  },
  selectMic: selectMicOption,
  pickSource: () => openPicker()
});

// =====================================================================
// INICIALIZAÇÃO
// =====================================================================
async function init() {
  $('nameInput').value = store.get('name', '');
  for (const k of ['turnUrl', 'turnUser', 'turnPass']) {
    $(k).value = store.get(k, '');
    $(k).onchange = () => store.set(k, $(k).value.trim());
  }
  $('roomInput').value = store.get('room', '');
  $('micVol').value = store.get('micVol', 100);
  $('outVol').value = store.get('outVol', 100);
  $('shareVol').value = store.get('shareVol', 100);
  $('noiseChk').checked = store.get('noise', true);
  $('echoChk').checked = store.get('echo', true);
  $('agcChk').checked = store.get('agc', false);
  $('duckChk').checked = store.get('duck', true);
  $('soundChk').checked = store.get('sounds', true);
  $('soundVol').value = store.get('soundVol', 60);
  $('soundVolVal').textContent = $('soundVol').value + '%';
  $('soundChk').onchange = () => store.set('sounds', $('soundChk').checked);
  $('soundVol').oninput = () => { $('soundVolVal').textContent = $('soundVol').value + '%'; store.set('soundVol', +$('soundVol').value); };
  $('soundVol').onchange = () => playSound('join');
  $('diceBtn').onclick = () => { $('roomInput').value = generateRoomCode(); $('roomInput').select(); };
  $('duckChk').onchange = () => { store.set('duck', $('duckChk').checked); applyVolumes(); };
  $('shareAudioChk').checked = store.get('shareAudio', true);
  $('qualitySelect').value = store.get('quality', '1080_30');
  $('micVolVal').textContent = $('micVol').value + '%';
  $('outVolVal').textContent = $('outVol').value + '%';
  $('shareVolVal').textContent = $('shareVol').value + '%';

  await initCore();
  meterLoop();

  if (window.native.platform !== 'win32') {
    $('shareAudioChk').parentElement.title = 'Áudio do sistema só é capturado no Windows';
  }

  // eventos
  $('hostBtn').onclick = () => hostRoom(readForm());
  $('joinBtn').onclick = () => joinRoom(readForm());
  $('leaveBtn').onclick = leaveRoom;
  $('inviteBtn').onclick = async () => { await copyInvite(); flashButton('inviteBtn', '✅ Convite copiado!', '📋 Copiar convite'); };
  $('diagBtn').onclick = async () => { await copyDiagnostics(); flashButton('diagBtn', '✅ Diagnóstico copiado!', '🩺 Copiar diagnóstico'); };
  $('rejoinBtn').onclick = rejoinLast;
  paintRejoin();
  initSidebarToggle();
  $('pauseHiddenChk').checked = store.get('pauseHidden', true);
  $('pauseHiddenChk').onchange = () => { store.set('pauseHidden', $('pauseHiddenChk').checked); broadcastViewMode(); };
  document.addEventListener('visibilitychange', () => onVisibilityChange(document.visibilityState === 'hidden'));
  $('projectLink').onclick = e => { e.preventDefault(); window.native.openProject && window.native.openProject(); };
  initAbout();
  initUpdates();
  $('licenseLink').onclick = e => { e.preventDefault(); window.native.openLicense && window.native.openLicense(); };
  try {
    const v = 'v' + (await window.native.getVersion());
    $('appVersion').textContent = v;
    $('aboutVersion').textContent = v;
  } catch {}
  $('roomInput').onkeydown = e => { if (e.key === 'Enter') joinRoom(readForm()); };

  $('micSelect').onchange = async () => { store.set('mic', $('micSelect').value); await openMic($('micSelect').value); };
  for (const [id, key] of [['noiseChk', 'noise'], ['echoChk', 'echo'], ['agcChk', 'agc']]) {
    $(id).onchange = async () => { store.set(key, $(id).checked); await openMic($('micSelect').value); };
  }
  $('monitorBtn').onclick = toggleMonitor;
  $('recBtn').onclick = recordTest;
  $('testOutBtn').onclick = testOutput;
  document.addEventListener('click', resumeAudio);
  $('micVol').oninput = () => {
    setMicVolume($('micVol').value / 100);
    $('micVolVal').textContent = $('micVol').value + '%';
    store.set('micVol', +$('micVol').value);
  };
  $('muteBtn').onclick = () => setMuted(!micMuted);

  $('outSelect').onchange = () => { store.set('out', $('outSelect').value); setOutputDevice($('outSelect').value); };
  $('outVol').oninput = () => {
    $('outVolVal').textContent = $('outVol').value + '%';
    store.set('outVol', +$('outVol').value);
    setOutVolume($('outVol').value / 100);
  };

  $('shareVol').oninput = () => {
    setShareVolume($('shareVol').value / 100);
    $('shareVolVal').textContent = $('shareVol').value + '%';
    store.set('shareVol', +$('shareVol').value);
  };
  $('shareAudioChk').onchange = () => store.set('shareAudio', $('shareAudioChk').checked);
  $('qualitySelect').onchange = () => store.set('quality', $('qualitySelect').value);
  $('shareBtn').onclick = () => (screenStream ? stopShare() : startShare());

  try {
    window.native.onInvite(handleInvite);
    const invite = await window.native.takePendingInvite();
    if (invite) handleInvite(invite);
  } catch (e) { console.warn('convite', e); }

  window.addEventListener('beforeunload', shutdown);
}

init();
