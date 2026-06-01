# Roteiro de Implementacao: Participantes de Grupos como Motor Comercial

## Objetivo

Transformar a aba **CRM > Grupos** de uma visao de contadores em uma central operacional para identificar participantes, abrir perfil, chamar no chat, criar leads, segmentar e executar acoes comerciais com seguranca.

Este roteiro deve ser implementado por etapas pequenas. Cada etapa precisa ser validada antes da proxima. Nao pule validacoes.

## Principios de Execucao

- Manter compatibilidade com a UAZAPI quando participantes vierem como telefone, JID `@s.whatsapp.net`, `@c.us` ou `@lid`.
- Nunca assumir que `@lid` e telefone real.
- Nunca criar lead duplicado sem checar telefone normalizado e variantes BR com/sem nono digito.
- Preservar isolamento por `organization_id` em todas as queries.
- Preferir actions existentes em `apps/crm/src/actions/groups.ts` e fluxos existentes de leads/chat antes de criar novas APIs.
- Para cada mudanca de UI, tratar loading, vazio, erro, permissao insuficiente e lista grande.
- Cada etapa deve ter PR proprio ou commit isolado.

## Servicos e Superficies Envolvidas

- UAZAPI:
  - `packages/shared/src/providers/uazapi-client.ts`
  - `packages/shared/src/providers/uazapi.ts`
  - `packages/shared/src/whatsapp.ts`
- Actions de grupos:
  - `apps/crm/src/actions/groups.ts`
- Vinculo participante/lead:
  - `apps/crm/src/lib/whatsapp/group-join-pipeline.ts`
  - tabela `group_memberships`
  - tabela `whatsapp_groups`
  - tabela `group_messages`
  - tabela `leads`
- UI de resumo CRM:
  - `apps/crm/src/app/(dashboard)/crm/groups-tab.tsx`
- UI de chat/grupos:
  - `apps/crm/src/app/(dashboard)/groups/groups-client.tsx`
- UI/drawer de lead:
  - `packages/leads-ui/src/components/LeadInfoDrawer.tsx`
  - `packages/leads-ui/src/actions.ts`

## Etapa 0: Auditoria Tecnica Antes de Codar

### Tarefas

1. Confirmar se `main` esta atualizada.
2. Revisar a branch atual e garantir worktree limpo.
3. Localizar implementacoes existentes de:
   - `getGroupParticipants`
   - `getGroupLeadMembers`
   - `backfillGroupMembers`
   - `findOrCreateConversationByLead`
   - actions de criacao/edicao de lead
4. Confirmar se os tipos de banco em `packages/shared/src/database.ts` contem as colunas usadas.

### Validacao

```bash
git status --short
pnpm --filter @persia/crm typecheck
pnpm --filter @persia/shared typecheck
```

### Criterio de Aceite

- A IA deve produzir um resumo curto do estado atual antes de alterar codigo.
- Nenhuma mudanca deve ser feita nesta etapa.

## Etapa 1: Normalizar Modelo de Participante para UI

### Problema

Hoje o participante pode vir como JID, telefone, `PhoneNumber` ou `@lid`. A UI precisa exibir estado claro e permitir acoes apenas quando houver dado suficiente.

### Entrega

Criar um tipo interno para a UI, por exemplo:

```ts
type GroupParticipantView = {
  id: string;
  rawJid: string;
  phone: string | null;
  displayName: string | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  identityKind: "phone" | "lid" | "unknown";
  lead: null | {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    avatar_url: string | null;
    status: string | null;
  };
  membershipId: string | null;
};
```

### Implementacao Recomendada

- Adicionar uma action nova ou estender `getGroupParticipants` em `apps/crm/src/actions/groups.ts`.
- Nome sugerido: `getGroupParticipantsView(groupId: string)`.
- Essa action deve:
  - buscar participantes ao vivo da UAZAPI com `{ force: true }`;
  - normalizar telefone quando possivel;
  - buscar `group_memberships` ativos do grupo;
  - anexar lead quando houver `lead_id`;
  - retornar tambem participantes sem lead.

### Cuidados Anti-Bug

- Nao usar somente `participant.jid` como chave, pois pode repetir ou vir vazio.
- Se `jid.endsWith("@lid")`, `phone` deve ser `null`, exceto se a UAZAPI retornou telefone separado.
- Nao filtrar participantes sem lead; eles precisam aparecer na UI com motivo.
- Todas as queries Supabase devem filtrar `organization_id`.

### Validacao

```bash
pnpm --filter @persia/crm typecheck
pnpm --filter @persia/crm exec eslint src/actions/groups.ts
```

### Criterio de Aceite

- A action retorna:
  - participantes com lead;
  - participantes sem lead;
  - participantes `@lid`;
  - admins/donos.
- Nenhum participante some silenciosamente sem motivo.

## Etapa 2: Melhorar Modal de Participantes na Aba CRM > Grupos

### Entrega

Na tabela `CRM > Grupos`, o usuario deve conseguir abrir participantes de forma obvia:

