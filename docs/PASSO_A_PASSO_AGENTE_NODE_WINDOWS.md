# Passo a passo: agente Node.js de impressão no Windows

Projeto: SenhaHub Supermercado Pompeia
Componente: agente Node.js + Bematech MP-4200 TH  
Objetivo: instalar, testar, operar e diagnosticar a impressão de senhas físicas

## 1. O que este agente faz

O agente Node.js é um processo que fica no computador Windows conectado à impressora Bematech.

```text
consultar a API
      ↓
reivindicar um print_job
      ↓
montar o cupom ESC/POS
      ↓
enviar os bytes para a COM3
      ↓
registrar o job no journal local
      ↓
confirmar sucesso ou falha na API
      ↓
aguardar e repetir
```

O agente não cria a senha e não decide a fila. Essas responsabilidades ficam no backend e no Supabase. O agente somente consome trabalhos de impressão já registrados.

## 2. Arquivos envolvidos

| Arquivo | Função |
|---|---|
| `scripts/print-agent.js` | Loop principal, consumo da fila e processamento do trabalho. |
| `scripts/print-agent/runtime.js` | Carrega `.env.print-agent`, configura logs e journal. |
| `scripts/print-agent/serial-printer.js` | Abre a porta serial e envia ESC/POS. |
| `server/escpos-receipt.js` | Monta o conteúdo binário do recibo. |
| `.env.print-agent.example` | Modelo de configuração do agente. |
| `windows/print-agent/install.ps1` | Instala a tarefa automática do Windows. |
| `windows/print-agent/uninstall.ps1` | Remove a tarefa automática. |
| `data/print-agent/print-agent.log` | Log operacional. |
| `data/print-agent/printed-jobs.log` | Journal contra reimpressão. |

## 3. Como a fila funciona

Quando o cliente escolhe um setor no totem:

1. o totem envia `POST /api/kiosk/tickets`;
2. o backend valida a sessão do totem;
3. o Supabase cria o ticket físico;
4. o Supabase cria um registro em `print_jobs` com status `pending`;
5. a API devolve o número da senha e o ID do trabalho.

O agente chama:

```text
POST /api/print/jobs/claim
```

Com:

```json
{
  "kioskId": "totem-pompeia-01"
}
```

E com o cabeçalho:

```text
x-print-agent-token: <PRINT_AGENT_TOKEN>
```

Se houver trabalho disponível, a API muda o status de `pending` para `printing` e devolve o payload do recibo.

Depois da impressão, o agente chama:

```text
POST /api/print/jobs/<jobId>/finish
```

Sucesso:

```json
{
  "kioskId": "totem-pompeia-01",
  "success": true,
  "error": null
}
```

Falha:

```json
{
  "kioskId": "totem-pompeia-01",
  "success": false,
  "error": "COM3 indisponivel"
}
```

Estados:

```text
pending → printing → printed
                    ↘ failed → nova tentativa
```

Um trabalho que ficou em `printing` por mais de dois minutos pode ser reivindicado novamente. A RPC usa `FOR UPDATE SKIP LOCKED` para impedir que dois agentes peguem o mesmo trabalho simultaneamente.

## 4. Pré-requisitos do Windows

Confirme antes de instalar:

- Windows 10 ou superior, 64 bits;
- Node.js 22 instalado;
- acesso de administrador para criar a tarefa automática;
- internet HTTPS funcionando;
- Bematech MP-4200 TH conectada;
- driver ou conversor USB/serial instalado;
- impressora configurada para ESC/POS;
- cabo, alimentação e papel funcionando;
- projeto copiado para uma pasta fixa.

Recomenda-se uma pasta como:

```text
C:\SenhaHub
```

Não instale o agente dentro de Downloads ou de uma pasta temporária.

## 5. Instalar e validar o Node.js

Instale o Node.js 22 LTS. Depois abra o PowerShell e execute:

```powershell
node --version
npm --version
```

O primeiro comando deve mostrar uma versão `22.x`. Se `node` não for encontrado, reabra o PowerShell para atualizar o PATH.

## 6. Copiar o projeto e instalar dependências

Copie ou clone o projeto para uma pasta fixa:

```powershell
Set-Location C:\SenhaHub
```

Confirme os arquivos:

```powershell
Get-ChildItem package.json
Get-ChildItem scripts\print-agent.js
Get-ChildItem scripts\print-agent\serial-printer.js
```

