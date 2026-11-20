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

// Auxiliar FALSO de áudio para os testes LOCAIS (#35): imita o telashare-audio.exe.
// Modos (variável FAKE_MODE): "ok" (padrão) envia um tom de 440 Hz em pedaços de tamanho ímpar;
// "error" responde como o Windows sem suporte a process loopback e termina.
const [pid, rate] = process.argv.slice(2).map(Number);
if (process.env.FAKE_MODE === 'error') {
  process.stderr.write('ERROR activate-result 0x80070005\n');
  process.exit(1);
}
process.stderr.write(`READY ${rate} 2 s16\n`);
let t = 0;
const timer = setInterval(() => {
  const frames = Math.round(rate * 0.02);
  const b = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++, t++) {
    const v = Math.round(Math.sin(2 * Math.PI * 440 * t / rate) * 12000);
    b.writeInt16LE(v, i * 4); b.writeInt16LE(v, i * 4 + 2);
  }
  // pedaços de tamanho ímpar, para testar o alinhamento de quadros
  process.stdout.write(b.subarray(0, 7)); process.stdout.write(b.subarray(7));
}, 20);
process.stdin.on('end', () => { clearInterval(timer); process.exit(0); });
process.stdin.resume();
void pid;