- Clicar no contador de ocupacao `6/256`.
- Clicar no menu `... > Ver participantes`.
- Modal com abas:
  - `Todos`
  - `Leads`
  - `Nao identificados`
  - `Admins`

### Conteudo do Modal

Cada linha deve mostrar:

- Nome do lead, se identificado.
- Telefone formatado, se disponivel.
- JID tecnico em texto secundario.
- Badge `Lead`, `Nao identificado`, `LID`, `Admin`, `Dono`.
- Acoes por linha:
  - `Ver perfil`, se houver lead.
  - `Abrir chat`, se houver lead ou telefone suficiente.
  - `Criar lead`, se nao houver lead mas houver telefone.
  - `Copiar telefone`, se houver telefone.

### Estados Obrigatorios

- Loading.
- Erro de UAZAPI.
- Grupo sem participantes retornados.
- Participantes retornados, mas nenhum lead identificado.
- Participantes `@lid` sem telefone.
- Lista grande com busca local.

### Cuidados Anti-Bug

- Nao bloquear o modal inteiro se uma acao por participante falhar.
- Evitar que clique na linha e clique em botao executem duas acoes juntas.
- Manter modal responsivo em mobile.
- Nao renderizar telefone falso para `@lid`.

### Validacao

```bash
pnpm --filter @persia/crm typecheck
pnpm --filter @persia/crm exec eslint "src/app/(dashboard)/crm/groups-tab.tsx" src/actions/groups.ts
```

### Criterio de Aceite

- O usuario consegue abrir participantes direto da tela mostrada no print.
- O usuario entende por que alguem nao virou lead.
- O usuario consegue diferenciar telefone real de ID interno.

## Etapa 3: Abrir Perfil do Lead a Partir do Participante

### Entrega

Ao clicar em `Ver perfil`, abrir o mesmo drawer/painel usado na tela de Leads, sem duplicar logica de perfil.

### Implementacao Recomendada

- Reutilizar componentes de `packages/leads-ui` sempre que possivel.
- Se a tela `CRM > Grupos` ja possuir provider de actions de leads, usar o mesmo.
- Caso nao exista, criar um painel simples somente leitura inicialmente, mas planejar migracao para o drawer padrao.

### Cuidados Anti-Bug

- Nao duplicar mutations de lead dentro de `groups-tab.tsx`.
- Nao abrir perfil se `lead_id` estiver nulo.
- Validar permissao e org do lead no servidor, nao apenas no cliente.

### Validacao

```bash
pnpm --filter @persia/crm typecheck
pnpm --filter @persia/leads-ui typecheck
```

### Criterio de Aceite

- Participante com lead abre perfil.
- Participante sem lead mostra `Criar lead`.
- Nao ha erro se lead foi deletado entre carregar lista e abrir perfil.

## Etapa 4: Abrir ou Criar Chat 1:1 com Participante

### Entrega

Adicionar acao `Abrir chat` para participante com lead ou telefone.

### Regras de Negocio

- Se houver lead:
  - abrir conversa existente ou criar conversa associada ao lead.
- Se nao houver lead mas houver telefone:
  - oferecer criar lead antes de abrir chat, ou criar lead minimo com confirmacao.
- Se for `@lid` sem telefone:
  - desabilitar acao e explicar: `Telefone nao disponivel pela API`.

### Implementacao Recomendada

- Reutilizar action existente de chat/leads, como `findOrCreateConversationByLead`, se disponivel no contexto.
- Se precisar de action nova, criar no modulo apropriado, nao dentro da UI.

### Cuidados Anti-Bug

- Nao enviar mensagem automaticamente ao abrir chat.
- Nao criar conversa sem `organization_id`.
- Nao criar lead duplicado por telefone sem normalizacao.
- Evitar abrir chat para telefone invalido.

### Validacao

```bash
pnpm --filter @persia/crm typecheck
pnpm --filter @persia/crm test -- src/lib/whatsapp/__tests__/incoming-pipeline.test.ts
```

### Criterio de Aceite

- `Abrir chat` funciona para lead identificado.
- Participante sem telefone nao mostra acao enganosa.
- Participante com telefone mas sem lead passa por confirmacao.

## Etapa 5: Criar Lead a Partir de Participante

### Entrega

No modal, para participante nao identificado com telefone real, adicionar `Criar lead`.

### Dados Minimos

- `phone`
- `name`, quando houver
- `source = "whatsapp_group"`
- metadados:
  - `group_id`
  - `group_name`
  - `raw_jid`

### Regras de Negocio

- Antes de criar, buscar lead existente por:
  - telefone exato;
  - variante com/sem nono digito BR.
- Se encontrar lead existente:
  - vincular `group_memberships.lead_id`;
  - nao criar duplicado.
- Se nao encontrar:
  - criar lead novo.

### Cuidados Anti-Bug

