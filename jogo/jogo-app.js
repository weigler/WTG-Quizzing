import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, collection, setDoc, deleteDoc, getDoc, getDocs, query, where, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig } from "../shared/firebase-config.js";
import { AVATAR_COLORS, SPECIES, SPECIES_LABEL, HATS, GLASSES, defaultAvatar, avatarSVG, avatarPngDataUrl } from "../shared/avatar.js";
import { lateJoinAllowed, questionMaxPoints, scoreQuestionSequence, kahootPoints, resolveSpeedWeight } from "../shared/scoring.js";
import { cooperativeProgress } from "../shared/game-modes.js";
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
let myRaceStartedAt = null;
let bluffSubmitted = false;
let voteSubmitted = false;
let myBluffText = "";
let bluffVoteOptions = null;
let takenTeams = [];
let readySubmitted = false;
let readyPhaseKey = null;
let roomResultsData = null;
let musicAudioEl = null;
let musicToggleEl = null;
let musicMuted = false;
let inputCooldownUntil = 0;

/* tenta retomar sessão salva no navegador (se a pessoa recarregar a página) —
   mas só se aquela sessão ainda existir e não tiver acabado; caso
   contrário, limpa e mostra a tela normal de entrada com código */
function viewForStatus(status) {
  if (status === "question") return "question";
  if (status === "reveal") return "reveal";
  if (status === "leaderboard") return "leaderboard";
  if (status === "racing") return "race";
  if (status === "bluffwrite") return "bluffwrite";
  if (status === "bluffvote") return "bluffvote";
  if (status === "bluffreveal") return "bluffreveal";
  if (status === "ended") return "end";
  return "wait";
}

// Restaura `hasAnswered`/`mySelected` a partir do que está gravado de
// verdade no Firestore para a pergunta atual — usado tanto ao carregar a
// página quanto ao voltar de segundo plano. Cobre "question" (ainda
// respondendo/aguardando) e também "reveal"/"leaderboard" (a pergunta já
// fechou, mas a tela de revelação/placar ainda depende de saber o que a
// pessoa escolheu). Sem isso, um refresh nessas telas fazia parecer que
// a pessoa não tinha respondido nada, mesmo quando a resposta dela (certa
// ou errada) já estava gravada no banco.
async function restoreMyAnswerForCurrentQuestion() {
  if (!["question", "reveal", "leaderboard"].includes(sessionData?.status)) return;
  const ansSnap = await getDoc(doc(db, "sessions", code, "answers", `${sessionData.currentIndex}_${playerId}`));
  hasAnswered = ansSnap.exists();
  mySelected = ansSnap.exists() ? (ansSnap.data().selected || []) : [];
}

