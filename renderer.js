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
/* TelaShare - compartilhamento de tela + áudio em malha P2P (WebRTC via PeerJS) */

const $ = id => document.getElementById(id);
const PREFIX = 'telashare-v1-';
// Servidores STUN descobrem o IP público. Um TURN (opcional, configurado em "Avançado")
// retransmite o tráfego quando a conexão direta é bloqueada por firewall/NAT.
function peerOpts() {
  const iceServers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ];
  const turnUrls = ($('turnUrl').value || '').split(/[\s,]+/).filter(Boolean);
  if (turnUrls.length) {
    iceServers.push({
      urls: turnUrls,
      username: $('turnUser').value.trim(),
      credential: $('turnPass').value
    });
  }
  return { debug: 1, config: { iceServers } };
}
const QUALITY = {
  '720_30':  { w: 1280, h: 720,  fps: 30, bitrate: 2500000 },
  '1080_30': { w: 1920, h: 1080, fps: 30, bitrate: 4500000 },
  '1080_60': { w: 1920, h: 1080, fps: 60, bitrate: 7000000 }
};

// ---------- estado ----------
let peer = null;
let isHost = false;
let roomCode = '';
let leaving = false;
const peers = new Map(); // id -> { id, name, conn, micCall, screenOut, screenIn, audioEl, voiceSrc, voiceGain, analyser, screenSrc, screenGainNode, vol, screenVol, net }

// Todo áudio passa pelo Web Audio, o que permite ganho acima de 100%:
//  entrada: mic -> micGain -> limitador suave -> muteGain -> (envio | medidor | monitor)
//  saída:   vozes/telas -> ganho por pessoa -> outMaster -> limitador suave -> alto-falante
let audioCtx, micGain, muteGain, micAnalyser, micDest, monitorGain;
let outMaster;
let micRaw = null, micSource = null, micMuted = false, monitoring = false, recording = false;

let screenRaw = null, screenStream = null, screenAudioNode = null, screenGain = null;
let currentQuality = QUALITY['1080_30'];

let outVolume = 1;
// Ducking: abaixa o áudio das telas recebidas enquanto alguém fala
const DUCK_LEVEL = 0.3;
const DUCK_HOLD_MS = 600;
let duckFactor = 1;
let lastVoiceAt = 0;
let outDeviceId = '';

// ---------- preferências salvas ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('ts_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ts_' + k, JSON.stringify(v)); } catch {} }
};

// =====================================================================
// IDENTIDADE: ID aleatório e fixo por instalação (não usa nenhum dado pessoal).
// Serve para diferenciar pessoas com o mesmo nome e lembrar o volume de cada uma.
// =====================================================================
const DEVICE_ID = (() => {
  let id = store.get('deviceId', null);
  if (!id) { id = crypto.randomUUID(); store.set('deviceId', id); }
  return id;
})();

function hashHue(text) {
  let h = 0;
  for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}
// Paleta de cores bem distintas entre si (gerar a cor direto do ID deixava tons vizinhos,
// ex. dois verdes quase iguais). Se duas pessoas da sala caem na mesma cor, a segunda
// pega a próxima cor livre.
const PALETTE = ['#e5484d', '#f76b15', '#b88a00', '#30a46c', '#12a594', '#0090ff', '#3e63dd', '#8e4ec6', '#d6409f', '#a18072'];
function assignColors() {
  const list = [...peers.values()].filter(p => p.conn)
    .sort((a, b) => String(a.deviceId || a.id).localeCompare(String(b.deviceId || b.id)));
  const used = new Set();
  for (const p of list) {
    let i = hashHue(p.deviceId || p.id) % PALETTE.length;
    for (let k = 0; k < PALETTE.length && used.has(i); k++) i = (i + 1) % PALETTE.length;
    used.add(i);
    p.colorIdx = i;
  }
}
function peerColor(p) {
  const i = p.colorIdx != null ? p.colorIdx : hashHue(p.deviceId || p.id) % PALETTE.length;
  return PALETTE[i];
}
function peerTag(p) { return (p.deviceId || p.id).replace(/[^a-z0-9]/gi, '').slice(0, 4).toLowerCase(); }

// Nome exibido: se outra pessoa conectada (ou você) tem o mesmo nome, mostra "Nome #a1b2"
function displayName(p) {
  const key = p.name.trim().toLowerCase();
  const myName = $('nameInput').value.trim().toLowerCase();
  const dup = key === myName ||
    [...peers.values()].some(o => o !== p && o.conn && o.name.trim().toLowerCase() === key);
  return dup ? `${p.name} #${peerTag(p)}` : p.name;
}

// Volumes salvos por instalação (deviceId); versões antigas sem deviceId usam o nome
function volKey(kind, p) { return p.deviceId ? `${kind}_dev_${p.deviceId}` : `${kind}_${p.name}`; }

function makeAvatar(p) {
  const av = document.createElement('span');
  av.className = 'av';
  av.textContent = (p.name.trim()[0] || '?').toUpperCase();
  av.style.background = peerColor(p);
  return av;
}

// =====================================================================
// AVISOS NA TELA (toasts)
// =====================================================================
const toastLog = [];
function showToast(msg, kind = 'info', ms = 5000) {
  toastLog.push(msg);
  const box = $('toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, ms);
}

// =====================================================================
// SONS DE AVISO (gerados na hora, sem arquivos)
// =====================================================================
const SOUNDS = {
  // [frequência Hz, início s, duração s]
  'join':      [[523, 0, 0.09], [784, 0.09, 0.14]],
  'leave':     [[784, 0, 0.09], [523, 0.09, 0.14]],
  'share-on':  [[523, 0, 0.07], [659, 0.07, 0.07], [784, 0.14, 0.12]],
  'share-off': [[784, 0, 0.07], [523, 0.07, 0.12]],
  'mute':      [[330, 0, 0.09]],
  'unmute':    [[660, 0, 0.09]],
  'warn':      [[247, 0, 0.12], [247, 0.18, 0.12]],
  'ok':        [[660, 0, 0.08], [880, 0.08, 0.12]]
};
const soundLog = [];
function playSound(name) {
  const notes = SOUNDS[name];
  if (!notes || !audioCtx || !$('soundChk').checked) return;
  soundLog.push(name);
  const vol = ($('soundVol').value / 100) * 0.25;
  if (vol <= 0) return;
  const t0 = audioCtx.currentTime + 0.01;
  for (const [f, start, dur] of notes) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t0 + start);
    g.gain.linearRampToValueAtTime(vol, t0 + start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
    o.connect(g).connect(outMaster);
    o.start(t0 + start);
    o.stop(t0 + start + dur + 0.02);
  }
}

// =====================================================================
// ÁUDIO LOCAL (microfone)
// =====================================================================
// Limitador suave (sem atraso): até 0,8 o sinal passa intacto e acima disso é arredondado,
// nunca passando de 0,98. Evita distorção com ganho acima de 100%.
// Obs.: não usamos DynamicsCompressor porque ele aplica um ganho de compensação automático
// (o ganho real ficava ~1,2x maior que o configurado) e adiciona ~6 ms de atraso.
// (o ganho 0,5 antes do WaveShaper faz a curva cobrir entradas de -2 a +2)
function makeSafety() {
  const pre = audioCtx.createGain();
  pre.gain.value = 0.5;
  const shaper = audioCtx.createWaveShaper();
  const N = 4096, curve = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 4 - 2;
    const a = Math.abs(x);
    const y = a <= 0.8 ? a : 0.8 + 0.18 * Math.tanh((a - 0.8) / 0.18);
    curve[i] = Math.sign(x) * y;
  }
  shaper.curve = curve;
  shaper.oversample = 'none'; // '2x' gera pequenos picos acima do limite (filtro de reamostragem)
  pre.connect(shaper);
  return { input: pre, output: shaper };
}

function initAudio() {
  audioCtx = new AudioContext({ latencyHint: 'interactive' });

  // saída
  outMaster = audioCtx.createGain();
  const outSafe = makeSafety();
  outMaster.connect(outSafe.input);
  outSafe.output.connect(audioCtx.destination);

  // entrada
  micGain = audioCtx.createGain();
  muteGain = audioCtx.createGain();
  micAnalyser = audioCtx.createAnalyser();
  micAnalyser.fftSize = 1024;
  micDest = audioCtx.createMediaStreamDestination();
  monitorGain = audioCtx.createGain();
  monitorGain.gain.value = 0;
  const micSafe = makeSafety();
  micGain.connect(micSafe.input);
  micSafe.output.connect(muteGain);
  muteGain.connect(micAnalyser);
  muteGain.connect(micDest);
  muteGain.connect(monitorGain).connect(outMaster);
  micGain.gain.value = $('micVol').value / 100;
}

async function openMic(deviceId) {
  if (micSource) { micSource.disconnect(); micSource = null; }
  if (micRaw) { micRaw.getTracks().forEach(t => t.stop()); micRaw = null; }
  try {
    micRaw = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: $('echoChk').checked,
        noiseSuppression: $('noiseChk').checked,
        autoGainControl: $('agcChk').checked
      }
    });
    micSource = audioCtx.createMediaStreamSource(micRaw);
    micSource.connect(micGain);
    const track = micRaw.getAudioTracks()[0];
    track.onended = onMicLost; // fone desplugado, USB removido etc.
    $('micWarn').classList.add('hidden');
    return true;
  } catch (e) {
    console.warn('Microfone indisponível', e);
    micRaw = null;
    $('micWarn').classList.remove('hidden');
    return false;
  }
}

function currentMicId() {
  const t = micRaw && micRaw.getAudioTracks()[0];
  return t && t.readyState === 'live' ? (t.getSettings().deviceId || '') : null;
}

// O microfone em uso sumiu: troca para o padrão do sistema e avisa
let micRecovering = false;
async function onMicLost() {
  if (micRecovering) return;
  micRecovering = true;
  try {
    showToast('🎤 Microfone desconectado. Tentando usar o microfone padrão...', 'warn');
    playSound('warn');
    await refreshDevices();
    const ok = await openMic('');
    await refreshDevices();
    if (ok) {
      $('micSelect').value = currentMicId() || $('micSelect').value;
      showToast('🎤 Usando agora: ' + ($('micSelect').selectedOptions[0] || {}).textContent, 'ok');
    } else {
      showToast('🎤 Nenhum microfone encontrado. Conecte um microfone.', 'error', 8000);
    }
  } finally {
    micRecovering = false;
  }
}

// Dispositivos mudaram (plugou/desplugou algo)
async function onDeviceChange() {
  await refreshDevices();
  const inputs = [...$('micSelect').options].map(o => o.value);
  const preferred = store.get('mic', '');
  const cur = currentMicId();
  if (cur === null && inputs.length) {
    // estava sem microfone e apareceu um
    if (await openMic(inputs.includes(preferred) ? preferred : '')) {
      $('micSelect').value = currentMicId() || $('micSelect').value;
      showToast('🎤 Microfone conectado: ' + ($('micSelect').selectedOptions[0] || {}).textContent, 'ok');
    }
  } else if (preferred && cur !== null && cur !== preferred && inputs.includes(preferred)) {
    // o microfone preferido voltou: volta para ele
    if (await openMic(preferred)) {
      $('micSelect').value = preferred;
      showToast('🎤 Voltando para: ' + ($('micSelect').selectedOptions[0] || {}).textContent, 'ok');
    }
  }
  // saída escolhida sumiu: volta para a padrão
  const outs = [...$('outSelect').options].map(o => o.value);
  if (outDeviceId && outDeviceId !== 'default' && !outs.includes(outDeviceId)) {
    await setOutputDevice('default');
    showToast('🔊 Dispositivo de saída desconectado. Usando a saída padrão.', 'warn');
  }
}

