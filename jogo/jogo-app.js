import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, collection, setDoc, deleteDoc, getDoc, getDocs, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig } from "../shared/firebase-config.js";
import { AVATAR_COLORS, SPECIES, SPECIES_LABEL, HATS, GLASSES, defaultAvatar, avatarSVG, avatarPngDataUrl } from "../shared/avatar.js";
import { lateJoinAllowed, questionMaxPoints, scoreQuestionSequence } from "../shared/scoring.js";
import { getJsPDF, addPdfHeader, addSectionTitle, AUTOTABLE_THEME } from "../shared/pdf-helpers.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const OPTION_COLORS = ["opt-0", "opt-1", "opt-2", "opt-3", "opt-4", "opt-5"];
const OPTION_SHAPES = ["opt-diamond", "opt-triangle", "opt-circle", "opt-square", "opt-pentagon", "opt-hexagon"];

const root = document.getElementById("app-root");
const rid = () => Math.random().toString(36).slice(2, 10);

let view = "join";
let code = null;
let playerId = null;
let playerName = "";
let avatarDraft = defaultAvatar();
let joinCodeValue = "";
let joinNameValue = "";
let sessionData = null;
let myScore = null;
let mySelected = [];
let hasAnswered = false;
let lastIndexAnswered = -1;
let unsubSession = null;
let unsubScore = null;
let liveTimerInt = null;
let joinSessionPreview = null;
let selectedTeam = null;
let myTeam = null;
let raceIndex = 0;
let raceSelected = [];
let raceQuestionShownAt = 0;
let raceFeedback = null;

/* tenta retomar sessão salva no navegador (se a pessoa recarregar a página) —
   mas só se aquela sessão ainda existir e não tiver acabado; caso
   contrário, limpa e mostra a tela normal de entrada com código */
function viewForStatus(status) {
  if (status === "question") return "question";
  if (status === "reveal") return "reveal";
  if (status === "leaderboard") return "leaderboard";
  if (status === "racing") return "race";
  if (status === "ended") return "end";
  return "wait";
}

async function boot() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem("quiz-player") || "null");
  } catch {
    localStorage.removeItem("quiz-player");
  }
  const params = new URLSearchParams(window.location.search);
  const codeFromUrl = params.get("code");

  if (saved?.code && saved?.playerId) {
    try {
      const snap = await getDoc(doc(db, "sessions", saved.code));
      if (snap.exists() && snap.data().status !== "ended") {
        code = saved.code; playerId = saved.playerId; playerName = saved.name;
        if (saved.avatar) avatarDraft = saved.avatar;
        if (saved.team) myTeam = saved.team;
        sessionData = snap.data();
        lastIndexAnswered = sessionData.status === "lobby" ? -1 : sessionData.currentIndex;
        if (sessionData.status === "question") {
          const ansSnap = await getDoc(doc(db, "sessions", code, "answers", `${sessionData.currentIndex}_${playerId}`));
          hasAnswered = ansSnap.exists();
        }
        if (sessionData.status === "racing") startRace();
        view = viewForStatus(sessionData.status);
        subscribeSession();
        render();
        return;
      }
    } catch { /* segue pro fluxo normal abaixo */ }
    localStorage.removeItem("quiz-player");
  }

  if (codeFromUrl && /^\d{6}$/.test(codeFromUrl)) {
    joinCodeValue = codeFromUrl;
  }
  render();
}

boot().catch((err) => {
  console.error("Erro ao iniciar:", err);
  root.innerHTML = `
    <div class="eyebrow" style="color:var(--coral);">algo deu errado</div>
    <h1 style="font-size:20px; margin-top:6px;">Não consegui carregar o jogo</h1>
    <p style="color:var(--text-dim); margin-top:8px; font-size:13px;">Tenta recarregar a página.</p>
    <button class="btn btn-primary btn-block" id="reload-btn" style="margin-top:18px;">Recarregar</button>
  `;
  document.getElementById("reload-btn")?.addEventListener("click", () => window.location.reload());
});

/* ---------------- helpers ---------------- */
function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function subscribeSession() {
  unsubSession && unsubSession();
  unsubSession = onSnapshot(doc(db, "sessions", code), (snap) => {
    if (!snap.exists()) return;
    sessionData = snap.data();
    reactToStatus();
    render();
  });
  unsubScore && unsubScore();
  unsubScore = onSnapshot(doc(db, "sessions", code, "scores", playerId), (snap) => {
    myScore = snap.exists() ? snap.data() : null;
    if (view === "reveal" || view === "leaderboard" || view === "end") render();
  });
}

