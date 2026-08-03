import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, getDoc, getDocs, query, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig } from "../shared/firebase-config.js";
import { UNSPLASH_ACCESS_KEY } from "../shared/unsplash-config.js";
import { avatarSVG } from "../shared/avatar.js";
import { questionMaxPoints, nextQuestionScore, scoreQuestionSequence } from "../shared/scoring.js";
import { getJsPDF, addPdfHeader, addSectionTitle, AUTOTABLE_THEME } from "../shared/pdf-helpers.js";
import { parseQuizText, IMPORT_TEMPLATE } from "../shared/import-parser.js";
import { MUSIC_TRACKS, findTrack, SUGGESTED_SOURCES } from "../shared/music-tracks.js";
import { buildLeaderboardRows, GAME_MODES, TEAM_SUBMODES, GOAL_TYPES, cooperativeProgress, cooperativeMaxPoints } from "../shared/game-modes.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ---------------- estado ---------------- */
let view = "list"; // list | editor | control | sessions | report
let quizzes = [];
let unsubQuizzes = null;
let communityQuizzes = [];
let unsubCommunityQuizzes = null;
let unsubSession = null;
let unsubPlayers = null;

let quizDraft = null;      // quiz sendo criado/editado
let questionDraft = null;  // pergunta sendo criada/editada dentro do quizDraft
let questionEditingIdx = null;
let imageTarget = null;    // 'cover' | 'question' — pra saber onde a imagem escolhida no modal Unsplash vai

let sessionCode = null;
let sessionData = null;
let sessionPlayers = {};   // {id: {name}}
let revealStats = null;

let sessionsList = [];
let unsubSessionsList = null;
let reportData = null;     // relatório carregado pra exibição

let currentUser = null;    // usuário logado (dono dos quizzes/sessões)

let musicAudioEl = null;
let musicToggleEl = null;
let musicMuted = false;
let previewAudioEl = null;

const OPTION_COLORS = ["opt-0", "opt-1", "opt-2", "opt-3", "opt-4", "opt-5"];
const OPTION_SHAPES = ["opt-diamond", "opt-triangle", "opt-circle", "opt-square", "opt-pentagon", "opt-hexagon"];

const root = document.getElementById("app-root");

/* ---------------- autenticação ---------------- */
onAuthStateChanged(auth, (user) => {
  document.getElementById("login-screen").style.display = user ? "none" : "flex";
  document.getElementById("app-screen").style.display = user ? "flex" : "none";
  currentUser = user;
  if (user) {
    document.getElementById("current-user-email").textContent = user.email || "";
    view = "list";
    subscribeQuizzes();
    render();
  } else {
    unsubQuizzes && unsubQuizzes();
    unsubSession && unsubSession();
    unsubPlayers && unsubPlayers();
    unsubRaceScores && unsubRaceScores();
    unsubSessionsList && unsubSessionsList();
    unsubCommunityQuizzes && unsubCommunityQuizzes();
    quizzes = [];
    sessionsList = [];
    communityQuizzes = [];
    if (musicAudioEl) musicAudioEl.pause();
    if (musicToggleEl) musicToggleEl.style.display = "none";
  }
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errBox = document.getElementById("login-error");
  errBox.textContent = "";
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    errBox.textContent = "E-mail ou senha incorretos.";
  }
});

document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));

/* ---------------- utilidades ---------------- */
const rid = () => Math.random().toString(36).slice(2, 10);
const genCode = () => String(Math.floor(100000 + Math.random() * 900000));

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Embaralha as opções de UMA pergunta, remapeando quais índices são
// certos pra continuarem apontando pro texto certo depois da troca.
function shuffleQuestionOptions(q) {
  const order = shuffleArray(q.options.map((_, i) => i));
  const options = order.map((i) => q.options[i]);
  const correct = q.correct.map((oldIdx) => order.indexOf(oldIdx));
  return { ...q, options, correct };
}

function emptyQuestion(timeLimit = 20, image = null) {
  return { id: rid(), text: "", type: "single", options: ["", ""], correct: [], timeLimit, pointsMultiplier: 1, imageUrl: image?.url || null, imageCredit: image?.credit || null };
}
function emptyQuiz() {
  return { id: null, title: "", theme: "", coverImage: null, coverCredit: null, defaultTimeLimit: 20, musicUrl: null, precisionMode: false, comboMode: false, shuffleQuestions: false, shuffleAnswers: false, isPublic: true, questions: [] };
}

function subscribeQuizzes() {
  unsubQuizzes && unsubQuizzes();
  unsubQuizzes = onSnapshot(
    query(collection(db, "quizzes"), where("ownerId", "==", currentUser.uid)),
    (snap) => {
      quizzes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (view === "list") render();
    },
    (err) => {
      console.error("Erro ao carregar quizzes:", err);
      quizzes = [];
      if (view === "list") render();
    }
  );
}

/* ---------------- render raiz ---------------- */
function render() {
  try {
    updateMusicForSession(view === "control" ? sessionData : null);
    if (view === "list") return renderList();
    if (view === "community") return renderCommunity();
    if (view === "editor") return renderEditor();
    if (view === "launch") return renderLaunchConfig();
    if (view === "control") return renderControl();
    if (view === "sessions") return renderSessions();
    if (view === "report") return renderReport();
  } catch (err) {
    console.error("Erro ao desenhar a tela:", err);
    root.innerHTML = `
      <div class="eyebrow" style="color:var(--coral);">algo deu errado</div>
      <h1 style="font-size:20px; margin-top:6px;">Não consegui carregar essa tela</h1>
      <p style="color:var(--text-dim); margin-top:8px; font-size:13px;">Tenta recarregar a página.</p>
      <button class="btn btn-primary btn-block" id="reload-btn" style="margin-top:18px;">Recarregar</button>
    `;
    document.getElementById("reload-btn")?.addEventListener("click", () => window.location.reload());
  }
}

function navTabsHtml(active) {
  return `
    <div class="nav-tabs">
      <button class="nav-tab ${active === "list" ? "active" : ""}" id="nav-quizzes">Meus quizzes</button>
      <button class="nav-tab ${active === "community" ? "active" : ""}" id="nav-community">Comunidade</button>
      <button class="nav-tab ${active === "sessions" ? "active" : ""}" id="nav-sessions">Sessões</button>
    </div>
  `;
}
function bindNavTabs() {
  document.getElementById("nav-quizzes").onclick = () => { view = "list"; render(); };
  document.getElementById("nav-community").onclick = () => { view = "community"; subscribeCommunityQuizzes(); render(); };
  document.getElementById("nav-sessions").onclick = () => { view = "sessions"; subscribeSessionsList(); render(); };
}

/* ================= LISTA DE QUIZZES ================= */
function renderList() {
  root.innerHTML = `
    ${navTabsHtml("list")}
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px;">
      <h1 style="font-size:24px;">Meus quizzes</h1>
      <button class="btn btn-primary" id="new-quiz-btn">+ novo quiz</button>
    </div>
    <div class="quiz-grid">
      ${quizzes.map(quizCardHtml).join("") || `<div style="color:var(--text-dim); margin-top:20px;">Nenhum quiz ainda. Crie o primeiro!</div>`}
    </div>
  `;
  bindNavTabs();
  document.getElementById("new-quiz-btn").onclick = () => { quizDraft = emptyQuiz(); view = "editor"; render(); };
  quizzes.forEach((q) => {
    document.getElementById(`edit-${q.id}`)?.addEventListener("click", () => { quizDraft = JSON.parse(JSON.stringify(q)); view = "editor"; render(); });
    document.getElementById(`open-${q.id}`)?.addEventListener("click", () => openLaunchConfig(q));
    document.getElementById(`dup-${q.id}`)?.addEventListener("click", () => duplicateQuiz(q));
    document.getElementById(`del-${q.id}`)?.addEventListener("click", () => deleteQuiz(q));
  });
}

function renderCommunity() {
  root.innerHTML = `
    ${navTabsHtml("community")}
    <div style="margin-top:16px;">
      <h1 style="font-size:24px;">Comunidade</h1>
      <p style="color:var(--text-dim); font-size:13px; margin-top:4px;">Quizzes públicos de outras contas — dá pra abrir uma sala direto ou copiar pro seu acervo (a cópia começa privada, só sua).</p>
    </div>
    <div class="quiz-grid" style="margin-top:14px;">
      ${communityQuizzes.map(communityQuizCardHtml).join("") || `<div style="color:var(--text-dim); margin-top:20px;">Nenhum quiz público de outras contas ainda.</div>`}
    </div>
  `;
  bindNavTabs();
  communityQuizzes.forEach((q) => {
    document.getElementById(`copen-${q.id}`)?.addEventListener("click", () => openLaunchConfig(q));
    document.getElementById(`ccopy-${q.id}`)?.addEventListener("click", async () => {
      await duplicateQuiz(q, { fromCommunity: true });
      alert(`"${q.title}" copiado pro seu acervo (como privado). Você já pode editar em "Meus quizzes".`);
      view = "list";
      render();
    });
  });
}

function communityQuizCardHtml(q) {
  return `
    <div class="quiz-card">
      <div class="cover" style="${q.coverImage ? `background-image:url('${q.coverImage}')` : ""}"></div>
      <div class="body">
        <div class="title">${escapeHtml(q.title || "Sem título")}</div>
        <div class="theme-tag">${escapeHtml(q.theme || "sem tema")}</div>
        <div class="meta">${(q.questions || []).length} pergunta${(q.questions || []).length !== 1 ? "s" : ""}</div>
        <div class="actions">
          <button class="btn btn-primary" id="copen-${q.id}">Abrir sala</button>
          <button class="btn btn-ghost" id="ccopy-${q.id}">Copiar pro meu acervo</button>
        </div>
      </div>
    </div>
  `;
}

// Ferramenta de uso único: marca como "meus" todos os quizzes/sessões que
// ainda não têm dono (criados antes de existir o sistema de contas
// separadas). Só funciona enquanto as regras do Firestore ainda
// permitirem leitura ampla — depois de travar as regras por dono, não é
// mais necessária nem funciona.
function quizCardHtml(q) {
  return `
    <div class="quiz-card">
      <div class="cover" style="${q.coverImage ? `background-image:url('${q.coverImage}')` : ""}"></div>
      <div class="body">
        <div class="title">${escapeHtml(q.title || "Sem título")}</div>
        <div class="theme-tag">${escapeHtml(q.theme || "sem tema")} ${q.isPublic === true ? "· 🌐 público" : "· 🔒 privado"}</div>
        <div class="meta">${(q.questions || []).length} pergunta${(q.questions || []).length !== 1 ? "s" : ""}</div>
        <div class="actions">
          <button class="btn btn-primary" id="open-${q.id}">Abrir sala</button>
          <button class="btn btn-ghost" id="edit-${q.id}">Editar</button>
          <button class="btn btn-ghost" id="dup-${q.id}">Duplicar</button>
          <button class="btn btn-ghost" id="del-${q.id}">Excluir</button>
        </div>
      </div>
    </div>
  `;
}

async function deleteQuiz(q) {
  if (!confirm(`Excluir "${q.title}"? Isso não apaga salas já jogadas, só o modelo do quiz.`)) return;
  await deleteDoc(doc(db, "quizzes", q.id));
}

async function duplicateQuiz(q, opts = {}) {
  const copy = JSON.parse(JSON.stringify(q));
  delete copy.id;
  copy.title = opts.fromCommunity ? q.title : `${q.title} (cópia)`;
  copy.questions = (copy.questions || []).map((item) => ({ ...item, id: rid() }));
  const payload = {
    title: copy.title,
    theme: copy.theme || "",
    ownerId: currentUser.uid,
    coverImage: copy.coverImage || null,
    coverCredit: copy.coverCredit || null,
    defaultTimeLimit: copy.defaultTimeLimit || 20,
    musicUrl: copy.musicUrl || null,
    precisionMode: !!copy.precisionMode,
    comboMode: !!copy.comboMode,
    shuffleQuestions: !!copy.shuffleQuestions,
    shuffleAnswers: !!copy.shuffleAnswers,
    // copiando de outra pessoa: começa privado por padrão (o dono novo
    // decide se quer publicar); duplicando o próprio quiz: mantém como
    // já estava
    isPublic: opts.fromCommunity ? false : (copy.isPublic === true),
    questions: copy.questions,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, "quizzes"), payload);
  quizDraft = { ...payload, id: ref.id, createdAt: null, updatedAt: null };
  if (!opts.fromCommunity) {
    view = "editor";
    render();
  }
}

let launchQuiz = null;
let launchConfig = null;

function defaultLaunchConfig() {
  return {
    gameMode: "classico",
    teamSubmode: "individual",
    teams: ["Time Azul", "Time Vermelho"],
    cooperativeGoal: { type: "none", value: 0 },
    raceSubmode: "sync",
    raceWindowValue: 24,
    raceWindowUnit: "horas",
  };
}

function openLaunchConfig(quiz) {
  launchQuiz = quiz;
  launchConfig = defaultLaunchConfig();
  view = "launch";
  render();
}

async function launchSession(quiz, config) {
  let code = genCode();
  // evita colisão de código (raro, mas confere)
  let existing = await getDoc(doc(db, "sessions", code));
  while (existing.exists()) {
    code = genCode();
    existing = await getDoc(doc(db, "sessions", code));
  }
  let questions = JSON.parse(JSON.stringify(quiz.questions));
  if (quiz.shuffleQuestions) questions = shuffleArray(questions);
  if (quiz.shuffleAnswers) questions = questions.map(shuffleQuestionOptions);
  const gameMode = config.gameMode || "classico";
  const isTeams = gameMode === "equipes";
  const session = {
    quizId: quiz.id,
    title: quiz.title,
    ownerId: currentUser.uid,
    status: "lobby",
    questions,
    musicUrl: quiz.musicUrl || null,
    precisionMode: !!quiz.precisionMode,
    comboMode: !!quiz.comboMode,
    gameMode,
    teamMode: isTeams,
    teamSubmode: isTeams ? (config.teamSubmode || "individual") : null,
    teams: isTeams ? (config.teams || []).filter((t) => t.trim()) : [],
    cooperativeGoal: gameMode === "cooperativo" ? config.cooperativeGoal : null,
    eliminatedPlayerIds: [],
    raceDurationSec: questions.reduce((sum, q) => sum + (q.timeLimit || 20), 0),
    raceStartedAt: null,
    raceSubmode: gameMode === "corrida" ? (config.raceSubmode || "sync") : null,
    raceWindowMs: gameMode === "corrida" && config.raceSubmode === "async"
      ? config.raceWindowValue * (config.raceWindowUnit === "dias" ? 86400000 : 3600000)
      : null,
    raceWindowEndsAt: null,
    currentIndex: -1,
    questionStartedAt: null,
    createdAt: serverTimestamp(),
    leaderboardTop: [],
    finalLeaderboard: [],
  };
  await setDoc(doc(db, "sessions", code), session);
  openControl(code);
}

