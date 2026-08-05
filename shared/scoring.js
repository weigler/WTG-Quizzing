// Mesma fórmula do Kahoot: até 1000 pontos, caindo linearmente até um
// "piso" conforme o tempo de resposta se aproxima do limite da pergunta.
// Errado = 0, sempre. O multiplicador permite perguntas "bônus" que valem
// em dobro (ou mais).
//
// O piso é controlado por SPEED_WEIGHT — o quanto a velocidade pesa na
// pontuação de uma resposta certa:
//   padrao   → piso 50% (padrão clássico do Kahoot)
//   reduzido → piso 75% (velocidade ainda importa, mas menos)
//   minimo   → piso 90% (só separa quem foi instantâneo do resto)
//   precisao → piso 100% (velocidade não conta nada — só acerto importa)
//
// Resposta instantânea (menos de 0,5s): pontuação máxima garantida, sem
// desconto nenhum de tempo — recompensa quem já sabia na hora.
const INSTANT_THRESHOLD_MS = 500;

export const SPEED_WEIGHT_FLOORS = { padrao: 0.5, reduzido: 0.75, minimo: 0.9, precisao: 1 };
export const SPEED_WEIGHT_LABELS = {
  padrao: "Padrão — velocidade pesa bastante (clássico do Kahoot)",
  reduzido: "Reduzido — velocidade ainda conta, mas menos",
  minimo: "Mínimo — velocidade quase não conta",
  precisao: "Precisão — só o acerto importa, velocidade não conta",
};
export const DEFAULT_SPEED_WEIGHT = "padrao";

// Compatibilidade com quizzes/sessões salvos antes desse controle existir
// (eles só tinham o antigo campo booleano precisionMode).
export function resolveSpeedWeight(obj) {
  if (obj?.speedWeight && SPEED_WEIGHT_FLOORS[obj.speedWeight] !== undefined) return obj.speedWeight;
  return obj?.precisionMode ? "precisao" : DEFAULT_SPEED_WEIGHT;
}

export function kahootPoints(timeMs, timeLimitSeconds, multiplier = 1, speedWeight = DEFAULT_SPEED_WEIGHT) {
  const m = multiplier || 1;
  const floor = SPEED_WEIGHT_FLOORS[speedWeight] ?? SPEED_WEIGHT_FLOORS[DEFAULT_SPEED_WEIGHT];
  const t = Math.max(timeMs || 0, 0);
  if (floor >= 1 || t < INSTANT_THRESHOLD_MS) return Math.round(1000 * m);
  const frac = Math.min(t / (timeLimitSeconds * 1000), 1);
  return Math.round(1000 * (1 - frac * (1 - floor)) * m);
}

// Bônus de combo: acertar perguntas seguidas acumula pontos extras.
// A partir do 2º acerto seguido, +50 por nível de combo, até um teto de
// +250 (combo de 6 ou mais) — pra não desequilibrar demais o placar.
export function comboBonus(streak) {
  if (!streak || streak < 2) return 0;
  return Math.min((streak - 1) * 50, 250);
}

// Pontuação de UMA pergunta ao vivo, dado o combo até a pergunta anterior.
// Usado pelo admin ao revelar cada pergunta, sequencialmente. O bônus de
// combo só entra se o quiz tiver o Modo Combo ativado (desligado por
// padrão, igual o Modo de Precisão).
export function nextQuestionScore({ prevStreak = 0, correct, timeMs, timeLimit, multiplier = 1, speedWeight = DEFAULT_SPEED_WEIGHT, comboMode = false }) {
  if (!correct) return { points: 0, newStreak: 0, combo: 0, bonus: 0 };
  const newStreak = prevStreak + 1;
  const base = kahootPoints(timeMs, timeLimit, multiplier, speedWeight);
  const bonus = comboMode ? comboBonus(newStreak) : 0;
  return { points: base + bonus, newStreak, combo: comboMode && newStreak >= 2 ? newStreak : 0, bonus };
}

// Recalcula a pontuação de uma sequência inteira de perguntas (usado nos
// relatórios e no PDF), reconstruindo o combo do zero — dá o mesmo
// resultado de quando foi jogado ao vivo, pergunta por pergunta.
export function scoreQuestionSequence(items, speedWeight = DEFAULT_SPEED_WEIGHT, comboMode = false) {
  let streak = 0;
  return items.map((it) => {
    if (!it.correct) { streak = 0; return { points: 0, combo: 0, bonus: 0 }; }
    streak += 1;
    const base = kahootPoints(it.timeMs, it.timeLimit, it.multiplier, speedWeight);
    const bonus = comboMode ? comboBonus(streak) : 0;
    return { points: base + bonus, combo: comboMode && streak >= 2 ? streak : 0, bonus };
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