// ---------- testes de áudio ----------
function toggleMonitor() {
  monitoring = !monitoring;
  monitorGain.gain.setTargetAtTime(monitoring ? 1 : 0, audioCtx.currentTime, 0.02);
  const b = $('monitorBtn');
  b.textContent = monitoring ? '⏹️ Parar de me ouvir' : '🎧 Ouvir meu microfone';
  b.classList.toggle('active', monitoring);
}

async function recordTest() {
  if (recording) return;
  if (monitoring) toggleMonitor();
  if (audioCtx.state !== 'running') await audioCtx.resume();
  recording = true;
  const b = $('recBtn');
  const chunks = [];
  const rec = new MediaRecorder(micDest.stream);
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.onstop = async () => {
    try {
      const buf = await audioCtx.decodeAudioData(await new Blob(chunks).arrayBuffer());
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(outMaster);
      b.textContent = '🔊 Reproduzindo gravação...';
      src.onended = () => { recording = false; b.textContent = '⏺️ Gravar teste (5s) e ouvir'; b.classList.remove('active'); };
      src.start();
    } catch (e) {
      recording = false;
      b.textContent = '⏺️ Gravar teste (5s) e ouvir';
      b.classList.remove('active');
      alert('Não foi possível reproduzir a gravação: ' + e.message);
    }
  };
  rec.start();
  b.classList.add('active');
  for (let i = 5; i > 0; i--) {
    b.textContent = `🔴 Gravando... fale algo (${i})`;
    await new Promise(r => setTimeout(r, 1000));
  }
  rec.stop();
}

async function testOutput() {
  if (audioCtx.state !== 'running') await audioCtx.resume();
  const t = audioCtx.currentTime;
  [523.25, 659.25, 783.99].forEach((f, i) => {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t + i * 0.18);
    g.gain.linearRampToValueAtTime(0.25, t + i * 0.18 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.18 + 0.5);
    o.connect(g).connect(outMaster);
    o.start(t + i * 0.18);
    o.stop(t + i * 0.18 + 0.55);
  });
}

function setMuted(m) {
  micMuted = m;
  muteGain.gain.setTargetAtTime(m ? 0 : 1, audioCtx.currentTime, 0.01);
  broadcast({ type: 'state', muted: m });
  playSound(m ? 'mute' : 'unmute');
  const b = $('muteBtn');
  b.textContent = m ? '🔇 Microfone mudo' : '🎤 Microfone ligado';
  b.classList.toggle('muted', m);
}

async function refreshDevices() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  fillSelect($('micSelect'), devs.filter(d => d.kind === 'audioinput'), store.get('mic', ''));
  fillSelect($('outSelect'), devs.filter(d => d.kind === 'audiooutput'), store.get('out', ''));
}

function fillSelect(sel, list, wanted) {
  const prev = sel.value || wanted;
  sel.innerHTML = '';
  list.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || `Dispositivo ${i + 1}`;
    sel.appendChild(o);
  });
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

function levels(analyser) {
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  let sum = 0, peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i]);
    sum += v * v;
    if (v > peak) peak = v;
  }
  return { rms: Math.sqrt(sum / buf.length), peak };
}

// Medidor do microfone: só desenho, então pode parar quando a janela não está visível
function meterLoop() {
  const { rms, peak } = levels(micAnalyser);
  const level = Math.min(1, rms * 5);
  const m = $('micMeter');
  m.style.width = (level * 100).toFixed(0) + '%';
  m.classList.toggle('hot', peak > 0.95);
  m.classList.toggle('low', !micMuted && level < 0.08);
  requestAnimationFrame(meterLoop);
}

// Detecção de quem está falando + ducking. Roda num timer próprio (e não no
// requestAnimationFrame) porque precisa funcionar com o app MINIMIZADO, ex. durante um jogo:
// no Windows o requestAnimationFrame para quando a janela não está visível.
const VOICE_INTERVAL_MS = 50;
function voiceLoop() {
  const now = performance.now();
  for (const p of peers.values()) {
    if (!p.analyser) continue;
    const speaking = !p.muted && levels(p.analyser).rms > 0.015;
    if (speaking) lastVoiceAt = now;
    if (speaking !== p.speaking) {
      p.speaking = speaking;
      const li = document.querySelector(`#peerList li[data-id="${CSS.escape(p.id)}"]`);
      if (li) li.classList.toggle('speaking', speaking);
    }
  }
  const target = $('duckChk').checked && now - lastVoiceAt < DUCK_HOLD_MS ? DUCK_LEVEL : 1;
  if (target !== duckFactor) { duckFactor = target; applyVolumes(); }
}

// =====================================================================
// SAÍDA (volumes e dispositivo)
// =====================================================================
function setGain(node, v) {
  if (node) node.gain.setTargetAtTime(v, audioCtx.currentTime, 0.02);
}

function applyVolumes() {
  setGain(outMaster, outVolume);
  for (const p of peers.values()) {
    setGain(p.voiceGain, p.vol);
    setGain(p.screenGainNode, p.screenVol * duckFactor);
  }
}

async function setOutputDevice(id) {
  outDeviceId = id;
  if (!audioCtx.setSinkId) return;
  try { await audioCtx.setSinkId(id === 'default' ? '' : id); }
  catch (e) { console.warn('setSinkId', e); }
}

// =====================================================================
// CONEXÃO (PeerJS)
// =====================================================================
function sanitizeRoom(s) { return s.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''); }

// 🎲 Código de sala aleatório: 10 caracteres sem letras/números confundíveis (l, 1, o, 0, i).
// São ~800 trilhões de combinações, então na prática ninguém mais vai usar o mesmo código.
const ROOM_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function generateRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const c = [...bytes].map(b => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}

function makePeer(id) {
  return new Promise((resolve, reject) => {
    const opts = peerOpts();
    const p = id ? new Peer(id, opts) : new Peer(opts);
    const onErr = err => { p.destroy(); reject(err); };
    p.once('error', onErr);
    p.once('open', () => { p.off('error', onErr); resolve(p); });
  });
}

function readForm() {
  const name = $('nameInput').value.trim();
  const room = sanitizeRoom($('roomInput').value);
  if (!name) { alert('Digite seu nome.'); return null; }
  if (!room) { alert('Digite um código de sala (letras, números, - ou _).'); return null; }
  if (audioCtx.state !== 'running') audioCtx.resume();
  store.set('name', name);
  store.set('room', room);
  return { name, room };
}

async function hostRoom() {
  const f = readForm(); if (!f) return;
  lockForm(true);
  setStatus('Criando sala...');
  try {
    peer = await makePeer(PREFIX + f.room);
  } catch (err) {
    lockForm(false);
    if (err.type === 'unavailable-id') {
      // A sala continua aberta (outra pessoa assumiu quando você saiu, ou alguém já criou):
      // entra nela em vez de dar erro.
      showToast(`A sala "${f.room}" já está aberta. Entrando nela...`, 'info');
      joinRoom();
    } else alert('Erro ao criar sala: ' + (err.message || err.type));
    return;
  }
  clearJoin();
  isHost = true;
  enterRoom(f.room);
}

async function joinRoom() {
  const f = readForm(); if (!f) return;
  lockForm(true);
  setStatus('Conectando...');
  try {
    peer = await makePeer();
  } catch (err) {
    lockForm(false);
    alert('Erro ao conectar no servidor: ' + (err.message || err.type));
    return;
  }
  isHost = false;
  enterRoom(f.room);
  joinTarget = PREFIX + f.room;
  joinAttempts = 0;
  tryJoin();
}

// Tenta entrar na sala. Cada tentativa espera até 6s pela resposta do anfitrião;
// sem resposta, tenta de novo (o anfitrião pode estar terminando de criar a sala).
// Obs.: não dá para confiar só no erro "peer-unavailable" do servidor público,
// porque depois do primeiro erro ele às vezes deixa as novas tentativas sem resposta.
const JOIN_MAX_ATTEMPTS = 6;
const REJOIN_JOIN_ATTEMPTS = 2; // em reconexão, cada rodada tenta 2 vezes antes de esperar
let joinRetryFn = null;

function tryJoin() {
  if (!peer || !joinTarget) return;
  joinAttempts++;
  const myAttempt = joinAttempts;
  const maxAttempts = rejoining ? REJOIN_JOIN_ATTEMPTS : JOIN_MAX_ATTEMPTS;
  if (!rejoining) setStatus(joinAttempts > 1 ? `Procurando a sala... (tentativa ${joinAttempts} de ${maxAttempts})` : 'Procurando a sala...');
  const conn = peer.connect(joinTarget, { reliable: true });
  setupConn(conn, true);

  const started = Date.now();
  let timer = null;
  const retry = () => {
    if (joinAttempts !== myAttempt || !joinTarget) return;
    clearInterval(timer);
    joinRetryFn = null;
    try { conn.close(); } catch {}
    if (joinAttempts >= maxAttempts) {
      joinTarget = null;
      if (rejoining) { scheduleRejoin(); return; }
      alert('Sala não encontrada.\n\nConfira se o código está igual nos dois PCs e se quem criou ' +
            'a sala ainda está com ela aberta (botão "Criar sala").');
      leaveRoom();
    } else {
      setTimeout(tryJoin, 1500);
    }
  };
  joinRetryFn = retry;

  timer = setInterval(() => {
    if (!peer || joinTarget === null || joinAttempts !== myAttempt) { clearInterval(timer); return; }
    if (conn.open) { clearInterval(timer); joinTarget = null; joinRetryFn = null; return; }
    const pc = conn.peerConnection;
    const ice = pc ? pc.iceConnectionState : 'new';
    const elapsed = Date.now() - started;
    if (ice === 'new') {
      // anfitrião ainda não respondeu
      if (elapsed > 6000) retry();
      return;
    }
    // anfitrião respondeu: a sala existe, agora é a conexão direta
    if (!rejoining) setStatus(`Sala encontrada. Conectando diretamente... (${ice})`);
    if (ice === 'failed' || elapsed > 30000) {
      clearInterval(timer);
      joinTarget = null;
      joinRetryFn = null;
      if (rejoining) { scheduleRejoin(); return; }
      alert('A sala existe, mas não foi possível conectar diretamente ao outro computador ' +
            '(bloqueio de firewall ou NAT da rede).\n\n' +
            'Soluções:\n' +
            '• Instalem uma VPN gratuita (Radmin VPN, Tailscale ou ZeroTier) nos dois PCs e tentem de novo; ou\n' +
            '• Configurem um servidor TURN em "Avançado" (veja o README).');
      leaveRoom();
    }
  }, 500);
}
let joinAttempts = 0;
let joinTarget = null;
// Encerra qualquer tentativa de ENTRAR em andamento (#61). Sem isso, sair no meio de uma
// tentativa deixava o selo preso em "Conectando à sala..." mesmo depois de criar outra sala.
function clearJoin() {
  joinTarget = null;
  joinRetryFn = null;
  joinAttempts++; // invalida os temporizadores da tentativa antiga
}

// Conexão com o servidor de sinalização caiu: tenta voltar com limite de tentativas.
// (Quem já está conectado continua conversando; o servidor só serve para novas entradas.)
const SIGNAL_MAX_ATTEMPTS = 8;

