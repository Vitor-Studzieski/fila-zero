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

  const max = Number(process.env.LOCAL_PG_POOL_MAX || 10);
  pool = new Pool({
    connectionString: getLocalDatabaseUrl(),
    max: Number.isInteger(max) && max > 0 ? max : 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });

  pool.on("error", (error) => {
    console.error("Erro inesperado no pool PostgreSQL local:", error.message);
  });

  return pool;
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
