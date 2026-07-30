const { SerialPort } = require("serialport");

class SerialPrinter {
  constructor(options = {}) {
    this.path = String(options.path || "COM3");
    this.baudRate = positiveInteger(options.baudRate, 115200);
    this.dataBits = options.dataBits === 7 ? 7 : 8;
    this.stopBits = options.stopBits === 2 ? 2 : 1;
    this.parity = ["none", "even", "odd"].includes(options.parity) ? options.parity : "none";
    this.rtscts = Boolean(options.rtscts);
    this.statusCheck = Boolean(options.statusCheck);
    this.statusTimeoutMs = positiveInteger(options.statusTimeoutMs, 1500);
  }

  async print(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error("Conteudo de impressao vazio.");
    }

    const port = new SerialPort({
      path: this.path,
      baudRate: this.baudRate,
      dataBits: this.dataBits,
      stopBits: this.stopBits,
      parity: this.parity,
      rtscts: this.rtscts,
      autoOpen: false
    });

    try {
      await openPort(port);
      if (this.statusCheck) await assertPrinterReady(port, this.statusTimeoutMs);
      await writePort(port, buffer);
      await drainPort(port);
      await delay(Math.max(500, Math.ceil((buffer.length * 10 * 1000) / this.baudRate)));
      if (this.statusCheck) await assertPrinterReady(port, this.statusTimeoutMs);
    } finally {
      await closePort(port);
    }
  }

  static list() {
    return SerialPort.list();
  }
}

async function assertPrinterReady(port, timeoutMs) {
  const status = await queryStatus(port, 2, timeoutMs);
  if (status & 0x04) throw new Error("A tampa da impressora esta aberta.");
  if (status & 0x20) throw new Error("A impressora esta sem papel.");
  if (status & 0x40) throw new Error("A impressora informou uma falha.");
}

function queryStatus(port, type, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      port.off("data", onData);
      port.off("error", onError);
    };
    const onData = (chunk) => {
      if (!chunk?.length) return;
      cleanup();
      resolve(chunk[0]);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };

    port.on("data", onData);
    port.on("error", onError);
    timer = setTimeout(() => {
      cleanup();
      reject(new Error("A impressora nao respondeu a consulta de status."));
    }, timeoutMs);
    port.write(Buffer.from([0x10, 0x04, type]), (error) => {
      if (error) onError(error);
    });
  });
}

function openPort(port) {
  return new Promise((resolve, reject) => {
    port.open((error) => (error ? reject(normalizeSerialError(error, port.path)) : resolve()));
  });
}

function writePort(port, buffer) {
  return new Promise((resolve, reject) => {
    port.write(buffer, (error) => (error ? reject(error) : resolve()));
  });
}

function drainPort(port) {
  return new Promise((resolve, reject) => {
    port.drain((error) => (error ? reject(error) : resolve()));
  });
}

function closePort(port) {
  if (!port?.isOpen) return Promise.resolve();
  return new Promise((resolve) => {
    port.close(() => resolve());
  });
}

function normalizeSerialError(error, path) {
  const message = String(error?.message || error);
  if (/cannot find|file not found|no such file/i.test(message)) {
    return new Error(`Porta serial ${path} nao encontrada.`);
  }
  if (/access denied|permission/i.test(message)) {
    return new Error(`Porta serial ${path} esta em uso ou sem permissao.`);
  }
  return error;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

module.exports = {
  SerialPrinter,
  assertPrinterReady,
  queryStatus
};
