# Feature — Evolução do Totem, Acompanhamento Online e Experiência de Atendimento

## Contexto

O Fila Zero passará por uma nova etapa de evolução com foco na experiência do cliente durante a solicitação e acompanhamento das senhas de atendimento.

A implementação envolve uma refatoração completa da experiência do Totem, criação de dois modos de funcionamento — **Totem Central** e **Totem Específico por Balcão** —, implementação de atendimento preferencial, geração de QR Codes individuais para acompanhamento das senhas, reformulação da impressão física e melhorias na segurança dos dispositivos.

Paralelamente, será realizada uma refatoração da Dashboard de Gestão e serão produzidos materiais para apresentação, demonstração e validação da solução durante os testes do InovaSkill.

---

# 1. Objetivo da Feature

Modernizar o fluxo de geração e acompanhamento de senhas do Fila Zero, proporcionando uma experiência mais simples, intuitiva e integrada entre Totem, impressão física e aplicação digital.

A nova experiência deverá permitir que o cliente:

1. Solicite uma senha pelo Totem.
2. Escolha entre atendimento normal ou preferencial.
3. Informe a categoria preferencial quando necessário.
4. Receba sua senha impressa.
5. Escaneie o QR Code presente na impressão.
6. Acompanhe sua posição na fila pelo celular.
7. Receba informações sobre a proximidade de seu atendimento.
8. Continue circulando pelo supermercado enquanto aguarda.

Além disso, o sistema deverá permitir diferentes configurações de Totem dependendo do local onde o dispositivo estiver instalado.

---

# 2. Refatoração da Dashboard de Gestão

A Dashboard de Gestão atual possui uma quantidade excessiva de informações apresentadas simultaneamente, prejudicando a leitura e a identificação dos indicadores mais importantes.

Deverá ser realizada uma refatoração completa de UI/UX da Dashboard.

A nova interface deverá priorizar:

* hierarquia visual das informações;
* agrupamento lógico de indicadores;
* redução de informações desnecessárias;
* destaque para métricas operacionais importantes;
* navegação simplificada;
* visualização rápida da situação dos setores;
* responsividade;
* consistência visual com o restante do Fila Zero.

O objetivo será transformar a Dashboard em uma ferramenta de acompanhamento e tomada de decisão, evitando que ela funcione apenas como uma página carregada de dados.

---

# 3. Redesign completo da UI/UX do Totem

A interface do Totem deverá ser completamente revisada.

O novo design deverá priorizar simplicidade, acessibilidade e velocidade de utilização, considerando principalmente que a aplicação será utilizada por clientes de diferentes faixas etárias e níveis de familiaridade com tecnologia.

A interface deverá utilizar:

* botões grandes;
* elementos adequados para interação touch;
* tipografia de fácil leitura;
* alto contraste;
* linguagem objetiva;
* poucas decisões por tela;
* espaçamentos consistentes;
* feedback visual após interações;
* ícones acompanhados de texto;
* possibilidade de retornar para a etapa anterior;
* prevenção de cliques acidentais;
* padronização entre todas as etapas.

O usuário nunca deverá receber uma quantidade excessiva de informações em uma única tela.

---

# 4. Modos de funcionamento do Totem

A mesma aplicação deverá suportar dois modos diferentes de funcionamento:

### Totem Central

Utilizado em locais onde o cliente poderá escolher qual setor deseja acessar.

### Totem Específico por Balcão

Utilizado diretamente em determinado setor, onde o próprio dispositivo já sabe para qual fila deverá gerar a senha.

A configuração do dispositivo deverá determinar automaticamente qual fluxo será exibido.

Exemplo:

`Tipo de Totem: Central`

ou:

`Tipo de Totem: Setor`

`Setor configurado: Açougue`

Não deverão existir aplicações completamente diferentes para cada Totem. A aplicação deverá adaptar seu comportamento conforme a configuração do dispositivo.

---

# 5. Fluxo do Totem Central

O Totem Central será dividido em três etapas principais.

## Etapa 1 — Escolha do setor

A primeira tela manterá o conceito existente atualmente, apresentando as três opções de atendimento:

* Açougue;
* Frios/Laticínios;
* Padaria.

Nesta mesma tela deverá existir o **QR Code geral do Fila Zero**, permitindo que o cliente acesse a solução diretamente pelo celular caso não queira utilizar o Totem.

O QR Code deverá possuir boa visibilidade sem competir visualmente com as opções principais de atendimento.

Fluxo:

`Escolher setor → Continuar`

---

## Etapa 2 — Tipo de atendimento

Após selecionar o setor desejado, o cliente deverá escolher entre:

* Atendimento Normal;
* Atendimento Preferencial.

A tela deverá apresentar somente essas opções, evitando elementos que possam confundir o usuário.

