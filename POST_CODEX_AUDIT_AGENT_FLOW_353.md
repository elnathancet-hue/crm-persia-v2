# Post-Codex Audit - AI Agent Flow apos PR #353

**Data:** 26/mai/2026
**Escopo:** auditoria estrutural do fluxo do AI Agent apos merges #345-#353.
**Objetivo:** verificar se criacao, configuracao, canvas, persistencia e runtime
do flow estao coerentes end-to-end.

---

## Caminho auditado

1. Criacao de agente e materializacao de `agent_flows`.
2. Configuracao geral do agente e prompt global.
3. Canvas visual em `@persia/ai-agent-ui`.
4. `saveFlow`/`getFlow` e normalizacao de `FlowConfig`.
5. Executor realtime, tester e triggers CRM (`stage_entered`/`segment_entered`).
6. Validacao local com typecheck e testes focados.

---

## Veredito

A estrutura base funciona no caminho feliz:

- `createAgent` materializa `agent_flows`.
- A UI edita nodes/edges e salva via `saveFlow`.
- O loader normaliza JSONB defensivamente.
- O runner executa `entry`, `ai_agent`, `action` e `condition`.
- Triggers de etapa e segmentacao existem.
- Prompt global do agente entra no AI node.

Mas a auditoria encontrou tres riscos estruturais antes de considerar o fluxo
confiavel em producao.

---

## Achados

### Alta - Actions terminais podem ser reexecutadas

O executor persiste sempre:

- `agent_conversations.current_node_id = result.ending_node_id`
- Referencia: `apps/crm/src/lib/ai-agent/executor.ts`

Isso e correto quando o flow termina em um `ai_agent` que precisa continuar a
conversa. Mas e perigoso quando termina em `action` ou `condition`.

Exemplo:

1. Flow termina em `send_whatsapp_message`.
2. Executor salva `current_node_id = "msg-1"`.
3. Lead manda nova mensagem.
4. Runner inicia diretamente em `msg-1`.
5. A mensagem/action pode ser reexecutada sem passar por entry/IA.

Impacto: mensagens repetidas, tags reaplicadas, transferencia repetida ou flow
preso em acao terminal.

### Alta - UI permite salvar flow invalido

`FlowCanvas` calcula `validationIssues` e mostra painel visual, mas `handleSave`
nao bloqueia erros.

Consequencia: flow sem entry, entry sem proximo passo, handles invalidos ou
multiplas entradas podem ser persistidos. Como publicar o agente virou ativar
status, um agente ativo pode rodar com flow estruturalmente quebrado.

### Media - `remove_tag` aparece na UI, mas runtime nao executa

O action type existe no contrato e aparece no catalogo do canvas. A validacao
aceita a acao. Porem o runner declara que `remove_tag` nao tem handler nativo e
emite apenas guardrail, seguindo default.

Impacto: cliente acredita que a tag foi removida, mas nada acontece.

---

## Pontos saudaveis

- Loader normaliza flow defensivamente.
- `saveFlow` valida org/config antes de persistir.
- Runtime de conditions segue `yes`/`no`.
- Triggers CRM de etapa e segmentacao estao conectados.
- Prompt global em Configuracao entra no prompt final do AI node.

---

## Validacao rodada

```text
pnpm.cmd --filter @persia/crm exec vitest run \
  src/__tests__/flow-runner.test.ts \
  src/__tests__/ai-agent-routing-stickiness.test.ts \
  src/__tests__/ai-agent-configs.test.ts

pnpm.cmd --filter @persia/ai-agent-ui typecheck
```

Resultado: 20 testes passaram; typecheck passou. Ambiente local em Node
v24.11.0 mostra warning porque o CRM declara Node 20.x.

---

## Proxima recomendacao

Atacar primeiro a persistencia de `current_node_id` terminal. Esse e o risco
mais provavel de gerar comportamento errado em producao mesmo quando o flow
parece correto no canvas.

---

# Segunda auditoria - partes nao cobertas na primeira rodada

**Escopo adicional:** paridade Admin/CRM, contratos compartilhados, catalogos
de flow e consistencia do editor compartilhado.