/* ================= CONFIGURAÇÃO AO ABRIR SALA ================= */
const GAME_MODE_HINTS = {
  classico: "Ritmo normal: pergunta, revelação, placar, próxima.",
  equipes: "Jogadores entram escolhendo um time; o placar soma por equipe.",
  sobrevivencia: "Quem responde errado (ou não responde) é eliminado e vira espectador — mesmo que isso zere todo mundo de uma vez.",
  cooperativo: "Não tem ranking individual — todo mundo soma pra um placar coletivo só.",
  corrida: "Sem revelação entre perguntas: cada jogador responde a próxima pergunta assim que termina a atual, no seu próprio ritmo, até o tempo total acabar.",
  blefe: "Cada pergunta vira uma rodada de blefe: todo mundo escreve uma resposta falsa convincente, depois vota em qual acha que é a verdadeira. Pontua quem acerta e quem engana os outros.",
};

function renderLaunchConfig() {
  const c = launchConfig;
  root.innerHTML = `
    <button class="btn-link" id="launch-back">← voltar</button>
    <div class="eyebrow" style="margin-top:10px;">abrir sala</div>
    <h1 style="font-size:22px; margin-top:4px;">${escapeHtml(launchQuiz.title)}</h1>

    <div style="margin-top:18px;">
      <label style="font-size:13px; color:var(--text-dim);">Modo de jogo</label>
      <select class="input" id="launch-mode" style="margin-top:6px;">
        ${GAME_MODES.map((m) => `<option value="${m.id}" ${c.gameMode === m.id ? "selected" : ""}>${m.label}</option>`).join("")}
      </select>
      <div style="font-size:11px; color:var(--text-dim); margin-top:6px;">${GAME_MODE_HINTS[c.gameMode] || ""}</div>
    </div>

    <div id="launch-teams-config" style="display:${c.gameMode === "equipes" ? "block" : "none"}; margin-top:16px;">
      <label style="font-size:13px; color:var(--text-dim);">Como o time responde</label>
      <select class="input" id="launch-team-submode" style="margin-top:6px; margin-bottom:12px;">
        ${TEAM_SUBMODES.map((m) => `<option value="${m.id}" ${c.teamSubmode === m.id ? "selected" : ""}>${m.label}</option>`).join("")}
      </select>
      <label style="font-size:13px; color:var(--text-dim);">Times</label>
      <div id="launch-team-names" style="display:flex; flex-direction:column; gap:6px; margin-top:6px;">
        ${c.teams.map((t, i) => `
          <div style="display:flex; gap:6px;">
            <input class="input" data-team="${i}" value="${escapeAttr(t)}" maxlength="24" placeholder="Nome do time" style="flex:1;" />
            ${c.teams.length > 2 ? `<button type="button" class="btn-link" data-team-remove="${i}">✕</button>` : ""}
          </div>
        `).join("")}
        ${c.teams.length < 6 ? `<button type="button" class="btn-link" id="launch-team-add" style="align-self:flex-start;">+ adicionar time</button>` : ""}
      </div>
    </div>

    <div id="launch-coop-config" style="display:${c.gameMode === "cooperativo" ? "block" : "none"}; margin-top:16px;">
      <label style="font-size:13px; color:var(--text-dim);">Meta do grupo (opcional)</label>
      <div style="display:flex; gap:8px; margin-top:6px;">
        <select class="input" id="launch-goal-type" style="flex:1;">
          ${GOAL_TYPES.map((g) => `<option value="${g.id}" ${c.cooperativeGoal.type === g.id ? "selected" : ""}>${g.label}</option>`).join("")}
        </select>
        <input class="input" type="number" min="0" id="launch-goal-value" value="${c.cooperativeGoal.value || ""}" placeholder="${c.cooperativeGoal.type === "percent" ? "% ex: 80" : "pontos ex: 5000"}" style="width:120px; display:${c.cooperativeGoal.type === "none" ? "none" : "block"};" />
      </div>
      <div style="font-size:11px; color:var(--text-dim); margin-top:6px;">Máximo possível deste quiz: ${cooperativeMaxPoints(launchQuiz.questions)} pontos.</div>
    </div>

    <div id="launch-race-config" style="display:${c.gameMode === "corrida" ? "block" : "none"}; margin-top:16px;">
      <label style="font-size:13px; color:var(--text-dim);">Como a corrida funciona</label>
      <select class="input" id="launch-race-submode" style="margin-top:6px; margin-bottom:10px;">
        <option value="sync" ${c.raceSubmode === "sync" ? "selected" : ""}>Todo mundo começa junto (tempo compartilhado)</option>
        <option value="async" ${c.raceSubmode === "async" ? "selected" : ""}>Sala aberta por um período — cada um joga quando quiser</option>
      </select>
      <div id="launch-race-window" style="display:${c.raceSubmode === "async" ? "flex" : "none"}; gap:8px; align-items:center;">
        <span style="font-size:13px; color:var(--text-dim);">Sala fica aberta por</span>
        <input class="input" type="number" min="1" id="launch-race-window-value" value="${c.raceWindowValue}" style="width:80px;" />
        <select class="input" id="launch-race-window-unit" style="width:110px;">
          <option value="horas" ${c.raceWindowUnit === "horas" ? "selected" : ""}>horas</option>
          <option value="dias" ${c.raceWindowUnit === "dias" ? "selected" : ""}>dias</option>
        </select>
      </div>
      <div style="font-size:11px; color:var(--text-dim); margin-top:6px;">
        ${c.raceSubmode === "async"
          ? `Cada jogador tem ${(launchQuiz.questions || []).reduce((sum, q) => sum + (q.timeLimit || 20), 0)}s pra responder tudo, a partir do momento em que ele mesmo começar — dentro da janela que você definir. Dá pra fechar antes ou estender depois, enquanto a janela não tiver acabado.`
          : "Um único cronômetro compartilhado começa quando você clicar em \"Começar corrida\"."}
      </div>
    </div>

    <button class="btn btn-success btn-block" id="launch-confirm" style="margin-top:24px;">Abrir sala →</button>
  `;

  document.getElementById("launch-back").onclick = () => { view = "list"; render(); };
  document.getElementById("launch-mode").onchange = (e) => { c.gameMode = e.target.value; renderLaunchConfig(); };
  document.getElementById("launch-team-submode")?.addEventListener("change", (e) => (c.teamSubmode = e.target.value));
  document.querySelectorAll("[data-team]").forEach((input) => {
    input.oninput = (e) => { c.teams[Number(input.dataset.team)] = e.target.value; };
  });
  document.querySelectorAll("[data-team-remove]").forEach((btn) => {
    btn.onclick = () => { c.teams.splice(Number(btn.dataset.teamRemove), 1); renderLaunchConfig(); };
  });
  document.getElementById("launch-team-add")?.addEventListener("click", () => {
    c.teams.push(`Time ${c.teams.length + 1}`);
    renderLaunchConfig();
  });
  document.getElementById("launch-goal-type")?.addEventListener("change", (e) => {
    c.cooperativeGoal.type = e.target.value;
    renderLaunchConfig();
  });
  document.getElementById("launch-goal-value")?.addEventListener("input", (e) => {
    c.cooperativeGoal.value = Number(e.target.value) || 0;
  });
  document.getElementById("launch-race-submode")?.addEventListener("change", (e) => {
    c.raceSubmode = e.target.value;
    renderLaunchConfig();
  });
  document.getElementById("launch-race-window-value")?.addEventListener("input", (e) => {
    c.raceWindowValue = Math.max(1, Number(e.target.value) || 1);
  });
  document.getElementById("launch-race-window-unit")?.addEventListener("change", (e) => {
    c.raceWindowUnit = e.target.value;
  });
  document.getElementById("launch-confirm").onclick = () => launchSession(launchQuiz, c);
}

/* ================= EDITOR DE QUIZ ================= */
function renderEditor() {
  const q = quizDraft;
  root.innerHTML = `
    <button class="btn-link" id="back-btn">← voltar</button>

    <div class="image-picker" style="margin-top:14px;">
      <div class="preview" id="cover-preview" style="${q.coverImage ? `background-image:url('${q.coverImage}')` : ""}"></div>
      <div>
        <button class="btn btn-ghost" id="cover-pick-btn" type="button">Escolher imagem de capa</button>
        ${q.coverCredit ? `<div class="image-credit">Foto: <a href="${q.coverCredit.link}" target="_blank">${escapeHtml(q.coverCredit.name)}</a> / Unsplash</div>` : ""}
      </div>
    </div>

    <input class="input" id="quiz-title" placeholder="Título do quiz" value="${escapeAttr(q.title)}" style="font-family:var(--font-display); font-size:20px; font-weight:700; margin-bottom:10px;" />
    <input class="input" id="quiz-theme" placeholder="Tema (ex: Escatologia, História, Diversão)" value="${escapeAttr(q.theme)}" style="margin-bottom:10px;" />

    <label style="display:flex; align-items:center; gap:8px; margin-bottom:20px; font-size:13px; color:var(--text-dim); cursor:pointer;">
      <input type="checkbox" id="quiz-public" ${q.isPublic === true ? "checked" : ""} />
      <span><b style="color:var(--text);">Quiz público</b> — outras contas de admin podem ver, jogar e copiar esse quiz (desmarque pra deixar só seu)</span>
    </label>

    <div style="display:flex; align-items:center; gap:10px; margin-bottom:20px;">
      <label style="font-size:13px; color:var(--text-dim); white-space:nowrap;">Tempo padrão por pergunta</label>
      <input class="input" type="number" id="quiz-default-time" min="5" max="60" value="${q.defaultTimeLimit || 20}" style="width:70px;" />
      <span style="font-size:13px; color:var(--text-dim);">s</span>
      <button type="button" class="btn-link" id="apply-time-all" style="margin-left:auto;">aplicar a todas as perguntas já criadas</button>
    </div>

    <div style="margin-bottom:20px;">
      <label style="font-size:13px; color:var(--text-dim);">Trilha sonora (opcional)</label>
      <select class="input" id="quiz-music-preset" style="margin-top:6px;">
        <option value="">— escolher uma faixa pronta —</option>
        ${MUSIC_TRACKS.map((t) => `<option value="${t.id}" ${q.musicUrl === t.url ? "selected" : ""}>${t.label}</option>`).join("")}
        <option value="custom" ${q.musicUrl && !MUSIC_TRACKS.some((t) => t.url === q.musicUrl) ? "selected" : ""}>link personalizado (colar abaixo)</option>
      </select>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <input class="input" id="quiz-music" placeholder="Ou cole o link direto de um arquivo .mp3 ou .ogg" value="${escapeAttr(q.musicUrl || "")}" style="flex:1;" />
        <button type="button" class="btn btn-ghost" id="music-test-btn" style="width:auto; padding:10px 16px; white-space:nowrap;">▶ testar</button>
      </div>
      <div id="music-test-result" style="font-size:12px; margin-top:6px;"></div>
      <div style="font-size:11px; color:var(--text-dim); margin-top:6px;">
        Mais opções: ${SUGGESTED_SOURCES.map((s) => `<a href="${s.url}" target="_blank" style="color:var(--gold); margin-left:4px;">${s.mood}</a>`).join(" ·")}
      </div>
    </div>

    <label style="display:flex; align-items:center; gap:8px; margin-bottom:10px; font-size:13px; color:var(--text-dim); cursor:pointer;">
      <input type="checkbox" id="quiz-precision" ${q.precisionMode ? "checked" : ""} />
      <span><b style="color:var(--text);">Modo de Precisão</b> — pontuação só pelo acerto (1000 pontos fixos), sem contar velocidade</span>
    </label>

    <label style="display:flex; align-items:center; gap:8px; margin-bottom:10px; font-size:13px; color:var(--text-dim); cursor:pointer;">
      <input type="checkbox" id="quiz-combo" ${q.comboMode ? "checked" : ""} />
      <span><b style="color:var(--text);">Modo Combo</b> — acertar perguntas seguidas acumula um bônus extra de pontos (desligado por padrão)</span>
    </label>

    <label style="display:flex; align-items:center; gap:8px; margin-bottom:10px; font-size:13px; color:var(--text-dim); cursor:pointer;">
      <input type="checkbox" id="quiz-shuffle-questions" ${q.shuffleQuestions ? "checked" : ""} />
      <span><b style="color:var(--text);">Embaralhar perguntas</b> — sorteia uma ordem diferente toda vez que a sala é aberta</span>
    </label>

    <label style="display:flex; align-items:center; gap:8px; margin-bottom:20px; font-size:13px; color:var(--text-dim); cursor:pointer;">
      <input type="checkbox" id="quiz-shuffle-answers" ${q.shuffleAnswers ? "checked" : ""} />
      <span><b style="color:var(--text);">Embaralhar respostas</b> — sorteia a ordem das opções de cada pergunta toda vez que a sala é aberta</span>
    </label>

    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
      <div style="font-weight:700; font-family:var(--font-display);">Perguntas</div>
      <button type="button" class="btn btn-ghost" id="open-import-btn" style="width:auto; padding:8px 14px; font-size:13px;">Importar perguntas</button>
    </div>

    <div id="question-list"></div>

    ${questionEditingIdx === null ? `
    <div class="card" style="margin-top:6px;">
      <div style="font-weight:700; margin-bottom:12px; font-family:var(--font-display);">Nova pergunta</div>
      <div id="question-form"></div>
    </div>` : ""}

    <button class="btn btn-success btn-block" id="save-quiz-btn" style="margin-top:22px;">Salvar quiz</button>
    <div id="editor-error" class="error-text"></div>
  `;

  document.getElementById("back-btn").onclick = () => { view = "list"; render(); };
  document.getElementById("quiz-title").oninput = (e) => (q.title = e.target.value);
  document.getElementById("quiz-theme").oninput = (e) => (q.theme = e.target.value);
  document.getElementById("quiz-public").onchange = (e) => (q.isPublic = e.target.checked);
  document.getElementById("quiz-default-time").oninput = (e) => {
    q.defaultTimeLimit = Math.max(5, Math.min(60, Number(e.target.value) || 20));
  };
  document.getElementById("apply-time-all").onclick = () => {
    q.questions.forEach((item) => (item.timeLimit = q.defaultTimeLimit || 20));
    if (questionDraft) questionDraft.timeLimit = q.defaultTimeLimit || 20;
    renderEditor();
  };
  document.getElementById("cover-pick-btn").onclick = () => openUnsplash("cover");
  document.getElementById("save-quiz-btn").onclick = saveQuiz;
  document.getElementById("open-import-btn").onclick = openImportModal;
  document.getElementById("quiz-music-preset").onchange = (e) => {
    const val = e.target.value;
    if (val === "custom" || val === "") return;
    const track = findTrack(val);
    if (track) {
      q.musicUrl = track.url;
      document.getElementById("quiz-music").value = track.url;
      document.getElementById("music-test-result").innerHTML = "";
    }
  };
  document.getElementById("quiz-music").oninput = (e) => {
    q.musicUrl = e.target.value.trim() || null;
    document.getElementById("quiz-music-preset").value = "custom";
  };
  document.getElementById("music-test-btn").onclick = () => testMusic(document.getElementById("quiz-music").value.trim());
  document.getElementById("quiz-precision").onchange = (e) => (q.precisionMode = e.target.checked);
  document.getElementById("quiz-combo").onchange = (e) => (q.comboMode = e.target.checked);
  document.getElementById("quiz-shuffle-questions").onchange = (e) => (q.shuffleQuestions = e.target.checked);
  document.getElementById("quiz-shuffle-answers").onchange = (e) => (q.shuffleAnswers = e.target.checked);

  renderQuestionList();
  if (!questionDraft) questionDraft = emptyQuestion(q.defaultTimeLimit || 20, quizDraft.defaultQuestionImage);
  renderQuestionForm();
}

