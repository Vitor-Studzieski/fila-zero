# Guia de decisões de infraestrutura e operação

Projeto: SenhaHub Supermercado Pompeia
Data da análise: 11/08/2026  
Status: documento para discussão e planejamento

## Resumo executivo

O projeto já compila, inicia localmente e possui uma suíte automatizada aprovada. As principais pendências atuais são de arquitetura, configuração do Supabase, autenticação por e-mail e validação física do totem/impressora.

Recomendação inicial:

1. manter o Cron, mas configurar e monitorar o `CRON_SECRET`;
2. não apagar migrations já aplicadas;
3. corrigir o `DATABASE_URL` antes de depender de ferramentas PostgreSQL;
4. validar primeiro SMTP e Supabase, depois o agente Windows e, por fim, o pareamento do totem.

## 1.0 — O que é o Cron?

Cron é um agendador de tarefas. Ele faz uma chamada HTTP automática em horários definidos, sem depender de alguém estar com o navegador aberto.

Neste projeto, [vercel.json](../vercel.json) define:

```json
{
  "path": "/api/internal/jobs",
  "schedule": "* * * * *"
}
```

Isso significa uma chamada por minuto. A rota executa tarefas como:

- expirar senhas ou chamadas abandonadas;
- liberar ou expirar tickets em espera;
- chamar automaticamente tickets prontos;
- disparar notificações pendentes;
- limpar sessões expiradas.

O Cron não é um servidor permanente nem um worker de impressão. Ele apenas dispara a rotina. O agente Windows continua sendo o processo responsável por buscar e imprimir trabalhos da fila física.

### Para que serve o `CRON_SECRET`?

Como a rota é pública na internet, qualquer pessoa poderia tentar chamá-la. O `CRON_SECRET` funciona como uma credencial compartilhada:

1. o segredo é cadastrado na Vercel;
2. a Vercel envia o valor no cabeçalho `Authorization`;
3. a aplicação compara o valor recebido com o segredo local;
4. chamadas sem o segredo recebem `401` ou `503` quando a variável não está configurada.

A Vercel recomenda proteger Cron Jobs com `CRON_SECRET`. A documentação também informa que falhas não são automaticamente repetidas e que chamadas sobrepostas podem ocorrer, por isso as rotinas precisam ser idempotentes e monitoradas.

