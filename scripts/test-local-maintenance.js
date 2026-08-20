const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

const { close, query, withTransaction } = require("../server/local-postgres");

const tokenHash = crypto.createHash("sha256").update(`maintenance-test-${Date.now()}-${Math.random()}`).digest("hex");

run().catch((error) => {
  console.error(`Teste de manutencao PostgreSQL falhou: ${error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  try {
    await query("DELETE FROM auth.sessions WHERE token_hash = $1", [tokenHash]);
  } catch {}
  await close();
});

async function run() {
  const user = await query("SELECT id FROM auth.users ORDER BY created_at LIMIT 1");
  if (!user.rowCount) throw new Error("nenhum usuario auth disponivel para o teste.");

  await withTransaction(async (client) => {
    await client.query(
      `
        INSERT INTO auth.sessions (user_id, token_hash, csrf_token, expires_at)
        VALUES ($1, $2, $3, now() - interval '1 minute')
      `,
      [user.rows[0].id, tokenHash, "maintenance-test-csrf"]
    );
  });

  const before = await query("SELECT count(*)::integer AS count FROM auth.sessions WHERE token_hash = $1", [tokenHash]);
  if (before.rows[0].count !== 1) throw new Error("a sessao temporaria nao foi criada.");

  const { runLocalMaintenance } = require("../server/local-repository");
  const summary = await runLocalMaintenance();
  const after = await query("SELECT count(*)::integer AS count FROM auth.sessions WHERE token_hash = $1", [tokenHash]);
  if (after.rows[0].count !== 0) throw new Error("a manutencao nao removeu a sessao expirada.");

  console.log(JSON.stringify({ ok: true, expiredSessionDeleted: true, summary }, null, 2));
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    const value = String(match[2] || "").trim();
    process.env[match[1]] = ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      ? value.slice(1, -1)
      : value;
  }
}