function renderQuestionList() {
  const q = quizDraft;
  const el = document.getElementById("question-list");
  if (!q.questions.length && questionEditingIdx === null) {
    el.innerHTML = `<div style="color:var(--text-dim); margin-bottom:16px; font-size:13px;">Nenhuma pergunta ainda — adicione abaixo.</div>`;
    return;
  }
  el.innerHTML = q.questions.map((item, i) => {
    if (i === questionEditingIdx) {
      return `
        <div class="card" style="margin-bottom:10px; border-color:var(--gold);">
          <div style="font-weight:700; margin-bottom:12px; font-family:var(--font-display); color:var(--gold);">Editando pergunta ${i + 1}</div>
          <div id="question-form"></div>
        </div>
      `;
    }
    return `
    <div class="q-row">
      ${item.imageUrl ? `<img src="${item.imageUrl}" />` : ""}
      <div class="info">
        <div class="meta">${i + 1}. ${typeLabel(item.type)} · ${item.timeLimit}s${item.pointsMultiplier > 1 ? ` · <span style="color:var(--gold);">bônus ${item.pointsMultiplier}x</span>` : ""}</div>
        <div class="text">${escapeHtml(item.text)}</div>
      </div>
      <div class="reorder-btns">
        <button class="btn-link" id="qup-${i}" ${i === 0 ? "disabled" : ""} title="mover pra cima">▲</button>
        <button class="btn-link" id="qdown-${i}" ${i === q.questions.length - 1 ? "disabled" : ""} title="mover pra baixo">▼</button>
      </div>
      <button class="btn-link" id="qedit-${i}">editar</button>
      <button class="btn-link" id="qdup-${i}">duplicar</button>
      <button class="btn-link" id="qdel-${i}" style="color:var(--coral);">excluir</button>
    </div>
  `;
  }).join("");
  q.questions.forEach((_, i) => {
    if (i === questionEditingIdx) return;
    document.getElementById(`qedit-${i}`).onclick = () => {
      questionDraft = JSON.parse(JSON.stringify(q.questions[i]));
      questionEditingIdx = i;
      renderEditor();
    };
    document.getElementById(`qdup-${i}`).onclick = () => {
      const copy = { ...JSON.parse(JSON.stringify(q.questions[i])), id: rid() };
      q.questions.splice(i + 1, 0, copy);
      if (questionEditingIdx !== null && i < questionEditingIdx) questionEditingIdx += 1;
      renderEditor();
    };
    document.getElementById(`qup-${i}`).onclick = () => moveQuestion(i, i - 1);
    document.getElementById(`qdown-${i}`).onclick = () => moveQuestion(i, i + 1);
    document.getElementById(`qdel-${i}`).onclick = () => {
      q.questions.splice(i, 1);
      if (questionEditingIdx !== null && i < questionEditingIdx) questionEditingIdx -= 1;
      renderEditor();
    };
  });
}

function moveQuestion(i, target) {
  const list = quizDraft.questions;
  if (target < 0 || target >= list.length) return;
  [list[i], list[target]] = [list[target], list[i]];
  if (questionEditingIdx === i) questionEditingIdx = target;
  else if (questionEditingIdx === target) questionEditingIdx = i;
  renderEditor();
}

function typeLabel(t) {
  return t === "tf" ? "V/F" : t === "multiple" ? "múltipla escolha" : "escolha única";
}

function renderQuestionForm() {
  const d = questionDraft;
  const el = document.getElementById("question-form");
  el.innerHTML = `
    <div class="image-picker">
      <div class="preview" id="q-img-preview" style="${d.imageUrl ? `background-image:url('${d.imageUrl}')` : ""}"></div>
      <div>
        <button class="btn btn-ghost" id="q-img-pick" type="button">${d.imageUrl ? "Trocar imagem" : "Adicionar imagem (opcional)"}</button>
        ${d.imageUrl ? `<button class="btn-link" id="q-img-remove" style="color:var(--coral);">remover</button>` : ""}
        ${d.imageUrl && quizDraft.questions.length > 0 ? `<button type="button" class="btn-link" id="q-img-apply-all">usar em todas as perguntas</button>` : ""}
        ${d.imageCredit ? `<div class="image-credit">Foto: <a href="${d.imageCredit.link}" target="_blank">${escapeHtml(d.imageCredit.name)}</a> / Unsplash</div>` : ""}
      </div>
    </div>
    <div id="q-img-apply-result" style="font-size:11px; color:var(--green); margin:-6px 0 10px;"></div>

    <textarea class="input" id="q-text" placeholder="Escreva a pergunta..." maxlength="150" style="min-height:60px; margin-bottom:4px;">${escapeHtml(d.text)}</textarea>
    <div id="q-text-count" style="text-align:right; font-size:11px; color:var(--text-dim); margin-bottom:8px;">${d.text.length}/150</div>

    <div style="display:flex; gap:10px; margin-bottom:12px; flex-wrap:wrap;">
      <select class="input" id="q-type" style="flex:0 1 180px; min-width:150px;">
        <option value="single" ${d.type === "single" ? "selected" : ""}>Escolha única</option>
        <option value="multiple" ${d.type === "multiple" ? "selected" : ""}>Múltipla escolha</option>
        <option value="tf" ${d.type === "tf" ? "selected" : ""}>Verdadeiro ou Falso</option>
      </select>
      <div style="display:flex; align-items:center; gap:8px; color:var(--text-dim); font-size:13px;">
        <span>tempo (s)</span>
        <input class="input" type="number" id="q-time" min="5" max="60" value="${d.timeLimit}" style="width:70px;" />
      </div>
      <div style="display:flex; align-items:center; gap:8px; color:var(--text-dim); font-size:13px;">
        <span>pontuação</span>
        <select class="input" id="q-multiplier" style="width:135px; padding-right:8px;">
          <option value="1" ${(d.pointsMultiplier || 1) === 1 ? "selected" : ""}>1x normal</option>
          <option value="2" ${(d.pointsMultiplier || 1) === 2 ? "selected" : ""}>2x bônus</option>
          <option value="3" ${(d.pointsMultiplier || 1) === 3 ? "selected" : ""}>3x bônus</option>
        </select>
      </div>
    </div>

    <div id="q-options"></div>
    ${d.type !== "tf" ? `<button class="btn-link" id="q-add-opt">+ adicionar opção</button>` : ""}

    <div id="q-error" class="error-text"></div>

    <div style="display:flex; gap:10px; margin-top:14px;">
      <button class="btn btn-primary" id="q-save" style="flex:1;">${questionEditingIdx === null ? "Adicionar pergunta" : "Salvar alterações"}</button>
      ${questionEditingIdx !== null ? `<button class="btn btn-ghost" id="q-cancel">cancelar</button>` : ""}
    </div>
  `;

  renderOptionRows();

  document.getElementById("q-img-pick").onclick = () => openUnsplash("question");
  document.getElementById("q-img-remove")?.addEventListener("click", () => { d.imageUrl = null; d.imageCredit = null; renderQuestionForm(); });
  document.getElementById("q-img-apply-all")?.addEventListener("click", () => {
    quizDraft.questions.forEach((item) => { item.imageUrl = d.imageUrl; item.imageCredit = d.imageCredit; });
    quizDraft.defaultQuestionImage = { url: d.imageUrl, credit: d.imageCredit };
    renderQuestionList();
    renderQuestionForm();
    document.getElementById("q-img-apply-result").textContent = `✓ imagem aplicada às ${quizDraft.questions.length} pergunta(s) já cadastradas — e as próximas já nascem com ela também.`;
  });
  document.getElementById("q-text").oninput = (e) => {
    d.text = e.target.value;
    document.getElementById("q-text-count").textContent = `${d.text.length}/150`;
  };
  document.getElementById("q-time").oninput = (e) => (d.timeLimit = Math.max(5, Math.min(60, Number(e.target.value) || 20)));
  document.getElementById("q-multiplier").onchange = (e) => (d.pointsMultiplier = Number(e.target.value) || 1);
  document.getElementById("q-type").onchange = (e) => {
    d.type = e.target.value;
    d.correct = [];
    if (d.type === "tf") d.options = ["Verdadeiro", "Falso"];
    else if (d.options.length < 2) d.options = ["", ""];
    renderQuestionForm();
  };
  document.getElementById("q-add-opt")?.addEventListener("click", () => {
    if (d.options.length < 6) { d.options.push(""); renderQuestionForm(); }
  });
  document.getElementById("q-save").onclick = saveQuestionDraft;
  document.getElementById("q-cancel")?.addEventListener("click", () => {
    questionDraft = emptyQuestion(quizDraft.defaultTimeLimit || 20, quizDraft.defaultQuestionImage);
    questionEditingIdx = null;
    renderEditor();
  });
}

function moveOption(i, delta) {
  const d = questionDraft;
  const target = i + delta;
  if (target < 0 || target >= d.options.length) return;
  [d.options[i], d.options[target]] = [d.options[target], d.options[i]];
  d.correct = d.correct.map((c) => (c === i ? target : c === target ? i : c));
  renderOptionRows();
}

function renderOptionRows() {
  const d = questionDraft;
  const el = document.getElementById("q-options");
  if (d.type === "tf") {
    el.innerHTML = `
      <div style="display:flex; gap:10px; margin-bottom:10px;">
        ${["Verdadeiro", "Falso"].map((label, i) => `
          <button type="button" class="btn ${d.correct.includes(i) ? "btn-success" : "btn-ghost"}" style="flex:1;" data-tf="${i}">${label}</button>
        `).join("")}
      </div>`;
    el.querySelectorAll("[data-tf]").forEach((btn) => {
      btn.onclick = () => { d.correct = [Number(btn.dataset.tf)]; renderOptionRows(); };
    });
    return;
  }
  el.innerHTML = d.options.map((opt, i) => `
    <div class="opt-row">
      <span class="swatch ${OPTION_COLORS[i % 6]}"><span class="${OPTION_SHAPES[i % 6]}" style="width:11px;height:11px;"></span></span>
      <input class="input" data-opt="${i}" placeholder="Opção ${i + 1}" maxlength="80" value="${escapeAttr(opt)}" style="flex:1;" />
      <label class="check-label"><input type="checkbox" data-correct="${i}" ${d.correct.includes(i) ? "checked" : ""}/> certa</label>
      <button type="button" class="btn-link" data-moveup="${i}" ${i === 0 ? "disabled" : ""} title="mover pra cima">▲</button>
      <button type="button" class="btn-link" data-movedown="${i}" ${i === d.options.length - 1 ? "disabled" : ""} title="mover pra baixo">▼</button>
      ${d.options.length > 2 ? `<button type="button" class="btn-link" data-remove="${i}">✕</button>` : ""}
    </div>
  `).join("");
  el.querySelectorAll("[data-opt]").forEach((input) => {
    input.oninput = (e) => { d.options[Number(input.dataset.opt)] = e.target.value; };
  });
  el.querySelectorAll("[data-correct]").forEach((cb) => {
    cb.onchange = (e) => {
      const i = Number(cb.dataset.correct);
      if (e.target.checked) {
        if (d.type === "single") d.correct = [i];
        else d.correct.push(i);
      } else {
        d.correct = d.correct.filter((x) => x !== i);
      }
      renderOptionRows();
    };
  });
  el.querySelectorAll("[data-moveup]").forEach((btn) => {
    btn.onclick = () => moveOption(Number(btn.dataset.moveup), -1);
  });
  el.querySelectorAll("[data-movedown]").forEach((btn) => {
    btn.onclick = () => moveOption(Number(btn.dataset.movedown), 1);
  });
  el.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.remove);
      d.options.splice(i, 1);
      d.correct = d.correct.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x));
      renderOptionRows();
    };
  });
}

