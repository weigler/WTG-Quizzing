export const AVATAR_COLORS = ["#FF4D6D", "#4D7CFF", "#FFC93C", "#3DDC97", "#B45DFF", "#2BD9C9", "#FF9F4D", "#F272C0"];
export const SPECIES = ["raposa", "urso", "gato", "coelho", "tigre", "coruja"];
export const SPECIES_LABEL = { raposa: "raposa", urso: "urso", gato: "gato", coelho: "coelho", tigre: "tigre", coruja: "coruja" };
export const HATS = ["none", "cap", "crown", "party", "headband", "bow", "flower", "wizard", "cowboy"];
export const GLASSES = ["none", "round", "cool", "star"];

const CREAM = "#FFF6EA";
const INK = "#2B1C14";
const PINK = "#FF9FB0";

export function defaultAvatar() {
  return { species: "raposa", color: AVATAR_COLORS[0], hat: "none", glasses: "none" };
}

/* ---------------- orelhas (atrás do rosto) ---------------- */
function earsPath(species, c) {
  if (species === "urso" || species === "tigre") {
    return `<circle cx="20" cy="23" r="15" fill="${c}"/><circle cx="80" cy="23" r="15" fill="${c}"/>
            <circle cx="20" cy="23" r="6" fill="${CREAM}"/><circle cx="80" cy="23" r="6" fill="${CREAM}"/>`;
  }
  if (species === "gato") {
    return `<polygon points="16,30 27,-1 39,28" fill="${c}"/><polygon points="84,30 73,-1 61,28" fill="${c}"/>
            <polygon points="21,24 27,7 33,23" fill="${PINK}"/><polygon points="79,24 73,7 67,23" fill="${PINK}"/>`;
  }
  if (species === "coelho") {
    return `<ellipse cx="34" cy="4" rx="9" ry="26" fill="${c}" transform="rotate(-10 34 4)"/>
            <ellipse cx="66" cy="4" rx="9" ry="26" fill="${c}" transform="rotate(10 66 4)"/>
            <ellipse cx="34" cy="6" rx="4" ry="19" fill="${PINK}" transform="rotate(-10 34 6)"/>
            <ellipse cx="66" cy="6" rx="4" ry="19" fill="${PINK}" transform="rotate(10 66 6)"/>`;
  }
  if (species === "coruja") {
    return `<polygon points="33,22 28,2 42,18" fill="${c}"/><polygon points="67,22 72,2 58,18" fill="${c}"/>`;
  }
  // raposa (padrão)
  return `<polygon points="14,34 29,0 41,32" fill="${c}"/><polygon points="86,34 71,0 59,32" fill="${c}"/>
          <polygon points="19,29 29,8 34,28" fill="${CREAM}"/><polygon points="81,29 71,8 66,28" fill="${CREAM}"/>`;
}

/* ---------------- focinho / marcas (na frente do rosto) ---------------- */
function frontDetails(species) {
  if (species === "urso") {
    return `<ellipse cx="50" cy="65" rx="15" ry="12" fill="${CREAM}"/><ellipse cx="50" cy="59" rx="5" ry="4" fill="${INK}"/>`;
  }
  if (species === "tigre") {
    return `<ellipse cx="50" cy="65" rx="15" ry="12" fill="${CREAM}"/><ellipse cx="50" cy="59" rx="5" ry="4" fill="${INK}"/>
            <path d="M28,26 Q34,15 41,25" stroke="${INK}" stroke-width="3" fill="none" opacity=".55" stroke-linecap="round"/>
            <path d="M72,26 Q66,15 59,25" stroke="${INK}" stroke-width="3" fill="none" opacity=".55" stroke-linecap="round"/>
            <path d="M50,20 L50,30" stroke="${INK}" stroke-width="3" opacity=".55" stroke-linecap="round"/>`;
  }
  if (species === "gato") {
    return `<polygon points="46,59 54,59 50,65" fill="${PINK}"/>
            <line x1="8" y1="61" x2="28" y2="58" stroke="${INK}" stroke-width="1.5" opacity=".45"/>
            <line x1="8" y1="67" x2="28" y2="66" stroke="${INK}" stroke-width="1.5" opacity=".45"/>
            <line x1="92" y1="61" x2="72" y2="58" stroke="${INK}" stroke-width="1.5" opacity=".45"/>
            <line x1="92" y1="67" x2="72" y2="66" stroke="${INK}" stroke-width="1.5" opacity=".45"/>`;
  }
  if (species === "coelho") {
    return `<circle cx="50" cy="62" r="4" fill="${PINK}"/>`;
  }
  if (species === "coruja") {
    return ""; // sem focinho, tratado nos olhos/bico
  }
  // raposa
  return `<ellipse cx="50" cy="64" rx="17" ry="13" fill="${CREAM}"/><polygon points="43,58 57,58 50,67" fill="${INK}"/>`;
}

/* ---------------- olhos e boca (bico, no caso da coruja) ---------------- */
function eyesAndMouth(species) {
  if (species === "coruja") {
    return `
      <circle cx="36" cy="49" r="12" fill="#fff"/><circle cx="64" cy="49" r="12" fill="#fff"/>
      <circle cx="37" cy="50" r="5.5" fill="${INK}"/><circle cx="65" cy="50" r="5.5" fill="${INK}"/>
      <circle cx="39" cy="48" r="1.6" fill="#fff"/><circle cx="67" cy="48" r="1.6" fill="#fff"/>
      <polygon points="46,60 54,60 50,68" fill="#FFA53D"/>
    `;
  }
  return `
    <circle cx="36" cy="50" r="4" fill="${INK}"/>
    <circle cx="64" cy="50" r="4" fill="${INK}"/>
    <path d="M34,64 Q50,76 66,64" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>
  `;
}

