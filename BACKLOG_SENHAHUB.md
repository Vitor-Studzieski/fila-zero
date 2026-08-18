# Backlog centralizado — SenhaHub

Atualizado em: 18/08/2026

Este é o único documento para acompanhar tarefas do projeto. Use `[ ]` para pendente e `[x]` para concluído. Os demais documentos descrevem funcionamento, decisões e procedimentos; eles não devem receber novos checklists de tarefas.

## Base já entregue

- [x] Login, perfis, permissões básicas e revogação de sessões.
- [x] Recuperação e troca de senha com senha forte.
- [x] Filas digitais, chamadas, espera inteligente e métricas diárias.
- [x] Totem Central e Totem específico por setor.
- [x] Atendimento normal, preferencial e categorias preferenciais.
- [x] QR Code geral e QR Code individual de acompanhamento.
- [x] Atualização da fila e acompanhamento da senha.
- [x] Fila de impressão idempotente, simulador e agente Windows inicial.
- [x] Cron da Vercel protegido por `CRON_SECRET`.
- [x] URLs de produção atualizadas para `senhahub.vercel.app`.
- [x] GitHub, Vercel, testes automatizados e build de produção configurados.

## Alterações concluídas no ciclo atual

- [x] Renomeação completa de Fila Zero para SenhaHub no código, telas, assets, documentação, testes e configurações.
- [x] Remoção do sufixo `mauve` do domínio público da Vercel.
- [x] Ajustes visuais da Dashboard ICCF, incluindo campos, bordas, linhas delimitadoras e hierarquia visual.
- [x] Ajustes visuais do Totem, incluindo cards, alinhamento dos textos, frases de espera, setas, cores e QR Code.
- [x] PWA instalável, Service Worker, cache offline e infraestrutura de Web Push implementados.
- [x] Reset diário das filas e registro de métricas por dia implementados.
- [x] Agente de impressão, fila física, QR Codes e impressão na Bematech implementados.
- [x] Tela de login atualizada com orientações sobre criação, troca e recuperação de senha.
- [x] Política gratuita de senhas implementada no SQLite e no Supabase: força mínima, bloqueio de senhas comuns e consulta HIBP por k-anonymity.
- [x] JSON inválido passou a retornar HTTP `400` nos runtimes SQLite e Supabase.
- [x] Variáveis da política de senha adicionadas ao `.env.example` e documentação do fluxo adicionada ao `README.md`.
- [x] Testes unitários da política de senha adicionados.
- [x] Build de produção e checagem sintática aprovados.
- [x] Suíte completa executada fora do sandbox: 63/63 testes aprovados.
- [x] Testes de autenticação, filas, concorrência local, atendimento, preferencial, impressão, HIBP, JSON inválido e Web Push aprovados.
- [x] Supabase remoto conferido: tabelas principais existentes, RLS habilitado, Totem ativo e URLs de produção corretas.
- [x] Backlog centralizado criado e documentos antigos de tarefas removidos.
- [x] Demonstração técnica e registro de validação do produto documentados em [docs/INOVASKILL_VALIDACAO.md](docs/INOVASKILL_VALIDACAO.md).

## P0 — Produção e operação

- [ ] Configurar e validar SMTP de produção, remetente, SPF, DKIM, DMARC e redirects de recuperação.
- [x] Implementar proteção contra senhas vazadas fora do Supabase Pro, com validação de força, bloqueio de senhas comuns e consulta HIBP por k-anonymity no servidor.
- [ ] Corrigir e validar o `DATABASE_URL` para CLI, migrations e backups.
- [ ] Reconciliar o histórico de migrations do Supabase remoto com os arquivos locais e atualizar o guia de setup quando necessário.
- [x] Renomear o nome de exibição do projeto Supabase de `Fila_zero` para `SenhaHub`.
- [x] Configurar definitivamente o agente Windows com `PRINT_AGENT_TOKEN`, `KIOSK_ID` e porta da impressora.
- [x] Parear o Totem real e executar uma emissão até a impressão física.
- [ ] Validar papel de 80 mm, corte automático, tampa aberta e falta de papel no hardware real.
- [ ] Testar reinício do Windows, queda de internet e retomada sem reimpressão indevida.
- [ ] Validar a operação contínua durante um turno real.

## P1 — Produto e experiência

- [x] Ajustar a nova estrutura visual da Dashboard ICCF, incluindo campos, linhas delimitadoras e hierarquia dos indicadores.
- [x] Ajustar a padronização visual do Totem, incluindo alinhamento, posicionamento, cores, setas e QR Code.
- [x] Alterar a sequência do atendimento no Totem: atendimento deve ser a etapa 1 e setor deve ser a etapa 2.
- [ ] Trocar as logos do atendimento preferencial no Totem pelas versões corretas, mantendo a identificação visual clara e consistente.
- [ ] Validar a acessibilidade do Totem em todas as etapas.
- [ ] Validar o fluxo completo Central e Específico com usuários reais.
- [ ] Implantar Kiosk Mode para bloquear navegador, configurações e acesso ao sistema operacional.
- [ ] Criar acesso administrativo protegido para manutenção e configuração do Totem.
- [x] Garantir que toda emissão impressa tenha layout final, QR Code individual ou do conjunto e tratamento de erro compreensível.
- [x] Agrupar duas ou mais senhas do mesmo pedido no mesmo cupom físico, mantendo um único QR Code.

## P1 — Gestão e regras de negócio

- [ ] Completar CRUD granular de setores e permissões.
- [ ] Definir o comportamento ao fechar um setor com fila ativa.
- [ ] Validar a regra operacional de atendimento preferencial e registrar auditoria da classificação.
- [ ] Expandir o ICCF com filtros, período selecionável e exportação.
- [ ] Adicionar MFA aos perfis administrativos.

## P1 — Confiabilidade da API e dados

- [ ] Aplicar idempotência a todas as mutações digitais, além do fluxo do Totem.
- [x] Investigar e corrigir o lag do botão `Chamar próxima senha`, garantindo resposta rápida, feedback de processamento e prevenção de chamadas duplicadas.
- [ ] Padronizar códigos HTTP, mensagens e formato de erros.
- [x] Rejeitar JSON inválido com resposta `400`.
- [ ] Adicionar constraints e invariantes restantes no schema legado.
- [ ] Reduzir a duplicação entre os backends SQLite e Supabase.
- [ ] Evoluir `print_jobs` para worker persistente quando o volume real exigir processamento contínuo.

## P1 — Observabilidade

- [x] Criar monitoramento e alertas para falhas do Cron.
- [x] Registrar início, fim, duração e resultado de cada execução agendada.
- [x] Adicionar `request ID`, logs estruturados, métricas e alertas operacionais.
- [x] Registrar métricas de trabalhos de impressão pendentes, falhos, reprocessados e tempo de impressão.

## P2 — Qualidade e validação

- [ ] Criar testes E2E autenticados para Safari/iPhone e Android.
- [ ] Executar teste de concorrência diretamente contra o Supabase.
- [ ] Testar o agente com impressora desconectada e retomada da fila.
- [ ] Executar auditoria de acessibilidade.
- [ ] Validar PWA, instalação, modo offline, atualização do Service Worker e Web Push em dispositivos reais; a infraestrutura e os testes automatizados já estão aprovados.
- [ ] Validar em ambiente real os fluxos de cadastro, troca e recuperação de senha com a consulta HIBP ativa.
- [ ] Confirmar o fluxo de recuperação de senha em produção, incluindo revogação das sessões antigas.

## P2 — LGPD e segurança

- [x] Proteger rotas sensíveis contra acesso direto por URL, arquivos HTML legados, barra final e tela de vinculação do Totem sem sessão autorizada.
- [ ] Revisar os alertas do Supabase Advisor sobre tabelas RLS sem policies e proteção nativa de senhas vazadas desativada.
- [ ] Mapear todos os dados pessoais coletados, armazenados e utilizados.
- [ ] Definir finalidade, aviso e aceite de privacidade nas telas que coletam dados.
- [ ] Criar exportação dos dados do titular por e-mail ou CPF.
- [ ] Criar exclusão ou anonimização dos dados sem quebrar o histórico obrigatório.
- [ ] Mapear serviços externos que recebem dados e os países de processamento.
- [ ] Publicar política de privacidade baseada no funcionamento real do sistema.
- [ ] Criar canal de contato de privacidade.

## P2 — InovaSkill e validação do produto

- [x] Preparar a apresentação do SenhaHub.
- [x] Demonstrar Totem Central, Totem específico, atendimento preferencial, impressão, QR Code e acompanhamento.
- [x] Criar formulário de feedback dos testes.
- [x] Executar a demonstração completa: Totem → senha → QR Code → celular → chamada → atendimento.
- [x] Consolidar as evidências técnicas e registrar o resultado da validação.
- [ ] Coletar feedback preenchido por usuários reais e transformar os achados em novas tarefas neste backlog.

## Regra de manutenção

Toda nova tarefa deve ser adicionada aqui. Antes de criar uma tarefa, procurar neste arquivo para evitar duplicidade. Ao concluir uma tarefa, marcar somente o checkbox correspondente e registrar detalhes técnicos no documento de referência apropriado.