// Antes, essa função só avançava a tela se o jogador estivesse vindo
// exatamente da tela anterior esperada (tipo uma corrente). Em celulares
// que perdem um "degrau" — app em segundo plano, rede instável, tela
// bloqueada — o Firestore entrega só o estado mais recente, pulando os
// intermediários, e a corrente quebrava: o jogador ficava preso na tela
// velha pra sempre, mesmo o jogo já tendo avançado lá na frente.
//
// Agora a tela é recalculada direto a partir do status atual da sessão,
// sem depender de onde o jogador estava antes — se autocorrige sozinha
// mesmo perdendo atualizações no meio do caminho.
function reactToStatus() {
  const s = sessionData;
  if (!s) return;

  if (s.status === "ended") {
    view = "end";
    unsubSession && unsubSession();
    unsubScore && unsubScore();
    return;
  }
  if (s.status === "question") {
    if (s.currentIndex !== lastIndexAnswered) {
      lastIndexAnswered = -2; // marca que ainda não respondeu essa
      mySelected = [];
      hasAnswered = false;
    }
    view = "question";
    return;
  }
  if (s.status === "reveal") { view = "reveal"; return; }
  if (s.status === "leaderboard") { view = "leaderboard"; return; }
  if (s.status === "racing") {
    if (view !== "race") startRace();
    view = "race";
    return;
  }
  if (s.status === "lobby") view = "wait";
}

/* ---------------- corrida livre ---------------- */

function startRace() {
  raceIndex = 0;
  raceSelected = [];
  raceQuestionShownAt = Date.now();
  raceFeedback = null;
}

function renderRace() {
  const s = sessionData;
  root.className = "container left";
  const totalElapsed = (Date.now() - (s.raceStartedAt || Date.now())) / 1000;
  const remaining = Math.max(0, Math.ceil((s.raceDurationSec || 0) - totalElapsed));

  if (remaining <= 0 || raceIndex >= s.questions.length) {
    root.className = "container";
    root.innerHTML = `
      <div class="eyebrow">corrida</div>
      <h1 style="font-size:22px; margin-top:8px;">${raceIndex >= s.questions.length ? "Você terminou! 🏁" : "Tempo esgotado!"}</h1>
      <p style="color:var(--text-dim); margin-top:8px;">Aguardando o fim da corrida pra todo mundo...</p>
      <div style="color:var(--gold); font-weight:700; margin-top:14px;">Total: ${myScore?.total ?? 0} pontos</div>
    `;
    return;
  }

  if (raceFeedback) {
    root.className = "container";
    root.innerHTML = `
      <div class="big-emoji">${raceFeedback.correct ? "✅" : "❌"}</div>
      <div style="color:var(--gold); font-weight:700; margin-top:6px; font-size:18px;">${raceFeedback.correct ? `+${raceFeedback.points}` : "0"} pontos</div>
    `;
    return;
  }

  const q = s.questions[raceIndex];
  root.innerHTML = `
    <div class="eyebrow">pergunta ${raceIndex + 1} de ${s.questions.length} · ${remaining}s restantes na corrida</div>
    ${q.imageUrl ? `<img class="q-image" src="${q.imageUrl}" style="margin-top:12px;" />` : ""}
    <h2 style="font-size:19px; margin:10px 0 14px;">${escapeHtml(q.text)}</h2>
    <div style="display:flex; flex-direction:column; gap:10px;" id="race-options"></div>
    ${q.type === "multiple" ? `<button class="btn btn-primary btn-block" id="race-confirm" style="margin-top:16px;" disabled>Confirmar resposta</button>` : ""}
  `;

  const optsEl = document.getElementById("race-options");
  optsEl.innerHTML = q.options.map((opt, i) => `
    <button type="button" class="option-btn ${OPTION_COLORS[i % 6]}" data-i="${i}" data-selected="false">
      <span class="${OPTION_SHAPES[i % 6]}"></span><span>${escapeHtml(opt)}</span>
    </button>
  `).join("");
  optsEl.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.i);
      if (q.type === "multiple") {
        const idx = raceSelected.indexOf(i);
        if (idx >= 0) raceSelected.splice(idx, 1); else raceSelected.push(i);
        btn.dataset.selected = raceSelected.includes(i) ? "true" : "false";
        document.getElementById("race-confirm").disabled = raceSelected.length === 0;
      } else {
        submitRaceAnswer([i]);
      }
    };
  });
  document.getElementById("race-confirm")?.addEventListener("click", () => submitRaceAnswer());

  liveTimerInt = setInterval(() => {
    if (view !== "race" || raceFeedback) return;
    const el = (Date.now() - (s.raceStartedAt || Date.now())) / 1000;
    const rem = Math.max(0, Math.ceil((s.raceDurationSec || 0) - el));
    if (rem <= 0) render();
  }, 1000);
}

