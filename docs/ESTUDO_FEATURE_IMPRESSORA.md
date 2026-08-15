# Estudo da feature de impressão

Projeto: Fila Zero Supermercado Pompeia  
Feature: totem de senhas físicas + fila de impressão + Bematech MP-4200 TH  
Status: guia técnico e operacional para estudo

## 1. Objetivo da feature

A feature permite que um cliente retire uma senha física em um computador com tela de totem. A senha entra na mesma fila operacional das senhas digitais e, ao mesmo tempo, cria um trabalho de impressão.

O sistema separa três responsabilidades:

1. o navegador do totem registra a solicitação;
2. o backend registra a senha e o trabalho de impressão;
3. um agente Windows envia o cupom para a impressora Bematech.

O navegador não acessa a porta serial diretamente. Essa separação é necessária porque navegadores comuns não devem controlar uma impressora serial local sem uma camada intermediária.

## 2. Visão geral da arquitetura

```text
Cliente
  │
  ▼
Navegador do totem em /totem
  │  HTTPS + cookie do totem + CSRF
  ▼
API do Fila Zero
  │
  ├── Produção: server/supabase-runtime.js
  │       │
  │       └── Supabase REST + RPCs
  │
  └── Local: server/server.js + SQLite

Supabase / SQLite
  ├── ticket físico
  └── print_job pendente

Agente Windows
  │  HTTPS + x-print-agent-token
  ▼
Fila de print_jobs
  │
  ▼
SerialPort → COM3 → Bematech MP-4200 TH
```

### Produção

Em produção, a API passa pelo runtime Supabase, que usa a Data API REST e as RPCs da migration de impressão. O servidor usa a chave administrativa apenas no backend; ela nunca deve chegar ao navegador.

### Ambiente local

O comando `npm run dev` usa o backend local com SQLite. O projeto mantém uma implementação equivalente da fila de impressão no `server/server.js`, permitindo testar a orquestração sem depender do banco remoto.

O simulador também pode consumir a fila local e representar a impressão no terminal. A impressora física deve ser validada contra a API que o agente Windows realmente usará.

## 3. Componentes do código

| Componente | Responsabilidade |
|---|---|
| `app/totem/page.jsx` | Entrega a página Next.js do totem e carrega os scripts. |
| `public/totem.html` | Estrutura visual: pareamento, setores, confirmação e status da impressão. |
| `public/totem.js` | Consulta status, pareia, emite senha, acompanha o `print_job` e mostra o resultado. |
| `server/print-kiosk-service.js` | Sessões do totem, CSRF, token do agente e validações comuns. |
| `server/supabase-runtime.js` | API de produção usando Supabase e RPCs. |
| `server/server.js` | API local equivalente usando SQLite. |
| `supabase/migrations/20260729154028_print_kiosk_jobs.sql` | Tabelas, índices, seed, RPCs, RLS e grants da fila física. |
| `supabase/migrations/20260729175827_index_tickets_kiosk_id.sql` | Índice para tickets associados ao totem. |
| `scripts/print-agent.js` | Processo Windows que consome a fila e confirma o resultado. |
| `scripts/print-agent/runtime.js` | Carregamento de configuração, logs e journal contra reimpressão. |
| `scripts/print-agent/serial-printer.js` | Comunicação serial ESC/POS. |
| `server/escpos-receipt.js` | Montagem dos bytes do cupom. |
| `windows/print-agent/install.ps1` | Instalação automática no Agendador de Tarefas do Windows. |
| `docs/totem-impressao.md` | Guia operacional resumido já existente. |

## 4. Fluxo completo de uma senha física

### 4.1 Verificação do totem

Ao abrir `/totem`, o navegador chama:

```text
GET /api/kiosk/status
```

A resposta informa:

- se o navegador já está pareado;
- se o usuário atual pode parear o equipamento;
- qual é o `kiosk` configurado;
- quais setores estão abertos.

Se o navegador não estiver pareado, a tela mostra a opção de login para um gestor.