function saveQuestionDraft() {
  const d = questionDraft;
  const errEl = document.getElementById("q-error");
  const text = d.text.trim();
  if (!text) return (errEl.textContent = "Escreva o texto da pergunta.");
  const clean = { ...d, text };
  if (clean.type === "tf") {
    clean.options = ["Verdadeiro", "Falso"];
    if (clean.correct.length !== 1) return (errEl.textContent = "Marque a resposta certa.");
  } else {
    const opts = clean.options.map((o) => o.trim()).filter(Boolean);
    if (opts.length < 2) return (errEl.textContent = "Adicione pelo menos 2 opções.");
    clean.options = opts;
    clean.correct = clean.correct.filter((i) => i < opts.length);
    if (clean.correct.length === 0) return (errEl.textContent = "Marque ao menos uma resposta certa.");
    if (clean.type === "single" && clean.correct.length > 1) return (errEl.textContent = "Esse tipo aceita só 1 certa. Use 'múltipla escolha' pra mais de uma.");
  }
  errEl.textContent = "";
  if (questionEditingIdx === null) quizDraft.questions.push(clean);
  else quizDraft.questions[questionEditingIdx] = clean;
  questionDraft = emptyQuestion(quizDraft.defaultTimeLimit || 20, quizDraft.defaultQuestionImage);
  questionEditingIdx = null;
  renderEditor();
}

async function saveQuiz() {
  const q = quizDraft;
  const errEl = document.getElementById("editor-error");
  if (!q.title.trim()) return (errEl.textContent = "Dê um título ao quiz.");
  if (q.questions.length === 0) return (errEl.textContent = "Adicione ao menos uma pergunta.");
  errEl.textContent = "";
  const payload = { title: q.title.trim(), theme: q.theme.trim(), coverImage: q.coverImage, coverCredit: q.coverCredit, defaultTimeLimit: q.defaultTimeLimit || 20, musicUrl: q.musicUrl || null, precisionMode: !!q.precisionMode, comboMode: !!q.comboMode, shuffleQuestions: !!q.shuffleQuestions, shuffleAnswers: !!q.shuffleAnswers, isPublic: q.isPublic === true, questions: q.questions, updatedAt: serverTimestamp() };
  if (q.id) {
    await updateDoc(doc(db, "quizzes", q.id), payload);
  } else {
    await addDoc(collection(db, "quizzes"), { ...payload, ownerId: currentUser.uid, createdAt: serverTimestamp() });
  }
  view = "list";
  render();
}

/* ================= IMPORTAR PERGUNTAS ================= */
let importResult = null;

function openImportModal() {
  importResult = null;
  document.getElementById("import-modal").style.display = "flex";
  document.getElementById("import-template-preview").textContent = IMPORT_TEMPLATE;
  document.getElementById("import-textarea").value = "";
  document.getElementById("import-step-paste").style.display = "block";
  document.getElementById("import-step-preview").style.display = "none";
}
document.getElementById("import-close").onclick = () => (document.getElementById("import-modal").style.display = "none");
document.getElementById("import-copy-template").onclick = async () => {
  try {
    await navigator.clipboard.writeText(IMPORT_TEMPLATE);
    const btn = document.getElementById("import-copy-template");
    const original = btn.textContent;
    btn.textContent = "copiado!";
    setTimeout(() => (btn.textContent = original), 1500);
  } catch { /* clipboard indisponível, sem problema */ }
};
document.getElementById("import-back-btn").onclick = () => {
  document.getElementById("import-step-paste").style.display = "block";
  document.getElementById("import-step-preview").style.display = "none";
};
document.getElementById("import-convert-btn").onclick = () => {
  const raw = document.getElementById("import-textarea").value;
  importResult = parseQuizText(raw);
  renderImportPreview();
  document.getElementById("import-step-paste").style.display = "none";
  document.getElementById("import-step-preview").style.display = "block";
};
document.getElementById("import-confirm-btn").onclick = () => {
  if (!importResult || importResult.questions.length === 0) return;
  const defaultTime = quizDraft.defaultTimeLimit || 20;
  importResult.questions.forEach((qq) => {
    if (!qq.timeLimit) qq.timeLimit = defaultTime;
    quizDraft.questions.push(qq);
  });
  document.getElementById("import-modal").style.display = "none";
  renderEditor();
};

function renderImportPreview() {
  const { questions, warnings } = importResult;
  document.getElementById("import-summary").innerHTML =
    `<b style="color:var(--gold);">${questions.length}</b> pergunta${questions.length !== 1 ? "s" : ""} reconhecida${questions.length !== 1 ? "s" : ""}` +
    (warnings.length ? `, <b style="color:var(--coral);">${warnings.length}</b> ignorada${warnings.length !== 1 ? "s" : ""}` : "");

  document.getElementById("import-warnings").innerHTML = warnings.length
    ? `<div style="background:var(--bg2); border:1px solid var(--surface-line); border-radius:10px; padding:10px; font-size:12px; color:var(--coral);">${warnings.map(escapeHtml).join("<br>")}</div>`
    : "";

  document.getElementById("import-preview-list").innerHTML = questions.map((qq, i) => `
    <div class="q-row">
      <div class="info">
        <div class="meta">${i + 1}. ${typeLabel(qq.type)}${qq.pointsMultiplier > 1 ? ` · bônus ${qq.pointsMultiplier}x` : ""}</div>
        <div class="text">${escapeHtml(qq.text)}</div>
        <div class="meta" style="margin-top:2px;">${qq.options.map((o, oi) => `${qq.correct.includes(oi) ? "✓ " : ""}${escapeHtml(o)}`).join(" · ")}</div>
      </div>
    </div>
  `).join("") || `<div style="color:var(--text-dim); font-size:13px;">Nenhuma pergunta reconhecida — confira o formato e tenta de novo.</div>`;

  document.getElementById("import-confirm-btn").disabled = questions.length === 0;
}

/* ================= MÚSICA ================= */
function testMusic(url) {
  const resultEl = document.getElementById("music-test-result");
  if (previewAudioEl) { previewAudioEl.pause(); previewAudioEl = null; }
  if (!url) { resultEl.innerHTML = `<span style="color:var(--coral);">Cole um link primeiro.</span>`; return; }
  resultEl.innerHTML = `<span style="color:var(--text-dim);">carregando...</span>`;
  previewAudioEl = new Audio(url);
  previewAudioEl.volume = 0.5;
  previewAudioEl.addEventListener("canplaythrough", () => {
    resultEl.innerHTML = `<span style="color:var(--green);">✓ tocando! esse link funciona.</span>`;
  }, { once: true });
  previewAudioEl.addEventListener("error", () => {
    resultEl.innerHTML = `<span style="color:var(--coral);">✕ não consegui carregar esse link. Confira se é a URL direta do arquivo de áudio (termina em .mp3/.ogg), não a página do site.</span>`;
  }, { once: true });
  previewAudioEl.play().catch(() => {
    resultEl.innerHTML = `<span style="color:var(--coral);">✕ o navegador bloqueou a reprodução ou o link não é um áudio válido.</span>`;
  });
  setTimeout(() => { if (previewAudioEl) previewAudioEl.pause(); }, 8000);
}

function ensureMusicUi() {
  if (musicToggleEl) return;
  musicToggleEl = document.createElement("button");
  musicToggleEl.id = "music-toggle-btn";
  musicToggleEl.style.cssText = "position:fixed; top:14px; right:14px; background:var(--surface); border:1px solid var(--surface-line); color:var(--text); border-radius:999px; padding:8px 13px; z-index:50; cursor:pointer; font-size:16px; display:none;";
  musicToggleEl.textContent = "🔊";
  musicToggleEl.onclick = () => {
    musicMuted = !musicMuted;
    if (musicAudioEl) {
      if (musicMuted) musicAudioEl.pause();
      else musicAudioEl.play().catch(() => {});
    }
    musicToggleEl.textContent = musicMuted ? "🔇" : "🔊";
  };
  document.body.appendChild(musicToggleEl);
}

function updateMusicForSession(s) {
  ensureMusicUi();
  if (!s || s.status === "ended" || !s.musicUrl) {
    if (musicAudioEl) musicAudioEl.pause();
    musicToggleEl.style.display = "none";
    return;
  }
  if (!musicAudioEl) {
    musicAudioEl = document.createElement("audio");
    musicAudioEl.loop = true;
    musicAudioEl.volume = 0.32;
    document.body.appendChild(musicAudioEl);
  }
  if (musicAudioEl.dataset.url !== s.musicUrl) {
    musicAudioEl.dataset.url = s.musicUrl;
    musicAudioEl.src = s.musicUrl;
    if (!musicMuted) musicAudioEl.play().catch(() => {});
  }
  musicToggleEl.style.display = "block";
  musicToggleEl.textContent = musicMuted ? "🔇" : "🔊";
}

/* ================= BUSCA UNSPLASH ================= */

function openUnsplash(target) {
  imageTarget = target;
  document.getElementById("unsplash-modal").style.display = "flex";
  document.getElementById("unsplash-results").innerHTML = "";
  document.getElementById("unsplash-query").value = "";
  document.getElementById("unsplash-query").focus();
}
document.getElementById("unsplash-close").onclick = () => (document.getElementById("unsplash-modal").style.display = "none");

let unsplashDebounce = null;
document.getElementById("unsplash-query").addEventListener("input", (e) => {
  clearTimeout(unsplashDebounce);
  const term = e.target.value.trim();
  if (!term) return;
  unsplashDebounce = setTimeout(() => searchUnsplash(term), 450);
});

async function searchUnsplash(term) {
  const resultsEl = document.getElementById("unsplash-results");
  resultsEl.innerHTML = `<div class="spinner"></div>`;

  if (!UNSPLASH_ACCESS_KEY || UNSPLASH_ACCESS_KEY.includes("SUA_ACCESS_KEY")) {
    resultsEl.innerHTML = `<div class="error-text" style="grid-column:1/-1;">Falta configurar a chave do Unsplash em <code>shared/unsplash-config.js</code> (veja as instruções nos comentários do arquivo).</div>`;
    return;
  }

  try {
    const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(term)}&per_page=12`, {
      headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` },
    });
    if (res.status === 401) {
      resultsEl.innerHTML = `<div class="error-text" style="grid-column:1/-1;">Chave do Unsplash inválida. Confira se copiou o <b>Access Key</b> (não o Secret Key) pra <code>shared/unsplash-config.js</code>.</div>`;
      return;
    }
    if (res.status === 403) {
      resultsEl.innerHTML = `<div class="error-text" style="grid-column:1/-1;">Limite de buscas do Unsplash atingido por agora (50/hora no plano grátis). Tenta de novo daqui a pouco.</div>`;
      return;
    }
    if (!res.ok) {
      resultsEl.innerHTML = `<div class="error-text" style="grid-column:1/-1;">O Unsplash respondeu com erro (${res.status}). Tenta de novo.</div>`;
      return;
    }
    const data = await res.json();
    if (!data.results || data.results.length === 0) {
      resultsEl.innerHTML = `<div style="color:var(--text-dim); grid-column: 1/-1;">Nenhuma imagem encontrada.</div>`;
      return;
    }
    resultsEl.innerHTML = data.results.map((p, i) => `<img src="${p.urls.small}" data-idx="${i}" />`).join("");
    resultsEl.querySelectorAll("img").forEach((img) => {
      img.onclick = () => selectUnsplashPhoto(data.results[Number(img.dataset.idx)]);
    });
  } catch (err) {
    resultsEl.innerHTML = `<div class="error-text" style="grid-column:1/-1;">Não consegui buscar no Unsplash (falha de rede/CORS). Confira sua conexão e se a chave em <code>unsplash-config.js</code> está certa.</div>`;
  }
}

