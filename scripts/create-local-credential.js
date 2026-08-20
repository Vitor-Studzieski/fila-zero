const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { evaluatePasswordPolicy, isCommonPassword, isStrongPassword, passwordPolicyError } = require("../server/password-policy");
const { close, withTransaction } = require("../server/local-postgres");

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

const role = String(process.env.LOCAL_CREDENTIAL_ROLE || "").trim().toLowerCase();
const email = normalizeEmail(process.env.LOCAL_CREDENTIAL_EMAIL);
const name = normalizeName(process.env.LOCAL_CREDENTIAL_NAME);
const sectorIds = [...new Set(String(process.env.LOCAL_CREDENTIAL_SECTOR_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean))];
const password = String(process.env.LOCAL_CREDENTIAL_PASSWORD || "") || generatePassword();
const profileRole = ["tablet", "tv"].includes(role) ? "customer" : role;

if (process.env.LOCAL_CREDENTIAL_CONFIRM !== "1") {
  fail("defina LOCAL_CREDENTIAL_CONFIRM=1 para confirmar a criação ou atualização da credencial.");
}
if (!/^postgres(?:ql)?:\/\//i.test(String(process.env.LOCAL_DATABASE_URL || ""))) {
  fail("LOCAL_DATABASE_URL precisa apontar para o PostgreSQL local.");
}
if (!new Set(["tablet", "tv", "attendant"]).has(role)) {
  fail("LOCAL_CREDENTIAL_ROLE precisa ser tablet, tv ou attendant.");
}
if (!email) fail("LOCAL_CREDENTIAL_EMAIL precisa ser um e-mail válido.");
if (name.length < 2) fail("LOCAL_CREDENTIAL_NAME precisa ter pelo menos dois caracteres.");
if (!isStrongPassword(password) || isCommonPassword(password)) {
  fail("LOCAL_CREDENTIAL_PASSWORD precisa ter 12+ caracteres, maiúsculas, minúsculas e números e não pode ser comum.");
}
if (role === "attendant" && !sectorIds.length) {
  fail("LOCAL_CREDENTIAL_SECTOR_IDS precisa informar ao menos um setor para o atendente.");
}
if (["tablet", "tv"].includes(role) && sectorIds.length) {
  fail("Os perfis tablet e tv não usam permissões de setor; deixe LOCAL_CREDENTIAL_SECTOR_IDS vazio.");
}

start().catch((error) => {
  console.error(`Credencial PostgreSQL local não criada: ${error.message}`);
  process.exitCode = 1;
}).finally(() => close().catch(() => {}));

async function start() {
  const passwordPolicy = await evaluatePasswordPolicy(password);
  if (!passwordPolicy.ok) fail(passwordPolicyError(passwordPolicy).error);
  await run();
}

async function run() {
  const result = await withTransaction(async (client) => {
    const existingUser = await client.query(
      "SELECT id FROM auth.users WHERE lower(email) = lower($1) LIMIT 1 FOR UPDATE",
      [email]
    );

    let userId;
    if (existingUser.rowCount) {
      userId = existingUser.rows[0].id;
      await client.query(
        `UPDATE auth.users
         SET email = $2,
             encrypted_password = crypt($1, gen_salt('bf')),
             raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('name', $3::text, 'role', $4::text),
             raw_app_meta_data = CASE WHEN $4::text IN ('tablet', 'tv') THEN coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('access_mode', $4::text) ELSE coalesce(raw_app_meta_data, '{}'::jsonb) - 'access_mode' END,
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             updated_at = now()
         WHERE id = $5`,
        [password, email, name, role, userId]
      );
    } else {
      const inserted = await client.query(
        `INSERT INTO auth.users (
           id, email, encrypted_password, raw_user_meta_data,
           raw_app_meta_data, email_confirmed_at, created_at, updated_at
         )
         VALUES (
           gen_random_uuid(), $1, crypt($2, gen_salt('bf')),
           jsonb_build_object('name', $3::text, 'role', $4::text),
           CASE WHEN $4::text IN ('tablet', 'tv') THEN jsonb_build_object('access_mode', $4::text) ELSE '{}'::jsonb END,
           now(), now(), now()
         )
         RETURNING id`,
        [email, password, name, role]
      );
      userId = inserted.rows[0].id;
    }

    await client.query(
      `INSERT INTO public.profiles (id, name, email, role, status)
       VALUES ($1, $2, $3, $4::public.user_role, 'active'::public.user_status)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         role = EXCLUDED.role,
         status = 'active'::public.user_status,
         updated_at = now()`,
      [userId, name, email, profileRole]
    );

    await client.query("DELETE FROM public.profile_sector_permissions WHERE profile_id = $1", [userId]);
    if (sectorIds.length) {
      const sectorResult = await client.query(
        "SELECT id FROM public.sectors WHERE id = ANY($1::text[])",
        [sectorIds]
      );
      const available = new Set(sectorResult.rows.map((row) => row.id));
      const missing = sectorIds.filter((sectorId) => !available.has(sectorId));
      if (missing.length) throw new Error(`Setor(es) não encontrado(s): ${missing.join(", ")}.`);
      for (const sectorId of sectorIds) {
        await client.query(
          `INSERT INTO public.profile_sector_permissions (profile_id, sector_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [userId, sectorId]
        );
      }
    }

    await client.query(
      "UPDATE auth.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
      [userId]
    );
    return { userId, email, name, role, sectorIds };
  });

  console.log(JSON.stringify({ ok: true, ...result, password, sessionsRevoked: true }, null, 2));
}

function generatePassword() {
  let candidate = "";
  do {
    candidate = `Sh${crypto.randomBytes(18).toString("base64url")}9`;
  } while (!isStrongPassword(candidate) || isCommonPassword(candidate));
  return candidate;
}

function normalizeEmail(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

function normalizeName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 120);
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
  console.error(`Credencial PostgreSQL local não iniciada: ${message}`);
  process.exit(1);
}