Fluxo:

`Setor selecionado → Normal ou Preferencial`

---

## Etapa 2.1 — Categoria preferencial

Caso o usuário escolha **Atendimento Preferencial**, o sistema deverá abrir uma nova etapa para seleção da categoria correspondente.

A lista deverá seguir as categorias de atendimento preferencial definidas operacionalmente para o supermercado e conforme as regras aplicáveis.

Fluxo:

`Preferencial → Categoria preferencial → Continuar`

A categoria selecionada deverá permanecer associada à senha durante todo o ciclo de atendimento.

Caso o cliente selecione atendimento normal, esta etapa deverá ser ignorada automaticamente.

---

## Etapa 3 — Confirmação

Antes da geração definitiva da senha, o sistema deverá apresentar um resumo.

Exemplo:

**Setor:** Açougue
**Tipo de atendimento:** Preferencial
**Categoria:** Categoria selecionada

O cliente deverá poder:

* confirmar;
* voltar e corrigir as informações.

Após a confirmação:

`Gerar senha → Registrar atendimento → Gerar QR Code → Imprimir senha → Exibir confirmação`

---

# 6. Fluxo do Totem Específico por Balcão

Nos Totens instalados diretamente nos balcões, a seleção inicial do setor deverá ser eliminada.

Por exemplo, um Totem instalado no Açougue já deverá possuir:

`Setor = Açougue`

configurado previamente.

O cliente não deverá precisar informar novamente uma informação que o sistema já possui.

O fluxo será iniciado diretamente pela escolha do tipo de atendimento.

## Etapa 1 — Tipo de atendimento

O cliente deverá escolher:

`Atendimento Normal`

ou:

`Atendimento Preferencial`

---

## Etapa 1.1 — Categoria preferencial

Caso selecione atendimento preferencial:

`Preferencial → Selecionar categoria`

Caso selecione atendimento normal, o sistema avançará diretamente para a confirmação.

---

## Etapa 2 — Confirmação

Exemplo para atendimento normal:

**Setor:** Açougue
**Atendimento:** Normal

Exemplo para atendimento preferencial:

**Setor:** Açougue
**Atendimento:** Preferencial
**Categoria:** Categoria selecionada

---

## Etapa 3 — Emissão

Após a confirmação:

`Gerar senha → Registrar atendimento → Gerar QR Code → Imprimir → Exibir confirmação`

Esse fluxo deverá possuir menos interações que o Totem Central.

---

# 7. Atendimento Preferencial

O atendimento preferencial deverá passar a fazer parte oficialmente da estrutura da senha e das regras do sistema.

Cada atendimento deverá possuir informações suficientes para identificar:

* setor;
* número/código da senha;
* tipo de atendimento;
* classificação normal ou preferencial;
* categoria preferencial, quando aplicável;
* data e horário de criação;
* status;
* posição na fila;
* identificação interna do atendimento.

As informações relacionadas ao atendimento preferencial também deverão estar disponíveis nos módulos utilizados pelos atendentes.

A interface não deverá depender exclusivamente de cores para identificar uma senha preferencial. Deverão existir textos, ícones ou identificadores visuais adicionais.

---

# 8. QR Code geral do Fila Zero

O Totem Central deverá possuir um QR Code institucional da solução.

Esse QR Code deverá direcionar o usuário para a experiência digital do Fila Zero.

Ele será diferente do QR Code presente na impressão.

Existirão, portanto, dois conceitos diferentes:

**QR Code geral**

`Totem → Fila Zero`

**QR Code individual**

`Senha impressa → Atendimento específico`

---

# 9. Nova Feature — Acompanhamento Online da Senha

Cada senha gerada pelo Totem deverá possuir uma página digital própria para acompanhamento do atendimento.

Ao acessar essa página, o cliente deverá conseguir visualizar informações atualizadas da fila.

A tela poderá apresentar:

* número da senha;
* setor;
* tipo de atendimento;
* status atual;
* quantidade de pessoas à frente;
* posição aproximada;
* indicação de proximidade do atendimento;
* aviso quando estiver sendo chamado;
* indicação de atendimento concluído.

A experiência deverá ser projetada principalmente para dispositivos móveis.

O objetivo é permitir que o cliente não precise permanecer fisicamente em frente ao balcão ou painel enquanto aguarda.

---

# 10. Geração do QR Code individual

Ao criar uma nova senha, o backend deverá gerar ou associar um identificador seguro ao atendimento.

Esse identificador deverá ser utilizado para gerar um endereço individual de acompanhamento.

Fluxo técnico:

`Criação do atendimento`

↓

`Identificador individual`

↓

`URL de acompanhamento`

↓

`Geração do QR Code`

↓

`Impressão`

↓

`Cliente escaneia`

↓

`Página da senha`

