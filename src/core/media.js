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
/* NÚCLEO: chamadas de voz e tela, qualidade, compartilhamento, telas visíveis, foco e pausa */

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
      if (!screens.has(p.id)) playSound('share-on');
      if (p.screenInWarned) { p.screenInWarned = false; showToast(`✅ A tela de ${displayName(p)} chegou`, 'ok'); }
      p.screenReqs = 0;
      showScreen(p.id, s, false);
    });
    call.on('close', () => { if (p.screenIn === call) { p.screenIn = null; removeScreen(p.id); } });
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
    // (única exceção à regra "o núcleo não mexe na página": não aparece na tela)
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
          p.sendLevel++; bad = 0; applyEncoding(pc, p.sendLevel, p.viewMode); updateSendQuality();
        } else if (good >= 5 && p.sendLevel > 0) {
          p.sendLevel--; good = 0; applyEncoding(pc, p.sendLevel, p.viewMode); updateSendQuality();
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
    removeScreen(p.id);
  }
  if (screens.has(p.id) && p.screenIn) { p.screenReqs = 0; p.screenWaitSince = now; return; }
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

// Avisa a interface para quem a sua tela está com qualidade reduzida
function updateSendQuality() {
  ui.sendQuality([...peers.values()].filter(p => p.screenOut && p.sendLevel > 0));
}

// =====================================================================
// COMPARTILHAR TELA
// =====================================================================
// Prévia da sua própria tela compartilhada (a interface pode ocultá-la para economizar GPU)
let localPreview = null;
// true quando o áudio do PC capturado exclui o som do próprio app (sem eco das vozes)
let screenAudioExcludesSelf = null;

// =====================================================================
// ÁUDIO DO PC SEM AS VOZES DA SALA (#35)
// No Windows, o som do PC vem do auxiliar telashare-audio.exe, que captura todos os programas
// EXCETO o TelaShare (API de process loopback, Windows 10 2004+). Assim, as vozes que o app toca
// não voltam para dentro do áudio da tela. Se o auxiliar falhar, usa a captura antiga do
// Chromium (todo o som do Windows) e avisa.
// =====================================================================
let pcmNode = null, pcmWorkletLoaded = false, pcAudioFallbackReason = null;
function canUsePcAudioHelper() { return window.native.platform === 'win32'; }

async function startPcAudioHelper() {
  try {
    if (!pcmWorkletLoaded) { await audioCtx.audioWorklet.addModule('pcm-worklet.js'); pcmWorkletLoaded = true; }
    const r = await window.native.pcAudioStart(audioCtx.sampleRate);
    if (!r || !r.ok) { pcAudioFallbackReason = (r && r.error) || 'erro desconhecido'; return null; }
    pcmNode = new AudioWorkletNode(audioCtx, 'pcm-player', { numberOfInputs: 0, outputChannelCount: [2] });
    logEvent(`áudio do PC pelo auxiliar (sem o som do TelaShare), ${r.rate} Hz`);
    return pcmNode;
  } catch (e) {
    pcAudioFallbackReason = e.message;
    try { await window.native.pcAudioStop(); } catch {}
    return null;
  }
}

function stopPcAudioHelper() {
  if (!pcmNode) return;
  try { pcmNode.disconnect(); } catch {}
  pcmNode = null;
  window.native.pcAudioStop().catch(() => {});
}

function onPcAudioData(d) {
  if (!pcmNode || !d || !d.byteLength) return;
  const buf = d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
  pcmNode.port.postMessage(buf, [buf]);
}

function onPcAudioExit(info) {
  if (!pcmNode) return;
  pcmNode = null;
  logEvent(`auxiliar de áudio do PC parou${info && info.error ? ': ' + info.error : ''}`);
  if (screenStream) showToast('⚠️ O áudio do PC parou de ser capturado. Pare e compartilhe de novo para tentar outra vez.', 'warn', 10000);
}

