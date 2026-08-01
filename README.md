# Quiz ao Vivo

Um "Kahoot" próprio, sem limite de jogadores e sem custo — dois sites que
conversam pelo mesmo banco Firestore:

- **`admin/`** — onde você cadastra os quizzes (com temas e imagens) e
  controla o jogo ao vivo. Protegido por login (só você acessa).
- **`jogo/`** — onde os participantes entram pelo celular com um código de
  6 dígitos e jogam. Sem cadastro nenhum.

## Como funciona por dentro

Cada quiz cadastrado no admin é um "molde" (coleção `quizzes`). Ao clicar em
**Abrir sala**, o admin gera um código de 6 dígitos e cria uma sessão
(coleção `sessions/{codigo}`) com uma cópia das perguntas daquele momento —
editar o quiz depois não afeta partidas já abertas.

A partir daí:
- `sessions/{codigo}/players/{id}` — nome e avatar de cada jogador que entra
- `sessions/{codigo}/answers/{indice_id}` — cada resposta enviada
- `sessions/{codigo}/scores/{id}` — pontuação calculada pelo admin ao revelar
  cada pergunta

Tudo sincroniza em tempo real (`onSnapshot` do Firestore) — sem servidor
próprio, sem polling manual.

### Pontuação

Igual ao Kahoot: errou, é zero. Acertou, ganha entre 500 e 1000 pontos
dependendo da velocidade — resposta certa e instantânea vale os 1000
cheios, resposta certa bem no último segundo vale 500. A fórmula fica em
`kahootPoints()` no `admin/app.js`.

### Avatar

Cada jogador monta seu bonequinho antes de entrar na sala: cor, chapéu
(boné, coroa, chapéu de festa, faixa), óculos (redondo, estiloso) e
expressão. É tudo SVG gerado por código (`shared/avatar.js`) — sem imagem
externa, sem licenciamento pra se preocupar.

### Relatório

Ao final de cada partida (ou a qualquer momento depois, pela aba
**Sessões** no admin), dá pra ver o relatório completo: pergunta por
pergunta, quem respondeu o quê, se acertou, quanto tempo levou e quantos
pontos ganhou — com botão pra baixar em **CSV** ou em **PDF** (placar geral
+ detalhamento por pergunta). Diferente do Kahoot, isso fica disponível
sem pagar nada.

Cada jogador também pode baixar o próprio resultado em PDF na tela final
do jogo — com o avatar, a pontuação total, a colocação e como foi em cada
pergunta.

## Configuração (uma vez só)

### 1. Firebase
1. Crie um projeto em [console.firebase.google.com](https://console.firebase.google.com)
2. Ative **Firestore Database** (modo produção)
3. Ative **Authentication → método Email/senha**
4. Em Configurações do projeto → Seus apps → adicione um app Web, copie o
   objeto `firebaseConfig` e cole em `shared/firebase-config.js`
5. Em Authentication → Users, clique em **Add user** e crie seu login de
   admin (e-mail + senha) — não existe cadastro público, só você mesmo cria
   essa conta pelo console
6. Em Firestore → Regras, cole o conteúdo de `firestore.rules` e publique

### 2. Unsplash (imagens das perguntas)
1. Crie uma conta em [unsplash.com/developers](https://unsplash.com/developers)
2. Crie uma aplicação ("New Application")
3. Copie o **Access Key** e cole em `shared/unsplash-config.js`
4. O plano gratuito permite 50 buscas por hora — de sobra pra montar um quiz

### 3. Publicar (GitHub Pages)
Suba a pasta inteira (`shared/`, `admin/`, `jogo/`) num repositório e ative
o GitHub Pages na raiz. Os sites ficam em:
- `https://seuusuario.github.io/repo/admin/`
- `https://seuusuario.github.io/repo/jogo/`

Sem build step — é só HTML/CSS/JS puro.

### Instalar como app (PWA)

Os dois sites têm `manifest.json` e ícone próprios — dá pra instalar cada
um separadamente num tablet ou celular, com ícone na tela e sem barra de
endereço:

- **Android/Chrome:** abra o site, toque no menu (⋮) → "Instalar app" (ou
  "Adicionar à tela inicial")
- **iPad/iPhone (Safari):** abra o site, toque em Compartilhar →
  "Adicionar à Tela de Início"

Como `admin/` e `jogo/` são pastas (e portanto URLs) diferentes, eles
aparecem como dois ícones distintos — um "Quiz Admin" e outro "Quiz".
Um service worker (`sw.js`) guarda os arquivos do site em cache pra abrir
mais rápido e continuar mostrando a interface mesmo com internet instável
(mas o jogo em si sempre precisa de conexão, porque depende do Firestore
em tempo real).

## Estrutura de arquivos

```
shared/
  firebase-config.js   credenciais do Firebase (usado pelos dois sites)
  unsplash-config.js   chave do Unsplash (usado só pelo admin)
  theme.css             paleta de cores, tipografia, componentes visuais
  avatar.js              gerador do bonequinho (SVG e PNG)
  scoring.js             fórmula de pontuação (igual Kahoot)
  pdf-helpers.js         estilo compartilhado dos PDFs
admin/
  index.html             login + shell da aplicação
  admin-app.js            CRUD de quizzes, busca Unsplash, controle da sala
  admin-style.css         estilos específicos do painel
  admin-manifest.json     configuração do PWA (nome, ícone, cores)
  admin-sw.js             service worker (cache dos arquivos do site)
  admin-icon-192.png / admin-icon-512.png / admin-favicon.png / admin-apple-touch-icon.png
jogo/
  index.html             shell do site do jogador
  jogo-app.js             entrar na sala, responder, ver placar
  jogo-style.css          estilos específicos do jogo
  jogo-manifest.json      configuração do PWA
  jogo-sw.js              service worker
  jogo-icon-192.png / jogo-icon-512.png / jogo-favicon.png / jogo-apple-touch-icon.png
firestore.rules          regras de funcionamento do banco
FUNCIONALIDADES.md       o que o app faz, sem passos de instalação
```

Só o `index.html` tem o mesmo nome nas duas pastas — é proposital, é o
nome que o navegador carrega sozinho ao abrir uma pasta. Todo o resto
ganhou o prefixo `admin-`/`jogo-` justamente pra nunca ter dois arquivos
com nome igual espalhados pelo projeto (o que atrapalhava na hora de
baixar/organizar).

## Limitação conhecida

Como não há um servidor próprio (só Firestore), as respostas certas viajam
no mesmo documento da sessão que os jogadores leem — em teoria alguém muito
curioso poderia inspecionar a rede do navegador e ver a resposta antes de
responder, se souber o código daquela sala especificamente. As regras do
Firestore já impedem que alguém de fora *liste* todas as sessões e descubra
códigos de salas alheias — mas dentro da própria sala, pra quem já tem o
código, a resposta certa não é 100% secreta até o momento da revelação. Pra
um quiz casual de grupo isso não costuma ser problema; se um dia quiser
fechar essa brecha por completo, a solução é mover a correção pra uma
Cloud Function (aí exige o plano Blaze do Firebase).