function enterRoom(room) {
  logEvent(`entrei na sala ${room}${isHost ? ' como anfitrião' : ''}`);
  store.set('lastRoom', { room, at: Date.now() });
  roomCode = room;
  leaving = false;
  const me = peer; // os eventos abaixo só valem para ESTA conexão (a reconexão cria outra)
  let sigAttempts = 0;
  me.on('connection', conn => { if (peer === me) setupConn(conn, false); });
  me.on('call', call => { if (peer === me) handleIncomingCall(call); });
  me.on('disconnected', () => {
    if (leaving || peer !== me || me.destroyed) return;
    const retry = () => {
      if (leaving || peer !== me || me.destroyed || !me.disconnected) return;
      sigAttempts++;
      if (sigAttempts > SIGNAL_MAX_ATTEMPTS) {
        setStatus('Sem conexão com o servidor. Quem já está na sala continua conectado.');
        if (connectedCount() === 0 && !rejoining) scheduleRejoin();
        return;
      }
      setStatus(`Reconectando ao servidor... (tentativa ${sigAttempts} de ${SIGNAL_MAX_ATTEMPTS})`);
      me.reconnect();
      setTimeout(retry, Math.min(2000 * sigAttempts, 15000));
    };
    setTimeout(retry, 1500);
  });
  me.on('open', () => { if (peer === me) { sigAttempts = 0; updateStatus(); } });
  me.on('error', err => {
    if (peer !== me) return;
    console.warn('peer error', err.type, err);
    logEvent(`erro do servidor/peer: ${err.type}`);
    if (err.type === 'peer-unavailable') {
      // O servidor respondeu que não existe ninguém com esse ID: a sala realmente não existe
      if (joinTarget && String(err.message).includes(joinTarget) && joinRetryFn) joinRetryFn();
      return;
    }
    if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
      setStatus('Problema de rede com o servidor de sinalização...');
    }
  });

  $('connectBox').classList.add('hidden');
  $('roomBox').classList.remove('hidden');
  $('roomName').textContent = room;
  $('shareBtn').disabled = false;
  updateStatus();
}

// ---------- convite ----------
function inviteLink(room) { return `telashare://sala/${room}`; }

async function copyInvite() {
  const text = `Entra na minha sala do TelaShare!\n` +
               `Link: ${inviteLink(roomCode)}\n` +
               `(ou abra o TelaShare, use o código "${roomCode}" e clique em Entrar)`;
  await window.native.copyText(text);
  const b = $('inviteBtn');
  b.textContent = '✅ Convite copiado!';
  setTimeout(() => (b.textContent = '📋 Copiar convite'), 2000);
}

function handleInvite(room) {
  room = sanitizeRoom(room || '');
  if (!room) return;
  if (peer) {
    if (room === roomCode) return;
    if (!confirm(`Você recebeu um convite para a sala "${room}". Sair da sala atual e entrar nela?`)) return;
    leaveRoom();
  }
  $('roomInput').value = room;
  if (!$('nameInput').value.trim()) {
    alert(`Convite para a sala "${room}".\nDigite seu nome e clique em Entrar.`);
    $('nameInput').focus();
    return;
  }
  joinRoom();
}

function leaveRoom() {
  leaving = true;
  rejoining = false;
  clearTimeout(rejoinTimer);
  stopShare();
  sayGoodbye();
  for (const id of [...peers.keys()]) removePeer(id, 'leave');
  clearMesh();
  clearJoin();
  hostLostAt = hostNextDial = claimNext = 0;
  everConnected = false;
  if (peer) { peer.destroy(); peer = null; }
  isHost = false;
  $('connectBox').classList.remove('hidden');
  $('roomBox').classList.add('hidden');
  $('shareBtn').disabled = true;
  lockForm(false);
  renderPeers();
  paintRejoin();
}

// =====================================================================
// REENTRAR NA ÚLTIMA SALA (#48): um clique para voltar. Usa "Criar sala", que entra na sala se
// ela ainda estiver aberta (#32) ou a abre de novo se todos tiverem saído.
// =====================================================================
function agoText(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'agora há pouco';
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}
function paintRejoin() {
  const last = store.get('lastRoom', null);
  const b = $('rejoinBtn');
  const ok = last && typeof last.room === 'string' && sanitizeRoom(last.room) === last.room && last.room;
  b.classList.toggle('hidden', !ok || !!peer);
  if (ok) b.textContent = `↩️ Voltar para a sala ${last.room} (${agoText(Date.now() - (last.at || 0))})`;
}
function rejoinLast() {
  const last = store.get('lastRoom', null);
  if (!last || !last.room) return;
  $('roomInput').value = last.room;
  hostRoom();
}

// =====================================================================
// RECONEXÃO AUTOMÁTICA (com limite de tentativas)
// Se você perde a conexão com todos (internet piscou), o app volta sozinho para a sala.
// Não reconecta quando os outros saíram de propósito (mensagem "bye").
// =====================================================================
let rejoinCfg = { max: 5, delays: [2000, 4000, 8000, 15000, 30000] };
let rejoining = false;
let rejoinAttempt = 0;
let rejoinTimer = null;

function connectedCount() { return [...peers.values()].filter(p => p.conn && p.conn.open).length; }

function scheduleRejoin() {
  if (leaving || !roomCode) return;
  if (!rejoining) {
    rejoining = true;
    rejoinAttempt = 0;
    playSound('warn');
    logEvent('perdi a ligação com todos: reconectando');
    showToast('📶 Conexão perdida. Tentando reconectar...', 'warn');
  }
  rejoinAttempt++;
  if (rejoinAttempt > rejoinCfg.max) {
    rejoining = false;
    playSound('warn');
    alert(`Não foi possível reconectar à sala "${roomCode}" depois de ${rejoinCfg.max} tentativas.\n\n` +
          'Verifique sua internet e entre de novo.');
    leaveRoom();
    return;
  }
  const delay = rejoinCfg.delays[Math.min(rejoinAttempt - 1, rejoinCfg.delays.length - 1)];
  setStatus(`Conexão perdida. Reconectando em ${Math.round(delay / 1000)}s (tentativa ${rejoinAttempt} de ${rejoinCfg.max})...`);
  clearTimeout(rejoinTimer);
  rejoinTimer = setTimeout(doRejoin, delay);
}

async function doRejoin() {
  if (leaving || !rejoining) return;
  if (connectedCount() > 0) { rejoinSucceeded(); return; }
  setStatus(`Reconectando... (tentativa ${rejoinAttempt} de ${rejoinCfg.max})`);
  const wasHost = isHost;
  const old = peer;
  peer = null;
  // ligações em andamento eram do ID antigo; quem está na sala (roster) continua valendo
  for (const { conn } of pending.values()) { try { conn.close(); } catch {} }
  pending.clear(); pairRetry.clear();
  try { old && old.destroy(); } catch {}
  try {
    // o anfitrião tenta recriar a sala com o mesmo código; os outros entram de novo
    peer = await makePeer(wasHost ? PREFIX + roomCode : undefined);
  } catch (err) {
    if (wasHost && err.type === 'unavailable-id') {
      // o servidor ainda guarda a sala antiga: espera e tenta de novo
    }
    peer = null;
    scheduleRejoin();
    return;
  }
  if (leaving) { try { peer.destroy(); } catch {} peer = null; return; }
  enterRoom(roomCode);
  if (wasHost) { rejoinSucceeded(); return; } // a sala voltou; os outros reconectam nela
  joinTarget = PREFIX + roomCode;
  joinAttempts = 0;
  tryJoin();
}

function rejoinSucceeded() {
  if (!rejoining) return;
  rejoining = false;
  rejoinAttempt = 0;
  clearTimeout(rejoinTimer);
  playSound('ok');
  showToast('📶 Reconectado!', 'ok');
  updateStatus();
}

function lockForm(lock) {
  ['hostBtn', 'joinBtn', 'nameInput', 'roomInput', 'rejoinBtn'].forEach(id => ($(id).disabled = lock));
}

function setStatus(t) { $('status').textContent = t; if ($('connBadge')) updateBadge(); }
function updateStatus() {
  if (rejoining) return;
  const n = [...peers.values()].filter(p => p.conn && p.conn.open).length;
  setStatus((isHost ? 'Você é o anfitrião. ' : '') + `${n} pessoa(s) conectada(s).`);
}

function getPeer(id) {
  let p = peers.get(id);
  if (!p) {
    p = { id, name: '...', conn: null, micCall: null, screenOut: null, screenIn: null,
          audioEl: null, voiceSrc: null, voiceGain: null, analyser: null,
          screenSrc: null, screenGainNode: null, vol: 1, screenVol: 1, net: null };
    peers.set(id, p);
  }
  return p;
}

// =====================================================================
// MALHA: quem está na sala e religação de pares
// Cada participante avisa a cada 3 s com quem está ligado (mensagem 'roster'). Assim todos
// sabem quem continua na sala mesmo quando a ligação DIRETA com alguém caiu, e o par é
// religado sozinho (com limite de tentativas), sem precisar sair e entrar de novo.
// Regra para não haver conexão duplicada: só o ID menor inicia a ligação.
// =====================================================================
const MESH_MS = 3000;
const ROSTER_TTL_MS = 12000;          // ninguém confirmou a pessoa nesse tempo → saiu da sala
let pairTimeoutMs = 15000;    // tentativa de ligação que não abriu nesse tempo → falhou
let pairWarnMs = 20000;       // sem ligação direta com alguém da sala por esse tempo → avisa
let pairCfg = { max: 6, delays: [1000, 2000, 4000, 8000, 15000, 30000], slow: 60000 };
const roster = new Map();     // id -> último momento em que alguém confirmou que a pessoa está na sala
const pairRetry = new Map();  // id -> { n, next }: tentativas de religar um par
const pending = new Map();    // id -> { conn, at }: ligação de saída ainda não aberta
const relinking = new Map();  // id -> nome: pares que caíram e estão sendo religados
const rosterNames = new Map(); // id -> nome (para avisar sobre quem não conseguimos ligar)
const lostSince = new Map();  // id -> desde quando a pessoa está na sala sem ligação direta comigo
const unreachable = new Set(); // pessoas da sala com quem a ligação direta não fecha (já avisado)

// A sala é o ID "telashare-v1-<código>" no servidor de sinalização. Quem tem esse ID é o
// anfitrião e é por ele que pessoas novas entram. Se o anfitrião sai (ou cai), os convidados
// continuam ligados entre si e:
//  - ficam procurando a sala a cada HOST_RETRY_MS (quando o anfitrião volta, todos se religam);
//  - depois de HOST_CLAIM_AFTER_MS sem anfitrião, quem tem o menor ID assume a sala (vira o
//    novo anfitrião), para que pessoas novas ou quem saiu consigam entrar de novo.
// O servidor garante que só uma pessoa consegue o ID da sala por vez.
const HOST_RETRY_MS = 4000;
const HOST_CLAIM_AFTER_MS = 6000;
let hostLostAt = 0, hostNextDial = 0, claimNext = 0, claiming = false;
let everConnected = false; // só procura/assume a sala depois de ter entrado nela de fato
const roomPeerId = () => PREFIX + roomCode;

function vouch(id, at = Date.now()) { if (peer && id && id !== peer.id) roster.set(id, at); }
function isOpen(id) { const p = peers.get(id); return !!(p && p.conn && p.conn.open); }

function dial(id) {
  const conn = peer.connect(id, { reliable: true });
  pending.set(id, { conn, at: Date.now() });
  setupConn(conn, true);
}

// Primeira ligação com alguém que o anfitrião apresentou ('peers' / 'joined')
function maybeConnect(id) {
  if (!peer || !id || id === peer.id) return;
  vouch(id);
  if (isOpen(id) || pending.has(id) || pairRetry.has(id)) return;
  if (peer.id < id) dial(id);
}