### 4.2 Pareamento

Depois do login, o gestor aciona:

```text
POST /api/kiosk/pair
```

O backend:

1. verifica que o usuário tem papel de gestor;
2. verifica o token CSRF da sessão de usuário;
3. confirma o `kioskId` esperado;
4. garante que o registro do totem existe e está ativo;
5. cria uma sessão assinada do totem;
6. grava cookies `fz_kiosk` e `fz_kiosk_csrf`;
7. registra o evento de pareamento.

O cookie `fz_kiosk` contém uma credencial assinada com validade de 30 dias. O cookie CSRF separado é exigido nas operações de alteração.

### 4.3 Escolha do setor

O totem exibe somente setores abertos. Ao escolher um setor, o navegador gera uma chave de idempotência usando `crypto.randomUUID()`.

Essa chave permanece associada à emissão até que a solicitação seja concluída. Se o usuário clicar duas vezes ou a requisição for repetida, o backend consegue reconhecer que a mesma emissão já existe.

### 4.4 Criação da senha e do trabalho

O navegador envia:

```text
POST /api/kiosk/tickets
```

Com:

```json
{
  "sectorId": "acougue",
  "idempotencyKey": "uuid-gerado-pelo-navegador"
}
```

O backend exige:

- sessão válida do totem;
- token CSRF do totem no cabeçalho `x-kiosk-csrf`;
- setor existente e aberto;
- chave de idempotência entre 16 e 160 caracteres.

No Supabase, a API chama a RPC:

```text
issue_physical_ticket
```

Essa RPC executa em uma transação:

1. verifica se a chave de idempotência já foi usada;
2. bloqueia o totem com `FOR UPDATE`;
3. bloqueia o setor com `FOR UPDATE`;
4. bloqueia o contador do setor;
5. calcula o próximo número entre `000` e `999`;
6. cria o ticket com `source = 'physical'`;
7. cria o `print_job` com status `pending`;
8. coloca no payload os dados necessários para o recibo;
9. retorna ticket e trabalho de impressão.

O ticket físico possui `customer_id` e `device_id` nulos no Supabase, pois não representa um usuário autenticado. Ele usa o nome operacional `Cliente do totem`.

O ticket fica elegível para chamada automática depois de 30 segundos, conforme `AUTO_CALL_DELAY_SECONDS`.

### 4.5 Acompanhamento no totem

Depois da emissão, o navegador mostra o número da senha e consulta:

```text
GET /api/kiosk/print-jobs/:jobId
```

Enquanto o status for `pending` ou `printing`, o navegador consulta novamente a cada 1,2 segundo.

Estados exibidos:

- `pending`: aguardando a impressora;
- `printing`: imprimindo;
- `printed`: senha impressa;
- `failed`: falha de impressão.

O navegador não imprime. Ele apenas acompanha o estado salvo no backend.

## 5. Modelo de dados

### 5.1 `print_kiosks`

Representa o equipamento físico autorizado.

Campos importantes:

- `id`: identificador lógico, atualmente `totem-pompeia-01`;
- `name`: nome exibido para operação;
- `active`: permite desativar o totem sem apagar seu histórico;
- `printer_name`: nome da impressora;
- `printer_port`: porta serial, atualmente `COM3`;
- `paper_width_mm`: 58 ou 80 mm;
- `install_url`: URL HTTPS usada no QR exibido na tela;
- `last_seen_at`: último contato do agente ou do fluxo de impressão.

### 5.2 `print_jobs`

Representa cada trabalho enviado à impressora.

Campos importantes:

- `id`: identificador do trabalho;
- `ticket_id`: ticket físico relacionado;
- `kiosk_id`: totem responsável;
- `idempotency_key`: impede duplicidade na emissão;
- `status`: estado da impressão;
- `payload`: JSON com os dados do recibo;
- `attempts`: quantidade de tentativas de consumo;
- `claimed_at`: momento em que o agente assumiu o trabalho;
- `printed_at`: momento da confirmação de sucesso;
- `failed_at`: momento da última falha;
- `last_error`: última mensagem de erro;
- `created_at` e `updated_at`: auditoria temporal.

