# TelaShare

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

Compartilhamento de tela **com áudio** entre 2 ou mais computadores Windows, com voz e controle de volume.
É simples, sem chat e sem cadastro: todo mundo digita o mesmo código de sala e pronto.

## ⬇️ Download

Na página de [**Releases**](../../releases/latest) há duas opções:

| Arquivo | Para quem | Atualização |
|---|---|---|
| **`TelaShare-Setup-X.Y.Z.exe`** (recomendado) | Instala em poucos segundos, sem pedir administrador, e cria atalho na área de trabalho | **Automática:** o app baixa a versão nova sozinho e pede para reiniciar |
| **`TelaShare.exe`** | Portátil: não instala, é só abrir | Manual: o app avisa e abre a página de download |

Os dois funcionam juntos na mesma sala. Os arquivos `latest.yml` e `.blockmap` da release são
usados pela atualização automática e você não precisa baixá-los.

> **Aviso do Windows (SmartScreen):** o executável não tem assinatura digital, então o Windows pode
> mostrar "O Windows protegeu o computador". Clique em **Mais informações → Executar assim mesmo**.

## 🚀 Como usar

1. Cada pessoa abre o `TelaShare.exe`.
2. Todos digitam **seu nome** e o **mesmo código de sala** (ex.: `nossasala123`). O botão **🎲**
   gera um código aleatório que ninguém mais vai usar.
3. **Uma** pessoa clica em **Criar sala**, e as outras clicam em **Entrar**.
4. Para mostrar sua tela, clique em **🖥️ Compartilhar tela** e escolha a tela inteira ou uma janela.
   - Com **"Incluir áudio do PC"** marcado, o som do computador vai junto.
5. As telas dos outros aparecem na área principal. Dê **duplo clique** para ver em tela cheia.

Várias pessoas podem compartilhar a tela ao mesmo tempo. Na barra da sua prévia, **🙈 Ocultar prévia**
esconde a sua própria tela, libera o vídeo e economiza processamento. Os outros continuam vendo.

**Nomes iguais?** Sem problema: cada instalação tem um identificador aleatório. Pessoas com o mesmo
nome aparecem como `Juliano #a1b2` e `Juliano #c3d4`, cada uma com uma cor, e o volume de cada uma é
lembrado separadamente.

### 📋 Convidar pelo link
Dentro da sala, clique em **📋 Copiar convite** e mande a mensagem para o amigo. Ela contém um link
`telashare://sala/<código>`: com o TelaShare aberto pelo menos uma vez no PC do amigo, abrir esse link
já abre o app e entra na sala.

> Alguns apps de chat (WhatsApp, Discord) não deixam clicar em links `telashare://`. Nesse caso,
> copie o link e cole na barra de endereço do navegador ou em **Win + R**, ou use o código da sala
> que vai junto na mensagem.

### ↩️ Voltar para a última sala
Depois de sair de uma sala, a tela inicial mostra **"↩️ Voltar para a sala abc-123 (há 5 min)"**.
Um clique e você está de volta. Se a sala ainda estiver aberta, você entra nela. Se todos tiverem
saído, você a abre de novo com o mesmo código, e os outros podem voltar também.

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
| **Sons de aviso** | Bipes curtos quando alguém entra, sai, compartilha a tela, quando você muta, quando a conexão cai e quando volta. Com volume próprio |
| **Abaixar o som das telas quando alguém fala** | Quando alguém fala, o som das telas (jogo, vídeo) cai para 30% e volta sozinho |
| **◀ Esconder a barra lateral** (`Ctrl+B`) | As telas ocupam a janela toda e fica só uma barra mínima com ☰ (mostrar a barra), o status da conexão, 🎤 mudo, 🖥️ compartilhar e 📞 sair. O app lembra a escolha |
| **🔍 Tela em foco** | Clique numa tela (ou no 🔍) para deixá-la grande. As outras viram miniaturas à direita e chegam em **qualidade bem menor** (1/4 da resolução, 10 fps), o que alivia o seu PC e o de quem compartilha. Clique de novo (ou no ↩️) para voltar à grade. Duplo clique continua abrindo em tela cheia |
| **Pausar o vídeo das telas com o app escondido** | Com o TelaShare minimizado ou coberto por outra janela (ex.: jogo em tela cheia) por mais de 2 s, quem compartilha **para de enviar o vídeo** para você. O seu PC não decodifica e o de quem compartilha não codifica aquele vídeo. **O som da tela e as vozes continuam.** Ao voltar para o app, o vídeo volta em ~1 s. Ligado por padrão |

