# Tecnologias do SenhaHub

## Front-end

- Next.js 16 com App Router e React 19.
- HTML, CSS e JavaScript.
- PWA com Service Worker e Web Push.
- Atualização em tempo real via SSE.

## Back-end

- Node.js 22 com servidor HTTP integrado ao Next.js.
- API REST, autenticação, permissões e regras da fila.
- Supabase REST/RPC em produção.
- Deploy e Cron Jobs na Vercel.

## Banco de dados

- PostgreSQL gerenciado pelo Supabase em produção.
- Banco relacional com transações, concorrência controlada, chaves estrangeiras e constraints.
- Migrations, índices e funções SQL/RPC para operações críticas da fila.
- SQLite local via `node:sqlite` para desenvolvimento e testes.

## Segurança

- Supabase Auth para autenticação e controle de sessões.
- RLS, permissões por função e políticas de acesso às tabelas.
- Chave `service_role` utilizada somente no back-end.
- Proteções contra duplicidade, alterações indevidas e operações sem autorização.

## Agente e impressão

- Agente Node.js executado no Windows.
- Comunicação serial com `serialport`.
- Impressão térmica em ESC/POS.
- Compatibilidade com a Bematech MP-4200 TH, incluindo QR Code e corte automático.
