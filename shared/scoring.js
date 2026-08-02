// Mesma fórmula do Kahoot: até 1000 pontos, caindo linearmente até 500
// conforme o tempo de resposta se aproxima do limite da pergunta.
// Errado = 0, sempre. O multiplicador permite perguntas "bônus" que valem
// em dobro (ou mais).
//
// Resposta instantânea (menos de 0,5s): pontuação máxima garantida, sem
// desconto nenhum de tempo — recompensa quem já sabia na hora.
//
// Modo de precisão (opcional, por quiz): ignora a velocidade por completo
// e vale só se acertou ou não — sempre pontuação máxima quando certo.
const INSTANT_THRESHOLD_MS = 500;

export function kahootPoints(timeMs, timeLimitSeconds, multiplier = 1, precisionMode = false) {
  const m = multiplier || 1;
  if (precisionMode) return Math.round(1000 * m);
  const t = Math.max(timeMs || 0, 0);
  if (t < INSTANT_THRESHOLD_MS) return Math.round(1000 * m);
  const frac = Math.min(t / (timeLimitSeconds * 1000), 1);
  return Math.round(1000 * (1 - frac / 2) * m);
}

// Bônus de combo: acertar perguntas seguidas acumula pontos extras.
// A partir do 2º acerto seguido, +50 por nível de combo, até um teto de
// +250 (combo de 6 ou mais) — pra não desequilibrar demais o placar.
export function comboBonus(streak) {
  if (!streak || streak < 2) return 0;
  return Math.min((streak - 1) * 50, 250);
}

// Pontuação de UMA pergunta ao vivo, dado o combo até a pergunta anterior.
// Usado pelo admin ao revelar cada pergunta, sequencialmente.
export function nextQuestionScore({ prevStreak = 0, correct, timeMs, timeLimit, multiplier = 1, precisionMode = false }) {
  if (!correct) return { points: 0, newStreak: 0, combo: 0, bonus: 0 };
  const newStreak = prevStreak + 1;
  const base = kahootPoints(timeMs, timeLimit, multiplier, precisionMode);
  const bonus = comboBonus(newStreak);
  return { points: base + bonus, newStreak, combo: newStreak >= 2 ? newStreak : 0, bonus };
}

// Recalcula a pontuação de uma sequência inteira de perguntas (usado nos
// relatórios e no PDF), reconstruindo o combo do zero — dá o mesmo
// resultado de quando foi jogado ao vivo, pergunta por pergunta.
export function scoreQuestionSequence(items, precisionMode = false) {
  let streak = 0;
  return items.map((it) => {
    if (!it.correct) { streak = 0; return { points: 0, combo: 0, bonus: 0 }; }
    streak += 1;
    const base = kahootPoints(it.timeMs, it.timeLimit, it.multiplier, precisionMode);
    const bonus = comboBonus(streak);
    return { points: base + bonus, combo: streak >= 2 ? streak : 0, bonus };
  });
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