function clearMesh() {
  for (const { conn } of pending.values()) { try { conn.close(); } catch {} }
  roster.clear(); pairRetry.clear(); pending.clear(); relinking.clear();
  rosterNames.clear(); lostSince.clear(); unreachable.clear();
}

function rosterName(id) {
  const p = peers.get(id);
  return (p && p.helloed && p.name) || rosterNames.get(id) || 'um participante';
}

// Liga/desliga o aviso de "sem conexão direta" para uma pessoa da sala
function setUnreachable(id, on) {
  if (on === unreachable.has(id)) return;
  logEvent(`${rosterName(id)} (${shortId(id)}): ${on ? 'SEM conexão direta (avisado)' : 'conexão direta ok'}`);
  if (on) {
    unreachable.add(id);
    playSound('warn');
    showToast(`⚠️ Sem conexão direta com ${rosterName(id)}: vocês não se veem nem se ouvem. ` +
              'A rede de um dos dois está bloqueando. Tente um servidor TURN em "Avançado" ou uma VPN (veja o README).', 'warn', 12000);
  } else unreachable.delete(id);
  renderPeers();
}

function meshLoop() {
  setTimeout(meshLoop, MESH_MS);
  if (!peer || leaving || rejoining) return;
  const now = Date.now();
  const open = [...peers.values()].filter(p => p.conn && p.conn.open).map(p => p.id);
  open.forEach(id => vouch(id, now));
  const names = {};
  open.forEach(id => { const p = peers.get(id); if (p.helloed) names[id] = p.name; });
  broadcast({ type: 'roster', list: open, names });
  for (const [id, pc] of [...pending]) {
    if (!pc.conn.open && now - pc.at > pairTimeoutMs) {
      pending.delete(id);
      try { pc.conn.close(); } catch {}
    }
  }
  for (const [id, seen] of [...roster]) {
    if (isOpen(id)) { pairRetry.delete(id); lostSince.delete(id); setUnreachable(id, false); continue; }
    if (now - seen > ROSTER_TTL_MS) {
      roster.delete(id); pairRetry.delete(id); relinking.delete(id); lostSince.delete(id); rosterNames.delete(id);
      setUnreachable(id, false);
      continue;
    }
    if (!lostSince.has(id)) lostSince.set(id, now);
    if (now - lostSince.get(id) >= pairWarnMs) setUnreachable(id, true);
    if (peer.id > id || pending.has(id)) continue; // o outro lado é quem inicia
    const r = pairRetry.get(id) || { n: 0, next: 0 };
    if (now < r.next) continue;
    r.n++;
    // depois do limite, continua tentando devagar (a rede de alguém pode mudar)
    r.next = now + (r.n > pairCfg.max ? pairCfg.slow : pairCfg.delays[Math.min(r.n - 1, pairCfg.delays.length - 1)]);
    pairRetry.set(id, r);
    dial(id);
  }
  for (const p of peers.values()) { checkScreenIn(p, now); checkMic(p, now); }
  if (!isHost && !claiming && everConnected) watchHost(now, open);
}

function watchHost(now, open) {
  const hid = roomPeerId();
  if (isOpen(hid)) { hostLostAt = 0; return; }
  if (!hostLostAt) hostLostAt = now;
  if (!pending.has(hid) && now >= hostNextDial && !(joinTarget === hid)) {
    hostNextDial = now + HOST_RETRY_MS;
    dial(hid); // o anfitrião voltou? (o ID da sala é sempre maior, então o convidado inicia)
  }
  // ninguém com o ID da sala há um tempo: o menor ID entre quem está ligado assume
  if (open.length && now - hostLostAt >= HOST_CLAIM_AFTER_MS && now >= claimNext &&
      open.every(id => peer.id < id || id === hid)) {
    claimNext = now + HOST_RETRY_MS * 2;
    claimRoom();
  }
}

async function claimRoom() {
  claiming = true;
  let np;
  try { np = await makePeer(roomPeerId()); }
  catch { claiming = false; return; } // a sala já tem dono (o anfitrião voltou ou outro assumiu)
  if (leaving || !peer || rejoining) { try { np.destroy(); } catch {} claiming = false; return; }
  // Troca de identidade: avisa os outros, que vão se religar ao ID da sala (watchHost)
  broadcast({ type: 'migrate' });
  const old = peer;
  peer = np;
  clearJoin();
  isHost = true;
  hostLostAt = 0;
  for (const id of [...peers.keys()]) removePeer(id, 'leave');
  for (const { conn } of pending.values()) { try { conn.close(); } catch {} }
  pending.clear(); pairRetry.clear(); relinking.clear();
  enterRoom(roomCode);
  showToast('👑 O anfitrião saiu. Você agora mantém a sala aberta.', 'info');
  logEvent('assumi a sala (o anfitrião saiu)');
  setTimeout(() => { try { old.destroy(); } catch {} }, 500);
  claiming = false;
}

function setupConn(conn, outgoing) {
  conn.on('open', () => {
    const p = getPeer(conn.peer);
    if (pending.has(conn.peer) && pending.get(conn.peer).conn === conn) pending.delete(conn.peer);
    if (p.conn && p.conn !== conn) {
      if (outgoing && p.conn.open) { conn.close(); return; }
      // Ligação nova chegando de quem já estava na lista: a antiga morreu do lado de lá
      // (só o ID menor inicia, então não é duplicata). Troca e refaz voz e tela.
      const old = p.conn;
      p.conn = conn;
      try { old.close(); } catch {}
      [p.micCall, p.screenIn, p.screenOut].forEach(c => { try { c && c.close(); } catch {} });
      p.micCall = p.screenIn = p.screenOut = null;
      removeTile(p.id);
    }
    p.conn = conn;
    p.lastSeen = Date.now();
    everConnected = true;
    if (joinTarget && conn.peer === joinTarget) clearJoin(); // já estamos ligados à sala
    conn.send({ type: 'hello', name: $('nameInput').value.trim(), muted: micMuted, deviceId: DEVICE_ID });
    if (myViewMode(p) !== 'full') conn.send({ type: 'screen-view', mode: myViewMode(p) });
    if (rejoining) rejoinSucceeded();

    if (isHost) {
      const others = [...peers.keys()].filter(id => id !== conn.peer && peers.get(id).conn);
      conn.send({ type: 'peers', list: others });
      for (const id of others) {
        const o = peers.get(id);
        if (o.conn && o.conn.open) o.conn.send({ type: 'joined', id: conn.peer });
      }
    }
    if (outgoing) callMic(conn.peer);
    if (screenStream) callScreen(conn.peer);
    renderPeers();
    updateStatus();
  });

  conn.on('data', msg => {
    if (!msg || typeof msg !== 'object') return;
    const p = peers.get(conn.peer);
    if (!p || p.conn !== conn) return;
    p.lastSeen = Date.now();
    switch (msg.type) {
      case 'ping':
        break;
      case 'state':
        p.muted = !!msg.muted;
        paintMuted(p);
        break;
      case 'bye':
        removePeer(p.id, 'bye');
        break;
      case 'migrate':
        // a pessoa assumiu a sala com o ID da sala: religa nela logo
        removePeer(p.id, 'migrate');
        hostNextDial = 0;
        break;
      case 'hello': {
        const first = !p.helloed;
        p.helloed = true;
        p.name = String(msg.name || 'Sem nome').slice(0, 24);
        p.muted = !!msg.muted;
        p.deviceId = typeof msg.deviceId === 'string' ? msg.deviceId.slice(0, 64) : null;
        // volumes salvos para esta pessoa (por instalação; versões antigas, pelo nome)
        p.vol = store.get(volKey('pvol', p), p.vol);
        p.screenVol = store.get(volKey('psvol', p), p.screenVol);
        applyVolumes();
        renderPeers();
        updateAllTileNames();
        if (first) { playSound('join'); logEvent(`${p.name} (${shortId(p.id)}) ligado`); }
        if (relinking.has(p.id)) {
          relinking.delete(p.id);
          showToast(`✅ Religado com ${displayName(p)}`, 'ok');
        }
        break;
      }
      case 'roster':
        // quem o outro participante tem ligado agora: confirma que essas pessoas estão na sala
        vouch(p.id);
        (msg.list || []).slice(0, 64).forEach(id => { if (typeof id === 'string') vouch(id); });
        if (msg.names && typeof msg.names === 'object') {
          for (const [id, nm] of Object.entries(msg.names).slice(0, 64)) {
            if (typeof nm === 'string' && id !== (peer && peer.id)) rosterNames.set(id, nm.slice(0, 24));
          }
        }
        break;
      case 'peers':
        (msg.list || []).forEach(maybeConnect);
        break;
      case 'joined':
        maybeConnect(msg.id);
        break;
      case 'screen-start':
        if (!p.sharing) { p.sharing = true; p.screenWaitSince = Date.now(); p.screenReqs = 0; p.screenInWarned = false; }
        if (myViewMode(p) !== 'full') sendViewMode(p);
        break;
      case 'screen-view':
        // quem assiste avisou se quer o vídeo da minha tela (app dele visível ou não)
        p.viewMode = ['off', 'thumb'].includes(msg.mode) ? msg.mode : 'full';
        if (p.screenOut && p.screenOut.peerConnection && p.screenOut.peerConnection.connectionState === 'connected') {
          applyEncoding(p.screenOut.peerConnection, p.sendLevel || 0, p.viewMode);
        }
        break;
      case 'mic-request':
        // o outro lado está sem a nossa voz: refaz a chamada (no máximo uma a cada 3 s)
        if (isMicCaller(p) && Date.now() - (p.micCalledAt || 0) > 3000) callMic(p.id);
        break;
      case 'screen-request':
        // quem assiste não recebeu a tela: refaz a chamada (no máximo uma a cada 3 s)
        if (screenStream && Date.now() - (p.screenCalledAt || 0) > 3000) { p.screenTries = 0; callScreen(p.id); }
        break;
      case 'screen-stop':
        p.sharing = false;
        if (p.screenIn) { p.screenIn.close(); p.screenIn = null; }
        if (tileEl(p.id)) playSound('share-off');
        removeTile(p.id);
        break;
    }
  });

  conn.on('close', () => {
    if (pending.has(conn.peer) && pending.get(conn.peer).conn === conn) pending.delete(conn.peer);
    const p = peers.get(conn.peer);
    if (p && p.conn === conn) removePeer(conn.peer, 'closed');
  });
  conn.on('error', e => { console.warn('conn error', e); logEvent(`erro na ligação com ${shortId(conn.peer)}: ${(e && (e.type || e.message)) || e}`); });
}

