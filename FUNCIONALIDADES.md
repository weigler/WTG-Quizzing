# Quiz ao Vivo — Funcionalidades

Um "Kahoot" próprio: jogo de perguntas e respostas ao vivo, jogado pelo
celular, sem limite de participantes e sem mensalidade. Três telas que
conversam entre si — uma página inicial, um app pra quem organiza e um
app pra quem joga.

## Pra que serve

Pensado pra dinâmicas em grupo — estudos, aulas, encontros, brincadeiras
em família — onde uma pessoa conduz as perguntas na tela grande (TV,
projetor, tablet) e todo mundo responde pelo próprio celular em tempo
real, com placar ao vivo.

A página inicial (raiz do site) só mostra dois botões — "Entrar num
jogo" e "Painel do organizador" — pra quem chega sem saber pra qual lado
ir.

---

## O app Admin (quem organiza)

### Contas separadas
Cada conta de admin só vê e controla os **próprios** quizzes e sessões —
dá pra ter vários organizadores (até 10 ou mais) sem que um interfira no
que é do outro. Sem cadastro público: só quem já tem uma conta criada
consegue entrar.

### Importar perguntas
Em vez de cadastrar uma por uma, dá pra colar um texto com várias
perguntas de uma vez (formato simples, com um modelo pronto pra copiar) ou
um JSON — o app reconhece automaticamente pergunta, opções, resposta
certa, tempo e bônus. Útil pra trazer perguntas geradas por outras
ferramentas (NotebookLM, ChatGPT etc.): é só pedir pra IA reescrever o
conteúdo no formato do modelo e colar aqui.

### Duplicar e reordenar
Quizzes inteiros (na lista) e perguntas individuais (dentro do editor)
podem ser duplicados com um clique. Perguntas e opções de resposta também
podem ser reordenadas (setinhas ▲▼) sem precisar recriar nada — a
marcação de "certa" viaja junto quando uma opção muda de posição.

### Embaralhar
Dois interruptores independentes no quiz: **embaralhar perguntas**
(sorteia uma ordem diferente cada vez que a sala é aberta) e **embaralhar
respostas** (sorteia a ordem das opções de cada pergunta também a cada
sala nova). Os dois vêm desligados por padrão. Úteis pra quem costuma
jogar o mesmo quiz mais de uma vez — dificulta decorar a posição das
respostas de uma partida pra outra.

### Trilha sonora
Cada quiz pode ter uma música de fundo: escolha entre faixas prontas
(gratuitas) ou cole o link direto de qualquer outro arquivo de áudio
(.mp3/.ogg) — com botão pra testar na hora, antes de salvar. Toca na tela
de quem está controlando o jogo (não no celular de cada jogador, pra não
virar uma bagunça de sons), com botão pra silenciar a qualquer momento.

### Modos de jogo
O quiz em si não define o modo — isso é escolhido na hora de **abrir a
sala**, então o mesmo quiz pode virar jogos bem diferentes em ocasiões
diferentes. As opções:

- **Clássico** — pergunta → revelação → placar → próxima.
- **Equipes** — jogadores escolhem um time ao entrar (você define os
  nomes na hora de abrir a sala); o placar usa a **média** dos pontos do
  time (não a soma), pra um time com mais gente não pontuar mais só por
  ter mais gente. Dois submodos: **cada integrante responde** (todo mundo
  do time joga e a pontuação faz a média) ou **um aparelho só por equipe**
  (só uma pessoa por time entra, representando o time inteiro — times já
  ocupados aparecem travados pros outros).
- **Sobrevivência** — quem responde errado (ou não responde) é eliminado
  e vira espectador — mesmo que isso zere todo mundo de uma vez. Quem é
  eliminado pode baixar o próprio resultado em PDF na hora, e continua
  acompanhando até o jogo acabar de verdade pra todo mundo.
