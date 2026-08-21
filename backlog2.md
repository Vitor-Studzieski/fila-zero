# Backlog 2 — Ondas e Sprints

> Backlog organizado por ondas funcionais. Cada onda representa uma área do sistema e cada sprint representa uma entrega específica.

## Objetivo

Simplificar o fluxo do atendente, melhorar a experiência do cliente, modernizar o totem e transformar a TV em um canal de comunicação e divulgação.

## Status do backlog

- **Status inicial:** A fazer
- **Prioridade:** P0 — execução do Backlog 2
- **Critério geral:** cada sprint deve ser validada no ambiente correspondente antes de avançar para a próxima.

---

## Onda 1 — Tela do atendente

### Sprint 1.1 — Fila simples e chamada da próxima senha

**Objetivo:** deixar a tela do atendente objetiva, com apenas a ação principal.

**Entregas:**

- Exibir a fila de forma simples.
- Manter somente um botão principal: **“Chamar próxima senha”**.
- Remover elementos desnecessários da interface.

**Critérios de aceite:**

- O atendente consegue chamar a próxima senha com um único botão.
- A senha chamada não é repetida na próxima ação.
- A tela permanece utilizável após várias chamadas consecutivas.

**Esforço estimado:** P — Pequeno.

### Sprint 1.2 — Remover status “em andamento”

**Objetivo:** fazer com que o atendente apenas chame a senha, sem controlar o andamento do atendimento.

**Entregas:**

- Remover o status ou etapa **“em andamento”** da tela do atendente.
- Não exigir início, pausa ou finalização de atendimento pelo atendente.
- Manter somente o registro necessário da chamada.

**Critérios de aceite:**

- O atendente não precisa alterar o status do atendimento.
- Após chamar uma senha, pode chamar outra diretamente.
- O sistema mantém controle para evitar chamadas duplicadas.

**Esforço estimado:** P/M — Pequeno para médio.

### Sprint 1.3 — Chamar múltiplos atendimentos

**Objetivo:** permitir chamadas sucessivas sem bloquear o atendente em um único atendimento.

**Entregas:**

- Permitir chamar múltiplas senhas em sequência.
- Registrar o histórico das senhas chamadas.
- Garantir que uma mesma senha não seja chamada novamente por engano.

**Critérios de aceite:**

- O atendente consegue chamar várias senhas consecutivamente.
- Cada chamada gera um registro/evento próprio.
- A fila é atualizada após cada chamada.

**Esforço estimado:** M/G — Médio para grande.

### Sprint 1.4 — Destacar nome e número da senha

**Objetivo:** dar destaque imediato ao cliente chamado.

**Entregas:**

- Destacar visualmente o nome do cliente.
- Destacar o número da senha.
- Exibir o tipo da senha: preferencial ou comum.
- Definir duração ou condição para remover o destaque.

**Critérios de aceite:**

- O nome e o número ficam claramente visíveis após a chamada.
- O destaque é atualizado corretamente na chamada seguinte.
- O destaque não apresenta dados da senha anterior.

**Esforço estimado:** P/M — Pequeno para médio.

### Sprint 1.5 — Regra de prioridade da fila

**Objetivo:** aplicar a regra de duas senhas preferenciais para uma senha comum.

**Regra de negócio:**

> Preferencial, preferencial, comum.

**Entregas:**

- Implementar o ciclo de prioridade `2 preferenciais : 1 comum`.
- Respeitar a ordem de chegada dentro de cada fila.
- Chamar a fila disponível quando uma das categorias estiver vazia.
- Evitar que a fila comum fique indefinidamente sem atendimento.

**Critérios de aceite:**

- Com as duas filas cheias, a sequência segue preferencial, preferencial e comum.
- Com uma fila vazia, o sistema chama a fila que possui senhas.
- A sequência permanece correta após várias chamadas.
- A regra é validada com testes de filas cheias, vazias e alternadas.

**Esforço estimado:** G — Grande.

---

## Onda 2 — Tela da TV

### Sprint 2.1 — Clima ao lado do horário ✅

**Objetivo:** exibir o clima junto das informações de horário na TV.

**Entregas:**

- Adicionar o clima ao lado do horário.
- Exibir temperatura e condição climática.
- Definir cidade/localidade e unidade de temperatura.
- Criar fallback quando o serviço de clima estiver indisponível.

**Critérios de aceite:**

- Horário e clima aparecem alinhados e legíveis.
- As informações são atualizadas automaticamente.
- A TV continua funcionando mesmo sem resposta do serviço externo.

**Esforço estimado:** M — Médio.

**Status:** concluída na tela de TV. O clima usa Pompéia/SP, exibe temperatura em °C, condição atualiza a cada 25 minutos e mostra fallback sem interromper a fila quando o serviço externo falha.

### Sprint 2.2 — Estrutura para vídeos promocionais ✅

**Objetivo:** preparar a TV para reproduzir vídeos promocionais e de divulgação utilizados pela Júlia nas redes sociais.

**Entregas:**

- Criar estrutura de vídeos e playlist.
- Permitir definir ordem de reprodução.
- Permitir ativar e desativar materiais.
- Reproduzir vídeos automaticamente em loop.
- Tratar vídeos indisponíveis ou com erro.
- Considerar vídeos verticais e horizontais no layout.

**Critérios de aceite:**

- A TV reproduz a playlist sem intervenção manual.
- Um vídeo com erro não interrompe toda a programação.
- É possível substituir ou reorganizar os vídeos.

**Esforço estimado:** G — Grande.

**Status:** estrutura concluída. A playlist fica em `public/data/tv-playlist.json`, aceita ordem, ativação, vídeos horizontais/verticais, embeds do Instagram, loop automático e isolamento de erros por vídeo. O primeiro conteúdo configurado usa o embed oficial do post informado, sem baixar ou versionar o vídeo.

