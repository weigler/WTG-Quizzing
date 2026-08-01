// Converte texto colado (formato simples de quiz, ou JSON) em perguntas
// no formato do app. Feito pra aceitar texto vindo de ferramentas de IA
// (NotebookLM, ChatGPT, Gemini etc.) que geram quizzes em texto corrido.

const rid = () => Math.random().toString(36).slice(2, 10);

function stripAccents(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeType(raw) {
  const t = stripAccents(String(raw || "")).toLowerCase();
  if (t.includes("multipla") || t.includes("multiple")) return "multiple";
  if (t.includes("verdadeiro") || t === "vf" || t.includes("true") || t.includes("tf")) return "tf";
  return "single";
}

const OPTION_RE = /^([A-Fa-f])[\)\.\-:]\s*(.+)$/;
const ANSWER_RE = /^(respostas?|gabarito|correct|answer)s?\s*:\s*(.+)$/i;
const TIME_RE = /^tempo\s*:?\s*(\d+)/i;
const TYPE_RE = /^tipo\s*:\s*(.+)/i;
const BONUS_RE = /^(b[oô]nus|multiplicador)\s*:?\s*(\d+(?:[.,]\d+)?)x?/i;
const QNUM_PREFIX_RE = /^(pergunta\s*\d*\s*:?|quest[aã]o\s*\d*\s*:?|q\d*[:.)]|\d+[.)])\s*/i;
const CORRECT_MARK_RE = /\s*[\*✔✅]\s*$|\s*\((certa|correta|correto)\)\s*$/i;

function parseAnswerTokens(spec) {
  return spec
    .split(/,|\/| e |\bet\b|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function findCorrectIndices(tokens, options) {
  const idxs = [];
  for (const tok of tokens) {
    const t = stripAccents(tok).toLowerCase().replace(/[\).:]/g, "").trim();
    // letra (a, b, c...) ou número (1, 2, 3...)
    let idx = "abcdef".indexOf(t);
    if (idx === -1 && /^\d+$/.test(t)) idx = Number(t) - 1;
    if (idx === -1) {
      // tenta casar pelo texto da opção
      idx = options.findIndex((o) => stripAccents(o).toLowerCase().trim() === t);
    }
    if (idx >= 0 && idx < options.length && !idxs.includes(idx)) idxs.push(idx);
  }
  return idxs;
}

function parsePlainText(raw) {
  const blocks = raw
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  const questions = [];
  const warnings = [];

  blocks.forEach((block, bi) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    let text = "";
    const rawOptions = []; // { label, text, forcedCorrect }
    let answerSpec = null;
    let timeLimit = null;
    let typeOverride = null;
    let multiplier = 1;

    for (const line of lines) {
      const optMatch = line.match(OPTION_RE);
      const ansMatch = line.match(ANSWER_RE);
      const timeMatch = line.match(TIME_RE);
      const typeMatch = line.match(TYPE_RE);
      const bonusMatch = line.match(BONUS_RE);
      const bareTF = /^(verdadeiro|falso|true|false)\s*[\*✔✅]?$/i.test(stripAccents(line));

      if (optMatch) {
        const forcedCorrect = CORRECT_MARK_RE.test(optMatch[2]);
        const cleanText = optMatch[2].replace(CORRECT_MARK_RE, "").trim();
        rawOptions.push({ text: cleanText, forcedCorrect });
      } else if (bareTF && text) {
        const forcedCorrect = /[\*✔✅]\s*$/.test(line);
        const cleanText = line.replace(/\s*[\*✔✅]\s*$/, "").trim();
        rawOptions.push({ text: cleanText, forcedCorrect });
      } else if (ansMatch) {
        answerSpec = ansMatch[2].trim();
      } else if (timeMatch) {
        timeLimit = Math.max(5, Math.min(60, Number(timeMatch[1])));
      } else if (typeMatch) {
        typeOverride = normalizeType(typeMatch[1]);
      } else if (bonusMatch) {
        multiplier = Math.max(1, Number(String(bonusMatch[2]).replace(",", ".")) || 1);
      } else if (!text) {
        text = line.replace(QNUM_PREFIX_RE, "").trim();
      } else if (rawOptions.length === 0) {
        text += " " + line;
      }
      // linhas que não batem com nada e já tem pergunta+opções são ignoradas
    }

    if (!text) {
      warnings.push(`Bloco ${bi + 1}: não encontrei o texto da pergunta — pulei.`);
      return;
    }

    // detecta verdadeiro/falso mesmo sem "Tipo:" explícito
    const isTF =
      typeOverride === "tf" ||
      (rawOptions.length === 2 &&
        rawOptions.every((o) => /^(v(erdadeiro)?|f(also)?|true|false)$/i.test(stripAccents(o.text).trim())));

    let options = rawOptions.map((o) => o.text);
    let correct = [];

    if (isTF) {
      options = ["Verdadeiro", "Falso"];
      const fromMark = rawOptions.findIndex((o) => o.forcedCorrect);
      if (fromMark >= 0) {
        correct = [/^v/i.test(stripAccents(rawOptions[fromMark].text)) ? 0 : 1];
      } else if (answerSpec) {
        correct = /^v/i.test(stripAccents(answerSpec)) ? [0] : [1];
      }
    } else {
      correct = rawOptions.map((o, i) => (o.forcedCorrect ? i : -1)).filter((i) => i >= 0);
      if (correct.length === 0 && answerSpec) {
        correct = findCorrectIndices(parseAnswerTokens(answerSpec), options);
      }
    }

    if (!isTF && options.length < 2) {
      warnings.push(`Pergunta "${text.slice(0, 40)}...": menos de 2 opções — pulei.`);
      return;
    }
    if (correct.length === 0) {
      warnings.push(`Pergunta "${text.slice(0, 40)}...": não achei a resposta certa — pulei.`);
      return;
    }

    const type = typeOverride || (isTF ? "tf" : correct.length > 1 ? "multiple" : "single");

    questions.push({
      id: rid(),
      text,
      type,
      options,
      correct,
      timeLimit: timeLimit || null,
      pointsMultiplier: multiplier,
      imageUrl: null,
      imageCredit: null,
    });
  });

  return { questions, warnings };
}

