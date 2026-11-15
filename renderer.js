'use strict';
/* TelaShare - compartilhamento de tela + áudio em malha P2P (WebRTC via PeerJS) */

const $ = id => document.getElementById(id);
const PREFIX = 'telashare-v1-';
const PEER_OPTS = {
  debug: 1,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ]
  }
};
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
const peers = new Map(); // id -> { id, name, conn, micCall, screenOut, screenIn, audioEl, analyser, vol, screenVol }

let audioCtx, micGain, micAnalyser, micDest;
let micRaw = null, micSource = null, micMuted = false;

let screenRaw = null, screenStream = null, screenAudioNode = null, screenGain = null;
let currentQuality = QUALITY['1080_30'];

let outVolume = 1;
let outDeviceId = '';

// ---------- preferências salvas ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('ts_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ts_' + k, JSON.stringify(v)); } catch {} }
};

// =====================================================================
// ÁUDIO LOCAL (microfone)
// =====================================================================
function initAudio() {
  audioCtx = new AudioContext();
  micGain = audioCtx.createGain();
  micAnalyser = audioCtx.createAnalyser();
  micAnalyser.fftSize = 512;
  micDest = audioCtx.createMediaStreamDestination();
  micGain.connect(micAnalyser);
  micGain.connect(micDest);
  micGain.gain.value = $('micVol').value / 100;
}

async function openMic(deviceId) {
  if (micSource) { micSource.disconnect(); micSource = null; }
  if (micRaw) { micRaw.getTracks().forEach(t => t.stop()); micRaw = null; }
  const nr = $('noiseChk').checked;
  try {
    micRaw = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: nr,
        noiseSuppression: nr,
        autoGainControl: false
      }
    });
    micSource = audioCtx.createMediaStreamSource(micRaw);
    micSource.connect(micGain);
  } catch (e) {
    console.warn('Microfone indisponível', e);
    setStatus('Microfone indisponível: ' + e.message);
  }
}