// reason: 'bye' (saiu de propósito), 'leave' (eu saí), 'closed' / 'timeout' (conexão caiu)
function removePeer(id, reason = 'closed') {
  const p = peers.get(id);
  if (!p) return;
  logEvent(`${p.name} (${shortId(id)}) removido: ${({ bye: 'saiu', leave: 'eu saí', closed: 'ligação fechou', timeout: 'sem resposta', migrate: 'assumiu a sala' })[reason] || reason}`);
  const wasConnected = !!(p.conn && p.helloed);
  [p.micCall, p.screenOut, p.screenIn].forEach(c => { try { c && c.close(); } catch {} });
  try { p.conn && p.conn.close(); } catch {}
  if (p.audioEl) { p.audioEl.srcObject = null; p.audioEl.remove(); }
  [p.voiceSrc, p.voiceGain].forEach(n => { try { n && n.disconnect(); } catch {} });
  removeTile(id);
  peers.delete(id);
  if (reason === 'bye' || reason === 'migrate') { roster.delete(id); pairRetry.delete(id); relinking.delete(id); }
  else if (wasConnected && (reason === 'closed' || reason === 'timeout') && !leaving && connectedCount() > 0) {
    // Caiu só a ligação com esta pessoa: a malha tenta religar o par (meshLoop)
    pairRetry.delete(id);
    relinking.set(id, p.name);
    showToast(`📶 Conexão com ${displayName(p)} caiu. Religando...`, 'warn');
  }
  renderPeers();
  updateAllTileNames();
  if (peer) updateStatus();
  if (wasConnected && reason !== 'leave' && reason !== 'migrate' && !leaving) playSound('leave');
  // Convidado perdeu a conexão com todos sem ninguém ter saído de propósito → reconecta sozinho.
  // O anfitrião NÃO recria a sala aqui: ele não tem como saber se quem caiu foi ele ou o
  // convidado, e a sala dele continua aberta para os outros voltarem.
  if (wasConnected && (reason === 'closed' || reason === 'timeout') && !leaving && peer && !isHost &&
      connectedCount() === 0 && !rejoining) {
    scheduleRejoin();
  }
}

// ---------- chamadas de mídia ----------
function callMic(id) {
  const call = peer.call(id, micDest.stream, { metadata: { kind: 'mic' } });
  const p = getPeer(id);
  p.micCalledAt = Date.now();
  attachMicCall(call);
}

// =====================================================================
// VOZ VIGIADA (#57): a chamada de voz é uma conexão separada da de dados. Se ela travar no
// meio do caminho (ex.: uma mensagem do aperto de mão se perdeu no servidor de sinalização),
// os nomes aparecem mas não há áudio e o indicador fica em "Conectando..." para sempre.
// Aqui, se a voz com alguém não conecta em ~12 s, quem liga (o ID menor, a mesma regra da
// malha) refaz a chamada; o outro lado pede ('mic-request'). Com limite, e avisa se desistir.
// =====================================================================
let micCfg = { connectMs: 12000, max: 5 };
function isMicCaller(p) { return !!peer && peer.id < p.id; }

function checkMic(p, now) {
  if (!p.conn || !p.conn.open) return;
  const pc = p.micCall && p.micCall.peerConnection;
  if (pc && pc.connectionState === 'connected') {
    p.micSince = 0; p.micTries = 0;
    if (p.micWarned) { p.micWarned = false; showToast(`✅ Áudio com ${displayName(p)} conectado`, 'ok'); }
    return;
  }
  if (!p.micSince) { p.micSince = now; return; }
  if (now - p.micSince < micCfg.connectMs) return;
  p.micSince = now;
  p.micTries = (p.micTries || 0) + 1;
  if (p.micTries > micCfg.max) {
    if (!p.micWarned) {
      p.micWarned = true;
      playSound('warn');
      showToast(`⚠️ Sem áudio com ${displayName(p)}: a chamada de voz não conecta. Copie o 🩺 diagnóstico e envie para quem está ajudando.`, 'warn', 12000);
    }
    return;
  }
  logEvent(`voz com ${p.name} não conectou (${pc ? pc.connectionState + '/' + pc.iceConnectionState : 'sem chamada'}): ${isMicCaller(p) ? 'refazendo a chamada' : 'pedindo para ligar de novo'} (${p.micTries})`);
  if (isMicCaller(p)) callMic(p.id);
  else { try { p.conn.send({ type: 'mic-request' }); } catch {} }
}

function handleIncomingCall(call) {
  const kind = call.metadata && call.metadata.kind;
  if (kind === 'mic') {
    call.answer(micDest.stream);
    attachMicCall(call);
  } else if (kind === 'screen') {
    call.answer(); // só recebe
    const p = getPeer(call.peer);
    if (p.screenIn && p.screenIn !== call) p.screenIn.close();
    p.screenIn = call;
    p.sharing = true;
    call.on('stream', s => {
      if (!tileEl(p.id)) playSound('share-on');
      if (p.screenInWarned) { p.screenInWarned = false; showToast(`✅ A tela de ${displayName(p)} chegou`, 'ok'); }
      p.screenReqs = 0;
      showTile(p.id, s, false);
    });
    call.on('close', () => { if (p.screenIn === call) { p.screenIn = null; removeTile(p.id); } });
  } else {
    call.close();
  }
}

function attachMicCall(call) {
  const p = getPeer(call.peer);
  if (p.micCall && p.micCall !== call) { try { p.micCall.close(); } catch {} }
  p.micCall = call;
  call.on('stream', stream => {
    if (p.voiceStream === stream) return;
    p.voiceStream = stream;
    // O Chrome só entrega áudio WebRTC remoto ao Web Audio se o stream também estiver
    // ligado a um elemento de mídia, então fica num <audio> mudo e escondido.
    if (!p.audioEl) {
      p.audioEl = document.createElement('audio');
      p.audioEl.autoplay = true;
      p.audioEl.muted = true;
      p.audioEl.style.display = 'none';
      document.body.appendChild(p.audioEl);
    }
    p.audioEl.srcObject = stream;
    p.audioEl.play().catch(() => {});
    if (p.voiceSrc) { try { p.voiceSrc.disconnect(); } catch {} }
    if (!p.voiceGain) {
      p.voiceGain = audioCtx.createGain();
      p.voiceGain.connect(outMaster);
      p.analyser = audioCtx.createAnalyser();
      p.analyser.fftSize = 512;
    }
    p.voiceSrc = audioCtx.createMediaStreamSource(stream);
    p.voiceSrc.connect(p.voiceGain);
    p.voiceSrc.connect(p.analyser);
    applyVolumes();
  });
}

// Níveis de qualidade da tela enviada. Se a rede de alguém piorar, desce um nível para
// aquela pessoa (menos resolução e bitrate) em vez de travar; quando melhora, sobe de novo.
const ADAPT_LEVELS = [
  { scale: 1,   br: 1,    label: 'máxima' },
  { scale: 1.5, br: 0.55, label: 'média' },
  { scale: 2,   br: 0.3,  label: 'baixa' }
];

// Miniatura (tela em foco, #47): quem assiste está vendo esta tela pequena
const THUMB = { scale: 4, bitrate: 300000, fps: 10 };
// mode: o que quem assiste pediu ('full' = normal, 'thumb' = miniatura, 'off' = app dele escondido)
function applyEncoding(pc, level, mode = 'full') {
  pc.getSenders().forEach(s => {
    if (!s.track || s.track.kind !== 'video') return;
    // Fila por sender (#55): setParameters é assíncrono e duas alterações ao mesmo tempo
    // (foco, pausa, qualidade adaptativa) podem colidir e uma ser rejeitada. Guardamos só o
    // ÚLTIMO pedido e aplicamos um de cada vez, sempre com os parâmetros mais recentes.
    s._want = { level, mode };
    if (s._applying) return; // a aplicação em andamento pega este pedido em seguida
    s._applying = true;
    (async () => {
      let fails = 0;
      while (s._want) {
        const w = s._want;
        s._want = null;
        try {
          await s.setParameters(encodingParams(s, w.level, w.mode));
          fails = 0;
        } catch (e) {
          console.warn('setParameters', e);
          if (++fails <= 2 && !s._want) s._want = w; // tenta de novo (a conexão pode ter fechado)
        }
      }
      s._applying = false;
    })();
  });
}

function encodingParams(s, level, mode) {
  const L = ADAPT_LEVELS[level] || ADAPT_LEVELS[0];
  const params = s.getParameters();
  if (!params.encodings || !params.encodings.length) params.encodings = [{}];
  // vídeo pausado para quem não está olhando: não codifica nem envia (o áudio da tela continua)
  params.encodings[0].active = mode !== 'off';
  const thumb = mode === 'thumb';
  params.encodings[0].maxBitrate = Math.round(thumb ? Math.min(THUMB.bitrate, currentQuality.bitrate * L.br) : currentQuality.bitrate * L.br);
  params.encodings[0].maxFramerate = thumb ? Math.min(THUMB.fps, currentQuality.fps) : currentQuality.fps;
  params.encodings[0].scaleResolutionDownBy = thumb ? Math.max(THUMB.scale, L.scale) : L.scale;
  params.degradationPreference = currentQuality.fps >= 60 ? 'maintain-framerate' : 'balanced';
  return params;
}

// A chamada da tela é uma conexão separada da voz. Se ela não conecta ou cai, quem compartilha
// refaz a chamada (com limite) e quem assiste pede de novo ('screen-request') se a tela não chega.
let screenCfg = { connectMs: 15000, max: 5, delays: [1000, 2000, 4000, 8000, 15000], waitMs: 12000, maxRequests: 4 };

function retryScreen(p, call) {
  if (p.screenOut !== call) return; // já existe uma chamada mais nova
  try { call.close(); } catch {}
  p.screenOut = null;
  if (!screenStream || !isOpen(p.id)) return;
  p.screenTries = (p.screenTries || 0) + 1;
  logEvent(`minha tela para ${p.name}: refazendo a chamada (tentativa ${p.screenTries})`);
  if (p.screenTries > screenCfg.max) {
    if (!p.screenWarned) {
      p.screenWarned = true;
      showToast(`⚠️ Sua tela não está chegando para ${displayName(p)}. A rede de um dos dois está bloqueando o vídeo.`, 'warn', 10000);
    }
    return;
  }
  const delay = screenCfg.delays[Math.min(p.screenTries - 1, screenCfg.delays.length - 1)];
  setTimeout(() => { if (screenStream && isOpen(p.id) && !p.screenOut) callScreen(p.id); }, delay);
}

function callScreen(id) {
  const p = getPeer(id);
  if (p.screenOut) { const old = p.screenOut; p.screenOut = null; try { old.close(); } catch {} }
  if (p.conn && p.conn.open) { try { p.conn.send({ type: 'screen-start' }); } catch {} }
  const call = peer.call(id, screenStream, { metadata: { kind: 'screen' } });
  p.screenOut = call;
  p.screenCalledAt = Date.now();
  p.sendLevel = 0;
  call.on('error', () => retryScreen(p, call));
  call.on('close', () => { if (p.screenOut === call && screenStream) retryScreen(p, call); });
  const pc = call.peerConnection;
  if (!pc) return;
  const t0 = Date.now();
  let started = false, bad = 0, good = 0, prevLost = 0, prevSent = 0;
  const loop = async () => {
    if (p.screenOut !== call || pc.connectionState === 'closed') return;
    if (pc.connectionState === 'failed' || (!started && Date.now() - t0 > screenCfg.connectMs)) {
      retryScreen(p, call);
      return;
    }
    if (pc.connectionState === 'connected') {
      if (!started) { started = true; p.screenTries = 0; p.screenWarned = false; applyEncoding(pc, p.sendLevel, p.viewMode); }
      if (p.viewMode && p.viewMode !== 'full') { setTimeout(loop, 2000); return; } // pausado/miniatura: nada para adaptar
      try {
        const stats = await pc.getStats();
        let lost = 0, sent = 0, avail = null;
        stats.forEach(r => {
          if (r.type === 'remote-inbound-rtp' && r.kind === 'video') lost += r.packetsLost || 0;
          if (r.type === 'outbound-rtp' && r.kind === 'video') sent += r.packetsSent || 0;
          if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded' && r.availableOutgoingBitrate) avail = r.availableOutgoingBitrate;
        });
        const dl = lost - prevLost, ds = sent - prevSent;
        prevLost = lost; prevSent = sent;
        const loss = ds > 0 ? Math.max(0, dl) / ds : 0;
        const need = currentQuality.bitrate * ADAPT_LEVELS[p.sendLevel].br;
        const isBad = loss > 0.05 || (avail != null && avail < need * 0.6);
        const nextUp = p.sendLevel > 0 ? currentQuality.bitrate * ADAPT_LEVELS[p.sendLevel - 1].br : 0;
        const isGood = loss < 0.01 && (avail == null || avail > nextUp * 1.2);
        bad = isBad ? bad + 1 : 0;
        good = isGood ? good + 1 : 0;
        if (bad >= 2 && p.sendLevel < ADAPT_LEVELS.length - 1) {
          p.sendLevel++; bad = 0; applyEncoding(pc, p.sendLevel, p.viewMode); paintSendQuality();
        } else if (good >= 5 && p.sendLevel > 0) {
          p.sendLevel--; good = 0; applyEncoding(pc, p.sendLevel, p.viewMode); paintSendQuality();
        }
      } catch (e) { console.warn('adapt', e); }
    }
    setTimeout(loop, started ? 2000 : 500);
  };
  loop();
}

