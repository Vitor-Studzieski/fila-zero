# InovaSkill — validação do SenhaHub

Atualizado em: 16/08/2026

Este documento registra a demonstração técnica, os resultados dos testes e o modelo de feedback do ciclo de validação do SenhaHub.

## Evidências técnicas

- `npm test`: 53/53 testes aprovados, incluindo autenticação, filas, concorrência local, atendimento preferencial, Totem, impressão, QR Code, HIBP, JSON inválido e Web Push.
- `npm run check`: checagem sintática aprovada.
- `npm run build`: build de produção aprovado.
- `tests/orchestration.test.js`: fluxo de emissão física e atendimento concluído sem duplicação.
- `tests/print-agent.test.js`: cupom ESC/POS, corte, porta serial, falhas do agente e prevenção de reimpressão.
- `tests/pwa.test.js`: inscrição, preferências, revogação, payload e Service Worker do Web Push.

## Demonstração dos fluxos

### Totem Central

1. Abrir `/totem`.
2. Parear o equipamento com um gestor.
3. Exibir os setores abertos.
4. Escolher Açougue, Frios ou Padaria.
5. Escolher atendimento normal ou preferencial.
6. Confirmar a emissão.
7. Exibir o número, o QR Code individual e o link de acompanhamento.

### Totem específico

Configuração utilizada:

```env
KIOSK_MODE=sector
KIOSK_SECTOR_ID=acougue
```

Nesse modo, o Totem abre diretamente no setor configurado e rejeita emissões para outros setores.

### Demonstração completa

O fluxo completo validado pelo teste de integração é:

```text
Totem → pareamento → emissão de senha → QR Code → acompanhamento no celular
→ fila do atendente → chamada → confirmação do atendimento → finalização
```

O teste também confirma emissão preferencial, idempotência da emissão, criação do trabalho de impressão, retirada pelo agente e atualização do status para `printed`.

## Formulário de feedback

Para cada participante, registrar:

- Nome ou identificação do participante.
- Data, dispositivo e navegador utilizados.
- Fluxo testado.
- O que funcionou corretamente.
- Onde houve dúvida ou erro.
- Sugestão de melhoria.
- Gravidade: baixa, média ou alta.
- Evidência: print, vídeo, rota ou descrição.
- Status: aberto, em análise ou resolvido.

## Consolidação do ciclo

### Confirmado tecnicamente

- Emissão de senha pelo Totem.
- Atendimento normal e preferencial.
- Impressão e QR Code individual.
- Acompanhamento da senha.
- Chamada, confirmação e finalização do atendimento.
- Proteção contra emissão duplicada.

### Feedback externo

Nenhum novo formulário preenchido por usuário real foi disponibilizado neste ciclo. Portanto, não há achados de usuários para transformar em novas tarefas sem inventar feedback.

Quando os formulários forem preenchidos, os achados devem ser adicionados ao `BACKLOG_SENHAHUB.md`, evitando criar listas paralelas.

