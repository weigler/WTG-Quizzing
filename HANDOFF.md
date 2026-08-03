# Quiz ao Vivo — Retomada da conversa

Este arquivo existe porque a conversa anterior chegou no limite de tamanho.
Leia isso antes de mexer em qualquer coisa — explica onde tudo está e por quê.

## O que é o projeto

Um "Kahoot" próprio, sem custo e sem limite de jogadores. Três partes:
- **`admin/`** — painel de quem organiza (login, cadastra quizzes, controla o jogo ao vivo)
- **`jogo/`** — site de quem participa (sem cadastro, entra com código de 6 dígitos)
- **`index.html`** (raiz) — landing page com dois botões, um pra cada lado

Stack: Firebase Auth + Firestore, tudo estático (GitHub Pages), sem servidor próprio.
Para o que cada funcionalidade faz do ponto de vista do usuário, **leia
`FUNCIONALIDADES.md`** — está sempre atualizado. Para configurar/publicar,
leia `README.md`. Este arquivo aqui (`HANDOFF.md`) é só pra mim (Claude)
entender o estado técnico e não é pra ser lido pelo usuário final.

## ⚠️ Ação pendente mais importante

**O `firestore.rules` mudou várias vezes ao longo da conversa e precisa
ser republicado no Firebase Console** (Firestore Database → Regras →
colar o conteúdo de `firestore.rules` → Publicar). Se o usuário disser
que algo "não funciona" (sala não abre, Blefe não grava, Comunidade vazia,
corrida não pontua), a primeira pergunta é: **"você republicou as regras
depois da última mudança?"**

## Estrutura de dados (Firestore)

```
quizzes/{quizId}
  ownerId, title, theme, coverImage, coverCredit, defaultTimeLimit,
  musicUrl, precisionMode, comboMode, shuffleQuestions, shuffleAnswers,
  isPublic (bool — ver seção "Quizzes públicos" abaixo), questions[]
  → cada question: {id, text, type(single/multiple/tf), options[],
    correct[] (índices), timeLimit, pointsMultiplier, imageUrl, imageCredit}

sessions/{code}  (code = 6 dígitos)
  ownerId, quizId, title, status, questions[] (cópia congelada do quiz,
  já embaralhada se configurado), currentIndex, questionStartedAt,
  musicUrl, precisionMode, comboMode,
  gameMode ('classico'|'equipes'|'sobrevivencia'|'cooperativo'|'corrida'|'blefe'),
  teamMode (bool), teamSubmode ('individual'|'device'), teams[],
  cooperativeGoal ({type:'none'|'points'|'percent', value}),
  eliminatedPlayerIds[] (sobrevivência),
  raceSubmode ('sync'|'async'), raceDurationSec, raceStartedAt (sync),
  raceWindowMs, raceWindowEndsAt (async),
  bluffRevealData ({correctText, bluffs, voteCounts} — só a rodada atual),
  leaderboardTop[], finalLeaderboard[] (arrays {id,name,avatar,total})

  sessions/{code}/players/{playerId}     → {name, avatar, team?, joinedAt}
  sessions/{code}/scores/{playerId}      → {total, lastPoints, lastCorrect,
                                             streak, lastCombo, lastBonus,
                                             eliminated-related não usa
                                             campo próprio, fica em
                                             session.eliminatedPlayerIds}
  sessions/{code}/answers/{idx}_{pid}    → {playerId, questionIndex,
                                             selected[], timeMs, submittedAt}
  sessions/{code}/bluffs/{idx}_{pid}     → {playerId, questionIndex, text}
  sessions/{code}/votes/{idx}_{pid}      → {playerId, questionIndex, votedFor}
  sessions/{code}/ready/{idx}_{phase}_{pid} → {playerId, questionIndex, phase}
```

## Status de sessão (`status` field) e quem controla a transição