// Quem assiste: a pessoa avisou que está compartilhando, mas a tela não chegou (ou caiu)
function checkScreenIn(p, now) {
  if (!p.sharing || !p.conn || !p.conn.open) return;
  const pc = p.screenIn && p.screenIn.peerConnection;
  if (pc && pc.connectionState === 'failed') {
    try { p.screenIn.close(); } catch {}
    p.screenIn = null;
    removeTile(p.id);
  }
  if (tileEl(p.id) && p.screenIn) { p.screenReqs = 0; p.screenWaitSince = now; return; }
  if (now - (p.screenWaitSince || now) < screenCfg.waitMs) return;
  p.screenWaitSince = now;
  p.screenReqs = (p.screenReqs || 0) + 1;
  if (p.screenReqs > screenCfg.maxRequests) {
    if (!p.screenInWarned) {
      p.screenInWarned = true;
      showToast(`⚠️ A tela de ${displayName(p)} não está chegando. A rede de um dos dois está bloqueando o vídeo.`, 'warn', 10000);
    }
    return;
  }
  logEvent(`tela de ${p.name} não chegou: pedindo de novo (${p.screenReqs})`);
  try { p.conn.send({ type: 'screen-request' }); } catch {}
}

// Mostra na sua prévia se a qualidade foi reduzida para alguém
function paintSendQuality() {
  const t = tileEl('__local__');
  if (!t) return;
  const reduced = [...peers.values()].filter(p => p.screenOut && p.sendLevel > 0);
  const el = t.querySelector('.q');
  if (!el) return;
  el.textContent = reduced.length
    ? '⚠️ Qualidade reduzida para: ' + reduced.map(p => `${p.name} (${ADAPT_LEVELS[p.sendLevel].label})`).join(', ')
    : '';
}

// =====================================================================
// COMPARTILHAR TELA
// =====================================================================
async function openPicker() {
  const sources = await window.native.getSources();
  const grid = $('sourceGrid');
  grid.innerHTML = '';
  return new Promise(resolve => {
    const close = val => { $('picker').classList.add('hidden'); resolve(val); };
    sources.forEach(s => {
      const d = document.createElement('div');
      d.className = 'source';
      const img = document.createElement('img'); img.src = s.thumb;
      const sp = document.createElement('span'); sp.textContent = s.name; sp.title = s.name;
      d.append(img, sp);
      d.onclick = () => close(s.id);
      grid.appendChild(d);
    });
    $('pickerCancel').onclick = () => close(null);
    $('picker').classList.remove('hidden');
  });
}

async function startShare() {
  const id = await openPicker();
  if (!id) return;
  const withAudio = $('shareAudioChk').checked;
  currentQuality = QUALITY[$('qualitySelect').value];
  await window.native.selectSource(id, withAudio);

  try {
    screenRaw = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: currentQuality.fps },
      // restrictOwnAudio: o áudio do PC NÃO inclui o som do próprio TelaShare (as vozes da
      // sala). Sem isso, quem compartilha reenvia a voz de todo mundo e todos ouvem eco (#35).
      audio: withAudio ? { restrictOwnAudio: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false
    });
  } catch (e) {
    alert('Não foi possível capturar a tela: ' + e.message);
    return;
  }

  const vTrack = screenRaw.getVideoTracks()[0];
  try {
    await vTrack.applyConstraints({
      width: { max: currentQuality.w }, height: { max: currentQuality.h },
      frameRate: { max: currentQuality.fps }
    });
  } catch (e) { console.warn('applyConstraints', e); }
  vTrack.contentHint = currentQuality.fps >= 60 ? 'motion' : 'detail';
  vTrack.onended = stopShare;

  const tracks = [vTrack];
  const aTrack = screenRaw.getAudioTracks()[0];
  screenAudioExcludesSelf = null;
  if (aTrack) {
    const st = aTrack.getSettings ? aTrack.getSettings() : {};
    screenAudioExcludesSelf = st.restrictOwnAudio === true;
    if (!screenAudioExcludesSelf) {
      showToast('⚠️ Este PC não conseguiu separar o som da chamada do áudio do PC: quem está na sala ' +
                'pode ouvir a própria voz repetida. Se não precisar do som da tela, desmarque "Incluir áudio do PC".', 'warn', 12000);
    }
  }
  if (aTrack) {
    // passa o áudio da tela por um ganho (volume ajustável)
    screenAudioNode = audioCtx.createMediaStreamSource(new MediaStream([aTrack]));
    screenGain = audioCtx.createGain();
    screenGain.gain.value = $('shareVol').value / 100;
    const dest = audioCtx.createMediaStreamDestination();
    screenAudioNode.connect(screenGain).connect(dest);
    tracks.push(dest.stream.getAudioTracks()[0]);
  }
  screenStream = new MediaStream(tracks);

  for (const p of peers.values()) if (p.conn && p.conn.open) callScreen(p.id);

  localPreview = new MediaStream([vTrack]);
  showTile('__local__', localPreview, true);
  applyPreviewHidden();
  playSound('share-on');
  const b = $('shareBtn');
  b.textContent = '⏹️ Parar compartilhamento';
  b.classList.add('sharing');
  b.classList.remove('primary');
}

function stopShare() {
  if (!screenStream && !screenRaw) return;
  if (!leaving) playSound('share-off');
  localPreview = null;
  for (const p of peers.values()) {
    if (p.screenOut) { const c = p.screenOut; p.screenOut = null; try { c.close(); } catch {} }
    if (p.conn && p.conn.open) p.conn.send({ type: 'screen-stop' });
  }
  if (screenRaw) screenRaw.getTracks().forEach(t => t.stop());
  if (screenStream) screenStream.getTracks().forEach(t => t.stop());
  if (screenAudioNode) screenAudioNode.disconnect();
  screenRaw = screenStream = screenAudioNode = screenGain = null;
  removeTile('__local__');
  const b = $('shareBtn');
  b.textContent = '🖥️ Compartilhar tela';
  b.classList.remove('sharing');
  b.classList.add('primary');
}

// =====================================================================
// INTERFACE: telas e participantes
// =====================================================================
// Prévia da sua própria tela compartilhada: pode ser ocultada (economiza GPU)
let localPreview = null;
// true quando o áudio do PC capturado exclui o som do próprio app (sem eco das vozes)
let screenAudioExcludesSelf = null;
function applyPreviewHidden() {
  const t = tileEl('__local__');
  if (!t) return;
  const hide = store.get('hidePreview', false);
  t.classList.toggle('collapsed', hide);
  const v = t.querySelector('video');
  if (hide) { v.srcObject = null; }
  else if (localPreview && v.srcObject !== localPreview) { v.srcObject = localPreview; v.play().catch(() => {}); }
  const b = t.querySelector('.prevBtn');
  if (b) b.textContent = hide ? '👁️ Mostrar prévia' : '🙈 Ocultar prévia';
}
function togglePreview() {
  store.set('hidePreview', !store.get('hidePreview', false));
  applyPreviewHidden();
}

function tileEl(id) { return document.querySelector(`.tile[data-id="${CSS.escape(id)}"]`); }
function tileVideo(id) { const t = tileEl(id); return t ? t.querySelector('video') : null; }

function showTile(id, stream, isLocal) {
  let t = tileEl(id);
  if (!t) {
    t = document.createElement('div');
    t.className = 'tile' + (isLocal ? ' local' : '');
    t.dataset.id = id;

    const v = document.createElement('video');
    v.autoplay = true; v.playsInline = true;
    v.muted = true; // o áudio da tela toca pelo Web Audio (permite passar de 100%)
    v.ondblclick = () => toggleFullscreen(t);

    const bar = document.createElement('div');
    bar.className = 'bar';
    const who = document.createElement('span');
    who.className = 'who';
    bar.appendChild(who);

    if (!isLocal) {
      const p = getPeer(id);
      const lbl = document.createElement('span'); lbl.textContent = '🔊';
      const r = document.createElement('input');
      r.type = 'range'; r.min = 0; r.max = 400; r.step = 5; r.value = Math.round(p.screenVol * 100);
      r.title = 'Volume do áudio desta tela';
      const val = document.createElement('span');
      val.className = 'pct';
      val.textContent = r.value + '%';
      r.oninput = () => {
        p.screenVol = r.value / 100;
        val.textContent = r.value + '%';
        store.set(volKey('psvol', p), p.screenVol);
        applyVolumes();
      };
      bar.append(lbl, r, val);
    }
    if (isLocal) {
      const q = document.createElement('span');
      q.className = 'q';
      q.title = 'A qualidade baixa sozinha para quem está com a rede lenta';
      const pb = document.createElement('button');
      pb.className = 'prevBtn';
      pb.title = 'Ocultar a prévia da sua tela (os outros continuam vendo)';
      pb.onclick = togglePreview;
      bar.append(q, pb);
    }
    const mut = document.createElement('span');
    mut.className = 'tmut'; mut.textContent = '🔇'; mut.title = 'Microfone mudo';
    bar.appendChild(mut);
    if (!isLocal) {
      const wb = document.createElement('button');
      wb.className = 'watchBtn';
      wb.onclick = () => toggleWatch(id);
      bar.appendChild(wb);
    }
    const fb = document.createElement('button');
    fb.className = 'focusBtn';
    fb.onclick = () => toggleFocus(id);
    bar.appendChild(fb);
    v.onclick = () => toggleFocus(id);
    const fs = document.createElement('button');
    fs.textContent = 'Tela cheia';
    fs.onclick = () => toggleFullscreen(t);
    bar.appendChild(fs);

    t.append(v, bar);
    $('grid').appendChild(t);
  }
  const v = t.querySelector('video');
  if (v.srcObject !== stream && !(isLocal && t.classList.contains('collapsed'))) {
    v.srcObject = stream;
    v.play().catch(() => {});
    if (!isLocal) attachScreenAudio(getPeer(id), stream);
  }
  updateTileName(isLocal ? { id, name: $('nameInput').value.trim() } : getPeer(id));
  applyFocus();
  if (!isLocal) paintMuted(getPeer(id));
  applyVolumes();
  $('empty').classList.add('hidden');
}

function attachScreenAudio(p, stream) {
  if (p.screenSrc) { try { p.screenSrc.disconnect(); } catch {} p.screenSrc = null; }
  const a = stream.getAudioTracks()[0];
  if (!a) return;
  if (!p.screenGainNode) {
    p.screenGainNode = audioCtx.createGain();
    p.screenGainNode.connect(outMaster);
  }
  p.screenSrc = audioCtx.createMediaStreamSource(new MediaStream([a]));
  p.screenSrc.connect(p.screenGainNode);
  applyVolumes();
}