// No modo corrida não tem admin corrigindo pergunta por pergunta — cada
// jogador já sabe na hora se acertou (a resposta certa já está visível
// no próprio quiz que ele recebeu) e grava a própria pontuação. É um modo
// pensado pra brincadeiras casuais, não pra prova de vestibular: dá pra
// alguém adulterar a própria pontuação mexendo direto no banco. As
// regras do Firestore só liberam essa gravação quando o quiz está
// mesmo configurado como corrida.
async function submitRaceAnswer(sel) {
  const s = sessionData;
  const q = s.questions[raceIndex];
  const selected = sel || raceSelected;
  if (selected.length === 0) return;

  const timeMs = Date.now() - raceQuestionShownAt;
  const selKey = [...selected].sort().join(",");
  const corKey = [...(q.correct || [])].sort().join(",");
  const correct = selKey === corKey && selKey !== "";
  const points = correct ? kahootPoints(timeMs, q.timeLimit, q.pointsMultiplier || 1, !!s.precisionMode) : 0;

  await setDoc(doc(db, "sessions", code, "answers", `${raceIndex}_${playerId}`), {
    playerId, questionIndex: raceIndex, selected, timeMs, submittedAt: Date.now(),
  }).catch(() => {});

  const prevTotal = myScore?.total || 0;
  const newTotal = prevTotal + points;
  try {
    await setDoc(doc(db, "sessions", code, "scores", playerId), { total: newTotal, lastPoints: points, lastCorrect: correct }, { merge: true });
  } catch { /* se a gravação falhar, a corrida segue mesmo assim */ }
  myScore = { ...(myScore || {}), total: newTotal, lastPoints: points, lastCorrect: correct };

  raceFeedback = { correct, points };
  render();
  setTimeout(() => {
    raceFeedback = null;
    raceIndex += 1;
    raceSelected = [];
    raceQuestionShownAt = Date.now();
    render();
  }, 900);
}

/* ---------------- ações ---------------- */

async function goToAvatarStep(inputCode, inputName) {
  const c = inputCode.trim();
  const nm = inputName.trim();
  if (!/^\d{6}$/.test(c)) return showJoinError("Digite o código de 6 dígitos da sala.");
  if (!nm) return showJoinError("Digite seu nome.");
  const snap = await getDoc(doc(db, "sessions", c));
  if (!snap.exists()) return showJoinError("Não encontrei essa sala. Confira o código.");
  const s = snap.data();
  if (s.status === "ended") return showJoinError("Essa sala já foi encerrada.");
  if (s.status !== "lobby" && !lateJoinAllowed(s.questions, s.currentIndex)) {
    return showJoinError("Esse quiz já passou da metade — não dá mais pra entrar agora.");
  }
  joinSessionPreview = s;
  selectedTeam = s.teamMode && s.teams?.length ? s.teams[0] : null;
  joinCodeValue = c;
  joinNameValue = nm;
  view = "avatar";
  render();
}

async function joinRoom() {
  const c = joinCodeValue;
  const nm = joinNameValue;
  const pid = rid();
  const playerDoc = { name: nm, avatar: avatarDraft, joinedAt: Date.now() };
  if (selectedTeam) playerDoc.team = selectedTeam;
  myTeam = selectedTeam;
  await setDoc(doc(db, "sessions", c, "players", pid), playerDoc);
  const snap = await getDoc(doc(db, "sessions", c));
  code = c; playerId = pid; playerName = nm;
  localStorage.setItem("quiz-player", JSON.stringify({ code, playerId, name: nm, avatar: avatarDraft, team: myTeam }));
  sessionData = snap.data();
  lastIndexAnswered = sessionData.status === "lobby" ? -1 : sessionData.currentIndex;
  if (sessionData.status === "question") {
    const ansSnap = await getDoc(doc(db, "sessions", code, "answers", `${sessionData.currentIndex}_${playerId}`));
    hasAnswered = ansSnap.exists();
  }
  if (sessionData.status === "racing") startRace();
  view = viewForStatus(sessionData.status);
  subscribeSession();
  render();
}

function showJoinError(msg) {
  const el = document.getElementById("join-error");
  if (el) el.textContent = msg;
}

async function submitAnswer(sel, force = false) {
  if (hasAnswered) return;
  const selected = sel || mySelected;
  if (selected.length === 0 && !force) return;
  hasAnswered = true;
  lastIndexAnswered = sessionData.currentIndex;
  mySelected = selected;
  render();
  const timeMs = Date.now() - (sessionData.questionStartedAt || Date.now());
  await setDoc(doc(db, "sessions", code, "answers", `${sessionData.currentIndex}_${playerId}`), {
    playerId, questionIndex: sessionData.currentIndex, selected, timeMs, submittedAt: Date.now(),
  });
}

async function removePlayerDoc() {
  if (!code || !playerId) return;
  try {
    await deleteDoc(doc(db, "sessions", code, "players", playerId));
  } catch { /* se falhar (ex: sem internet), não trava a saída */ }
}

async function leaveGame() {
  await removePlayerDoc();
  unsubSession && unsubSession();
  unsubScore && unsubScore();
  localStorage.removeItem("quiz-player");
  code = null; playerId = null; sessionData = null; myScore = null;
  view = "join";
  render();
}

// usado só depois que o jogo termina: em vez de voltar pra tela de
// código (dentro do site do jogo), manda pra página inicial de verdade —
// o jogo já acabou, não faz sentido oferecer "digitar outro código" aqui.
// Não remove o registro do jogador aqui (diferente do leaveGame) porque
// a busca de resultado por nome, depois do jogo, precisa dele.
function goHome() {
  unsubSession && unsubSession();
  unsubScore && unsubScore();
  localStorage.removeItem("quiz-player");
  window.location.href = "../index.html";
}

/* ---------------- render ---------------- */

