const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

function buildTicketReceipt(payload = {}) {
  const ticketCode = cleanText(payload.ticketCode, 16) || "---";
  const sectorName = cleanText(payload.sectorName, 60) || "SETOR";
  const issuedAt = formatIssuedAt(payload.issuedAt);
  const trackingUrl = cleanUrl(payload.trackUrl);

  return Buffer.concat([
    command(ESC, 0x40),
    // A MP-4200 TH pode iniciar em ESC/Bematech; selecione ESC/POS
    // temporariamente para que fonte, corte e QR Code sejam interpretados.
    command(GS, 0xf9, 0x20, 0x01),
    command(ESC, 0x61, 1),
    command(ESC, 0x45, 1),
    command(GS, 0x21, 0x01),
    asciiLine("SUPERMERCADO POMPEIA"),
    command(GS, 0x21, 0x00),
    asciiLine("SenhaHub"),
    asciiLine(sectorName.toUpperCase()),
    command(ESC, 0x64, 1),
    command(ESC, 0x45, 1),
    asciiLine("SENHA"),
    command(GS, 0x21, 0x33),
    asciiLine(ticketCode),
    command(GS, 0x21, 0),
    command(ESC, 0x45, 0),
    command(ESC, 0x64, 1),
    asciiLine(`Emitida em ${issuedAt}`),
    command(ESC, 0x64, 2),
    qrCode(trackingUrl),
    asciiLine("Escaneie o QR Code para acompanhar"),
    command(ESC, 0x64, 3),
    cutPaper()
  ]);
}

function cutPaper() {
  // GS V 66 n: avanca n pontos e executa o corte total.
  return command(GS, 0x56, 0x42, 0x04);
}

function qrCode(value) {
  if (!value) return asciiLine("QR Code indisponivel");
  const data = Buffer.from(value, "utf8");
  const length = data.length + 3;
  return Buffer.concat([
    command(GS, 0x28, 0x6b, 4, 0, 49, 65, 50, 0),
    command(GS, 0x28, 0x6b, 3, 0, 49, 67, 6),
    command(GS, 0x28, 0x6b, 3, 0, 49, 69, 49),
    command(GS, 0x28, 0x6b, length & 0xff, (length >> 8) & 0xff, 49, 80, 48),
    data,
    command(GS, 0x28, 0x6b, 3, 0, 49, 81, 48)
  ]);
}

function formatIssuedAt(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Horario de emissao invalido no trabalho de impressao.");
  }
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(date);
}

function cleanText(value, maxLength) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanUrl(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 512);
}

function asciiLine(value) {
  return Buffer.concat([Buffer.from(cleanText(value, 160), "ascii"), command(LF)]);
}

function command(...bytes) {
  return Buffer.from(bytes);
}

module.exports = {
  buildTicketReceipt,
  cleanText
};