async function boot() {
  const params = new URLSearchParams(window.location.search);
  const codeFromUrl = params.get("code");
  const wantsResults = params.get("view") === "results";

  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem("quiz-player") || "null");
  } catch {
    localStorage.removeItem("quiz-player");
  }

  // Veio pelo cartão "Ver resultados" da página inicial: isso é uma
  // escolha explícita da pessoa, então tem prioridade sobre retomar um
  // jogo salvo no navegador (senão ela nunca sairia do jogo anterior
  // pra ver o hub de busca).
  if (!wantsResults && saved?.code && saved?.playerId) {
    try {
      const snap = await getDoc(doc(db, "sessions", saved.code));
      if (snap.exists() && snap.data().status !== "ended") {
        code = saved.code; playerId = saved.playerId; playerName = saved.name;
        if (saved.avatar) avatarDraft = saved.avatar;
        if (saved.team) myTeam = saved.team;
        if (saved.myRaceStartedAt) myRaceStartedAt = saved.myRaceStartedAt;
        sessionData = snap.data();
        lastIndexAnswered = sessionData.status === "lobby" ? -1 : sessionData.currentIndex;
        await restoreMyAnswerForCurrentQuestion();
        view = viewForStatus(sessionData.status);
        if (sessionData.status === "racing") await startRace();
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
  if (wantsResults) {
    view = "resultshub";
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

// Trava de segurança contra "toque fantasma": quando a tela do celular
// destrava depois de ficar bloqueada (ou o app volta de segundo plano),
// às vezes um toque que já estava em andamento acaba caindo sozinho em
// cima de um botão que só apareceu naquele instante — registrando uma
// resposta que a pessoa nunca quis dar (foi exatamente o que aconteceu
// com a resposta de tempo negativo). Essa função religa a tela com os
// dados mais atuais do servidor E ignora toques por um instante logo
// depois disso, até a pessoa realmente decidir tocar em algo.
function armInputCooldown(ms = 700) {
  inputCooldownUntil = Date.now() + ms;
}
function inputIsCoolingDown() {
  return Date.now() < inputCooldownUntil;
}

// No Chrome do iPhone (que por baixo dos panos também roda o motor do
// Safari, mas sem os mesmos privilégios de segundo plano) o iOS tende a
// encerrar o processo da aba de forma mais brusca do que no Safari
// quando a tela trava ou a pessoa troca de app. Essa função resincroniza
// tudo com o servidor sempre que a página volta a ficar visível — seja
// por destravar a tela (visibilitychange) ou por voltar de um estado
// suspenso pelo cache de navegação do próprio navegador (pageshow).
function resyncAfterBackground() {
  armInputCooldown();
  if (!code || !playerId) return;
  getDoc(doc(db, "sessions", code))
    .then((snap) => {
      if (!snap.exists()) return;
      sessionData = snap.data();
      return restoreMyAnswerForCurrentQuestion();
    })
    .then(() => {
      reactToStatus();
      render();
    })
    .catch(() => { /* sem internet no momento — o listener normal assume assim que voltar */ });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") resyncAfterBackground();
});
// "pageshow" com persisted=true dispara quando o navegador restaura a
// página do próprio cache (bfcache) em vez de recarregar do zero — outro
// jeito comum de "voltar" no iOS que o visibilitychange sozinho não cobre.
window.addEventListener("pageshow", (e) => {
  if (e.persisted) resyncAfterBackground();
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
      armInputCooldown(); // pergunta nova na tela — protege contra toque fantasma
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
  if (s.status === "bluffwrite") {
    if (s.currentIndex !== lastIndexAnswered) {
      lastIndexAnswered = -2;
      bluffSubmitted = false;
      voteSubmitted = false;
      myBluffText = "";
    }
    view = "bluffwrite";
    return;
  }
  if (s.status === "bluffvote") { view = "bluffvote"; return; }
  if (s.status === "bluffreveal") { view = "bluffreveal"; return; }
  if (s.status === "lobby") view = "wait";
}

/* ---------------- corrida livre ---------------- */

// Antes, essa função sempre zerava raceIndex pra 0 — então qualquer
// refresh de página (ou reabrir o jogo) fazia a corrida "recomeçar" da
// pergunta 1, mesmo que a pessoa já tivesse respondido (certo ou
// errado) várias perguntas antes. Além de ser confuso, isso fazia o
// jogador tentar responder de novo uma pergunta já registrada — e como
// a regra do Firestore não deixa REESCREVER uma resposta já gravada
// (só criar uma vez), essa segunda tentativa era rejeitada.
// Agora a gente descobre em qual pergunta a pessoa realmente parou,
// checando (uma por uma, na ordem) se já existe resposta gravada pra
// cada índice — e só então mostra a próxima pergunta ainda não
// respondida.
async function startRace() {
  raceSelected = [];
  raceFeedback = null;
  const s = sessionData;
  if (s?.raceSubmode === "async" && !myRaceStartedAt) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem("quiz-player") || "null") || {}; } catch { saved = {}; }
    myRaceStartedAt = saved.myRaceStartedAt || Date.now();
    localStorage.setItem("quiz-player", JSON.stringify({ ...saved, code, playerId, myRaceStartedAt }));
  }
  let resumeIndex = 0;
  if (s?.questions?.length) {
    try {
      while (resumeIndex < s.questions.length) {
        const ansSnap = await getDoc(doc(db, "sessions", code, "answers", `${resumeIndex}_${playerId}`));
        if (!ansSnap.exists()) break;
        resumeIndex += 1;
      }
    } catch {
      resumeIndex = 0; // sem internet pra checar: melhor deixar responder do início do que travar
    }
  }
  raceIndex = resumeIndex;
  raceQuestionShownAt = Date.now();
  armInputCooldown();
  if (view === "race") render();
}

function renderRace() {
  const s = sessionData;
  root.className = "container left";
  const isAsync = s.raceSubmode === "async";
  let remaining;
  if (isAsync) {
    const personalDeadline = (myRaceStartedAt || Date.now()) + (s.raceDurationSec || 0) * 1000;
    const windowDeadline = s.raceWindowEndsAt || Infinity;
    remaining = Math.max(0, Math.ceil((Math.min(personalDeadline, windowDeadline) - Date.now()) / 1000));
  } else {
    const totalElapsed = (Date.now() - (s.raceStartedAt || Date.now())) / 1000;
    remaining = Math.max(0, Math.ceil((s.raceDurationSec || 0) - totalElapsed));
  }

  if (remaining <= 0 || raceIndex >= s.questions.length) {
    root.className = "container";
    root.innerHTML = `
      <div class="eyebrow">corrida</div>
      <h1 style="font-size:22px; margin-top:8px;">${raceIndex >= s.questions.length ? "Você terminou! 🏁" : "Tempo esgotado!"}</h1>
      <p style="color:var(--text-dim); margin-top:8px;">${isAsync ? "Seu resultado já foi registrado — o organizador fecha a sala quando quiser." : "Aguardando o fim da corrida pra todo mundo..."}</p>
      <div style="color:var(--gold); font-weight:700; margin-top:14px;">Total: ${myScore?.total ?? 0} pontos</div>
    `;
    // Sem botão de "sair da sala" aqui de propósito: nesse ponto o
    // jogador já terminou a própria corrida, e esse botão apagava o
    // registro dele (players/scores ficam órfãos do nome) — fácil de
    // clicar sem querer achando que só fecha a tela, perdendo o dado.
    // Quem quiser sair, fecha a aba/navega pra outro lugar por conta própria.
    if (isAsync) {
      root.innerHTML += `<button class="btn btn-primary btn-block" id="pdf-btn-race" style="margin-top:18px;">Baixar meu resultado em PDF</button>`;
    }
    document.getElementById("pdf-btn-race")?.addEventListener("click", () => downloadMyRaceReportPdf());
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
    <div class="eyebrow">pergunta ${raceIndex + 1} de ${s.questions.length} · ${remaining}s restantes${isAsync ? " (seu tempo)" : " na corrida"}</div>
    ${q.imageUrl ? `<img class="q-image" src="${q.imageUrl}" style="margin-top:12px;" />` : ""}
    <h2 style="font-size:19px; margin:10px 0 14px;">${escapeHtml(q.text)}</h2>
    <div style="display:flex; flex-direction:column; gap:10px;" id="race-options"></div>
    ${q.type === "multiple" ? `<button class="btn btn-primary btn-block" id="race-confirm" style="margin-top:16px;" disabled>Confirmar resposta</button>` : ""}
  `;

  const optsEl = document.getElementById("race-options");
  optsEl.innerHTML = q.options.map((opt, i) => `
    <button type="button" class="option-btn ${OPTION_COLORS[i % 6]}" data-i="${i}" data-selected="${raceSelected.includes(i) ? "true" : "false"}">
      <span class="${OPTION_SHAPES[i % 6]}"></span><span>${escapeHtml(opt)}</span>
    </button>
  `).join("");
  optsEl.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      if (inputIsCoolingDown()) return;
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
  document.getElementById("race-confirm")?.addEventListener("click", () => { if (!inputIsCoolingDown()) submitRaceAnswer(); });

  liveTimerInt = setInterval(() => {
    if (view !== "race" || raceFeedback) return;
    let rem;
    if (isAsync) {
      const personalDeadline = (myRaceStartedAt || Date.now()) + (s.raceDurationSec || 0) * 1000;
      const windowDeadline = s.raceWindowEndsAt || Infinity;
      rem = Math.max(0, Math.ceil((Math.min(personalDeadline, windowDeadline) - Date.now()) / 1000));
    } else {
      const el = (Date.now() - (s.raceStartedAt || Date.now())) / 1000;
      rem = Math.max(0, Math.ceil((s.raceDurationSec || 0) - el));
    }
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
let raceSubmitting = false;
async function submitRaceAnswer(sel) {
  if (raceSubmitting) return; // trava contra clique duplo enviando a mesma pergunta 2x
  const s = sessionData;
  const q = s.questions[raceIndex];
  const selected = sel || raceSelected;
  if (selected.length === 0) return;
  raceSubmitting = true;

  try {
    const timeMs = Math.max(0, Date.now() - raceQuestionShownAt);
    const selKey = [...selected].sort().join(",");
    const corKey = [...(q.correct || [])].sort().join(",");
    const correct = selKey === corKey && selKey !== "";
    const points = correct ? kahootPoints(timeMs, q.timeLimit, q.pointsMultiplier || 1, resolveSpeedWeight(s)) : 0;

    await setDoc(doc(db, "sessions", code, "answers", `${raceIndex}_${playerId}`), {
      playerId, questionIndex: raceIndex, selected, timeMs, submittedAt: Date.now(),
    }).catch(() => {});

    const prevTotal = myScore?.total || 0;
    const newTotal = prevTotal + points;
    await setDoc(doc(db, "sessions", code, "scores", playerId), { total: newTotal, lastPoints: points, lastCorrect: correct }, { merge: true });
    myScore = { ...(myScore || {}), total: newTotal, lastPoints: points, lastCorrect: correct };

    raceFeedback = { correct, points };
    render();
    setTimeout(() => {
      raceFeedback = null;
      raceIndex += 1;
      raceSelected = [];
      raceQuestionShownAt = Date.now();
      raceSubmitting = false;
      armInputCooldown(250); // janela curta — é uma transição previsível, não um retorno de segundo plano
      render();
    }, 900);
  } catch (err) {
    raceSubmitting = false;
    // Loga o código real do erro (ex: "permission-denied") pra facilitar o
    // diagnóstico — se for permission-denied, o mais provável é que as
    // regras do Firestore publicadas no Firebase Console estejam
    // desatualizadas em relação ao firestore.rules deste projeto.
    console.error("Erro ao registrar resposta da corrida:", err?.code || err);
    if (err?.code === "permission-denied") {
      alert("Não consegui registrar essa resposta (permissão negada pelo servidor). Avise quem organiza o jogo: pode ser que as regras do Firestore precisem ser republicadas.");
    } else {
      alert("Não consegui registrar essa resposta. Confira sua internet e tenta de novo.");
    }
  }
}

/* ---------------- música (só corrida assíncrona) ---------------- */
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

function updateMusicForRace(s) {
  ensureMusicUi();
  if (!s || !s.musicUrl) {
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

/* ---------------- modo blefe ---------------- */
function renderBluffWrite() {
  const s = sessionData;
  const q = s.questions[s.currentIndex];
  root.className = "container left";

  if (bluffSubmitted) {
    root.innerHTML = `
      <div class="eyebrow">enviado ✓</div>
      <h1 style="font-size:22px; margin-top:6px;">Blefe enviado!</h1>
      <p style="color:var(--text-dim); margin-top:8px;">Aguardando o resto da turma escrever...</p>
    `;
    return;
  }

  root.innerHTML = `
    <div class="eyebrow">blefe</div>
    <h2 style="font-size:19px; margin:10px 0 6px;">${escapeHtml(q.text)}</h2>
    <p style="color:var(--text-dim); font-size:13px; margin-bottom:12px;">Escreva uma resposta FALSA, mas convincente — o objetivo é enganar os outros.</p>
    <input class="input" id="bluff-input" maxlength="80" placeholder="Sua resposta falsa..." />
    <button class="btn btn-primary btn-block" id="bluff-submit-btn" style="margin-top:14px;">Enviar blefe →</button>
  `;
  document.getElementById("bluff-submit-btn").onclick = async () => {
    const text = document.getElementById("bluff-input").value.trim();
    if (!text) return;
    myBluffText = text;
    bluffSubmitted = true;
    render();
    await setDoc(doc(db, "sessions", code, "bluffs", `${s.currentIndex}_${playerId}`), {
      playerId, questionIndex: s.currentIndex, text, submittedAt: Date.now(),
    }).catch(() => { bluffSubmitted = false; render(); });
  };
}

function renderBluffVote() {
  const s = sessionData;
  root.className = "container left";

  if (voteSubmitted) {
    root.innerHTML = `
      <div class="eyebrow">voto enviado ✓</div>
      <h1 style="font-size:22px; margin-top:6px;">Aguardando a revelação...</h1>
    `;
    return;
  }

  root.innerHTML = `<div class="eyebrow">blefe · votação</div><div class="spinner" style="margin-top:16px;"></div>`;

  (async () => {
    const q = s.questions[s.currentIndex];
    const snap = await getDocs(query(collection(db, "sessions", code, "bluffs"), where("questionIndex", "==", s.currentIndex)));
    const options = [{ key: "correct", label: q.options[q.correct[0]] }];
    snap.forEach((d) => {
      const data = d.data();
      if (data.playerId !== playerId) options.push({ key: data.playerId, label: data.text });
    });
    bluffVoteOptions = shuffleForVote(options);
    if (view !== "bluffvote") return; // já mudou de tela enquanto buscava
    root.innerHTML = `
      <div class="eyebrow">blefe · votação</div>
      <h2 style="font-size:19px; margin:10px 0 14px;">Qual dessas é a resposta verdadeira?</h2>
      <div style="display:flex; flex-direction:column; gap:10px;" id="vote-options"></div>
    `;
    const el = document.getElementById("vote-options");
    el.innerHTML = bluffVoteOptions.map((o, i) => `
      <button type="button" class="option-btn ${OPTION_COLORS[i % 6]}" data-key="${o.key}">
        <span class="${OPTION_SHAPES[i % 6]}"></span><span>${escapeHtml(o.label)}</span>
      </button>
    `).join("");
    el.querySelectorAll("button").forEach((btn) => {
      btn.onclick = async () => {
        const votedFor = btn.dataset.key;
        voteSubmitted = true;
        render();
        await setDoc(doc(db, "sessions", code, "votes", `${s.currentIndex}_${playerId}`), {
          playerId, questionIndex: s.currentIndex, votedFor, submittedAt: Date.now(),
        }).catch(() => { voteSubmitted = false; render(); });
      };
    });
  })();
}

function shuffleForVote(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function renderBluffRevealPlayer() {
  const s = sessionData;
  const data = s.bluffRevealData || { correctText: "", bluffs: {}, voteCounts: {} };
  root.className = "container left";
  ensureReadyPhase(`${s.currentIndex}_bluffreveal`);
  const rows = [
    { label: data.correctText, isCorrect: true, votes: data.voteCounts.correct || 0, mine: false },
    ...Object.entries(data.bluffs).map(([pid, text]) => ({
      label: text, isCorrect: false, votes: data.voteCounts[pid] || 0, mine: pid === playerId,
    })),
  ];
  root.innerHTML = `
    <div style="text-align:center;">
      <div class="big-emoji">${myScore?.lastCorrect ? "✅" : "❌"}</div>
      <h1 style="font-size:20px; margin-top:8px;">${myScore?.lastCorrect ? "Você descobriu a verdade!" : "Não foi dessa vez"}</h1>
      <div style="color:var(--gold); font-weight:700; margin-top:6px;">+${myScore?.lastPoints ?? 0} pontos</div>
      ${myScore?.lastFoolCount ? `<div style="color:var(--coral); font-size:13px; margin-top:4px;">🎭 ${myScore.lastFoolCount} pessoa(s) caíram no seu blefe! +${myScore.lastFoolBonus}</div>` : ""}
      <div style="color:var(--text-dim); margin:10px 0 16px;">Total: <b style="color:var(--text);">${myScore?.total ?? 0}</b> pontos</div>
    </div>
    <div style="display:flex; flex-direction:column; gap:10px;">
      ${rows.map((r) => `
        <div class="reveal-option ${r.isCorrect ? "reveal-correct" : "reveal-neutral"}">
          <span style="flex:1;">${escapeHtml(r.label)} ${r.mine ? "<b>(seu blefe)</b>" : ""}</span>
          <span class="reveal-tag">${r.votes} voto${r.votes !== 1 ? "s" : ""}</span>
        </div>
      `).join("")}
    </div>
    ${readyButtonHtml()}
  `;
  bindReadyButton("bluffreveal");
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
  const isAsyncRace = s.gameMode === "corrida" && s.raceSubmode === "async";
  if (isAsyncRace) {
    if (s.status === "racing" && (s.raceWindowEndsAt || 0) <= Date.now()) {
      return showJoinError("Essa corrida já fechou a janela de participação.");
    }
  } else if (s.status !== "lobby" && !lateJoinAllowed(s.questions, s.currentIndex)) {
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
  mySelected = [];
  lastIndexAnswered = sessionData.status === "lobby" ? -1 : sessionData.currentIndex;
  hasAnswered = false;
  await restoreMyAnswerForCurrentQuestion();
  view = viewForStatus(sessionData.status);
  if (sessionData.status === "racing") await startRace();
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
  const timeMs = Math.max(0, Date.now() - (sessionData.questionStartedAt || Date.now()));
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
  mySelected = []; hasAnswered = false; lastIndexAnswered = -1;
  raceIndex = 0; raceSelected = []; raceFeedback = null; myRaceStartedAt = null;
  bluffSubmitted = false; voteSubmitted = false; myBluffText = "";
  readySubmitted = false; readyPhaseKey = null;
  selectedTeam = null; myTeam = null;
  avatarDraft = defaultAvatar();
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
    // Música é só na Corrida Assíncrona: como cada um joga na hora que
    // quiser (às vezes em dias diferentes), não tem "telão" compartilhado
    // tocando música pra galera toda — por isso aqui é o próprio jogador
    // quem escolhe se quer ouvir, com o mesmo botão de liga/desliga que
    // existe na tela do admin.
    const isAsyncRace = view === "race" && sessionData?.raceSubmode === "async";
    updateMusicForRace(isAsyncRace ? sessionData : null);
    if (view === "join") return renderJoin();
    if (view === "resultshub") return renderResultsHub();
    if (view === "lookup") return renderLookup();
    if (view === "roomresults") return renderRoomResults();
    if (view === "roomresultsview") return renderRoomResultsView();
    if (view === "avatar") return renderAvatarPicker();
    if (view === "team") return renderTeamPicker();
    if (view === "wait") return renderWait();
    if (["question", "reveal", "leaderboard"].includes(view) && sessionData?.gameMode === "sobrevivencia" && (sessionData.eliminatedPlayerIds || []).includes(playerId)) {
      return renderEliminated();
    }
    if (view === "question") return renderQuestion();
    if (view === "race") return renderRace();
    if (view === "bluffwrite") return renderBluffWrite();
    if (view === "bluffvote") return renderBluffVote();
    if (view === "bluffreveal") return renderBluffRevealPlayer();
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

function isIOSChrome() {
  const ua = navigator.userAgent || "";
  return /CriOS/.test(ua) && /iPhone|iPad|iPod/.test(ua);
}

function renderJoin() {
  root.innerHTML = `
    <div class="eyebrow">quiz ao vivo</div>
    <h1 style="font-size:26px; margin-top:6px;">Digite o código</h1>
    <input class="input" id="join-code" placeholder="000000" maxlength="6" value="${joinCodeValue || ""}" style="text-align:center; font-size:28px; letter-spacing:6px; font-family:var(--font-display); margin-top:16px;" />
    <input class="input" id="join-name" placeholder="Seu nome" maxlength="20" style="margin-top:12px;" />
    <div id="join-error" class="error-text"></div>
    <button class="btn btn-primary btn-block" id="join-btn" style="margin-top:18px;">Entrar →</button>
    ${isIOSChrome() ? `
      <p style="color:var(--text-dim); font-size:11px; margin-top:16px;">
        💡 Notamos que você tá usando o Chrome no iPhone — o jogo costuma ficar mais estável no <b>Safari</b> (o app azul que já vem no iPhone), especialmente se a tela travar durante o jogo.
      </p>
    ` : ""}
  `;
  const codeInput = document.getElementById("join-code");
  codeInput.oninput = () => (codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 6));
  if (joinCodeValue) document.getElementById("join-name").focus();
  document.getElementById("join-btn").onclick = () => goToAvatarStep(codeInput.value, document.getElementById("join-name").value);
}

/* ---------------- hub de resultados (chegado pelo cartão da página inicial) ---------------- */
function renderResultsHub() {
  root.innerHTML = `
    <div class="eyebrow">quiz ao vivo</div>
    <h1 style="font-size:24px; margin-top:6px;">Ver resultados</h1>
    <p style="color:var(--text-dim); margin-top:6px; font-size:13px;">Escolha o que você quer ver — os dois só funcionam pra jogos que já terminaram.</p>

    <button type="button" class="choice-card" id="hub-lookup-btn" style="margin-top:20px;">
      <div class="big">🏅 Meu resultado</div>
      <div class="small">Buscar como eu fui, com código da sala + meu nome</div>
    </button>
    <button type="button" class="choice-card" id="hub-room-btn" style="margin-top:14px;">
      <div class="big">📋 Placar de uma sala</div>
      <div class="small">Ver o resultado de todo mundo, só com o código da sala</div>
    </button>

    <button class="btn-link" id="hub-back" style="margin-top:20px;">← quero entrar num jogo</button>
  `;
  document.getElementById("hub-lookup-btn").onclick = () => { view = "lookup"; render(); };
  document.getElementById("hub-room-btn").onclick = () => { view = "roomresults"; render(); };
  document.getElementById("hub-back").onclick = () => { view = "join"; render(); };
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
  document.getElementById("lookup-back").onclick = () => { view = "resultshub"; render(); };
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
          ${p.avatar ? `<span class="mini-avatar">${avatarSVG(p.avatar, 30)}</span>` : ""}
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

/* ---------------- placar final de uma sala (qualquer participante) ---------------- */
function renderRoomResults() {
  root.innerHTML = `
    <button class="btn-link" id="room-results-back" style="align-self:flex-start; margin-bottom:16px;">← voltar</button>
    <div class="eyebrow">placar final</div>
    <h1 style="font-size:22px; margin-top:6px;">Ver o resultado de todo mundo</h1>
    <p style="color:var(--text-dim); margin-top:6px; font-size:13px;">Digite só o código da sala — não precisa ter jogado nela. Só funciona pra jogos que já terminaram.</p>
    <input class="input" id="room-results-code" placeholder="Código da sala (000000)" maxlength="6" style="text-align:center; font-size:22px; letter-spacing:4px; font-family:var(--font-display); margin-top:16px;" />
    <div id="room-results-error" class="error-text"></div>
    <button class="btn btn-primary btn-block" id="room-results-btn" style="margin-top:18px;">Ver placar →</button>
  `;
  const codeInput = document.getElementById("room-results-code");
  codeInput.oninput = () => (codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 6));
  document.getElementById("room-results-back").onclick = () => { view = "resultshub"; render(); };
  document.getElementById("room-results-btn").onclick = () => lookupRoomResults(codeInput.value);
}

async function lookupRoomResults(inputCode) {
  const c = (inputCode || "").trim();
  const errEl = document.getElementById("room-results-error");
  const showErr = (msg) => { if (errEl) errEl.textContent = msg; };
  if (!/^\d{6}$/.test(c)) return showErr("Digite o código de 6 dígitos da sala.");

  const btn = document.getElementById("room-results-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Buscando..."; }

  try {
    const snap = await getDoc(doc(db, "sessions", c));
    if (!snap.exists()) return showErr("Não encontrei essa sala.");
    const sess = snap.data();
    if (sess.status !== "ended") return showErr("Esse jogo ainda não terminou — volte quando ele acabar.");

    roomResultsData = { code: c, sess };
    view = "roomresultsview";
    render();
  } catch (err) {
    console.error("Erro ao buscar placar da sala:", err);
    showErr("Não consegui buscar agora. Tenta de novo.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Ver placar →"; }
  }
}

function renderRoomResultsView() {
  const { code: c, sess } = roomResultsData;
  const final = sess.finalLeaderboard || [];
  root.innerHTML = `
    <button class="btn-link" id="room-results-view-back" style="align-self:flex-start; margin-bottom:16px;">← voltar</button>
    <div class="eyebrow">placar final</div>
    <h1 style="font-size:20px; margin-top:6px;">${escapeHtml(sess.title || "")}</h1>
    <p style="color:var(--text-dim); font-size:12px; margin-top:2px;">sala ${c}</p>
    <div style="margin-top:18px;">
      ${final.map((p, i) => `
        <div class="rank-row">
          <span class="rank-num" style="color:${i === 0 ? "var(--gold)" : "var(--text-dim)"};">${i + 1}</span>
          ${p.avatar ? `<span class="mini-avatar">${avatarSVG(p.avatar, 30)}</span>` : ""}
          <span style="flex:1; font-weight:600;">${escapeHtml(p.name)}</span>
          <span style="color:var(--gold); font-weight:700;">${p.total}</span>
        </div>
      `).join("") || `<div style="color:var(--text-dim); font-size:13px;">Ninguém pontuou nessa sala.</div>`}
    </div>
  `;
  document.getElementById("room-results-view-back").onclick = () => { view = "roomresults"; render(); };
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
    <p style="color:var(--text-dim); margin-top:8px;">Modo Sobrevivência: quem erra sai do jogo. Continue nessa tela — assim que o jogo acabar pra todo mundo, você vai ver o resultado final automaticamente.</p>
    ${myScore ? `<div style="color:var(--text-dim); margin-top:14px;">Sua pontuação até aqui: <b style="color:var(--text);">${myScore.total}</b></div>` : ""}
    <button class="btn btn-primary btn-block" id="pdf-btn-elim" style="margin-top:18px;">Baixar meu resultado em PDF</button>
  `;
  // Sem "sair da sala" aqui: a pessoa ainda faz parte do resultado final
  // do jogo (mesmo eliminada), e esse botão apagava o registro dela —
  // fácil de confundir com "fechar a tela" e perder o dado à toa.
  document.getElementById("pdf-btn-elim").onclick = () => downloadMyReportPdf("pdf-btn-elim");
}

function renderTeamPicker() {
  const teams = joinSessionPreview?.teams || [];
  const isDeviceMode = joinSessionPreview?.teamSubmode === "device";
  root.innerHTML = `
    <div class="eyebrow">escolha seu time</div>
    <h1 style="font-size:24px; margin-top:6px;">Você vai jogar por qual time?</h1>
    ${isDeviceMode ? `<p style="color:var(--text-dim); font-size:13px; margin-top:6px;">Um aparelho só por equipe — times já ocupados aparecem apagados.</p>` : ""}
    <div style="display:flex; flex-direction:column; gap:10px; margin-top:20px;" id="team-list">
      ${teams.map((t) => {
        const taken = isDeviceMode && takenTeams.includes(t);
        return `<button type="button" class="chip" data-team="${escapeHtml(t)}" ${taken ? "disabled" : ""} style="padding:16px; font-size:15px; ${taken ? "opacity:.4;" : ""} ${t === selectedTeam ? "border-color:var(--gold); color:var(--gold);" : ""}">🏳️ ${escapeHtml(t)}${taken ? " (ocupado)" : ""}</button>`;
      }).join("")}
    </div>
    <button class="btn btn-primary btn-block" id="team-confirm" style="margin-top:22px;">Entrar →</button>
    <button class="btn-link" id="team-back" style="margin-top:10px;">← voltar</button>
  `;
  root.querySelectorAll("[data-team]:not(:disabled)").forEach((btn) => {
    btn.onclick = () => { selectedTeam = btn.dataset.team; renderTeamPicker(); };
  });
  document.getElementById("team-confirm").onclick = joinRoom;
  document.getElementById("team-back").onclick = () => { view = "avatar"; render(); };

  if (isDeviceMode) {
    getDocs(collection(db, "sessions", joinCodeValue, "players")).then((snap) => {
      takenTeams = snap.docs.map((d) => d.data().team).filter(Boolean);
      if (takenTeams.includes(selectedTeam)) selectedTeam = teams.find((t) => !takenTeams.includes(t)) || null;
      if (view === "team") renderTeamPicker();
    });
  }
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
      if (inputIsCoolingDown()) return;
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
  document.getElementById("confirm-btn")?.addEventListener("click", () => { if (!inputIsCoolingDown()) submitAnswer(); });
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

function ensureReadyPhase(phaseKey) {
  if (readyPhaseKey !== phaseKey) {
    readyPhaseKey = phaseKey;
    readySubmitted = false;
  }
}

async function submitReady(phase) {
  if (readySubmitted) return;
  readySubmitted = true;
  render();
  await setDoc(doc(db, "sessions", code, "ready", `${sessionData.currentIndex}_${phase}_${playerId}`), {
    playerId, questionIndex: sessionData.currentIndex, phase, submittedAt: Date.now(),
  }).catch(() => { readySubmitted = false; render(); });
}

function readyButtonHtml() {
  return readySubmitted
    ? `<div style="color:var(--text-dim); font-size:13px; margin-top:14px;">✓ Você continuou — aguardando o resto da turma...</div>`
    : `<button class="btn btn-primary btn-block" id="ready-btn" style="margin-top:14px;">Continuar →</button>`;
}
function bindReadyButton(phase) {
  document.getElementById("ready-btn")?.addEventListener("click", () => submitReady(phase));
}

function renderReveal() {
  const s = sessionData;
  const q = s.questions[s.currentIndex];
  const correct = myScore?.lastCorrect;
  const noAnswer = !mySelected || mySelected.length === 0;
  ensureReadyPhase(`${s.currentIndex}_reveal`);
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
    ${readyButtonHtml()}
    <div style="display:flex; gap:16px; margin-top:16px; align-self:center;">
      <button class="btn-link" id="refresh-btn">🔄 atualizar</button>
      <button class="btn-link" id="leave-btn">sair da sala</button>
    </div>
  `;
  bindReadyButton("reveal");
  document.getElementById("leave-btn").onclick = leaveGame;
  document.getElementById("refresh-btn").onclick = () => window.location.reload();
}

function renderLeaderboard() {
  const s = sessionData;
  const list = s.leaderboardTop || [];
  const myRank = list.findIndex((p) => p.id === playerId || (myTeam && p.id === myTeam));
  const progress = s.gameMode === "cooperativo" ? cooperativeProgress(s, list[0]?.total || 0) : null;
  ensureReadyPhase(`${s.currentIndex}_leaderboard`);
  root.className = "container left";
  root.innerHTML = `
    <div class="eyebrow" style="text-align:center;">placar</div>
    <h1 style="font-size:22px; text-align:center; margin-top:6px;">${s.gameMode === "cooperativo" ? "Placar coletivo" : myRank >= 0 ? `Você está em ${myRank + 1}º` : "Aguardando..."}</h1>
    ${progress ? `
      <div style="margin-top:12px;">
        <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-dim); margin-bottom:4px;">
          <span>Meta: ${progress.goalPoints} pts</span><span>${progress.pct}%${progress.met ? " ✓ batida!" : ""}</span>
        </div>
        <div style="background:var(--surface); border:1px solid var(--surface-line); border-radius:8px; height:14px; overflow:hidden;">
          <div style="width:${progress.pct}%; height:100%; background:${progress.met ? "var(--green)" : "var(--gold)"};"></div>
        </div>
      </div>
    ` : ""}
    <div style="margin-top:16px;">
      ${list.map((p, i) => `
        <div class="rank-row ${(p.id === playerId || (myTeam && p.id === myTeam)) ? "me" : ""}">
          <span class="rank-num" style="color:${i === 0 ? "var(--gold)" : "var(--text-dim)"};">${i + 1}</span>
          ${p.avatar ? `<span class="mini-avatar">${avatarSVG(p.avatar, 32)}</span>` : ""}
          <span style="flex:1; font-weight:600;">${escapeHtml(p.name)}</span>
          <span style="color:var(--gold); font-weight:700;">${p.total}</span>
        </div>
      `).join("")}
    </div>
    ${readyButtonHtml()}
    <div style="display:flex; gap:16px; margin-top:16px; align-self:center;">
      <button class="btn-link" id="refresh-btn">🔄 atualizar</button>
      <button class="btn-link" id="leave-btn">sair da sala</button>
    </div>
  `;
  document.getElementById("leave-btn").onclick = leaveGame;
  document.getElementById("refresh-btn").onclick = () => window.location.reload();
  bindReadyButton("leaderboard");
}

function renderEnd() {
  const s = sessionData;
  const final = s.finalLeaderboard || [];
  const myRank = final.findIndex((p) => p.id === playerId || (myTeam && p.id === myTeam));
  const progress = s.gameMode === "cooperativo" ? cooperativeProgress(s, final[0]?.total || 0) : null;
  root.innerHTML = `
    <div class="big-emoji">🏁</div>
    <h1 style="font-size:24px; margin-top:10px;">Fim de jogo!</h1>
    ${progress ? `<div style="color:${progress.met ? "var(--green)" : "var(--text-dim)"}; font-weight:700; margin-top:8px; font-size:14px;">${progress.met ? "🎉 Meta batida!" : "Meta não batida"} — ${final[0]?.total || 0} / ${progress.goalPoints} pts (${progress.pct}%)</div>` : ""}
    ${myRank >= 0 ? `<p style="color:var(--text-dim); margin-top:6px;">Você terminou em <b style="color:var(--gold);">${myRank + 1}º lugar</b> com ${final[myRank].total} pontos</p>` : ""}
    <button class="btn btn-primary btn-block" id="pdf-btn" style="margin-top:22px;">Baixar meu resultado em PDF</button>
    <button class="btn btn-ghost btn-block" id="leave-btn" style="margin-top:10px;">Voltar ao início</button>
  `;
  document.getElementById("pdf-btn").onclick = () => downloadMyReportPdf();
  document.getElementById("leave-btn").onclick = goHome;
  localStorage.removeItem("quiz-player");
}

// PDF pessoal de uma Corrida Assíncrona — pensado pra ser baixado ANTES
// do organizador fechar a sala (às vezes só dias depois). Mostra a
// resposta que a PESSOA deu e se acertou ou não, mas nunca a resposta
// certa em si — assim ela fica com um registro do que jogou sem virar
// um gabarito que possa ser repassado pra quem ainda não jogou.
async function downloadMyRaceReportPdf() {
  const jsPDF = getJsPDF();
  if (!jsPDF) return;
  const s = sessionData;
  const btn = document.getElementById("pdf-btn-race");
  if (btn) { btn.disabled = true; btn.textContent = "Gerando PDF..."; }

  try {
    const snaps = await Promise.all(
      s.questions.map((_, idx) => getDoc(doc(db, "sessions", code, "answers", `${idx}_${playerId}`)))
    );

    const rows = s.questions.map((q, idx) => {
      const snap = snaps[idx];
      if (!snap.exists()) return [q.text, "não respondeu", "—"];
      const ans = snap.data();
      return [
        q.text,
        (ans.selected || []).map((i) => q.options[i]).join(", "),
        `${((ans.timeMs || 0) / 1000).toFixed(1)}s`,
      ];
    });

    const doc_ = new jsPDF();
    let y = addPdfHeader(doc_, { eyebrow: "meu resultado · corrida", title: s.title, subtitle: playerName });

    try {
      const png = await avatarPngDataUrl(avatarDraft, 200);
      doc_.addImage(png, "PNG", 14, y, 26, 26);
    } catch { /* segue sem avatar se algo falhar */ }

    doc_.setFontSize(22);
    doc_.setTextColor(26, 22, 10);
    doc_.text(`${myScore?.total ?? 0} pontos`, 46, y + 12);
    doc_.setFontSize(11);
    doc_.setTextColor(110, 110, 120);
    doc_.text("resultado parcial — a sala ainda pode estar aberta pra outros jogadores", 46, y + 20);
    y += 36;

    y = addSectionTitle(doc_, "Pergunta a pergunta", y);
    doc_.autoTable({
      startY: y,
      head: [["Pergunta", "Sua resposta", "Tempo"]],
      body: rows,
      columnStyles: { 0: { cellWidth: 90 } },
      ...AUTOTABLE_THEME,
      margin: { left: 14, right: 14 },
    });

    doc_.save(`meu-resultado-corrida-${code}.pdf`);
  } catch (err) {
    console.error("Erro ao gerar PDF da corrida:", err);
    alert("Não consegui gerar o PDF agora. Tenta de novo em alguns segundos.");
  } finally {
    const btnAgain = document.getElementById("pdf-btn-race");
    if (btnAgain) { btnAgain.disabled = false; btnAgain.textContent = "Baixar meu resultado em PDF"; }
  }
}

async function downloadMyReportPdf(btnId = "pdf-btn") {
  const jsPDF = getJsPDF();
  if (!jsPDF) return;
  const s = sessionData;
  const btn = document.getElementById(btnId);
  if (btn) { btn.disabled = true; btn.textContent = "Gerando PDF..."; }

  try {
    const final = s.finalLeaderboard || [];
    const myRank = final.findIndex((p) => p.id === playerId || (myTeam && p.id === myTeam));
    const total = myRank >= 0 ? final[myRank].total : (myScore?.total ?? 0);
    let rows;

    if (s.gameMode === "blefe") {
      const bluffsSnap = await getDocs(collection(db, "sessions", code, "bluffs"));
      const votesSnap = await getDocs(collection(db, "sessions", code, "votes"));
      const bluffsByQ = {};
      bluffsSnap.forEach((d) => { const data = d.data(); (bluffsByQ[data.questionIndex] ||= {})[data.playerId] = data.text; });
      const votesByQ = {};
      votesSnap.forEach((d) => { const data = d.data(); (votesByQ[data.questionIndex] ||= []).push(data); });

      rows = s.questions.map((q, idx) => {
        const bluffs = bluffsByQ[idx] || {};
        const votes = votesByQ[idx] || [];
        const voteCounts = {};
        votes.forEach((v) => { voteCounts[v.votedFor] = (voteCounts[v.votedFor] || 0) + 1; });
        const correctText = q.options[q.correct[0]];
        const myVote = votes.find((v) => v.playerId === playerId);
        const guessedRight = !!myVote && myVote.votedFor === "correct";
        const foolCount = voteCounts[playerId] || 0;
        const bonus = foolCount * 250;
        const points = (guessedRight ? 500 : 0) + bonus;
        const votedLabel = myVote ? (myVote.votedFor === "correct" ? correctText : (bluffs[myVote.votedFor] || "?")) : "não votou";
        return [
          q.text,
          `votou: ${votedLabel}`,
          "—",
          guessedRight ? "sim" : "não",
          foolCount ? `enganou ${foolCount}` : "—",
          `${points}`,
        ];
      });
    } else {
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
      const scored = scoreQuestionSequence(items, resolveSpeedWeight(s), !!s.comboMode);

      rows = s.questions.map((q, idx) => {
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
    }

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
      head: s.gameMode === "blefe"
        ? [["Pergunta", "Seu voto", "Tempo", "Acertou?", "Enganou", "Pontos"]]
        : [["Pergunta", "Sua resposta", "Tempo", "Certo?", "Combo", "Pontos"]],
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