Instale as versões travadas no lockfile:

```powershell
npm ci --omit=dev
```

O pacote principal do agente é `serialport`, usado para acessar a porta serial.

## 7. Criar o `.env.print-agent`

Copie o modelo:

```powershell
Copy-Item .env.print-agent.example .env.print-agent
notepad .env.print-agent
```

Preencha:

```env
PRINT_API_URL=https://senhahub-mauve.vercel.app
PRINT_AGENT_TOKEN=cole-o-mesmo-segredo-configurado-no-servidor
KIOSK_ID=totem-pompeia-01

KIOSK_PRINTER_PORT=COM3
PRINT_SERIAL_BAUD_RATE=115200
PRINT_SERIAL_DATA_BITS=8
PRINT_SERIAL_STOP_BITS=1
PRINT_SERIAL_PARITY=none
PRINT_SERIAL_RTSCTS=0

PRINT_STATUS_CHECK_ENABLED=0
PRINT_STATUS_TIMEOUT_MS=1500
PRINT_POLL_INTERVAL_MS=2000
PRINT_RETRY_MAX_MS=60000
PRINT_AGENT_STATE_DIR=./data/print-agent
```

Regras importantes:

- `PRINT_API_URL` deve apontar para a API que contém a fila.
- Em produção, use `https://`.
- `PRINT_AGENT_TOKEN` deve ser idêntico ao token configurado na hospedagem.
- O token deve ter pelo menos 32 caracteres.
- `KIOSK_ID` deve corresponder ao cadastro do banco.
- `KIOSK_PRINTER_PORT` deve ser a porta real encontrada no Windows.
- Nunca envie `.env.print-agent` para o Git ou para o navegador.

O agente não precisa receber a `SUPABASE_SERVICE_ROLE_KEY`, senha de banco ou senha de usuário. Ele precisa somente da URL da API, do token exclusivo e da configuração da impressora.

## 8. Descobrir a porta da Bematech

Com a impressora conectada, execute:

```powershell
npm run print:agent:ports
```

Exemplo esperado:

```json
[
  {
    "path": "COM3",
    "manufacturer": "..."
  }
]
```

Se aparecer outra porta, como `COM4`, ajuste:

```env
KIOSK_PRINTER_PORT=COM4
```

Também confira em:

```text
Gerenciador de Dispositivos → Portas (COM e LPT)
```

Uma forma prática de identificar a porta é observar qual item desaparece ao desconectar o cabo e reaparece ao conectá-lo novamente.

## 9. Testar a impressora diretamente

Antes de testar a fila, execute:

```powershell
npm run print:agent:test
```

Esse comando:

1. carrega o `.env.print-agent`;
2. monta um cupom de diagnóstico;
3. abre a porta configurada;
4. envia ESC/POS;
5. aguarda o buffer esvaziar;
6. fecha a porta.

Esse teste não consulta o Supabase e não precisa de `print_job` pendente.

Se não imprimir, verifique nesta ordem:

1. impressora ligada;
2. papel instalado;
3. porta correta;
4. cabo conectado;
5. driver ou conversor USB/serial;
6. modo ESC/POS;
7. baud rate `115200`;
8. 8 bits, sem paridade e 1 stop bit;
9. porta não utilizada por outro programa;
10. permissões do usuário.

## 10. Validar o status da impressora

A configuração inicial é:

```env
PRINT_STATUS_CHECK_ENABLED=0
```

Nesse modo, o agente envia o cupom sem consultar o estado da impressora.

Depois que o teste básico funcionar, pode-se experimentar:

```env
PRINT_STATUS_CHECK_ENABLED=1
```

Nesse modo, o agente envia `DLE EOT`, um comando ESC/POS, e tenta detectar tampa aberta, falta de papel e falha informada pela impressora.

Se a Bematech não responder a esse comando, o agente pode informar timeout mesmo que consiga imprimir. Por isso, mantenha `0` durante a primeira instalação e habilite `1` somente após validar o comportamento real do equipamento.

## 11. Iniciar o agente manualmente

Para executar em primeiro plano:

```powershell
npm run print:agent
```

Para parar:

```text
Ctrl + C
```

O código também aceita uma execução única:

```powershell
node scripts\print-agent.js --once
```

Esse modo consulta uma vez, processa um trabalho se encontrar e encerra. É útil para estudar a fila sem deixar um processo permanente rodando.

Mensagens esperadas:

```text
Agente de impressao iniciado.
Enviando senha para a impressora.
Impressao concluida.
```

Quando a API ou a impressora falha, o agente aumenta progressivamente o intervalo até `PRINT_RETRY_MAX_MS`.

## 12. Testar a fila completa

### Preparação

1. confirmar que as migrations da fila foram aplicadas no Supabase;
2. confirmar que existe o kiosk `totem-pompeia-01` ativo;
3. confirmar que `PRINT_AGENT_TOKEN` está configurado na hospedagem;
4. configurar o mesmo token no `.env.print-agent`;
5. confirmar que o totem está pareado.

### Execução

1. abrir `/totem`;
2. selecionar um setor aberto;
3. confirmar a emissão;
4. observar a senha aparecer;
5. observar `Aguardando a impressora`;
6. iniciar `npm run print:agent`;
7. observar `Imprimindo sua senha`;
8. retirar o papel;
9. observar `Senha impressa`.

### Conferência no banco

O trabalho deve seguir:

```text
pending → printing → printed
```

Na tabela `print_jobs`, confira:

- `status = 'printed'`;
- `attempts` incrementado;
- `printed_at` preenchido;
- `last_error` nulo;
- `kiosk_id` correto.

## 13. Como o agente evita reimpressão

O agente usa:

```text
data\print-agent\printed-jobs.log
```

A ordem é:

1. reivindicar o trabalho;
2. imprimir fisicamente;
3. gravar o ID no journal;
4. confirmar sucesso na API.

Se a API cair depois da impressão, o trabalho pode voltar para a fila. Na nova tentativa, o agente encontra o mesmo ID no journal e não imprime novamente; apenas tenta confirmar a conclusão.

Existe uma pequena janela inevitável: se a energia cair depois do corte e antes de o journal ser gravado, uma nova tentativa pode gerar uma segunda via. Por isso, nunca apague o journal sem confirmar primeiro se o papel já saiu.

## 14. Verificar os logs

O agente cria automaticamente:

```text
data\print-agent\print-agent.log
data\print-agent\printed-jobs.log
```

Comandos úteis:

```powershell
Get-Content .\data\print-agent\print-agent.log -Wait
Get-Content .\data\print-agent\print-agent.log -Tail 50
Get-Content .\data\print-agent\printed-jobs.log -Tail 20
```

O log registra horário, início, busca, impressão, falhas, tentativas e encerramento.

## 15. Instalar execução automática