function selectUnsplashPhoto(photo) {
  // ping obrigatório pelos termos do Unsplash quando uma foto é usada
  fetch(photo.links.download_location, { headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` } }).catch(() => {});
  const credit = { name: photo.user.name, link: `${photo.user.links.html}?utm_source=quiz_ao_vivo&utm_medium=referral` };
  if (imageTarget === "cover") {
    quizDraft.coverImage = photo.urls.regular;
    quizDraft.coverCredit = credit;
  } else {
    questionDraft.imageUrl = photo.urls.regular;
    questionDraft.imageCredit = credit;
  }
  document.getElementById("unsplash-modal").style.display = "none";
  renderEditor();
}

/* ================= CONTROLE DA SALA AO VIVO ================= */
function openControl(code) {
  sessionCode = code;
  view = "control";
  unsubSession && unsubSession();
  unsubPlayers && unsubPlayers();
    unsubRaceScores && unsubRaceScores();
  unsubSession = onSnapshot(doc(db, "sessions", code), (snap) => {
    sessionData = snap.data();
    if (view === "control") render();
  });
  unsubPlayers = onSnapshot(collection(db, "sessions", code, "players"), (snap) => {
    sessionPlayers = {};
    snap.forEach((d) => (sessionPlayers[d.id] = d.data()));
    if (view === "control" && sessionData?.status === "lobby") render();
  });
  subscribeRaceScores(code);
}

function renderControl() {
  if (!sessionData) { root.innerHTML = `<div class="spinner"></div>`; return; }
  const s = sessionData;
  if (s.status === "lobby") return renderLobby();
  if (s.status === "question") return renderQuestionLive();
  if (s.status === "reveal") return renderReveal();
  if (s.status === "leaderboard") return renderLeaderboard();
  if (s.status === "racing") return s.raceSubmode === "async" ? renderRaceAsyncControl() : renderRaceControl();
  if (s.status === "bluffwrite") return renderBluffWrite();
  if (s.status === "bluffvote") return renderBluffVote();
  if (s.status === "bluffreveal") return renderBluffReveal();
  if (s.status === "ended") return renderEnded();
}

function renderLobby() {
  const playerEntries = Object.entries(sessionPlayers);
  const joinUrl = new URL(`../jogo/index.html?code=${sessionCode}`, window.location.href).href;
  const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=${encodeURIComponent(joinUrl)}`;
  root.innerHTML = `
    <button class="btn-link" id="control-back">← voltar aos quizzes</button>
    <div class="eyebrow" style="text-align:center; margin-top:10px;">sala aberta · ${escapeHtml(sessionData.title)}</div>
    <div class="code-big">${sessionCode}</div>
    <p style="color:var(--text-dim); text-align:center;">Peça pra galera entrar com esse código, pelo celular — ou escanear o QR Code abaixo.</p>

    <div class="qr-box">
      <div id="qr-canvas"></div>
    </div>
    <div class="join-link-row">
      <input class="input" id="join-url" readonly value="${joinUrl}" />
      <button class="btn btn-ghost" id="copy-link-btn">copiar link</button>
    </div>

    <div class="card" style="margin-top:20px;">
      <div style="font-weight:700; margin-bottom:10px;">Jogadores (${playerEntries.length})</div>
      <div class="player-pill-list">
        ${playerEntries.map(([id, p]) => `
          <span class="pill" style="display:inline-flex; align-items:center; gap:6px;">
            <span class="mini-avatar">${avatarSVG(p.avatar, 24)}</span>${escapeHtml(p.name)}
            <button type="button" class="pill-remove" data-remove-player="${id}" title="remover">✕</button>
          </span>
        `).join("") || `<span style="color:var(--text-dim); font-size:13px;">Aguardando entrarem...</span>`}
      </div>
    </div>
    <button class="btn btn-primary btn-block" id="begin-btn" style="margin-top:22px;" ${playerEntries.length === 0 && sessionData.raceSubmode !== "async" ? "disabled" : ""}>${sessionData.gameMode === "corrida" ? (sessionData.raceSubmode === "async" ? "Abrir corrida assíncrona →" : "Começar corrida →") : "Começar jogo →"}</button>
    <button class="btn btn-ghost btn-block" id="cancel-session-btn" style="margin-top:10px;">Cancelar e excluir esta sala</button>
  `;
  document.getElementById("control-back").onclick = () => { view = "list"; unsubSession(); unsubPlayers(); unsubRaceScores && unsubRaceScores(); render(); };
  document.getElementById("begin-btn").onclick = sessionData.gameMode === "corrida" ? beginRace : beginGame;
  document.getElementById("cancel-session-btn").onclick = async () => {
    await deleteSession(sessionCode, { fromControl: true });
  };
  root.querySelectorAll("[data-remove-player]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.removePlayer;
      const ok = await removePlayer(sessionCode, id, sessionPlayers[id]?.name || "jogador", sessionData.questions.length);
      if (ok) { delete sessionPlayers[id]; renderLobby(); }
    };
  });

  const qrEl = document.getElementById("qr-canvas");
  qrEl.innerHTML = "";
  if (window.QRCode) {
    new QRCode(qrEl, {
      text: joinUrl,
      width: 220,
      height: 220,
      colorDark: "#0B0E1A",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H,
    });
  } else {
    qrEl.innerHTML = `<img src="${qrImg}" width="220" height="220" alt="QR Code pra entrar na sala" />`;
  }

  document.getElementById("copy-link-btn").onclick = async () => {
    const input = document.getElementById("join-url");
    input.select();
    try {
      await navigator.clipboard.writeText(joinUrl);
    } catch {
      document.execCommand("copy");
    }
    const btn = document.getElementById("copy-link-btn");
    const original = btn.textContent;
    btn.textContent = "copiado!";
    setTimeout(() => (btn.textContent = original), 1500);
  };
}

async function beginGame() {
  const status = sessionData.gameMode === "blefe" ? "bluffwrite" : "question";
  await updateDoc(doc(db, "sessions", sessionCode), { status, currentIndex: 0, questionStartedAt: Date.now() });
}

// Encerra a sessão AGORA, de onde ela estiver — calcula o placar final
// com o que já foi jogado até aqui (sem apagar nada, ao contrário de
// excluir a sessão). Útil se alguém desistir no meio do jogo.
async function finalizeSessionNow(askConfirm = true) {
  if (askConfirm && !confirm("Encerrar essa sessão agora? Isso calcula o resultado final com o placar de até aqui — as perguntas que ainda não rolaram ficam de fora. Não pode ser desfeito.")) return;
  const scoresSnap = await getDocs(collection(db, "sessions", sessionCode, "scores"));
  const totals = {};
  scoresSnap.forEach((d) => (totals[d.id] = d.data().total || 0));
  const final = buildLeaderboardRows({ gameMode: sessionData.gameMode, teamMode: sessionData.teamMode, players: sessionPlayers, totals });
  await updateDoc(doc(db, "sessions", sessionCode), { status: "ended", finalLeaderboard: final });
}

function endSessionButtonHtml() {
  return `<button class="btn-link" id="end-session-now-btn" style="margin-top:14px; color:var(--coral);">encerrar sessão agora (finaliza onde parou)</button>`;
}
function bindEndSessionButton() {
  document.getElementById("end-session-now-btn")?.addEventListener("click", () => finalizeSessionNow(true));
}

/* ---------------- corrida livre ---------------- */
let raceControlInt = null;
let unsubRaceScores = null;
let raceScoresCache = {};

function subscribeRaceScores(code) {
  unsubRaceScores && unsubRaceScores();
  unsubRaceScores = onSnapshot(collection(db, "sessions", code, "scores"), (snap) => {
    raceScoresCache = {};
    snap.forEach((d) => (raceScoresCache[d.id] = d.data().total || 0));
    if (view === "control" && sessionData?.status === "racing") render();
  });
}

async function beginRace() {
  const s = sessionData;
  if (s.raceSubmode === "async") {
    await updateDoc(doc(db, "sessions", sessionCode), {
      status: "racing",
      raceWindowEndsAt: Date.now() + (s.raceWindowMs || 86400000),
    });
  } else {
    await updateDoc(doc(db, "sessions", sessionCode), { status: "racing", raceStartedAt: Date.now() });
  }
}

async function extendRaceWindow(extraMs) {
  const s = sessionData;
  const base = s.raceWindowEndsAt && s.raceWindowEndsAt > Date.now() ? s.raceWindowEndsAt : Date.now();
  await updateDoc(doc(db, "sessions", sessionCode), { raceWindowEndsAt: base + extraMs });
}

function renderRaceControl() {
  clearInterval(raceControlInt);
  const s = sessionData;
  const rows = buildLeaderboardRows({ gameMode: s.gameMode, teamMode: s.teamMode, players: sessionPlayers, totals: raceScoresCache }).slice(0, 8);
  root.innerHTML = `
    <div class="eyebrow" style="text-align:center;">corrida em andamento</div>
    <div class="timer-ring" id="race-timer-ring"><span id="race-timer-num">--</span></div>
    <div style="margin-top:20px;">
      ${rows.map((p, i) => `
        <div class="rank-row">
          <span class="rank-num" style="color:${i === 0 ? "var(--gold)" : "var(--text-dim)"};">${i + 1}</span>
          ${p.avatar ? `<span class="mini-avatar">${avatarSVG(p.avatar, 30)}</span>` : ""}
          <span style="flex:1; font-weight:600;">${escapeHtml(p.name)}</span>
          <span style="color:var(--gold); font-weight:700;">${p.total}</span>
        </div>
      `).join("") || `<div style="color:var(--text-dim); font-size:13px;">Aguardando o pessoal responder...</div>`}
    </div>
    <button class="btn btn-primary btn-block" id="end-race-btn" style="margin-top:18px;">Encerrar corrida agora</button>
  `;
  document.getElementById("end-race-btn").onclick = endRace;

  const draw = () => {
    const elapsed = (Date.now() - (s.raceStartedAt || Date.now())) / 1000;
    const remaining = Math.max(0, Math.ceil((s.raceDurationSec || 0) - elapsed));
    const num = document.getElementById("race-timer-num");
    const ring = document.getElementById("race-timer-ring");
    if (num) num.textContent = remaining;
    if (ring) ring.classList.toggle("low", remaining <= 10);
    if (remaining <= 0) { clearInterval(raceControlInt); endRace(); }
  };
  draw();
  raceControlInt = setInterval(draw, 1000);
}

async function endRace() {
  clearInterval(raceControlInt);
  const scoresSnap = await getDocs(collection(db, "sessions", sessionCode, "scores"));
  const totals = {};
  scoresSnap.forEach((d) => (totals[d.id] = d.data().total || 0));
  const final = buildLeaderboardRows({ gameMode: sessionData.gameMode, teamMode: sessionData.teamMode, players: sessionPlayers, totals });
  await updateDoc(doc(db, "sessions", sessionCode), { status: "ended", finalLeaderboard: final });
}

