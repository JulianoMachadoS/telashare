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

### Entrada (microfone)
| Controle | O que faz |
|---|---|
| **Microfone** | Escolher o microfone |
| **Ganho do microfone** | 0 a **400%**. Aumenta o quanto o seu microfone capta |
| **Medidor** | Verde = bom · verde-escuro = baixo demais · vermelho = alto demais |
| **Supressão de ruído** | Remove ruído de fundo (ventilador, teclado) |
| **Cancelamento de eco** | Evita que o som da sua caixa volte pelo microfone |
| **Ganho automático** | Nivela o volume da sua voz automaticamente |
| **🎤 Microfone ligado/mudo** | Botão de mudo |
| **🎧 Ouvir meu microfone** | Você se ouve ao vivo, exatamente como os outros te ouvem (use fone) |
| **⏺️ Gravar teste (5s) e ouvir** | Grava 5 segundos da sua voz e reproduz em seguida |

### Saída (fone / caixa)
| Controle | O que faz |
|---|---|
| **Dispositivo de saída** | Escolher fone ou caixa de som |
| **Volume geral** | 0 a **300%**. Volume de tudo o que você ouve |
| **🔊 Testar som** | Toca um som curto para conferir a saída |
| **Participantes → Volume da voz** | 0 a **400%** para cada pessoa |
| **🔊 na barra de cada tela** | 0 a **400%** para o áudio de cada tela recebida |

Um limitador automático evita distorção quando o volume passa de 100%. O app lembra o volume de
cada pessoa pelo nome dela.

### Compartilhar tela
| Controle | O que faz |
|---|---|
| **Incluir áudio do PC** | Envia o som do computador junto com a tela |
| **Qualidade** | 720p 30fps · 1080p 30fps · 1080p 60fps |
| **Volume do áudio da tela enviado** | Volume do som do seu PC que os outros ouvem |

O app guarda suas configurações para a próxima vez.

## 📶 Indicador de conexão

No topo, ao lado do nome do app:

| Selo | Significado |
|---|---|
| ⚪ **Desconectado** | Você não está em nenhuma sala |
| 🟡 **Conectando à sala...** | Procurando a sala / estabelecendo conexão |
| 🟢 **Online · aguardando pessoas** | Sala criada, ninguém entrou ainda |
| 🟢 **Conectado · N pessoas** | Tudo certo |
| 🟡 **Conectado** (amarelo) | Alguém está com conexão ruim |
| 🔴 **Servidor caiu · reconectando** | Perdeu o servidor de sinalização. Quem já está conectado continua funcionando |

Em **Participantes**, cada pessoa mostra uma bolinha de qualidade e os detalhes da conexão.
Exemplo: `35 ms · direta · 2% perda`.
- **ms**: tempo de resposta (ping). Até 150 ms é ótimo.
- **direta / rede local/VPN / via TURN**: por onde a conexão está passando.
- **% perda**: pacotes perdidos. Acima de 3% o áudio pode picotar.

Se alguém fechar o app ou perder a internet, essa pessoa e a tela dela somem em até ~8 segundos.

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

## 🌐 Não conecta? Crie um túnel (VPN)

**Não precisa estar na mesma rede.** Cada um pode estar na sua casa, com a sua internet. O túnel cria
uma **rede virtual** por cima da internet: para o computador, é como se todos estivessem ligados no
mesmo roteador. Não precisa abrir portas no roteador nem ter servidor.

Recomendado: **Radmin VPN**, que é gratuito, só para Windows e o mais simples de usar.

### Passo a passo (Radmin VPN)

**Quem cria a rede (uma vez só):**
1. Baixe e instale: https://www.radmin-vpn.com
2. Abra e clique em **"Criar rede"**.
3. Escolha um **nome de rede** (ex.: `telashare-amigos`) e uma **senha**, e clique em **Criar**.
4. Mande o nome e a senha para os amigos.

**Cada amigo (uma vez só):**
1. Instala o Radmin VPN.
2. Clica em **"Entrar em uma rede existente"**.
3. Digita o nome e a senha recebidos.

Pronto: todos aparecem na lista do Radmin. **Bolinha verde** significa conectado. Para testar, clique
com o botão direito num amigo → **Ping**.

**No dia a dia:**
1. Todos abrem o Radmin VPN e conferem se está **ligado** (botão de energia azul).
2. Abrem o TelaShare normalmente: um cria a sala e os outros entram com o código.

O TelaShare percebe a rede do Radmin sozinho e usa ela para a conexão direta. Não precisa configurar
nada no app.

### Alternativas

| Opção | Quando usar |
|---|---|
| **[Tailscale](https://tailscale.com)** | A mais confiável. Se a conexão direta for impossível, ele retransmite pelos servidores dele, então **sempre conecta**. Cada um entra com uma conta Google/Microsoft, e quem criou convida os outros pelo painel. |
| **[ZeroTier](https://www.zerotier.com)** | Parecido com o Radmin: crie uma rede e os amigos entram com o ID dela. Funciona em Windows, Mac e celular. |

### Dicas

- Na primeira vez, o **Firewall do Windows** pode perguntar se o TelaShare ou o Radmin podem acessar
  a rede. Marque **Redes privadas e públicas** e clique em **Permitir**.
- Usem **o mesmo túnel todos**. Se um estiver no Radmin e outro no Tailscale, eles não se enxergam.
- Com o túnel, o mais comum é a qualidade **melhorar**, porque a conexão fica mais estável.

## ⚠️ Limitações e dicas

- **Eco no áudio da tela:** "Incluir áudio do PC" captura *todo* o som do Windows, inclusive a voz
  dos colegas saindo no seu fone. Por isso eles podem se ouvir com atraso enquanto você compartilha.
  Se incomodar, abaixe o **Volume do áudio da tela enviado** ou desmarque o áudio do PC.
- **"Sala não encontrada"**: o código está diferente nos dois PCs, ou quem criou a sala fechou o app.
  O código ignora maiúsculas, espaços e acentos.
- **"A sala existe, mas não foi possível conectar diretamente"**: veja o item abaixo.
- **Não conecta?** Algumas redes (corporativas, internet 4G/5G) bloqueiam a conexão direta.
  Criem um túnel: veja [**Não conecta? Crie um túnel (VPN)**](#-não-conecta-crie-um-túnel-vpn).
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
