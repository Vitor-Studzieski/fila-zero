const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

const databaseUrl = String(
  process.env.BACKUP_DATABASE_URL || process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL || ""
).trim();
const rolesDatabaseUrl = String(
  process.env.BACKUP_ROLES_DATABASE_URL || databaseUrl
).trim();
const encryptionKey = String(process.env.BACKUP_ENCRYPTION_KEY || "");
const projectRoot = process.cwd();
const backupRoot = path.resolve(projectRoot, process.env.BACKUP_OUTPUT_DIR || "backups/postgres");
const offsiteRoot = String(process.env.BACKUP_OFFSITE_DIR || "").trim();

if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) fail("BACKUP_DATABASE_URL, LOCAL_DATABASE_URL ou DATABASE_URL precisa apontar para PostgreSQL.");
if (!/^postgres(?:ql)?:\/\//i.test(rolesDatabaseUrl)) fail("BACKUP_ROLES_DATABASE_URL precisa apontar para PostgreSQL.");
if (encryptionKey.length < 32) fail("BACKUP_ENCRYPTION_KEY precisa ter ao menos 32 caracteres.");
if (!offsiteRoot) fail("BACKUP_OFFSITE_DIR precisa apontar para uma pasta externa ao projeto.");

const offsitePath = path.resolve(offsiteRoot);
if (offsitePath === projectRoot || offsitePath.startsWith(`${projectRoot}${path.sep}`)) {
  fail("BACKUP_OFFSITE_DIR precisa ficar fora da pasta do projeto.");
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const localDir = path.join(backupRoot, stamp);
const offsiteDir = path.join(offsitePath, stamp);
const dumps = [
  { name: "roles", command: "pg_dumpall", args: ["--roles-only"], databaseUrl: rolesDatabaseUrl },
  { name: "database", command: "pg_dump", args: ["--format=plain", "--no-owner", "--no-privileges"], databaseUrl }
];

fs.mkdirSync(localDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(offsiteDir, { recursive: true, mode: 0o700 });

try {
  for (const dump of dumps) {
    const plainPath = path.join(localDir, `${dump.name}.sql`);
    runDump(dump, plainPath, dump.databaseUrl);
    const encryptedPath = `${plainPath}.enc`;
    encryptFile(plainPath, encryptedPath, encryptionKey);
    fs.rmSync(plainPath, { force: true });
    fs.chmodSync(encryptedPath, 0o600);
    const offsiteFile = path.join(offsiteDir, path.basename(encryptedPath));
    fs.copyFileSync(encryptedPath, offsiteFile, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(offsiteFile, 0o600);
  }

  const manifest = {
    format: "senhahub-postgres-backup-v1",
    createdAt: new Date().toISOString(),
    databaseFingerprint: crypto.createHash("sha256").update(normalizeDbUrl(databaseUrl)).digest("hex").slice(0, 16),
    files: dumps.map((dump) => `${dump.name}.sql.enc`),
    note: "Conteudo criptografado com AES-256-GCM; a chave nao fica no backup."
  };
  fs.writeFileSync(path.join(offsiteDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  console.log(`Backup PostgreSQL criptografado criado em: ${offsiteDir}`);
} catch (error) {
  for (const dump of dumps) {
    fs.rmSync(path.join(localDir, `${dump.name}.sql`), { force: true });
    fs.rmSync(path.join(localDir, `${dump.name}.sql.enc`), { force: true });
  }
  console.error(`Backup PostgreSQL nao concluido: ${error.message}`);
  process.exitCode = 1;
}

function runDump(dump, outputPath, targetDatabaseUrl) {
  const result = spawnSync(resolveBinary(dump.command), [
    ...dump.args,
    "--file", outputPath,
    "--dbname", targetDatabaseUrl
  ], {
    cwd: projectRoot,
    env: { ...process.env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || "").trim().replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgresql://[oculto]");
    throw new Error(`${dump.command} falhou para ${dump.name}. ${detail || "Verifique PostgreSQL, credenciais e POSTGRES_BIN_DIR."}`);
  }
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) throw new Error(`o dump ${dump.name} ficou vazio.`);
}

function resolveBinary(name) {
  const configuredDir = String(process.env.POSTGRES_BIN_DIR || "").trim();
  if (configuredDir) {
    const candidate = path.join(configuredDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return name;
}

function encryptFile(inputPath, outputPath, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(passphrase, salt, 600_000, 32, "sha256");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(fs.readFileSync(inputPath)), cipher.final()]);
  fs.writeFileSync(outputPath, Buffer.concat([Buffer.from("SHBK1"), salt, iv, cipher.getAuthTag(), ciphertext]), { mode: 0o600, flag: "wx" });
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
  console.error(`Backup PostgreSQL nao iniciado: ${message}`);
  process.exit(1);
}
