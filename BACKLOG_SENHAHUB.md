# Backlog centralizado — SenhaHub

Atualizado em: 19/08/2026

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

## Migração para PostgreSQL local — software concluído

- [x] Adaptador local PostgreSQL com pool, transações e health check `/api/ready`.
- [x] Rotas locais de autenticação, sessões, CSRF, fila, carrinho, atendimento, totem, impressão e Web Push.
- [x] Aliases da aplicação configuráveis para substituir os caminhos operacionais sem alterar as telas.
- [x] Autorização por perfil/setor, cadastro público bloqueado por padrão em produção e revogação de sessões.
- [x] Manutenção automática local: sessões expiradas, reset diário de filas, ausência no atendimento e standby.
- [x] Preflight local: tabelas, RLS, funções, papéis, permissões, conexão e variáveis de produção.
- [x] Backup PostgreSQL criptografado com roles separados, verificação de integridade e restauração idempotente em base de teste.
- [x] Script seguro para provisionar ou atualizar gestor local sem armazenar senha no código.
- [x] Modelos systemd, timer de backup e proxy HTTPS para o servidor interno.
- [x] Build, checagem sintática, preflight local, teste integrado do Totem e ensaio real de backup/restauração validados.

## P0 — Produção e operação

- [ ] Configurar e validar SMTP de produção, remetente, SPF, DKIM, DMARC e redirects de recuperação.
- [x] Implementar proteção contra senhas vazadas fora do Supabase Pro, com validação de força, bloqueio de senhas comuns e consulta HIBP por k-anonymity no servidor.
- [ ] Corrigir e validar o `DATABASE_URL` para CLI, migrations e backups.
- [x] Criar scripts locais de backup e restauração criptografados com AES-256-GCM, sem contratar serviço pago e sem versionar dumps ou chaves.
- [ ] Executar backup real, copiar a cópia criptografada para destino externo e testar a restauração em projeto Supabase separado.
- [ ] Reconciliar o histórico de migrations do Supabase remoto com os arquivos locais e atualizar o guia de setup quando necessário.
- [x] Renomear o nome de exibição do projeto Supabase de `Fila_zero` para `SenhaHub`.
- [x] Configurar definitivamente o agente Windows com `PRINT_AGENT_TOKEN`, `KIOSK_ID` e porta da impressora.
- [x] Parear o Totem real e executar uma emissão até a impressão física.
- [ ] Validar papel de 80 mm, corte automático, tampa aberta e falta de papel no hardware real.
- [ ] Testar reinício do Windows, queda de internet e retomada sem reimpressão indevida.
- [ ] Validar a operação contínua durante um turno real.

## Onda 09 — P0 — Rede local, nuvem e continuidade

Objetivo: construir e validar uma arquitetura híbrida para o SenhaHub, conectando a operação local do supermercado à nuvem com segurança, tolerância a falhas e sem contratar serviços pagos. A solução deve priorizar recursos já disponíveis, camadas gratuitas e componentes open source; qualquer aquisição física necessária deve ser tratada separadamente e somente com aprovação. Referências: [arquitetura local + nuvem](docs/ARQUITETURA_LOCAL_NUVEM.md) e [infraestrutura técnica local](docs/INFRAESTRUTURA_TECNICA_LOCAL.md).