function updateTileName(p) {
  const t = tileEl(p.id);
  if (!t) return;
  const who = t.querySelector('.who');
  who.textContent = '';
  if (p.id === '__local__') { who.textContent = p.name; return; }
  who.append(makeAvatar(p), document.createTextNode(' ' + displayName(p)));
}
function updateAllTileNames() {
  for (const p of peers.values()) updateTileName(p);
}

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
// TELA EM FOCO (#47): clicando numa tela, ela fica grande e as outras viram miniaturas.
// Para as miniaturas, pedimos a quem compartilha uma qualidade bem menor (THUMB), aliviando
// CPU, GPU e rede dos dois lados. Clicando de novo (ou em "↩️"), volta para a grade.
// =====================================================================
let focusId = null;
function toggleFocus(id) {
  focusId = focusId === id ? null : id;
  applyFocus();
}
// =====================================================================
// NÃO ASSISTIR UMA TELA (#59): a tela vira uma barrinha e quem compartilha para de enviar o
// vídeo para você (os dois PCs aliviam). O som da tela continua, com o volume na barrinha.
// O app lembra a escolha durante a sessão, mesmo se a pessoa parar e voltar a compartilhar.
// =====================================================================
const unwatched = new Set(); // instalação (deviceId) ou ID de quem eu escolhi não assistir
const watchKey = p => p.deviceId || p.id;
function isUnwatched(p) { return unwatched.has(watchKey(p)); }
function toggleWatch(id) {
  const p = peers.get(id);
  if (!p) return;
  const k = watchKey(p);
  if (unwatched.has(k)) unwatched.delete(k); else unwatched.add(k);
  logEvent(`${isUnwatched(p) ? 'parei de assistir' : 'voltei a assistir'} a tela de ${p.name}`);
  if (isUnwatched(p) && focusId === id) focusId = null;
  applyFocus(); // atualiza as telas e avisa quem compartilha (screen-view)
}

function applyFocus() {
  const grid = $('grid');
  if (focusId && !tileEl(focusId)) focusId = null;
  const on = !!focusId && grid.children.length > 1;
  grid.classList.toggle('focus', on);
  for (const t of grid.children) {
    const f = on && t.dataset.id === focusId;
    t.classList.toggle('focused', f);
    const p = peers.get(t.dataset.id);
    const off = !!p && isUnwatched(p);
    t.classList.toggle('unwatched', off);
    const w = t.querySelector('.watchBtn');
    if (w) {
      w.textContent = off ? '👁️ Assistir' : '🙈';
      w.title = off ? 'Voltar a assistir esta tela' : 'Não assistir esta tela (para de receber o vídeo e alivia o PC; o som continua)';
    }
    const b = t.querySelector('.focusBtn');
    if (b) {
      b.textContent = f ? '↩️' : '🔍';
      b.title = f ? 'Voltar para a grade' : 'Destacar esta tela (as outras ficam pequenas e mais leves)';
    }
  }
  broadcastViewMode();
}

function removeTile(id) {
  const t = tileEl(id);
  if (t) {
    const v = t.querySelector('video');
    if (v) v.srcObject = null;
    t.remove();
  }
  const p = peers.get(id);
  if (p && p.screenSrc) { try { p.screenSrc.disconnect(); } catch {} p.screenSrc = null; }
  if (!$('grid').children.length) $('empty').classList.remove('hidden');
  applyFocus();
}

function toggleFullscreen(el) {
  if (document.fullscreenElement) document.exitFullscreen();
  else el.requestFullscreen().catch(() => {});
}

function renderPeers() {
  assignColors();
  const ul = $('peerList');
  ul.innerHTML = '';
  const list = [...peers.values()].filter(p => p.conn);
  // pessoas da sala com quem a ligação direta não fecha: aparecem com aviso
  for (const id of unreachable) {
    if (isOpen(id)) continue;
    const li = document.createElement('li');
    li.className = 'missing';
    li.dataset.id = id;
    li.title = 'Esta pessoa está na sala, mas a ligação direta com ela não fecha. Veja "Avançado" (TURN) ou use uma VPN.';
    li.textContent = `⚠️ ${rosterName(id)}: sem conexão direta (tentando de novo...)`;
    ul.appendChild(li);
  }
  if (!list.length) {
    if (!ul.children.length) ul.innerHTML = '<li class="hint">Ninguém conectado</li>';
    updateBadge();
    return;
  }
  for (const p of list) {
    const li = document.createElement('li');
    li.dataset.id = p.id;
    const top = document.createElement('div');
    top.className = 'pname';
    const dot = document.createElement('span'); dot.className = 'dot wait';
    dot.title = 'Qualidade da conexão';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = displayName(p);
    if (p.deviceId) nm.title = 'ID desta instalação: ' + peerTag(p);
    const spk = document.createElement('span'); spk.className = 'spk'; spk.textContent = '🔊';
    const mut = document.createElement('span'); mut.className = 'mut'; mut.textContent = '🔇'; mut.title = 'Microfone mudo';
    top.append(dot, makeAvatar(p), nm, spk, mut);

    const net = document.createElement('div');
    net.className = 'net';
    net.textContent = 'Conectando...';

    const lbl = document.createElement('label');
    lbl.className = 'vol';
    const val = document.createElement('span');
    val.textContent = Math.round(p.vol * 100) + '%';
    lbl.append('Volume da voz: ', val);
    const r = document.createElement('input');
    r.type = 'range'; r.min = 0; r.max = 400; r.step = 5; r.value = Math.round(p.vol * 100);
    r.oninput = () => {
      p.vol = r.value / 100;
      val.textContent = r.value + '%';
      store.set(volKey('pvol', p), p.vol);
      applyVolumes();
    };
    lbl.appendChild(r);

    li.append(top, net, lbl);
    ul.appendChild(li);
    paintNet(p);
    paintMuted(p);
    li.classList.toggle('speaking', !!p.speaking); // mantém o 🔊 ao redesenhar a lista
  }
  updateBadge();
}

// =====================================================================
// VÍDEO PAUSADO COM O APP ESCONDIDO (#46)
// Com o TelaShare minimizado ou coberto (ex.: jogo em tela cheia), ninguém está olhando as telas.
// Avisamos quem compartilha para PARAR de enviar o vídeo para nós: aqui não decodifica e lá não
// codifica, aliviando os dois PCs. O áudio da tela e as vozes continuam normalmente.
// =====================================================================
const HIDE_PAUSE_DELAY_MS = 2000; // evita pausar numa troca rápida de janela (Alt+Tab)
let viewHidden = false, hideTimer = null;
// O que eu quero receber da tela de p: nada (app escondido), miniatura (outra tela em foco) ou normal
function myViewMode(p) {
  if (viewHidden && $('pauseHiddenChk').checked) return 'off';
  if (p && isUnwatched(p)) return 'off'; // escolhi não assistir esta tela (#59)
  if (p && focusId && focusId !== p.id && $('grid').classList.contains('focus')) return 'thumb';
  return 'full';
}
function sendViewMode(p) {
  const mode = myViewMode(p);
  if (p.lastViewSent === mode && p.lastViewConn === p.conn) return; // não repete o mesmo pedido
  if (p.conn && p.conn.open) {
    try { p.conn.send({ type: 'screen-view', mode }); p.lastViewSent = mode; p.lastViewConn = p.conn; } catch {}
  }
}
function broadcastViewMode() {
  for (const p of peers.values()) sendViewMode(p);
}
function onVisibilityChange() {
  clearTimeout(hideTimer);
  if (document.visibilityState === 'hidden') {
    hideTimer = setTimeout(() => {
      viewHidden = true;
      if (myViewMode() === 'off') logEvent('app escondido: vídeo das telas pausado (o som continua)');
      broadcastViewMode();
    }, HIDE_PAUSE_DELAY_MS);
  } else if (viewHidden) {
    viewHidden = false;
    logEvent('app visível: vídeo das telas retomado');
    broadcastViewMode();
  }
}

// =====================================================================
// DIAGNÓSTICO (#34): "🩺 Copiar diagnóstico" gera um texto com o estado de cada ligação e os
// últimos eventos, para relatar problemas de testes reais (ex.: "B não vê a tela de C").
// Não inclui endereços IP: só o tipo de cada conexão (host / srflx / relay).
// =====================================================================
const diagLog = [];
function logEvent(msg) {
  diagLog.push(`${new Date().toTimeString().slice(0, 8)} ${msg}`);
  if (diagLog.length > 80) diagLog.shift();
}
const shortId = id => (!id ? '-' : id.startsWith(PREFIX) ? 'ID da sala' : id.slice(0, 8));

async function pcInfo(pc) {
  if (!pc) return 'nenhuma';
  let s = `${pc.connectionState}/${pc.iceConnectionState}`;
  try {
    const stats = await pc.getStats();
    let pair = null;
    stats.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId); });
    if (!pair) stats.forEach(r => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
    if (pair) {
      const lc = stats.get(pair.localCandidateId), rc = stats.get(pair.remoteCandidateId);
      s += ` · ${lc ? lc.candidateType : '?'}→${rc ? rc.candidateType : '?'}${lc && lc.protocol ? ' ' + lc.protocol : ''}`;
      if (pair.currentRoundTripTime != null) s += ` · ${Math.round(pair.currentRoundTripTime * 1000)} ms`;
    }
  } catch {}
  return s;
}

async function buildDiagnostics() {
  const L = [];
  let ver = '?';
  try { ver = await window.native.getVersion(); } catch {}
  const pcOf = c => c && c.peerConnection;
  L.push(`TelaShare v${ver} · ${window.native.platform} · ${new Date().toISOString()}`);
  L.push(`Sala: ${roomCode || '-'} · Eu: ${$('nameInput').value.trim() || '-'} (${peer ? shortId(peer.id) : 'fora da sala'})${isHost ? ' · anfitrião' : ''}`);
  L.push(`Servidor de sinalização: ${!peer ? '-' : peer.disconnected ? 'desconectado' : peer.open ? 'conectado' : 'conectando'} · TURN: ${$('turnUrl').value.trim() ? 'configurado' : 'não'}`);
  const sharing = !screenStream ? 'não' : screenStream.getAudioTracks().length
    ? `sim, com áudio do PC (sem as vozes da sala: ${screenAudioExcludesSelf ? 'sim' : 'NÃO'})` : 'sim, sem áudio';
  L.push(`Microfone: ${micMuted ? 'mudo' : 'ligado'} · Compartilhando a tela: ${sharing}`);
  L.push(`App visível: ${viewHidden ? 'não' : 'sim'} · Vídeo das telas que recebo: ${myViewMode() === 'off' ? 'pausado (app escondido)' : 'normal'}`);
  if (focusId) L.push(`Tela em foco: ${focusId === '__local__' ? 'a minha' : (peers.get(focusId) ? displayName(peers.get(focusId)) : focusId)} (as outras em miniatura)`);
  L.push('');
  L.push('Ligações (dados | voz | minha tela → | ← tela da pessoa):');
  const linked = [...peers.values()].filter(p => p.conn);
  if (!linked.length) L.push('- nenhuma');
  for (const p of linked) {
    L.push(`- ${displayName(p)} (${shortId(p.id)})${p.muted ? ' · mudo' : ''}${p.sharing ? ' · compartilhando' : ''}`);
    L.push(`    dados: ${p.conn.open ? 'aberto' : 'fechado'} [${await pcInfo(pcOf(p.conn))}]`);
    L.push(`    voz: [${await pcInfo(pcOf(p.micCall))}]${p.voiceStream ? '' : ' · sem áudio recebido'}`);
    if (screenStream) L.push(`    minha tela →: [${await pcInfo(pcOf(p.screenOut))}]${p.screenTries ? ` · tentativas ${p.screenTries}` : ''}${p.viewMode === 'off' ? ' · vídeo pausado (app da pessoa escondido)' : ''}`);
    if (p.sharing || p.screenIn) L.push(`    ← tela: [${await pcInfo(pcOf(p.screenIn))}] · ${tileEl(p.id) ? 'aparecendo' : 'NÃO aparece'}${isUnwatched(p) ? ' · não estou assistindo (vídeo pausado)' : ''}${p.screenReqs ? ` · pedidos ${p.screenReqs}` : ''}`);
  }
  const missing = [...roster.keys()].filter(id => !isOpen(id) && !(peers.get(id) && peers.get(id).conn));
  if (missing.length) {
    L.push('');
    L.push('Na sala, mas SEM ligação comigo:');
    for (const id of missing) {
      const r = pairRetry.get(id);
      L.push(`- ${rosterName(id)} (${shortId(id)}) · ${unreachable.has(id) ? 'avisado' : 'tentando'} · tentativas: ${r ? r.n : 0} · ` +
             `quem inicia: ${peer && peer.id < id ? 'eu' : 'a outra pessoa'}${pending.has(id) ? ' · tentativa em andamento' : ''}`);
    }
  }
  L.push('');
  L.push('Últimos eventos:');
  L.push(...(diagLog.length ? diagLog : ['(nenhum)']));
  return L.join('\n');
}

