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
/* NÚCLEO: áudio (sons de aviso, microfone, dispositivos, volumes, quem está falando) */

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
  if (!notes || !audioCtx || !ui.pref('sounds')) return;
  soundLog.push(name);
  const vol = (ui.pref('soundVol') / 100) * 0.25;
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
  micGain.gain.value = ui.pref('micVol') / 100;
}

// O navegador só libera o áudio depois de um clique: chamada a cada clique na janela
function resumeAudio() {
  if (audioCtx && audioCtx.state !== 'running') audioCtx.resume();
}

async function openMic(deviceId) {
  if (micSource) { micSource.disconnect(); micSource = null; }
  if (micRaw) { micRaw.getTracks().forEach(t => t.stop()); micRaw = null; }
  try {
    micRaw = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: !!ui.pref('echo'),
        noiseSuppression: !!ui.pref('noise'),
        autoGainControl: !!ui.pref('agc')
      }
    });
    micSource = audioCtx.createMediaStreamSource(micRaw);
    micSource.connect(micGain);
    const track = micRaw.getAudioTracks()[0];
    track.onended = onMicLost; // fone desplugado, USB removido etc.
    ui.micWarn(false);
    return true;
  } catch (e) {
    console.warn('Microfone indisponível', e);
    micRaw = null;
    ui.micWarn(true);
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
      const label = ui.selectMic(currentMicId() || ui.pref('mic'));
      showToast('🎤 Usando agora: ' + label, 'ok');
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
  const inputs = deviceLists.inputs.map(d => d.deviceId);
  const preferred = store.get('mic', '');
  const cur = currentMicId();
  if (cur === null && inputs.length) {
    // estava sem microfone e apareceu um
    if (await openMic(inputs.includes(preferred) ? preferred : '')) {
      const label = ui.selectMic(currentMicId() || ui.pref('mic'));
      showToast('🎤 Microfone conectado: ' + label, 'ok');
    }
  } else if (preferred && cur !== null && cur !== preferred && inputs.includes(preferred)) {
    // o microfone preferido voltou: volta para ele
    if (await openMic(preferred)) {
      const label = ui.selectMic(preferred);
      showToast('🎤 Voltando para: ' + label, 'ok');
    }
  }
  // saída escolhida sumiu: volta para a padrão
  const outs = deviceLists.outputs.map(d => d.deviceId);
  if (outDeviceId && outDeviceId !== 'default' && !outs.includes(outDeviceId)) {
    await setOutputDevice('default');
    showToast('🔊 Dispositivo de saída desconectado. Usando a saída padrão.', 'warn');
  }
}

// ---------- testes de áudio ----------
function toggleMonitor() {
  monitoring = !monitoring;
  monitorGain.gain.setTargetAtTime(monitoring ? 1 : 0, audioCtx.currentTime, 0.02);
  ui.monitorChanged(monitoring);
}

async function recordTest() {
  if (recording) return;
  if (monitoring) toggleMonitor();
  if (audioCtx.state !== 'running') await audioCtx.resume();
  recording = true;
  const chunks = [];
  const rec = new MediaRecorder(micDest.stream);
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.onstop = async () => {
    try {
      const buf = await audioCtx.decodeAudioData(await new Blob(chunks).arrayBuffer());
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(outMaster);
      ui.recordState('playing');
      src.onended = () => { recording = false; ui.recordState('idle'); };
      src.start();
    } catch (e) {
      recording = false;
      ui.recordState('idle');
      ui.alert('Não foi possível reproduzir a gravação: ' + e.message);
    }
  };
  rec.start();
  for (let i = 5; i > 0; i--) {
    ui.recordState('recording', i);
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
  ui.muteChanged(m);
}

// Dispositivos de áudio encontrados na última leitura
let deviceLists = { inputs: [], outputs: [] };
async function refreshDevices() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  deviceLists = {
    inputs: devs.filter(d => d.kind === 'audioinput'),
    outputs: devs.filter(d => d.kind === 'audiooutput')
  };
  ui.devices(deviceLists.inputs, deviceLists.outputs, store.get('mic', ''), store.get('out', ''));
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
// Nível do seu microfone agora (para o medidor da interface)
function micLevels() { return levels(micAnalyser); }

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
      ui.peerSpeaking(p);
    }
  }
  const target = ui.pref('duck') && now - lastVoiceAt < DUCK_HOLD_MS ? DUCK_LEVEL : 1;
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

// Volumes ajustados na interface (v: 1 = 100%)
function setMicVolume(v) { setGain(micGain, v); }
function setOutVolume(v) { outVolume = v; applyVolumes(); }
function setShareVolume(v) { setGain(screenGain, v); }
// kind: 'voice' (voz da pessoa) ou 'screen' (áudio da tela dela); salvo por instalação
function setPeerVolume(p, kind, v) {
  if (kind === 'screen') { p.screenVol = v; store.set(volKey('psvol', p), p.screenVol); }
  else { p.vol = v; store.set(volKey('pvol', p), p.vol); }
  applyVolumes();
}

async function setOutputDevice(id) {
  outDeviceId = id;
  if (!audioCtx.setSinkId) return;
  try { await audioCtx.setSinkId(id === 'default' ? '' : id); }
  catch (e) { console.warn('setSinkId', e); }
}