function fmtDuration(ms) {
  if (ms <= 0) return "0min";
  const totalMin = Math.ceil(ms / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const min = totalMin % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (min && !days) parts.push(`${min}min`);
  return parts.join(" ") || "0min";
}

function renderRaceAsyncControl() {
  clearInterval(raceControlInt);
  const s = sessionData;
  const remainingMs = (s.raceWindowEndsAt || 0) - Date.now();
  const windowOpen = remainingMs > 0;
  const rows = buildLeaderboardRows({ gameMode: s.gameMode, teamMode: s.teamMode, players: sessionPlayers, totals: raceScoresCache }).slice(0, 10);

  root.innerHTML = `
    <div class="eyebrow" style="text-align:center;">corrida assíncrona</div>
    <h2 style="text-align:center; font-size:20px; margin:10px 0;">${windowOpen ? "Sala aberta" : "Janela encerrada"}</h2>
    <div style="text-align:center; color:${windowOpen ? "var(--gold)" : "var(--coral)"}; font-weight:700; font-size:16px;" id="race-window-status">
      ${windowOpen ? `Fecha em ${fmtDuration(remainingMs)}` : "Aguardando você encerrar e calcular o resultado"}
    </div>
    <p style="color:var(--text-dim); text-align:center; font-size:12px; margin-top:6px;">
      Cada jogador entra e joga quando quiser, com o próprio tempo de ${Math.round((s.raceDurationSec || 0) / 60)}min pra responder tudo — dentro dessa janela.
    </p>

    <div style="margin-top:20px;">
      ${rows.map((p, i) => `
        <div class="rank-row">
          <span class="rank-num" style="color:${i === 0 ? "var(--gold)" : "var(--text-dim)"};">${i + 1}</span>
          ${p.avatar ? `<span class="mini-avatar">${avatarSVG(p.avatar, 30)}</span>` : ""}
          <span style="flex:1; font-weight:600;">${escapeHtml(p.name)}</span>
          <span style="color:var(--gold); font-weight:700;">${p.total}</span>
        </div>
      `).join("") || `<div style="color:var(--text-dim); font-size:13px;">Ninguém jogou ainda...</div>`}
    </div>

    ${windowOpen ? `
      <div style="display:flex; gap:8px; margin-top:18px;">
        <input class="input" type="number" min="1" id="extend-value" value="1" style="width:80px;" />
        <select class="input" id="extend-unit" style="width:110px;">
          <option value="horas">horas</option>
          <option value="dias">dias</option>
        </select>
        <button class="btn btn-ghost" id="extend-btn" style="width:auto; padding:10px 14px; white-space:nowrap;">Estender</button>
      </div>
    ` : ""}
    <button class="btn btn-primary btn-block" id="close-race-btn" style="margin-top:12px;">
      ${windowOpen ? "Fechar sala agora e ver resultado" : "Ver resultado final"}
    </button>
  `;
  document.getElementById("close-race-btn").onclick = endRace;
  document.getElementById("extend-btn")?.addEventListener("click", () => {
    const value = Math.max(1, Number(document.getElementById("extend-value").value) || 1);
    const unit = document.getElementById("extend-unit").value;
    extendRaceWindow(value * (unit === "dias" ? 86400000 : 3600000));
  });

  raceControlInt = setInterval(() => {
    if (sessionData.status !== "racing") { clearInterval(raceControlInt); return; }
    const rem = (sessionData.raceWindowEndsAt || 0) - Date.now();
    const el = document.getElementById("race-window-status");
    if (el && rem > 0) el.textContent = `Fecha em ${fmtDuration(rem)}`;
    if (rem <= 0 && view === "control") render();
  }, 30000);
}

/* ---------------- modo blefe ---------------- */
let bluffPollInt = null;
let bluffAutoAdvanced = false;

function renderBluffWrite() {
  clearInterval(bluffPollInt);
  bluffAutoAdvanced = false;
  const s = sessionData;
  const q = s.questions[s.currentIndex];
  root.innerHTML = `
    <div class="eyebrow" style="text-align:center;">blefe · pergunta ${s.currentIndex + 1} de ${s.questions.length}</div>
    <h2 style="text-align:center; font-size:20px; margin:14px 0;">${escapeHtml(q.text)}</h2>
    <p style="color:var(--text-dim); text-align:center; font-size:13px;">Cada jogador está escrevendo a própria resposta falsa no celular...</p>
    <div id="bluff-write-count" style="color:var(--text-dim); margin-top:18px; text-align:center;">carregando...</div>
    <button class="btn btn-primary btn-block" id="bluff-vote-btn" style="margin-top:18px;">Ir pra votação agora</button>
    <div style="text-align:center;">${endSessionButtonHtml()}</div>
  `;
  document.getElementById("bluff-vote-btn").onclick = goToBluffVote;
  bindEndSessionButton();

  const tick = async () => {
    const total = Object.keys(sessionPlayers).length;
    const snap = await getDocs(query(collection(db, "sessions", sessionCode, "bluffs"), where("questionIndex", "==", s.currentIndex)));
    const el = document.getElementById("bluff-write-count");
    if (el) el.textContent = `${snap.size} de ${total} já escreveram`;
    if (!bluffAutoAdvanced && total > 0 && snap.size >= total) {
      bluffAutoAdvanced = true;
      goToBluffVote();
    }
  };
  tick();
  bluffPollInt = setInterval(tick, 1500);
}

async function goToBluffVote() {
  clearInterval(bluffPollInt);
  await updateDoc(doc(db, "sessions", sessionCode), { status: "bluffvote" });
}

function renderBluffVote() {
  clearInterval(bluffPollInt);
  bluffAutoAdvanced = false;
  const s = sessionData;
  const q = s.questions[s.currentIndex];
  root.innerHTML = `
    <div class="eyebrow" style="text-align:center;">blefe · votação</div>
    <h2 style="text-align:center; font-size:20px; margin:14px 0;">${escapeHtml(q.text)}</h2>
    <p style="color:var(--text-dim); text-align:center; font-size:13px;">Cada um está votando em qual resposta acha que é a verdadeira...</p>
    <div id="bluff-vote-count" style="color:var(--text-dim); margin-top:18px; text-align:center;">carregando...</div>
    <button class="btn btn-primary btn-block" id="bluff-reveal-btn" style="margin-top:18px;">Revelar agora</button>
    <div style="text-align:center;">${endSessionButtonHtml()}</div>
  `;
  document.getElementById("bluff-reveal-btn").onclick = revealBluff;
  bindEndSessionButton();

  const tick = async () => {
    const total = Object.keys(sessionPlayers).length;
    const snap = await getDocs(query(collection(db, "sessions", sessionCode, "votes"), where("questionIndex", "==", s.currentIndex)));
    const el = document.getElementById("bluff-vote-count");
    if (el) el.textContent = `${snap.size} de ${total} já votaram`;
    if (!bluffAutoAdvanced && total > 0 && snap.size >= total) {
      bluffAutoAdvanced = true;
      revealBluff();
    }
  };
  tick();
  bluffPollInt = setInterval(tick, 1500);
}

async function revealBluff() {
  clearInterval(bluffPollInt);
  const s = sessionData;
  const idx = s.currentIndex;
  const q = s.questions[idx];
  const correctText = q.options[q.correct[0]];

  const bluffsSnap = await getDocs(query(collection(db, "sessions", sessionCode, "bluffs"), where("questionIndex", "==", idx)));
  const bluffsByPlayer = {};
  bluffsSnap.forEach((d) => (bluffsByPlayer[d.data().playerId] = d.data().text));

  const votesSnap = await getDocs(query(collection(db, "sessions", sessionCode, "votes"), where("questionIndex", "==", idx)));
  const votes = votesSnap.docs.map((d) => d.data());
  const voteCounts = {};
  votes.forEach((v) => { voteCounts[v.votedFor] = (voteCounts[v.votedFor] || 0) + 1; });

  const writes = [];
  for (const pid of Object.keys(sessionPlayers)) {
    const prevScoreSnap = await getDoc(doc(db, "sessions", sessionCode, "scores", pid));
    const prevTotal = prevScoreSnap.exists() ? prevScoreSnap.data().total || 0 : 0;
    const myVote = votes.find((v) => v.playerId === pid);
    const guessedRight = !!myVote && myVote.votedFor === "correct";
    const guessPoints = guessedRight ? 500 : 0;
    const foolCount = voteCounts[pid] || 0;
    const foolBonus = foolCount * 250;
    const roundPoints = guessPoints + foolBonus;
    writes.push(setDoc(doc(db, "sessions", sessionCode, "scores", pid), {
      total: prevTotal + roundPoints, lastPoints: roundPoints, lastCorrect: guessedRight, lastFoolCount: foolCount, lastGuessPoints: guessPoints, lastFoolBonus: foolBonus,
    }));
  }
  await Promise.all(writes);

  await updateDoc(doc(db, "sessions", sessionCode), {
    status: "bluffreveal",
    bluffRevealData: { correctText, bluffs: bluffsByPlayer, voteCounts },
  });
}

function renderBluffReveal() {
  const s = sessionData;
  const data = s.bluffRevealData || { correctText: "", bluffs: {}, voteCounts: {} };
  const rows = [
    { label: data.correctText, isCorrect: true, votes: data.voteCounts.correct || 0, authorName: null },
    ...Object.entries(data.bluffs).map(([pid, text]) => ({
      label: text, isCorrect: false, votes: data.voteCounts[pid] || 0, authorName: sessionPlayers[pid]?.name || "?",
    })),
  ];
  root.innerHTML = `
    <div class="eyebrow" style="text-align:center;">blefe · revelação</div>
    <h2 style="text-align:center; font-size:20px; margin:14px 0;">A resposta verdadeira era:</h2>
    <div style="display:flex; flex-direction:column; gap:10px;">
      ${rows.map((r) => `
        <div style="display:flex; align-items:center; gap:10px; border-radius:12px; padding:12px 14px; ${r.isCorrect ? "background:rgba(61,220,151,.16); border:2px solid var(--green);" : "background:var(--surface); border:1px solid var(--surface-line);"}">
          <div style="flex:1; color:var(--text); font-weight:600; font-size:14px;">
            ${escapeHtml(r.label)}<br>
            <span style="color:${r.isCorrect ? "var(--green)" : "var(--text-dim)"}; font-size:11px; font-weight:700;">${r.isCorrect ? "✓ verdadeira" : `blefe de ${escapeHtml(r.authorName)}`}</span>
          </div>
          <span style="font-size:12px; color:var(--text-dim); white-space:nowrap;">${r.votes} voto${r.votes !== 1 ? "s" : ""}</span>
        </div>
      `).join("")}
    </div>
    <button class="btn btn-primary btn-block" id="bluff-leaderboard-btn" style="margin-top:18px;">Ver placar →</button>
    <div id="ready-count-bluffreveal" style="text-align:center; font-size:11px; color:var(--text-dim); margin-top:8px;"></div>
    <div style="text-align:center;">${endSessionButtonHtml()}</div>
  `;
  document.getElementById("bluff-leaderboard-btn").onclick = showLeaderboard;
  bindEndSessionButton();
  pollReadyCount("bluffreveal", showLeaderboard, "ready-count-bluffreveal");
}

let liveTimerInt = null;
function renderQuestionLive() {
  clearInterval(liveTimerInt);
  const s = sessionData;
  const q = s.questions[s.currentIndex];
  const draw = () => {
    const elapsed = (Date.now() - s.questionStartedAt) / 1000;
    const remaining = Math.max(0, Math.ceil(q.timeLimit - elapsed));
    const ring = document.getElementById("timer-num");
    if (ring) { ring.textContent = remaining; ring.parentElement.classList.toggle("low", remaining <= 5); }
  };
  root.innerHTML = `
    <div class="eyebrow" style="text-align:center;">pergunta ${s.currentIndex + 1} de ${s.questions.length}${q.pointsMultiplier > 1 ? ` · <span style="color:var(--gold);">🎁 bônus ${q.pointsMultiplier}x</span>` : ""}</div>
    <div class="timer-ring"><span id="timer-num">--</span></div>
    ${s.questions.some((qq) => qq.imageUrl) ? `<div class="q-image-slot" style="margin-top:14px; ${q.imageUrl ? `background-image:url('${q.imageUrl}');` : ""}"></div>` : ""}
    <h2 style="text-align:center; font-size:22px; margin:14px 0;">${escapeHtml(q.text)}</h2>
    <div class="grid-2">
      ${q.options.map((opt, i) => `
        <div class="option-btn ${OPTION_COLORS[i % 6]}" style="cursor:default;">
          <span class="${OPTION_SHAPES[i % 6]}"></span><span>${escapeHtml(opt)}</span>
        </div>
      `).join("")}
    </div>
    <div id="answered-count" style="color:var(--text-dim); margin-top:18px; text-align:center;">carregando respostas...</div>
    <div style="color:var(--text-dim); font-size:11px; text-align:center; margin-top:2px;">revela sozinho quando todo mundo responder</div>
    <button class="btn btn-primary btn-block" id="reveal-btn" style="margin-top:14px;">Revelar respostas agora</button>
    <div style="text-align:center;">${endSessionButtonHtml()}</div>
  `;
  draw();
  liveTimerInt = setInterval(draw, 250);
  document.getElementById("reveal-btn").onclick = revealAnswers;
  bindEndSessionButton();
  pollAnsweredCount();
}

let answeredPollInt = null;
let autoRevealed = false;

function pollAnsweredCount() {
  clearInterval(answeredPollInt);
  autoRevealed = false;
  const tick = async () => {
    const eliminated = new Set(sessionData.eliminatedPlayerIds || []);
    const activeIds = Object.keys(sessionPlayers).filter((pid) => !eliminated.has(pid));
    const total = activeIds.length;
    const q = query(collection(db, "sessions", sessionCode, "answers"), where("questionIndex", "==", sessionData.currentIndex));
    const snap = await getDocs(q);
    const answeredActive = snap.docs.filter((d) => activeIds.includes(d.data().playerId)).length;
    const el = document.getElementById("answered-count");
    if (el) el.textContent = `${answeredActive} de ${total} responderam`;
    if (!autoRevealed && total > 0 && answeredActive >= total) {
      autoRevealed = true;
      revealAnswers();
    }
  };
  tick();
  answeredPollInt = setInterval(tick, 1500);
}

async function revealAnswers() {
  clearInterval(liveTimerInt);
  clearInterval(answeredPollInt);
  const s = sessionData;
  const idx = s.currentIndex;
  const q = s.questions[idx];

  const answersSnap = await getDocs(query(collection(db, "sessions", sessionCode, "answers"), where("questionIndex", "==", idx)));
  const answersByPlayer = {};
  answersSnap.forEach((d) => (answersByPlayer[d.data().playerId] = d.data()));

  const stats = new Array(q.options.length).fill(0);
  const writes = [];
  const isSurvival = s.gameMode === "sobrevivencia";
  const eliminatedBefore = new Set(s.eliminatedPlayerIds || []);
  const newlyWrong = [];

  for (const pid of Object.keys(sessionPlayers)) {
    if (isSurvival && eliminatedBefore.has(pid)) continue; // já estava fora, não pontua nem erra de novo

    const prevScoreSnap = await getDoc(doc(db, "sessions", sessionCode, "scores", pid));
    const prevData = prevScoreSnap.exists() ? prevScoreSnap.data() : {};
    const prevTotal = prevData.total || 0;
    const prevStreak = prevData.streak || 0;
    let correct = false;
    const ans = answersByPlayer[pid];
    if (ans) {
      (ans.selected || []).forEach((i) => { if (stats[i] !== undefined) stats[i]++; });
      const sel = [...(ans.selected || [])].sort().join(",");
      const cor = [...q.correct].sort().join(",");
      correct = sel === cor && sel !== "";
    }
    if (isSurvival && !correct) newlyWrong.push(pid);
    const { points: pts, newStreak, combo, bonus } = nextQuestionScore({
      prevStreak,
      correct,
      timeMs: ans?.timeMs,
      timeLimit: q.timeLimit,
      multiplier: q.pointsMultiplier || 1,
      precisionMode: !!s.precisionMode,
      comboMode: !!s.comboMode,
    });
    writes.push(setDoc(doc(db, "sessions", sessionCode, "scores", pid), {
      total: prevTotal + pts, lastPoints: pts, lastCorrect: correct, streak: newStreak, lastCombo: combo, lastBonus: bonus,
    }));
  }
  await Promise.all(writes);
  revealStats = stats;

  const sessionUpdate = { status: "reveal" };
  if (isSurvival && newlyWrong.length) {
    sessionUpdate.eliminatedPlayerIds = [...eliminatedBefore, ...newlyWrong];
  }
  await updateDoc(doc(db, "sessions", sessionCode), sessionUpdate);
}

let readyPollInt = null;
let readyAutoAdvanced = false;

// Espera todo mundo (ou o admin, manualmente) pra avançar de fase. Some
// jogadores ativos que já clicaram "Continuar" na fase atual (revelação
// ou placar) e, quando todos já apertaram, avança sozinho.
function pollReadyCount(phase, onComplete, elId) {
  clearInterval(readyPollInt);
  readyAutoAdvanced = false;
  const s = sessionData;
  const eliminated = new Set(s.eliminatedPlayerIds || []);
  const activeIds = Object.keys(sessionPlayers).filter((pid) => !eliminated.has(pid));
  const total = activeIds.length;
  const tick = async () => {
    const snap = await getDocs(query(
      collection(db, "sessions", sessionCode, "ready"),
      where("questionIndex", "==", s.currentIndex),
      where("phase", "==", phase)
    ));
    const readyActive = snap.docs.filter((d) => activeIds.includes(d.data().playerId)).length;
    const el = document.getElementById(elId);
    if (el) el.textContent = total > 0 ? `${readyActive} de ${total} já continuaram` : "";
    if (!readyAutoAdvanced && total > 0 && readyActive >= total) {
      readyAutoAdvanced = true;
      clearInterval(readyPollInt);
      onComplete();
    }
  };
  tick();
  readyPollInt = setInterval(tick, 1500);
}

function renderReveal() {
  const s = sessionData;
  const q = s.questions[s.currentIndex];
  const total = (revealStats || []).reduce((a, b) => a + b, 0) || 1;
  root.innerHTML = `
    <div class="eyebrow" style="text-align:center;">resposta certa</div>
    <h2 style="text-align:center; font-size:22px; margin:14px 0;">${escapeHtml(q.text)}</h2>
    ${q.options.map((opt, i) => {
      const isCorrect = q.correct.includes(i);
      const count = revealStats ? revealStats[i] : 0;
      const pct = Math.round((count / total) * 100);
      return `
        <div class="bar-row" style="opacity:${isCorrect ? 1 : 0.45}">
          <span class="${OPTION_SHAPES[i % 6]}" style="width:14px;height:14px;background:var(--text-dim);"></span>
          <div class="bar-track" style="${isCorrect ? "background:rgba(61,220,151,.16); border:2px solid var(--green);" : ""}">
            <div class="bar-fill" style="width:${pct}%; background:${isCorrect ? "var(--green)" : "var(--text-dim)"};"></div>
            <div class="bar-label">${escapeHtml(opt)} ${isCorrect ? "✓ certa" : ""}</div>
          </div>
          <span style="width:30px; text-align:right; font-size:13px; color:var(--text-dim);">${count}</span>
        </div>`;
    }).join("")}
    <button class="btn btn-primary btn-block" id="leaderboard-btn" style="margin-top:18px;">Ver placar →</button>
    <div id="ready-count-reveal" style="text-align:center; font-size:11px; color:var(--text-dim); margin-top:8px;"></div>
    <div style="text-align:center;">${endSessionButtonHtml()}</div>
  `;
  document.getElementById("leaderboard-btn").onclick = showLeaderboard;
  bindEndSessionButton();
  pollReadyCount("reveal", showLeaderboard, "ready-count-reveal");
}

async function showLeaderboard() {
  const scoresSnap = await getDocs(collection(db, "sessions", sessionCode, "scores"));
  const totals = {};
  scoresSnap.docs.forEach((d) => (totals[d.id] = d.data().total || 0));
  const top = buildLeaderboardRows({ gameMode: sessionData.gameMode, teamMode: sessionData.teamMode, players: sessionPlayers, totals });
  await updateDoc(doc(db, "sessions", sessionCode), { status: "leaderboard", leaderboardTop: top });
}

function renderLeaderboard() {
  const s = sessionData;
  const groupTotal = s.gameMode === "cooperativo" ? (s.leaderboardTop[0]?.total || 0) : null;
  const progress = s.gameMode === "cooperativo" ? cooperativeProgress(s, groupTotal) : null;
  root.innerHTML = `
    <div class="eyebrow" style="text-align:center;">placar</div>
    <h2 style="text-align:center; font-size:24px; margin-top:6px;">Colocação</h2>
    ${progress ? `
      <div style="margin-top:14px;">
        <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-dim); margin-bottom:4px;">
          <span>Meta: ${progress.goalPoints} pts</span><span>${progress.pct}%${progress.met ? " ✓ batida!" : ""}</span>
        </div>
        <div style="background:var(--surface); border:1px solid var(--surface-line); border-radius:8px; height:14px; overflow:hidden;">
          <div style="width:${progress.pct}%; height:100%; background:${progress.met ? "var(--green)" : "var(--gold)"};"></div>
        </div>
      </div>
    ` : ""}
    <div style="margin-top:16px;">
      ${s.leaderboardTop.map((p, i) => `
        <div class="rank-row">
          <span class="rank-num" style="color:${i === 0 ? "var(--gold)" : "var(--text-dim)"};">${i + 1}</span>
          ${p.avatar ? `<span class="mini-avatar">${avatarSVG(p.avatar, 30)}</span>` : ""}
          <span style="flex:1; font-weight:600;">${escapeHtml(p.name)}</span>
          <span style="color:var(--gold); font-weight:700;">${p.total}</span>
          <button type="button" class="rank-remove" data-remove-player="${p.id}" title="remover jogador">✕</button>
        </div>
      `).join("")}
    </div>
    <button class="btn btn-primary btn-block" id="next-btn" style="margin-top:18px;">
      ${s.currentIndex + 1 >= s.questions.length ? "Ver resultado final →" : "Próxima pergunta →"}
    </button>
    <div id="ready-count-leaderboard" style="text-align:center; font-size:11px; color:var(--text-dim); margin-top:8px;"></div>
    <div style="text-align:center;">${endSessionButtonHtml()}</div>
  `;
  document.getElementById("next-btn").onclick = nextQuestion;
  bindEndSessionButton();
  pollReadyCount("leaderboard", nextQuestion, "ready-count-leaderboard");
  root.querySelectorAll("[data-remove-player]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.removePlayer;
      const name = s.leaderboardTop.find((p) => p.id === id)?.name || "jogador";
      const ok = await removePlayer(sessionCode, id, name, s.questions.length);
      if (ok) {
        delete sessionPlayers[id];
        sessionData = { ...s, leaderboardTop: s.leaderboardTop.filter((p) => p.id !== id) };
        renderLeaderboard();
      }
    };
  });
}

