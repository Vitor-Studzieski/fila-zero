const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

function buildTicketReceipt(payload = {}) {
  const ticketCode = cleanText(payload.ticketCode, 16) || "---";
  const sectorName = cleanText(payload.sectorName, 60) || "SETOR";
  const issuedAt = formatIssuedAt(payload.issuedAt);

  return Buffer.concat([
    command(ESC, 0x40),
    command(ESC, 0x61, 1),
    command(ESC, 0x45, 1),
    command(GS, 0x21, 0x11),
    asciiLine("FILA ZERO"),
    command(GS, 0x21, 0),
    command(ESC, 0x45, 0),
    asciiLine(sectorName.toUpperCase()),
    command(ESC, 0x64, 1),
    asciiLine("SENHA"),
    command(ESC, 0x45, 1),
    command(GS, 0x21, 0x33),
    asciiLine(ticketCode),
    command(GS, 0x21, 0),
    command(ESC, 0x45, 0),
    command(ESC, 0x64, 1),
    asciiLine(`Emitida em ${issuedAt}`),
    command(ESC, 0x64, 4),
    command(GS, 0x56, 66, 4)
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