/* ---------------- óculos ---------------- */
function glassesPath(glasses) {
  if (glasses === "round") {
    return `<circle cx="36" cy="50" r="10" fill="none" stroke="${INK}" stroke-width="3"/>
            <circle cx="64" cy="50" r="10" fill="none" stroke="${INK}" stroke-width="3"/>
            <line x1="46" y1="50" x2="54" y2="50" stroke="${INK}" stroke-width="3"/>`;
  }
  if (glasses === "cool") {
    return `<rect x="24" y="43" width="22" height="14" rx="5" fill="${INK}"/>
            <rect x="54" y="43" width="22" height="14" rx="5" fill="${INK}"/>
            <rect x="46" y="47" width="8" height="4" fill="${INK}"/>`;
  }
  if (glasses === "star") {
    const star = (cx, cy) => {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 9 : 4;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
      }
      return `<polygon points="${pts.join(" ")}" fill="#FFC93C" stroke="${INK}" stroke-width="1.5"/>`;
    };
    return `${star(36, 50)}${star(64, 50)}<line x1="45" y1="50" x2="55" y2="50" stroke="${INK}" stroke-width="2"/>`;
  }
  return "";
}

/* ---------------- chapéus / acessórios de cabeça ---------------- */
function hatPath(hat) {
  if (hat === "cap") {
    return `<path d="M13,29 A37,29 0 0 1 87,29 L87,19 A37,25 0 0 0 13,19 Z" fill="#2b2f3a"/>
            <rect x="49" y="17" width="32" height="8" rx="4" fill="#1c1f27" transform="rotate(-9 49 17)"/>`;
  }
  if (hat === "crown") {
    return `<polygon points="18,32 28,9 38,27 50,5 62,27 72,9 82,32" fill="#FFC93C" stroke="#caa100" stroke-width="2"/>
            <circle cx="28" cy="9" r="3" fill="#FF4D6D"/><circle cx="50" cy="5" r="3" fill="#FF4D6D"/><circle cx="72" cy="9" r="3" fill="#FF4D6D"/>`;
  }
  if (hat === "party") {
    return `<polygon points="50,0 27,34 73,34" fill="#B45DFF"/>
            <circle cx="50" cy="0" r="4" fill="#FFC93C"/>
            <circle cx="45" cy="18" r="2" fill="#fff"/><circle cx="56" cy="25" r="2" fill="#fff"/>`;
  }
  if (hat === "headband") {
    return `<rect x="13" y="25" width="74" height="8" rx="4" fill="#fff"/>
            <polygon points="83,29 92,22 92,36" fill="#FF4D6D"/><polygon points="83,29 92,26 92,32" fill="#c93655"/>`;
  }
  if (hat === "bow") {
    return `<polygon points="50,13 32,3 32,23" fill="#FF4D6D"/><polygon points="50,13 68,3 68,23" fill="#FF4D6D"/>
            <circle cx="50" cy="13" r="5" fill="#c93655"/>`;
  }
  if (hat === "flower") {
    return `<path d="M15,29 Q50,8 85,29" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round"/>
            <circle cx="28" cy="21" r="6" fill="${PINK}"/><circle cx="28" cy="21" r="2.5" fill="#FFC93C"/>
            <circle cx="50" cy="11" r="6" fill="${PINK}"/><circle cx="50" cy="11" r="2.5" fill="#FFC93C"/>
            <circle cx="72" cy="21" r="6" fill="${PINK}"/><circle cx="72" cy="21" r="2.5" fill="#FFC93C"/>`;
  }
  if (hat === "wizard") {
    return `<ellipse cx="50" cy="33" rx="27" ry="7" fill="#5B3FA0"/>
            <polygon points="50,-24 29,35 71,35" fill="#7C5CD6"/>
            <circle cx="50" cy="-16" r="5" fill="#FFC93C"/>`;
  }
  if (hat === "cowboy") {
    return `<ellipse cx="50" cy="29" rx="41" ry="8" fill="#8B5A2B"/>
            <ellipse cx="50" cy="14" rx="20" ry="14" fill="#A56A35"/>`;
  }
  return "";
}

export function avatarSVG(config, size = 88) {
  const c = { ...defaultAvatar(), ...(config || {}) };
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      ${earsPath(c.species, c.color)}
      <circle cx="50" cy="54" r="38" fill="${c.color}" stroke="#00000022" stroke-width="2"/>
      ${frontDetails(c.species)}
      ${eyesAndMouth(c.species)}
      ${glassesPath(c.glasses)}
      ${hatPath(c.hat)}
    </svg>
  `;
}

// Converte o avatar em PNG (data URL), pra poder ser inserido em um PDF —
// jsPDF não sabe desenhar SVG diretamente.
export function avatarPngDataUrl(config, size = 200) {
  return new Promise((resolve, reject) => {
    const svg = avatarSVG(config, size);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, size, size);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
  });
}