- **Cooperativo** — sem ranking individual: todo mundo soma pra um placar
  coletivo único. Dá pra definir uma **meta** opcional (em pontos fixos
  ou em % do máximo possível daquele quiz) pra saber se o grupo "bateu a
  meta" ao final.
- **Corrida livre** — sem pausa pra revelação entre perguntas: cada
  jogador avança sozinho, no seu próprio ritmo. Dois submodos:
  **sincronizada** (todo mundo compartilha um único cronômetro, que
  começa quando você clica em "Começar corrida") ou **assíncrona** (a
  sala fica aberta por um período que você escolhe — horas ou dias — e
  cada jogador entra e joga quando quiser, com o próprio tempo total pra
  responder tudo, dentro dessa janela; dá pra fechar a sala antes ou
  estender o prazo, enquanto a janela não tiver fechado).
- **Blefe** — cada pergunta vira uma rodada de blefe: todo mundo escreve
  a própria resposta falsa (mas convincente), depois todo mundo vota em
  qual acha que é a verdadeira. Quem acerta a verdadeira ganha pontos;
  quem engana os outros também — quanto mais gente cair no seu blefe,
  mais pontos.

### Cadastro de quizzes
Dá pra criar quantos quizzes quiser, com temas diferentes — um sobre um
livro, outro só de curiosidades, outro pra uma data comemorativa. Cada
quiz fica salvo e pode ser reaberto quantas vezes quiser.

### Tipos de pergunta
- **Escolha única** — só uma resposta certa
- **Múltipla escolha** — duas ou mais respostas certas ao mesmo tempo
- **Verdadeiro ou Falso**
- De 2 a 6 opções de resposta por pergunta, cada uma com sua cor e forma
  (losango, triângulo, círculo, quadrado, pentágono, hexágono), no estilo
  Kahoot
- Cada pergunta pode ter uma imagem de capa, buscada direto do banco de
  fotos Unsplash
- Perguntas podem ser marcadas como **bônus**, valendo 2x ou 3x a
  pontuação normal — útil pra compensar quem entrar depois do início
- Pergunta limitada a 150 caracteres e cada opção a 80 — garante que tudo
  cabe direitinho na tela durante o jogo, mesmo em celulares pequenos

### Entrada tardia
Se alguém entrar depois que o jogo já começou, o app calcula se ainda
resta mais da metade da pontuação total em disputa (contando os
multiplicadores de bônus). Se sim, a pessoa entra e já participa das
próximas perguntas; se o quiz já passou do meio, a entrada é bloqueada —
pra manter o jogo justo pra quem começou desde o início. E, uma vez que
uma sala é encerrada, ninguém mais consegue entrar nela — só ver o
resultado.

### Sala ao vivo
Ao abrir um quiz, o app gera um **código de 6 dígitos** — e também um
**QR Code e um link direto**, pra quem for jogar não precisar nem digitar
nada. Assim que todo mundo responde (ou o tempo de alguém esgota — a
resposta dela é finalizada automaticamente, mesmo vazia, pra não travar a
sala esperando quem sumiu), a revelação acontece **sozinha**, sem
precisar clicar em nada — mas o botão "Revelar respostas agora" continua
disponível pra avançar antes, se quiser. Quem organiza controla o resto
do ritmo: mostra a pergunta com cronômetro, revela a resposta certa com
um gráfico de quantos escolheram cada opção, mostra o placar, e avança
pra próxima. Se o navegador travar ou fechar no meio do jogo, dá pra
retomar o controle de onde parou.

### Gerenciar jogadores
Dá pra remover qualquer jogador de uma sessão — na sala de espera,
durante o jogo, no resultado final, ou até meses depois, revisitando o
relatório pela aba Sessões. Remover apaga o registro, as respostas e a
pontuação da pessoa por completo, inclusive dos placares já salvos.

### Pontuação
Igual ao Kahoot: errar vale zero. Acertar vale entre 500 e 1000 pontos,
dependendo da velocidade da resposta — quem responde certo mais rápido
ganha mais. Respondeu em **menos de meio segundo**? Pontuação máxima
garantida, sem desconto nenhum de tempo.