async function startShare() {
  const id = await ui.pickSource();
  if (!id) return;
  const withAudio = !!ui.pref('shareAudio');
  currentQuality = QUALITY[ui.pref('quality')];
  // No Windows, tenta primeiro o auxiliar (áudio do PC sem as vozes da sala)
  pcAudioFallbackReason = null;
  const helper = withAudio && canUsePcAudioHelper() ? await startPcAudioHelper() : null;
  const systemAudio = withAudio && !helper; // captura antiga do Chromium (todo o som do Windows)
  await window.native.selectSource(id, systemAudio);

  try {
    screenRaw = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: currentQuality.fps },
      // restrictOwnAudio: pede para excluir o som do próprio app (o Electron não repassa isso
      // ao áudio do sistema; por isso o auxiliar acima é o caminho principal no Windows)
      audio: systemAudio ? { restrictOwnAudio: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false
    });
  } catch (e) {
    stopPcAudioHelper();
    ui.alert('Não foi possível capturar a tela: ' + e.message);
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
  if (helper) screenAudioExcludesSelf = true;
  if (aTrack) {
    const st = aTrack.getSettings ? aTrack.getSettings() : {};
    screenAudioExcludesSelf = st.restrictOwnAudio === true;
    if (!screenAudioExcludesSelf) {
      if (pcAudioFallbackReason) logEvent(`auxiliar de áudio do PC indisponível: ${pcAudioFallbackReason}`);
      showToast('⚠️ Este PC não conseguiu separar o som da chamada do áudio do PC: quem está na sala ' +
                'pode ouvir a própria voz repetida. Se não precisar do som da tela, desmarque "Incluir áudio do PC".' +
                (pcAudioFallbackReason ? ` (Motivo: ${pcAudioFallbackReason}. Requer Windows 10 versão 2004 ou mais novo.)` : ''), 'warn', 14000);
    }
  }
  if (aTrack || helper) {
    // passa o áudio da tela por um ganho (volume ajustável)
    screenAudioNode = helper || audioCtx.createMediaStreamSource(new MediaStream([aTrack]));
    screenGain = audioCtx.createGain();
    screenGain.gain.value = ui.pref('shareVol') / 100;
    const dest = audioCtx.createMediaStreamDestination();
    screenAudioNode.connect(screenGain).connect(dest);
    tracks.push(dest.stream.getAudioTracks()[0]);
  }
  screenStream = new MediaStream(tracks);

  for (const p of peers.values()) if (p.conn && p.conn.open) callScreen(p.id);

  localPreview = new MediaStream([vTrack]);
  showScreen('__local__', localPreview, true);
  playSound('share-on');
  ui.shareChanged(true);
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
  stopPcAudioHelper();
  screenRaw = screenStream = screenAudioNode = screenGain = null;
  removeScreen('__local__');
  ui.shareChanged(false);
}

// =====================================================================
// TELAS VISÍVEIS: o núcleo guarda quais telas existem (screens) e liga o áudio de cada uma;
// a interface desenha.
// =====================================================================
function showScreen(id, stream, isLocal) {
  const fresh = screens.get(id) !== stream;
  screens.set(id, stream);
  if (!isLocal && fresh) attachScreenAudio(getPeer(id), stream);
  ui.screenShown(id, stream, isLocal);
  applyFocus();
  applyVolumes();
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

function removeScreen(id) {
  screens.delete(id);
  ui.screenRemoved(id);
  const p = peers.get(id);
  if (p && p.screenSrc) { try { p.screenSrc.disconnect(); } catch {} p.screenSrc = null; }
  applyFocus();
}

// =====================================================================
// TELA EM FOCO (#47): clicando numa tela, ela fica grande e as outras viram miniaturas.
// Para as miniaturas, pedimos a quem compartilha uma qualidade bem menor (THUMB), aliviando
// CPU, GPU e rede dos dois lados. Clicando de novo (ou em "↩️"), volta para a grade.
// =====================================================================
let focusId = null;
// O foco só vale com mais de uma tela visível
function focusActive() { return !!focusId && screens.size > 1; }
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
  if (focusId && !screens.has(focusId)) focusId = null;
  ui.paintFocus();
  broadcastViewMode();
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
  if (viewHidden && ui.pref('pauseHidden')) return 'off';
  if (p && isUnwatched(p)) return 'off'; // escolhi não assistir esta tela (#59)
  if (p && focusId && focusId !== p.id && focusActive()) return 'thumb';
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
// A interface avisa quando o app fica escondido (hidden = true) ou visível de novo
function onVisibilityChange(hidden) {
  clearTimeout(hideTimer);
  if (hidden) {
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
