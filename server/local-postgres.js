const { Pool } = require("pg");

let pool = null;

function getLocalDatabaseUrl() {
  const url = String(process.env.LOCAL_DATABASE_URL || "").trim();
  if (!/^postgres(?:ql)?:\/\//i.test(url)) {
    throw new Error("LOCAL_DATABASE_URL precisa apontar para um PostgreSQL local válido.");
  }
  return url;
}

function getPool() {
  if (pool) return pool;

  const max = positiveInteger(process.env.LOCAL_PG_POOL_MAX, 10);
  const statementTimeout = positiveInteger(process.env.LOCAL_PG_STATEMENT_TIMEOUT_MS, 15_000);
  const lockTimeout = positiveInteger(process.env.LOCAL_PG_LOCK_TIMEOUT_MS, 5_000);
  const idleInTransactionTimeout = positiveInteger(process.env.LOCAL_PG_IDLE_IN_TRANSACTION_TIMEOUT_MS, 30_000);
  pool = new Pool({
    connectionString: getLocalDatabaseUrl(),
    max: Math.min(max, 50),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: statementTimeout,
    lock_timeout: lockTimeout,
    idle_in_transaction_session_timeout: idleInTransactionTimeout,
    application_name: String(process.env.LOCAL_PG_APPLICATION_NAME || "senhahub-api").slice(0, 63),
    keepAlive: true,
    ssl: getSslConfig()
  });

  pool.on("error", (error) => {
    console.error("Erro inesperado no pool PostgreSQL local:", error.message);
  });

  return pool;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getSslConfig() {
  if (String(process.env.LOCAL_PG_SSL || "").trim() !== "1") return undefined;
  const ca = String(process.env.LOCAL_PG_SSL_CA || "").replace(/\\n/g, "\n").trim();
  return {
    rejectUnauthorized: String(process.env.LOCAL_PG_SSL_REJECT_UNAUTHORIZED || "1") !== "0",
    ...(ca ? { ca } : {})
  };
}

function query(text, values = []) {
  return getPool().query(text, values);
}

async function withTransaction(work) {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Falha ao desfazer a transação PostgreSQL local:", rollbackError.message);
    }
    throw error;
  } finally {
    client.release();
  }
}

async function close() {
  if (!pool) return;
  const activePool = pool;
  pool = null;
  await activePool.end();
}

async function checkConnection() {
  const result = await query(
    `
      SELECT current_database() AS database,
             current_user AS user,
             current_setting('server_version') AS server_version
    `
  );
  return result.rows[0];
}

module.exports = {
  checkConnection,
  close,
  getPool,
  query,
  withTransaction
};