O QR Code não deverá depender da digitação manual do número da senha.

Também deverá ser evitado o uso de identificadores sequenciais previsíveis diretamente na URL quando isso permitir consultar atendimentos de outros clientes.

---

# 11. Integração com a fila em tempo real

A página acessada pelo QR Code deverá refletir as alterações realizadas no sistema de atendimento.

Exemplo:

`AGUARDANDO`

↓

`PRÓXIMO`

↓

`CHAMANDO`

↓

`EM ATENDIMENTO`

↓

`FINALIZADO`

Sempre que possível, essas mudanças deverão aparecer sem necessidade de atualização manual da página.

A posição e quantidade de pessoas à frente também deverão acompanhar as alterações da fila.

---

# 12. Redesign da impressão da senha

O layout da impressão deverá ser completamente reformulado.

A impressão deverá priorizar leitura rápida e evitar elementos desnecessários.

Estrutura conceitual:

**FILA ZERO**

**AÇOUGUE**

**SENHA 042**

Atendimento Normal

**Acompanhe sua senha pelo celular**

`[ QR CODE ]`

Escaneie o QR Code para acompanhar sua posição na fila.

Para atendimento preferencial, deverá existir identificação clara da modalidade.

---

# 13. QR Code em todas as impressões

Toda senha emitida pelo Totem deverá possuir automaticamente um QR Code individual.

Não deverá existir impressão de senha sem o QR Code, salvo em situações técnicas excepcionais previamente previstas pelo sistema.

O QR Code deverá apontar diretamente para o acompanhamento daquele atendimento.

Portanto:

`QR Code da impressão ≠ página inicial do Fila Zero`

O comportamento correto será:

`QR Code da impressão → Atendimento específico`

---

# 14. Tratamento de QR Code e impressão

Caso exista algum problema durante a geração do QR Code ou comunicação com a impressora, o sistema deverá possuir tratamento de erro apropriado.

A falha de um componente não deverá resultar na criação repetida de várias senhas devido a novos cliques do usuário.

A interface deverá informar claramente quando:

* a senha estiver sendo gerada;
* a impressão estiver em andamento;
* a operação for concluída;
* ocorrer algum erro.

O botão de confirmação deverá ser temporariamente bloqueado enquanto uma solicitação estiver sendo processada.

---

# 15. Bloqueio do Totem

Os dispositivos utilizados como Totem deverão funcionar em ambiente controlado semelhante a **Kiosk Mode**.

O cliente deverá possuir acesso apenas à aplicação Fila Zero.

Deverá ser impedido, dentro das limitações da plataforma utilizada:

* acesso à barra de endereço;
* abertura de outras páginas;
* abertura de novas abas;
* acesso às configurações;
* fechamento não autorizado da aplicação;
* acesso ao sistema operacional;
* alteração das configurações do equipamento;
* acesso às ferramentas administrativas.

---

# 16. Acesso administrativo

Deverá existir uma forma segura de acesso administrativo ao equipamento.

Esse modo poderá ser utilizado para:

* manutenção;
* diagnóstico;
* configuração;
* alteração do setor associado;
* mudança entre Totem Central e Totem Específico;
* atualização da aplicação;
* resolução de problemas técnicos.

O acesso deverá ser protegido por autenticação e não deverá existir um botão administrativo evidente para clientes na interface principal.

---

# 17. Fluxo consolidado — Totem Central

```text
Tela Inicial
│
├── Açougue
├── Frios/Laticínios
├── Padaria
└── QR Code Fila Zero
        │
        ▼
Escolha do setor
        │
        ▼
Tipo de atendimento
│
├── Normal
│
└── Preferencial
        │
        ▼
Categoria preferencial
(apenas quando necessário)
        │
        ▼
Confirmação
        │
        ▼
Criação da senha
        │
        ▼
QR Code individual
        │
        ▼
Impressão
        │
        ▼
Acompanhamento online
        │
        ▼
Chamada
        │
        ▼
Atendimento
```

---

# 18. Fluxo consolidado — Totem Específico

```text
Totem configurado para um setor
        │
        ▼
Tipo de atendimento
│
├── Normal
│
└── Preferencial
        │
        ▼
Categoria preferencial
(apenas quando necessário)
        │
        ▼
Confirmação
        │
        ▼
Criação da senha
        │
        ▼
QR Code individual
        │
        ▼
Impressão
        │
        ▼
Acompanhamento online
        │
        ▼
Chamada
        │
        ▼
Atendimento
```

A principal diferença entre os dois modelos será que o Totem específico elimina a seleção de setor porque essa informação já estará configurada no dispositivo.

---

# 19. Entregas para o evento do InovaSkill

Além das implementações de software, deverão ser preparadas entregas específicas para apresentação e validação da solução.

---