async function nextQuestion() {
  const s = sessionData;
  const nextIdx = s.currentIndex + 1;
  if (nextIdx >= s.questions.length) {
    const scoresSnap = await getDocs(collection(db, "sessions", sessionCode, "scores"));
    const totals = {};
    scoresSnap.docs.forEach((d) => (totals[d.id] = d.data().total || 0));
    const final = buildLeaderboardRows({ gameMode: s.gameMode, teamMode: s.teamMode, players: sessionPlayers, totals });
    await updateDoc(doc(db, "sessions", sessionCode), { status: "ended", finalLeaderboard: final });
    return;
  }
  revealStats = null;
  const status = s.gameMode === "blefe" ? "bluffwrite" : "question";
  await updateDoc(doc(db, "sessions", sessionCode), { status, currentIndex: nextIdx, questionStartedAt: Date.now() });
}

function renderEnded() {
  const s = sessionData;
  const groupTotal = s.gameMode === "cooperativo" ? (s.finalLeaderboard[0]?.total || 0) : null;
  const progress = s.gameMode === "cooperativo" ? cooperativeProgress(s, groupTotal) : null;
  root.innerHTML = `
    <div style="font-size:48px; text-align:center;">🏆</div>
    <h2 style="text-align:center; font-size:24px;">Resultado final</h2>
    ${progress ? `
      <div style="text-align:center; margin-top:10px;">
        <div style="font-size:14px; color:${progress.met ? "var(--green)" : "var(--text-dim)"}; font-weight:700;">
          ${progress.met ? "🎉 Meta batida!" : "Meta não batida"} — ${groupTotal} / ${progress.goalPoints} pts (${progress.pct}%)
        </div>
      </div>
    ` : ""}
    <div style="margin-top:16px;">
      ${s.finalLeaderboard.map((p, i) => `
        <div class="rank-row">
          <span class="rank-num" style="color:${i === 0 ? "var(--gold)" : "var(--text-dim)"};">${i + 1}</span>
          ${p.avatar ? `<span class="mini-avatar">${avatarSVG(p.avatar, 30)}</span>` : ""}
          <span style="flex:1; font-weight:600;">${escapeHtml(p.name)}</span>
          <span style="color:var(--gold); font-weight:700;">${p.total}</span>
          <button type="button" class="rank-remove" data-remove-player="${p.id}" title="remover jogador">✕</button>
        </div>
      `).join("")}
    </div>
    <button class="btn btn-primary btn-block" id="report-btn" style="margin-top:18px;">Ver relatório completo →</button>
    <button class="btn btn-ghost btn-block" id="finish-btn" style="margin-top:10px;">Voltar aos quizzes</button>
  `;
  document.getElementById("report-btn").onclick = () => openReport(sessionCode);
  document.getElementById("finish-btn").onclick = () => {
    unsubSession && unsubSession();
    unsubPlayers && unsubPlayers();
    unsubRaceScores && unsubRaceScores();
    view = "list";
    render();
  };
  root.querySelectorAll("[data-remove-player]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.removePlayer;
      const name = s.finalLeaderboard.find((p) => p.id === id)?.name || "jogador";
      const ok = await removePlayer(sessionCode, id, name, s.questions.length);
      if (ok) {
        sessionData = { ...s, finalLeaderboard: s.finalLeaderboard.filter((p) => p.id !== id) };
        renderEnded();
      }
    };
  });
}

/* ================= SESSÕES (HISTÓRICO) ================= */
function subscribeCommunityQuizzes() {
  unsubCommunityQuizzes && unsubCommunityQuizzes();
  unsubCommunityQuizzes = onSnapshot(
    query(collection(db, "quizzes"), where("isPublic", "==", true)),
    (snap) => {
      communityQuizzes = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((q) => q.ownerId !== currentUser.uid)
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      if (view === "community") render();
    },
    (err) => {
      console.error("Erro ao carregar quizzes da comunidade:", err);
      communityQuizzes = [];
      if (view === "community") render();
    }
  );
}

