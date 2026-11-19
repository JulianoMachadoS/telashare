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
/* NÚCLEO: estado, preferências salvas, identidade, avisos e registro de eventos */

const PREFIX = 'telashare-v1-';
// Servidores STUN descobrem o IP público. Um TURN (opcional, configurado em "Avançado")
// retransmite o tráfego quando a conexão direta é bloqueada por firewall/NAT.
function peerOpts() {
  const iceServers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ];
  const turnUrls = (ui.pref('turnUrl') || '').split(/[\s,]+/).filter(Boolean);
  if (turnUrls.length) {
    iceServers.push({
      urls: turnUrls,
      username: String(ui.pref('turnUser') || '').trim(),
      credential: ui.pref('turnPass') || ''
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

// Telas visíveis agora: id ('__local__' = a sua) -> stream
const screens = new Map();

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
  const myName = String(ui.pref('name') || '').trim().toLowerCase();
  const dup = key === myName ||
    [...peers.values()].some(o => o !== p && o.conn && o.name.trim().toLowerCase() === key);
  return dup ? `${p.name} #${peerTag(p)}` : p.name;
}

// Volumes salvos por instalação (deviceId); versões antigas sem deviceId usam o nome
function volKey(kind, p) { return p.deviceId ? `${kind}_dev_${p.deviceId}` : `${kind}_${p.name}`; }

// =====================================================================
// AVISOS (toasts): o núcleo registra e a interface mostra
// =====================================================================
const toastLog = [];
function showToast(msg, kind = 'info', ms = 5000) {
  toastLog.push(msg);
  ui.toast(msg, kind, ms);
}

// =====================================================================
// REGISTRO DE EVENTOS para o diagnóstico (#34)
// =====================================================================
const diagLog = [];
function logEvent(msg) {
  diagLog.push(`${new Date().toTimeString().slice(0, 8)} ${msg}`);
  if (diagLog.length > 80) diagLog.shift();
}
const shortId = id => (!id ? '-' : id.startsWith(PREFIX) ? 'ID da sala' : id.slice(0, 8));
