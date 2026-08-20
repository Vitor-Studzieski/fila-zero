CREATE SCHEMA IF NOT EXISTS auth;

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

REVOKE ALL ON auth.password_resets FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'senhahub_service') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON auth.password_resets TO senhahub_service;
  END IF;
END;
$$;
