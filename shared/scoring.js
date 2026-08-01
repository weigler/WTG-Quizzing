// Mesma fórmula do Kahoot: até 1000 pontos, caindo linearmente até 500
// conforme o tempo de resposta se aproxima do limite da pergunta.
// Errado = 0, sempre.
export function kahootPoints(timeMs, timeLimitSeconds) {
  const frac = Math.min(Math.max(timeMs || 0, 0) / (timeLimitSeconds * 1000), 1);
  return Math.round(1000 * (1 - frac / 2));
}
