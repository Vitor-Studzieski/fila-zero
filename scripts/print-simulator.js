const API_URL = String(process.env.PRINT_API_URL || "http://localhost:3000").replace(/\/+$/, "");
const AGENT_TOKEN = String(process.env.PRINT_AGENT_TOKEN || "");
const KIOSK_ID = String(process.env.KIOSK_ID || "totem-pompeia-01");
const POLL_INTERVAL_MS = Math.max(500, Number(process.env.PRINT_POLL_INTERVAL_MS || 2000));
const runOnce = process.argv.includes("--once");

if (AGENT_TOKEN.length < 32) {
  console.error("Configure PRINT_AGENT_TOKEN com ao menos 32 caracteres.");
  process.exitCode = 1;
} else {
  run().catch((error) => {
    console.error(`Simulador encerrado: ${error.message}`);
    process.exitCode = 1;
  });
}

async function run() {
  console.log(`Simulador conectado a ${API_URL} para o totem ${KIOSK_ID}.`);
  do {
    const job = await claimJob();
    if (job) {
      try {
        console.log(renderReceipt(job.payload));
        await delay(350);
        await finishJob(job.id, true);
        console.log(`Impressao simulada concluida: ${job.payload.ticketCode}.`);
      } catch (error) {
        await finishJob(job.id, false, error.message);
        throw error;
      }
    } else if (runOnce) {
      console.log("Nenhum trabalho de impressao pendente.");
    }
    if (!runOnce) await delay(POLL_INTERVAL_MS);
  } while (!runOnce);
}

async function claimJob() {
  const response = await agentFetch("/api/print/jobs/claim", {
    method: "POST",
    body: { kioskId: KIOSK_ID }
  });
  return response.job || null;
}

async function finishJob(jobId, success, error = null) {
  return agentFetch(`/api/print/jobs/${encodeURIComponent(jobId)}/finish`, {
    method: "POST",
    body: { kioskId: KIOSK_ID, success, error }
  });
}

async function agentFetch(path, options) {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method,
    headers: {
      "content-type": "application/json",
      "x-print-agent-token": AGENT_TOKEN,
      "x-print-agent-kiosk-id": KIOSK_ID
    },
    body: JSON.stringify(options.body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    throw new Error(payload.error || `Falha HTTP ${response.status}`);
  }
  return payload;
}

function renderReceipt(payload = {}) {
  const width = 42;
  const line = "-".repeat(width);
  const tickets = Array.isArray(payload.tickets) && payload.tickets.length ? payload.tickets : [payload];
  const issuedAt = (ticket) => new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(ticket.issuedAt || payload.issuedAt));
  const ticketBlocks = tickets.flatMap((ticket, index) => [
    center(String(ticket.sectorName || payload.sectorName || "").toUpperCase(), width),
    "",
    center("SENHA", width),
    center(String(ticket.ticketCode || payload.ticketCode || "---"), width),
    "",
    center(`Emitida em ${issuedAt(ticket)}`, width),
    ...(index < tickets.length - 1 ? [line] : [])
  ]);
  return [
    "",
    line,
    center("SUPERMERCADO POMPEIA", width),
    center("SenhaHub", width),
    ...ticketBlocks,
    center("[ QR CODE DA SENHA ]", width),
    center("Escaneie o QR Code para acompanhar", width),
    line,
    ""
  ].join("\n");
}

function center(value, width) {
  const text = String(value || "").slice(0, width);
  const left = Math.max(0, Math.floor((width - text.length) / 2));
  return `${" ".repeat(left)}${text}`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