- [ ] Sprint 62/70 — Planejar a arquitetura híbrida, inventariar equipamentos, serviços, pontos de rede, dependências, custos evitados e responsáveis, definindo o que permanece local e o que fica na nuvem.
- [ ] Sprint 63/70 — Desenhar a rede local com topologia, plano de endereçamento IP, DHCP, DNS, gateway, firewall, Wi-Fi, switch, reserva de endereços e procedimento de configuração e recuperação.
- [ ] Sprint 64/70 — Segmentar a rede por função, isolando Totem, impressora/agente, estações administrativas, servidores locais, dispositivos de manutenção e visitantes, usando VLANs ou sub-redes/SSIDs separados quando o equipamento permitir.
- [ ] Sprint 65/70 — Preparar a operação local do Totem e da impressão, incluindo inicialização automática, sincronização de horário, fila local, saúde do agente, retomada após reinício e funcionamento controlado durante indisponibilidade temporária da internet.
- [ ] Sprint 66/70 — Integrar a rede local à nuvem exclusivamente por HTTPS de saída, validando Supabase, Vercel, variáveis de ambiente, CORS, DNS, timeouts, retries, health checks e proibição de expor `service_role` ou portas administrativas.
- [ ] Sprint 67/70 — Criar administração remota segura sem portas públicas desnecessárias, preferindo VPN WireGuard no gateway existente ou outro componente open source já disponível, com MFA, menor privilégio, registro de acessos e revogação documentada.
- [ ] Sprint 68/70 — Implantar observabilidade local e cloud com logs estruturados, disponibilidade dos serviços, saúde da rede, agente de impressão, armazenamento, relógio, alertas operacionais e procedimento gratuito de resposta a incidentes.
- [ ] Sprint 69/70 — Consolidar backup e recuperação da configuração local e da nuvem, mantendo cópias criptografadas fora do equipamento principal, sem versionar segredos, e executar restauração em ambiente isolado antes de considerar a rotina confiável.
- [ ] Sprint 70/70 — Executar a validação ponta a ponta e de contingência: queda de internet, reinício do roteador, queda de energia, indisponibilidade temporária da nuvem, impressora desconectada, recuperação do agente, consistência das senhas e retorno à operação, registrando um runbook.

## P1 — Produto e experiência

- [x] Ajustar a nova estrutura visual da Dashboard ICCF, incluindo campos, linhas delimitadoras e hierarquia dos indicadores.
- [x] Ajustar a padronização visual do Totem, incluindo alinhamento, posicionamento, cores, setas e QR Code.
- [x] Remodelar o fluxo do Totem: atendimento normal ou preferencial vem primeiro; categorias preferenciais e setores vêm depois; a seleção de um ou mais setores leva diretamente à emissão, sem retornar ao tipo de senha.
- [ ] Trocar as logos do atendimento preferencial no Totem pelas versões corretas, mantendo a identificação visual clara e consistente.
- [ ] Validar a acessibilidade do Totem em todas as etapas.
- [ ] Validar o fluxo completo Central e Específico com usuários reais.
- [ ] Implantar Kiosk Mode para bloquear navegador, configurações e acesso ao sistema operacional.
- [ ] Criar acesso administrativo protegido para manutenção e configuração do Totem.
- [x] Garantir que toda emissão impressa tenha layout final, QR Code individual ou do conjunto e tratamento de erro compreensível.
- [x] Agrupar duas ou mais senhas do mesmo pedido no mesmo cupom físico, listar todos os setores selecionados na impressão e no acompanhamento, manter um único QR Code e reduzir espaços desnecessários do papel.

## P1 — Gestão e regras de negócio

- [ ] Completar CRUD granular de setores e permissões.
- [ ] Definir o comportamento ao fechar um setor com fila ativa.
- [ ] Validar a regra operacional de atendimento preferencial e registrar auditoria da classificação.
- [ ] Expandir o ICCF com filtros, período selecionável e exportação.
- [ ] Reativar MFA/TOTP nativo do Supabase para perfis administrativos, com cadastro inicial por QR Code, desafio temporário, limite de tentativas e sessão liberada somente após a verificação. A implementação atual está temporariamente desativada para simplificar o acesso.
- [ ] Validar MFA/TOTP no Supabase e em produção com cada conta administrativa, incluindo recuperação segura do acesso.

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
- [x] Aplicar hardening de HTTPS: rejeitar API em HTTP, ativar HSTS, cookies `Secure`/`HttpOnly`/`SameSite=Strict`, validação de origem, CSRF e limites de requisições nas rotas sensíveis.
- [ ] Configurar domínio próprio no Cloudflare gratuito e validar DNS, certificado, proxy confiável e `CF-Connecting-IP`, sem contratar plano pago.
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
