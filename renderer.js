'use strict';
/* TelaShare - compartilhamento de tela + áudio em malha P2P (WebRTC via PeerJS) */

const $ = id => document.getElementById(id);
const PREFIX = 'telashare-v1-';
// Servidores STUN descobrem o IP público. Um TURN (opcional, configurado em "Avançado")
// retransmite o tráfego quando a conexão direta é bloqueada por firewall/NAT.
function peerOpts() {
  const iceServers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:global.stun.twilio.com:3478' }
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
//  entrada: mic -> micGain -> micLimiter -> muteGain -> (envio | medidor | monitor)
//  saída:   vozes/telas -> ganho por pessoa -> outMaster -> outLimiter -> alto-falante
let audioCtx, micGain, micLimiter, muteGain, micAnalyser, micDest, monitorGain;
let outMaster, outLimiter;
let micRaw = null, micSource = null, micMuted = false, monitoring = false, recording = false;

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
function makeLimiter(threshold) {
  const c = audioCtx.createDynamicsCompressor();
  c.threshold.value = threshold;
  c.knee.value = 0;
  c.ratio.value = 20;
  c.attack.value = 0.002;
  c.release.value = 0.15;
  return c;
}

// Proteção final contra distorção: até 0,8 passa intacto e acima disso arredonda suavemente,
// nunca passando de 0,98. Pega os picos rápidos que o limitador deixa escapar.
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
  shaper.oversample = '2x';
  pre.connect(shaper);
  return { input: pre, output: shaper };
}

