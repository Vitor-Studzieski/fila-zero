const fs = require("node:fs");
const path = require("node:path");
const { checkConnection, close, query } = require("../server/local-postgres");
const { validateProductionEnvironment } = require("../server/production-readiness");

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

const REQUIRED_TABLES = [
  "public.app_sessions",
  "public.auth_mfa_challenges",
  "public.calls",
  "public.cart_items",
  "public.cron_executions",
  "public.devices",
  "public.events",
  "public.login_attempts",
  "public.print_job_attempts",
  "public.print_jobs",
  "public.print_kiosks",
  "public.profile_sector_permissions",
  "public.profiles",
  "public.push_notification_events",
  "public.push_notification_preferences",
  "public.push_rate_limits",
  "public.ratings",
  "public.sectors",
  "public.security_rate_limits",
  "public.services",
  "public.shopping_signals",
  "public.ticket_counters",
  "public.tickets",
  "public.web_push_subscriptions",
  "auth.login_attempts",
  "auth.password_resets",
  "auth.sessions",
  "auth.users"
];

const REQUIRED_FUNCTIONS = [
  "auth.uid()",
  "public.claim_next_print_job(text)",
  "public.consume_push_rate_limit(text,integer,integer)",
  "public.consume_security_rate_limit(text,integer,integer)",
  "public.finish_print_job(uuid,text,boolean,text)",
  "public.issue_physical_ticket(text,text,text,text,text,boolean,text,integer)",
  "public.issue_physical_ticket_bundle(text,text[],text,text,text,boolean,text,integer)"
];

async function main() {
  const readiness = validateProductionEnvironment({ ...process.env, NODE_ENV: "production" });
  if (!readiness.ok) {
    console.error("Preflight PostgreSQL local reprovado:");
    readiness.errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }

  const errors = [];
  const warnings = [...readiness.warnings];
  try {
    const connection = await checkConnection();
    const tables = await query(
      `
        SELECT n.nspname AS schema_name,
               c.relname AS table_name,
               c.relrowsecurity AS rls_enabled,
               c.relforcerowsecurity AS rls_forced
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND n.nspname IN ('public', 'auth')
      `
    );
    const tableNames = new Set(tables.rows.map((row) => `${row.schema_name}.${row.table_name}`));
    const missingTables = REQUIRED_TABLES.filter((table) => !tableNames.has(table));
    if (missingTables.length) errors.push(`Tabelas ausentes: ${missingTables.join(", ")}`);

    const publicTables = tables.rows.filter((row) => row.schema_name === "public");
    const publicWithoutRls = publicTables.filter((row) => !row.rls_enabled).map((row) => row.table_name);
    if (publicWithoutRls.length) errors.push(`Tabelas públicas sem RLS: ${publicWithoutRls.join(", ")}`);

    const roles = await query(
      `
        SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
        FROM pg_roles
        WHERE rolname = ANY($1::text[])
      `,
      [["senhahub_service", "senhahub_app"]]
    );
    const roleByName = new Map(roles.rows.map((row) => [row.rolname, row]));
    for (const roleName of ["senhahub_service", "senhahub_app"]) {
      const role = roleByName.get(roleName);
      if (!role) errors.push(`Papel ausente: ${roleName}`);
      else if (role.rolsuper) errors.push(`Papel da aplicação não pode ser superusuário: ${roleName}`);
      else if (!role.rolcanlogin) errors.push(`Papel da aplicação precisa conseguir conectar: ${roleName}`);
    }
    if (roleByName.get("senhahub_service")?.rolbypassrls) {
      errors.push("senhahub_service não pode usar BYPASSRLS; aplique a migration de policies explícitas do runtime.");
    }

    const functions = await query(
      `
        SELECT name, to_regprocedure(name) IS NOT NULL AS exists
        FROM unnest($1::text[]) AS input(name)
      `,
      [REQUIRED_FUNCTIONS]
    );
    const missingFunctions = functions.rows.filter((row) => !row.exists).map((row) => row.name);
    if (missingFunctions.length) errors.push(`Funções ausentes: ${missingFunctions.join(", ")}`);

    const grantCheck = await query(
      `
        SELECT has_schema_privilege('senhahub_service', 'public', 'USAGE') AS public_schema_usage,
               has_schema_privilege('senhahub_service', 'auth', 'USAGE') AS auth_schema_usage,
               has_table_privilege('senhahub_service', 'public.tickets', 'SELECT,INSERT,UPDATE') AS ticket_access,
               has_table_privilege('senhahub_service', 'auth.users', 'SELECT,INSERT,UPDATE') AS auth_user_access
      `
    );
    const grants = grantCheck.rows[0];
    for (const [key, value] of Object.entries(grants)) {
      if (!value) errors.push(`Permissão insuficiente para senhahub_service: ${key}`);
    }

    console.log(JSON.stringify({
      ok: errors.length === 0,
      connection: {
        database: connection.database,
        user: connection.user,
        serverVersion: connection.server_version
      },
      publicTables: publicTables.length,
      publicTablesWithRls: publicTables.filter((row) => row.rls_enabled).length,
      requiredTables: REQUIRED_TABLES.length,
      requiredFunctions: REQUIRED_FUNCTIONS.length,
      warnings,
      errors
    }, null, 2));
    if (errors.length) process.exitCode = 1;
  } catch (error) {
    console.error(`Preflight PostgreSQL local falhou: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await close();
  }
}

main();

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
