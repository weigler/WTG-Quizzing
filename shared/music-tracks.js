// Trilhas de domínio público (CC0) pra dar clima à partida, tocadas na
// tela de quem está controlando o jogo (não no celular de cada jogador —
// senão viraria uma bagunça de sons desencontrados).
//
// Fonte: freepd.com — um acervo de música 100% domínio domínio público
// mantido por quase 20 anos. O site original saiu do ar em 2025, mas o
// acervo inteiro foi preservado permanentemente no Internet Archive, que
// é onde esses links apontam (muito mais estável que um site pessoal).
// Se algum link parar de funcionar, é só trocar por outra faixa do mesmo
// acervo: https://archive.org/details/freepd
export const MUSIC_TRACKS = [
  {
    id: "alegre",
    label: "🎉 Alegre — Assobio animado",
    file: "Happy Whistling Ukulele.mp3",
    credit: "Happy Whistling Ukulele — domínio público (freepd.com / Internet Archive)",
  },
  {
    id: "suspense",
    label: "🕵️ Suspense — Tática furtiva",
    file: "Guerilla Tactics.mp3",
    credit: "Guerilla Tactics — domínio público (freepd.com / Internet Archive)",
  },
  {
    id: "tensao",
    label: "⏱️ Tensão — Contra o tempo",
    file: "City Run.mp3",
    credit: "City Run — domínio público (freepd.com / Internet Archive)",
  },
  {
    id: "vitoria",
    label: "🏆 Vitória — Inspiração",
    file: "Inspiration.mp3",
    credit: "Inspiration — domínio público (freepd.com / Internet Archive)",
  },
  {
    id: "leve",
    label: "🎶 Leve — Violãozinho",
    file: "Ukulele Song.mp3",
    credit: "Ukulele Song — domínio público (freepd.com / Internet Archive)",
  },
];

export function trackUrl(file) {
  return `https://archive.org/download/freepd/${encodeURIComponent(file)}`;
}

export function findTrack(id) {
  return MUSIC_TRACKS.find((t) => t.id === id) || null;
}