### 5.3 Máquina de estados

```text
pending ──► printing ──► printed
    ▲          │
    │          └──────► failed ──► printing
    │
    └──── trabalho printing abandonado por mais de 2 minutos
```

Regras atuais:

- `pending`: ainda não foi assumido pelo agente;
- `printing`: agente assumiu e pode estar imprimindo;
- `printed`: agente imprimiu e confirmou;
- `failed`: tentativa terminou com erro e pode ser tentada novamente;
- um trabalho `printing` abandonado por mais de 2 minutos pode ser recuperado;
- a RPC só reivindica trabalhos com menos de 5 tentativas;
- a coluna possui constraint permitindo valores de 0 a 10.

Essa diferença entre a constraint `0..10` e a regra da RPC `attempts < 5` deve ser conhecida. Se no futuro for necessário permitir cinco ou dez tentativas completas, a regra deve ser revisada de forma intencional.

## 6. Agente Windows

O agente é um processo separado do navegador e do backend. Ele executa um loop:

```text
buscar trabalho → imprimir → registrar no journal → confirmar na API → aguardar
```

### 6.1 Buscar trabalho

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

E envia o segredo no cabeçalho:

```text
x-print-agent-token: <segredo>
```

Sem o token, a API retorna `401`. Se o token não estiver configurado no servidor, retorna `503`.

A RPC `claim_next_print_job` utiliza `FOR UPDATE SKIP LOCKED`. Isso evita que dois agentes reivindiquem o mesmo trabalho ao mesmo tempo.

### 6.2 Imprimir

O agente transforma o payload em bytes ESC/POS por meio de `buildTicketReceipt()` e abre a porta serial configurada.

Configuração inicial:

```env
KIOSK_PRINTER_PORT=COM3
PRINT_SERIAL_BAUD_RATE=115200
PRINT_SERIAL_DATA_BITS=8
PRINT_SERIAL_STOP_BITS=1
PRINT_SERIAL_PARITY=none
PRINT_SERIAL_RTSCTS=0
PRINT_STATUS_CHECK_ENABLED=0
```

O agente abre a porta, escreve os bytes, aguarda o esvaziamento do buffer (`drain`), aguarda um tempo proporcional ao tamanho do recibo e fecha a porta.

### 6.3 Journal contra reimpressão

Antes de confirmar o trabalho na API, o agente grava o `jobId` em:

```text
data/print-agent/printed-jobs.log
```

Se a internet cair depois da impressão, o agente pode receber o mesmo trabalho novamente. Ao encontrar o `jobId` no journal, ele não imprime de novo; apenas tenta confirmar a conclusão na API.

Esse mecanismo protege contra o caso comum de:

```text
impressão concluída → conexão caiu → confirmação não chegou ao servidor
```

Existe uma limitação inevitável em impressoras sem confirmação transacional: se houver uma queda de energia exatamente depois do corte e antes do registro local do journal, pode ocorrer uma segunda via numa nova tentativa.

### 6.4 Logs

O agente grava:

```text
data/print-agent/print-agent.log
data/print-agent/printed-jobs.log
```

O log principal registra início, busca, impressão, falhas, tentativas e encerramento.

## 7. Recibo ESC/POS

O arquivo `server/escpos-receipt.js` gera um `Buffer` com comandos ESC/POS.

Sequência aproximada do cupom:

1. reset da impressora;
2. alinhamento centralizado;
3. nome `FILA ZERO` em destaque;
4. nome do setor em letras maiúsculas;
5. texto `SENHA`;
6. código da senha em fonte grande;
7. horário no fuso `America/Sao_Paulo`;
8. avanço de papel;
9. corte automático.

O texto é normalizado para ASCII. Isso remove acentos para evitar caracteres incompatíveis com a configuração serial da impressora.

O cupom físico atual não contém QR Code. O QR Code de instalação aparece na tela do totem e aponta para `/instalar`.

O simulador de terminal possui uma representação visual própria e pode mostrar um marcador textual de QR. Isso é apenas uma simulação; não significa que o cupom ESC/POS físico contenha QR.

## 8. Configuração do servidor

### Variáveis principais

Na Vercel ou no ambiente que hospeda a API:

```env
PUBLIC_APP_URL=https://seu-dominio
PUBLIC_INSTALL_URL=https://seu-dominio/instalar
KIOSK_ID=totem-pompeia-01
KIOSK_NAME=Totem Supermercado Pompeia
KIOSK_PRINTER_NAME=Bematech MP - 4200 TH
KIOSK_PRINTER_PORT=COM3
KIOSK_PAPER_WIDTH_MM=80
PRINT_AGENT_TOKEN=<segredo-com-no-minimo-32-caracteres>
```

O `PRINT_AGENT_TOKEN` configurado no servidor deve ser exatamente o mesmo usado no `.env.print-agent` do Windows. Ele não deve ser enviado para o frontend nem commitado.

### Configuração do agente

No computador Windows, criar `.env.print-agent` a partir de `.env.print-agent.example`:

```env
PRINT_API_URL=https://seu-dominio
PRINT_AGENT_TOKEN=<mesmo-segredo-do-servidor>
KIOSK_ID=totem-pompeia-01
KIOSK_PRINTER_PORT=COM3
```

O agente real exige URL HTTPS. Para apontar para `http://localhost`, use o simulador ou um ambiente de teste explicitamente controlado.

## 9. Instalação e operação no Windows

### Pré-requisitos

- Windows 10 ou superior, 64 bits;
- projeto copiado para uma pasta fixa;
- impressora instalada e visível como porta serial;
- driver ou conversor USB/serial funcionando;
- modo ESC/POS configurado na Bematech;
- acesso HTTPS de saída até a API;
- arquivo `.env.print-agent` criado e protegido.

### Descobrir a porta

```powershell
npm run print:agent:ports
```

O resultado deve mostrar a porta que corresponde à Bematech. Se não for `COM3`, ajustar `KIOSK_PRINTER_PORT` no arquivo do agente e também a configuração do servidor.

### Imprimir um cupom de diagnóstico

```powershell
npm run print:agent:test
```

Esse comando não depende de um `print_job` pendente. Ele envia diretamente um cupom de teste para a impressora.

### Instalar inicialização automática

Abrir o PowerShell como administrador:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\windows\print-agent\install.ps1
```

O script:

1. executa `npm ci --omit=dev`;
2. restringe a leitura do `.env.print-agent`;
3. cria uma tarefa no Agendador do Windows;
4. executa o agente como `SYSTEM`;
5. configura reinício automático;
6. inicia o agente.

Para remover:

```powershell
.\windows\print-agent\uninstall.ps1
```

## 10. Pareamento e operação do totem

### Parear

1. abrir `https://seu-dominio/totem` no computador do totem;
2. aguardar a consulta de status;
3. entrar como gestor quando solicitado;
4. clicar em **Vincular este totem**;
5. confirmar que aparecem os setores abertos;
6. manter esse navegador dedicado ao equipamento.

O pareamento fica guardado nos cookies do navegador. Se os cookies forem apagados, o equipamento deve ser pareado novamente.

### Emitir e imprimir

1. selecionar um setor;
2. confirmar a emissão;
3. conferir o número exibido na tela;
4. confirmar o estado `Aguardando a impressora`;
5. confirmar a mudança para `Imprimindo sua senha`;
6. retirar o cupom;
7. confirmar o estado `Senha impressa`;
8. verificar que a senha entrou na fila do setor.

## 11. Diagnóstico de problemas

| Sintoma | Causa provável | Verificação |
|---|---|---|
| Totem informa “não vinculado” | Cookies ausentes ou sessão expirada | Abrir `/totem` e refazer o pareamento. |
| Botão de pareamento não aparece | Usuário sem papel de gestor | Conferir o perfil e fazer login novamente. |
| API responde `401` ao emitir | Cookie do totem ou CSRF inválido | Recarregar a página e parear novamente. |
| API responde `401` no agente | Token diferente entre servidor e Windows | Comparar somente os valores localmente, sem publicá-los. |
| API responde `503` no agente | `PRINT_AGENT_TOKEN` ausente ou curto no servidor | Configurar token com pelo menos 32 caracteres. |
| Nenhum trabalho é encontrado | Nenhum `print_job` pendente ou `KIOSK_ID` incorreto | Conferir o setor, o `kioskId` e a tabela `print_jobs`. |
| Trabalho fica em `printing` | Agente caiu ou perdeu conexão | Aguardar mais de 2 minutos e verificar se ele foi recuperado. |
| `COM3` não encontrada | Porta mudou, driver ausente ou cabo desconectado | Executar `print:agent:ports` e conferir o Gerenciador de Dispositivos. |
| Porta em uso | Outro programa abriu a COM3 | Fechar software da Bematech ou monitor serial. |
| Impressora não imprime | Modo, baud rate ou parâmetros seriais incorretos | Conferir autoteste e testar `print:agent:test`. |
| Status ESC/POS não responde | Impressora não suporta ou não está configurada para DLE EOT | Manter status check desligado até validar o protocolo. |
| Imprime, mas fica como falha | Confirmação HTTP falhou após a impressão | Verificar o journal antes de tentar reimprimir. |
| Reimprime após queda de energia | Queda ocorreu antes do journal local | Registrar como limitação operacional e conferir o papel antes de uma nova tentativa. |

## 12. Roteiro de testes

### 12.1 Testes automatizados já existentes

```bash
npm run check
npm test
```

Os testes existentes cobrem:

- geração do cupom ESC/POS;
- ausência de QR no cupom físico;
- idempotência do trabalho;
- journal contra reimpressão;
- consulta de status ESC/POS;
- falha da impressora;
- queda da confirmação da API;
- emissão física local;
- emissão física concorrente;
- proteção do agente por token.

### 12.2 Teste local sem impressora

1. iniciar o projeto local;
2. abrir `/totem`;
3. parear com um usuário de teste;
4. emitir uma senha;
5. configurar `PRINT_API_URL=http://localhost:3000` no simulador;
6. executar:

```bash
npm run print:simulate -- --once
```

7. confirmar que o trabalho muda de `pending` para `printed`.

Esse teste valida a fila, mas não valida porta serial nem a Bematech.

### 12.3 Teste com API Supabase e impressora real

1. confirmar que as migrations da fila estão aplicadas;
2. confirmar que o seed `totem-pompeia-01` existe;
3. configurar o `PRINT_AGENT_TOKEN` na hospedagem;
4. configurar o mesmo token no Windows;
5. testar a porta e imprimir o cupom de diagnóstico;
6. parear o totem;
7. emitir uma senha física;
8. acompanhar a linha em `print_jobs`;
9. conferir a impressão;
10. verificar `status = 'printed'` e `printed_at` preenchido.

### 12.4 Teste de falha

Executar de forma controlada:

- desligar a impressora antes de uma emissão;
- desconectar a rede depois que o agente reivindicar o trabalho;
- reiniciar o agente enquanto o trabalho estiver em `printing`;
- corrigir a conexão e observar a recuperação;
- confirmar que o journal impede uma segunda impressão quando já houve sucesso físico.

Não testar falhas destrutivas em horário de operação sem um procedimento de recuperação definido.

## 13. Segurança

### Totem

- sessão assinada com `AUTH_SECRET`;
- cookie principal `HttpOnly`;
- `SameSite=Strict`;
- `Secure` em produção;
- CSRF separado para operações do totem;
- emissão bloqueada sem pareamento válido.