## Veredito da segunda rodada

O CRM esta mais avancado que o Admin. Como ambos renderizam os mesmos
componentes de UI (`AgentsList` e `AgentEditor`), essa diferenca vira bug de
produto: a tela sugere que os mesmos recursos existem nos dois contextos, mas
as server actions do Admin ainda salvam/seedam menos coisa.

Tambem existe uma deriva de contrato: o runtime ja entende ferramentas MCP,
mas o pacote compartilhado ainda nao modela esse modo de execucao.

## Achados adicionais

### Alta - Criacao de agente pelo Admin nao materializa o flow

O CRM cria agente com:

- `new_lead_stage_id` resolvido/validado.
- `is_primary` automatico para o primeiro agente.
- `behavior_mode = "flow"`.
- template aplicado quando `template_slug` existe.
- seed de `agent_flows` com entry + AI node.
- seed de `emit_event` quando o template precisa navegar handles nomeados.

Referencias:

- `apps/crm/src/actions/ai-agent/configs.ts:72`
- `apps/crm/src/actions/ai-agent/configs.ts:96`
- `apps/crm/src/actions/ai-agent/configs.ts:97`
- `apps/crm/src/actions/ai-agent/configs.ts:101`
- `apps/crm/src/actions/ai-agent/configs.ts:120`
- `apps/crm/src/actions/ai-agent/configs.ts:538`

O Admin, no mesmo fluxo visual, cria apenas `agent_configs` + `stop_agent`.
Nao ha `template_slug`, `agent_flows`, `new_lead_stage_id`, `behavior_mode` ou
primeiro agente principal na criacao.

Referencias:

- `apps/admin/src/actions/ai-agent/configs.ts:47`
- `apps/admin/src/actions/ai-agent/configs.ts:112`

Impacto: agente criado pelo Admin pode aparecer como configuravel na UI, mas
abrir sem flow materializado. Se ativado, o executor encontra `no_flow` e pula
a execucao.

### Alta - Update do Admin ignora campos que a UI compartilhada pode editar

O CRM persiste `new_lead_stage_id` e faz merge seguro de `humanization_config`.
O Admin nao possui esses branches no `updateAgent`.

Referencias CRM:

- `apps/crm/src/actions/ai-agent/configs.ts:175`
- `apps/crm/src/actions/ai-agent/configs.ts:182`

Referencias Admin:

- `apps/admin/src/actions/ai-agent/configs.ts:112`

Impacto: no Admin, a UI pode parecer salvar partes da configuracao, mas a
server action descarta campos novos. Isso gera falsa confianca e diferenca de
comportamento entre Admin e CRM.

### Media - Catalogo de etapas no Admin nao resolve nome do funil

O CRM carrega pipelines e preenche `pipeline_name`. O Admin retorna
`pipeline_name: ""`.

Referencias:

- `apps/crm/src/actions/ai-agent/flow-catalogs.ts:16`
- `apps/crm/src/actions/ai-agent/flow-catalogs.ts:56`
- `apps/crm/src/actions/ai-agent/flow-catalogs.ts:114`
- `apps/admin/src/actions/ai-agent/flow-catalogs.ts:87`
- `packages/ai-agent-ui/src/components/RulesTab.tsx:314`

Impacto: depois da mudanca para selecionar primeiro o funil e depois a etapa,
o Admin pode mostrar fallback tecnico (`Funil <id>`) em vez do nome real,
reintroduzindo a confusao visual que foi corrigida no CRM.

### Media - Contrato compartilhado nao conhece `execution_mode = "mcp"`

O runner do CRM carrega e executa ferramentas com `execution_mode: "mcp"`.
Mas o contrato compartilhado ainda define:

```ts
export type ToolExecutionMode = "native" | "n8n_webhook";
```

Referencias:

