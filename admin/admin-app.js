import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, getDoc, getDocs, query, where, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig } from "../shared/firebase-config.js";
import { UNSPLASH_ACCESS_KEY } from "../shared/unsplash-config.js";
import { avatarSVG } from "../shared/avatar.js";
import { kahootPoints, questionMaxPoints } from "../shared/scoring.js";
import { getJsPDF, addPdfHeader, addSectionTitle, AUTOTABLE_THEME } from "../shared/pdf-helpers.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ---------------- estado ---------------- */
let view = "list"; // list | editor | control | sessions | report
let quizzes = [];
let unsubQuizzes = null;
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

const OPTION_COLORS = ["opt-0", "opt-1", "opt-2", "opt-3", "opt-4", "opt-5"];
const OPTION_SHAPES = ["opt-diamond", "opt-triangle", "opt-circle", "opt-square", "opt-pentagon", "opt-hexagon"];

const root = document.getElementById("app-root");

/* ---------------- autenticação ---------------- */
onAuthStateChanged(auth, (user) => {
  document.getElementById("login-screen").style.display = user ? "none" : "flex";
  document.getElementById("app-screen").style.display = user ? "flex" : "none";
  if (user) {
    view = "list";
    subscribeQuizzes();
    render();
  } else {
    unsubQuizzes && unsubQuizzes();
    unsubSession && unsubSession();
    unsubPlayers && unsubPlayers();
    unsubSessionsList && unsubSessionsList();
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

function emptyQuestion(timeLimit = 20) {
  return { id: rid(), text: "", type: "single", options: ["", ""], correct: [], timeLimit, pointsMultiplier: 1, imageUrl: null, imageCredit: null };
}
function emptyQuiz() {
  return { id: null, title: "", theme: "", coverImage: null, coverCredit: null, defaultTimeLimit: 20, questions: [] };
}

function subscribeQuizzes() {
  unsubQuizzes && unsubQuizzes();
  unsubQuizzes = onSnapshot(collection(db, "quizzes"), (snap) => {
    quizzes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (view === "list") render();
  });
}

/* ---------------- render raiz ---------------- */
function render() {
  try {
    if (view === "list") return renderList();
    if (view === "editor") return renderEditor();
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
      <button class="nav-tab ${active === "sessions" ? "active" : ""}" id="nav-sessions">Sessões</button>
    </div>
  `;
}
function bindNavTabs() {
  document.getElementById("nav-quizzes").onclick = () => { view = "list"; render(); };
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
    document.getElementById(`open-${q.id}`)?.addEventListener("click", () => launchSession(q));
    document.getElementById(`del-${q.id}`)?.addEventListener("click", () => deleteQuiz(q));
  });
}

function quizCardHtml(q) {
  return `
    <div class="quiz-card">
      <div class="cover" style="${q.coverImage ? `background-image:url('${q.coverImage}')` : ""}"></div>
      <div class="body">
        <div class="theme-tag">${escapeHtml(q.theme || "sem tema")}</div>
        <div class="title">${escapeHtml(q.title || "Sem título")}</div>
        <div class="meta">${(q.questions || []).length} pergunta${(q.questions || []).length !== 1 ? "s" : ""}</div>
        <div class="actions">
          <button class="btn btn-primary" id="open-${q.id}">Abrir sala</button>
          <button class="btn btn-ghost" id="edit-${q.id}">Editar</button>
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

async function launchSession(quiz) {
  let code = genCode();
  // evita colisão de código (raro, mas confere)
  let existing = await getDoc(doc(db, "sessions", code));
  while (existing.exists()) {
    code = genCode();
    existing = await getDoc(doc(db, "sessions", code));
  }
  const session = {
    quizId: quiz.id,
    title: quiz.title,
    status: "lobby",
    questions: quiz.questions,
    currentIndex: -1,
    questionStartedAt: null,
    createdAt: serverTimestamp(),
    leaderboardTop: [],
    finalLeaderboard: [],
  };
  await setDoc(doc(db, "sessions", code), session);
  openControl(code);
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

    <div style="display:flex; align-items:center; gap:10px; margin-bottom:20px;">
      <label style="font-size:13px; color:var(--text-dim); white-space:nowrap;">Tempo padrão por pergunta</label>
      <input class="input" type="number" id="quiz-default-time" min="5" max="60" value="${q.defaultTimeLimit || 20}" style="width:70px;" />
      <span style="font-size:13px; color:var(--text-dim);">s</span>
      <button type="button" class="btn-link" id="apply-time-all" style="margin-left:auto;">aplicar a todas as perguntas já criadas</button>
    </div>

    <div id="question-list"></div>

    <div class="card" style="margin-top:6px;">
      <div style="font-weight:700; margin-bottom:12px; font-family:var(--font-display);" id="draft-heading">
        ${questionEditingIdx === null ? "Nova pergunta" : "Editar pergunta"}
      </div>
      <div id="question-form"></div>
    </div>

    <button class="btn btn-success btn-block" id="save-quiz-btn" style="margin-top:22px;">Salvar quiz</button>
    <div id="editor-error" class="error-text"></div>
  `;

  document.getElementById("back-btn").onclick = () => { view = "list"; render(); };
  document.getElementById("quiz-title").oninput = (e) => (q.title = e.target.value);
  document.getElementById("quiz-theme").oninput = (e) => (q.theme = e.target.value);
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

  renderQuestionList();
  if (!questionDraft) questionDraft = emptyQuestion(q.defaultTimeLimit || 20);
  renderQuestionForm();
}

function renderQuestionList() {
  const q = quizDraft;
  const el = document.getElementById("question-list");
  if (!q.questions.length) {
    el.innerHTML = `<div style="color:var(--text-dim); margin-bottom:16px; font-size:13px;">Nenhuma pergunta ainda — adicione abaixo.</div>`;
    return;
  }
  el.innerHTML = q.questions.map((item, i) => `
    <div class="q-row">
      ${item.imageUrl ? `<img src="${item.imageUrl}" />` : ""}
      <div class="info">
        <div class="meta">${i + 1}. ${typeLabel(item.type)} · ${item.timeLimit}s${item.pointsMultiplier > 1 ? ` · <span style="color:var(--gold);">bônus ${item.pointsMultiplier}x</span>` : ""}</div>
        <div class="text">${escapeHtml(item.text)}</div>
      </div>
      <button class="btn-link" id="qedit-${i}">editar</button>
      <button class="btn-link" id="qdel-${i}" style="color:var(--coral);">excluir</button>
    </div>
  `).join("");
  q.questions.forEach((_, i) => {
    document.getElementById(`qedit-${i}`).onclick = () => {
      questionDraft = JSON.parse(JSON.stringify(q.questions[i]));
      questionEditingIdx = i;
      renderEditor();
    };
    document.getElementById(`qdel-${i}`).onclick = () => {
      q.questions.splice(i, 1);
      renderEditor();
    };
  });
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
        ${d.imageCredit ? `<div class="image-credit">Foto: <a href="${d.imageCredit.link}" target="_blank">${escapeHtml(d.imageCredit.name)}</a> / Unsplash</div>` : ""}
      </div>
    </div>

    <textarea class="input" id="q-text" placeholder="Escreva a pergunta..." style="min-height:60px; margin-bottom:12px;">${escapeHtml(d.text)}</textarea>

    <div style="display:flex; gap:10px; margin-bottom:12px; flex-wrap:wrap;">
      <select class="input" id="q-type" style="flex:1; min-width:160px;">
        <option value="single" ${d.type === "single" ? "selected" : ""}>Escolha única</option>
        <option value="multiple" ${d.type === "multiple" ? "selected" : ""}>Múltipla escolha (2+ certas)</option>
        <option value="tf" ${d.type === "tf" ? "selected" : ""}>Verdadeiro ou Falso</option>
      </select>
      <div style="display:flex; align-items:center; gap:8px; color:var(--text-dim); font-size:13px;">
        <span>tempo (s)</span>
        <input class="input" type="number" id="q-time" min="5" max="60" value="${d.timeLimit}" style="width:70px;" />
      </div>
      <div style="display:flex; align-items:center; gap:8px; color:var(--text-dim); font-size:13px;">
        <span>pontuação</span>
        <select class="input" id="q-multiplier" style="width:110px;">
          <option value="1" ${(d.pointsMultiplier || 1) === 1 ? "selected" : ""}>normal (1x)</option>
          <option value="2" ${(d.pointsMultiplier || 1) === 2 ? "selected" : ""}>bônus (2x)</option>
          <option value="3" ${(d.pointsMultiplier || 1) === 3 ? "selected" : ""}>bônus (3x)</option>
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
  document.getElementById("q-text").oninput = (e) => (d.text = e.target.value);
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
    questionDraft = emptyQuestion(quizDraft.defaultTimeLimit || 20); questionEditingIdx = null; renderQuestionForm(); document.getElementById("draft-heading").textContent = "Nova pergunta";
  });
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
      <input class="input" data-opt="${i}" placeholder="Opção ${i + 1}" value="${escapeAttr(opt)}" style="flex:1;" />
      <label class="check-label"><input type="checkbox" data-correct="${i}" ${d.correct.includes(i) ? "checked" : ""}/> certa</label>
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
  questionDraft = emptyQuestion(quizDraft.defaultTimeLimit || 20);
  questionEditingIdx = null;
  renderEditor();
}

async function saveQuiz() {
  const q = quizDraft;
  const errEl = document.getElementById("editor-error");
  if (!q.title.trim()) return (errEl.textContent = "Dê um título ao quiz.");
  if (q.questions.length === 0) return (errEl.textContent = "Adicione ao menos uma pergunta.");
  errEl.textContent = "";
  const payload = { title: q.title.trim(), theme: q.theme.trim(), coverImage: q.coverImage, coverCredit: q.coverCredit, defaultTimeLimit: q.defaultTimeLimit || 20, questions: q.questions, updatedAt: serverTimestamp() };
  if (q.id) {
    await updateDoc(doc(db, "quizzes", q.id), payload);
  } else {
    await addDoc(collection(db, "quizzes"), { ...payload, createdAt: serverTimestamp() });
  }
  view = "list";
  render();
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
  unsubSession = onSnapshot(doc(db, "sessions", code), (snap) => {
    sessionData = snap.data();
    if (view === "control") render();
  });
  unsubPlayers = onSnapshot(collection(db, "sessions", code, "players"), (snap) => {
    sessionPlayers = {};
    snap.forEach((d) => (sessionPlayers[d.id] = d.data()));
    if (view === "control" && sessionData?.status === "lobby") render();
  });
}

function renderControl() {
  if (!sessionData) { root.innerHTML = `<div class="spinner"></div>`; return; }
  const s = sessionData;
  if (s.status === "lobby") return renderLobby();
  if (s.status === "question") return renderQuestionLive();
  if (s.status === "reveal") return renderReveal();
  if (s.status === "leaderboard") return renderLeaderboard();
  if (s.status === "ended") return renderEnded();
}

function renderLobby() {
  const players = Object.values(sessionPlayers);
  const joinUrl = new URL(`../jogo/index.html?code=${sessionCode}`, window.location.href).href;
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
      <div style="font-weight:700; margin-bottom:10px;">Jogadores (${players.length})</div>
      <div class="player-pill-list">
        ${players.map((p) => `<span class="pill" style="display:inline-flex; align-items:center; gap:6px;"><span class="mini-avatar">${avatarSVG(p.avatar, 24)}</span>${escapeHtml(p.name)}</span>`).join("") || `<span style="color:var(--text-dim); font-size:13px;">Aguardando entrarem...</span>`}
      </div>
    </div>
    <button class="btn btn-primary btn-block" id="begin-btn" style="margin-top:22px;" ${players.length === 0 ? "disabled" : ""}>Começar jogo →</button>
  `;
  document.getElementById("control-back").onclick = () => { view = "list"; unsubSession(); unsubPlayers(); render(); };
  document.getElementById("begin-btn").onclick = beginGame;

  document.getElementById("qr-canvas").innerHTML = "";
  if (window.QRCode) {
    new QRCode(document.getElementById("qr-canvas"), {
      text: joinUrl, width: 180, height: 180,
      colorDark: "#0B0E1A", colorLight: "#ffffff",
    });
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
  await updateDoc(doc(db, "sessions", sessionCode), { status: "question", currentIndex: 0, questionStartedAt: Date.now() });
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
    ${q.imageUrl ? `<img src="${q.imageUrl}" style="width:100%; max-height:220px; object-fit:cover; border-radius:14px; margin-top:14px;" />` : ""}
    <h2 style="text-align:center; font-size:22px; margin:14px 0;">${escapeHtml(q.text)}</h2>
    <div class="grid-2">
      ${q.options.map((opt, i) => `
        <div class="option-btn ${OPTION_COLORS[i % 6]}" style="cursor:default;">
          <span class="${OPTION_SHAPES[i % 6]}"></span><span>${escapeHtml(opt)}</span>
        </div>
      `).join("")}
    </div>
    <div id="answered-count" style="color:var(--text-dim); margin-top:18px; text-align:center;">carregando respostas...</div>
    <button class="btn btn-primary btn-block" id="reveal-btn" style="margin-top:18px;">Revelar respostas</button>
  `;
  draw();
  liveTimerInt = setInterval(draw, 250);
  document.getElementById("reveal-btn").onclick = revealAnswers;
  pollAnsweredCount();
}

let answeredPollInt = null;
function pollAnsweredCount() {
  clearInterval(answeredPollInt);
  const tick = async () => {
    const q = query(collection(db, "sessions", sessionCode, "answers"), where("questionIndex", "==", sessionData.currentIndex));
    const snap = await getDocs(q);
    const el = document.getElementById("answered-count");
    if (el) el.textContent = `${snap.size} de ${Object.keys(sessionPlayers).length} responderam`;
  };
  tick();
  answeredPollInt = setInterval(tick, 2000);
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

  for (const pid of Object.keys(sessionPlayers)) {
    const prevScoreSnap = await getDoc(doc(db, "sessions", sessionCode, "scores", pid));
    const prevTotal = prevScoreSnap.exists() ? prevScoreSnap.data().total || 0 : 0;
    let pts = 0, correct = false;
    const ans = answersByPlayer[pid];
    if (ans) {
      (ans.selected || []).forEach((i) => { if (stats[i] !== undefined) stats[i]++; });
      const sel = [...(ans.selected || [])].sort().join(",");
      const cor = [...q.correct].sort().join(",");
      correct = sel === cor && sel !== "";
      if (correct) pts = kahootPoints(ans.timeMs, q.timeLimit, q.pointsMultiplier || 1);
    }
    writes.push(setDoc(doc(db, "sessions", sessionCode, "scores", pid), { total: prevTotal + pts, lastPoints: pts, lastCorrect: correct }));
  }
  await Promise.all(writes);
  revealStats = stats;
  await updateDoc(doc(db, "sessions", sessionCode), { status: "reveal" });
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
          <div class="bar-track">
            <div class="bar-fill ${OPTION_COLORS[i % 6]}" style="width:${pct}%;"></div>
            <div class="bar-label">${escapeHtml(opt)} ${isCorrect ? "✓" : ""}</div>
          </div>
          <span style="width:30px; text-align:right; font-size:13px; color:var(--text-dim);">${count}</span>
        </div>`;
    }).join("")}
    <button class="btn btn-primary btn-block" id="leaderboard-btn" style="margin-top:18px;">Ver placar →</button>
  `;
  document.getElementById("leaderboard-btn").onclick = showLeaderboard;
}

async function showLeaderboard() {
  const scoresSnap = await getDocs(collection(db, "sessions", sessionCode, "scores"));
  const top = scoresSnap.docs
    .map((d) => ({ id: d.id, name: sessionPlayers[d.id]?.name || "?", avatar: sessionPlayers[d.id]?.avatar, total: d.data().total || 0 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
  await updateDoc(doc(db, "sessions", sessionCode), { status: "leaderboard", leaderboardTop: top });
}

function renderLeaderboard() {
  const s = sessionData;
  root.innerHTML = `
    <div class="eyebrow" style="text-align:center;">placar</div>
    <h2 style="text-align:center; font-size:24px; margin-top:6px;">Colocação</h2>
    <div style="margin-top:16px;">
      ${s.leaderboardTop.map((p, i) => `
        <div class="rank-row">
          <span class="rank-num" style="color:${i === 0 ? "var(--gold)" : "var(--text-dim)"};">${i + 1}</span>
          <span class="mini-avatar">${avatarSVG(p.avatar, 30)}</span>
          <span style="flex:1; font-weight:600;">${escapeHtml(p.name)}</span>
          <span style="color:var(--gold); font-weight:700;">${p.total}</span>
        </div>
      `).join("")}
    </div>
    <button class="btn btn-primary btn-block" id="next-btn" style="margin-top:18px;">
      ${s.currentIndex + 1 >= s.questions.length ? "Ver resultado final →" : "Próxima pergunta →"}
    </button>
  `;
  document.getElementById("next-btn").onclick = nextQuestion;
}

async function nextQuestion() {
  const s = sessionData;
  const nextIdx = s.currentIndex + 1;
  if (nextIdx >= s.questions.length) {
    const scoresSnap = await getDocs(collection(db, "sessions", sessionCode, "scores"));
    const final = scoresSnap.docs
      .map((d) => ({ id: d.id, name: sessionPlayers[d.id]?.name || "?", avatar: sessionPlayers[d.id]?.avatar, total: d.data().total || 0 }))
      .sort((a, b) => b.total - a.total);
    await updateDoc(doc(db, "sessions", sessionCode), { status: "ended", finalLeaderboard: final });
    return;
  }
  revealStats = null;
  await updateDoc(doc(db, "sessions", sessionCode), { status: "question", currentIndex: nextIdx, questionStartedAt: Date.now() });
}

function renderEnded() {
  const s = sessionData;
  root.innerHTML = `
    <div style="font-size:48px; text-align:center;">🏆</div>
    <h2 style="text-align:center; font-size:24px;">Resultado final</h2>
    <div style="margin-top:16px;">
      ${s.finalLeaderboard.map((p, i) => `
        <div class="rank-row">
          <span class="rank-num" style="color:${i === 0 ? "var(--gold)" : "var(--text-dim)"};">${i + 1}</span>
          <span class="mini-avatar">${avatarSVG(p.avatar, 30)}</span>
          <span style="flex:1; font-weight:600;">${escapeHtml(p.name)}</span>
          <span style="color:var(--gold); font-weight:700;">${p.total}</span>
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
    view = "list";
    render();
  };
}

/* ================= SESSÕES (HISTÓRICO) ================= */
function subscribeSessionsList() {
  unsubSessionsList && unsubSessionsList();
  unsubSessionsList = onSnapshot(query(collection(db, "sessions"), orderBy("createdAt", "desc")), (snap) => {
    sessionsList = snap.docs.map((d) => ({ code: d.id, ...d.data() }));
    if (view === "sessions") render();
  });
}

const STATUS_LABEL = { lobby: "aguardando", question: "em andamento", reveal: "em andamento", leaderboard: "em andamento", ended: "encerrada" };

function renderSessions() {
  root.innerHTML = `
    ${navTabsHtml("sessions")}
    <h1 style="font-size:24px; margin-top:16px;">Sessões</h1>
    <div style="margin-top:14px;">
      ${sessionsList.map((s) => `
        <div class="q-row" style="align-items:center;">
          <div class="info">
            <div class="meta">${s.code} · ${STATUS_LABEL[s.status] || s.status}${s.createdAt?.toDate ? " · " + s.createdAt.toDate().toLocaleString("pt-BR") : ""}</div>
            <div class="text">${escapeHtml(s.title || "")}</div>
          </div>
          <button class="btn btn-ghost" id="open-session-${s.code}">${s.status === "ended" ? "Ver relatório" : "Abrir controle"}</button>
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
  });
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
  const answersSnap = await getDocs(collection(db, "sessions", code, "answers"));
  const answers = {}; // `${idx}_${pid}` -> data
  answersSnap.forEach((d) => (answers[d.id] = d.data()));

  const playerIds = Object.keys(players);
  const perQuestion = sess.questions.map((q, idx) => {
    const rows = playerIds.map((pid) => {
      const ans = answers[`${idx}_${pid}`];
      let correct = false, points = 0;
      if (ans) {
        const sel = [...(ans.selected || [])].sort().join(",");
        const cor = [...q.correct].sort().join(",");
        correct = sel === cor && sel !== "";
        if (correct) points = kahootPoints(ans.timeMs, q.timeLimit, q.pointsMultiplier || 1);
      }
      return {
        playerId: pid,
        name: players[pid].name,
        avatar: players[pid].avatar,
        answered: !!ans,
        selectedLabels: ans ? ans.selected.map((i) => q.options[i]).join(", ") : "—",
        timeMs: ans?.timeMs ?? null,
        correct, points,
      };
    });
    return { text: q.text, correctLabels: q.correct.map((i) => q.options[i]).join(", "), rows };
  });

  const totals = playerIds.map((pid) => ({
    playerId: pid,
    name: players[pid].name,
    avatar: players[pid].avatar,
    total: perQuestion.reduce((sum, q) => sum + (q.rows.find((r) => r.playerId === pid)?.points || 0), 0),
  })).sort((a, b) => b.total - a.total);

  reportData = { title: sess.title, code, perQuestion, totals };
  if (view === "report") render();
}

function renderReport() {
  if (!reportData) { root.innerHTML = `<button class="btn-link" id="report-back">← voltar</button><div class="spinner" style="margin-top:20px;"></div>`; document.getElementById("report-back").onclick = () => { view = "sessions"; render(); }; return; }
  const r = reportData;
  root.innerHTML = `
    <button class="btn-link" id="report-back">← voltar</button>
    <div class="eyebrow" style="margin-top:10px;">relatório · sala ${r.code}</div>
    <h1 style="font-size:24px; margin-top:4px;">${escapeHtml(r.title)}</h1>
    <div style="display:flex; gap:10px; margin-top:10px;">
      <button class="btn btn-ghost" id="csv-btn">Baixar CSV</button>
      <button class="btn btn-primary" id="pdf-btn">Baixar PDF</button>
    </div>

    <div class="card" style="margin-top:18px;">
      <div style="font-weight:700; margin-bottom:10px;">Classificação final</div>
      ${r.totals.map((p, i) => `
        <div class="rank-row">
          <span class="rank-num" style="color:${i === 0 ? "var(--gold)" : "var(--text-dim)"};">${i + 1}</span>
          <span class="mini-avatar">${avatarSVG(p.avatar, 30)}</span>
          <span style="flex:1; font-weight:600;">${escapeHtml(p.name)}</span>
          <span style="color:var(--gold); font-weight:700;">${p.total}</span>
        </div>
      `).join("")}
    </div>

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
            <span style="color:${row.correct ? "var(--green)" : "var(--coral)"}; font-weight:700; font-size:13px;">${row.correct ? `+${row.points}` : "0"}</span>
          </div>
        `).join("")}
      </div>
    `).join("")}
  `;
  document.getElementById("report-back").onclick = () => { view = "sessions"; render(); };
  document.getElementById("csv-btn").onclick = () => downloadReportCsv(r);
  document.getElementById("pdf-btn").onclick = () => downloadReportPdf(r);
}

function downloadReportCsv(r) {
  const lines = [["Pergunta", "Jogador", "Resposta", "Tempo (s)", "Certo?", "Pontos"].join(";")];
  r.perQuestion.forEach((q, idx) => {
    q.rows.forEach((row) => {
      lines.push([
        `"${(idx + 1) + ". " + q.text.replace(/"/g, '""')}"`,
        `"${row.name.replace(/"/g, '""')}"`,
        `"${row.selectedLabels.replace(/"/g, '""')}"`,
        row.timeMs != null ? (row.timeMs / 1000).toFixed(1) : "",
        row.correct ? "sim" : "não",
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

  let y = addPdfHeader(doc, { eyebrow: "relatório do quiz", title: r.title, subtitle: `sala ${r.code}` });
  y = addSectionTitle(doc, "Classificação geral", y);
  doc.autoTable({
    startY: y,
    head: [["#", "Jogador", "Pontos"]],
    body: r.totals.map((p, i) => [String(i + 1), p.name, String(p.total)]),
    ...AUTOTABLE_THEME,
    margin: { left: 14, right: 14 },
  });
  y = doc.lastAutoTable.finalY + 14;

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
      head: [["Jogador", "Resposta", "Tempo", "Certo?", "Pontos"]],
      body: q.rows.map((row) => [
        row.name,
        row.selectedLabels,
        row.timeMs != null ? `${(row.timeMs / 1000).toFixed(1)}s` : "—",
        row.answered ? (row.correct ? "sim" : "não") : "não respondeu",
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
