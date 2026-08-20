const crypto = require("node:crypto");
const { query, withTransaction } = require("./local-postgres");

const SESSION_TTL_SECONDS = 12 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

async function loginLocalUser({ email, password, attemptKey = email } = {}) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = String(password || "");
  const normalizedAttemptKey = String(attemptKey || normalizedEmail || "unknown").slice(0, 240);

  if (!normalizedEmail || !normalizedPassword) {
    return { error: "E-mail ou senha inválidos." };
  }

  return withTransaction(async (client) => {
    const attemptResult = await client.query(
      `
        SELECT attempt_key, count, first_attempt_at, locked_until
        FROM auth.login_attempts
        WHERE attempt_key = $1
        FOR UPDATE
      `,
      [normalizedAttemptKey]
    );
    const attempt = attemptResult.rows[0];
    if (attempt?.locked_until && new Date(attempt.locked_until).getTime() > Date.now()) {
      return { error: "Muitas tentativas. Aguarde alguns minutos." };
    }

    const userResult = await client.query(
      `
        SELECT
          u.id,
          u.email,
          p.name,
          p.role,
          p.status,
          p.created_at
        FROM auth.users u
        JOIN public.profiles p ON p.id = u.id
        WHERE lower(u.email) = lower($1)
          AND p.status = 'active'::public.user_status
          AND nullif(u.encrypted_password, '') IS NOT NULL
          AND crypt($2, u.encrypted_password) = u.encrypted_password
        LIMIT 1
      `,
      [normalizedEmail, normalizedPassword]
    );
    const user = userResult.rows[0];

    if (!user) {
      await registerLoginFailure(client, normalizedAttemptKey, attempt);
      return { error: "E-mail ou senha inválidos." };
    }

    await client.query(
      "DELETE FROM auth.login_attempts WHERE attempt_key = $1",
      [normalizedAttemptKey]
    );

    const session = await createSessionInTransaction(client, user.id);
    const sectorIds = await loadUserSectorIds(client, user.id);

    return {
      sessionToken: session.sessionToken,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
      user: userDto(user, sectorIds)
    };
  });
}

async function consumeLocalRateLimit(scope, value, limit, windowSeconds) {
  const raw = `${String(scope || "security").slice(0, 80)}:${String(value || "unknown").slice(0, 240)}`;
  const rateKey = `security:${crypto.createHash("sha256").update(raw).digest("hex")}`;

  return withTransaction(async (client) => {
    const result = await client.query(
      "SELECT * FROM public.security_rate_limits WHERE rate_key = $1 FOR UPDATE",
      [rateKey]
    );
    const row = result.rows[0];
    if (!row) {
      await client.query(
        `
          INSERT INTO public.security_rate_limits (rate_key, window_started_at, request_count, updated_at)
          VALUES ($1, now(), 1, now())
        `,
        [rateKey]
      );
      return true;
    }

    const age = Date.now() - new Date(row.window_started_at).getTime();
    if (age >= Number(windowSeconds) * 1000) {
      await client.query(
        `
          UPDATE public.security_rate_limits
          SET window_started_at = now(), request_count = 1, updated_at = now()
          WHERE rate_key = $1
        `,
        [rateKey]
      );
      return true;
    }
    if (Number(row.request_count) >= Number(limit)) return false;

    await client.query(
      "UPDATE public.security_rate_limits SET request_count = request_count + 1, updated_at = now() WHERE rate_key = $1",
      [rateKey]
    );
    return true;
  });
}

async function registerLocalUser({ name, email, password } = {}) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = normalizeName(name);
  const normalizedPassword = String(password || "");

  if (!normalizedName || normalizedName.length < 2) {
    return { error: "Informe seu nome completo." };
  }
  if (!normalizedEmail) {
    return { error: "Informe um e-mail válido." };
  }
  if (!isStrongPassword(normalizedPassword)) {
    return { error: "Use ao menos 12 caracteres, letras maiúsculas, minúsculas e números." };
  }

  try {
    return await withTransaction(async (client) => {
      const existing = await client.query(
        "SELECT 1 FROM auth.users WHERE lower(email) = lower($1) LIMIT 1",
        [normalizedEmail]
      );
      if (existing.rowCount) return { error: "E-mail já cadastrado." };

      const userResult = await client.query(
        `
          INSERT INTO auth.users (
            id, email, encrypted_password, raw_user_meta_data,
            raw_app_meta_data, email_confirmed_at, created_at, updated_at
          )
          VALUES (
            gen_random_uuid(), $1, crypt($2, gen_salt('bf')),
            jsonb_build_object('name', $3), '{}'::jsonb,
            now(), now(), now()
          )
          RETURNING id, email, created_at
        `,
        [normalizedEmail, normalizedPassword, normalizedName]
      );
      const user = userResult.rows[0];

      const profileResult = await client.query(
        `
          INSERT INTO public.profiles (id, name, email, role, status)
          VALUES ($1, $2, $3, 'customer'::public.user_role, 'active'::public.user_status)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            email = EXCLUDED.email,
            updated_at = now()
          RETURNING id, name, email, role, status, created_at
        `,
        [user.id, normalizedName, normalizedEmail]
      );

      return {
        user: userDto(profileResult.rows[0]),
        message: "Conta de cliente criada com sucesso. Entre usando seu e-mail e senha."
      };
    });
  } catch (error) {
    if (error?.code === "23505") return { error: "E-mail já cadastrado." };
    throw error;
  }
}