Depois que o teste manual funcionar, abra o PowerShell como Administrador:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\windows\print-agent\install.ps1
```

O instalador:

1. confirma privilégios administrativos;
2. verifica o projeto e o `.env.print-agent`;
3. executa `npm ci --omit=dev`;
4. restringe a leitura da configuração;
5. registra uma tarefa no Agendador do Windows;
6. configura execução no início do Windows;
7. configura reinício em caso de falha;
8. inicia a tarefa.

A tarefa é criada como:

```text
SenhaHub - Agente de Impressao
```

Conferir:

```powershell
Get-ScheduledTask -TaskName "SenhaHub - Agente de Impressao"
Get-ScheduledTaskInfo -TaskName "SenhaHub - Agente de Impressao"
```

Parar e iniciar manualmente:

```powershell
Stop-ScheduledTask -TaskName "SenhaHub - Agente de Impressao"
Start-ScheduledTask -TaskName "SenhaHub - Agente de Impressao"
```

Remover:

```powershell
.\windows\print-agent\uninstall.ps1
```

Remover a tarefa não apaga automaticamente os logs nem o journal.

## 16. Diagnóstico rápido

| Sintoma | Causa provável | Ação |
|---|---|---|
| `PRINT_API_URL deve usar HTTPS` | URL sem HTTPS em produção | Corrigir `PRINT_API_URL`. |
| `PRINT_AGENT_TOKEN deve ter ao menos 32 caracteres` | Token ausente ou curto | Gerar segredo forte e configurar nos dois lados. |
| `Credencial do agente invalida` | Token diferente entre servidor e Windows | Comparar os valores localmente e fazer redeploy se necessário. |
| `Porta serial COM3 nao encontrada` | Porta mudou, cabo ou driver | Executar `npm run print:agent:ports`. |
| Porta em uso | Outro programa abriu a COM | Fechar utilitários, monitor serial ou outro agente. |
| Trabalho fica em `printing` | Agente caiu após reivindicar | Verificar logs e aguardar a recuperação após dois minutos. |
| Nenhum trabalho encontrado | Fila vazia ou `KIOSK_ID` errado | Conferir emissão, banco e configuração. |
| Imprime, mas fica como falha | Confirmação HTTP caiu após a impressão | Conferir o papel, o journal e `last_error` antes de repetir. |
| Status ESC/POS não responde | Modelo não responde a `DLE EOT` | Voltar `PRINT_STATUS_CHECK_ENABLED=0`. |

## 17. Teste com o simulador

O simulador valida a fila sem Bematech física:

```powershell
$env:PRINT_API_URL="https://senhahub-mauve.vercel.app"
$env:PRINT_AGENT_TOKEN="o-mesmo-token-do-servidor"
$env:KIOSK_ID="totem-pompeia-01"
npm run print:simulate -- --once
```

Ele reivindica um trabalho, mostra uma representação no terminal e confirma a API. Ele não testa COM3, cabo, driver, ESC/POS real ou corte físico.

## 18. Segurança

Nunca:

- coloque `PRINT_AGENT_TOKEN` no código;
- use `NEXT_PUBLIC_*` para o token;
- envie `.env.print-agent` para o Git;
- envie `SUPABASE_SERVICE_ROLE_KEY` para o Windows;
- compartilhe logs contendo tokens;
- apague o journal sem verificar o papel;
- abra uma API local publicamente sem HTTPS e autenticação.

O agente precisa apenas de URL da API, token exclusivo, ID do totem e configuração da impressora. As tabelas e RPCs de impressão permanecem protegidas no Supabase para uso do backend.

## 19. Checklist de instalação

### Windows

- [ ] Node.js 22 instalado;
- [ ] `node --version` validado;
- [ ] projeto copiado para pasta fixa;
- [ ] `npm ci --omit=dev` concluído;
- [ ] `.env.print-agent` criado;
- [ ] token configurado sem espaços extras;
- [ ] `KIOSK_ID` correto;
- [ ] porta encontrada;
- [ ] `npm run print:agent:test` imprimiu;
- [ ] logs criados;
- [ ] tarefa automática instalada.

### Servidor e Supabase

- [ ] migration da fila aplicada;
- [ ] `print_kiosks` possui `totem-pompeia-01` ativo;
- [ ] `PRINT_AGENT_TOKEN` configurado no servidor;
- [ ] novo deploy feito depois da configuração;
- [ ] API acessível por HTTPS;
- [ ] RPCs disponíveis apenas ao backend;
- [ ] `print_jobs` criado ao emitir uma senha.

### Operação

- [ ] totem pareado;
- [ ] senha física emitida;
- [ ] job passou por `pending` e `printing`;
- [ ] papel impresso;
- [ ] job terminou em `printed`;
- [ ] senha apareceu na fila do setor;
- [ ] falha controlada testada;
- [ ] recuperação sem reimpressão indevida validada.

## 20. Ordem recomendada para estudar

1. leia este documento;
2. leia `scripts/print-agent.js` para entender o loop;
3. leia `scripts/print-agent/runtime.js` para entender configuração e journal;
4. leia `scripts/print-agent/serial-printer.js` para entender a COM3;
5. leia `server/escpos-receipt.js` para entender os bytes do cupom;
6. leia a migration `20260729154028_print_kiosk_jobs.sql` para entender a fila;
7. execute `npm run print:agent:ports`;
8. execute `npm run print:agent:test`;
9. faça um teste com o simulador;
10. faça um teste completo com o totem e a impressora real.

## 21. Arquivos relacionados

- [Guia resumido do totem](totem-impressao.md)
- [Código principal do agente](../scripts/print-agent.js)
- [Runtime do agente](../scripts/print-agent/runtime.js)
- [Comunicação serial](../scripts/print-agent/serial-printer.js)
- [Recibo ESC/POS](../server/escpos-receipt.js)
- [Serviço de sessão do totem](../server/print-kiosk-service.js)
- [Runtime Supabase](../server/supabase-runtime.js)
- [Migration da fila](../supabase/migrations/20260729154028_print_kiosk_jobs.sql)
- [Instalador Windows](../windows/print-agent/install.ps1)
