# PWA e Web Push

## Visao geral

O SenhaHub pode ser instalado como PWA e acompanhar a fila mesmo quando a pagina perde conectividade. As notificacoes Web Push sao opcionais e dependem de consentimento explicito do cliente.

O navegador registra `public/sw.js`, que importa modulos separados para versao, cache e push. A API mantem as inscricoes no SQLite durante o desenvolvimento e no Supabase em producao.

## Arquivos principais

- `app/manifest.js`: identidade, icones, escopo e atalho da PWA.
- `public/sw.js`: ciclo de vida do service worker.
- `public/sw/config.js`: versao e nomes dos caches.
- `public/sw/cache.js`: estrategias e limites de cache.
- `public/sw/push.js`: exibicao, validacao e clique das notificacoes.
- `public/pwa.js`: instalacao, atualizacao, conectividade, consentimento e preferencias.
- `server/push-notification-service.js`: validacao VAPID, payloads, idempotencia e envio.
- `supabase/migrations/20260724182303_pwa_push_notifications.sql`: persistencia, RLS e funcoes atomicas.

## Variaveis

Gere as chaves uma unica vez:

```bash
npx web-push generate-vapid-keys
```

Configure no `.env` local e nas Environment Variables da Vercel:

```env
PUSH_NOTIFICATIONS_ENABLED=1
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<chave-publica>
VAPID_PRIVATE_KEY=<chave-privada>
VAPID_SUBJECT=mailto:contato@seu-dominio.com
```

`VAPID_PRIVATE_KEY` e `SUPABASE_SERVICE_ROLE_KEY` sao segredos exclusivos do servidor. Nunca use prefixo `NEXT_PUBLIC_` na chave privada. Alterar o par VAPID invalida a capacidade de enviar para inscricoes criadas com a chave anterior.

## Banco e seguranca

Execute primeiro `0001_initial_schema.sql` e depois `20260724182303_pwa_push_notifications.sql`.

A migracao cria:

- `web_push_subscriptions`: uma inscricao por endpoint, vinculada ao cliente.
- `push_notification_preferences`: preferencias operacionais e consentimento promocional separado.
- `push_notification_events`: chave unica de idempotencia e resultado do envio.
- `push_rate_limits`: limites atomicos usados pelas rotas.

RLS restringe leitura e alteracao ao proprio usuario. O backend usa a `service_role` somente no servidor. As rotas exigem sessao; mutacoes exigem CSRF e origem valida. Endpoints, chaves e payloads completos nao sao registrados em logs.

## Rotas

- `GET /api/push/status`: configuracao publica, permissao efetiva, dispositivos e preferencias.
- `POST /api/push/subscribe`: valida e registra ou atualiza a inscricao do navegador.
- `DELETE /api/push/unsubscribe`: revoga a inscricao atual.
- `PATCH /api/push/preferences`: atualiza preferencias do cliente.
- `POST /api/push/test`: envia um teste; disponivel em desenvolvimento ou para gestor/admin.

O logout tenta remover a inscricao atual no navegador e revoga todas as inscricoes do usuario no servidor como garantia adicional.

## Eventos da fila

O envio esta conectado aos eventos reais do dominio:

- faltam duas pessoas;
- cliente e o proximo;
- senha chamada ou rechamada;
- senha movida para espera;
- espera perto de expirar ou expirada;
- mudanca relevante de posicao/estado.

Cada evento usa uma chave idempotente. Falha do provedor nao interrompe chamada, atendimento ou outra operacao da fila. Respostas `404` e `410` revogam automaticamente inscricoes expiradas.

## Estrategia offline

- API, login, requisicoes autenticadas e mutacoes: Network Only.
- Navegacao: Network First com `offline.html` como fallback.
- arquivos versionados de `/_next/static`: Cache First.
- imagens, estilos e scripts publicos: Stale While Revalidate.
- caches antigos: removidos na ativacao da nova versao.

Paginas autenticadas e respostas com `private`, `no-store` ou `set-cookie` nao sao persistidas. Offline, a interface informa o estado e desabilita acoes que alterariam dados; a fila oficial continua vindo da API quando a conexao retorna.

Uma atualizacao instalada aguarda confirmacao do usuario. Ela nao recarrega a pagina durante uma operacao critica.

## Teste manual

1. Rode `npm run dev` e abra a aplicacao em HTTPS ou `localhost`.
2. Entre como cliente e confirme que o manifest e o service worker aparecem em DevTools > Application.
3. Instale pelo convite da aplicacao ou menu do navegador.
4. Em Conta, clique em ativar notificacoes e aceite a permissao.
5. Ajuste cada preferencia e recarregue para confirmar persistencia.
6. Use o botao de teste em desenvolvimento ou com perfil gestor/admin.
7. Solicite uma senha e simule os marcos da fila no painel do atendente.
8. Feche a aba e confirme o recebimento, o texto e a navegacao ao tocar.
9. Ative Offline no DevTools, abra uma nova navegacao e confira o fallback e os comandos desabilitados.
10. Publique uma nova versao do service worker e confirme o convite de atualizacao sem recarga inesperada.
11. Saia da conta e confirme que a inscricao deixa de aparecer em `/api/push/status`.

## Compatibilidade

Chrome, Edge e Firefox oferecem instalacao e Push API com pequenas diferencas de interface. Safari no macOS oferece Web Push nas versoes atuais. No iPhone e iPad, notificacoes Web Push exigem adicionar o site a Tela de Inicio e abrir o aplicativo instalado antes de conceder permissao.

O teste automatizado usa um provedor de envio simulado; ele nao dispara notificacoes reais. O teste final em cada navegador e dispositivo continua necessario porque permissao, instalacao e entrega dependem do sistema operacional e do servico push do fabricante.