- `apps/crm/src/lib/ai-agent/flow/runner.ts:174`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:626`
- `packages/shared/src/ai-agent/types.ts:72`
- `packages/shared/src/ai-agent/types.ts:174`

Impacto: DB/runtime e tipos de UI/actions estao fora de sincronia. Isso tende
a forcar casts locais, impedir forms genericos de MCP ou esconder estados
validos do produto.

## Recomendacao apos segunda rodada

Atacar em duas PRs separadas:

1. Corrigir a paridade Admin/CRM de `configs.ts` e `flow-catalogs.ts`.
2. Atualizar o contrato compartilhado de ferramentas para incluir MCP de forma
   tipada, cobrindo UI/actions e testes.

---

# Terceira auditoria - riscos funcionais que ainda podiam passar

**Escopo refinado:** procurar pontos em que o canvas fica visualmente coerente,
mas o runtime nao consegue executar o fluxo como o usuario espera.

## Veredito da terceira rodada

Foram encontrados tres riscos mais proximos de producao do que os achados de
layout/paridade. Eles afetam diretamente a capacidade do fluxo de iniciar,
ramificar ou mover o lead.

## Achados refinados

### Alta - Agente "Em branco" pode nascer sem `agent_flows`

O wizard oferece o template `blank` como opcao de comecar do zero. O texto do
template diz que o flow vem com uma entrada + um node IA, mas a action do CRM
so chama `applyTemplate` quando `template_slug` existe e passa em
`isAgentTemplateSlug`.

Referencias:

- `packages/shared/src/ai-agent/agent-templates.ts:91`
- `packages/shared/src/ai-agent/agent-templates.ts:95`
- `apps/crm/src/actions/ai-agent/configs.ts:120`
- `apps/crm/src/actions/ai-agent/configs.ts:538`
- `apps/crm/src/lib/ai-agent/executor.ts:959`

Impacto: se o agente em branco for criado e ativado antes de salvar o canvas,
o executor carrega sem flow e pula com `flow_executor_no_flow`. A UI ate permite
criar o flow depois via `saveFlow`, mas a criacao inicial nao garante a
estrutura minima prometida pelo template.

Recomendacao: seedar um flow minimo para todo agente criado, inclusive
`blank`, ou remover a promessa do template e impedir ativacao enquanto
`agent_flows` nao existir.

### Alta - Template com eventos de IA pode nao conseguir ramificar

O runner so segue saidas nomeadas do node IA quando a IA chama a tool
`emit_event`. Essa tool precisa estar em `agent_flows.enabled_tools`, pois
`loadEnabledTools` so expoe ao modelo IDs dessa allowlist.

O `applyTemplate` cria a tool `emit_event`, mas quando o template ja possui
`flow_config` proprio, salva `flowConfig.enabled_tools` diretamente. No template
Humana Saude, o node IA tem quatro `instructions`/handles, mas
`enabled_tools` esta vazio.

Referencias:

- `apps/crm/src/actions/ai-agent/configs.ts:479`
- `apps/crm/src/actions/ai-agent/configs.ts:504`
- `apps/crm/src/actions/ai-agent/configs.ts:535`
- `apps/crm/src/actions/ai-agent/configs.ts:544`
- `packages/shared/src/ai-agent/agent-templates.ts:369`
- `packages/shared/src/ai-agent/agent-templates.ts:530`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:184`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:276`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:519`

Impacto: o canvas mostra quatro saidas conectadas, o prompt manda chamar
`emit_event`, mas o modelo nao recebe a tool. Resultado provavel: a IA conversa
normalmente e o fluxo nunca atravessa as edges `coletou_idade`,
`dados_completos`, `documentos_enviados` ou `ia_encerrou`.

Recomendacao: ao aplicar template com `flow_config`, mesclar o ID recem-criado
de `emit_event` em `enabled_tools` quando houver AI node com `instructions`.
Tambem vale validar/sinalizar no canvas: "eventos de saida exigem emit_event
habilitado".

### Alta - Eventos de saida adicionados manualmente nao garantem `emit_event`

O editor do AI node permite adicionar "Eventos de saida". Cada evento cria um
handle visual e o prompt instrui a IA a chamar `emit_event`. Mas o `FlowCanvas`
apenas carrega/preserva `enabled_tools`; nao ha UI visivel para adicionar a
tool `emit_event` ao allowlist do flow.

