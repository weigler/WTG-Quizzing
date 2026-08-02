// Faixas prontas pra tocar durante o jogo, hospedadas no CDN público da
// ElevenLabs (gratuitas). Testadas uma por uma antes de entrar aqui —
// se algum dia uma parar de funcionar, é só remover da lista ou trocar
// o link.
export const MUSIC_TRACKS = [
  { id: "midnight-drift", label: "🌙 Midnight Drift", url: "https://eleven-public-cdn.elevenlabs.io/payloadcms/8kzrlpjqzba.mp3" },
  { id: "sombras-chuva", label: "🌧️ Sombras na Chuva", url: "https://eleven-public-cdn.elevenlabs.io/payloadcms/qwwegf0xvu.mp3" },
  { id: "devaneio-pedras", label: "🪨 Devaneio do Caminho de Pedras", url: "https://eleven-public-cdn.elevenlabs.io/payloadcms/tuyl6qrpfih.mp3" },
  { id: "memoria-revelada", label: "🔍 Uma Memória Revelada", url: "https://eleven-public-cdn.elevenlabs.io/payloadcms/ooqm8m1mk8.mp3" },
  { id: "clima-lounge", label: "🍸 Clima de Lounge", url: "https://eleven-public-cdn.elevenlabs.io/payloadcms/hft14an08dn.mp3" },
  { id: "fuga-digital", label: "💾 Fuga Digital", url: "https://eleven-public-cdn.elevenlabs.io/payloadcms/d8f37zmatwm.mp3" },
];

export function findTrack(id) {
  return MUSIC_TRACKS.find((t) => t.id === id) || null;
}

// Sugestões de onde procurar mais faixas, caso as prontas não sirvam.
export const SUGGESTED_SOURCES = [
  { mood: "🎵 Mais opções", url: "https://elevenlabs.io/", note: "biblioteca de música gratuita da ElevenLabs" },
  { mood: "🎼 Domínio público", url: "https://archive.org/details/freepd", note: "acervo público (via Internet Archive)" },
];
