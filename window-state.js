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

/*
 * Lembra o tamanho, a posição e se a janela estava maximizada (#49).
 * Salvo em <pasta de dados do app>/window-state.json. Se o monitor onde a janela estava não
 * existir mais, ela abre centralizada no monitor principal (em vez de ficar fora da tela).
 */
const fs = require('fs');
const path = require('path');

const DEFAULTS = { width: 1280, height: 800 };
const MIN = { width: 900, height: 600 };

function load(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return s && typeof s === 'object' ? s : null;
  } catch {
    return null;
  }
}

const num = v => typeof v === 'number' && Number.isFinite(v);

// Ajusta o estado salvo aos monitores atuais. Retorna { width, height, x?, y?, maximized }.
// Sem x/y, o Electron centraliza a janela no monitor principal.
function fit(state, displays, min = MIN) {
  if (!state || !num(state.width) || !num(state.height)) return { ...DEFAULTS, maximized: false };
  const areas = (displays || []).map(d => d.workArea).filter(Boolean);
  const maxW = Math.max(min.width, ...areas.map(a => a.width));
  const maxH = Math.max(min.height, ...areas.map(a => a.height));
  const width = Math.min(maxW, Math.max(min.width, Math.round(state.width)));
  const height = Math.min(maxH, Math.max(min.height, Math.round(state.height)));
  const out = { width, height, maximized: !!state.maximized };
  if (num(state.x) && num(state.y)) {
    const x = Math.round(state.x), y = Math.round(state.y);
    // a barra de título (pelo menos 100 px de largura) precisa ficar dentro de algum monitor
    const visible = areas.some(a =>
      x + width - 100 > a.x && x + 100 < a.x + a.width &&
      y >= a.y - 10 && y + 40 < a.y + a.height);
    if (visible) { out.x = x; out.y = y; }
  }
  return out;
}

// Salva o estado sempre que a janela muda (com uma pequena espera) e ao fechar.
function track(win, file) {
  let timer = null;
  const save = () => {
    if (win.isDestroyed()) return;
    const b = win.getNormalBounds(); // tamanho "normal", mesmo se estiver maximizada/minimizada
    const st = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(st));
    } catch (e) {
      console.warn('Não foi possível salvar o estado da janela', e);
    }
  };
  const later = () => { clearTimeout(timer); timer = setTimeout(save, 500); };
  ['resize', 'move', 'maximize', 'unmaximize'].forEach(ev => win.on(ev, later));
  win.on('close', () => { clearTimeout(timer); save(); });
  return save;
}

module.exports = { load, fit, track, DEFAULTS, MIN };