Referencias:

- `packages/ai-agent-ui/src/components/flow/NodeConfigSheet.tsx:517`
- `packages/ai-agent-ui/src/components/flow/FlowCanvas.tsx:175`
- `packages/ai-agent-ui/src/components/flow/FlowCanvas.tsx:232`
- `packages/ai-agent-ui/src/components/flow/FlowCanvas.tsx:844`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:184`

Impacto: em agentes criados em branco ou flows criados manualmente, o usuario
pode desenhar branches de IA perfeitamente, mas eles nao disparam porque a
tool de evento nao esta exposta ao modelo.

Recomendacao: tornar `emit_event` uma tool interna obrigatoria quando qualquer
AI node tiver `instructions.length > 0`, sem depender de UI de ferramentas.

### Media - "Mover etapa do funil" permite escolher etapa que o runtime rejeita

A action `move_pipeline_stage` mostra todas as etapas no select e salva apenas
`stage_name`. O handler, por seguranca, resolve `stage_name` dentro do funil
atual do lead. Se o usuario selecionar uma etapa de outro funil com o mesmo
nome ou uma etapa que nao existe no funil atual do lead, a action falha em
runtime.

Referencias:

- `packages/ai-agent-ui/src/components/flow/NodeConfigSheet.tsx:621`
- `packages/ai-agent-ui/src/components/flow/NodeConfigSheet.tsx:627`
- `apps/crm/src/lib/ai-agent/tools/move-pipeline-stage.ts:93`
- `apps/crm/src/lib/ai-agent/tools/move-pipeline-stage.ts:108`
- `apps/crm/src/lib/ai-agent/tools/move-pipeline-stage.ts:118`

Impacto: depois da correcao de pipeline primeiro/etapa depois na configuracao
inicial, o action node ainda ficou com UX antiga. O cliente pode selecionar
uma etapa visualmente valida, mas o lead nao move.

Recomendacao: o action node deve salvar `stage_id` e exibir primeiro o funil,
depois a etapa, ou restringir a lista ao funil de entrada quando o flow for
stage-driven.

### Media - CRM event entry conectado direto em IA salva, mas nao conversa

A validacao atual marca `crm_event_to_ai` apenas como warning. No runtime, se o
flow e disparado por `pipeline_stage_entered` ou `segment_entered`, o inbound
text e vazio; quando o proximo node e IA, o runner pula a chamada ao modelo e
segue apenas a edge default.

Referencias:

- `packages/shared/src/ai-agent/flow-validation.ts:140`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:233`

Impacto: o usuario pode criar "Entrou na etapa -> IA", salvar e ativar. Na
execucao real, a IA nao envia mensagem porque nao ha inbound para responder.
Se nao houver edge default saindo da IA, o flow termina silenciosamente.

Recomendacao: transformar esse warning em erro quando o entry e de evento CRM
e o alvo imediato e `ai_agent`, ou auto-inserir/sugerir um action node
`send_whatsapp_message`.

## Ordem de ataque recomendada

1. Garantir seed minimo de `agent_flows` e `emit_event` para blank/manual.
2. Corrigir `applyTemplate` para mesclar `emit_event` em templates com
   `instructions`.
3. Ajustar `move_pipeline_stage` para salvar `stage_id` com selecao por funil.
4. Endurecer validacao de CRM event -> AI para evitar flow que termina sem
   falar com o lead.

---

# Quarta auditoria - navegacao por cada acao do canvas

**Escopo refinado:** auditar cada card de acao em `FlowCanvas`, comparando:

1. payload inicial do catalogo;
2. formulario de configuracao;
3. validacao de `FlowConfig`;
4. execucao no `runner.ts`;
5. handler nativo real.

## Veredito da auditoria por acao

O problema central nao esta em uma acao isolada: o `runner.ts` chama handlers
nativos sem injetar o contexto enriquecido que eles esperam (`db`, `provider`,
`config`, `agentConversation`, etc.).

Referencias:

