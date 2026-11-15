# TelaShare

Compartilhamento de tela **com áudio** entre 2 ou mais computadores Windows, com voz e controle de volume.
É simples, sem chat e sem cadastro: todo mundo digita o mesmo código de sala e pronto.

## ⬇️ Download

Baixe o **`TelaShare.exe`** na página de [**Releases**](../../releases/latest).

É portátil, não precisa instalar: só abrir.

> **Aviso do Windows (SmartScreen):** o executável não tem assinatura digital, então o Windows pode
> mostrar "O Windows protegeu o computador". Clique em **Mais informações → Executar assim mesmo**.

## 🚀 Como usar

1. Cada pessoa abre o `TelaShare.exe`.
2. Todos digitam **seu nome** e o **mesmo código de sala** (ex.: `nossasala123`).
3. **Uma** pessoa clica em **Criar sala**, e as outras clicam em **Entrar**.
4. Para mostrar sua tela, clique em **🖥️ Compartilhar tela** e escolha a tela inteira ou uma janela.
   - Com **"Incluir áudio do PC"** marcado, o som do computador vai junto.
5. As telas dos outros aparecem na área principal. Dê **duplo clique** para ver em tela cheia.

Várias pessoas podem compartilhar a tela ao mesmo tempo.

## 🎚️ Controles

| Onde | O que faz |
|---|---|
| **Microfone (entrada)** | Escolher o microfone |
| **Volume do microfone** | 0 a 200% (com medidor de nível) |
| **Supressão de ruído / eco** | Liga e desliga o filtro do microfone |
| **🎤 Microfone ligado/mudo** | Botão de mudo |
| **Saída** | Escolher fone ou caixa de som |
| **Volume geral de saída** | Volume de tudo o que você ouve |
| **Participantes → Volume da voz** | Volume da voz de cada pessoa |
| **🔊 na barra de cada tela** | Volume do áudio daquela tela |
| **Volume do áudio da tela enviado** | Volume do som do seu PC que os outros ouvem |
| **Qualidade** | 720p 30fps · 1080p 30fps · 1080p 60fps |

O app guarda suas configurações para a próxima vez.

## ⚙️ Como funciona a conexão

Não existe servidor próprio nem túnel. Funciona em duas etapas:

1. **Encontrar a sala (sinalização):** o app usa o servidor público e gratuito do
   [PeerJS](https://peerjs.com) (`0.peerjs.com`). Quem clica em **Criar sala** se registra lá com o
   código da sala, e quem clica em **Entrar** pede ao servidor para encontrar esse código. Só passam
   por ali mensagens pequenas de "aperto de mão".
2. **Conexão direta (P2P / WebRTC):** depois disso, tela, áudio e voz vão **direto de um PC para o
   outro**, criptografados. Servidores STUN (Google/Cloudflare) só ajudam cada PC a descobrir o
   próprio IP público para atravessar o roteador.

Se a etapa 2 falhar por causa de firewall ou NAT restrito, o app avisa e sugere as soluções abaixo.

## ⚠️ Limitações e dicas

- **Eco no áudio da tela:** "Incluir áudio do PC" captura *todo* o som do Windows, inclusive a voz
  dos colegas saindo no seu fone. Por isso eles podem se ouvir com atraso enquanto você compartilha.
  Se incomodar, abaixe o **Volume do áudio da tela enviado** ou desmarque o áudio do PC.
- **"Sala não encontrada"**: o código está diferente nos dois PCs, ou quem criou a sala fechou o app.
  O código ignora maiúsculas, espaços e acentos.
- **"A sala existe, mas não foi possível conectar diretamente"**: veja o item abaixo.
- **Não conecta?** Algumas redes muito restritas (redes corporativas, internet 4G/5G nos dois lados)
  bloqueiam a conexão direta. Nesse caso, instalem uma VPN gratuita como
  [Radmin VPN](https://www.radmin-vpn.com), [Tailscale](https://tailscale.com) ou
  [ZeroTier](https://www.zerotier.com) e usem o TelaShare normalmente com ela ligada.
- **Servidor TURN (avançado):** um TURN retransmite o tráfego quando a conexão direta é impossível.
  Dá para criar um gratuito em [Metered](https://www.metered.ca/stun-turn) ou
  [Cloudflare Calls](https://developers.cloudflare.com/realtime/turn/) e colar a URL, o usuário e a
  senha em **Conexão → Avançado**. Basta configurar em um dos PCs.
- **"Já existe uma sala com esse código":** alguém já criou a sala. Clique em **Entrar**.
- **Muita gente compartilhando:** cada pessoa envia o vídeo para todas as outras. Com 4 ou mais
  pessoas compartilhando ao mesmo tempo, usem **720p** para não pesar o upload.
- Se quem criou a sala sair, quem já está conectado continua conectado, mas ninguém novo consegue
  entrar até alguém criar a sala de novo.

## 🛠️ Compilar a partir do código

Requisitos: [Node.js](https://nodejs.org) 20 ou mais recente.

```bash
npm install
npm start          # roda em modo desenvolvimento
npm run dist       # gera dist/TelaShare.exe (Windows x64, portátil)
```

Estrutura:

```
main.js       processo principal (janela, captura de tela/áudio)
preload.js    ponte segura entre o Electron e a página
index.html    interface
renderer.js   lógica de conexão, áudio, volumes e compartilhamento
style.css     visual
```

## 📄 Licença

MIT