function render() {
  clearInterval(liveTimerInt);
  root.className = "container";
  try {
    if (view === "join") return renderJoin();
    if (view === "lookup") return renderLookup();
    if (view === "avatar") return renderAvatarPicker();
    if (view === "team") return renderTeamPicker();
    if (view === "wait") return renderWait();
    if (["question", "reveal", "leaderboard"].includes(view) && sessionData?.gameMode === "sobrevivencia" && (sessionData.eliminatedPlayerIds || []).includes(playerId)) {
      return renderEliminated();
    }
    if (view === "question") return renderQuestion();
    if (view === "race") return renderRace();
    if (view === "reveal") return renderReveal();
    if (view === "leaderboard") return renderLeaderboard();
    if (view === "end") return renderEnd();
  } catch (err) {
    console.error("Erro ao desenhar a tela:", err);
    root.innerHTML = `
      <div class="eyebrow" style="color:var(--coral);">algo deu errado</div>
      <h1 style="font-size:20px; margin-top:6px;">Não consegui carregar essa tela</h1>
      <p style="color:var(--text-dim); margin-top:8px; font-size:13px;">Tenta recarregar a página. Se continuar, avisa o organizador.</p>
      <button class="btn btn-primary btn-block" id="reload-btn" style="margin-top:18px;">Recarregar</button>
    `;
    document.getElementById("reload-btn")?.addEventListener("click", () => window.location.reload());
  }
}

function renderJoin() {
  root.innerHTML = `
    <div class="eyebrow">quiz ao vivo</div>
    <h1 style="font-size:26px; margin-top:6px;">Digite o código</h1>
    <input class="input" id="join-code" placeholder="000000" maxlength="6" value="${joinCodeValue || ""}" style="text-align:center; font-size:28px; letter-spacing:6px; font-family:var(--font-display); margin-top:16px;" />
    <input class="input" id="join-name" placeholder="Seu nome" maxlength="20" style="margin-top:12px;" />
    <div id="join-error" class="error-text"></div>
    <button class="btn btn-primary btn-block" id="join-btn" style="margin-top:18px;">Entrar →</button>
    <button class="btn-link" id="lookup-link" style="margin-top:16px;">já joguei — buscar meu resultado</button>
  `;
  const codeInput = document.getElementById("join-code");
  codeInput.oninput = () => (codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 6));
  if (joinCodeValue) document.getElementById("join-name").focus();
  document.getElementById("join-btn").onclick = () => goToAvatarStep(codeInput.value, document.getElementById("join-name").value);
  document.getElementById("lookup-link").onclick = () => { view = "lookup"; render(); };
}

/* ---------------- buscar resultado de jogo encerrado ---------------- */
let lookupCandidates = [];

function renderLookup() {
  root.innerHTML = `
    <button class="btn-link" id="lookup-back" style="align-self:flex-start; margin-bottom:16px;">← voltar</button>
    <div class="eyebrow">buscar resultado</div>
    <h1 style="font-size:24px; margin-top:6px;">Já joguei, quero ver como fui</h1>
    <p style="color:var(--text-dim); margin-top:6px; font-size:13px;">Só funciona pra jogos que já terminaram.</p>
    <input class="input" id="lookup-code" placeholder="Código da sala (000000)" maxlength="6" style="text-align:center; font-size:22px; letter-spacing:4px; font-family:var(--font-display); margin-top:16px;" />
    <input class="input" id="lookup-name" placeholder="O nome que você usou no jogo" maxlength="20" style="margin-top:12px;" />
    <div id="lookup-error" class="error-text"></div>
    <button class="btn btn-primary btn-block" id="lookup-btn" style="margin-top:18px;">Buscar →</button>
  `;
  const codeInput = document.getElementById("lookup-code");
  codeInput.oninput = () => (codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 6));
  document.getElementById("lookup-back").onclick = () => { view = "join"; render(); };
  document.getElementById("lookup-btn").onclick = () =>
    lookupResult(codeInput.value, document.getElementById("lookup-name").value);
}

function showLookupError(msg) {
  const el = document.getElementById("lookup-error");
  if (el) el.textContent = msg;
}

async function lookupResult(inputCode, inputName) {
  const c = inputCode.trim();
  const nm = inputName.trim();
  if (!/^\d{6}$/.test(c)) return showLookupError("Digite o código de 6 dígitos da sala.");
  if (!nm) return showLookupError("Digite o nome que você usou no jogo.");

  const btn = document.getElementById("lookup-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Buscando..."; }

  try {
    const snap = await getDoc(doc(db, "sessions", c));
    if (!snap.exists()) return showLookupError("Não encontrei essa sala.");
    const sess = snap.data();
    if (sess.status !== "ended") return showLookupError("Esse jogo ainda não terminou — volte quando ele acabar.");

    const playersSnap = await getDocs(collection(db, "sessions", c, "players"));
    const target = nm.toLowerCase();
    const matches = playersSnap.docs.filter((d) => (d.data().name || "").trim().toLowerCase() === target);

    if (matches.length === 0) return showLookupError("Não encontrei ninguém com esse nome nessa sala.");
    if (matches.length === 1) {
      await openLookupResult(c, sess, matches[0].id, matches[0].data());
      return;
    }
    lookupCandidates = matches.map((d) => ({ id: d.id, ...d.data() }));
    renderLookupPick(c, sess);
  } catch (err) {
    console.error("Erro ao buscar resultado:", err);
    showLookupError("Não consegui buscar agora. Tenta de novo.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Buscar →"; }
  }
}

