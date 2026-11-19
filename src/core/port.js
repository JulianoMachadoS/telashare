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
/*
 * CONTRATO ENTRE O NÚCLEO E A INTERFACE (#64)
 * ===========================================
 * O núcleo (src/core/) cuida da sala, da malha P2P, da voz, da tela e do diagnóstico, e NUNCA
 * mexe na tela. Quando algo muda, ele avisa a interface por este objeto `ui`; quando precisa de
 * uma preferência (nome, volumes, opções), pergunta por `ui.pref(chave)`.
 *
 * A interface (src/ui/) preenche TODAS as funções abaixo. Um front novo (ex.: React) só precisa
 * implementar este contrato e chamar as funções públicas do núcleo (hostRoom, joinRoom,
 * leaveRoom, setMuted, startShare, stopShare, toggleFocus, toggleWatch...). O estado do núcleo
 * (peers, peer, roomCode, isHost, micMuted, screenStream, screens, focusId...) pode ser lido.
 */

// Preferências que o núcleo lê com ui.pref(chave)
const PREF_KEYS = {
  name: 'seu nome (texto, sem espaços nas pontas)',
  turnUrl: 'endereço(s) do servidor TURN (texto)',
  turnUser: 'usuário do TURN (texto)',
  turnPass: 'senha do TURN (texto)',
  mic: 'ID do microfone escolhido',
  out: 'ID da saída de áudio escolhida',
  micVol: 'volume do microfone em % (0 a 400)',
  outVol: 'volume geral da saída em % (0 a 400)',
  shareVol: 'volume do áudio da tela enviado em % (0 a 400)',
  echo: 'cancelamento de eco (true/false)',
  noise: 'supressão de ruído (true/false)',
  agc: 'ganho automático (true/false)',
  duck: 'abaixar o som das telas quando alguém fala (true/false)',
  sounds: 'sons de aviso (true/false)',
  soundVol: 'volume dos sons de aviso em % (0 a 100)',
  shareAudio: 'incluir o áudio do PC ao compartilhar (true/false)',
  quality: "qualidade da tela: '720_30', '1080_30' ou '1080_60'",
  pauseHidden: 'pausar o vídeo das telas com o app escondido (true/false)'
};

const UI_CONTRACT = {
  pref: 'pref(chave) → valor atual de uma preferência (ver PREF_KEYS)',
  alert: 'alert(texto): mensagem que precisa de confirmação',
  toast: 'toast(texto, tipo, ms): aviso passageiro (tipo: info, ok, warn, error)',
  status: 'status(texto): linha de status da sala',
  badge: "badge(classe, texto): selo de conexão (classe: good, warn, bad, wait, off)",
  lockForm: 'lockForm(travar): trava/destrava o formulário de entrada',
  roomEntered: 'roomEntered(sala): entrou numa sala',
  roomLeft: 'roomLeft(): saiu da sala',
  renderPeers: 'renderPeers(): a lista de participantes mudou (ler peers, unreachable)',
  peerMuted: 'peerMuted(p): a pessoa mutou/desmutou (p.muted)',
  peerSpeaking: 'peerSpeaking(p): a pessoa começou/parou de falar (p.speaking)',
  peerNet: 'peerNet(p): qualidade da conexão com a pessoa mudou (p.net = { cls, text })',
  tileNames: 'tileNames(): nomes exibidos mudaram (displayName)',
  screenShown: 'screenShown(id, stream, local): uma tela apareceu ou trocou de stream',
  screenRemoved: 'screenRemoved(id): uma tela sumiu',
  paintFocus: 'paintFocus(): tela em foco ou "não assistir" mudou (focusId, focusActive(), isUnwatched(p))',
  sendQuality: 'sendQuality(lista): pessoas para quem a sua tela está com qualidade reduzida',
  shareChanged: 'shareChanged(compartilhando): começou/parou de compartilhar',
  muteChanged: 'muteChanged(mudo): seu microfone mutou/desmutou',
  monitorChanged: 'monitorChanged(ligado): "ouvir meu microfone" ligou/desligou',
  recordState: "recordState(estado, segundos): gravação de teste ('recording', 'playing', 'idle')",
  micWarn: 'micWarn(mostrar): aviso de microfone indisponível',
  devices: 'devices(entradas, saídas, micSalvo, saídaSalva): lista de dispositivos de áudio',
  selectMic: 'selectMic(id) → nome do microfone que ficou selecionado',
  pickSource: 'pickSource() → Promise com o ID da tela/janela escolhida (ou null)'
};

const ui = {};

// Funções do contrato que a interface ainda não preencheu (deve ser uma lista vazia)
function missingUiHooks() {
  return Object.keys(UI_CONTRACT).filter(k => typeof ui[k] !== 'function');
}
