const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
const encryptionKey = String(process.env.BACKUP_ENCRYPTION_KEY || "");
const projectRoot = process.cwd();
const backupRoot = path.resolve(projectRoot, process.env.BACKUP_OUTPUT_DIR || "backups");
const offsiteRoot = String(process.env.BACKUP_OFFSITE_DIR || "").trim();

if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) fail("DATABASE_URL precisa apontar para um banco PostgreSQL.");
if (encryptionKey.length < 32) fail("BACKUP_ENCRYPTION_KEY precisa ter ao menos 32 caracteres e nunca deve ser commitada.");
if (!offsiteRoot) fail("BACKUP_OFFSITE_DIR precisa apontar para uma pasta externa ao projeto.");

const offsitePath = path.resolve(offsiteRoot);
if (offsitePath === projectRoot || offsitePath.startsWith(`${projectRoot}${path.sep}`)) {
  fail("BACKUP_OFFSITE_DIR precisa ficar fora da pasta do projeto.");
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const localDir = path.join(backupRoot, stamp);
const offsiteDir = path.join(offsitePath, stamp);
fs.mkdirSync(localDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(offsiteDir, { recursive: true, mode: 0o700 });

const dumps = [
  { name: "roles", args: ["--role-only"] },
  { name: "schema", args: [] },
  { name: "data", args: ["--data-only", "--use-copy", "--exclude", "storage.buckets_vectors", "--exclude", "storage.vector_indexes"] }
];

try {
  for (const dump of dumps) {
    const plainPath = path.join(localDir, `${dump.name}.sql`);
    runSupabaseDump(plainPath, dump.args);
    const encryptedPath = `${plainPath}.enc`;
    encryptFile(plainPath, encryptedPath, encryptionKey);
    fs.rmSync(plainPath, { force: true });
    fs.chmodSync(encryptedPath, 0o600);
    fs.copyFileSync(encryptedPath, path.join(offsiteDir, path.basename(encryptedPath)), fs.constants.COPYFILE_EXCL);
    fs.chmodSync(path.join(offsiteDir, path.basename(encryptedPath)), 0o600);
  }

  const manifest = {
    format: "senhahub-supabase-backup-v1",
    createdAt: new Date().toISOString(),
    files: dumps.map((dump) => `${dump.name}.sql.enc`),
    note: "Conteudo criptografado com AES-256-GCM. A chave nao fica no backup."
  };
  const manifestPath = path.join(offsiteDir, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  console.log(`Backup criptografado criado em: ${offsiteDir}`);
} catch (error) {
  for (const dump of dumps) fs.rmSync(path.join(localDir, `${dump.name}.sql`), { force: true });
  console.error(`Backup nao concluido: ${error.message}`);
  process.exitCode = 1;
}

function runSupabaseDump(outputPath, extraArgs) {
  const result = spawnSync("supabase", [
    "db", "dump",
    "--db-url", databaseUrl,
    "--file", outputPath,
    ...extraArgs
  ], {
    cwd: projectRoot,
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`supabase db dump falhou para ${path.basename(outputPath)}. Verifique Docker, DATABASE_URL e a senha do banco.`);
  }
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    throw new Error(`o dump ${path.basename(outputPath)} ficou vazio.`);
  }
}

function encryptFile(inputPath, outputPath, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(passphrase, salt, 600_000, 32, "sha256");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = fs.readFileSync(inputPath);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const file = Buffer.concat([
    Buffer.from("SHBK1"),
    salt,
    iv,
    cipher.getAuthTag(),
    ciphertext
  ]);
  fs.writeFileSync(outputPath, file, { mode: 0o600, flag: "wx" });
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
  console.error(`Backup nao iniciado: ${message}`);
  process.exit(1);
}