| status | tela do admin | tela do jogador | como avança |
|---|---|---|---|
| `lobby` | renderLobby | renderWait | admin clica "Começar" |
| `question` | renderQuestionLive | renderQuestion | todo mundo responde (auto) ou admin força |
| `reveal` | renderReveal | renderReveal | botão Continuar (todo mundo) ou admin |
| `leaderboard` | renderLeaderboard | renderLeaderboard | botão Continuar (todo mundo) ou admin |
| `racing` (sync) | renderRaceControl | renderRace | timer único ou admin encerra |
| `racing` (async) | renderRaceAsyncControl | renderRace | janela expira ou admin fecha |
| `bluffwrite` | renderBluffWrite | renderBluffWrite | todo mundo escreve (auto) ou admin |
| `bluffvote` | renderBluffVote | renderBluffVote | todo mundo vota (auto) ou admin |
| `bluffreveal` | renderBluffReveal | renderBluffRevealPlayer | botão Continuar ou admin |
| `ended` | renderEnded | renderEnd | — |

**Padrão importante**: o jogador NUNCA decide sua própria tela olhando o
histórico de onde veio — a função `reactToStatus()` em `jogo/jogo-app.js`
recalcula a view direto do `status` atual toda vez que chega uma
atualização do Firestore. Isso foi uma correção de bug proposital (ver
"Bugs corrigidos" abaixo) — não reintroduza lógica de "só avança se view
atual for X".

## Modos de jogo — onde a lógica de cada um mora

Modo é escolhido **na hora de abrir a sala** (`renderLaunchConfig` no
admin), não no cadastro do quiz. `shared/game-modes.js` tem o essencial:
- `buildLeaderboardRows()` — decide como agrupar o placar (individual,
  por equipe com MÉDIA não soma, ou coletivo pro cooperativo). Usado
  toda vez que `leaderboardTop`/`finalLeaderboard` são escritos.
- `cooperativeProgress()` / `cooperativeGoalPoints()` — meta cooperativa
- `GAME_MODES`, `TEAM_SUBMODES`, `GOAL_TYPES` — listas pra UI

**Sobrevivência**: elimina sempre que erra ou não responde, mesmo que
zere todo mundo (a salvaguarda que existia foi removida a pedido do
usuário). Lógica em `revealAnswers()` (admin). Jogador eliminado vê
`renderEliminated()` (jogo) com botão de PDF liberado na hora.

**Corrida livre**: tem DOIS submodos, bem diferentes:
- `sync` — todo mundo compartilha `raceStartedAt`, um `raceDurationSec` só
- `async` — sala fica aberta por uma janela (`raceWindowEndsAt`), cada
  jogador tem `myRaceStartedAt` PESSOAL (salvo no localStorage do
  próprio celular, chave `quiz-player`), efetivo prazo = mínimo entre
  (meu início + meu orçamento) e (fim da janela). Ver `startRace()` e
  `renderRace()` em `jogo/jogo-app.js`.
- Em AMBOS os submodos, o jogador se autopontua (grava a própria
  `scores/{pid}`) porque não tem admin corrigindo pergunta por pergunta
  — por isso a regra do Firestore libera escrita de `scores` quando
  `gameMode == "corrida"`. Isso é uma faca de dois gumes conhecida: dá
  pra alguém adulterar a própria pontuação mexendo direto no banco. Já
  avisei o usuário disso, é uma troca aceita pro caso de uso (jogo
  casual em grupo).

**Blefe**: pergunta → jogador escreve resposta falsa (`bluffs`) → todo
mundo vota em qual acha real (`votes`) → revelação com pontuação
(+500 acertar, +250 por cada voto que caiu no seu blefe). Relatório
usa lógica própria em `openReport()` porque não passa por `answers`.

**Equipes**: tem dois submodos (`teamSubmode`): `individual` (todo
mundo do time joga, placar é a MÉDIA) ou `device` (um só aparelho por
time — trava no `jogo/jogo-app.js` `renderTeamPicker()`, só client-side,
não tem regra do Firestore reforçando isso).

**Cooperativo**: todo placar vira uma linha só (`{id:'grupo', total:soma
de todo mundo}`). Meta opcional configurada em pontos ou % do máximo
possível do quiz.

## Quizzes públicos / Comunidade (mudança mais recente)

- `quiz.isPublic` — **todo quiz novo nasce `true`** (`emptyQuiz()`).
- **Regra importante de compatibilidade**: quiz criado ANTES dessa
  funcionalidade existir não tem o campo `isPublic` (undefined). Em
  TODOS os lugares (regra do Firestore, checkbox do editor, selo do
  card, lógica de salvar/duplicar) isso é tratado como **privado**
  (`=== true`, nunca `!== false`) — decisão deliberada pra não publicar
  quiz antigo sem o dono escolher isso explicitamente. Se for mexer
  nessa área de novo, mantenha esse padrão (`isPublic === true` pra
  considerar público, nunca a negação).