function subscribeSessionsList() {
  unsubSessionsList && unsubSessionsList();
  unsubSessionsList = onSnapshot(
    query(collection(db, "sessions"), where("ownerId", "==", currentUser.uid)),
    (snap) => {
      sessionsList = snap.docs
        .map((d) => ({ code: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      if (view === "sessions") render();
    },
    (err) => {
      console.error("Erro ao carregar sessões:", err);
      sessionsList = [];
      if (view === "sessions") renderSessionsError(err);
    }
  );
}

const STATUS_LABEL = { lobby: "aguardando", question: "em andamento", reveal: "em andamento", leaderboard: "em andamento", ended: "encerrada" };

function renderSessionsError(err) {
  root.innerHTML = `
    ${navTabsHtml("sessions")}
    <h1 style="font-size:24px; margin-top:16px;">Sessões</h1>
    <div class="card" style="margin-top:14px; border-color:var(--coral);">
      <div style="color:var(--coral); font-weight:700; margin-bottom:6px;">Não consegui carregar as sessões</div>
      <div style="font-size:13px; color:var(--text-dim);">
        Confira se as regras do Firestore já foram publicadas certinho, e olha o Console do navegador (F12) —
        se o Firestore estiver pedindo pra criar um índice, tem um link pronto lá.
      </div>
      <div style="font-size:11px; color:var(--text-dim); margin-top:8px; font-family:monospace;">${escapeHtml(err?.message || String(err))}</div>
    </div>
  `;
  bindNavTabs();
}

function renderSessions() {
  const modeLabel = (id) => GAME_MODES.find((m) => m.id === id)?.label || "Clássico";
  root.innerHTML = `
    ${navTabsHtml("sessions")}
    <h1 style="font-size:24px; margin-top:16px;">Sessões</h1>
    <div style="margin-top:14px;">
      ${sessionsList.map((s) => `
        <div class="q-row" style="align-items:center;">
          <div class="info">
            <div class="meta">${s.code} · ${STATUS_LABEL[s.status] || s.status} · ${modeLabel(s.gameMode)}${s.createdAt?.toDate ? " · " + s.createdAt.toDate().toLocaleString("pt-BR") : ""}</div>
            <div class="text">${escapeHtml(s.title || "")}</div>
          </div>
          <button class="btn btn-ghost" id="open-session-${s.code}">${s.status === "ended" ? "Ver relatório" : "Abrir controle"}</button>
          <button class="btn-link" id="del-session-${s.code}" style="color:var(--coral);">excluir</button>
        </div>
      `).join("") || `<div style="color:var(--text-dim);">Nenhuma sala aberta ainda.</div>`}
    </div>
  `;
  bindNavTabs();
  sessionsList.forEach((s) => {
    document.getElementById(`open-session-${s.code}`).onclick = () => {
      if (s.status === "ended") openReport(s.code);
      else openControl(s.code);
    };
    document.getElementById(`del-session-${s.code}`).onclick = () => deleteSession(s.code);
  });
}

// Remove um jogador de uma sessão por completo: registro, respostas e
// pontuação — inclusive depois do jogo já ter acabado (aí também tira o
// nome do placar final salvo). Usado tanto no lobby/durante o jogo quanto
// no relatório de sessões já encerradas.
async function removePlayer(code, playerId, playerName, questionCount) {
  if (!confirm(`Remover "${playerName}" desta sessão? Isso apaga o registro, as respostas e a pontuação dela(e). Não pode ser desfeito.`)) return false;
  try {
    await deleteDoc(doc(db, "sessions", code, "players", playerId));
    await deleteDoc(doc(db, "sessions", code, "scores", playerId)).catch(() => {});
    const answerDeletes = [];
    for (let idx = 0; idx < (questionCount || 0); idx++) {
      answerDeletes.push(deleteDoc(doc(db, "sessions", code, "answers", `${idx}_${playerId}`)).catch(() => {}));
    }
    await Promise.all(answerDeletes);

    const sessSnap = await getDoc(doc(db, "sessions", code));
    if (sessSnap.exists()) {
      const data = sessSnap.data();
      const updates = {};
      if (Array.isArray(data.finalLeaderboard) && data.finalLeaderboard.some((p) => p.id === playerId)) {
        updates.finalLeaderboard = data.finalLeaderboard.filter((p) => p.id !== playerId);
      }
      if (Array.isArray(data.leaderboardTop) && data.leaderboardTop.some((p) => p.id === playerId)) {
        updates.leaderboardTop = data.leaderboardTop.filter((p) => p.id !== playerId);
      }
      if (Object.keys(updates).length) await updateDoc(doc(db, "sessions", code), updates);
    }
    return true;
  } catch (err) {
    alert("Não consegui remover esse jogador agora. Tenta de novo.");
    return false;
  }
}

async function deleteSession(code, opts = {}) {
  const label = opts.fromControl ? "esta sala" : `a sessão ${code}`;
  if (!confirm(`Excluir ${label}? Isso remove todos os jogadores, respostas e pontuações dela. Essa ação não pode ser desfeita.`)) return;
  try {
    for (const sub of ["players", "answers", "scores"]) {
      const snap = await getDocs(collection(db, "sessions", code, sub));
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    }
    await deleteDoc(doc(db, "sessions", code));
  } catch (err) {
    alert("Não consegui excluir a sessão agora. Tenta de novo.");
    return;
  }
  if (opts.fromControl) {
    unsubSession && unsubSession();
    unsubPlayers && unsubPlayers();
    unsubRaceScores && unsubRaceScores();
    view = "sessions";
    subscribeSessionsList();
  }
  render();
}

/* ================= RELATÓRIO COMPLETO ================= */
async function openReport(code) {
  view = "report";
  reportData = null;
  render();

  const sessSnap = await getDoc(doc(db, "sessions", code));
  const sess = sessSnap.data();
  const playersSnap = await getDocs(collection(db, "sessions", code, "players"));
  const players = {};
  playersSnap.forEach((d) => (players[d.id] = d.data()));
  const playerIds = Object.keys(players);

  if (sess.gameMode === "blefe") {
    // Modo Blefe não usa "answers" — a pontuação de cada rodada não
    // depende de sequência (sem combo), então dá pra recalcular certinho
    // direto dos blefes e votos de cada pergunta.
    const bluffsSnap = await getDocs(collection(db, "sessions", code, "bluffs"));
    const votesSnap = await getDocs(collection(db, "sessions", code, "votes"));
    const bluffsByQ = {};
    bluffsSnap.forEach((d) => {
      const data = d.data();
      (bluffsByQ[data.questionIndex] ||= {})[data.playerId] = data.text;
    });
    const votesByQ = {};
    votesSnap.forEach((d) => {
      const data = d.data();
      (votesByQ[data.questionIndex] ||= []).push(data);
    });

    const perQuestion = sess.questions.map((q, idx) => {
      const bluffs = bluffsByQ[idx] || {};
      const votes = votesByQ[idx] || [];
      const voteCounts = {};
      votes.forEach((v) => { voteCounts[v.votedFor] = (voteCounts[v.votedFor] || 0) + 1; });
      const correctText = q.options[q.correct[0]];
      const rows = playerIds.map((pid) => {
        const myVote = votes.find((v) => v.playerId === pid);
        const guessedRight = !!myVote && myVote.votedFor === "correct";
        const foolCount = voteCounts[pid] || 0;
        const bonus = foolCount * 250;
        const points = (guessedRight ? 500 : 0) + bonus;
        const votedLabel = myVote ? (myVote.votedFor === "correct" ? correctText : (bluffs[myVote.votedFor] || "?")) : "não votou";
        return {
          playerId: pid,
          name: players[pid].name,
          avatar: players[pid].avatar,
          answered: !!myVote,
          selectedLabels: `votou: ${votedLabel}${bluffs[pid] ? ` · blefe dele(a): "${bluffs[pid]}"` : ""}${foolCount ? ` · enganou ${foolCount}` : ""}`,
          timeMs: null,
          correct: guessedRight,
          points,
          combo: 0,
          bonus,
        };
      });
      return { text: q.text, correctLabels: correctText, rows };
    });

    const individualTotals = {};
    playerIds.forEach((pid) => {
      individualTotals[pid] = perQuestion.reduce((sum, q) => sum + (q.rows.find((r) => r.playerId === pid)?.points || 0), 0);
    });
    const individualStandings = playerIds.map((pid) => ({
      playerId: pid, name: players[pid].name, avatar: players[pid].avatar, team: players[pid].team || null, total: individualTotals[pid],
    })).sort((a, b) => b.total - a.total);
    const totals = (sess.teamMode || sess.gameMode === "cooperativo")
      ? buildLeaderboardRows({ gameMode: sess.gameMode, teamMode: sess.teamMode, players, totals: individualTotals })
          .map((row) => ({ playerId: row.id, name: row.name, avatar: row.avatar, total: row.total }))
      : individualStandings;

    reportData = { title: sess.title, code, gameMode: sess.gameMode, teamMode: sess.teamMode, perQuestion, totals, individualStandings: sess.teamMode ? individualStandings : null };
    if (view === "report") render();
    return;
  }

  const answersSnap = await getDocs(collection(db, "sessions", code, "answers"));
  const answers = {}; // `${idx}_${pid}` -> data
  answersSnap.forEach((d) => (answers[d.id] = d.data()));

  // recalcula pergunta por pergunta, na ordem, pra reconstruir o combo de
  // cada jogador exatamente como aconteceu ao vivo
  const perPlayerAnswers = {};
  playerIds.forEach((pid) => {
    perPlayerAnswers[pid] = sess.questions.map((q, idx) => {
      const ans = answers[`${idx}_${pid}`];
      let correct = false;
      if (ans) {
        const sel = [...(ans.selected || [])].sort().join(",");
        const cor = [...q.correct].sort().join(",");
        correct = sel === cor && sel !== "";
      }
      return { correct, timeMs: ans?.timeMs, timeLimit: q.timeLimit, multiplier: q.pointsMultiplier || 1, ans };
    });
  });
  const perPlayerScored = {};
  playerIds.forEach((pid) => {
    perPlayerScored[pid] = scoreQuestionSequence(perPlayerAnswers[pid], !!sess.precisionMode, !!sess.comboMode);
  });

  const perQuestion = sess.questions.map((q, idx) => {
    const rows = playerIds.map((pid) => {
      const item = perPlayerAnswers[pid][idx];
      const scored = perPlayerScored[pid][idx];
      const ans = item.ans;
      return {
        playerId: pid,
        name: players[pid].name,
        avatar: players[pid].avatar,
        answered: !!ans,
        selectedLabels: ans ? ans.selected.map((i) => q.options[i]).join(", ") : "—",
        timeMs: ans?.timeMs ?? null,
        correct: item.correct,
        points: scored.points,
        combo: scored.combo,
        bonus: scored.bonus,
      };
    });
    return { text: q.text, correctLabels: q.correct.map((i) => q.options[i]).join(", "), rows };
  });

  const individualTotals = {};
  playerIds.forEach((pid) => {
    individualTotals[pid] = perPlayerScored[pid].reduce((sum, s) => sum + s.points, 0);
  });
  const individualStandings = playerIds.map((pid) => ({
    playerId: pid, name: players[pid].name, avatar: players[pid].avatar, team: players[pid].team || null, total: individualTotals[pid],
  })).sort((a, b) => b.total - a.total);
  const totals = (sess.teamMode || sess.gameMode === "cooperativo")
    ? buildLeaderboardRows({ gameMode: sess.gameMode, teamMode: sess.teamMode, players, totals: individualTotals })
        .map((row) => ({ playerId: row.id, name: row.name, avatar: row.avatar, total: row.total }))
    : individualStandings;

  reportData = { title: sess.title, code, gameMode: sess.gameMode, teamMode: sess.teamMode, perQuestion, totals, individualStandings: sess.teamMode ? individualStandings : null };
  if (view === "report") render();
}

function renderReport() {
  if (!reportData) { root.innerHTML = `<button class="btn-link" id="report-back">← voltar</button><div class="spinner" style="margin-top:20px;"></div>`; document.getElementById("report-back").onclick = () => { view = "sessions"; render(); }; return; }
  const r = reportData;
  root.innerHTML = `
    <button class="btn-link" id="report-back">← voltar</button>
    <div class="eyebrow" style="margin-top:10px;">relatório · sala ${r.code} · ${GAME_MODES.find((m) => m.id === r.gameMode)?.label || "Clássico"}</div>
    <h1 style="font-size:24px; margin-top:4px;">${escapeHtml(r.title)}</h1>
    <div style="display:flex; gap:10px; margin-top:10px;">
      <button class="btn btn-ghost" id="csv-btn">Baixar CSV</button>
      <button class="btn btn-primary" id="pdf-btn">Baixar PDF</button>
    </div>

    <div class="card" style="margin-top:18px;">
      <div style="font-weight:700; margin-bottom:10px;">${r.teamMode ? "Classificação por equipe" : "Classificação final"}</div>
      ${r.totals.map((p, i) => `
        <div class="rank-row">
          <span class="rank-num" style="color:${i === 0 ? "var(--gold)" : "var(--text-dim)"};">${i + 1}</span>
          ${p.avatar ? `<span class="mini-avatar">${avatarSVG(p.avatar, 30)}</span>` : ""}
          <span style="flex:1; font-weight:600;">${escapeHtml(p.name)}</span>
          <span style="color:var(--gold); font-weight:700;">${p.total}</span>
          <button type="button" class="rank-remove" data-remove-player="${p.playerId}" title="remover jogador">✕</button>
        </div>
      `).join("")}
    </div>

    ${r.individualStandings ? `
    <div class="card" style="margin-top:14px;">
      <div style="font-weight:700; margin-bottom:10px;">Classificação individual (dentro do time)</div>
      ${r.individualStandings.map((p, i) => `
        <div class="rank-row">
          <span class="rank-num" style="color:${i === 0 ? "var(--gold)" : "var(--text-dim)"};">${i + 1}</span>
          ${p.avatar ? `<span class="mini-avatar">${avatarSVG(p.avatar, 30)}</span>` : ""}
          <span style="flex:1; font-weight:600;">${escapeHtml(p.name)} <span style="color:var(--text-dim); font-weight:400; font-size:12px;">· ${escapeHtml(p.team || "sem time")}</span></span>
          <span style="color:var(--gold); font-weight:700;">${p.total}</span>
        </div>
      `).join("")}
    </div>
    ` : ""}

    ${r.perQuestion.map((q, idx) => `
      <div class="card" style="margin-top:14px;">
        <div style="font-weight:700; margin-bottom:4px;">Pergunta ${idx + 1}</div>
        <div style="margin-bottom:4px;">${escapeHtml(q.text)}</div>
        <div style="font-size:12px; color:var(--green); margin-bottom:10px;">certa: ${escapeHtml(q.correctLabels)}</div>
        ${q.rows.map((row) => `
          <div class="rank-row" style="opacity:${row.answered ? 1 : 0.55};">
            <span class="mini-avatar">${avatarSVG(row.avatar, 26)}</span>
            <span style="flex:1;">
              <div style="font-weight:600; font-size:13px;">${escapeHtml(row.name)}</div>
              <div style="font-size:12px; color:var(--text-dim);">${escapeHtml(row.selectedLabels)}${row.timeMs != null ? ` · ${(row.timeMs / 1000).toFixed(1)}s` : ""}</div>
            </span>
            <span style="color:${row.correct ? "var(--green)" : "var(--coral)"}; font-weight:700; font-size:13px;">${row.correct ? `+${row.points}` : "0"}${row.combo >= 2 ? ` <span style="color:var(--gold); font-size:11px;">🔥x${row.combo} (+${row.bonus} bônus)</span>` : ""}</span>
          </div>
        `).join("")}
      </div>
    `).join("")}
  `;
  document.getElementById("report-back").onclick = () => { view = "sessions"; render(); };
  document.getElementById("csv-btn").onclick = () => downloadReportCsv(r);
  document.getElementById("pdf-btn").onclick = () => downloadReportPdf(r);
  root.querySelectorAll("[data-remove-player]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.removePlayer;
      const name = r.totals.find((p) => p.playerId === id)?.name || "jogador";
      const ok = await removePlayer(r.code, id, name, r.perQuestion.length);
      if (ok) openReport(r.code);
    };
  });
}

function downloadReportCsv(r) {
  const lines = [];
  lines.push([r.teamMode ? "Classificação por equipe" : "Classificação final"].join(";"));
  lines.push(["#", "Nome", "Pontos"].join(";"));
  r.totals.forEach((p, i) => lines.push([i + 1, `"${p.name.replace(/"/g, '""')}"`, p.total].join(";")));
  if (r.individualStandings) {
    lines.push("");
    lines.push(["Classificação individual (dentro do time)"].join(";"));
    lines.push(["#", "Jogador", "Time", "Pontos"].join(";"));
    r.individualStandings.forEach((p, i) => lines.push([i + 1, `"${p.name.replace(/"/g, '""')}"`, `"${(p.team || "sem time").replace(/"/g, '""')}"`, p.total].join(";")));
  }
  lines.push("");
  lines.push(["Pergunta", "Jogador", "Resposta", "Tempo (s)", "Certo?", "Combo", "Bônus (pts)", "Pontos"].join(";"));
  r.perQuestion.forEach((q, idx) => {
    q.rows.forEach((row) => {
      lines.push([
        `"${(idx + 1) + ". " + q.text.replace(/"/g, '""')}"`,
        `"${row.name.replace(/"/g, '""')}"`,
        `"${row.selectedLabels.replace(/"/g, '""')}"`,
        row.timeMs != null ? (row.timeMs / 1000).toFixed(1) : "",
        row.correct ? "sim" : "não",
        row.combo >= 2 ? `x${row.combo}` : "",
        row.combo >= 2 ? row.bonus : "",
        row.points,
      ].join(";"));
    });
  });
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `relatorio-${r.code}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadReportPdf(r) {
  const jsPDF = getJsPDF();
  if (!jsPDF) return;
  const doc = new jsPDF();
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();

  let y = addPdfHeader(doc, { eyebrow: "relatório do quiz", title: r.title, subtitle: `sala ${r.code} · ${GAME_MODES.find((m) => m.id === r.gameMode)?.label || "Clássico"}` });
  y = addSectionTitle(doc, r.teamMode ? "Classificação por equipe" : "Classificação geral", y);
  doc.autoTable({
    startY: y,
    head: [["#", "Jogador", "Pontos"]],
    body: r.totals.map((p, i) => [String(i + 1), p.name, String(p.total)]),
    ...AUTOTABLE_THEME,
    margin: { left: 14, right: 14 },
  });
  y = doc.lastAutoTable.finalY + 14;

  if (r.individualStandings) {
    if (y > pageH - 60) { doc.addPage(); y = 20; }
    y = addSectionTitle(doc, "Classificação individual (dentro do time)", y);
    doc.autoTable({
      startY: y,
      head: [["#", "Jogador", "Time", "Pontos"]],
      body: r.individualStandings.map((p, i) => [String(i + 1), p.name, p.team || "sem time", String(p.total)]),
      ...AUTOTABLE_THEME,
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 14;
  }

  r.perQuestion.forEach((q, idx) => {
    if (y > pageH - 50) { doc.addPage(); y = 20; }
    y = addSectionTitle(doc, `Pergunta ${idx + 1}`, y);
    doc.setFontSize(10);
    doc.setTextColor(...AUTOTABLE_THEME.bodyStyles.textColor);
    const qLines = doc.splitTextToSize(q.text, pageW - 28);
    doc.text(qLines, 14, y);
    y += qLines.length * 5 + 2;
    doc.setTextColor(23, 130, 90);
    doc.setFontSize(9);
    doc.text(`certa: ${q.correctLabels}`, 14, y);
    y += 6;

    doc.autoTable({
      startY: y,
      head: [["Jogador", "Resposta", "Tempo", "Certo?", "Combo", "Pontos"]],
      body: q.rows.map((row) => [
        row.name,
        row.selectedLabels,
        row.timeMs != null ? `${(row.timeMs / 1000).toFixed(1)}s` : "—",
        row.answered ? (row.correct ? "sim" : "não") : "não respondeu",
        row.combo >= 2 ? `x${row.combo} (+${row.bonus})` : "—",
        row.correct ? `+${row.points}` : "0",
      ]),
      ...AUTOTABLE_THEME,
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 12;
  });

  doc.save(`relatorio-${r.code}.pdf`);
}

/* ---------------- helpers de escape ---------------- */
function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }
