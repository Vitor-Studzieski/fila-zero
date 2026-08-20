# Modelos de operação no servidor

Estes arquivos são modelos para um servidor Linux interno. Eles não contêm certificados, senhas, tokens ou endereços reais.

1. Copie o projeto para um diretório de serviço, por exemplo `/opt/senhahub`.
2. Instale Node.js 22 e as dependências com `npm ci`.
3. Crie `/etc/senhahub/senhahub.env` com permissões `600`, usando `.env.example` como base.
4. Configure `DATA_BACKEND=local-postgres`, `LOCAL_DATABASE_URL`, `AUTH_SECRET`, `CRON_SECRET`, `PRINT_AGENT_TOKEN` e os demais valores reais.
5. Instale o serviço `senhahub.service.example` como unidade systemd.
6. Coloque um proxy HTTPS confiável na frente da porta interna da aplicação.
7. Instale o timer de backup somente depois de configurar `BACKUP_ENCRYPTION_KEY` e `BACKUP_OFFSITE_DIR` em um volume externo.
8. Execute `npm run preflight:local-postgres` antes de liberar a rede da loja.

O PostgreSQL deve aceitar conexões somente do servidor da aplicação. Totens, TVs, tablets e clientes acessam a API HTTPS; nunca a porta 5432.
