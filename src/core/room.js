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
/* NÚCLEO: sala, entrada, reconexão, malha P2P, mensagens de dados e heartbeat */

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

// f = { name, room } já conferidos pela interface (sala passada por sanitizeRoom)
function beginEntry(f) {
  resumeAudio();
  store.set('name', f.name);
  store.set('room', f.room);
}

async function hostRoom(f) {
  if (!f) return;
  beginEntry(f);
  ui.lockForm(true);
  setStatus('Criando sala...');
  try {
    peer = await makePeer(PREFIX + f.room);
  } catch (err) {
    ui.lockForm(false);
    if (err.type === 'unavailable-id') {
      // A sala continua aberta (outra pessoa assumiu quando você saiu, ou alguém já criou):
      // entra nela em vez de dar erro.
      showToast(`A sala "${f.room}" já está aberta. Entrando nela...`, 'info');
      joinRoom(f);
    } else ui.alert('Erro ao criar sala: ' + (err.message || err.type));
    return;
  }
  clearJoin();
  isHost = true;
  enterRoom(f.room);
}

async function joinRoom(f) {
  if (!f) return;
  beginEntry(f);
  ui.lockForm(true);
  setStatus('Conectando...');
  try {
    peer = await makePeer();
  } catch (err) {
    ui.lockForm(false);
    ui.alert('Erro ao conectar no servidor: ' + (err.message || err.type));
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
      ui.alert('Sala não encontrada.\n\nConfira se o código está igual nos dois PCs e se quem criou ' +
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
      ui.alert('A sala existe, mas não foi possível conectar diretamente ao outro computador ' +
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

  ui.roomEntered(room);
  updateStatus();
}

// ---------- convite ----------
function inviteLink(room) { return `telashare://sala/${room}`; }

async function copyInvite() {
  const text = `Entra na minha sala do TelaShare!\n` +
               `Link: ${inviteLink(roomCode)}\n` +
               `(ou abra o TelaShare, use o código "${roomCode}" e clique em Entrar)`;
  await window.native.copyText(text);
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
  ui.roomLeft();
  renderPeers();
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
    ui.alert(`Não foi possível reconectar à sala "${roomCode}" depois de ${rejoinCfg.max} tentativas.\n\n` +
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

function setStatus(t) { ui.status(t); updateBadge(); }
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

// A lista de participantes mudou: recalcula as cores e avisa a interface
function renderPeers() {
  assignColors();
  ui.renderPeers();
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
      removeScreen(p.id);
    }
    p.conn = conn;
    p.lastSeen = Date.now();
    everConnected = true;
    if (joinTarget && conn.peer === joinTarget) clearJoin(); // já estamos ligados à sala
    conn.send({ type: 'hello', name: ui.pref('name'), muted: micMuted, deviceId: DEVICE_ID });
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
        ui.peerMuted(p);
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
        ui.tileNames();
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
        if (screens.has(p.id)) playSound('share-off');
        removeScreen(p.id);
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
  removeScreen(id);
  peers.delete(id);
  if (reason === 'bye' || reason === 'migrate') { roster.delete(id); pairRetry.delete(id); relinking.delete(id); }
  else if (wasConnected && (reason === 'closed' || reason === 'timeout') && !leaving && connectedCount() > 0) {
    // Caiu só a ligação com esta pessoa: a malha tenta religar o par (meshLoop)
    pairRetry.delete(id);
    relinking.set(id, p.name);
    showToast(`📶 Conexão com ${displayName(p)} caiu. Religando...`, 'warn');
  }
  renderPeers();
  ui.tileNames();
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

function sayGoodbye() {
  for (const p of peers.values()) {
    if (p.conn && p.conn.open) { try { p.conn.send({ type: 'bye' }); } catch {} }
  }
}

// =====================================================================
// INDICADOR DE CONEXÃO: o núcleo decide o estado e a interface pinta o selo
// =====================================================================
function updateBadge() {
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
  ui.badge(cls, t);
}
