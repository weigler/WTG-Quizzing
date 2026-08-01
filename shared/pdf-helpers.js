// Helpers pra montar PDFs com jsPDF + autotable (carregados via <script> no
// HTML, então usamos window.jspdf em vez de importar como módulo).

export const PDF_COLORS = {
  gold: [255, 201, 60],
  ink: [26, 22, 10],
  dim: [110, 110, 120],
  green: [23, 130, 90],
  coral: [200, 40, 70],
  line: [225, 222, 210],
};

export function getJsPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert("Não consegui carregar o gerador de PDF. Confira sua conexão e tente de novo.");
    return null;
  }
  return window.jspdf.jsPDF;
}

// Cabeçalho padrão: eyebrow + título + subtítulo + linha dourada
export function addPdfHeader(doc, { eyebrow, title, subtitle }) {
  doc.setFillColor(...PDF_COLORS.ink);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 34, "F");
  doc.setTextColor(...PDF_COLORS.gold);
  doc.setFontSize(9);
  doc.text((eyebrow || "").toUpperCase(), 14, 12);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(17);
  doc.text(title || "", 14, 22);
  if (subtitle) {
    doc.setTextColor(...PDF_COLORS.gold);
    doc.setFontSize(10);
    doc.text(subtitle, 14, 29);
  }
  doc.setTextColor(...PDF_COLORS.ink);
  return 42; // próxima posição Y livre
}

export function addSectionTitle(doc, text, y) {
  doc.setTextColor(...PDF_COLORS.ink);
  doc.setFontSize(13);
  doc.text(text, 14, y);
  doc.setDrawColor(...PDF_COLORS.gold);
  doc.setLineWidth(0.8);
  doc.line(14, y + 2, doc.internal.pageSize.getWidth() - 14, y + 2);
  return y + 9;
}

export const AUTOTABLE_THEME = {
  headStyles: { fillColor: PDF_COLORS.ink, textColor: [255, 255, 255], fontSize: 9 },
  bodyStyles: { fontSize: 9, textColor: PDF_COLORS.ink },
  alternateRowStyles: { fillColor: [248, 246, 240] },
  styles: { cellPadding: 3, lineColor: PDF_COLORS.line, lineWidth: 0.2 },
};