async function copyDiagnostics() {
  await window.native.copyText(await buildDiagnostics());
  const b = $('diagBtn');
  b.textContent = '✅ Diagnóstico copiado!';
  setTimeout(() => (b.textContent = '🩺 Copiar diagnóstico'), 2000);
  showToast('🩺 Diagnóstico copiado. Cole na conversa com quem está ajudando (não tem endereços IP).', 'ok');
}

// =====================================================================
// HEARTBEAT: detecta quem saiu sem avisar (app fechado, internet caiu)
// =====================================================================
const HEARTBEAT_MS = 2000;
const PEER_TIMEOUT_MS = 8000;

function heartbeatLoop() {
  const now = Date.now();
  for (const p of [...peers.values()]) {
    if (!p.conn) continue;
    if (p.conn.open) { try { p.conn.send({ type: 'ping' }); } catch {} }
    const pcs = [p.conn.peerConnection, p.micCall && p.micCall.peerConnection].filter(Boolean);
    const dead = pcs.some(pc => pc.connectionState === 'failed' || pc.connectionState === 'closed');
    if (dead || now - (p.lastSeen || now) > PEER_TIMEOUT_MS) {
      console.warn('Removendo participante sem resposta:', p.name);
      removePeer(p.id, 'timeout');
    }
  }
  setTimeout(heartbeatLoop, HEARTBEAT_MS);
}

function broadcast(msg) {
  for (const p of peers.values()) {
    if (p.conn && p.conn.open) { try { p.conn.send(msg); } catch {} }
  }
}

function paintMuted(p) {
  const li = document.querySelector(`#peerList li[data-id="${CSS.escape(p.id)}"]`);
  if (li) li.classList.toggle('muted', !!p.muted);
  const t = tileEl(p.id);
  if (t) t.classList.toggle('muted', !!p.muted);
}

function sayGoodbye() {
  for (const p of peers.values()) {
    if (p.conn && p.conn.open) { try { p.conn.send({ type: 'bye' }); } catch {} }
  }
}

// =====================================================================
// INDICADOR DE CONEXÃO
// =====================================================================
function updateBadge() {
  const badge = $('connBadge');
  const text = $('connText');
  const n = [...peers.values()].filter(p => p.conn && p.conn.open).length;
  let cls, t;
  if (rejoining) { cls = 'bad'; t = `Reconectando (${rejoinAttempt} de ${rejoinCfg.max})...`; }
  else if (!peer) { cls = 'off'; t = 'Desconectado'; }
  else if (peer.disconnected) { cls = 'bad'; t = n ? `Servidor caiu · reconectando (${n} ainda conectado${n > 1 ? 's' : ''})` : 'Sem servidor · reconectando...'; }
  else if (n) {
    const bad = [...peers.values()].some(p => p.net && (p.net.cls === 'bad' || p.net.cls === 'warn'));
    cls = bad ? 'warn' : 'good';
    t = `Conectado · ${n} pessoa${n > 1 ? 's' : ''}`;
  }
  else if (joinTarget) { cls = 'wait'; t = 'Conectando à sala...'; }
  else { cls = 'good'; t = isHost ? 'Online · aguardando pessoas' : 'Online'; }
  badge.className = 'badge ' + cls;
  text.textContent = t;
}

function paintNet(p) {
  const li = document.querySelector(`#peerList li[data-id="${CSS.escape(p.id)}"]`);
  if (!li) return;
  const dot = li.querySelector('.dot');
  const net = li.querySelector('.net');
  const n = p.net || { cls: 'wait', text: 'Conectando...' };
  dot.className = 'dot ' + n.cls;
  net.textContent = n.text;
  net.className = 'net ' + n.cls;
}

async function readNet(p) {
  const pc = p.micCall && p.micCall.peerConnection;
  if (!pc) return { cls: 'wait', text: 'Conectando...' };
  const st = pc.connectionState;
  if (st === 'failed') return { cls: 'bad', text: 'Conexão perdida' };
  if (st === 'disconnected') return { cls: 'warn', text: 'Instável · tentando reconectar...' };
  if (st !== 'connected') return { cls: 'wait', text: 'Conectando...' };

  const stats = await pc.getStats();
  let pair = null, lost = 0, recv = 0;
  stats.forEach(r => {
    if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId);
    if (r.type === 'inbound-rtp' && r.kind === 'audio') { lost += r.packetsLost || 0; recv += r.packetsReceived || 0; }
  });
  if (!pair) stats.forEach(r => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });

  const rtt = pair && pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null;
  const lc = pair && stats.get(pair.localCandidateId);
  const rc = pair && stats.get(pair.remoteCandidateId);
  let via = 'direta';
  if ((lc && lc.candidateType === 'relay') || (rc && rc.candidateType === 'relay')) via = 'via TURN';
  else if (lc && rc && lc.candidateType === 'host' && rc.candidateType === 'host') via = 'rede local/VPN';

  // perda de pacotes desde a última leitura
  const prev = p._lossPrev || { lost, recv };
  const dl = lost - prev.lost, dr = recv - prev.recv;
  p._lossPrev = { lost, recv };
  const loss = dl + dr > 0 ? Math.max(0, (dl / (dl + dr)) * 100) : 0;

  let cls = 'good';
  if ((rtt != null && rtt > 300) || loss > 10) cls = 'bad';
  else if ((rtt != null && rtt > 150) || loss > 3) cls = 'warn';
  const parts = [rtt != null ? `${rtt} ms` : null, via, loss >= 1 ? `${loss.toFixed(0)}% perda` : null].filter(Boolean);
  return { cls, text: parts.join(' · ') };
}

async function netLoop() {
  for (const p of peers.values()) {
    if (!p.conn) continue;
    try { p.net = await readNet(p); } catch (e) { console.warn('stats', e); }
    paintNet(p);
  }
  updateBadge();
  setTimeout(netLoop, 2000);
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
function parseVer(v) { return String(v || '').replace(/^v/i, '').split(/[.-]/).slice(0, 3).map(n => parseInt(n, 10) || 0); }
function isNewer(latest, current) {
  const a = parseVer(latest), b = parseVer(current);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}
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
  outVolume = $('outVol').value / 100;

  initAudio();
  await openMic(store.get('mic', ''));
  await refreshDevices();
  await setOutputDevice($('outSelect').value);
  navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
  applyVolumes();
  meterLoop();
  setInterval(voiceLoop, VOICE_INTERVAL_MS);
  netLoop();
  heartbeatLoop();
  meshLoop();

  if (window.native.platform !== 'win32') {
    $('shareAudioChk').parentElement.title = 'Áudio do sistema só é capturado no Windows';
  }

  // eventos
  $('hostBtn').onclick = hostRoom;
  $('joinBtn').onclick = joinRoom;
  $('leaveBtn').onclick = leaveRoom;
  $('inviteBtn').onclick = copyInvite;
  $('diagBtn').onclick = copyDiagnostics;
  $('rejoinBtn').onclick = rejoinLast;
  paintRejoin();
  initSidebarToggle();
  $('pauseHiddenChk').checked = store.get('pauseHidden', true);
  $('pauseHiddenChk').onchange = () => { store.set('pauseHidden', $('pauseHiddenChk').checked); broadcastViewMode(); };
  document.addEventListener('visibilitychange', onVisibilityChange);
  $('projectLink').onclick = e => { e.preventDefault(); window.native.openProject && window.native.openProject(); };
  initAbout();
  initUpdates();
  $('licenseLink').onclick = e => { e.preventDefault(); window.native.openLicense && window.native.openLicense(); };
  try {
    const v = 'v' + (await window.native.getVersion());
    $('appVersion').textContent = v;
    $('aboutVersion').textContent = v;
  } catch {}
  $('roomInput').onkeydown = e => { if (e.key === 'Enter') joinRoom(); };

  $('micSelect').onchange = async () => { store.set('mic', $('micSelect').value); await openMic($('micSelect').value); };
  for (const [id, key] of [['noiseChk', 'noise'], ['echoChk', 'echo'], ['agcChk', 'agc']]) {
    $(id).onchange = async () => { store.set(key, $(id).checked); await openMic($('micSelect').value); };
  }
  $('monitorBtn').onclick = toggleMonitor;
  $('recBtn').onclick = recordTest;
  $('testOutBtn').onclick = testOutput;
  document.addEventListener('click', () => { if (audioCtx.state !== 'running') audioCtx.resume(); });
  $('micVol').oninput = () => {
    setGain(micGain, $('micVol').value / 100);
    $('micVolVal').textContent = $('micVol').value + '%';
    store.set('micVol', +$('micVol').value);
  };
  $('muteBtn').onclick = () => setMuted(!micMuted);

  $('outSelect').onchange = () => { store.set('out', $('outSelect').value); setOutputDevice($('outSelect').value); };
  $('outVol').oninput = () => {
    outVolume = $('outVol').value / 100;
    $('outVolVal').textContent = $('outVol').value + '%';
    store.set('outVol', +$('outVol').value);
    applyVolumes();
  };

  $('shareVol').oninput = () => {
    setGain(screenGain, $('shareVol').value / 100);
    $('shareVolVal').textContent = $('shareVol').value + '%';
    store.set('shareVol', +$('shareVol').value);
  };
  $('shareAudioChk').onchange = () => store.set('shareAudio', $('shareAudioChk').checked);
  $('qualitySelect').onchange = () => store.set('quality', $('qualitySelect').value);
  $('shareBtn').onclick = () => (screenStream ? stopShare() : startShare());

  try {
    window.native.onInvite(handleInvite);
    const pending = await window.native.takePendingInvite();
    if (pending) handleInvite(pending);
  } catch (e) { console.warn('convite', e); }

  window.addEventListener('beforeunload', () => {
    stopShare();
    sayGoodbye();
    if (peer) peer.destroy();
  });
}

init();