**Microfone ou fone desconectado:** o app troca sozinho para o dispositivo padrão e avisa. Quando o
seu dispositivo preferido volta, ele volta a usar esse.

Um limitador automático evita distorção quando o volume passa de 100%. O app lembra o volume de
cada pessoa pelo nome dela.

### Compartilhar tela
| Controle | O que faz |
|---|---|
| **Incluir áudio do PC** | Envia o som do computador junto com a tela |
| **Qualidade** | 720p 30fps · 1080p 30fps · 1080p 60fps |
| **Volume do áudio da tela enviado** | Volume do som do seu PC que os outros ouvem |

**Qualidade adaptativa:** se a rede de alguém piorar, a qualidade da sua tela **para aquela pessoa**
baixa sozinha (máxima → média → baixa) em vez de travar, e volta quando a rede melhora. Sua prévia
mostra para quem a qualidade foi reduzida.

O app guarda suas configurações para a próxima vez.

## ℹ️ Sobre o app

O botão **i** no topo, ao lado do indicador de conexão, abre a janela **Sobre**, com:
- versão instalada e copyright;
- **Atualizações** (o app baixa as versões novas das releases públicas do GitHub):
  - **versão instalada:** baixa a versão nova sozinha, em segundo plano (só a diferença entre as versões), ao abrir o app e a cada 4 horas. Quando termina, aparece "⬆️ Versão X baixada" e o botão **🔄 Reiniciar e atualizar**. Se você não reiniciar, ela é instalada quando você fechar o app. Se você estiver numa sala, o app pergunta antes de reiniciar.
  - **versão portátil:** avisa quando existe uma versão nova, com bolinha vermelha no botão **i**, e mostra um botão para baixar.
- botões para o **projeto pai no GitHub**, para as **versões/downloads** e para **reportar um problema**;
- a **licença AGPLv3** completa, o **NOTICE** e as **licenças dos componentes de terceiros**
  (PeerJS, Electron e Chromium).

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
- **🔇** ao lado do nome: a pessoa está com o microfone mudo.

Se alguém fechar o app ou perder a internet, essa pessoa e a tela dela somem em até ~8 segundos.

### 🔁 Reconexão automática
Se a **sua** conexão cair (a internet piscou), o app tenta voltar sozinho para a mesma sala:
até **5 tentativas**, esperando 2 s, 4 s, 8 s, 15 s e 30 s entre elas. O selo mostra
"Reconectando (2 de 5)...". Se você estava compartilhando a tela, ela volta junto. Se não conseguir,
o app avisa e volta para a tela inicial.
- Quem sai **de propósito** ("Sair da sala" ou fechando o app) não dispara reconexão nos outros.
- O **anfitrião** mantém a sala aberta e só reconecta ao servidor; quem volta são os convidados.

**Se o anfitrião sair**, a sala **não acaba**:
- quem ficou continua conversando e fica procurando a sala; se o anfitrião criar a sala de novo, todos se religam a ele;
- depois de ~6 s sem anfitrião, um dos convidados **assume a sala** sozinho ("👑 Você agora mantém a sala aberta"), para que pessoas novas, ou quem saiu, consigam entrar;
- quem clicar em **Criar sala** com o código de uma sala que já está aberta entra nela, em vez de receber um erro.

**Com 3 ou mais pessoas**, cada par tem a sua própria ligação direta. Se cair **só** a ligação
entre você e uma pessoa (e o resto da sala continuar), o app religa esse par sozinho: aparece
"📶 Conexão com Fulano caiu. Religando..." e depois "✅ Religado com Fulano" (até 6 tentativas).
Para isso, cada participante avisa a cada 3 s com quem está ligado, e todos sabem quem continua na sala.

**Se a ligação direta com alguém não fecha** (a rede de um dos dois bloqueia), o app tenta de novo
várias vezes e, depois de ~20 s, avisa: "⚠️ Sem conexão direta com Fulano". A pessoa aparece em
**Participantes** com ⚠️. O app continua tentando a cada 1 minuto, e se a rede liberar, conecta sozinho.
Para resolver de vez, use um servidor **TURN** em "Avançado" ou uma **VPN** (veja abaixo).

**A tela vai por uma conexão separada da voz.** Se ela não conecta ou cai, quem compartilha refaz a
chamada sozinho, e quem assiste pede de novo se a tela não chegar. Se mesmo assim não chegar, os dois
recebem o aviso "⚠️ A tela de Fulano não está chegando".