function renderLookupPick(c, sess) {
  root.innerHTML = `
    <div class="eyebrow">mais de uma pessoa com esse nome</div>
    <h1 style="font-size:20px; margin-top:6px;">Qual é você?</h1>
    <div style="display:flex; flex-direction:column; gap:10px; margin-top:16px;">
      ${lookupCandidates.map((p, i) => `
        <button type="button" class="option-btn" style="background:var(--surface); color:var(--text); border:1.5px solid var(--surface-line);" data-i="${i}">
          <span class="mini-avatar">${avatarSVG(p.avatar, 30)}</span>
          <span>${escapeHtml(p.name)}</span>
        </button>
      `).join("")}
    </div>
    <button class="btn-link" id="lookup-pick-back" style="margin-top:16px;">← voltar</button>
  `;
  document.getElementById("lookup-pick-back").onclick = () => { view = "lookup"; render(); };
  root.querySelectorAll("[data-i]").forEach((btn) => {
    btn.onclick = () => {
      const p = lookupCandidates[Number(btn.dataset.i)];
      openLookupResult(c, sess, p.id, p);
    };
  });
}

async function openLookupResult(c, sess, pid, playerData) {
  code = c;
  playerId = pid;
  playerName = playerData.name;
  avatarDraft = playerData.avatar || defaultAvatar();
  myTeam = playerData.team || null;
  sessionData = sess;
  const scoreSnap = await getDoc(doc(db, "sessions", c, "scores", pid));
  myScore = scoreSnap.exists() ? scoreSnap.data() : null;
  hasAnswered = true;
  view = "end";
  render();
}

function renderAvatarPicker() {
  root.innerHTML = `
    <div class="eyebrow">monte seu bichinho</div>
    <div id="avatar-preview" style="margin:14px 0;"></div>
    <div class="avatar-section-label">bicho</div>
    <div class="chip-row" id="avatar-species">
      ${SPECIES.map((sp) => `<button type="button" class="chip" data-species="${sp}">${SPECIES_LABEL[sp]}</button>`).join("")}
    </div>
    <div class="avatar-section-label">cor</div>
    <div class="swatch-row" id="avatar-colors">
      ${AVATAR_COLORS.map((c) => `<button type="button" class="color-dot" data-color="${c}" style="background:${c};"></button>`).join("")}
    </div>
    <div class="avatar-section-label">chapéu</div>
    <div class="chip-row" id="avatar-hats">
      ${HATS.map((h) => `<button type="button" class="chip" data-hat="${h}">${hatLabel(h)}</button>`).join("")}
    </div>
    <div class="avatar-section-label">óculos</div>
    <div class="chip-row" id="avatar-glasses">
      ${GLASSES.map((g) => `<button type="button" class="chip" data-glasses="${g}">${glassesLabel(g)}</button>`).join("")}
    </div>
    <button class="btn btn-primary btn-block" id="avatar-confirm" style="margin-top:20px;">Entrar →</button>
    <button class="btn-link" id="avatar-back" style="margin-top:10px;">← voltar</button>
  `;
  paintAvatarPicker();
  document.getElementById("avatar-back").onclick = () => { view = "join"; render(); };
  document.getElementById("avatar-confirm").onclick = () => {
    if (joinSessionPreview?.teamMode && joinSessionPreview.teams?.length) {
      view = "team";
      render();
    } else {
      joinRoom();
    }
  };
  document.querySelectorAll("#avatar-species [data-species]").forEach((b) => (b.onclick = () => { avatarDraft.species = b.dataset.species; paintAvatarPicker(); }));
  document.querySelectorAll("#avatar-colors [data-color]").forEach((b) => (b.onclick = () => { avatarDraft.color = b.dataset.color; paintAvatarPicker(); }));
  document.querySelectorAll("#avatar-hats [data-hat]").forEach((b) => (b.onclick = () => { avatarDraft.hat = b.dataset.hat; paintAvatarPicker(); }));
  document.querySelectorAll("#avatar-glasses [data-glasses]").forEach((b) => (b.onclick = () => { avatarDraft.glasses = b.dataset.glasses; paintAvatarPicker(); }));
}

function renderEliminated() {
  root.innerHTML = `
    <div class="big-emoji">👋</div>
    <h1 style="font-size:24px; margin-top:10px;">Você foi eliminado</h1>
    <p style="color:var(--text-dim); margin-top:8px;">Modo Sobrevivência: quem erra sai do jogo. Fica de olho na tela pra ver quem ganha!</p>
    ${myScore ? `<div style="color:var(--text-dim); margin-top:14px;">Sua pontuação final: <b style="color:var(--text);">${myScore.total}</b></div>` : ""}
    <button class="btn-link" id="leave-btn" style="margin-top:20px;">sair da sala</button>
  `;
  document.getElementById("leave-btn").onclick = leaveGame;
}

