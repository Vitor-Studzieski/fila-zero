-- Runtime local PostgreSQL: schema, grants and operational hardening.
-- Do not apply this migration to a hosted Supabase project unless the local
-- auth runtime is intentionally enabled there.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  encrypted_password text NOT NULL DEFAULT '',
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  email_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS encrypted_password text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_key ON auth.users (email);
CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_lower_key ON auth.users (lower(email));

CREATE TABLE IF NOT EXISTS auth.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  csrf_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth.sessions (user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth.sessions (expires_at);

CREATE TABLE IF NOT EXISTS auth.login_attempts (
  attempt_key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  first_attempt_at timestamptz NOT NULL,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth.password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE INDEX IF NOT EXISTS auth_password_resets_user_idx
  ON auth.password_resets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_password_resets_expiry_idx
  ON auth.password_resets (expires_at)
  WHERE used_at IS NULL;

DO $do$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL THEN
    EXECUTE $sql$
      CREATE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      AS $$SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid$$
    $sql$;
  END IF;
END
$do$;

REVOKE ALL ON TABLE auth.users, auth.sessions, auth.login_attempts, auth.password_resets
  FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'senhahub_service') THEN
    ALTER ROLE senhahub_service NOBYPASSRLS;
    GRANT USAGE ON SCHEMA public, auth TO senhahub_service;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE auth.users, auth.sessions, auth.login_attempts, auth.password_resets
      TO senhahub_service;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'senhahub_app') THEN
    ALTER ROLE senhahub_app NOLOGIN;
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public, auth FROM senhahub_app;
    REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public, auth FROM senhahub_app;
    REVOKE USAGE ON SCHEMA public, auth FROM senhahub_app;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.senhahub_schema_migrations (
  version text PRIMARY KEY,
  name text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.senhahub_schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.senhahub_schema_migrations FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS senhahub_deny_external_access ON public.senhahub_schema_migrations;
CREATE POLICY senhahub_deny_external_access
  ON public.senhahub_schema_migrations
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS senhahub_service_backend_access ON public.senhahub_schema_migrations;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'senhahub_service') THEN
    EXECUTE 'GRANT SELECT ON TABLE public.senhahub_schema_migrations TO senhahub_service';
    EXECUTE $sql$
      CREATE POLICY senhahub_service_backend_access
        ON public.senhahub_schema_migrations
        FOR SELECT
        TO senhahub_service
        USING (true)
    $sql$;
  END IF;
END
$$;

INSERT INTO public.senhahub_schema_migrations (version, name, checksum)
VALUES (
  '20260820125056',
  'local_postgres_runtime_reconciliation',
  'local-postgres-runtime-reconciliation-v1'
)
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name,
    checksum = EXCLUDED.checksum;

COMMIT;
