drop policy if exists senhahub_deny_external_access on public.auth_mfa_challenges;

create policy senhahub_deny_external_access
  on public.auth_mfa_challenges
  for all
  to anon, authenticated
  using (false)
  with check (false);
