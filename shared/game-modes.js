// Monta as linhas do placar (leaderboardTop / finalLeaderboard) de
// acordo com o modo de jogo. Equipes e Cooperativo reaproveitam a MESMA
// estrutura {id, name, avatar, total} que o placar individual já usa —
// só muda como as linhas são agrupadas. Isso significa que as telas de
// placar (admin e jogador) não precisam saber nada sobre o modo de jogo,
// só desenham o que receberem.
export function buildLeaderboardRows({ gameMode, teamMode, players, totals }) {
  // players: { [playerId]: { name, avatar, team } }
  // totals: { [playerId]: number }
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
    const byTeam = {};
    entries.forEach((e) => {
      const t = e.team || "Sem time";
      byTeam[t] = (byTeam[t] || 0) + e.total;
    });
    return Object.entries(byTeam)
      .map(([team, total]) => ({ id: team, name: `🏳️ ${team}`, avatar: null, total }))
      .sort((a, b) => b.total - a.total);
  }

  return entries.sort((a, b) => b.total - a.total).slice(0, 8);
}

export const GAME_MODES = [
  { id: "classico", label: "Clássico" },
  { id: "sobrevivencia", label: "Sobrevivência (elimina quem erra)" },
  { id: "cooperativo", label: "Cooperativo (sem ranking individual)" },
  { id: "corrida", label: "Corrida livre (cada um no seu ritmo)" },
];
