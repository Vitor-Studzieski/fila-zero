const { authenticateLocalRequest, hasValidCsrf } = require("./local-http-auth");

function isLocalPostgresEnabled() {
  return process.env.DATA_BACKEND === "local-postgres" && process.env.LOCAL_POSTGRES_ROUTES_ENABLED === "1";
}

function disabledResponse() {
  return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
}

async function requireLocalUser(request, roles = null) {
  if (!isLocalPostgresEnabled()) return { response: disabledResponse() };
  const { session } = await authenticateLocalRequest(request);
  if (!session) return { response: Response.json({ error: "Sessão não encontrada." }, { status: 401 }) };
  if (Array.isArray(roles) && !roles.includes(session.user.role)) {
    return { response: Response.json({ error: "Acesso negado." }, { status: 403 }) };
  }
  return { session };
}

function requireCsrf(request, session) {
  return hasValidCsrf(request, session)
    ? null
    : Response.json({ error: "Token CSRF inválido." }, { status: 403 });
}

async function readJson(request) {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return null;
  }
}

module.exports = {
  disabledResponse,
  isLocalPostgresEnabled,
  readJson,
  requireCsrf,
  requireLocalUser
};