function renderTeamPicker() {
  const teams = joinSessionPreview?.teams || [];
  root.innerHTML = `
    <div class="eyebrow">escolha seu time</div>
    <h1 style="font-size:24px; margin-top:6px;">Você vai jogar por qual time?</h1>
    <div style="display:flex; flex-direction:column; gap:10px; margin-top:20px;">
      ${teams.map((t) => `
        <button type="button" class="chip" data-team="${escapeHtml(t)}" style="padding:16px; font-size:15px; ${t === selectedTeam ? "border-color:var(--gold); color:var(--gold);" : ""}">🏳️ ${escapeHtml(t)}</button>
      `).join("")}
    </div>
    <button class="btn btn-primary btn-block" id="team-confirm" style="margin-top:22px;">Entrar →</button>
    <button class="btn-link" id="team-back" style="margin-top:10px;">← voltar</button>
  `;
  root.querySelectorAll("[data-team]").forEach((btn) => {
    btn.onclick = () => { selectedTeam = btn.dataset.team; renderTeamPicker(); };
  });
  document.getElementById("team-confirm").onclick = joinRoom;
  document.getElementById("team-back").onclick = () => { view = "avatar"; render(); };
}

function hatLabel(h) { return { none: "nenhum", cap: "boné", crown: "coroa", party: "festa", headband: "faixa", bow: "laço", flower: "flores", wizard: "mago", cowboy: "cowboy" }[h]; }
function glassesLabel(g) { return { none: "nenhum", round: "redondo", cool: "estiloso", star: "estrela" }[g]; }

function paintAvatarPicker() {
  document.getElementById("avatar-preview").innerHTML = avatarSVG(avatarDraft, 120);
  document.querySelectorAll("#avatar-species [data-species]").forEach((b) => b.classList.toggle("active", b.dataset.species === avatarDraft.species));
  document.querySelectorAll("#avatar-colors [data-color]").forEach((b) => b.classList.toggle("active", b.dataset.color === avatarDraft.color));
  document.querySelectorAll("#avatar-hats [data-hat]").forEach((b) => b.classList.toggle("active", b.dataset.hat === avatarDraft.hat));
  document.querySelectorAll("#avatar-glasses [data-glasses]").forEach((b) => b.classList.toggle("active", b.dataset.glasses === avatarDraft.glasses));
}

function renderWait() {
  root.innerHTML = `
    <div class="eyebrow">você entrou!</div>
    <div style="margin:10px 0;">${avatarSVG(avatarDraft, 96)}</div>
    <h1 style="font-size:24px; margin-top:6px;">Aguardando o início...</h1>
    <p style="color:var(--text-dim); margin-top:8px;">Fica de olho na tela — o jogo começa a qualquer momento.</p>
    <div style="display:flex; gap:16px; margin-top:26px;">
      <button class="btn-link" id="refresh-btn">🔄 atualizar</button>
      <button class="btn-link" id="leave-btn">sair da sala</button>
    </div>
  `;
  document.getElementById("leave-btn").onclick = leaveGame;
  document.getElementById("refresh-btn").onclick = () => window.location.reload();
}

