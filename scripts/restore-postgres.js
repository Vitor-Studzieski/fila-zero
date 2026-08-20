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
if (manifest.format !== "senhahub-postgres-backup-v1" || !Array.isArray(manifest.files)) fail("formato de backup desconhecido.");

const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "senhahub-postgres-restore-"));
try {
  const files = new Map();
  for (const fileName of manifest.files) {
    if (!/^(roles|database)\.sql\.enc$/.test(fileName)) fail("arquivo de backup inesperado.");
    const plainName = fileName.replace(/\.enc$/, "");
    const plainPath = path.join(temporaryDir, plainName);
    decryptFile(path.join(backupDir, fileName), plainPath, encryptionKey);
    files.set(plainName, plainPath);
  }
  if (!files.has("roles.sql") || !files.has("database.sql")) fail("o backup precisa conter roles.sql.enc e database.sql.enc.");

  if (verifyOnly) {
    console.log("Verificacao criptografica do backup PostgreSQL concluida. Nenhum banco foi alterado.");
  } else {
    if (!/^postgres(?:ql)?:\/\//i.test(restoreUrl)) fail("RESTORE_DATABASE_URL precisa ser uma URL PostgreSQL valida.");
    const sourceUrl = String(process.env.BACKUP_DATABASE_URL || process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL || "").trim();
    if (sourceUrl && normalizeDbUrl(sourceUrl) === normalizeDbUrl(restoreUrl)) fail("a restauracao para o mesmo banco de origem esta bloqueada.");
    if (process.env.RESTORE_TARGET_CONFIRMED !== "1") fail("defina RESTORE_TARGET_CONFIRMED=1 somente para um banco de teste.");
    const rolesFile = prepareRolesFile(files.get("roles.sql"), restoreUrl, temporaryDir);
    runPsql(restoreUrl, rolesFile, false);
    runPsql(restoreUrl, files.get("database.sql"), true);
    console.log("Restauracao PostgreSQL de teste concluida com sucesso.");
  }
} finally {
  fs.rmSync(temporaryDir, { recursive: true, force: true });
}

function prepareRolesFile(sourceFile, database, temporaryDir) {
  const existingRoles = listRoles(database);
  const lines = fs.readFileSync(sourceFile, "utf8").split(/\r?\n/);
  const filtered = lines.filter((line) => {
    const match = line.match(/^CREATE ROLE (.+);$/);
    if (!match) return true;
    const roleName = parseRoleIdentifier(match[1]);
    return !roleName || !existingRoles.has(roleName);
  });
  const targetFile = path.join(temporaryDir, "roles-target.sql");
  fs.writeFileSync(targetFile, filtered.join("\n"), { mode: 0o600, flag: "wx" });
  return targetFile;
}

function listRoles(database) {
  const result = spawnSync(resolveBinary("psql"), [
    "--tuples-only",
    "--no-align",
    "--dbname", database,
    "--command", "SELECT rolname FROM pg_roles"
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("psql nao conseguiu consultar os roles existentes no destino.");
  return new Set(String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}

function parseRoleIdentifier(value) {
  const token = String(value || "").trim();
  if (token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1).replace(/""/g, '"');
  return token.split(/\s+/)[0] || null;
}

function runPsql(database, file, singleTransaction) {
  const args = ["--set", "ON_ERROR_STOP=1", "--dbname", database, "--file", file];
  if (singleTransaction) args.unshift("--single-transaction");
  const result = spawnSync(resolveBinary("psql"), args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("psql falhou durante a restauracao PostgreSQL. Verifique o destino e os logs do banco.");
}

function resolveBinary(name) {
  const configuredDir = String(process.env.POSTGRES_BIN_DIR || "").trim();
  const candidate = configuredDir ? path.join(configuredDir, name) : name;
  return configuredDir && fs.existsSync(candidate) ? candidate : name;
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
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

function fail(message) {
  console.error(`Restauracao PostgreSQL nao iniciada: ${message}`);
  process.exit(1);
}
