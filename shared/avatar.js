export const AVATAR_COLORS = ["#FF4D6D", "#4D7CFF", "#FFC93C", "#3DDC97", "#B45DFF", "#2BD9C9", "#FF9F4D", "#F272C0"];
export const HATS = ["none", "cap", "crown", "party", "headband"];
export const GLASSES = ["none", "round", "cool"];
export const MOUTHS = ["smile", "open", "flat"];

export function defaultAvatar() {
  return { color: AVATAR_COLORS[0], hat: "none", glasses: "none", mouth: "smile" };
}

function mouthPath(mouth) {
  if (mouth === "open") return `<ellipse cx="50" cy="66" rx="9" ry="7" fill="#3a2430"/>`;
  if (mouth === "flat") return `<line x1="36" y1="65" x2="64" y2="65" stroke="#20202a" stroke-width="4" stroke-linecap="round"/>`;
  return `<path d="M34,64 Q50,76 66,64" stroke="#20202a" stroke-width="4" fill="none" stroke-linecap="round"/>`;
}

function glassesPath(glasses) {
  if (glasses === "round") {
    return `<circle cx="36" cy="50" r="10" fill="none" stroke="#20202a" stroke-width="3"/>
            <circle cx="64" cy="50" r="10" fill="none" stroke="#20202a" stroke-width="3"/>
            <line x1="46" y1="50" x2="54" y2="50" stroke="#20202a" stroke-width="3"/>`;
  }
  if (glasses === "cool") {
    return `<rect x="24" y="43" width="22" height="14" rx="5" fill="#20202a"/>
            <rect x="54" y="43" width="22" height="14" rx="5" fill="#20202a"/>
            <rect x="46" y="47" width="8" height="4" fill="#20202a"/>`;
  }
  return "";
}

function hatPath(hat) {
  if (hat === "cap") {
    return `<path d="M14,30 A36,28 0 0 1 86,30 L86,21 A36,24 0 0 0 14,21 Z" fill="#2b2f3a"/>
            <rect x="48" y="19" width="30" height="7" rx="3" fill="#1c1f27" transform="rotate(-8 48 19)"/>`;
  }
  if (hat === "crown") {
    return `<polygon points="18,32 28,10 38,28 50,6 62,28 72,10 82,32" fill="#FFC93C" stroke="#caa100" stroke-width="2"/>
            <circle cx="28" cy="10" r="3" fill="#FF4D6D"/><circle cx="50" cy="6" r="3" fill="#FF4D6D"/><circle cx="72" cy="10" r="3" fill="#FF4D6D"/>`;
  }
  if (hat === "party") {
    return `<polygon points="50,2 28,34 72,34" fill="#B45DFF"/>
            <circle cx="50" cy="2" r="4" fill="#FFC93C"/>
            <circle cx="45" cy="20" r="2" fill="#fff"/><circle cx="56" cy="26" r="2" fill="#fff"/>`;
  }
  if (hat === "headband") {
    return `<rect x="14" y="26" width="72" height="9" rx="4.5" fill="#fff"/>
            <circle cx="82" cy="30" r="6" fill="#FF4D6D"/>`;
  }
  return "";
}

export function avatarSVG(config, size = 88) {
  const c = { ...defaultAvatar(), ...(config || {}) };
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="54" r="38" fill="${c.color}" stroke="#00000022" stroke-width="2"/>
      <circle cx="36" cy="50" r="4" fill="#20202a"/>
      <circle cx="64" cy="50" r="4" fill="#20202a"/>
      ${mouthPath(c.mouth)}
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