---

## Onda 3 — Tela de atendimento do cliente

### Sprint 3.1 — Atendimento normal e atendimento

**Objetivo:** revisar e padronizar o fluxo visual entre atendimento normal e atendimento.

**Contexto atual:** a senha de atendimento normal já foi impressa.

**Entregas:**

- Confirmar a diferença entre **“atendimento normal”** e **“atendimento”**.
- Revisar textos, estados e mensagens exibidas ao cliente.
- Manter o fluxo de impressão já existente para a senha normal.

**Critérios de aceite:**

- O cliente entende claramente o tipo de atendimento selecionado.
- O fluxo normal continua imprimindo corretamente.
- Não há alteração indevida no fluxo já validado.

**Esforço estimado:** P/M — Pequeno para médio.

### Sprint 3.2 — Marca d’água no atendimento preferencial de acessibilidade

**Objetivo:** aplicar a nova identidade visual nos atendimentos preferenciais de acessibilidade.

**Entregas:**

- Aplicar a nova logo como marca d’água.
- Utilizar a marca somente no fluxo preferencial de acessibilidade.
- Ajustar posição, transparência e tamanho para preservar a leitura.

**Critérios de aceite:**

- A nova marca aparece corretamente no atendimento definido.
- A marca não cobre nome, senha ou instruções.
- O fluxo normal não recebe a alteração por engano.

**Esforço estimado:** P — Pequeno.

---

## Onda 4 — Totem

### Sprint 4.1 — Remover tela de confirmação

**Objetivo:** reduzir etapas e tornar a emissão da senha mais rápida.

**Entregas:**

- Retirar a tela intermediária de confirmação.
- Direcionar o cliente diretamente para a próxima etapa do fluxo.
- Validar impressão ou geração da senha sem acionamento duplicado.

**Critérios de aceite:**

- A tela de confirmação não é mais exibida.
- O cliente consegue concluir a emissão com menos etapas.
- Um toque não gera duas senhas.

**Esforço estimado:** P — Pequeno.

### Sprint 4.2 — Reestruturar tela de múltipla escolha

**Objetivo:** melhorar a seleção do tipo de atendimento no totem.

**Entregas:**

- Reorganizar as opções de atendimento.
- Melhorar hierarquia visual, textos e tamanho dos botões.
- Reduzir dúvidas e cliques desnecessários.
- Preparar a estrutura para novos tipos de atendimento.

**Critérios de aceite:**

- As opções principais ficam claras para o cliente.
- Os botões funcionam corretamente em tela touch.
- A seleção encaminha para o fluxo correto.
- A estrutura permite inclusão de novas opções sem refazer toda a tela.

**Esforço estimado:** M — Médio.

---

## Onda 5 — Bipar QR Code

### Sprint 5.1 — Nova tela após bipar QR Code

**Objetivo:** revisar a experiência do cliente imediatamente após a leitura do QR Code.

**Entregas:**

- Alterar a tela exibida após o QR Code ser bipado.
- Definir mensagem de leitura realizada com sucesso.
- Criar tratamento para QR Code inválido.
- Criar tratamento para QR Code expirado.
- Criar tratamento para QR Code já utilizado.
- Exibir erro de comunicação quando necessário.
- Disponibilizar opção de tentar novamente.
- Retornar ao início após tempo definido.

**Critérios de aceite:**

- Cada resultado da leitura apresenta uma mensagem adequada.
- O cliente sabe o que fazer em caso de erro.
- O fluxo não fica travado após uma leitura inválida.
- O totem retorna ao estado inicial automaticamente quando necessário.

**Esforço estimado:** M/G — Médio para grande.

---

## Ordem sugerida de execução dentro do Backlog 2

1. Sprint 3.2 — Nova marca d’água.
2. Sprint 4.1 — Remover confirmação do totem.
3. Sprint 1.1 — Fila simples e botão principal.
4. Sprint 1.2 — Remover status “em andamento”.
5. Sprint 1.4 — Destacar nome e número da senha.
6. Sprint 3.1 — Revisar atendimento normal/atendimento.
7. Sprint 2.1 — Adicionar clima à TV.
8. Sprint 4.2 — Reestruturar múltipla escolha do totem.
9. Sprint 5.1 — Alterar fluxo do QR Code.
10. Sprint 1.3 — Permitir chamadas múltiplas.
11. Sprint 1.5 — Aplicar regra 2 preferenciais para 1 comum.
12. Sprint 2.2 — Criar estrutura de vídeos promocionais.
13. Testes integrados de todas as ondas.

## Pontos pendentes de contexto

- “Chamar múltiplos atendimentos” significa chamadas sequenciais ou vários atendentes simultâneos?
- O destaque da senha deve aparecer somente no atendente ou também na TV?
- Qual cidade/localidade e fonte serão usadas para o clima?
- Os vídeos serão enviados por tela administrativa, pasta do sistema ou armazenamento externo?
- Qual é o arquivo da nova logo/marca d’água?
- Qual deve ser exatamente a tela após cada resultado do QR Code?
- Quais opções devem aparecer na nova tela de múltipla escolha do totem?
- Qual é a diferença funcional entre **atendimento normal** e **atendimento**?

## Definition of Done

- Todas as sprints concluídas e validadas na respectiva onda.
- Todos os fluxos principais funcionam sem duplicidade de chamadas ou emissões.
- A regra de prioridade foi validada com filas cheias e vazias.
- As telas funcionam nos ambientes de atendente, TV, cliente e totem.
- Estados de erro e fallback foram testados.
- A nova marca foi aplicada sem prejudicar a leitura.
- O fluxo completo foi validado de ponta a ponta.
