# Quiz ao Vivo

Um "Kahoot" próprio, sem limite de jogadores e sem custo — dois sites:

- **`admin/`** — onde você cadastra os quizzes e controla o jogo ao vivo.
  Protegido por login.
- **`jogo/`** — onde os participantes entram pelo celular com um código
  de 6 dígitos e jogam. Sem cadastro.

A raiz do site (`index.html`) é só uma página inicial com dois botões,
levando pra um lado ou pro outro — útil como link único pra compartilhar.

Pra saber o que o app faz (tipos de pergunta, pontuação, avatar,
relatórios, PDF etc.), veja o `FUNCIONALIDADES.md`. Este arquivo aqui é
só sobre como configurar e publicar.

## Configuração (uma vez só)

### 1. Firebase
1. Crie um projeto em [console.firebase.google.com](https://console.firebase.google.com)
2. Ative **Firestore Database** (modo produção)
3. Ative **Authentication → método Email/senha**
4. Em Configurações do projeto → Seus apps → adicione um app Web, copie o
   objeto `firebaseConfig` e cole em `shared/firebase-config.js`
5. Em Firestore → Regras, cole o conteúdo de `firestore.rules` e publique

### 2. Contas de admin

Não existe cadastro público — só você cria as contas, em Firebase Console
→ Authentication → Users → **Add user** (um e-mail e senha por pessoa).
Cada conta só vê e controla os próprios quizzes e sessões; uma pessoa não
enxerga nem mexe no que é de outra.

### 3. Unsplash (imagens das perguntas)
1. Crie uma conta em [unsplash.com/developers](https://unsplash.com/developers)
2. Crie uma aplicação ("New Application")
3. Copie o **Access Key** e cole em `shared/unsplash-config.js`
4. O plano gratuito permite 50 buscas por hora — de sobra pra montar um quiz

### 4. Publicar (GitHub Pages)
Suba a pasta inteira num repositório e ative o GitHub Pages na raiz. Os
sites ficam em:
- `https://seuusuario.github.io/repo/admin/`
- `https://seuusuario.github.io/repo/jogo/`

Sem build step — é só HTML/CSS/JS puro.

### 5. Instalar como app (PWA)
Os dois sites podem ser instalados separadamente num tablet ou celular,
com ícone na tela e sem barra de endereço:
- **Android/Chrome:** abra o site → menu (⋮) → "Instalar app"
- **iPad/iPhone (Safari):** abra o site → Compartilhar → "Adicionar à
  Tela de Início"

## Limitação conhecida

Como não há um servidor próprio (só Firestore), a resposta certa de cada
pergunta viaja no mesmo documento que os jogadores leem — em teoria,
alguém muito curioso que já esteja numa sala poderia inspecionar a rede
do navegador e ver a resposta antes de responder. As regras do Firestore
já impedem que alguém de fora descubra códigos de salas alheias; só
dentro da própria sala, pra quem já tem o código, é que a resposta não é
100% secreta até a revelação. Pra um quiz casual isso não costuma ser
problema.