function renderQuestion() {
  const s = sessionData;
  const q = s.questions[s.currentIndex];
  const anyImages = s.questions.some((qq) => qq.imageUrl);
  root.className = "container left";

  if (hasAnswered) {
    const noAnswer = !mySelected || mySelected.length === 0;
    root.innerHTML = `
      <div class="eyebrow">${noAnswer ? "tempo esgotado ⏱️" : "enviado ✓"}</div>
      <h1 style="font-size:24px; margin-top:6px;">${noAnswer ? "Não deu tempo..." : "Resposta registrada!"}</h1>
      <p style="color:var(--text-dim); margin-top:8px;">Aguardando o resto da turma...</p>
      <div style="display:flex; gap:16px; margin-top:20px;">
        <button class="btn-link" id="refresh-btn">🔄 atualizar</button>
        <button class="btn-link" id="leave-btn">sair da sala</button>
      </div>
    `;
    document.getElementById("leave-btn").onclick = leaveGame;
    document.getElementById("refresh-btn").onclick = () => window.location.reload();
    return;
  }

  root.innerHTML = `
    <div class="eyebrow" style="text-align:center;">pergunta ${s.currentIndex + 1} de ${s.questions.length}</div>
    <div class="timer-ring" id="timer-ring"><span id="timer-num">--</span></div>
    ${q.pointsMultiplier > 1 ? `<div style="color:var(--gold); font-size:12px; font-weight:700; margin-top:8px; text-align:center;">🎁 pergunta bônus · vale ${q.pointsMultiplier}x</div>` : ""}
    ${anyImages ? `<div class="q-image-slot" style="margin-top:12px; ${q.imageUrl ? `background-image:url('${q.imageUrl}');` : ""}"></div>` : ""}
    <h2 style="font-size:19px; margin:10px 0 14px;">${escapeHtml(q.text)}</h2>
    <div style="display:flex; flex-direction:column; gap:10px;" id="options"></div>
    ${q.type === "multiple" ? `<button class="btn btn-primary btn-block" id="confirm-btn" style="margin-top:16px;" disabled>Confirmar resposta</button>` : ""}
    <button class="btn-link" id="leave-btn" style="margin-top:16px; align-self:center;">sair da sala</button>
  `;

  const optsEl = document.getElementById("options");
  optsEl.innerHTML = q.options.map((opt, i) => `
    <button type="button" class="option-btn ${OPTION_COLORS[i % 6]}" data-i="${i}" data-selected="false">
      <span class="${OPTION_SHAPES[i % 6]}"></span><span>${escapeHtml(opt)}</span>
    </button>
  `).join("");

  optsEl.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.i);
      if (q.type === "multiple") {
        const idx = mySelected.indexOf(i);
        if (idx >= 0) mySelected.splice(idx, 1); else mySelected.push(i);
        btn.dataset.selected = mySelected.includes(i) ? "true" : "false";
        document.getElementById("confirm-btn").disabled = mySelected.length === 0;
      } else {
        submitAnswer([i]);
      }
    };
  });
  document.getElementById("confirm-btn")?.addEventListener("click", () => submitAnswer());
  document.getElementById("leave-btn").onclick = leaveGame;

  const draw = () => {
    const elapsed = (Date.now() - (s.questionStartedAt || Date.now())) / 1000;
    const remaining = Math.max(0, Math.ceil(q.timeLimit - elapsed));
    const num = document.getElementById("timer-num");
    const ring = document.getElementById("timer-ring");
    if (num) num.textContent = remaining;
    if (ring) ring.classList.toggle("low", remaining <= 5);
    if (remaining <= 0 && !hasAnswered) {
      clearInterval(liveTimerInt);
      submitAnswer(mySelected, true);
    }
  };
  draw();
  liveTimerInt = setInterval(draw, 250);
}

function renderReveal() {
  const s = sessionData;
  const q = s.questions[s.currentIndex];
  const correct = myScore?.lastCorrect;
  const noAnswer = !mySelected || mySelected.length === 0;
  root.className = "container left";
  root.innerHTML = `
    <div style="text-align:center;">
      <div class="big-emoji">${correct ? "✅" : noAnswer ? "⏱️" : "❌"}</div>
      <h1 style="font-size:22px; margin-top:8px;">${correct ? "Certinho!" : noAnswer ? "Tempo esgotado" : "Não foi dessa vez"}</h1>
      ${myScore ? `<div style="color:var(--gold); font-weight:700; margin-top:4px;">+${myScore.lastPoints} pontos</div>` : ""}
      ${myScore?.lastCombo >= 2 ? `<div style="color:var(--coral); font-weight:700; font-size:13px; margin-top:2px;">🔥 combo x${myScore.lastCombo}! +${myScore.lastBonus} de bônus</div>` : ""}
      <div style="color:var(--text-dim); margin:6px 0 18px;">Total: <b style="color:var(--text);">${myScore?.total ?? 0}</b> pontos</div>
    </div>
    <div style="display:flex; flex-direction:column; gap:10px;">
      ${q.options.map((opt, i) => {
        const isCorrect = q.correct.includes(i);
        const isPicked = mySelected.includes(i);
        const cls = isCorrect && isPicked ? "reveal-hit" : isCorrect ? "reveal-correct" : isPicked ? "reveal-miss" : "reveal-neutral";
        const tag = isCorrect ? "certa" : isPicked ? "sua resposta" : "";
        return `
          <div class="reveal-option ${cls}">
            <span class="${OPTION_SHAPES[i % 6]}"></span>
            <span style="flex:1;">${escapeHtml(opt)}</span>
            ${tag ? `<span class="reveal-tag">${tag}</span>` : ""}
          </div>
        `;
      }).join("")}
    </div>
    <div style="display:flex; gap:16px; margin-top:16px; align-self:center;">
      <button class="btn-link" id="refresh-btn">🔄 atualizar</button>
      <button class="btn-link" id="leave-btn">sair da sala</button>
    </div>
  `;
  document.getElementById("leave-btn").onclick = leaveGame;
  document.getElementById("refresh-btn").onclick = () => window.location.reload();
}

function renderLeaderboard() {
  const s = sessionData;
  const list = s.leaderboardTop || [];
  const myRank = list.findIndex((p) => p.id === playerId || (myTeam && p.id === myTeam));
  root.className = "container left";
  root.innerHTML = `
    <div class="eyebrow" style="text-align:center;">placar</div>
    <h1 style="font-size:22px; text-align:center; margin-top:6px;">${myRank >= 0 ? `Você está em ${myRank + 1}º` : "Aguardando..."}</h1>
    <div style="margin-top:16px;">
      ${list.map((p, i) => `
        <div class="rank-row ${(p.id === playerId || (myTeam && p.id === myTeam)) ? "me" : ""}">
          <span class="rank-num" style="color:${i === 0 ? "var(--gold)" : "var(--text-dim)"};">${i + 1}</span>
          <span class="mini-avatar">${avatarSVG(p.avatar, 32)}</span>
          <span style="flex:1; font-weight:600;">${escapeHtml(p.name)}</span>
          <span style="color:var(--gold); font-weight:700;">${p.total}</span>
        </div>
      `).join("")}
    </div>
    <div style="display:flex; gap:16px; margin-top:16px; align-self:center;">
      <button class="btn-link" id="refresh-btn">🔄 atualizar</button>
      <button class="btn-link" id="leave-btn">sair da sala</button>
    </div>
  `;
  document.getElementById("leave-btn").onclick = leaveGame;
  document.getElementById("refresh-btn").onclick = () => window.location.reload();
}

