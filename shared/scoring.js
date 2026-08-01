// Mesma fórmula do Kahoot: até 1000 pontos, caindo linearmente até 500
// conforme o tempo de resposta se aproxima do limite da pergunta.
// Errado = 0, sempre. O multiplicador permite perguntas "bônus" que valem
// em dobro (ou mais).
export function kahootPoints(timeMs, timeLimitSeconds, multiplier = 1) {
  const frac = Math.min(Math.max(timeMs || 0, 0) / (timeLimitSeconds * 1000), 1);
  return Math.round(1000 * (1 - frac / 2) * (multiplier || 1));
}

export function questionMaxPoints(q) {
  return 1000 * (q.pointsMultiplier || 1);
}

// Só libera entrada de jogadores depois que o jogo já começou se ainda
// restar mais da metade da pontuação total em disputa — assim quem entra
// tarde ainda tem chance real de competir.
export function lateJoinAllowed(questions, currentIndex) {
  const total = questions.reduce((sum, q) => sum + questionMaxPoints(q), 0);
  const from = Math.max(currentIndex, 0);
  const remaining = questions.slice(from).reduce((sum, q) => sum + questionMaxPoints(q), 0);
  return total === 0 || remaining > total / 2;
}