**Modo Combo** (desligado por padrão, ative se quiser): acertar perguntas
seguidas ativa um bônus que vai aumentando — +50 no segundo acerto
seguido, +100 no terceiro, até um teto de +250. O relatório, o CSV e o
PDF mostram tanto o multiplicador do combo (x2, x3...) quanto quantos
pontos extras aquilo valeu, não só a etiqueta.

**Modo de Precisão** (também desligado por padrão): pontuação passa a
valer só pelo acerto — sempre 1000 pontos fixos (mais bônus de combo, se
houver) quando certo, não importa a velocidade. Bom pra quizzes onde
pensar com calma deveria valer tanto quanto ser rápido.

### Relatório completo
A aba **Sessões** lista todas as salas já abertas, mostrando o **modo de
jogo** de cada uma. Depois (ou durante) qualquer sessão, dá pra ver um
relatório detalhado: classificação geral (já respeitando equipes ou
placar coletivo, quando for o caso), e pergunta por pergunta quem
respondeu o quê, se acertou, quanto tempo levou, o combo (com os pontos
de bônus) e quantos pontos ganhou no total. Exporta em **CSV** ou em
**PDF** (com o modo de jogo no cabeçalho) — de graça, sem limitar isso a
um plano pago. Pela mesma tela também dá pra **excluir** uma sessão
inteira (em andamento ou já encerrada), removendo sala, jogadores,
respostas e pontuações dela.

---

## O app do Jogador (quem participa)

### Entrar sem cadastro
Só digita o código da sala e o nome — sem e-mail, sem senha, sem criar
conta.

### Montar um bichinho
Antes de entrar, cada jogador monta seu próprio avatar: escolhe entre 6
bichos felizes (raposa, urso, gato, coelho, tigre, coruja), uma cor, um
chapéu (boné, coroa, festa, faixa, laço, flores, mago, cowboy) e óculos.
Esse avatar acompanha o jogador na sala de espera, no placar e no
relatório final.

### Jogar
As perguntas aparecem no celular no mesmo ritmo que na tela principal,
com o mesmo cronômetro visual (anel circular) de quem está controlando.
Depois de cada pergunta, o jogador vê claramente qual era a resposta
certa (verde), se ele errou (a escolha dele em vermelho) ou acertou
(verde mais forte), quantos pontos ganhou, e se pegou algum combo.

### Sempre atualizado
Se o celular perder a conexão por um instante (rede ruim, app em segundo
plano), a tela se autocorrige sozinha assim que a conexão volta — não
fica mais presa numa tela antiga. E se ainda assim travar, tem um botão
"🔄 atualizar" sempre à mão nas telas de espera.

### Levar o resultado pra casa
Ao final da partida, cada jogador pode baixar o **próprio resultado em
PDF** — com o avatar, a pontuação total, a colocação final e como foi em
cada pergunta (incluindo combos). Quem esqueceu de baixar na hora, ou
jogou em outro aparelho, pode voltar depois pela tela inicial do jogo e
**buscar o próprio resultado** digitando o código da sala e o nome usado
— desde que o jogo já tenha terminado.

---

## Como é usar, na prática

1. **Criar o quiz** — título, tema, e as perguntas (com imagem, se quiser)
2. **Abrir a sala** — o app gera o código de 6 dígitos, QR Code e link
3. **Compartilhar** — a galera acessa o site do jogo, digita o código (ou
   escaneia o QR Code), monta o bichinho e entra
4. **Jogar** — quem organiza avança pergunta por pergunta; todo mundo
   responde pelo celular e acompanha o placar
5. **Ver o resultado** — ao final, o placar geral fica disponível pra
   consulta, com relatório completo e exportação em PDF; cada jogador
   também pode baixar (ou buscar depois) o próprio resultado
