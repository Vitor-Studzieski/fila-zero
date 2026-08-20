-- Permissoes do usuario restrito usado pelo servidor PostgreSQL local.
-- Em ambientes onde esse papel nao existe (por exemplo, o projeto cloud),
-- a migration nao altera nada.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'senhahub_service') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.issue_physical_ticket(text,text,text,text,text,boolean,text,integer) TO senhahub_service';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.issue_physical_ticket_bundle(text,text[],text,text,text,boolean,text,integer) TO senhahub_service';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.claim_next_print_job(text) TO senhahub_service';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.finish_print_job(uuid,text,boolean,text) TO senhahub_service';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.consume_security_rate_limit(text,integer,integer) TO senhahub_service';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.consume_push_rate_limit(text,integer,integer) TO senhahub_service';
  END IF;
END
$$;
