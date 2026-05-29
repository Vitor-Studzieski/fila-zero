# Fila Zero Supermercado Pompeia

Aplicativo de fila virtual para supermercado, com login por perfil, solicitacao de senhas por setor, painel do atendente, painel administrativo e lista de compras/promocoes.

## Requisitos

- Node.js 22.x
- npm

O projeto usa `node:sqlite`, por isso o Node 22 e necessario.

## Como rodar localmente

1. Instale as dependencias:

```bash
npm install
```

2. Inicie o servidor local:

```bash
npm run dev
```

3. Abra no navegador:

```text
http://localhost:3000
```

O backend, as paginas Next.js e os arquivos de `public/` rodam pelo mesmo servidor.

## Rotas principais

- `http://localhost:3000/login` - login
- `http://localhost:3000/` - app do cliente
- `http://localhost:3000/attendant` - painel do funcionario
- `http://localhost:3000/admin` - painel do gestor

## Contas de teste

Estas contas sao criadas automaticamente apenas para desenvolvimento/testes:

| Perfil | E-mail | Senha | Acesso |
| --- | --- | --- | --- |
| Cliente | `***REMOVED***` ate `***REMOVED***` | `***REMOVED_DEMO_PASSWORD***` | App do cliente e promocoes |
| Funcionario Acougue | `***REMOVED***` | `***REMOVED***` | Painel do acougue |
| Funcionario Frios | `***REMOVED***` | `***REMOVED***` | Painel de frios |
| Funcionario Padaria | `***REMOVED***` | `***REMOVED***` | Painel da padaria |
| Gestor | `***REMOVED***` | `***REMOVED***` | Painel completo |

Nao use essas senhas em producao.

## Banco de dados local

O SQLite local fica em:

```text
data/fila-zero.sqlite
```

Esse arquivo nao e versionado pelo Git. Se quiser reiniciar os dados locais, pare o servidor e apague os arquivos SQLite dentro de `data/`.

Tambem e possivel escolher outra pasta de dados:

```bash
DATA_DIR=/caminho/para/dados npm run dev
```

No PowerShell:

```powershell
$env:DATA_DIR="C:\caminho\para\dados"; npm run dev
```

## Scripts

```bash
npm run dev
```

Roda o servidor local em modo desenvolvimento.

```bash
npm run build
```

Gera o build de producao com Next.js.

```bash
npm run check
```

Verifica a sintaxe dos arquivos principais.

```bash
npm test
```

Executa os testes de orquestracao da fila.

## Observacoes para deploy

O projeto possui adaptacao para Vercel em `app/api/[...path]/route.js`, mas o SQLite em ambiente serverless deve ser tratado como temporario. Para producao real, use um banco persistente como Vercel Postgres, Neon ou Supabase e remova as contas/senhas padrao.
