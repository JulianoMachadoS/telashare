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
 * Toca o PCM (16 bits, estéreo) que chega do auxiliar telashare-audio.exe (#35).
 * Buffer curto: começa a tocar com ~60 ms acumulados e descarta o excesso acima de ~250 ms,
 * para o atraso não crescer. Se faltar áudio (nada tocando no PC), sai silêncio e volta a
 * acumular os 60 ms.
 */
class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.frames = 0;          // quadros na fila (sem contar o pedaço em uso)
    this.cur = null;
    this.pos = 0;
    this.playing = false;
    this.target = Math.round(sampleRate * 0.06);
    this.max = Math.round(sampleRate * 0.25);
    this.port.onmessage = e => {
      const a = new Int16Array(e.data);
      if (!a.length) return;
      this.queue.push(a);
      this.frames += a.length / 2;
      while (this.frames > this.max && this.queue.length > 1) {
        const d = this.queue.shift();
        this.frames -= d.length / 2;
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    const n = L.length;
    if (!this.playing) {
      if (this.frames < this.target) { L.fill(0); R.fill(0); return true; }
      this.playing = true;
    }
    for (let i = 0; i < n; i++) {
      if (!this.cur || this.pos >= this.cur.length) {
        this.cur = this.queue.shift() || null;
        this.pos = 0;
        if (!this.cur) {
          for (; i < n; i++) { L[i] = 0; R[i] = 0; }
          this.playing = false;
          break;
        }
        this.frames -= this.cur.length / 2;
      }
      L[i] = this.cur[this.pos++] / 32768;
      R[i] = this.cur[this.pos++] / 32768;
    }
    return true;
  }
}

registerProcessor('pcm-player', PcmPlayer);
