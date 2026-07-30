const { buildTicketReceipt } = require("../server/escpos-receipt");
const { SerialPrinter } = require("./print-agent/serial-printer");
const {
  AgentLogger,
  PrintedJobJournal,
  loadAgentEnvironment,
  readAgentConfiguration
} = require("./print-agent/runtime");

const argumentsList = new Set(process.argv.slice(2));

if (require.main === module) {
  loadAgentEnvironment();
  main().catch((error) => {
    process.stderr.write(`Falha ao iniciar o agente: ${error.message}\n`);
    process.exitCode = 1;
  });
}

async function main() {
  if (argumentsList.has("--list-ports")) {
    const ports = await SerialPrinter.list();
    console.log(JSON.stringify(ports, null, 2));
    return;
  }

  const config = readAgentConfiguration();
  const logger = new AgentLogger(config.stateDir);
  const journal = new PrintedJobJournal(config.stateDir);
  const printer = new SerialPrinter(config);

  if (argumentsList.has("--test-printer")) {
    await printer.print(buildTicketReceipt({
      ticketCode: "T001",
      sectorName: "Teste de impressao",
      issuedAt: new Date().toISOString(),
      installUrl: `${config.apiUrl}/instalar`,
      paperWidthMm: 80
    }));
    logger.info("Cupom de teste enviado para a impressora.", { port: config.printerPort });
    return;
  }

  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  logger.info("Agente de impressao iniciado.", {
    apiUrl: config.apiUrl,
    kioskId: config.kioskId,
    port: config.printerPort,
    baudRate: config.baudRate
  });

  let failures = 0;
  while (!controller.signal.aborted) {
    try {
      const job = await claimJob(config, controller.signal);
      if (job) {
        await processJob(job, config, printer, journal, logger, controller.signal);
      } else if (argumentsList.has("--once")) {
        logger.info("Nenhum trabalho pendente.");
        break;
      }
      failures = 0;
      await delay(config.pollIntervalMs, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) break;
      failures += 1;
      logger.error("Falha no ciclo do agente.", { error: error.message, failures });
      if (argumentsList.has("--once")) throw error;
      const backoff = Math.min(config.retryMaxMs, config.pollIntervalMs * (2 ** Math.min(failures, 5)));
      await delay(backoff, controller.signal);
    }
  }

  logger.info("Agente de impressao encerrado.");
}

async function processJob(job, config, printer, journal, logger, signal, finish = finishJob) {
  if (journal.has(job.id)) {
    await finish(config, job.id, true, null, signal);
    logger.info("Trabalho ja impresso confirmado novamente na API.", { jobId: job.id });
    return;
  }

  const receipt = buildTicketReceipt(job.payload);
  logger.info("Enviando senha para a impressora.", {
    jobId: job.id,
    ticketCode: job.payload?.ticketCode,
    bytes: receipt.length
  });

  try {
    await printer.print(receipt);
    journal.add(job.id);
  } catch (error) {
    try {
      await finish(config, job.id, false, error.message, signal);
    } catch (finishError) {
      logger.error("Nao foi possivel registrar a falha na API.", {
        jobId: job.id,
        error: finishError.message
      });
    }
    throw error;
  }

  await finish(config, job.id, true, null, signal);
  logger.info("Impressao concluida.", { jobId: job.id, ticketCode: job.payload?.ticketCode });
}

async function claimJob(config, signal) {
  const payload = await agentFetch(config, "/api/print/jobs/claim", {
    kioskId: config.kioskId
  }, signal);
  return payload.job || null;
}

function finishJob(config, jobId, success, error, signal) {
  return agentFetch(config, `/api/print/jobs/${encodeURIComponent(jobId)}/finish`, {
    kioskId: config.kioskId,
    success,
    error
  }, signal);
}

async function agentFetch(config, path, body, signal) {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-print-agent-token": config.token
    },
    body: JSON.stringify(body),
    signal
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    throw new Error(payload.error || `Falha HTTP ${response.status}`);
  }
  return payload;
}

function delay(milliseconds, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

module.exports = {
  agentFetch,
  processJob
};