function setMuted(m) {
  micMuted = m;
  micDest.stream.getAudioTracks().forEach(t => (t.enabled = !m));
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

function rms(analyser) {
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

function meterLoop() {
  const level = micMuted ? 0 : Math.min(1, rms(micAnalyser) * 4);
  $('micMeter').style.width = (level * 100).toFixed(0) + '%';
  for (const p of peers.values()) {
    if (!p.analyser) continue;
    const dot = document.querySelector(`#peerList li[data-id="${CSS.escape(p.id)}"] .dot`);
    if (dot) dot.classList.toggle('speaking', rms(p.analyser) > 0.02);
  }
  requestAnimationFrame(meterLoop);
}

// =====================================================================
// SAÍDA (volumes e dispositivo)
// =====================================================================
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function applyVolumes() {
  for (const p of peers.values()) {
    if (p.audioEl) p.audioEl.volume = clamp01(p.vol * outVolume);
    const v = tileVideo(p.id);
    if (v) v.volume = clamp01(p.screenVol * outVolume);
  }
}

function applySink(el) {
  if (outDeviceId && el.setSinkId) el.setSinkId(outDeviceId).catch(e => console.warn('setSinkId', e));
}

function applySinkAll() {
  for (const p of peers.values()) {
    if (p.audioEl) applySink(p.audioEl);
    const v = tileVideo(p.id);
    if (v) applySink(v);
  }
}

// =====================================================================
// CONEXÃO (PeerJS)
// =====================================================================
function sanitizeRoom(s) { return s.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''); }

function makePeer(id) {
  return new Promise((resolve, reject) => {
    const p = id ? new Peer(id, PEER_OPTS) : new Peer(PEER_OPTS);
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
    if (err.type === 'unavailable-id') alert('Já existe uma sala aberta com esse código. Clique em "Entrar".');
    else alert('Erro ao criar sala: ' + (err.message || err.type));
    return;
  }
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
  const conn = peer.connect(PREFIX + f.room, { reliable: true });
  setupConn(conn, true);
  setTimeout(() => {
    if (peer && !conn.open && peers.size === 0) {
      alert('Sala não encontrada. Confira o código ou peça para alguém clicar em "Criar sala".');
      leaveRoom();
    }
  }, 12000);
}

function enterRoom(room) {
  roomCode = room;
  leaving = false;
  peer.on('connection', conn => setupConn(conn, false));
  peer.on('call', handleIncomingCall);
  peer.on('disconnected', () => {
    if (leaving || !peer || peer.destroyed) return;
    setStatus('Reconectando ao servidor...');
    setTimeout(() => { if (peer && !peer.destroyed && peer.disconnected) peer.reconnect(); }, 2000);
  });
  peer.on('open', () => updateStatus());
  peer.on('error', err => {
    console.warn('peer error', err.type, err);
    if (err.type === 'peer-unavailable') return; // tratado pelo timeout
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

function leaveRoom() {
  leaving = true;
  stopShare();
  for (const id of [...peers.keys()]) removePeer(id);
  if (peer) { peer.destroy(); peer = null; }
  isHost = false;
  $('connectBox').classList.remove('hidden');
  $('roomBox').classList.add('hidden');
  $('shareBtn').disabled = true;
  lockForm(false);
  renderPeers();
}

function lockForm(lock) {
  ['hostBtn', 'joinBtn', 'nameInput', 'roomInput'].forEach(id => ($(id).disabled = lock));
}

function setStatus(t) { $('status').textContent = t; }
function updateStatus() {
  const n = [...peers.values()].filter(p => p.conn && p.conn.open).length;
  setStatus((isHost ? 'Você é o anfitrião. ' : '') + `${n} pessoa(s) conectada(s).`);
}

function getPeer(id) {
  let p = peers.get(id);
  if (!p) {
    p = { id, name: '...', conn: null, micCall: null, screenOut: null, screenIn: null,
          audioEl: null, analyser: null, vol: 1, screenVol: 1 };
    peers.set(id, p);
  }
  return p;
}

// Liga em outro participante. Regra: o ID menor inicia, para não haver conexão duplicada.
function maybeConnect(id) {
  if (!peer || id === peer.id) return;
  const p = peers.get(id);
  if (p && p.conn) return;
  if (peer.id < id) setupConn(peer.connect(id, { reliable: true }), true);
}

function setupConn(conn, outgoing) {
  conn.on('open', () => {
    const p = getPeer(conn.peer);
    if (p.conn && p.conn !== conn && p.conn.open) { conn.close(); return; }
    p.conn = conn;
    conn.send({ type: 'hello', name: $('nameInput').value.trim() });

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
    const p = getPeer(conn.peer);
    switch (msg.type) {
      case 'hello':
        p.name = String(msg.name || 'Sem nome').slice(0, 24);
        renderPeers();
        updateTileName(p);
        break;
      case 'peers':
        (msg.list || []).forEach(maybeConnect);
        break;
      case 'joined':
        maybeConnect(msg.id);
        break;
      case 'screen-stop':
        if (p.screenIn) { p.screenIn.close(); p.screenIn = null; }
        removeTile(p.id);
        break;
    }
  });

  conn.on('close', () => {
    const p = peers.get(conn.peer);
    if (p && p.conn === conn) removePeer(conn.peer);
  });
  conn.on('error', e => console.warn('conn error', e));
}

function removePeer(id) {
  const p = peers.get(id);
  if (!p) return;
  [p.micCall, p.screenOut, p.screenIn].forEach(c => { try { c && c.close(); } catch {} });
  try { p.conn && p.conn.close(); } catch {}
  if (p.audioEl) { p.audioEl.srcObject = null; p.audioEl.remove(); }
  removeTile(id);
  peers.delete(id);
  renderPeers();
  if (peer) updateStatus();
}

// ---------- chamadas de mídia ----------
function callMic(id) {
  const call = peer.call(id, micDest.stream, { metadata: { kind: 'mic' } });
  attachMicCall(call);
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
    call.on('stream', s => showTile(p.id, s, false));
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
    if (!p.audioEl) {
      p.audioEl = document.createElement('audio');
      p.audioEl.autoplay = true;
      p.audioEl.style.display = 'none';
      document.body.appendChild(p.audioEl);
    }
    if (p.audioEl.srcObject !== stream) {
      p.audioEl.srcObject = stream;
      applySink(p.audioEl);
      p.audioEl.play().catch(() => {});
      try {
        const src = audioCtx.createMediaStreamSource(stream);
        p.analyser = audioCtx.createAnalyser();
        p.analyser.fftSize = 512;
        src.connect(p.analyser);
      } catch {}
    }
    applyVolumes();
  });
}

function callScreen(id) {
  const p = getPeer(id);
  if (p.screenOut) { try { p.screenOut.close(); } catch {} }
  const call = peer.call(id, screenStream, { metadata: { kind: 'screen' } });
  p.screenOut = call;
  const pc = call.peerConnection;
  if (pc) {
    const tune = () => {
      if (pc.connectionState !== 'connected') return;
      pc.getSenders().forEach(s => {
        if (!s.track || s.track.kind !== 'video') return;
        const params = s.getParameters();
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = currentQuality.bitrate;
        params.encodings[0].maxFramerate = currentQuality.fps;
        params.degradationPreference = currentQuality.fps >= 60 ? 'maintain-framerate' : 'balanced';
        s.setParameters(params).catch(e => console.warn('setParameters', e));
      });
    };
    pc.addEventListener('connectionstatechange', tune);
  }
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
      audio: withAudio
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

  showTile('__local__', new MediaStream([vTrack]), true);
  const b = $('shareBtn');
  b.textContent = '⏹️ Parar compartilhamento';
  b.classList.add('sharing');
  b.classList.remove('primary');
}

function stopShare() {
  if (!screenStream && !screenRaw) return;
  for (const p of peers.values()) {
    if (p.screenOut) { try { p.screenOut.close(); } catch {} p.screenOut = null; }
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
    v.muted = isLocal;
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
      r.type = 'range'; r.min = 0; r.max = 100; r.value = Math.round(p.screenVol * 100);
      r.title = 'Volume do áudio desta tela';
      r.oninput = () => { p.screenVol = r.value / 100; applyVolumes(); };
      bar.append(lbl, r);
    }
    const fs = document.createElement('button');
    fs.textContent = 'Tela cheia';
    fs.onclick = () => toggleFullscreen(t);
    bar.appendChild(fs);

    t.append(v, bar);
    $('grid').appendChild(t);
  }
  const v = t.querySelector('video');
  if (v.srcObject !== stream) {
    v.srcObject = stream;
    if (!isLocal) applySink(v);
    v.play().catch(() => {});
  }
  updateTileName(isLocal ? { id, name: $('nameInput').value.trim() } : getPeer(id));
  applyVolumes();
  $('empty').classList.add('hidden');
}

function updateTileName(p) {
  const t = tileEl(p.id);
  if (t) t.querySelector('.who').textContent = p.name;
}

function removeTile(id) {
  const t = tileEl(id);
  if (t) {
    const v = t.querySelector('video');
    if (v) v.srcObject = null;
    t.remove();
  }
  if (!$('grid').children.length) $('empty').classList.remove('hidden');
}

function toggleFullscreen(el) {
  if (document.fullscreenElement) document.exitFullscreen();
  else el.requestFullscreen().catch(() => {});
}

function renderPeers() {
  const ul = $('peerList');
  ul.innerHTML = '';
  const list = [...peers.values()].filter(p => p.conn);
  if (!list.length) {
    ul.innerHTML = '<li class="hint">Ninguém conectado</li>';
    return;
  }
  for (const p of list) {
    const li = document.createElement('li');
    li.dataset.id = p.id;
    const top = document.createElement('div');
    top.className = 'pname';
    const dot = document.createElement('span'); dot.className = 'dot';
    const nm = document.createElement('span'); nm.textContent = p.name;
    top.append(dot, nm);

    const lbl = document.createElement('label');
    lbl.className = 'vol';
    const val = document.createElement('span');
    val.textContent = Math.round(p.vol * 100) + '%';
    lbl.append('Volume da voz: ', val);
    const r = document.createElement('input');
    r.type = 'range'; r.min = 0; r.max = 100; r.value = Math.round(p.vol * 100);
    r.oninput = () => { p.vol = r.value / 100; val.textContent = r.value + '%'; applyVolumes(); };
    lbl.appendChild(r);

    li.append(top, lbl);
    ul.appendChild(li);
  }
}

// =====================================================================
// INICIALIZAÇÃO
// =====================================================================
async function init() {
  $('nameInput').value = store.get('name', '');
  $('roomInput').value = store.get('room', '');
  $('micVol').value = store.get('micVol', 100);
  $('outVol').value = store.get('outVol', 100);
  $('shareVol').value = store.get('shareVol', 100);
  $('noiseChk').checked = store.get('noise', true);
  $('shareAudioChk').checked = store.get('shareAudio', true);
  $('qualitySelect').value = store.get('quality', '1080_30');
  $('micVolVal').textContent = $('micVol').value + '%';
  $('outVolVal').textContent = $('outVol').value + '%';
  $('shareVolVal').textContent = $('shareVol').value + '%';
  outVolume = $('outVol').value / 100;

  initAudio();
  await openMic(store.get('mic', ''));
  await refreshDevices();
  outDeviceId = $('outSelect').value;
  navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
  meterLoop();

  if (window.native.platform !== 'win32') {
    $('shareAudioChk').parentElement.title = 'Áudio do sistema só é capturado no Windows';
  }

  // eventos
  $('hostBtn').onclick = hostRoom;
  $('joinBtn').onclick = joinRoom;
  $('leaveBtn').onclick = leaveRoom;
  $('roomInput').onkeydown = e => { if (e.key === 'Enter') joinRoom(); };

  $('micSelect').onchange = async () => { store.set('mic', $('micSelect').value); await openMic($('micSelect').value); };
  $('noiseChk').onchange = async () => { store.set('noise', $('noiseChk').checked); await openMic($('micSelect').value); };
  $('micVol').oninput = () => {
    micGain.gain.value = $('micVol').value / 100;
    $('micVolVal').textContent = $('micVol').value + '%';
    store.set('micVol', +$('micVol').value);
  };
  $('muteBtn').onclick = () => setMuted(!micMuted);

  $('outSelect').onchange = () => { outDeviceId = $('outSelect').value; store.set('out', outDeviceId); applySinkAll(); };
  $('outVol').oninput = () => {
    outVolume = $('outVol').value / 100;
    $('outVolVal').textContent = $('outVol').value + '%';
    store.set('outVol', +$('outVol').value);
    applyVolumes();
  };

  $('shareVol').oninput = () => {
    if (screenGain) screenGain.gain.value = $('shareVol').value / 100;
    $('shareVolVal').textContent = $('shareVol').value + '%';
    store.set('shareVol', +$('shareVol').value);
  };
  $('shareAudioChk').onchange = () => store.set('shareAudio', $('shareAudioChk').checked);
  $('qualitySelect').onchange = () => store.set('quality', $('qualitySelect').value);
  $('shareBtn').onclick = () => (screenStream ? stopShare() : startShare());

  window.addEventListener('beforeunload', () => { if (peer) peer.destroy(); });
}

init();