function initAudio() {
  audioCtx = new AudioContext({ latencyHint: 'interactive' });

  // saída
  outMaster = audioCtx.createGain();
  outLimiter = makeLimiter(-3);
  const outSafe = makeSafety();
  outMaster.connect(outLimiter).connect(outSafe.input);
  outSafe.output.connect(audioCtx.destination);

  // entrada
  micGain = audioCtx.createGain();
  micLimiter = makeLimiter(-3);
  muteGain = audioCtx.createGain();
  micAnalyser = audioCtx.createAnalyser();
  micAnalyser.fftSize = 1024;
  micDest = audioCtx.createMediaStreamDestination();
  monitorGain = audioCtx.createGain();
  monitorGain.gain.value = 0;
  const micSafe = makeSafety();
  micGain.connect(micLimiter).connect(micSafe.input);
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
  } catch (e) {
    console.warn('Microfone indisponível', e);
    setStatus('Microfone indisponível: ' + e.message);
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

function meterLoop() {
  const { rms, peak } = levels(micAnalyser);
  const level = Math.min(1, rms * 5);
  const m = $('micMeter');
  m.style.width = (level * 100).toFixed(0) + '%';
  m.classList.toggle('hot', peak > 0.95);
  m.classList.toggle('low', !micMuted && level < 0.08);
  for (const p of peers.values()) {
    if (!p.analyser) continue;
    const li = document.querySelector(`#peerList li[data-id="${CSS.escape(p.id)}"]`);
    if (li) li.classList.toggle('speaking', levels(p.analyser).rms > 0.015);
  }
  requestAnimationFrame(meterLoop);
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
    setGain(p.screenGainNode, p.screenVol);
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
  joinTarget = PREFIX + f.room;
  joinAttempts = 0;
  tryJoin();
}

// Tenta entrar na sala. Cada tentativa espera até 6s pela resposta do anfitrião;
// sem resposta, tenta de novo (o anfitrião pode estar terminando de criar a sala).
// Obs.: não dá para confiar só no erro "peer-unavailable" do servidor público,
// porque depois do primeiro erro ele às vezes deixa as novas tentativas sem resposta.
const JOIN_MAX_ATTEMPTS = 6;
let joinRetryFn = null;

function tryJoin() {
  if (!peer || !joinTarget) return;
  joinAttempts++;
  const myAttempt = joinAttempts;
  setStatus(joinAttempts > 1 ? `Procurando a sala... (tentativa ${joinAttempts} de ${JOIN_MAX_ATTEMPTS})` : 'Procurando a sala...');
  const conn = peer.connect(joinTarget, { reliable: true });
  setupConn(conn, true);

  const started = Date.now();
  let timer = null;
  const retry = () => {
    if (joinAttempts !== myAttempt || !joinTarget) return;
    clearInterval(timer);
    joinRetryFn = null;
    try { conn.close(); } catch {}
    if (joinAttempts >= JOIN_MAX_ATTEMPTS) {
      joinTarget = null;
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
    setStatus(`Sala encontrada. Conectando diretamente... (${ice})`);
    if (ice === 'failed' || elapsed > 30000) {
      clearInterval(timer);
      joinTarget = null;
      joinRetryFn = null;
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

function leaveRoom() {
  leaving = true;
  stopShare();
  sayGoodbye();
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

function setStatus(t) { $('status').textContent = t; if ($('connBadge')) updateBadge(); }
function updateStatus() {
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
    p.lastSeen = Date.now();
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
    const p = peers.get(conn.peer);
    if (!p || p.conn !== conn) return;
    p.lastSeen = Date.now();
    switch (msg.type) {
      case 'ping':
        break;
      case 'bye':
        removePeer(p.id);
        break;
      case 'hello':
        p.name = String(msg.name || 'Sem nome').slice(0, 24);
        // volumes salvos para esta pessoa (pelo nome)
        p.vol = store.get('pvol_' + p.name, p.vol);
        p.screenVol = store.get('psvol_' + p.name, p.screenVol);
        applyVolumes();
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
  [p.voiceSrc, p.voiceGain].forEach(n => { try { n && n.disconnect(); } catch {} });
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
        store.set('psvol_' + p.name, p.screenVol);
        applyVolumes();
      };
      bar.append(lbl, r, val);
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
    v.play().catch(() => {});
    if (!isLocal) attachScreenAudio(getPeer(id), stream);
  }
  updateTileName(isLocal ? { id, name: $('nameInput').value.trim() } : getPeer(id));
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
  if (t) t.querySelector('.who').textContent = p.name;
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
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name;
    const spk = document.createElement('span'); spk.className = 'spk'; spk.textContent = '🔊';
    top.append(dot, nm, spk);

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
      store.set('pvol_' + p.name, p.vol);
      applyVolumes();
    };
    lbl.appendChild(r);

    li.append(top, net, lbl);
    ul.appendChild(li);
    paintNet(p);
  }
  updateBadge();
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
      removePeer(p.id);
    }
  }
  setTimeout(heartbeatLoop, HEARTBEAT_MS);
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
  if (!peer) { cls = 'off'; t = 'Desconectado'; }
  else if (peer.disconnected) { cls = 'bad'; t = n ? `Servidor caiu · reconectando (${n} ainda conectado${n > 1 ? 's' : ''})` : 'Sem servidor · reconectando...'; }
  else if (joinTarget) { cls = 'wait'; t = 'Conectando à sala...'; }
  else if (n) {
    const bad = [...peers.values()].some(p => p.net && (p.net.cls === 'bad' || p.net.cls === 'warn'));
    cls = bad ? 'warn' : 'good';
    t = `Conectado · ${n} pessoa${n > 1 ? 's' : ''}`;
  }
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
  navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
  applyVolumes();
  meterLoop();
  netLoop();
  heartbeatLoop();

  if (window.native.platform !== 'win32') {
    $('shareAudioChk').parentElement.title = 'Áudio do sistema só é capturado no Windows';
  }

  // eventos
  $('hostBtn').onclick = hostRoom;
  $('joinBtn').onclick = joinRoom;
  $('leaveBtn').onclick = leaveRoom;
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

  window.addEventListener('beforeunload', () => {
    stopShare();
    sayGoodbye();
    if (peer) peer.destroy();
  });
}

init();
