# Quiz ao Vivo — Funcionalidades

Um "Kahoot" próprio: jogo de perguntas e respostas ao vivo, jogado pelo
celular, sem limite de participantes e sem mensalidade. Dois aplicativos
que conversam entre si — um pra quem organiza, outro pra quem joga.

## Pra que serve

Pensado pra dinâmicas em grupo — estudos, aulas, encontros, brincadeiras
em família — onde uma pessoa conduz as perguntas na tela grande (TV,
projetor, tablet) e todo mundo responde pelo próprio celular em tempo
real, com placar ao vivo.

---

## O app Admin (quem organiza)

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

### Entrada tardia
Se alguém entrar depois que o jogo já começou, o app calcula se ainda
resta mais da metade da pontuação total em disputa (contando os
multiplicadores de bônus). Se sim, a pessoa entra e já participa das
próximas perguntas; se o quiz já passou do meio, a entrada é bloqueada —
pra manter o jogo justo pra quem começou desde o início.

### Sala ao vivo
Ao abrir um quiz, o app gera um **código de 6 dígitos** — e também um
**QR Code e um link direto**, pra quem for jogar não precisar nem digitar
nada. Quem organiza controla o ritmo: mostra a pergunta com cronômetro,
revela a resposta certa com um gráfico de quantos escolheram cada opção,
mostra o placar, e avança pra próxima. Se o navegador travar ou fechar no
meio do jogo, dá pra retomar o controle de onde parou.

### Pontuação
Igual ao Kahoot: errar vale zero. Acertar vale entre 500 e 1000 pontos,
dependendo da velocidade da resposta — quem responde certo mais rápido
ganha mais.

### Relatório completo
Depois (ou durante) qualquer sessão, dá pra ver um relatório detalhado:
classificação geral, e pergunta por pergunta quem respondeu o quê, se
acertou, quanto tempo levou e quantos pontos ganhou. Exporta em **CSV** ou
em **PDF** — de graça, sem limitar isso a um plano pago.

---

## O app do Jogador (quem participa)

### Entrar sem cadastro
Só digita o código da sala e o nome — sem e-mail, sem senha, sem criar
conta.

### Montar um avatar
Antes de entrar, cada jogador monta seu próprio bonequinho: escolhe a cor,
um chapéu (boné, coroa, chapéu de festa, faixa), óculos e uma expressão.
Esse avatar acompanha o jogador na sala de espera, no placar e no
relatório final.

### Jogar
As perguntas aparecem no celular no mesmo ritmo que na tela principal, com
cronômetro visível. Depois de cada pergunta, o jogador vê se acertou,
quantos pontos ganhou, e como está no placar geral.

### Levar o resultado pra casa
Ao final da partida, cada jogador pode baixar o **próprio resultado em
PDF** — com o avatar, a pontuação total, a colocação final e como foi em
cada pergunta.

---

## Como é usar, na prática

1. **Criar o quiz** — título, tema, e as perguntas (com imagem, se quiser)
2. **Abrir a sala** — o app gera o código de 6 dígitos
3. **Compartilhar o código** — a galera acessa o site do jogo, digita o
   código, monta o avatar e entra
4. **Jogar** — quem organiza avança pergunta por pergunta; todo mundo
   responde pelo celular e acompanha o placar
5. **Ver o resultado** — ao final, o placar geral fica disponível pra
   consulta, com relatório completo e exportação em PDF; cada jogador
   também pode baixar o próprio resultado
