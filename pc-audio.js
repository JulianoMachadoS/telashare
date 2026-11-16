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
 * Áudio do PC sem o som do próprio TelaShare (#35).
 * Inicia o auxiliar nativo telashare-audio.exe (Windows 10 2004+), que captura o som de todos os
 * programas EXCETO o TelaShare, e repassa o PCM (16 bits, estéreo) para quem pediu.
 * Só roda enquanto alguém compartilha a tela com "Incluir áudio do PC".
 */
const { spawn } = require('child_process');
const fs = require('fs');

const READY_TIMEOUT_MS = 8000;

// start({ exe, pid, rate, onData, onExit }) → Promise<{ ok, rate } | { ok: false, error }>
function start({ exe, pid, rate, onData, onExit, args = [], env }) {
  return new Promise(resolve => {
    if (!exe || !fs.existsSync(exe)) { resolve({ ok: false, error: 'auxiliar não encontrado' }); return; }
    let child;
    try {
      child = spawn(exe, [...args, String(pid), String(rate)], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: env || process.env });
    } catch (e) {
      resolve({ ok: false, error: 'não foi possível iniciar: ' + e.message });
      return;
    }
    let settled = false, errText = '', lineBuf = '';
    const finish = r => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { finish({ ok: false, error: 'o auxiliar não respondeu' }); try { child.kill(); } catch {} }, READY_TIMEOUT_MS);

    // entrega só quadros inteiros (4 bytes = 2 canais x 16 bits); o resto espera o próximo pedaço
    let rest = Buffer.alloc(0);
    child.stdout.on('data', chunk => {
      const buf = rest.length ? Buffer.concat([rest, chunk]) : chunk;
      const usable = buf.length - (buf.length % 4);
      rest = Buffer.from(buf.subarray(usable));
      if (usable && onData) onData(buf.subarray(0, usable));
    });
    child.stderr.on('data', d => {
      lineBuf += d.toString();
      let i;
      while ((i = lineBuf.indexOf('\n')) >= 0) {
        const line = lineBuf.slice(0, i).trim();
        lineBuf = lineBuf.slice(i + 1);
        const m = line.match(/^READY (\d+) (\d+) s16$/);
        if (m) finish({ ok: true, rate: +m[1], channels: +m[2] });
        else if (/^ERROR /.test(line)) errText = line.slice(6);
      }
    });
    child.on('error', e => finish({ ok: false, error: e.message }));
    child.on('exit', code => {
      finish({ ok: false, error: errText || `o auxiliar terminou (código ${code})` });
      if (current === child) current = null;
      onExit && onExit({ code, error: errText || null });
    });
    current = child;
  });
}

let current = null;

function stop() {
  const c = current;
  current = null;
  if (!c) return;
  try { c.stdin.end(); } catch {}            // o auxiliar termina sozinho quando a entrada fecha
  setTimeout(() => { try { c.kill(); } catch {} }, 1000);
}

function running() { return !!current; }

module.exports = { start, stop, running };