Referência: [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

### Pendência atual

O projeto já possui a rota e o agendamento, mas o `CRON_SECRET` não está configurado no ambiente local analisado. É preciso cadastrar um segredo diferente dos demais, tanto no `.env` quanto na Vercel, e fazer um novo deploy.

## 2.0 — Posso apagar as cinco migrations depois de aplicar a nova?

Não. As migrations são o histórico versionado do banco e devem permanecer no Git.

Há duas coisas diferentes:

- os arquivos SQL em `supabase/migrations/`, mantidos no projeto;
- o histórico de migrations aplicadas em cada banco Supabase.

Quando `supabase db push` é executado, a CLI compara os arquivos locais com a tabela de histórico do banco e executa apenas o que ainda não foi aplicado. Portanto, apagar os arquivos locais pode fazer com que um banco novo não consiga ser reconstruído corretamente.

O procedimento recomendado é:

```bash
supabase migration list
supabase db push
```

Antes, é necessário confirmar que o projeto Supabase está corretamente vinculado e que o histórico local/remoto não está divergente.

Pelos arquivos e relatórios atuais, existe uma migration nova de sessões:

```text
supabase/migrations/20260805131014_auth_session_revocation.sql
```

O relatório local indicava que ela ainda estava pendente. Como o usuário mencionou cinco migrations no Supabase, a confirmação deve ser feita com `supabase migration list` antes de aplicar qualquer coisa.

Só faria sentido consolidar ou fazer squash depois de um backup, com um procedimento explícito para novos ambientes. Não é recomendado apagar migrations de um projeto em operação.

Referência: [Database Migrations — Supabase](https://supabase.com/docs/guides/deployment/database-migrations).

## 3.0 — O que está errado no `DATABASE_URL`?

`DATABASE_URL` é uma string de conexão PostgreSQL. Ela normalmente é usada por ferramentas como `psql`, Supabase CLI, migrations, ORM ou scripts de backup.

O valor local analisado está malformado porque repete o nome da variável no próprio valor. O formato deve ter somente uma atribuição:

```env
DATABASE_URL=postgresql://usuario:senha@host:5432/postgres
```

Ou, usando um pooler do Supabase:

```env
DATABASE_URL=postgres://postgres.<project-ref>:<senha>@<pooler-host>:6543/postgres
```

O valor real deve ser copiado do botão **Connect** no painel do Supabase. Não se deve copiar literalmente os placeholders `<project-ref>`, `<senha>` ou `<pooler-host>`.

O Supabase diferencia os modos de conexão:

- conexão direta, normalmente na porta `5432`, adequada para migrations e servidores persistentes;
- pooler em modo sessão, adequado para backend persistente em redes IPv4;
- pooler em modo transação, normalmente na porta `6543`, adequado para funções serverless.

Referência: [Conectar ao PostgreSQL do Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).

No runtime atual do projeto, as operações usam principalmente a Data API REST do Supabase, portanto `DATABASE_URL` não é a principal conexão usada pela aplicação. Mesmo assim, ela deve ser corrigida para que CLI, migrations, backups e ferramentas administrativas funcionem sem ambiguidade.

Essa variável contém senha de banco e nunca deve ser commitada ou exposta no frontend.

## 4.0 — Explicação das pendências operacionais

### 4.1 SMTP e recuperação de senha

O fluxo de recuperação funciona assim:

1. o usuário informa o e-mail na tela de login;
2. a aplicação pede ao Supabase Auth um link de recuperação;
3. o Supabase envia o e-mail pelo SMTP configurado;
4. o usuário abre o link;
5. a aplicação permite definir uma senha nova;
6. as sessões antigas são revogadas;
7. o usuário entra novamente com a nova senha.

Para produção, configurar:

- provedor SMTP, como Resend, AWS SES, Postmark, SendGrid ou Brevo;
- host, porta, usuário e senha SMTP;
- remetente autorizado, por exemplo `no-reply@dominio.com`;
- SPF, DKIM e DMARC do domínio;
- Site URL do projeto Supabase;
- Redirect URLs para localhost e produção.

O SMTP padrão do Supabase é voltado a testes, possui restrições de destinatários e não deve ser tratado como serviço de produção. A própria documentação recomenda SMTP customizado para aplicações reais.

No projeto, o redirect é montado a partir de `PUBLIC_APP_URL` e aponta para:

```text
/login?mode=reset
```

### Como testar

- solicitar recuperação para uma conta de teste;
- confirmar que o e-mail chega;
- abrir o link recebido;
- definir uma senha forte;
- confirmar que a senha antiga não funciona;
- confirmar que a nova senha permite login;
- confirmar que sessões antigas foram invalidadas.

Referências: [SMTP customizado do Supabase](https://supabase.com/docs/guides/auth/auth-smtp), [password-based Auth](https://supabase.com/docs/guides/auth/passwords) e [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

### 4.2 Proteção contra senhas vazadas

Essa opção impede o cadastro ou a troca para senhas conhecidas em bases públicas de vazamentos. O Supabase Auth consulta a base de senhas comprometidas do Have I Been Pwned e rejeita senhas encontradas.

Ela deve ser ativada nas configurações de segurança do Auth, desde que o plano Supabase utilizado ofereça o recurso. A documentação atual informa que a proteção está disponível no plano Pro ou superior.

Isso não substitui:

- senha mínima forte;
- limite de tentativas;
- MFA para gestores;
- proteção contra abuso de cadastro;
- não reutilização de senhas administrativas.

Referência: [Password Security — Supabase](https://supabase.com/docs/guides/auth/password-security).

### 4.3 Agente Windows e Bematech MP-4200 TH

O agente Windows é um processo que consulta a fila de impressão no backend e envia o cupom ESC/POS para a porta serial da Bematech.

Fluxo:

```text
Totem emite senha
        ↓
Supabase cria ticket + print_job
        ↓
Agente Windows consulta print_job pendente
        ↓
Agente envia ESC/POS para COM3
        ↓
Agente confirma sucesso ou falha na API
```

No computador Windows:

2. conectar a Bematech e confirmar a porta COM;
3. copiar `.env.print-agent.example` para `.env.print-agent`;
4. configurar `PRINT_API_URL`, `PRINT_AGENT_TOKEN`, `KIOSK_ID` e `KIOSK_PRINTER_PORT`;
5. instalar dependências com `npm ci --omit=dev`;
6. listar portas:

```powershell
npm run print:agent:ports
```

7. testar a impressora:

```powershell
npm run print:agent:test
```

8. depois do teste, instalar a inicialização automática:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\windows\print-agent\install.ps1
```

O instalador registra o agente no Agendador de Tarefas do Windows, executa como `SYSTEM`, restringe o acesso ao arquivo de configuração e reinicia o processo em caso de falha.

Configuração serial inicial:

- porta: `COM3`;
- velocidade: `115200`;
- 8 bits de dados;
- 1 stop bit;
- sem paridade;
- RTS/CTS desativado;
- `PRINT_STATUS_CHECK_ENABLED=0` no primeiro teste.

Depois de confirmar que a impressora responde ao comando de status ESC/POS, pode-se ativar `PRINT_STATUS_CHECK_ENABLED=1` para detectar tampa aberta, falta de papel e falhas.

### 4.4 Pareamento do totem em `/totem`

O pareamento vincula o navegador do computador do totem ao equipamento lógico `totem-pompeia-01`. Ele gera cookies assinados, restritos ao totem, que autorizam emitir senhas físicas.

Passo a passo:

1. deixar o backend, Supabase e variáveis de produção configurados;
2. abrir `/totem` no computador do supermercado;
3. entrar com uma conta de gestor;
4. clicar em **Vincular este totem**;
5. confirmar que o status muda para operacional;
6. escolher um setor;
7. emitir uma senha física;
8. confirmar que o agente Windows recebe o trabalho;
9. confirmar a impressão;
10. confirmar na tela do totem que o trabalho foi concluído.

Se os cookies forem apagados ou o totem for desvinculado, o pareamento deverá ser repetido.

### Critério de aceite do piloto

O piloto do totem só deve ser considerado aprovado quando:

- a senha física entrar na mesma fila da senha digital;
- o papel sair com setor, senha e horário corretos;
- uma falha de impressão aparecer como falha e permitir recuperação;
- uma queda de internet não causar reimpressão indevida;
- o agente voltar automaticamente após reinício do Windows;
- o acesso sem pareamento continuar bloqueado.

## Ordem recomendada de execução

1. Rotacionar credenciais caso o `.env` tenha sido compartilhado.
2. Conferir o histórico com `supabase migration list`.
3. Aplicar a migration de sessões somente se estiver pendente.
4. Corrigir `DATABASE_URL` e validar conexão pelo Supabase CLI.
5. Configurar SMTP, URLs de redirect e proteção contra senhas vazadas.
6. Configurar e testar o agente Windows.
7. Parear o totem e executar o teste completo de emissão até impressão.
8. Só depois publicar a configuração consolidada na produção.

## Referências do próprio projeto

- [README.md](../README.md)
- [Configuração Supabase](supabase-setup.md)
- [Totem e impressão](totem-impressao.md)
- [Necessidades de desenvolvimento](../NECESSIDADES_DESENVOLVIMENTO.md)
- [Relatório de auditoria](../RELATORIO_AUDITORIA_SENHAHUB.md)