async function changeLocalPassword({ email, currentPassword, newPassword, attemptKey = email } = {}) {
  const normalizedEmail = normalizeEmail(email);
  const current = String(currentPassword || "");
  const next = String(newPassword || "");
  if (!normalizedEmail || !current || !isStrongPassword(next)) {
    return { error: "Informe e-mail, senha atual e uma nova senha forte com ao menos 12 caracteres, letras maiúsculas, minúsculas e números." };
  }

  return withTransaction(async (client) => {
    const userResult = await client.query(
      `
        SELECT u.id
        FROM auth.users u
        JOIN public.profiles p ON p.id = u.id
        WHERE lower(u.email) = lower($1)
          AND p.status = 'active'::public.user_status
          AND crypt($2, u.encrypted_password) = u.encrypted_password
        LIMIT 1
        FOR UPDATE
      `,
      [normalizedEmail, current]
    );
    const user = userResult.rows[0];
    if (!user) return { error: "E-mail ou senha atual inválidos." };

    await client.query(
      `UPDATE auth.users SET encrypted_password = crypt($1, gen_salt('bf')), updated_at = now() WHERE id = $2`,
      [next, user.id]
    );
    await client.query("UPDATE auth.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [user.id]);
    await client.query("DELETE FROM auth.login_attempts WHERE attempt_key = $1", [String(attemptKey || normalizedEmail).slice(0, 240)]);
    return { ok: true, message: "Senha alterada com sucesso. Entre usando a nova senha." };
  });
}

async function requestLocalPasswordReset(email) {
  const normalizedEmail = normalizeEmail(email);
  const response = {
    ok: true,
    message: "Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha."
  };
  if (!normalizedEmail) return response;

  const userResult = await query(
    `
      SELECT u.id
      FROM auth.users u
      JOIN public.profiles p ON p.id = u.id
      WHERE lower(u.email) = lower($1)
        AND p.status = 'active'::public.user_status
      LIMIT 1
    `,
    [normalizedEmail]
  );
  const user = userResult.rows[0];
  if (!user) return response;

  const token = crypto.randomBytes(32).toString("base64url");
  await withTransaction(async (client) => {
    await client.query("UPDATE auth.password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [user.id]);
    await client.query(
      `
        INSERT INTO auth.password_resets (user_id, token_hash, expires_at)
        VALUES ($1, $2, now() + interval '30 minutes')
      `,
      [user.id, hashSessionToken(token)]
    );
  });

  if (process.env.NODE_ENV !== "production" && process.env.LOCAL_AUTH_RESET_TOKEN_DEBUG === "1") {
    return { ...response, resetToken: token };
  }
  return response;
}

async function resetLocalPassword({ token, newPassword } = {}) {
  const resetToken = String(token || "");
  const next = String(newPassword || "");
  if (!resetToken || !isStrongPassword(next)) {
    return { error: "Link de recuperação inválido ou senha fraca. Use ao menos 12 caracteres, letras maiúsculas, minúsculas e números." };
  }

  return withTransaction(async (client) => {
    const result = await client.query(
      `
        SELECT id, user_id
        FROM auth.password_resets
        WHERE token_hash = $1
          AND used_at IS NULL
          AND expires_at > now()
        LIMIT 1
        FOR UPDATE
      `,
      [hashSessionToken(resetToken)]
    );
    const reset = result.rows[0];
    if (!reset) return { error: "Link de recuperação inválido ou expirado." };

    await client.query(
      "UPDATE auth.users SET encrypted_password = crypt($1, gen_salt('bf')), updated_at = now() WHERE id = $2",
      [next, reset.user_id]
    );
    await client.query("UPDATE auth.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [reset.user_id]);
    await client.query("UPDATE auth.password_resets SET used_at = now() WHERE id = $1", [reset.id]);
    return { ok: true, message: "Senha redefinida com sucesso. Entre usando a nova senha." };
  });
}

async function getLocalSession(sessionToken) {
  const tokenHash = hashSessionToken(sessionToken);
  if (!tokenHash) return null;

  const result = await query(
    `
      SELECT
        s.id AS session_id,
        s.csrf_token,
        s.expires_at,
        u.id,
        u.email,
        p.name,
        p.role,
        p.status,
        p.created_at
      FROM auth.sessions s
      JOIN auth.users u ON u.id = s.user_id
      JOIN public.profiles p ON p.id = u.id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND p.status = 'active'::public.user_status
      LIMIT 1
    `,
    [tokenHash]
  );
  const row = result.rows[0];
  if (!row) return null;

  const sectorIds = await query(
    `
      SELECT sector_id
      FROM public.profile_sector_permissions
      WHERE profile_id = $1
      ORDER BY sector_id
    `,
    [row.id]
  );

  return {
    sessionId: row.session_id,
    csrfToken: row.csrf_token,
    expiresAt: row.expires_at,
    user: userDto(row, sectorIds.rows.map((item) => item.sector_id))
  };
}

async function revokeLocalSession(sessionToken) {
  const tokenHash = hashSessionToken(sessionToken);
  if (!tokenHash) return false;

  const result = await query(
    `
      UPDATE auth.sessions
      SET revoked_at = now()
      WHERE token_hash = $1
        AND revoked_at IS NULL
    `,
    [tokenHash]
  );
  return result.rowCount > 0;
}

async function revokeAllLocalSessions(userId) {
  const result = await query(
    `
      UPDATE auth.sessions
      SET revoked_at = now()
      WHERE user_id = $1
        AND revoked_at IS NULL
    `,
    [userId]
  );
  return result.rowCount;
}

async function createSessionInTransaction(client, userId) {
  const sessionToken = crypto.randomBytes(32).toString("base64url");
  const csrfToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

  await client.query(
    `
      INSERT INTO auth.sessions (user_id, token_hash, csrf_token, expires_at)
      VALUES ($1, $2, $3, $4)
    `,
    [userId, hashSessionToken(sessionToken), csrfToken, expiresAt]
  );

  return { sessionToken, csrfToken, expiresAt };
}

async function registerLoginFailure(client, attemptKey, previousAttempt) {
  const now = Date.now();
  const firstAttemptAt = previousAttempt?.first_attempt_at
    ? new Date(previousAttempt.first_attempt_at).getTime()
    : 0;
  const withinWindow = firstAttemptAt > 0 && now - firstAttemptAt <= LOGIN_WINDOW_MS;
  const count = withinWindow ? Number(previousAttempt.count || 0) + 1 : 1;
  const firstAttempt = withinWindow ? new Date(firstAttemptAt).toISOString() : new Date(now).toISOString();
  const lockedUntil = count >= LOGIN_LIMIT
    ? new Date(now + LOGIN_LOCK_MS).toISOString()
    : null;

  await client.query(
    `
      INSERT INTO auth.login_attempts (
        attempt_key, count, first_attempt_at, locked_until, updated_at
      )
      VALUES ($1, $2, $3, $4, now())
      ON CONFLICT (attempt_key) DO UPDATE SET
        count = EXCLUDED.count,
        first_attempt_at = EXCLUDED.first_attempt_at,
        locked_until = EXCLUDED.locked_until,
        updated_at = now()
    `,
    [attemptKey, count, firstAttempt, lockedUntil]
  );
}

async function loadUserSectorIds(client, userId) {
  const result = await client.query(
    `
      SELECT sector_id
      FROM public.profile_sector_permissions
      WHERE profile_id = $1
      ORDER BY sector_id
    `,
    [userId]
  );
  return result.rows.map((item) => item.sector_id);
}

function userDto(row, sectorIds = []) {
  return {
    id: row.id,
    customerId: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    sectorIds,
    createdAt: row.created_at
  };
}

function hashSessionToken(sessionToken) {
  const token = String(sessionToken || "");
  if (!token) return null;
  return crypto.createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizeName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function isStrongPassword(value) {
  return value.length >= 12
    && /[a-z]/.test(value)
    && /[A-Z]/.test(value)
    && /\d/.test(value);
}

module.exports = {
  changeLocalPassword,
  consumeLocalRateLimit,
  createSessionInTransaction,
  getLocalSession,
  hashSessionToken,
  loginLocalUser,
  requestLocalPasswordReset,
  registerLocalUser,
  resetLocalPassword,
  revokeAllLocalSessions,
  revokeLocalSession
};