function renderEnd() {
  const s = sessionData;
  const final = s.finalLeaderboard || [];
  const myRank = final.findIndex((p) => p.id === playerId || (myTeam && p.id === myTeam));
  root.innerHTML = `
    <div class="big-emoji">🏁</div>
    <h1 style="font-size:24px; margin-top:10px;">Fim de jogo!</h1>
    ${myRank >= 0 ? `<p style="color:var(--text-dim); margin-top:6px;">Você terminou em <b style="color:var(--gold);">${myRank + 1}º lugar</b> com ${final[myRank].total} pontos</p>` : ""}
    <button class="btn btn-primary btn-block" id="pdf-btn" style="margin-top:22px;">Baixar meu resultado em PDF</button>
    <button class="btn btn-ghost btn-block" id="leave-btn" style="margin-top:10px;">Voltar ao início</button>
  `;
  document.getElementById("pdf-btn").onclick = downloadMyReportPdf;
  document.getElementById("leave-btn").onclick = goHome;
  localStorage.removeItem("quiz-player");
}

async function downloadMyReportPdf() {
  const jsPDF = getJsPDF();
  if (!jsPDF) return;
  const s = sessionData;
  const btn = document.getElementById("pdf-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Gerando PDF..."; }

  try {
    const snaps = await Promise.all(
      s.questions.map((_, idx) => getDoc(doc(db, "sessions", code, "answers", `${idx}_${playerId}`)))
    );

    const items = s.questions.map((q, idx) => {
      const snap = snaps[idx];
      if (!snap.exists()) return { correct: false, timeMs: null, timeLimit: q.timeLimit, multiplier: q.pointsMultiplier || 1, ans: null };
      const ans = snap.data();
      const sel = [...(ans.selected || [])].sort().join(",");
      const cor = [...(q.correct || [])].sort().join(",");
      const correct = sel === cor && sel !== "";
      return { correct, timeMs: ans.timeMs, timeLimit: q.timeLimit, multiplier: q.pointsMultiplier || 1, ans };
    });
    const scored = scoreQuestionSequence(items, !!s.precisionMode, !!s.comboMode);

    const rows = s.questions.map((q, idx) => {
      const item = items[idx];
      const sc = scored[idx];
      if (!item.ans) return [q.text, "não respondeu", "—", "não", "—", "0"];
      return [
        q.text,
        (item.ans.selected || []).map((i) => q.options[i]).join(", "),
        `${((item.timeMs || 0) / 1000).toFixed(1)}s`,
        item.correct ? "sim" : "não",
        sc.combo >= 2 ? `x${sc.combo} (+${sc.bonus})` : "—",
        item.correct ? `+${sc.points}` : "0",
      ];
    });

    const final = s.finalLeaderboard || [];
    const myRank = final.findIndex((p) => p.id === playerId || (myTeam && p.id === myTeam));
    const total = myRank >= 0 ? final[myRank].total : (myScore?.total ?? 0);

    const doc_ = new jsPDF();
    let y = addPdfHeader(doc_, { eyebrow: "meu resultado", title: s.title, subtitle: playerName });

    try {
      const png = await avatarPngDataUrl(avatarDraft, 200);
      doc_.addImage(png, "PNG", 14, y, 26, 26);
    } catch { /* segue sem avatar se algo falhar */ }

    doc_.setFontSize(22);
    doc_.setTextColor(26, 22, 10);
    doc_.text(`${total} pontos`, 46, y + 12);
    doc_.setFontSize(11);
    doc_.setTextColor(110, 110, 120);
    doc_.text(myRank >= 0 ? `${myRank + 1}º lugar de ${final.length}` : "", 46, y + 20);
    y += 36;

    y = addSectionTitle(doc_, "Pergunta a pergunta", y);
    doc_.autoTable({
      startY: y,
      head: [["Pergunta", "Sua resposta", "Tempo", "Certo?", "Combo", "Pontos"]],
      body: rows,
      columnStyles: { 0: { cellWidth: 60 } },
      ...AUTOTABLE_THEME,
      margin: { left: 14, right: 14 },
    });

    doc_.save(`meu-resultado-${code}.pdf`);
  } catch (err) {
    console.error("Erro ao gerar PDF:", err);
    alert("Não consegui gerar o PDF agora. Tenta de novo em alguns segundos.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Baixar meu resultado em PDF"; }
  }
}