- `apps/crm/src/lib/ai-agent/flow/runner.ts:603`
- `apps/crm/src/lib/ai-agent/flow/runner.ts:793`
- `apps/crm/src/lib/ai-agent/tools/shared.ts:11`
- `apps/crm/src/lib/ai-agent/tools/shared.ts:20`
- `apps/crm/src/lib/ai-agent/tools/shared.ts:26`
- `apps/crm/src/lib/ai-agent/tools/shared.ts:30`

Impacto: a maioria das actions que parecem configuradas no canvas falha em
runtime com `database context missing`, `provider context missing` ou `agent
config missing`. O unico card deterministico claramente funcional hoje e
`send_whatsapp_message`, porque ele nao usa handler nativo: o proprio runner
emite `send_text` para o provider do flow.

## Matriz por acao

| Acao no canvas | Status funcional | Motivo |
| --- | --- | --- |
| `send_whatsapp_message` | OK com ressalva | Special-case no runner; emite `send_text` e o realtime-provider envia/persiste. Ressalva: o runner marca sucesso antes de saber se o provider realmente entregou, porque o envio e fire-and-forget. |
| `add_tag` | Quebrada no flow runner | Handler exige `db` via `getHandlerDb`; runner nao injeta. Mesmo corrigindo isso, o handler cria tag se nao existir, enquanto a UI sugere selecionar tag existente. |
| `remove_tag` | Nao implementada | UI/catalogo/validacao aceitam, mas `directHandlers` nao mapeia. O runner emite guardrail e segue a edge default sem remover nada. |
| `move_pipeline_stage` | Quebrada + UX divergente | Falha sem `db`. Alem disso, UI salva `stage_name` de uma lista global; handler resolve dentro do funil atual do lead. Pode selecionar uma etapa visualmente valida que o runtime rejeita. |
| `create_appointment` | Inviavel como action deterministica atual | Handler exige `start_at` e `type_slug` ou `title`/`duration_minutes`. O formulario da action so permite `type_slug` opcional; nao ha campo para data/hora. Como tool da IA faz sentido; como card deterministico com `config: {}` tende a falhar por input invalido. |
| `trigger_notification` | Quebrada no flow runner | Handler exige `db`, `config` e provider para dispatch. Runner nao injeta nenhum deles. |
| `send_media` | Quebrada no flow runner | Handler exige `db` e `provider` real. Runner nao injeta; alem disso o formulario pede slug manual em vez de picker de midia. |
| `transfer_to_user` | Quebrada no flow runner | Handler exige `db`; runner nao injeta. Depois de corrigido, a UI esta alinhada porque salva email/user id e o handler aceita `user`. |
| `round_robin_user` | Quebrada no flow runner | Handler exige `db`; runner nao injeta. Depois de corrigido, tende a funcionar, mas nao tem filtros de departamento/fila. |
| `transfer_to_agent` | Quebrada e possivelmente legado | Alem de faltar `db`, o handler usa `agent_stages` e `current_stage_id`, conceitos do modelo anterior. No flow pivot, a transferencia deveria provavelmente trocar `config_id` e reiniciar no entry/current_node_id do agente alvo. |
| `stop_agent` | Quebrada no flow runner | Handler exige `db` para pausar. Para notificacao de handoff, tambem precisa `config`, `agentConversation`, provider e OpenAI client. Runner nao injeta. |
| `set_lead_custom_field` | Quebrada no flow runner | Handler exige `db`; runner nao injeta. Alem disso, a UI promete variaveis tipo `{{lead.name}}`, mas o handler grava o valor literal sem interpolacao. |

## Achados criticos por acao

### Critica - Handlers nativos nao recebem `db` no flow runner

Todos estes handlers chamam `getHandlerDb(context)` e falham sem `db`:

- `add_tag`
- `move_pipeline_stage`
- `create_appointment`
- `send_media`
- `transfer_to_user`
- `round_robin_user`
- `transfer_to_agent`
- `trigger_notification`
- `stop_agent`
- `set_lead_custom_field`

