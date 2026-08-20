const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

const backupDir = path.resolve(process.argv[2] || process.env.BACKUP_DIR || "");
const encryptionKey = String(process.env.BACKUP_ENCRYPTION_KEY || "");
const restoreUrl = String(process.env.RESTORE_DATABASE_URL || "").trim();
const verifyOnly = process.argv.includes("--verify-only") || !restoreUrl;

if (!backupDir || !fs.existsSync(backupDir)) fail("informe a pasta do backup criptografado.");
if (encryptionKey.length < 32) fail("BACKUP_ENCRYPTION_KEY precisa ter ao menos 32 caracteres.");

const manifestPath = path.join(backupDir, "manifest.json");
if (!fs.existsSync(manifestPath)) fail("manifest.json nao encontrado no backup.");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.format !== "senhahub-supabase-backup-v1" || !Array.isArray(manifest.files)) {
  fail("formato de backup desconhecido.");
}

const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "senhahub-restore-"));
try {
  const decrypted = manifest.files.map((fileName) => {
    if (!/^(roles|schema|data)\.sql\.enc$/.test(fileName)) fail("arquivo de backup inesperado.");
    const encryptedPath = path.join(backupDir, fileName);
    const plainPath = path.join(temporaryDir, fileName.replace(/\.enc$/, ""));
    decryptFile(encryptedPath, plainPath, encryptionKey);
    return plainPath;
  });

  const expected = ["roles.sql", "schema.sql", "data.sql"];
  if (!expected.every((fileName) => decrypted.includes(path.join(temporaryDir, fileName)))) {
    fail("o backup precisa conter roles.sql.enc, schema.sql.enc e data.sql.enc.");
  }

  if (verifyOnly) {
    console.log("Verificacao criptografica concluida. Nenhum banco foi alterado.");
    console.log("Para testar a restauracao, informe RESTORE_DATABASE_URL apontando para um projeto de teste.");
    process.exitCode = 0;
  } else {
    const sourceUrl = String(process.env.DATABASE_URL || "").trim();
    if (!/^postgres(?:ql)?:\/\//i.test(restoreUrl)) fail("RESTORE_DATABASE_URL precisa ser uma URL PostgreSQL valida.");
    if (sourceUrl && normalizeDbUrl(sourceUrl) === normalizeDbUrl(restoreUrl)) {
      fail("a restauracao para DATABASE_URL esta bloqueada; use um banco de teste separado.");
    }
    if (process.env.RESTORE_TARGET_CONFIRMED !== "1") {
      fail("defina RESTORE_TARGET_CONFIRMED=1 somente depois de confirmar que o destino e um banco de teste.");
    }
    runPsql(restoreUrl, decrypted);
    console.log("Restauracao de teste concluida com sucesso.");
  }
} finally {
  fs.rmSync(temporaryDir, { recursive: true, force: true });
}

function runPsql(database, files) {
  const result = spawnSync("psql", [
    "--single-transaction",
    "--set", "ON_ERROR_STOP=1",
    "--file", files.find((file) => file.endsWith("/roles.sql") || file.endsWith("\\roles.sql")),
    "--file", files.find((file) => file.endsWith("/schema.sql") || file.endsWith("\\schema.sql")),
    "--file", files.find((file) => file.endsWith("/data.sql") || file.endsWith("\\data.sql")),
    "--dbname", database
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("psql falhou durante a restauracao de teste. Verifique o destino e os logs do PostgreSQL.");
}

function decryptFile(inputPath, outputPath, passphrase) {
  if (!fs.existsSync(inputPath)) fail(`arquivo nao encontrado: ${path.basename(inputPath)}`);
  const file = fs.readFileSync(inputPath);
  if (file.subarray(0, 5).toString() !== "SHBK1") fail(`cabecalho invalido: ${path.basename(inputPath)}`);
  const salt = file.subarray(5, 21);
  const iv = file.subarray(21, 33);
  const tag = file.subarray(33, 49);
  const ciphertext = file.subarray(49);
  const key = crypto.pbkdf2Sync(passphrase, salt, 600_000, 32, "sha256");
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    fs.writeFileSync(outputPath, plaintext, { mode: 0o600, flag: "wx" });
    if (fs.statSync(outputPath).size === 0) fail(`arquivo vazio: ${path.basename(inputPath)}`);
  } catch {
    fail(`chave incorreta ou backup corrompido: ${path.basename(inputPath)}`);
  }
}

function normalizeDbUrl(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}:${url.port || ""}/${url.pathname}`.toLowerCase();
  } catch {
    return String(value).trim().toLowerCase();
  }
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = unquote(match[2]);
  }
}

function unquote(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function fail(message) {
  console.error(`Restauracao nao iniciada: ${message}`);
  process.exit(1);
}
