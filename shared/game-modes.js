import { questionMaxPoints } from "./scoring.js";

// Monta as linhas do placar (leaderboardTop / finalLeaderboard) de
// acordo com o modo de jogo. Equipes e Cooperativo reaproveitam a MESMA
// estrutura {id, name, avatar, total} que o placar individual já usa —
// só muda como as linhas são agrupadas.
export function buildLeaderboardRows({ gameMode, teamMode, players, totals }) {
  const entries = Object.keys(players).map((pid) => ({
    id: pid,
    name: players[pid].name,
    avatar: players[pid].avatar,
    team: players[pid].team || null,
    total: totals[pid] || 0,
  }));

  if (gameMode === "cooperativo") {
    const total = entries.reduce((sum, e) => sum + e.total, 0);
    return [{ id: "grupo", name: "🤝 Grupo todo", avatar: null, total }];
  }

  if (teamMode) {
    const sumByTeam = {};
    const countByTeam = {};
    entries.forEach((e) => {
      const t = e.team || "Sem time";
      sumByTeam[t] = (sumByTeam[t] || 0) + e.total;
      countByTeam[t] = (countByTeam[t] || 0) + 1;
    });
    // média, não soma — senão um time com mais gente pontuaria mais só
    // por ter mais gente, mesmo jogando pior
    return Object.entries(sumByTeam)
      .map(([team, sum]) => ({
        id: team,
        name: `🏳️ ${team}`,
        avatar: null,
        total: Math.round(sum / (countByTeam[team] || 1)),
        memberCount: countByTeam[team] || 0,
      }))
      .sort((a, b) => b.total - a.total);
  }

  return entries.sort((a, b) => b.total - a.total).slice(0, 8);
}

export const GAME_MODES = [
  { id: "classico", label: "Clássico" },
  { id: "equipes", label: "Equipes" },
  { id: "sobrevivencia", label: "Sobrevivência (elimina quem erra)" },
  { id: "cooperativo", label: "Cooperativo (sem ranking individual)" },
  { id: "corrida", label: "Corrida livre (cada um no seu ritmo)" },
  { id: "blefe", label: "Blefe (todo mundo escreve uma resposta falsa)" },
];

export const TEAM_SUBMODES = [
  { id: "individual", label: "Cada integrante responde (soma os pontos do time)" },
  { id: "device", label: "Um aparelho só por equipe" },
];

export const GOAL_TYPES = [
  { id: "none", label: "Sem meta (só mostra o total)" },
  { id: "points", label: "Meta em pontos" },
  { id: "percent", label: "Meta em % do máximo possível" },
];

export function cooperativeMaxPoints(questions) {
  return (questions || []).reduce((sum, q) => sum + questionMaxPoints(q), 0);
}

// Calcula a meta em pontos (independente de ter sido definida em pontos
// fixos ou em % do máximo possível), pra poder comparar direto com o
// total coletivo já acumulado.
export function cooperativeGoalPoints(session) {
  const goal = session.cooperativeGoal;
  if (!goal || goal.type === "none" || !goal.value) return null;
  const max = cooperativeMaxPoints(session.questions);
  if (goal.type === "percent") return Math.round(max * (goal.value / 100));
  return goal.value;
}

// Progresso da meta cooperativa, pronto pra exibir (ou null se não tem
// meta configurada nesse quiz).
export function cooperativeProgress(session, currentTotal) {
  const goalPoints = cooperativeGoalPoints(session);
  if (goalPoints === null || goalPoints <= 0) return null;
  const pct = Math.min(100, Math.round((currentTotal / goalPoints) * 100));
  return { goalPoints, pct, met: currentTotal >= goalPoints };
}
