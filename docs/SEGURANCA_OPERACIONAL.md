# Segurança operacional do SenhaHub

Atualizado em 19/08/2026. Este documento separa os controles já aplicados no código dos controles que dependem de uma conta de DNS, do painel do Supabase ou de um destino externo para backup.

## Controles aplicados sem serviço pago

- API de produção aceita somente HTTPS; respostas incluem HSTS, CSP, `X-Content-Type-Options`, `X-Frame-Options` e `Referrer-Policy`.
- Cookie de sessão é `Secure`, `HttpOnly` e `SameSite=Strict`. O cookie CSRF não é `HttpOnly` por desenho, pois o navegador precisa lê-lo para enviá-lo no cabeçalho `x-csrf-token`.
- Rotas mutáveis exigem CSRF e as rotas de push validam a origem.
- Login, cadastro, emissão no totem, acompanhamento público e verificação TOTP possuem limites de tentativas.
- Administradores e gestores usam TOTP nativo do Supabase. No primeiro login administrativo sem fator, o SenhaHub mostra o QR Code de cadastro; nos próximos, exige o código do autenticador. O acesso administrativo só cria sessão depois da verificação.
- O token temporário recebido do Supabase durante o MFA é armazenado somente como ciphertext AES-256-GCM na tabela interna `auth_mfa_challenges`, com expiração de cinco minutos e no máximo cinco tentativas.
- `service_role`, `senhahub_service`, URLs de banco, `AUTH_SECRET`, `CRON_SECRET`, VAPID privado e a chave de backup permanecem somente no servidor.

O MFA nativo é gratuito e precisa estar com a verificação habilitada em Authentication > Multi-Factor Authentication no projeto Supabase. A documentação oficial informa que o TOTP é gratuito e habilitado nos projetos por padrão, mas também permite controlar a verificação pelo Dashboard.

## Phishing: SPF, DKIM e DMARC

Ainda não é possível publicar esses registros usando `senhahub.vercel.app`: esse é um subdomínio da Vercel e não temos autoridade DNS sobre ele. Também é necessário saber qual domínio e qual servidor SMTP realmente enviará os e-mails.

Quando houver um domínio próprio e um SMTP definido:

1. Publicar o SPF exatamente conforme o provedor de e-mail. Não crie um segundo SPF; deve existir apenas um registro TXT SPF por domínio.
2. Criar o DKIM com o seletor e o valor fornecidos pelo mesmo provedor.
3. Começar o DMARC em modo de observação:

   ```text
   _dmarc.seu-dominio.example  TXT  v=DMARC1; p=none; rua=mailto:dmarc@seu-dominio.example; adkim=s; aspf=s
   ```

4. Após validar SPF/DKIM e observar os relatórios, elevar para `p=quarantine` e depois `p=reject`.

Os valores de SPF e DKIM não devem ser inventados pelo aplicativo. Eles dependem do SMTP escolhido. O SenhaHub não adiciona nenhum provedor pago.

## Ransomware: backup gratuito e restauração

O projeto Supabase está no plano gratuito. Nesse plano, o Supabase recomenda exportação periódica com `supabase db dump`; os backups automáticos diários e PITR são recursos dos planos pagos. Para a operação PostgreSQL local migrada, use `backup:postgres`; para a variante remota, mantenha `backup:supabase`. O script local do projeto:

- gera dumps de roles, schema e dados;
- criptografa cada arquivo com AES-256-GCM;
- apaga o SQL em texto puro;
- exige `BACKUP_OFFSITE_DIR` fora da pasta do projeto;
- grava cópia criptografada no destino externo;
- nunca imprime `DATABASE_URL` ou a chave no terminal.

Configure os valores apenas no `.env.local`, em uma máquina de backup ou em um segredo do agendador:

```text
DATABASE_URL=postgresql://...
BACKUP_ENCRYPTION_KEY=uma-frase-longa-e-exclusiva-com-32-caracteres-ou-mais
BACKUP_OFFSITE_DIR=/Volumes/BackupSenhaHub
```