No runner, tanto tool calls da IA quanto action nodes montam contexto apenas
com IDs basicos (`organization_id`, `lead_id`, `crm_conversation_id`,
`agent_conversation_id`, `run_id`, `dry_run`). O campo `db` nunca e passado.

Impacto: o flow pode conversar, mas qualquer acao real do CRM tende a falhar.
Isso compromete o objetivo principal do canvas: transformar garantias
operacionais em nodes deterministas.

Recomendacao: criar um helper unico de contexto nativo para o flow runner,
exemplo `buildNativeHandlerContext(db, ctx, extras)`, usado por
`dispatchToolCall` e `executeActionNode`.

### Critica - `transfer_to_agent` ainda aponta para o modelo antigo de stages

O handler de transferencia para outro agente busca `agent_stages` e grava
`current_stage_id`. Esse modelo foi substituido pelo flow pivot, que persiste
`current_node_id`.

Impacto: mesmo depois de passar `db`, essa action pode falhar com "target agent
config has no stages" ou transferir para um estado que o runner novo nao usa.

Recomendacao: reescrever `transfer_to_agent` para o modelo flow:

- resolver agente alvo ativo;
- trocar `agent_conversations.config_id`;
- limpar `current_node_id`;
- deixar o proximo turno iniciar pelo entry do flow alvo;
- preservar `history_summary` e `variables`.

### Alta - `create_appointment` nao tem formulario suficiente para action node

Como tool chamada pela IA, `create_appointment` faz sentido porque a IA coleta
data/hora e passa `start_at`. Como action deterministica do canvas, o formulario
nao coleta `start_at`, e o default do catalogo e `config: {}`.

Impacto: cliente arrasta "Criar agendamento", salva, e na execucao a action
falha por input invalido. O canvas da a entender que agendamento e uma acao
configuravel, mas falta a origem dos dados.

Recomendacao: uma destas opcoes:

1. remover `create_appointment` das action nodes deterministicas e manter
   apenas como tool da IA;
2. transformar o card em "Criar agendamento a partir dos dados coletados",
   com mapeamento explicito de variaveis (`start_at`, `type_slug`, email);
3. exigir que ele venha depois de um AI node que emite payload estruturado.

### Alta - `stop_agent`, `trigger_notification` e `send_media` precisam de provider/config

Mesmo se o `db` for injetado, essas actions precisam de mais contexto:

- `stop_agent`: `config`, `agentConversation`, provider e OpenAI client para
  handoff notification com resumo.
- `trigger_notification`: `config` e provider para carregar template do agente
  e enviar WhatsApp.
- `send_media`: provider real para enviar arquivo pelo WhatsApp.

Impacto: corrigir apenas `db` resolve parte das actions, mas essas continuam
parciais ou sem efeitos externos.

Recomendacao: enriquecer `FlowRunContext` ou criar um `NativeRuntimeContext`
com os recursos ja existentes no executor/realtime provider.

### Media - UI promete interpolacao em `set_lead_custom_field`, mas handler grava literal

O formulario diz que pode usar `{{lead.name}}`, mas o handler apenas grava a
string recebida em `lead_custom_field_values`.

Referencias:

- `packages/ai-agent-ui/src/components/flow/NodeConfigSheet.tsx:720`
- `apps/crm/src/lib/ai-agent/tools/set-lead-custom-field.ts:22`

Impacto: se o cliente configurar `{{lead.name}}`, o campo pode receber o texto
literal `{{lead.name}}`, nao o nome do lead.

Recomendacao: implementar interpolacao compartilhada para action nodes ou
remover a promessa da UI ate existir.

## Ordem de ataque recomendada por acao

1. Corrigir o contexto dos handlers no flow runner (`db` primeiro).
2. Revalidar `add_tag`, `move_pipeline_stage`, `transfer_to_user`,
   `round_robin_user` e `set_lead_custom_field` com testes de runner.
3. Reescrever `transfer_to_agent` para `current_node_id`.
4. Decidir o produto de `create_appointment` como action deterministica.
5. Injetar provider/config para `stop_agent`, `trigger_notification` e
   `send_media`.
6. Remover ou implementar `remove_tag`.
