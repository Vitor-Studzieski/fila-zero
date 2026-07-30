const fs = require("node:fs");
const path = require("node:path");

function loadAgentEnvironment(filePath = process.env.PRINT_AGENT_CONFIG) {
  const resolved = path.resolve(filePath || path.join(process.cwd(), ".env.print-agent"));
  if (!fs.existsSync(resolved)) return resolved;

  for (const line of fs.readFileSync(resolved, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = unquote(match[2]);
  }
  return resolved;
}

function readAgentConfiguration(env = process.env) {
  const apiUrl = String(env.PRINT_API_URL || "").replace(/\/+$/, "");
  const token = String(env.PRINT_AGENT_TOKEN || "");
  if (!/^https:\/\//i.test(apiUrl) && env.NODE_ENV !== "test") {
    throw new Error("PRINT_API_URL deve usar HTTPS.");
  }
  if (token.length < 32) {
    throw new Error("PRINT_AGENT_TOKEN deve ter ao menos 32 caracteres.");
  }

  return {
    apiUrl,
    token,
    kioskId: cleanId(env.KIOSK_ID) || "totem-pompeia-01",
    printerPort: String(env.KIOSK_PRINTER_PORT || "COM3").trim(),
    baudRate: integer(env.PRINT_SERIAL_BAUD_RATE, 115200),
    dataBits: Number(env.PRINT_SERIAL_DATA_BITS) === 7 ? 7 : 8,
    stopBits: Number(env.PRINT_SERIAL_STOP_BITS) === 2 ? 2 : 1,
    parity: ["none", "even", "odd"].includes(env.PRINT_SERIAL_PARITY) ? env.PRINT_SERIAL_PARITY : "none",
    rtscts: flag(env.PRINT_SERIAL_RTSCTS),
    statusCheck: flag(env.PRINT_STATUS_CHECK_ENABLED),
    statusTimeoutMs: integer(env.PRINT_STATUS_TIMEOUT_MS, 1500),
    pollIntervalMs: Math.max(500, integer(env.PRINT_POLL_INTERVAL_MS, 2000)),
    retryMaxMs: Math.max(5000, integer(env.PRINT_RETRY_MAX_MS, 60000)),
    stateDir: path.resolve(env.PRINT_AGENT_STATE_DIR || path.join(process.cwd(), "data", "print-agent"))
  };
}

class AgentLogger {
  constructor(directory) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, "print-agent.log");
  }

  info(message, details) {
    this.write("INFO", message, details);
  }

  error(message, details) {
    this.write("ERROR", message, details);
  }

  write(level, message, details) {
    rotateFile(this.file);
    const suffix = details ? ` ${safeJson(details)}` : "";
    const line = `${new Date().toISOString()} ${level} ${message}${suffix}`;
    process[level === "ERROR" ? "stderr" : "stdout"].write(`${line}\n`);
    fs.appendFileSync(this.file, `${line}\n`, { encoding: "utf8", mode: 0o600 });
  }
}

class PrintedJobJournal {
  constructor(directory) {
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, "printed-jobs.log");
    this.ids = new Set(readRecentLines(this.file, 5000));
  }

  has(jobId) {
    return this.ids.has(String(jobId));
  }

  add(jobId) {
    const id = String(jobId);
    if (this.ids.has(id)) return;
    fs.appendFileSync(this.file, `${id}\n`, { encoding: "utf8", mode: 0o600 });
    this.ids.add(id);
  }
}

function readRecentLines(file, limit) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).slice(-limit);
}

function rotateFile(file) {
  if (!fs.existsSync(file) || fs.statSync(file).size < 5 * 1024 * 1024) return;
  const previous = `${file}.1`;
  if (fs.existsSync(previous)) fs.unlinkSync(previous);
  fs.renameSync(file, previous);
}

function cleanId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
}

function integer(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function flag(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function unquote(value) {
  const text = String(value || "").trim();
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

module.exports = {
  AgentLogger,
  PrintedJobJournal,
  loadAgentEnvironment,
  readAgentConfiguration
};