Execute manualmente ou agende no cron/Agendador de Tarefas:

```bash
npm run backup:supabase
```

Para PostgreSQL local:

```text
LOCAL_DATABASE_URL=postgresql://...
BACKUP_ROLES_DATABASE_URL=postgresql://...usuario-administrativo...
BACKUP_ENCRYPTION_KEY=uma-frase-longa-e-exclusiva-com-32-caracteres-ou-mais
BACKUP_OFFSITE_DIR=/Volumes/BackupSenhaHub
```

```bash
npm run backup:postgres
```

Esse backup inclui roles e banco em arquivos criptografados AES-256-GCM, sem manter SQL em texto puro. O destino externo precisa estar em disco/volume diferente do projeto e deve receber permissões restritas.

Para verificar a chave e a integridade sem restaurar:

```bash
BACKUP_DIR=/Volumes/BackupSenhaHub/AAAAMMDDTHHMMSSZ npm run restore:postgres -- --verify-only
```

Para ensaiar uma restauração, use uma instância PostgreSQL separada:

```bash
RESTORE_DATABASE_URL='postgresql://...do-banco-de-teste...' \
RESTORE_TARGET_CONFIRMED=1 \
BACKUP_DIR=/Volumes/BackupSenhaHub/AAAAMMDDTHHMMSSZ \
npm run restore:postgres
```

Para validar somente a descriptografia:

```bash
BACKUP_DIR=/Volumes/BackupSenhaHub/AAAAMMDDTHHMMSSZ npm run restore:supabase -- --verify-only
```

Para testar uma restauração real, use um projeto Supabase de teste separado e nunca o banco de produção:

```bash
RESTORE_DATABASE_URL='postgresql://...do-projeto-de-teste...' \
RESTORE_TARGET_CONFIRMED=1 \
BACKUP_DIR=/Volumes/BackupSenhaHub/AAAAMMDDTHHMMSSZ \
npm run restore:supabase
```

O script bloqueia intencionalmente a restauração na mesma URL usada por `DATABASE_URL`.

## DDoS e limites de API

A proteção DDoS de borda depende de um domínio próprio. Não é possível colocar `senhahub.vercel.app` atrás do Cloudflare porque o DNS desse subdomínio não pertence ao projeto.

Quando houver domínio próprio, a configuração gratuita deve ser:

1. Adicionar o domínio à conta Cloudflare Free.
2. Trocar os nameservers no registrador.
3. Cadastrar na Vercel o mesmo domínio e usar exatamente os registros que a Vercel fornecer.
4. Ativar proxy somente depois de validar o certificado HTTPS e o funcionamento do domínio.
5. Manter `TRUST_PROXY_HEADERS=1` apenas quando o tráfego chegar exclusivamente pelo proxy confiável; isso permite usar `CF-Connecting-IP` para os limites.

Não exponha diretamente o endereço do banco ou chaves do Supabase no DNS. O limite da aplicação continua ativo como segunda camada, mesmo sem Cloudflare.

## Checklist antes de produção

- [ ] Domínio próprio configurado na Vercel e no Cloudflare.
- [ ] SPF, DKIM e DMARC publicados e validados.
- [ ] SMTP real testado para recuperação de senha.
- [ ] MFA/TOTP habilitado no painel do Supabase e testado com cada conta administrativa.
- [ ] `DATABASE_URL` validada sem aparecer em logs.
- [ ] `LOCAL_DATABASE_URL` validada sem aparecer em logs quando o servidor interno for usado.
- [ ] Backup criptografado copiado para destino externo.
- [ ] Restauração testada em banco separado.
- [ ] `npm run preflight:local-postgres` aprovado no servidor interno.
- [ ] `TRUST_PROXY_HEADERS=1` somente após Cloudflare estar ativo.
- [ ] `npm run check`, `npm run build` e `npm test` aprovados.
