const fs = require("node:fs");
const path = require("node:path");
const { evaluatePasswordPolicy, passwordPolicyError } = require("../server/password-policy");
const { close, withTransaction } = require("../server/local-postgres");

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

const email = normalizeEmail(process.env.LOCAL_ADMIN_EMAIL);
const password = String(process.env.LOCAL_ADMIN_PASSWORD || "");
const name = normalizeName(process.env.LOCAL_ADMIN_NAME || "Gestor SenhaHub");
const role = String(process.env.LOCAL_ADMIN_ROLE || "manager").trim().toLowerCase();

if (process.env.LOCAL_ADMIN_CONFIRM !== "1") {
  fail("defina LOCAL_ADMIN_CONFIRM=1 para confirmar a criacao ou atualizacao da conta administrativa.");
}
if (!/^postgres(?:ql)?:\/\//i.test(String(process.env.LOCAL_DATABASE_URL || ""))) {
  fail("LOCAL_DATABASE_URL precisa apontar para o PostgreSQL local.");
}
if (!email) fail("LOCAL_ADMIN_EMAIL precisa ser um e-mail valido.");
if (name.length < 2) fail("LOCAL_ADMIN_NAME precisa ter pelo menos dois caracteres.");
if (!new Set(["manager", "admin"]).has(role)) {
  fail("LOCAL_ADMIN_ROLE precisa ser manager ou admin.");
}

start().catch((error) => {
  console.error(`Conta administrativa nao criada: ${error.message}`);
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
        `
          UPDATE auth.users
          SET email = $2,
              encrypted_password = crypt($1, gen_salt('bf')),
              raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('name', $3),
              email_confirmed_at = coalesce(email_confirmed_at, now()),
              updated_at = now()
          WHERE id = $4
        `,
        [password, email, name, userId]
      );
    } else {
      const inserted = await client.query(
        `
          INSERT INTO auth.users (
            id, email, encrypted_password, raw_user_meta_data,
            raw_app_meta_data, email_confirmed_at, created_at, updated_at
          )
          VALUES (
            gen_random_uuid(), $1, crypt($2, gen_salt('bf')),
            jsonb_build_object('name', $3), '{}'::jsonb, now(), now(), now()
          )
          RETURNING id
        `,
        [email, password, name]
      );
      userId = inserted.rows[0].id;
    }

    await client.query(
      `
        INSERT INTO public.profiles (id, name, email, role, status)
        VALUES ($1, $2, $3, $4::public.user_role, 'active'::public.user_status)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          role = EXCLUDED.role,
          status = 'active'::public.user_status,
          updated_at = now()
      `,
      [userId, name, email, role]
    );
    await client.query(
      "UPDATE auth.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
      [userId]
    );

    return { userId, email, role };
  });

  console.log(JSON.stringify({ ok: true, ...result, sessionsRevoked: true }, null, 2));
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
  console.error(`Conta administrativa nao iniciada: ${message}`);
  process.exit(1);
}
