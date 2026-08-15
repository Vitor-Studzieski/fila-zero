const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildTicketReceipt } = require("../server/escpos-receipt");
const { printJobDto } = require("../server/print-kiosk-service");
const { assertPrintableJob, processJob, receiptPayload } = require("../scripts/print-agent");
const { SerialPrinter, queryStatus } = require("../scripts/print-agent/serial-printer");
const {
  PrintedJobJournal,
  loadAgentEnvironment,
  readAgentConfiguration
} = require("../scripts/print-agent/runtime");

test("gera cupom ESC/POS sem QR e com corte para a Bematech", () => {
  const receipt = buildTicketReceipt({
    ticketCode: "A042",
    sectorName: "Acougue",
    issuedAt: "2026-07-29T20:00:00.000Z",
    installUrl: "https://senhahub.vercel.app/instalar",
    trackUrl: "https://senhahub.vercel.app/acompanhar/token-de-teste-1234567890",
    paperWidthMm: 80
  });

  assert.ok(receipt.length > 50);
  assert.ok(receipt.includes(Buffer.from("A042", "ascii")));
  assert.equal(receipt.includes(Buffer.from([0x1d, 0x76, 0x30, 0])), false);
  assert.ok(receipt.includes(Buffer.from([0x1d, 0x28, 0x6b])));
  assert.ok(receipt.includes(Buffer.from([0x1d, 0x56, 66, 4])));
});

test("totem exibe o QR geral separado do QR individual da senha", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../public/totem.html"), "utf8");
  const script = fs.readFileSync(path.resolve(__dirname, "../public/totem.js"), "utf8");
  assert.match(html, /id="totemGeneralQr"/);
  assert.match(html, /id="resultTrackQr"/);
  assert.match(html, /id="issueNormalTicketButton"/);
  assert.match(html, /id="issuePriorityTicketButton"/);
  assert.match(html, /id="backNormalTicketButton"/);
  assert.match(html, /id="backPriorityTicketButton"/);
  assert.match(html, /Confirme sua escolha/);
  assert.doesNotMatch(html, /id="totemStepConfirm"/);
  assert.match(script, /kiosk\?\.appUrl/);
  assert.match(script, /senhahub\.vercel\.app\/login\?next=%2F/);
  assert.match(script, /trackUrl/);
  assert.match(script, /setStep\(state\.serviceType === "preferencial" \? "priority" : "type"\)/);
});

test("carrega configuracao local sem sobrescrever variaveis do processo", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "senhahub-agent-"));
  const configFile = path.join(directory, ".env.print-agent");
  fs.writeFileSync(configFile, [
    "PRINT_API_URL=https://senhahub.vercel.app",
    "PRINT_AGENT_TOKEN=abcdefghijklmnopqrstuvwxyz1234567890",
    "KIOSK_PRINTER_PORT=COM9",
    "PRINT_SERIAL_BAUD_RATE=9600"
  ].join("\n"));

  const previous = { ...process.env };
  try {
    delete process.env.PRINT_API_URL;
    delete process.env.PRINT_AGENT_TOKEN;
    delete process.env.KIOSK_PRINTER_PORT;
    delete process.env.PRINT_SERIAL_BAUD_RATE;
    loadAgentEnvironment(configFile);
    const config = readAgentConfiguration({ ...process.env, NODE_ENV: "production" });
    assert.equal(config.printerPort, "COM9");
    assert.equal(config.baudRate, 9600);
  } finally {
    process.env = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("usa a porta configurada pelo agente ao criar a impressora", () => {
  const printer = new SerialPrinter({ printerPort: "COM9" });
  assert.equal(printer.path, "COM9");
});

test("journal impede reimpressao de trabalho ja enviado", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "senhahub-journal-"));
  try {
    const first = new PrintedJobJournal(directory);
    first.add("job-123");
    const restarted = new PrintedJobJournal(directory);
    assert.equal(restarted.has("job-123"), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("consulta status ESC/POS pela porta serial", async () => {
  const port = new EventEmitter();
  port.write = (buffer, callback) => {
    assert.deepEqual(buffer, Buffer.from([0x10, 0x04, 2]));
    callback();
    setImmediate(() => port.emit("data", Buffer.from([0x12])));
  };
  assert.equal(await queryStatus(port, 2, 100), 0x12);
});

test("registra falha na API quando a impressora rejeita o trabalho", async () => {
  const calls = [];
  const job = sampleJob();
  const printer = { print: async () => { throw new Error("COM3 indisponivel"); } };
  const journal = { has: () => false, add: () => assert.fail("nao deve registrar") };
  const logger = { info: () => {}, error: () => {} };
  const finish = async (_config, jobId, success, error) => calls.push({ jobId, success, error });

  await assert.rejects(
    processJob(job, {}, printer, journal, logger, undefined, finish),
    /COM3 indisponivel/
  );
  assert.deepEqual(calls, [{ jobId: job.id, success: false, error: "COM3 indisponivel" }]);
});

test("nao marca impressao como falha se apenas a confirmacao da API cair", async () => {
  const calls = [];
  let printed = false;
  let journaled = false;
  const job = sampleJob();
  const printer = { print: async () => { printed = true; } };
  const journal = {
    has: () => false,
    add: () => { journaled = true; }
  };
  const logger = { info: () => {}, error: () => {} };
  const finish = async (_config, jobId, success) => {
    calls.push({ jobId, success });
    throw new Error("internet indisponivel");
  };

  await assert.rejects(
    processJob(job, {}, printer, journal, logger, undefined, finish),
    /internet indisponivel/
  );
  assert.equal(printed, true);
  assert.equal(journaled, true);
  assert.deepEqual(calls, [{ jobId: job.id, success: true }]);
});

test("usa a data de criacao quando um trabalho antigo nao possui horario valido", () => {
  const payload = receiptPayload({
    id: "job-antigo",
    createdAt: "2026-08-12T14:00:00.000Z",
    payload: { ticketCode: "A002", sectorName: "Acougue", issuedAt: "invalido" }
  }, { info: () => {} });

  assert.equal(payload.issuedAt, "2026-08-12T14:00:00.000Z");
  assert.ok(buildTicketReceipt(payload).includes(Buffer.from("A002", "ascii")));
});

test("recusa trabalho sem identificador para nunca imprimir um cupom sem senha", () => {
  assert.throws(
    () => assertPrintableJob({ payload: { ticketCode: "A002" } }),
    /ID ausente/
  );
});

test("interpreta retorno vazio da RPC como fila sem trabalho", () => {
  assert.equal(printJobDto({}), null);
  assert.equal(printJobDto(null), null);
});

function sampleJob() {
  return {
    id: "job-123",
    payload: {
      ticketCode: "A001",
      sectorName: "Acougue",
      issuedAt: "2026-07-29T20:00:00.000Z",
      installUrl: "https://senhahub.vercel.app/instalar",
      paperWidthMm: 80
    }
  };
}
