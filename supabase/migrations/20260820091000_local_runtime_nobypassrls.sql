DO $$
DECLARE
  table_name text;
  service_tables text[] := ARRAY[
    'app_sessions', 'auth_mfa_challenges', 'calls', 'cart_items',
    'cron_executions', 'devices', 'events', 'print_job_attempts',
    'print_jobs', 'print_kiosks', 'profile_sector_permissions',
    'profiles', 'push_notification_events', 'push_notification_preferences',
    'push_rate_limits', 'ratings', 'security_rate_limits', 'services',
    'sectors', 'shopping_signals', 'ticket_counters', 'tickets',
    'web_push_subscriptions'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'senhahub_service') THEN
    RETURN;
  END IF;

  EXECUTE 'ALTER ROLE senhahub_service NOBYPASSRLS';
  EXECUTE 'GRANT USAGE ON SCHEMA public, auth TO senhahub_service';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON auth.users, auth.sessions, auth.login_attempts, auth.password_resets TO senhahub_service';

  FOREACH table_name IN ARRAY service_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO senhahub_service', table_name);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policy policy
      JOIN pg_class relation ON relation.oid = policy.polrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = table_name
        AND policy.polname = 'senhahub_service_backend_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY senhahub_service_backend_access ON public.%I FOR ALL TO senhahub_service USING (true) WITH CHECK (true)',
        table_name
      );
    END IF;
  END LOOP;
END;
$$;
