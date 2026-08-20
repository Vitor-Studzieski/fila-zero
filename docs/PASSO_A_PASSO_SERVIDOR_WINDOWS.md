# Servidor Windows do SenhaHub

Este procedimento instala a API do SenhaHub como tarefa automática do Windows, conectada ao PostgreSQL local. O banco não é exposto diretamente à internet.

## Pré-requisitos

- Windows 10/11 ou Windows Server 2019+;
- Node.js 22 LTS;
- PostgreSQL instalado como serviço do Windows;
- projeto copiado para uma pasta fixa, por exemplo `C:\SenhaHub`;
- banco, migrations, papel `senhahub_service` e permissões já preparados.

## Instalação

Abra o PowerShell como Administrador e execute:

```powershell
Set-Location C:\SenhaHub
Set-ExecutionPolicy -Scope Process Bypass
.\windows\server\install.ps1
```

O instalador:

1. configura `.env.local` para `local-postgres`;
2. preserva credenciais já existentes e gera somente secrets ausentes;
3. executa `npm ci --omit=dev`;
4. executa `npm run check`;
5. executa `npm run preflight:local-postgres`;
6. registra a API no Agendador de Tarefas do Windows;
7. inicia a tarefa e testa `/api/ready`.

Se o `.env.local` já estiver preenchido, não informe a URL novamente. Caso contrário, o instalador solicitará `LOCAL_DATABASE_URL`.

## Verificação

```powershell
Invoke-WebRequest http://127.0.0.1:3000/api/health
Invoke-WebRequest http://127.0.0.1:3000/api/ready
Get-ScheduledTask -TaskName "SenhaHub - API"
```

O endpoint `/api/ready` deve retornar `200` com `backend: "local-postgres"`.

O log da API fica em:

```text
C:\SenhaHub\data\windows-server\api.log
```

## Vercel e HTTPS

Se o front continuar na Vercel, configure `API_SERVER_URL` com a URL HTTPS da API do servidor Windows. Use um proxy HTTPS confiável; não abra a porta 5432 e não publique o PostgreSQL diretamente.

## Remover a inicialização automática

```powershell
.\windows\server\uninstall.ps1
```

Esse comando remove somente a tarefa do Windows. Ele não remove o banco, os dados ou o `.env.local`.