# 20. Criação da apresentação

Deverá ser criada uma nova apresentação do Fila Zero demonstrando:

* problema identificado;
* proposta da solução;
* funcionamento do Fila Zero;
* evolução do projeto;
* arquitetura geral da experiência;
* Totem Central;
* Totem específico;
* atendimento preferencial;
* impressão;
* QR Code;
* acompanhamento online;
* experiência do cliente;
* benefícios esperados;
* demonstração prática.

O principal fluxo apresentado deverá ser:

`Totem → Solicitação → Senha → QR Code → Celular → Acompanhamento → Chamada → Atendimento`

---

# 21. Demonstração dos dois tipos de Totem

A apresentação deverá destacar que existem dois contextos diferentes de utilização.

### Totem Central

`Setor → Normal/Preferencial → Categoria → Confirmação → Senha`

### Totem Específico

`Normal/Preferencial → Categoria → Confirmação → Senha`

Essa diferença deverá demonstrar a capacidade da aplicação de adaptar sua experiência ao contexto onde o equipamento está instalado.

---

# 22. Criação do Forms para testes

Deverá ser criado um formulário para coleta estruturada de feedback durante os testes realizados no InovaSkill.

O formulário deverá avaliar aspectos relacionados à nova experiência.

Entre os pontos avaliados:

* facilidade de utilização;
* clareza da interface;
* organização visual;
* facilidade para escolher o setor;
* entendimento das opções normal e preferencial;
* clareza das categorias preferenciais;
* quantidade de etapas necessárias;
* facilidade de geração da senha;
* clareza da impressão;
* identificação do QR Code;
* facilidade para escanear;
* experiência de acompanhamento pelo celular;
* clareza das informações apresentadas;
* percepção de utilidade;
* satisfação geral;
* sugestões de melhoria.

Os resultados deverão posteriormente ser utilizados para análise da experiência, identificação de problemas e definição das próximas melhorias do produto.

---

# 23. Critérios gerais de aceite

A Feature poderá ser considerada concluída quando:

* [ ] A Dashboard possuir uma nova estrutura visual.
* [ ] O Totem possuir UI/UX padronizada.
* [ ] Existir configuração para Totem Central e Totem Específico.
* [ ] O Totem Central permitir selecionar o setor.
* [ ] O Totem específico possuir setor previamente configurado.
* [ ] Normal e Preferencial estiverem disponíveis.
* [ ] Preferencial permitir selecionar uma categoria.
* [ ] As informações forem armazenadas corretamente.
* [ ] Toda senha possuir identificador único.
* [ ] Toda senha impressa possuir QR Code.
* [ ] O QR Code direcionar para aquela senha específica.
* [ ] A página de acompanhamento funcionar em dispositivos móveis.
* [ ] A situação da fila for atualizada durante o atendimento.
* [ ] A impressão possuir o novo layout.
* [ ] O Totem possuir proteção contra acesso indevido ao equipamento.
* [ ] Existir mecanismo de acesso administrativo.
* [ ] O fluxo completo puder ser demonstrado durante os testes.
* [ ] A apresentação do InovaSkill estiver preparada.
* [ ] O formulário de avaliação dos testes estiver preparado.

---

# 24. Estrutura da Feature para desenvolvimento

Esta iniciativa poderá ser tratada como uma **Feature principal**, subdividida em diferentes módulos de implementação:

```text
FEATURE
Evolução da Experiência Fila Zero
│
├── Dashboard
│   └── Refatoração UI/UX
│
├── Totem
│   ├── Novo Design System
│   ├── Totem Central
│   ├── Totem Específico
│   ├── Atendimento Normal
│   ├── Atendimento Preferencial
│   ├── Categorias Preferenciais
│   └── Confirmação
│
├── Senha
│   ├── Geração
│   ├── Identificador individual
│   ├── Status
│   └── Integração com fila
│
├── QR Code
│   ├── QR Code geral
│   ├── QR Code individual
│   └── URL de acompanhamento
│
├── Impressão
│   ├── Novo layout
│   ├── QR Code
│   └── Tratamento de erros
│
├── Acompanhamento Online
│   ├── Página da senha
│   ├── Status
│   ├── Posição
│   ├── Pessoas à frente
│   └── Atualização em tempo real
│
├── Segurança do Totem
│   ├── Kiosk Mode
│   ├── Bloqueio
│   └── Acesso administrativo
│
└── InovaSkill
    ├── Apresentação
    ├── Demonstração
    ├── Testes
    ├── Forms
    └── Análise de feedback
```

Dessa forma, a implementação deixa de ser tratada como diversas alterações isoladas e passa a representar uma única evolução de produto: **modernizar todo o ciclo de interação do cliente com o Fila Zero, desde a geração da senha física até o acompanhamento digital do atendimento.**
