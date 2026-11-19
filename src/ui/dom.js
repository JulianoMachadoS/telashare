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
/* INTERFACE: avisos, formulário de entrada, lista de participantes e botões da barra lateral */

const $ = id => document.getElementById(id);

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
function renderToast(msg, kind = 'info', ms = 5000) {
  const box = $('toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, ms);
}

// =====================================================================
// FORMULÁRIO DE ENTRADA
// =====================================================================
function readForm() {
  const name = $('nameInput').value.trim();
  const room = sanitizeRoom($('roomInput').value);
  if (!name) { alert('Digite seu nome.'); return null; }
  if (!room) { alert('Digite um código de sala (letras, números, - ou _).'); return null; }
  return { name, room };
}

function lockForm(lock) {
  ['hostBtn', 'joinBtn', 'nameInput', 'roomInput', 'rejoinBtn'].forEach(id => ($(id).disabled = lock));
}

// Convite recebido (link telashare://sala/<código>)
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
  joinRoom(readForm());
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
  hostRoom(readForm());
}

// Entrou / saiu da sala
function paintRoomEntered(room) {
  $('connectBox').classList.add('hidden');
  $('roomBox').classList.remove('hidden');
  $('roomName').textContent = room;
  $('shareBtn').disabled = false;
}
function paintRoomLeft() {
  $('connectBox').classList.remove('hidden');
  $('roomBox').classList.add('hidden');
  $('shareBtn').disabled = true;
  lockForm(false);
  paintRejoin();
}

// Selo de conexão
function paintBadge(cls, t) {
  $('connBadge').className = 'badge ' + cls;
  $('connText').textContent = t;
}

// =====================================================================
// LISTA DE PARTICIPANTES
// =====================================================================
function peerItem(p) { return document.querySelector(`#peerList li[data-id="${CSS.escape(p.id)}"]`); }

function paintPeerList() {
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
      val.textContent = r.value + '%';
      setPeerVolume(p, 'voice', r.value / 100);
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

function paintMuted(p) {
  const li = peerItem(p);
  if (li) li.classList.toggle('muted', !!p.muted);
  const t = tileEl(p.id);
  if (t) t.classList.toggle('muted', !!p.muted);
}

function paintSpeaking(p) {
  const li = peerItem(p);
  if (li) li.classList.toggle('speaking', !!p.speaking);
}

function paintNet(p) {
  const li = peerItem(p);
  if (!li) return;
  const dot = li.querySelector('.dot');
  const net = li.querySelector('.net');
  const n = p.net || { cls: 'wait', text: 'Conectando...' };
  dot.className = 'dot ' + n.cls;
  net.textContent = n.text;
  net.className = 'net ' + n.cls;
}

// =====================================================================
// ÁUDIO: dispositivos, botões e medidor do microfone
// =====================================================================
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

function selectMicOption(id) {
  $('micSelect').value = id;
  return ($('micSelect').selectedOptions[0] || {}).textContent;
}

function paintMuteBtn(m) {
  const b = $('muteBtn');
  b.textContent = m ? '🔇 Microfone mudo' : '🎤 Microfone ligado';
  b.classList.toggle('muted', m);
}

function paintMonitorBtn(on) {
  const b = $('monitorBtn');
  b.textContent = on ? '⏹️ Parar de me ouvir' : '🎧 Ouvir meu microfone';
  b.classList.toggle('active', on);
}

function paintRecBtn(state, secs) {
  const b = $('recBtn');
  if (state === 'recording') {
    b.classList.add('active');
    b.textContent = `🔴 Gravando... fale algo (${secs})`;
  } else if (state === 'playing') {
    b.textContent = '🔊 Reproduzindo gravação...';
  } else {
    b.textContent = '⏺️ Gravar teste (5s) e ouvir';
    b.classList.remove('active');
  }
}

function paintShareBtn(sharing) {
  const b = $('shareBtn');
  b.textContent = sharing ? '⏹️ Parar compartilhamento' : '🖥️ Compartilhar tela';
  b.classList.toggle('sharing', sharing);
  b.classList.toggle('primary', !sharing);
}

// Medidor do microfone: só desenho, então pode parar quando a janela não está visível
function meterLoop() {
  const { rms, peak } = micLevels();
  const level = Math.min(1, rms * 5);
  const m = $('micMeter');
  m.style.width = (level * 100).toFixed(0) + '%';
  m.classList.toggle('hot', peak > 0.95);
  m.classList.toggle('low', !micMuted && level < 0.08);
  requestAnimationFrame(meterLoop);
}

// Botão que mostra uma confirmação por 2 s e volta ao texto original
function flashButton(id, text, back) {
  const b = $(id);
  b.textContent = text;
  setTimeout(() => (b.textContent = back), 2000);
}