- Criar lead e vincular membership em fluxo idempotente.
- Se falhar criacao de lead, nao marcar participante como identificado.
- Se falhar vinculo apos criar lead, exibir erro recuperavel.

### Validacao

```bash
pnpm --filter @persia/crm typecheck
pnpm --filter @persia/crm exec eslint src/actions/groups.ts
```

### Criterio de Aceite

- Nao duplica lead com mesmo telefone.
- Participante aparece como identificado apos sucesso.
- Erros sao mostrados sem quebrar o modal.

## Etapa 6: Acoes em Massa

### Entrega

Adicionar selecao multipla no modal de participantes.

Acoes iniciais:

- `Adicionar tag`
- `Criar segmento`
- `Exportar CSV`

### Escopo Inicial Seguro

- Habilitar acoes em massa apenas para participantes com lead identificado.
- Para nao identificados, manter somente `Exportar CSV`.

### Cuidados Anti-Bug

- Nao executar acao em massa em lista filtrada sem mostrar contagem selecionada.
- Mostrar confirmacao antes de alterar varios leads.
- Se uma parte falhar, mostrar resumo: sucesso/falha.

### Validacao

```bash
pnpm --filter @persia/crm typecheck
pnpm --filter @persia/crm test
```

### Criterio de Aceite

- Usuario consegue selecionar leads do grupo e aplicar tag.
- Usuario entende quantos itens foram afetados.
- CSV nao expoe dados inexistentes como telefone falso.

## Etapa 7: Metricas Comerciais de Grupo

### Entrega

Adicionar cards ou colunas no resumo:

- Participantes totais.
- Leads identificados.
- Nao identificados.
- Sem telefone/API LID.
- Engajados no grupo.
- Saidas recentes.

### Definicoes

- `Engajado`: participante com ao menos uma mensagem inbound em `group_messages`.
- `Nao identificado`: participante com telefone/JID conhecido, mas sem `lead_id`.
- `Sem telefone`: participante com `identityKind = "lid"` e sem telefone.

### Cuidados Anti-Bug

- Nao calcular metricas pesadas no cliente para muitos grupos.
- Preferir agregacao em action server-side.
- Evitar N+1 queries por grupo.

### Validacao

```bash
pnpm --filter @persia/crm typecheck
pnpm --filter @persia/crm test
```

### Criterio de Aceite

- Numeros batem com o modal.
- Nao ha queda perceptivel de performance na tela com muitos grupos.

## Etapa 8: Automacoes e Gatilhos

### Entrega

Permitir usar eventos de grupo como gatilhos comerciais:

- `Entrou no grupo`
- `Saiu do grupo`
- `Falou no grupo`
- `Foi identificado como lead`

### Acoes Possiveis

- adicionar tag;
- mover etapa do funil;
- criar tarefa;
- enviar mensagem 1:1;
- adicionar ao segmento;
- notificar atendente.

### Cuidados Anti-Bug

- Usar idempotencia por evento/membership para nao repetir automacao.
- Nao enviar mensagem automatica para quem nao tem telefone real.
- Registrar logs de execucao.

### Validacao

```bash
pnpm --filter @persia/crm typecheck
pnpm --filter @persia/crm test -- src/__tests__/flow-runner.test.ts
```

### Criterio de Aceite

- Gatilho roda uma vez por evento.
- Falha de automacao nao quebra webhook de grupo.
- Logs permitem auditar o que aconteceu.

## Plano de PRs Recomendado

1. **PR A: Modelo de participante enriquecido**
   - action server-side normalizada;
   - testes unitarios da normalizacao.

2. **PR B: Modal UX completo**
   - abas, busca, estados vazios, badges;
   - sem mutacoes ainda.

3. **PR C: Ver perfil e abrir chat**
   - integra drawer/perfil;
   - action segura para abrir/criar conversa.

4. **PR D: Criar lead a partir de participante**
   - fluxo idempotente;
   - dedupe por telefone.

5. **PR E: Acoes em massa**
   - tag;
   - exportacao;
   - segmento, se ja houver infraestrutura.

6. **PR F: Metricas e automacoes**
   - agregacoes;
   - gatilhos comerciais.

## Checklist Geral Antes de Merge

- `git status --short` limpo.
- `pnpm --filter @persia/crm typecheck` passando.
- `pnpm --filter @persia/shared typecheck` passando quando tocar provider/tipos shared.
- ESLint nos arquivos alterados passando.
- Testes relevantes passando.
- Fluxo manual validado:
  - grupo com participantes com telefone;
  - grupo com participante `@lid`;
  - grupo sem participantes retornados;
  - participante com lead existente;
  - participante sem lead;
  - erro simulado de UAZAPI.

## Resultado Esperado

Ao final, a funcionalidade deve permitir que o usuario:

- veja todos os participantes do grupo;
- entenda quem virou lead e quem nao virou;
- abra perfil de lead;
- chame a pessoa no chat;
- crie lead quando houver telefone;
- aplique tag ou segmentacao;
- use grupos como fonte de conversao e automacao comercial.

