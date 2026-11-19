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
/* NÚCLEO: diagnóstico, qualidade da conexão com cada pessoa e comparação de versões */

// =====================================================================
// DIAGNÓSTICO (#34): "🩺 Copiar diagnóstico" gera um texto com o estado de cada ligação e os
// últimos eventos, para relatar problemas de testes reais (ex.: "B não vê a tela de C").
// Não inclui endereços IP: só o tipo de cada conexão (host / srflx / relay).
// =====================================================================
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
  L.push(`Sala: ${roomCode || '-'} · Eu: ${ui.pref('name') || '-'} (${peer ? shortId(peer.id) : 'fora da sala'})${isHost ? ' · anfitrião' : ''}`);
  L.push(`Servidor de sinalização: ${!peer ? '-' : peer.disconnected ? 'desconectado' : peer.open ? 'conectado' : 'conectando'} · TURN: ${String(ui.pref('turnUrl') || '').trim() ? 'configurado' : 'não'}`);
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
    if (p.sharing || p.screenIn) L.push(`    ← tela: [${await pcInfo(pcOf(p.screenIn))}] · ${screens.has(p.id) ? 'aparecendo' : 'NÃO aparece'}${isUnwatched(p) ? ' · não estou assistindo (vídeo pausado)' : ''}${p.screenReqs ? ` · pedidos ${p.screenReqs}` : ''}`);
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
  showToast('🩺 Diagnóstico copiado. Cole na conversa com quem está ajudando (não tem endereços IP).', 'ok');
}

// =====================================================================
// QUALIDADE DA CONEXÃO COM CADA PESSOA (bolinha e texto na lista)
// =====================================================================
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
    ui.peerNet(p);
  }
  updateBadge();
  setTimeout(netLoop, 2000);
}

// ---------- comparação de versões (aviso de nova versão) ----------
function parseVer(v) { return String(v || '').replace(/^v/i, '').split(/[.-]/).slice(0, 3).map(n => parseInt(n, 10) || 0); }
function isNewer(latest, current) {
  const a = parseVer(latest), b = parseVer(current);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}

// =====================================================================
// INICIALIZAÇÃO E ENCERRAMENTO DO NÚCLEO (chamados pela interface)
// =====================================================================
async function initCore() {
  outVolume = ui.pref('outVol') / 100;
  initAudio();
  await openMic(store.get('mic', ''));
  await refreshDevices();
  await setOutputDevice(ui.pref('out'));
  navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
  applyVolumes();
  setInterval(voiceLoop, VOICE_INTERVAL_MS);
  netLoop();
  heartbeatLoop();
  meshLoop();
}

// Janela fechando: para de compartilhar e avisa os outros
function shutdown() {
  stopShare();
  sayGoodbye();
  if (peer) peer.destroy();
}
