import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, collection, setDoc, getDoc, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig } from "../shared/firebase-config.js";
import { AVATAR_COLORS, HATS, GLASSES, MOUTHS, defaultAvatar, avatarSVG, avatarPngDataUrl } from "../shared/avatar.js";
import { kahootPoints } from "../shared/scoring.js";
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

/* tenta retomar sessão salva no navegador (se a pessoa recarregar a página) —
   mas só se aquela sessão ainda existir e não tiver acabado; caso
   contrário, limpa e mostra a tela normal de entrada com código */
function viewForStatus(status) {
  if (status === "question") return "question";
  if (status === "reveal") return "reveal";
  if (status === "leaderboard") return "leaderboard";
  if (status === "ended") return "end";
  return "wait";
}

async function boot() {
  const saved = JSON.parse(localStorage.getItem("quiz-player") || "null");
  const params = new URLSearchParams(window.location.search);
  const codeFromUrl = params.get("code");

  if (saved?.code && saved?.playerId) {
    try {
      const snap = await getDoc(doc(db, "sessions", saved.code));
      if (snap.exists() && snap.data().status !== "ended") {
        code = saved.code; playerId = saved.playerId; playerName = saved.name;
        if (saved.avatar) avatarDraft = saved.avatar;
        sessionData = snap.data();
        lastIndexAnswered = sessionData.status === "lobby" ? -1 : sessionData.currentIndex;
        if (sessionData.status === "question") {
          const ansSnap = await getDoc(doc(db, "sessions", code, "answers", `${sessionData.currentIndex}_${playerId}`));
          hasAnswered = ansSnap.exists();
        }
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

boot();

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

function reactToStatus() {
  const s = sessionData;
  if (!s) return;
  if (s.status === "question" && s.currentIndex !== lastIndexAnswered && (view === "wait" || view === "leaderboard" || view === "reveal")) {
    lastIndexAnswered = -2; // marca que ainda não respondeu essa
    mySelected = [];
    hasAnswered = false;
    view = "question";
  } else if (s.status === "reveal" && (view === "question" || view === "answered")) {
    view = "reveal";
  } else if (s.status === "leaderboard" && (view === "reveal" || view === "question" || view === "answered")) {
    view = "leaderboard";
  } else if (s.status === "ended") {
    view = "end";
    unsubSession && unsubSession();
    unsubScore && unsubScore();
  }
}

/* ---------------- ações ---------------- */
async function goToAvatarStep(inputCode, inputName) {
  const c = inputCode.trim();
  const nm = inputName.trim();
  if (!/^\d{6}$/.test(c)) return showJoinError("Digite o código de 6 dígitos da sala.");
  if (!nm) return showJoinError("Digite seu nome.");
  const snap = await getDoc(doc(db, "sessions", c));
  if (!snap.exists()) return showJoinError("Não encontrei essa sala. Confira o código.");
  if (snap.data().status !== "lobby") return showJoinError("Essa sala já começou o jogo.");
  joinCodeValue = c;
  joinNameValue = nm;
  view = "avatar";
  render();
}

async function joinRoom() {
  const c = joinCodeValue;
  const nm = joinNameValue;
  const pid = rid();
  await setDoc(doc(db, "sessions", c, "players", pid), { name: nm, avatar: avatarDraft, joinedAt: Date.now() });
  const snap = await getDoc(doc(db, "sessions", c));
  code = c; playerId = pid; playerName = nm;
  localStorage.setItem("quiz-player", JSON.stringify({ code, playerId, name: nm, avatar: avatarDraft }));
  sessionData = snap.data();
  view = "wait";
  subscribeSession();
  render();
}

function showJoinError(msg) {
  const el = document.getElementById("join-error");
  if (el) el.textContent = msg;
}

async function submitAnswer(sel) {
  if (hasAnswered) return;
  const selected = sel || mySelected;
  if (selected.length === 0) return;
  hasAnswered = true;
  lastIndexAnswered = sessionData.currentIndex;
  mySelected = selected;
  render();
  const timeMs = Date.now() - (sessionData.questionStartedAt || Date.now());
  await setDoc(doc(db, "sessions", code, "answers", `${sessionData.currentIndex}_${playerId}`), {
    playerId, questionIndex: sessionData.currentIndex, selected, timeMs, submittedAt: Date.now(),
  });
}

function leaveGame() {
  unsubSession && unsubSession();
  unsubScore && unsubScore();
  localStorage.removeItem("quiz-player");
  code = null; playerId = null; sessionData = null; myScore = null;
  view = "join";
  render();
}

/* ---------------- render ---------------- */
let liveTimerInt = null;

function render() {
  clearInterval(liveTimerInt);
  root.className = "container";
  if (view === "join") return renderJoin();
  if (view === "avatar") return renderAvatarPicker();
  if (view === "wait") return renderWait();
  if (view === "question") return renderQuestion();
  if (view === "reveal") return renderReveal();
  if (view === "leaderboard") return renderLeaderboard();
  if (view === "end") return renderEnd();
}

function renderJoin() {
  root.innerHTML = `
    <div class="eyebrow">quiz ao vivo</div>
    <h1 style="font-size:26px; margin-top:6px;">Digite o código</h1>
    <input class="input" id="join-code" placeholder="000000" maxlength="6" value="${joinCodeValue || ""}" style="text-align:center; font-size:28px; letter-spacing:6px; font-family:var(--font-display); margin-top:16px;" />
    <input class="input" id="join-name" placeholder="Seu nome" maxlength="20" style="margin-top:12px;" />
    <div id="join-error" class="error-text"></div>
    <button class="btn btn-primary btn-block" id="join-btn" style="margin-top:18px;">Entrar →</button>
  `;
  const codeInput = document.getElementById("join-code");
  codeInput.oninput = () => (codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 6));
  if (joinCodeValue) document.getElementById("join-name").focus();
  document.getElementById("join-btn").onclick = () => goToAvatarStep(codeInput.value, document.getElementById("join-name").value);
}

function renderAvatarPicker() {
  root.innerHTML = `
    <div class="eyebrow">monte seu personagem</div>
    <div id="avatar-preview" style="margin:14px 0;"></div>
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
    <div class="avatar-section-label">expressão</div>
    <div class="chip-row" id="avatar-mouths">
      ${MOUTHS.map((m) => `<button type="button" class="chip" data-mouth="${m}">${mouthLabel(m)}</button>`).join("")}
    </div>
    <button class="btn btn-primary btn-block" id="avatar-confirm" style="margin-top:20px;">Entrar →</button>
    <button class="btn-link" id="avatar-back" style="margin-top:10px;">← voltar</button>
  `;
  paintAvatarPicker();
  document.getElementById("avatar-back").onclick = () => { view = "join"; render(); };
  document.getElementById("avatar-confirm").onclick = joinRoom;
  document.querySelectorAll("#avatar-colors [data-color]").forEach((b) => (b.onclick = () => { avatarDraft.color = b.dataset.color; paintAvatarPicker(); }));
  document.querySelectorAll("#avatar-hats [data-hat]").forEach((b) => (b.onclick = () => { avatarDraft.hat = b.dataset.hat; paintAvatarPicker(); }));
  document.querySelectorAll("#avatar-glasses [data-glasses]").forEach((b) => (b.onclick = () => { avatarDraft.glasses = b.dataset.glasses; paintAvatarPicker(); }));
  document.querySelectorAll("#avatar-mouths [data-mouth]").forEach((b) => (b.onclick = () => { avatarDraft.mouth = b.dataset.mouth; paintAvatarPicker(); }));
}

function hatLabel(h) { return { none: "nenhum", cap: "boné", crown: "coroa", party: "festa", headband: "faixa" }[h]; }
function glassesLabel(g) { return { none: "nenhum", round: "redondo", cool: "estiloso" }[g]; }
function mouthLabel(m) { return { smile: "sorriso", open: "surpreso", flat: "sério" }[m]; }

function paintAvatarPicker() {
  document.getElementById("avatar-preview").innerHTML = avatarSVG(avatarDraft, 120);
  document.querySelectorAll("#avatar-colors [data-color]").forEach((b) => b.classList.toggle("active", b.dataset.color === avatarDraft.color));
  document.querySelectorAll("#avatar-hats [data-hat]").forEach((b) => b.classList.toggle("active", b.dataset.hat === avatarDraft.hat));
  document.querySelectorAll("#avatar-glasses [data-glasses]").forEach((b) => b.classList.toggle("active", b.dataset.glasses === avatarDraft.glasses));
  document.querySelectorAll("#avatar-mouths [data-mouth]").forEach((b) => b.classList.toggle("active", b.dataset.mouth === avatarDraft.mouth));
}

function renderWait() {
  root.innerHTML = `
    <div class="eyebrow">você entrou!</div>
    <div style="margin:10px 0;">${avatarSVG(avatarDraft, 96)}</div>
    <h1 style="font-size:24px; margin-top:6px;">Aguardando o início...</h1>
    <p style="color:var(--text-dim); margin-top:8px;">Fica de olho na tela — o jogo começa a qualquer momento.</p>
    <button class="btn-link" id="leave-btn" style="margin-top:26px;">sair da sala</button>
  `;
  document.getElementById("leave-btn").onclick = leaveGame;
}

function renderQuestion() {
  const s = sessionData;
  const q = s.questions[s.currentIndex];
  root.className = "container left";

  if (hasAnswered) {
    root.innerHTML = `
      <div class="eyebrow">enviado ✓</div>
      <h1 style="font-size:24px; margin-top:6px;">Resposta registrada!</h1>
      <p style="color:var(--text-dim); margin-top:8px;">Aguardando o resto da turma...</p>
    `;
    return;
  }

  root.innerHTML = `
    <div class="eyebrow" id="timer-label">carregando...</div>
    ${q.imageUrl ? `<img class="q-image" src="${q.imageUrl}" />` : ""}
    <h2 style="font-size:19px; margin:10px 0 14px;">${escapeHtml(q.text)}</h2>
    <div style="display:flex; flex-direction:column; gap:10px;" id="options"></div>
    ${q.type === "multiple" ? `<button class="btn btn-primary btn-block" id="confirm-btn" style="margin-top:16px;" disabled>Confirmar resposta</button>` : ""}
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

  const draw = () => {
    const elapsed = (Date.now() - (s.questionStartedAt || Date.now())) / 1000;
    const remaining = Math.max(0, Math.ceil(q.timeLimit - elapsed));
    const label = document.getElementById("timer-label");
    if (label) { label.textContent = `${remaining}s restantes`; label.style.color = remaining <= 5 ? "var(--coral)" : "var(--gold)"; }
  };
  draw();
  liveTimerInt = setInterval(draw, 250);
}

function renderReveal() {
  const correct = myScore?.lastCorrect;
  root.innerHTML = `
    <div class="big-emoji">${hasAnswered ? (correct ? "✅" : "❌") : "⏱️"}</div>
    <h1 style="font-size:24px; margin-top:10px;">${hasAnswered ? (correct ? "Certinho!" : "Não foi dessa vez") : "Tempo esgotado"}</h1>
    ${myScore ? `<div style="color:var(--gold); font-weight:700; margin-top:6px;">+${myScore.lastPoints} pontos</div>` : ""}
    <div style="color:var(--text-dim); margin-top:14px;">Total: <b style="color:var(--text);">${myScore?.total ?? 0}</b> pontos</div>
  `;
}

function renderLeaderboard() {
  const s = sessionData;
  const list = s.leaderboardTop || [];
  const myRank = list.findIndex((p) => p.id === playerId);
  root.className = "container left";
  root.innerHTML = `
    <div class="eyebrow" style="text-align:center;">placar</div>
    <h1 style="font-size:22px; text-align:center; margin-top:6px;">${myRank >= 0 ? `Você está em ${myRank + 1}º` : "Aguardando..."}</h1>
    <div style="margin-top:16px;">
      ${list.map((p, i) => `
        <div class="rank-row ${p.id === playerId ? "me" : ""}">
          <span class="rank-num" style="color:${i === 0 ? "var(--gold)" : "var(--text-dim)"};">${i + 1}</span>
          <span class="mini-avatar">${avatarSVG(p.avatar, 32)}</span>
          <span style="flex:1; font-weight:600;">${escapeHtml(p.name)}</span>
          <span style="color:var(--gold); font-weight:700;">${p.total}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderEnd() {
  const s = sessionData;
  const final = s.finalLeaderboard || [];
  const myRank = final.findIndex((p) => p.id === playerId);
  root.innerHTML = `
    <div class="big-emoji">🏁</div>
    <h1 style="font-size:24px; margin-top:10px;">Fim de jogo!</h1>
    ${myRank >= 0 ? `<p style="color:var(--text-dim); margin-top:6px;">Você terminou em <b style="color:var(--gold);">${myRank + 1}º lugar</b> com ${final[myRank].total} pontos</p>` : ""}
    <button class="btn btn-primary btn-block" id="pdf-btn" style="margin-top:22px;">Baixar meu resultado em PDF</button>
    <button class="btn btn-ghost btn-block" id="leave-btn" style="margin-top:10px;">Sair</button>
  `;
  document.getElementById("pdf-btn").onclick = downloadMyReportPdf;
  document.getElementById("leave-btn").onclick = leaveGame;
  localStorage.removeItem("quiz-player");
}

async function downloadMyReportPdf() {
  const jsPDF = getJsPDF();
  if (!jsPDF) return;
  const s = sessionData;
  const btn = document.getElementById("pdf-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Gerando PDF..."; }

  const rows = [];
  for (let idx = 0; idx < s.questions.length; idx++) {
    const q = s.questions[idx];
    const snap = await getDoc(doc(db, "sessions", code, "answers", `${idx}_${playerId}`));
    if (!snap.exists()) {
      rows.push([q.text, "não respondeu", "—", "não", "0"]);
      continue;
    }
    const ans = snap.data();
    const sel = [...(ans.selected || [])].sort().join(",");
    const cor = [...q.correct].sort().join(",");
    const correct = sel === cor && sel !== "";
    const pts = correct ? kahootPoints(ans.timeMs, q.timeLimit) : 0;
    rows.push([
      q.text,
      (ans.selected || []).map((i) => q.options[i]).join(", "),
      `${(ans.timeMs / 1000).toFixed(1)}s`,
      correct ? "sim" : "não",
      correct ? `+${pts}` : "0",
    ]);
  }

  const final = s.finalLeaderboard || [];
  const myRank = final.findIndex((p) => p.id === playerId);
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
    head: [["Pergunta", "Sua resposta", "Tempo", "Certo?", "Pontos"]],
    body: rows,
    columnStyles: { 0: { cellWidth: 60 } },
    ...AUTOTABLE_THEME,
    margin: { left: 14, right: 14 },
  });

  doc_.save(`meu-resultado-${code}.pdf`);
  if (btn) { btn.disabled = false; btn.textContent = "Baixar meu resultado em PDF"; }
}