### 🩺 Copiar diagnóstico
Se algo der errado (alguém não aparece, a tela não chega, sem som), cada pessoa clica em
**🩺 Copiar diagnóstico** e cola o texto na conversa. Ele mostra:
- versão, sala e se você é o anfitrião;
- cada ligação (dados, voz e telas), com o estado e o tipo de conexão (`host` = rede local/VPN, `srflx` = direta pela internet, `relay` = via TURN);
- quem está na sala **sem** ligação com você;
- os últimos eventos (entrou, caiu, religou, refez a tela...).

O texto **não** inclui endereços IP.

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

- **Eco no áudio da tela:** desde a v1.3.5, "Incluir áudio do PC" captura o som do Windows **sem** o
  som do próprio TelaShare, ou seja, sem as vozes da sala. Se o Windows não conseguir separar, aparece o aviso
  "⚠️ Este PC não conseguiu separar o som da chamada..." e os colegas podem se ouvir repetidos. Nesse
  caso, desmarque o áudio do PC se não precisar dele. Fone de ouvido **não** resolve, porque a
  captura pega o som antes de ele chegar ao fone.
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
npm run dist       # gera dist/TelaShare-Setup-X.Y.Z.exe (instalador) e dist/TelaShare.exe (portátil), Windows x64
npm test           # testes automatizados LOCAIS (veja abaixo)
```

Estrutura:

```
test/         testes automatizados LOCAIS (npm test)
main.js       processo principal (janela, captura de tela/áudio)
preload.js    ponte segura entre o Electron e a página
index.html    interface
renderer.js   lógica de conexão, áudio, volumes e compartilhamento
style.css     visual
```

## 🧪 Testes automatizados (LOCAIS)

> ⚠️ **Estes testes são LOCAIS.** Eles abrem várias janelas do app **no mesmo computador**, cada uma
> simulando um participante. Servem para pegar erros de lógica (entrar/sair da sala, volumes,
> indicador de conexão), mas **não substituem um teste real entre PCs em casas diferentes**.

```bash
npm test             # todos; leva ~5 minutos e precisa de internet (usa o servidor público do PeerJS)
npm test -- 4 27     # só os módulos indicados (pelo número do teste), para testar uma correção
```

**O que é testado:**

| # | Teste |
|---|---|
| 1 | Criar sala + entrar, com voz conectada nos dois lados (3 vezes) |
| 2 | Entrar antes de a sala existir |
| 3 | Código errado mostra "Sala não encontrada" |
| 4 | Três pessoas, todos conectados a todos |
| 5 | Quem sai some da lista |
| 6 | Voz chega; volume 300% ≈ 3x; 0% silencia; ganho do microfone na proporção certa; sem distorção em 400% |
| 7 | Indicador "Conectado"; ping e tipo de conexão aparecem |
| 8 | Testar som, ouvir microfone e gravar teste funcionam |
| 9–11 | Fechar o app ou sair remove a pessoa e a tela dela |
| 12 | 20 segundos conectado sem remoção falsa |
| 13 | Indicador de mudo aparece e some para os outros |
| 14 | Ducking abaixa e volta quando alguém fala; **14b:** continua funcionando com o app minimizado |
| 15 | Qualidade adaptativa aplica e restaura resolução/bitrate |
| 16 | Convite: copia o link e entra na sala por ele |
| 17–18 | Aviso legal visível; janela Sobre com licenças e link do projeto pai |
| 19 | Nomes repetidos ficam diferentes, com cores e volumes separados |
| 20 | Sons de aviso (entrou, saiu, mudo) e opção de desligar |
| 21–22 | Reconexão automática depois de uma queda, e desistência após o limite de tentativas |
| 23 | Aviso de nova versão |
| 24 | Microfone desconectado → passa para o padrão e avisa |
| 25–26 | 🎲 código aleatório; ocultar a minha prévia |
| 27 | **(#31)** Três pessoas: só a ligação entre dois convidados cai e é religada sozinha, com voz nos dois sentidos; quem sai de propósito não é religado |
| 28 | **(#32)** O anfitrião sai e cria a sala de novo (todos se religam); sai de vez (um convidado assume e uma pessoa nova encontra todos); volta com "Criar sala" (entra na sala existente) |
| 29 | **(#30)** Ligação entre dois convidados bloqueada (simulado): tenta de novo até conectar; bloqueada de vez avisa os dois e mostra ⚠️ na lista; quando libera, conecta e o aviso some |
| 30 | **(#33)** A chamada da tela falha nas primeiras vezes e é refeita até aparecer; o vídeo cai depois de conectado e volta sozinho, sem afetar a voz |
| 31 | **(#35)** Compartilhar com áudio pede a captura **sem** o som do próprio app e avisa quando o sistema não consegue separar (captura simulada: o áudio do PC real só existe no Windows) |
| 32 | **(#34)** "Copiar diagnóstico": mostra cada ligação (dados e voz, com o tipo de conexão), quem está na sala sem ligação e os últimos eventos, sem endereços IP |
| 33 | **(#44)** Atualização automática na versão instalada: progresso do download, "Reiniciar e atualizar" (pergunta antes de sair da sala), mensagens de versão mais recente e de erro (o electron-updater é simulado) |
| 34 | **(#44)** Configuração do pacote: instalador NSIS + portátil, publicação no GitHub e atualizador só na versão instalada |
| 35 | **(#46)** App escondido: quem compartilha para de enviar o vídeo e aqui para de decodificar; o som da tela e a voz continuam; o vídeo volta ao reabrir; com a opção desligada, nada pausa |
| 36 | **(#47)** Tela em foco: a destacada fica grande e as outras viram miniaturas enviadas em qualidade bem menor; trocar o foco inverte; voltar para a grade restaura; com o app escondido, nada é enviado |
| 37 | **(#37)** Esconder a barra lateral: as telas ocupam a janela toda, a barra mínima funciona (mudo), Ctrl+B alterna e a escolha vale depois de reabrir |
| 38 | **(#48)** "Voltar para a sala": aparece depois de sair e um clique volta; com a sala vazia, o primeiro a voltar a abre de novo e o outro entra nela |

**O que NÃO é testado** (precisa de teste manual):
- ❌ **Conexão entre redes diferentes**: firewall, NAT, VPN e TURN. Nos testes a conexão é sempre
  "rede local", porque tudo roda no mesmo computador.
- ❌ **Captura de tela real**: o teste usa uma imagem gerada no lugar da tela.
- ❌ **Áudio do PC (loopback)**: só existe no Windows.
- ❌ **Qualidade do som para o ouvido**: os testes medem níveis numéricos, não se o som está agradável.
- ❌ **O `.exe` no Windows**: os testes rodam o código-fonte com o Electron do sistema em que você está.

Os testes usam um microfone falso do Chromium (um bipe) e ficam em `test/local-e2e.js`.

## ⚙️ CI (GitHub Actions)

A cada push na branch `main`, o GitHub:
1. roda os **testes locais** no **Windows** e no **Linux** (cada um numa única máquina virtual; continuam sendo testes LOCAIS);
2. gera **no Windows** o instalador (`TelaShare-Setup-X.Y.Z.exe` + `latest.yml` + `.blockmap`) e o portátil `TelaShare.exe`, disponíveis em *Actions → execução → Artifacts*.

Para publicar uma versão nova, crie e envie uma tag:
```bash
git tag v1.3.0 && git push origin v1.3.0
```
O CI gera os arquivos e cria a Release sozinho. Quem usa a versão instalada recebe a atualização
automaticamente, porque o app lê o `latest.yml` da última release. Se existir `release-notes/<tag>.md`, ele é usado como
descrição da release.

## 📄 Licença e Direitos de Uso

Copyright (C) 2026 **Juliano Machado da Silva** — [TelaShare](https://github.com/JulianoMachadoS/telashare)

Este projeto é distribuído sob a licença **GNU Affero General Public License v3.0 (AGPLv3)**. Veja os arquivos [LICENSE](LICENSE) e [NOTICE](NOTICE) para os termos completos.

### Resumo das regras de uso (TL;DR):
Você é livre para usar, estudar, modificar e distribuir este software ou qualquer um de seus módulos (`renderer.js`, lógica WebRTC, processamento de áudio, etc.), **desde que cumpra obrigatoriamente estas condições**:

1. **Gratuito e Código Aberto Sempre (Copyleft Forte):** Qualquer projeto, fork ou sistema de terceiros que utilize código ou módulos do TelaShare (seja como aplicativo desktop ou rodando em servidor/web) **deve ter seu código-fonte completo aberto ao público** sob a mesma licença **AGPLv3**. Não é permitido fechar o código em software proprietário.
2. **Referência Obrigatória ao Projeto Pai:** Você deve manter os avisos de copyright originais em todos os arquivos e referenciar de forma clara e visível na documentação e na interface que o projeto deriva do **TelaShare**, incluindo o link oficial: [https://github.com/JulianoMachadoS/telashare](https://github.com/JulianoMachadoS/telashare).
3. **Registro de Modificações:** Caso altere arquivos originais, você deve documentar nos arquivos que eles foram modificados e a data da alteração.

> **Nota:** as versões **v1.0.0 a v1.2.0** foram publicadas sob a licença MIT. A partir da **v1.3.0**, o projeto é AGPLv3.