### Agente

- token exclusivo no cabeçalho `x-print-agent-token`;
- token com pelo menos 32 caracteres;
- arquivo `.env.print-agent` protegido no Windows;
- agente sem acesso direto do navegador à serial;
- somente HTTPS em produção.

### Supabase

A migration atual:

- habilita RLS em `print_kiosks` e `print_jobs`;
- revoga acesso de `PUBLIC`, `anon` e `authenticated`;
- concede acesso às tabelas somente a `service_role`;
- revoga execução pública das RPCs;
- concede execução das RPCs somente a `service_role`;
- usa RPCs com `security invoker` e `search_path` vazio.

Isso mantém a fila física como recurso interno do servidor. O frontend nunca deve receber a `service_role` key.

Referência: [segurança da Data API do Supabase](https://supabase.com/docs/guides/api/securing-your-api.md).

## 14. O que está pronto e o que falta validar

### Implementado no código

- cadastro do totem;
- pareamento com sessão assinada;
- emissão física idempotente;
- criação transacional de ticket e trabalho;
- fila persistente;
- reivindicação concorrente com `SKIP LOCKED`;
- recuperação de trabalho abandonado;
- agente Windows;
- comunicação serial ESC/POS;
- journal local;
- confirmação de sucesso/falha;
- simulador local;
- testes automatizados da lógica principal.

### Ainda precisa de validação operacional

- confirmar a migration no projeto Supabase correto;
- confirmar a configuração real do `PRINT_AGENT_TOKEN`;
- confirmar a porta da impressora no Windows;
- realizar impressão física com papel de 80 mm;
- validar corte automático;
- validar tampa aberta e falta de papel;
- testar reinício do Windows;
- testar queda e recuperação da internet;
- validar operação contínua durante um turno;
- registrar métricas de trabalhos pendentes, falhos e tempo de impressão.

## 15. Glossário

| Termo | Significado |
|---|---|
| Totem | Computador/tela usado pelo cliente para retirar senha física. |
| Kiosk | Identidade lógica do totem no sistema. |
| `print_job` | Trabalho persistido que representa uma impressão. |
| Agente | Processo Windows que consome a fila e fala com a impressora. |
| ESC/POS | Conjunto de comandos de texto, formatação, avanço e corte usado por impressoras térmicas. |
| Idempotência | Repetir uma mesma solicitação sem criar uma segunda senha/trabalho. |
| Claim | Ação de reivindicar um trabalho para iniciar a impressão. |
| Journal | Registro local de trabalhos já impressos. |
| `DLE EOT` | Comando ESC/POS usado para consultar status da impressora. |
| RLS | Row Level Security do PostgreSQL/Supabase. |

## 16. Arquivos para leitura em ordem

1. [docs/totem-impressao.md](totem-impressao.md)
2. [public/totem.js](../public/totem.js)
3. [server/print-kiosk-service.js](../server/print-kiosk-service.js)
4. [supabase/migrations/20260729154028_print_kiosk_jobs.sql](../supabase/migrations/20260729154028_print_kiosk_jobs.sql)
5. [server/supabase-runtime.js](../server/supabase-runtime.js)
6. [scripts/print-agent.js](../scripts/print-agent.js)
7. [scripts/print-agent/serial-printer.js](../scripts/print-agent/serial-printer.js)
8. [server/escpos-receipt.js](../server/escpos-receipt.js)
9. [windows/print-agent/install.ps1](../windows/print-agent/install.ps1)

## 17. Próxima prática recomendada

Antes de alterar o código, executar um ensaio controlado:

1. usar um setor de teste;
2. parear um computador autorizado;
3. emitir uma única senha;
4. acompanhar o registro em `print_jobs`;
5. executar o simulador;
6. repetir com o agente real;
7. comparar o estado do banco, o log do agente e o papel impresso.

O objetivo é aprender a acompanhar a mesma operação pelos quatro pontos de observação: tela do totem, API, banco e impressora.
