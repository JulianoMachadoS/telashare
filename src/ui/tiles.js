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
/* INTERFACE: escolha da tela, telas (tiles), foco, "não assistir" e prévia */

// =====================================================================
// ESCOLHER A TELA OU JANELA PARA COMPARTILHAR
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

// =====================================================================
// TELAS
// =====================================================================
// Prévia da sua própria tela compartilhada: pode ser ocultada (economiza GPU)
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
        val.textContent = r.value + '%';
        setPeerVolume(p, 'screen', r.value / 100);
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
  }
  updateTileName(isLocal ? { id, name: $('nameInput').value.trim() } : getPeer(id));
  paintFocus();
  if (!isLocal) paintMuted(getPeer(id));
  $('empty').classList.add('hidden');
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

// Tela em foco (#47) e "não assistir" (#59): o núcleo guarda o estado, aqui só desenha
function paintFocus() {
  const grid = $('grid');
  const on = focusActive();
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
}

// Mostra na sua prévia se a qualidade foi reduzida para alguém
function paintSendQuality(reduced) {
  const t = tileEl('__local__');
  if (!t) return;
  const el = t.querySelector('.q');
  if (!el) return;
  el.textContent = reduced.length
    ? '⚠️ Qualidade reduzida para: ' + reduced.map(p => `${p.name} (${ADAPT_LEVELS[p.sendLevel].label})`).join(', ')
    : '';
}