- Aba **Comunidade** (`renderCommunity`) — quizzes públicos de outras
  contas, consulta `where('isPublic','==',true)` e filtra o próprio
  dono no cliente. Duas ações: abrir sala direto, ou copiar (a cópia
  SEMPRE nasce privada — `duplicateQuiz(q, {fromCommunity:true})`).
- Regra do Firestore pra `quizzes`: `allow read: if isPublic==true OU
  ownerId==uid`. Duas queries separadas no cliente (uma por `ownerId`,
  outra por `isPublic`) — cada uma sozinha já satisfaz um lado do OR,
  então não precisa de índice composto nem de `or()` do Firestore.

## Bugs já corrigidos (não reintroduzir)

- **View do jogador travava** — corrigido reescrevendo `reactToStatus()`
  pra sempre recalcular a tela a partir do status atual, nunca da
  sequência de onde veio (rede instável/app em 2º plano perdia "degraus").
- **`mySelected` vazava entre sessões na mesma aba** — jogador que saía e
  entrava nela mesma aba podia herdar resposta de teste anterior.
  `joinRoom()` e `leaveGame()` agora resetam tudo explicitamente.
- **Avatar "grudava" entre jogadores testados na mesma aba** — mesma
  causa raiz, `leaveGame()` agora reseta `avatarDraft` também.
- **Equipe com mais gente pontuava mais** — `buildLeaderboardRows` usa
  MÉDIA por equipe, não soma.
- **Relatório/PDF não respeitava equipe/blefe/cooperativo** —
  `openReport()` foi reescrita pra ramificar por `gameMode` e usar
  `buildLeaderboardRows`; Blefe reconstrói tudo a partir de
  `bluffs`+`votes` (não usa `answers`).
- **Imagem "aplicar em todas as perguntas" colapsava o formulário** —
  faltava chamar `renderQuestionForm()` depois de `renderQuestionList()`.
- **isPublic undefined virava público sem querer** — ver seção acima.

## Coisa que eu NÃO consegui confirmar 100%

O usuário reportou que no modo Corrida (antes da versão assíncrona) não
conseguia marcar a resposta certa. Apliquei duas correções defensivas
plausíveis (o template de opções sempre desenhava `data-selected="false"`
mesmo se já tivesse seleção; adicionei try/catch com alerta visível em
`submitRaceAnswer`), mas não reproduzi o bug com certeza. **Se o usuário
disser que persiste, pergunte se era pergunta de escolha única ou
múltipla escolha** — isso ajuda a isolar.

## Coisas que ficaram de fora por escolha (não são bugs)

- Corrida: dá pra adulterar a própria pontuação (ver acima) — aceito
  pro caso de uso.
- Modo "aparelho único" por equipe: a trava de "time já ocupado" é só
  visual/client-side, não tem regra do Firestore te impedindo de
  forçar um segundo jogador no mesmo time via API direta.
- Relatório do Blefe recalcula do zero a cada abertura (não é
  cacheado) — funciona bem, só é uma leitura a mais no Firestore.

## Se o usuário pedir pra mexer de novo, lembre de

1. Sempre `node --check arquivo.js` depois de editar (Node valida
   sintaxe ES module sem precisar rodar o app).
2. Depois de editar `firestore.rules`, LEMBRAR o usuário de republicar.
3. Depois de editar código, sempre: copiar `/home/claude/quiz-ao-vivo`
   pra `/mnt/user-data/outputs/`, gerar o zip, `present_files`.
4. Variáveis de estado em `jogo/jogo-app.js` devem ficar TODAS
   declaradas no bloco `let` do topo do arquivo (antes da chamada de
   `boot()` no fim) — já tivemos bug de TDZ (temporal dead zone) por
   declarar `let` no meio do arquivo quando alguma função chamada
   ainda durante o boot síncrono referenciava a variável antes dela
   ser inicializada. Ver comentário em `jogo/jogo-app.js` perto do
   bloco de `let`s.
5. Ao adicionar um modo/comportamento novo que muda o placar, sempre
   passar por `buildLeaderboardRows()` em vez de reescrever a lógica
   de agrupamento em outro lugar (já aconteceu 2x de esquecer um
   lugar — relatório e admin ficaram dessincronizados).