function parseJson(raw) {
  const data = JSON.parse(raw);
  const list = Array.isArray(data) ? data : data.questions || data.perguntas || [];
  const questions = [];
  const warnings = [];

  list.forEach((item, i) => {
    const text = item.text || item.pergunta || item.question || "";
    const options = item.options || item.opcoes || item.opções || [];
    let type = normalizeType(item.type || item.tipo);
    let correctRaw = item.correct ?? item.correta ?? item.certa ?? item.resposta ?? item.answer;

    if (!text || !Array.isArray(options) || options.length < 2) {
      warnings.push(`Item ${i + 1}: faltando texto ou opções — pulei.`);
      return;
    }

    let correct = [];
    if (Array.isArray(correctRaw)) {
      correct = correctRaw
        .map((c) => (typeof c === "number" ? c : findCorrectIndices([String(c)], options)[0]))
        .filter((c) => Number.isInteger(c) && c >= 0);
    } else if (correctRaw != null) {
      correct = findCorrectIndices(parseAnswerTokens(String(correctRaw)), options);
    }

    if (correct.length === 0) {
      warnings.push(`Item ${i + 1} ("${text.slice(0, 30)}..."): sem resposta certa reconhecida — pulei.`);
      return;
    }
    if (type !== "tf" && type !== "multiple" && correct.length > 1) type = "multiple";

    questions.push({
      id: rid(),
      text,
      type,
      options: type === "tf" ? ["Verdadeiro", "Falso"] : options,
      correct,
      timeLimit: Number(item.timeLimit || item.tempo) || null,
      pointsMultiplier: Number(item.pointsMultiplier || item.multiplicador) || 1,
      imageUrl: null,
      imageCredit: null,
    });
  });

  return { questions, warnings };
}

export function parseQuizText(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return { questions: [], warnings: ["Cole algum texto primeiro."] };

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return parseJson(trimmed);
    } catch {
      // se o JSON estiver malformado, tenta como texto simples mesmo assim
    }
  }
  return parsePlainText(trimmed);
}

export const IMPORT_TEMPLATE = `1. Qual é a capital da França?
A) Paris *
B) Londres
C) Roma
D) Berlim

2. O Sol é uma estrela?
Tipo: vf
Resposta: Verdadeiro

3. Quais são números primos?
A) 2
B) 4
C) 5
D) 9
Resposta: A, C
Tempo: 15
Bônus: 2x`;
