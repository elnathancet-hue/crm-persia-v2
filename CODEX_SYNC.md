# CODEX_SYNC.md — AI Agent coordination log

Append-only log for the parallel work between Claude (UI + contracts + design)
and Codex (schema + executor + tools + webhook integration + server actions).

## Rules

1. **Append only.** Never delete or edit prior entries. If a decision
   changes, append a new entry that supersedes the previous one and
   references its date/time.
2. **Entry header** format: `## YYYY-MM-DD HH:MM — <author> — <topic>`
   where `<author>` is `Claude` or `Codex`.
3. **Contract changes** (anything in `packages/shared/src/ai-agent/`) require
   their own dedicated PR and a log entry with topic
   `Contract change request`. Do NOT bundle with feature work.
4. **Blockers**: if you are waiting on the other agent, append a topic
   `Blocker: <short desc>`. The other agent responds by appending its own
   entry resolving it.
5. **Decisions** override conversation — if something here conflicts with
   chat history, this file wins.

---

## 2026-04-22 — Claude — Initial contract handoff

Branch: `claude/ai-agent-contracts` (this PR).

### Files shipped

- `packages/shared/src/ai-agent/types.ts` — domain types, enums, input DTOs, tester contract, feature flag shape
- `packages/shared/src/ai-agent/tool-schema.ts` — Anthropic tool-use types, native handler contract, custom webhook limits
- `packages/shared/src/ai-agent/cost.ts` — model pricing table + cost calc helper
- `packages/shared/src/ai-agent/index.ts` — barrel
- `packages/shared/package.json` — new `./ai-agent` subpath export
- `packages/shared/src/index.ts` — top-level re-export of `./ai-agent`

### Read-only after merge

Codex: after this PR lands in `main`, treat `packages/shared/src/ai-agent/**`
as read-only. If you need any type adjustment:

1. Open a PR named `contract(ai-agent): <change>` that touches ONLY
   `packages/shared/src/ai-agent/**` (plus this file for a log entry).
2. Do not bundle runtime changes.
3. Tag Claude for review before merging.

### Feature flag — decision

**Location**: `public.organizations.settings` (JSONB column, already exists
with default `{}`).

**Shape**:

```json
{
  "features": {
    "native_agent_enabled": true
  }
}
```

**Default**: `false` when the key is missing (no backfill needed; absence =
disabled).

**Accessor contract** (Codex implements in
`apps/crm/src/lib/ai-agent/feature-flag.ts`):

```ts
export async function isNativeAgentEnabled(orgId: string): Promise<boolean>;
```

Reads `organizations.settings -> 'features' -> 'native_agent_enabled'`.
Returns `false` on any parse error — never throws. UI calls the same function
via a server action to decide whether to show the module.

No new `feature_flags` table in PR1. If granular flags are ever needed, we
migrate then.

### Webhook router — contract

Codex's diff in `apps/crm/src/app/api/whatsapp/webhook/route.ts` is limited
to the smallest possible branch:

```ts
const nativeEnabled = await isNativeAgentEnabled(orgId);
if (nativeEnabled) {
  const outcome = await tryNativeAgent({ orgId, leadId, message, rawPayload });
  if (outcome.handled) return outcome.response;
  // fall through to legacy on fallback
}
return processIncomingMessageLegacy(...);
```

Forbidden in this diff:

- ❌ parsing UAZAPI payload
- ❌ HMAC signature verification
- ❌ matching connection by token / owner
- ❌ downloading media
- ❌ touching `messages` insertion
- ❌ changing response headers

The native path calls the existing primitives, it does not replace them.

### Fallback contract — `tryNativeAgent`

Runtime must never throw out of `tryNativeAgent`. Failure modes map as:

| Failure                                    | Return                                      |
|--------------------------------------------|---------------------------------------------|
| Flag off for org                           | `{ handled: false }`                        |
| No active `agent_config` for this context  | `{ handled: false }`                        |
| Executor exception                         | `{ handled: false }` + log + `agent_runs.status='failed'` |
| Cost ceiling hit                           | `{ handled: true, response: handoff }` + `status='fallback'` |
| Timeout                                    | `{ handled: true, response: handoff }` + `status='fallback'` |
| Happy path                                 | `{ handled: true, response }` + `status='succeeded'` |

Legacy (n8n / manual) handles `handled: false` — the webhook must remain
backwards-compatible in every case.

### Server actions — expected location and signatures

Codex implements in `apps/crm/src/actions/ai-agent/*.ts`:

```
configs.ts
  listAgents(): Promise<AgentConfig[]>
  getAgent(configId: string): Promise<AgentConfig | null>
  createAgent(input: CreateAgentInput): Promise<AgentConfig>
  updateAgent(configId: string, input: UpdateAgentInput): Promise<AgentConfig>
  deleteAgent(configId: string): Promise<void>

stages.ts
  listStages(configId: string): Promise<AgentStage[]>
  createStage(configId: string, input: CreateStageInput): Promise<AgentStage>
  updateStage(stageId: string, input: UpdateStageInput): Promise<AgentStage>
  deleteStage(stageId: string): Promise<void>
  reorderStages(input: ReorderStagesInput): Promise<void>

tester.ts
  testAgent(req: TesterRequest): Promise<TesterResponse>

feature-flag.ts
  isNativeAgentEnabled(): Promise<boolean>  // infers orgId server-side
```

All actions MUST:

1. Resolve `organization_id` server-side (via `getOrgId()`). UI never passes
   it.
2. Call `requireRole("admin")` for any mutation; `requireRole("agent")` for
   reads of configs. Reads of audit (`runs`/`steps`) also require `admin`.
3. Validate ownership in a single SQL statement (no "fetch then check" race).
4. Return plain objects matching the shared types — never raw Supabase
   query results with `data/error` wrappers.

### Tester contract — spike scope

For PR1 spike, `testAgent` supports only:

- `config_id` resolving to an `active` or `draft` agent the caller owns.
- `stage_id` optional; defaults to first stage by `order_index`.
- `message` as plain text.
- `dry_run`: **in spike, always true — force side-effect-free**. Ignore the
  flag from the client if set to false. We re-enable real-send mode in a
  later PR once the tester UI has a safety confirmation.

`testAgent` inserts a real `agent_runs` row with a synthetic conversation
(no `crm_conversation_id`, no `inbound_message_id`). The UI shows the reply
and the steps inline; nothing goes out to WhatsApp.

### Native handlers — spike scope

Only `stop_agent` ships in PR1 runtime. The enum has all 13 names, but the
handler registry is intentionally partial:

```ts
const nativeHandlers: NativeHandlerRegistry = {
  stop_agent: stopAgentHandler,
};
```

Calling any other `native_handler` value returns `{ success: false, error:
"handler not implemented in this release" }` so the LLM can react instead
of crashing the run.

`stop_agent` contract:

- Input schema: `{ reason?: string }`
- Effect (non-dry-run): set a flag on `agent_conversations` (e.g.
  `agent_conversations.human_handoff_at = now()`) AND append an internal
  note to the CRM conversation. Does NOT close the conversation, does NOT
  reassign — just silences the bot for future inbound messages on that
  conversation.

Codex designs the exact column in the migration; include in its PR log
entry for UI awareness.

### Model choice — spike default

`DEFAULT_MODEL = "claude-sonnet-4-6"`. UI exposes selector for Opus / Sonnet
/ Haiku. Codex validates `model in MODEL_PRICING` before persisting a config
to catch typos — but does NOT reject unknown models at execute time (cost
tracking degrades gracefully to 0).

### Cost ceilings — spike default

```ts
DEFAULT_GUARDRAILS = {
  max_iterations: 5,
  timeout_seconds: 30,
  cost_ceiling_tokens: 20_000,
  allow_human_handoff: true,
};
```

Per-run only in PR1. Per-org daily/monthly ceilings ship in PR4.

### Dependencies for Codex runtime branch

To unblock `codex/ai-agent-runtime-spike` after this PR merges:

- `@anthropic-ai/sdk` (add to `apps/crm/package.json`). Codex validates
  current tool-use API shape against the official docs before writing the
  executor loop — do not rely on training-data recollections.
- `zod` is already in `apps/crm`; handlers define Zod schemas internally
  and use `zod-to-json-schema` (Codex can add) to produce
  `JSONSchemaObject` for persistence in `agent_tools.input_schema`.

---

## Open questions (resolve by appending an entry)

- [ ] Should `stop_agent` handoff set a TTL or be manually re-enabled? (Claude UI needs to know if there's a "Reativar bot" button.)
- [ ] Which column on `agent_conversations` carries the handoff flag? (Codex decides in migration; log the name here.)

---

## 2026-04-22 22:45 — Codex — Runtime migration handoff fields

Branch: `codex/ai-agent-runtime-spike`.

Migration `017_ai_agent_core.sql` uses these runtime handoff columns:

- `agent_conversations.human_handoff_at TIMESTAMPTZ`
- `agent_conversations.human_handoff_reason TEXT`

Spike behavior for `stop_agent`:

- `dry_run=true`: no mutation; tool output describes the handoff that would be set.
- `dry_run=false`: sets `human_handoff_at=now()` and stores the optional reason.
- Re-enable/TTL is not automatic in PR1. UI should treat any non-null
  `human_handoff_at` as "bot paused for this conversation" until a future
  action clears it.

Tester synthetic conversations:

- The DB column `agent_conversations.crm_conversation_id` is nullable so
  `testAgent()` can insert a real synthetic runtime row without a CRM chat.
- Webhook/runtime executions always fill `crm_conversation_id`.
  This is intentionally narrower than the shared `AgentConversation` UI type,
  because the UI does not list synthetic tester conversations as CRM records.

---

## 2026-04-23 — Claude — PR3 contract additions

Branch: `claude/ai-agent-pr3-contracts` (this PR).

Builds on #3 / #4 / #5. **Additive only** — no existing types changed. PR4
runtime code continues to typecheck without edits.

### Files shipped

- `packages/shared/src/ai-agent/tool-presets.ts` — new
  - `NativeToolPreset` type (handler, name, display_name, description,
    ui_description, icon_name, category, input_schema, shipped_in_pr)
  - `NATIVE_TOOL_PRESETS` constant — canonical catalog covering all 13
    handlers. `shipped_in_pr` tags what is runtime-ready vs placeholder.
  - `getPreset(handler)` + `getPresetsShippedInOrBefore(pr)` helpers
- `packages/shared/src/ai-agent/types.ts` — additions only
  - `CreateToolInput`, `UpdateToolInput`, `CreateToolFromPresetInput`,
    `SetStageToolInput`
  - `ListRunsInput`, `AgentRunWithSteps`
- `packages/shared/src/ai-agent/index.ts` — re-exports `tool-presets`

### Tool presets — source of truth

Codex and UI both consume `NATIVE_TOOL_PRESETS`:

- **UI (Claude)**: Decision Intelligence modal renders one card per preset.
  Cards for `shipped_in_pr` > PR3 are visible but disabled with a
  "Disponivel em <PR>" tooltip so the roadmap is legible in-product.
- **Runtime (Codex)**: `createToolFromPreset({ config_id, handler })` looks
  up the preset and materializes an `agent_tools` row using
  preset.name/description/input_schema/execution_mode=native/native_handler.
  Replaces the ad-hoc `getDefaultStopAgentTool` from #4 — keep the old
  function exported as a thin wrapper until all callers migrate.

The preset's `input_schema` is the **contract** for the handler. When Codex
writes a handler, his Zod input schema must produce a JSON Schema that is
structurally equivalent to the preset's schema (same required fields, same
property types and formats). Any divergence = update the preset in a future
contract-change PR, not the handler in isolation.

### PR3 native handlers — scope for Codex

Four new handlers land in `apps/crm/src/lib/ai-agent/tools/`:

| Handler | File | Effect (non-dry-run) |
|---|---|---|
| `transfer_to_user` | `transfer-to-user.ts` | `UPDATE leads SET assigned_to = $user_id WHERE id = $lead_id AND organization_id = $org_id`. Verify `organization_members` has the user. Insert an audit note into the CRM conversation ("Lead transferido para @alice pelo agente: <reason>"). |
| `transfer_to_stage` | `transfer-to-stage.ts` | `UPDATE agent_conversations SET current_stage_id = $stage_id WHERE id = $agent_conv_id AND organization_id = $org_id`. Verify stage belongs to the same `config_id`. Return `{ old_stage_id, new_stage_id }`. |
| `transfer_to_agent` | `transfer-to-agent.ts` | Move the agent_conversation to a different `config_id` (same org, target config must be `status='active'`). Reset `current_stage_id` to the first stage of the new config. Preserve `variables` and `history_summary`. |
| `add_tag` | `add-tag.ts` | Find-or-create `tags` row (scoped by `organization_id`, `name` lowercased+trimmed) → upsert into `lead_tags(lead_id, tag_id)`. Return `{ tag_id, tag_name, created: boolean }`. |

Hard rules reminder (from `tool-schema.ts`):

1. Every handler re-validates input against its Zod schema before touching
   the DB. The preset JSON Schema is advisory for the LLM, not enforcement.
2. Every DB write includes `eq("organization_id", context.organization_id)`.
3. `dry_run === true` returns the would-be effect in `output` with
   `side_effects: ["would <verb> <subject>"]` and NO writes.
4. Errors go in `NativeHandlerResult.error` with `success: false`. Do not
   throw unless the runtime itself is corrupt.

### Registry update

`nativeHandlers` in `apps/crm/src/lib/ai-agent/tools/registry.ts` goes from
1 entry to 5:

```ts
export const nativeHandlers: NativeHandlerRegistry = {
  stop_agent: stopAgentHandler,
  transfer_to_user: transferToUserHandler,
  transfer_to_stage: transferToStageHandler,
  transfer_to_agent: transferToAgentHandler,
  add_tag: addTagHandler,
};
```

Unimplemented handlers (assign_*, round_robin_*, send_audio,
trigger_notification, schedule_event) still return "handler not implemented
in this release" — UI will show their cards as disabled.

### Tool CRUD — server actions Codex implements

Location: `apps/crm/src/actions/ai-agent/tools.ts` (new file).

```ts
listToolsForAgent(configId: string): Promise<AgentTool[]>;
createToolFromPreset(input: CreateToolFromPresetInput): Promise<AgentTool>;
createCustomTool(input: CreateToolInput): Promise<AgentTool>; // defer n8n_webhook to PR5
updateTool(toolId: string, input: UpdateToolInput): Promise<AgentTool>;
deleteTool(toolId: string): Promise<void>;
setStageTool(input: SetStageToolInput): Promise<AgentStageTool>;
listStageTools(stageId: string): Promise<AgentStageTool[]>;
```

Rules:

- All actions resolve `organization_id` server-side via `getOrgId()`.
- `createCustomTool` rejects `execution_mode === 'n8n_webhook'` with a clear
  error in PR3 — that mode ships with SSRF hardening in PR5. UI also hides
  the "Custom webhook" card until PR5.
- `setStageTool` is upsert: if the junction row exists, update
  `is_enabled`; otherwise insert. Verify stage and tool share the same
  `config_id` and the same `organization_id`.

### Audit — server actions Codex implements

Location: `apps/crm/src/actions/ai-agent/audit.ts` (new file).

```ts
listRuns(input: ListRunsInput): Promise<AgentRunWithSteps[]>;
getRun(runId: string): Promise<AgentRunWithSteps | null>;
```

Rules:

- Default `limit = 20`, max `100`. Results ordered by `created_at DESC`.
- Requires `admin` role (same as writes — audit is sensitive).
- Steps are fetched in one round trip (single join or two queries, whichever
  the Supabase client does best) and attached to each run.
- Scoped by `organization_id` in every filter.

### UI — what Claude will build in the follow-up PR

- Ferramentas tab: real implementation.
  - Shows current tools for the agent (list + edit/remove).
  - "Adicionar decisao inteligente" button opens the Decision Intelligence
    modal.
  - Modal grid of `NATIVE_TOOL_PRESETS` cards. Cards where
    `shipped_in_pr > "PR3"` render disabled.
- StageCard: footer with "Ferramentas permitidas: N" + per-stage toggle
  panel in the StageSheet to flip `agent_stage_tools.is_enabled`.
- Audit tab: paginated list of runs (via `listRuns({ config_id })`), each
  row expandable to show step timeline (icon + duration + tool name +
  compact output preview).

No UI PR is blocked by this contracts PR — everything builds once the
runtime PR from Codex merges.

### Out of scope (still)

- Custom webhook tools (PR5 — SSRF hardening).
- RAG (PR6).
- Notification templates (PR7).
- Calendar integration (PR7).
- Construtor de Prompt IA / Gerador guiado (PR8).

---

## 2026-04-23 16:20 — Codex — PR3 runtime implementation notes

Branch: `codex/ai-agent-pr3-runtime`.

Runtime choices shipped in this branch:

- `apps/crm/src/actions/ai-agent/tools.ts`
  - `createToolFromPreset()` materializes `NATIVE_TOOL_PRESETS` and rejects
    presets whose `shipped_in_pr` is later than PR3.
  - `createCustomTool()` rejects `execution_mode='n8n_webhook'` with a PR5
    error, per contract.
  - `setStageTool()` is the junction upsert for `agent_stage_tools`.
- `apps/crm/src/actions/ai-agent/audit.ts`
  - `listRuns()` + `getRun()` return `AgentRunWithSteps` with step arrays
    attached server-side.
- Native handler registry now includes:
  - `stop_agent`
  - `transfer_to_user`
  - `transfer_to_stage`
  - `transfer_to_agent`
  - `add_tag`

Important implementation detail for UI/ops:

- There is still no dedicated "conversation internal notes" table in CRM.
  To avoid injecting fake chat messages into the live transcript, both
  `stop_agent` and `transfer_to_user` write their internal audit note into
  `lead_activities` with `metadata.source='ai_agent'` and
  `metadata.conversation_id=<crm_conversation_id>`.
  UI can surface that as an internal timeline event if needed.

Other runtime tweaks included opportunistically:

- AI agent server actions now revalidate `/automations/agents` paths instead
  of the old `/dashboard/agents` path from the spike.
- `getDefaultStopAgentTool()` is now a thin wrapper over the shared preset
  catalog, so presets are the single source of truth.

---

## 2026-04-23 — Claude — PR4 contract additions

Branch: `claude/ai-agent-pr4-contracts` (this PR).

Additive only — zero changes to PR1/PR2/PR3 types. Runtime code from #7
continues to compile unchanged.

### Files shipped

- `packages/shared/src/ai-agent/limits.ts` — new
  - `CostLimitScope`: `run | agent_daily | org_daily | org_monthly`
  - `AgentCostLimit` row type + `SetCostLimitInput` DTO
  - `UsageStats` + `UsagePoint` + `UsagePointTotals` + `ActiveCostLimits`
    + `CostLimitSnapshot`
  - `RateLimitConfig` + `DEFAULT_RATE_LIMITS` (6 runs/min per conversation,
    20 concurrent runs per org)
  - `GuardrailTripReason` enum
- `packages/shared/src/ai-agent/index.ts` re-exports `limits`

### Runtime scope for Codex (PR4)

**Migration `018_ai_agent_cost_limits.sql`**:

```sql
CREATE TABLE agent_cost_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('run','agent_daily','org_daily','org_monthly')),
  subject_id UUID,                 -- agent_config_id when scope='agent_daily', null otherwise
  max_tokens INTEGER CHECK (max_tokens >= 0),
  max_usd_cents INTEGER CHECK (max_usd_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- one row per (org, scope, subject). subject_id is part of the uniqueness so
  -- agent_daily can have per-config rows alongside org_daily (subject null).
  UNIQUE (organization_id, scope, subject_id)
);

CREATE INDEX idx_agent_cost_limits_org_scope
  ON agent_cost_limits (organization_id, scope);

ALTER TABLE agent_cost_limits ENABLE ROW LEVEL SECURITY;
-- select: org members; write: admin+owner (mirror agent_configs pattern).

-- View aggregating agent_runs for the usage dashboards.
CREATE OR REPLACE VIEW agent_usage_daily AS
SELECT
  r.organization_id,
  c.config_id,
  date_trunc('day', r.created_at AT TIME ZONE 'UTC')::date AS day,
  count(*) AS run_count,
  count(*) FILTER (WHERE r.status = 'succeeded') AS succeeded_count,
  count(*) FILTER (WHERE r.status = 'failed') AS failed_count,
  count(*) FILTER (WHERE r.status = 'fallback') AS fallback_count,
  coalesce(sum(r.tokens_input), 0) AS tokens_input,
  coalesce(sum(r.tokens_output), 0) AS tokens_output,
  coalesce(sum(r.cost_usd_cents), 0) AS cost_usd_cents,
  coalesce(avg(r.duration_ms)::int, 0) AS avg_duration_ms
FROM agent_runs r
JOIN agent_conversations c ON c.id = r.agent_conversation_id
GROUP BY r.organization_id, c.config_id, day;
```

Materialized version optional — a plain view should perform fine up to
hundreds of thousands of runs. If that becomes a bottleneck later, promote
it with `CONCURRENTLY` refresh.

**Enforcement helper `apps/crm/src/lib/ai-agent/cost-limits.ts`**:

```ts
export async function assertWithinCostLimits(params: {
  db: AgentDb;
  orgId: string;
  configId: string;
  agentConversationId: string;
  tokensSoFarRun: number;
  costSoFarRunUsdCents: number;
}): Promise<void>;  // throws GuardrailError with a GuardrailTripReason
```

Order of checks (cheapest first):

1. Per-run `tokensSoFarRun` against per-agent `AgentGuardrails.cost_ceiling_tokens`
   and against `agent_cost_limits` row where `scope='run'` (fleet default).
2. `agent_daily` tokens + USD using `agent_usage_daily` view filtered by
   `config_id` and `day = today UTC`.
3. `org_daily` tokens + USD similarly (no config filter).
4. `org_monthly` tokens + USD using `month_to_date` window.

Cache per-request: one query per scope per run, not per LLM iteration. In
practice the executor calls this helper twice — once before the first LLM
call, once after the final LLM iteration — so daily aggregates read twice
per run.

**Rate limit helper `apps/crm/src/lib/ai-agent/rate-limits.ts`**:

```ts
export async function assertWithinRateLimits(params: {
  db: AgentDb;
  orgId: string;
  agentConversationId: string;
}): Promise<void>;  // throws GuardrailError
```

Implementation: count `agent_runs` in the last 60s filtered by
`agent_conversation_id`. Separate query counts `status='running'` runs per
org. If either exceeds the default, throw `rate_limit_conversation` or
`rate_limit_org_concurrent`.

**Executor integration**:

- Call `assertWithinRateLimits` as the first step of `tryNativeAgent`,
  before creating the run. If it trips, return
  `{ handled: true, response: { ok: true, skipped: "rate_limited" } }` so
  the caller backs off quietly without spinning up another run row.
- Call `assertWithinCostLimits` before `client.messages.create` on each
  iteration. If it trips, mark the run as `fallback`, insert a guardrail
  step with the `GuardrailTripReason`, and send the handoff reply.

**Server actions — Codex implements in `apps/crm/src/actions/ai-agent/`**:

```ts
// limits.ts
listCostLimits(): Promise<AgentCostLimit[]>;                         // org-wide
setCostLimit(input: SetCostLimitInput): Promise<AgentCostLimit>;      // upsert
deleteCostLimit(id: string): Promise<void>;

// usage.ts
getUsageStats(input: UsageStatsInput): Promise<UsageStats>;
```

Rules:

- All mutations require `admin` role.
- `getUsageStats` requires `admin` (usage numbers are sensitive — reveal
  customer activity shape).
- Range resolution server-side: `today` = current UTC day,
  `last_7_days` = 7 rolling UTC days including today, etc.
- `UsageStats.limits` is filled by reading `agent_cost_limits` + the
  view's sums in one join, so the UI renders progress bars without a
  round trip.

**Tests Codex should add**:

- cost limit trips: each scope (run / agent_daily / org_daily / org_monthly)
  and each gauge (tokens / USD).
- rate limit trips: conversation rolling window + org concurrent.
- `getUsageStats` org scoping, range resolution, totals math.
- migration: table + view create; RLS blocks cross-org read.
- idempotency: `setCostLimit` upserts, `deleteCostLimit` removes.

### UI scope for Claude (PR4 follow-up)

- New tab **Limites e Uso** on the agent detail page:
  - Cost limits editor (3 scopes × 2 gauges) + save/clear per row.
  - Stats: last 30 days chart (run_count + cost_usd_cents), totals
    cards (runs, success rate, fallback rate, avg duration), active
    limit progress bars.
- Top-level org page (future): aggregate across all agents.

### Out of scope (still)

- Custom webhook tool (PR5 — SSRF hardening).
- RAG (PR6).
- Notifications + Agendamento (PR7).
- Meta-IA builders (PR8).

---

## 2026-04-23 20:50 — Codex — PR4 runtime implementation notes

Branch: `codex/ai-agent-pr4-runtime`.

Runtime pieces shipped in this branch:

- `apps/crm/supabase/migrations/018_ai_agent_cost_limits.sql`
  - `agent_cost_limits` table with org-scoped RLS.
  - `agent_usage_daily` view with `security_invoker = true` so authenticated
    reads stay under caller permissions while service_role can still aggregate
    for webhook/runtime use.
- `apps/crm/src/lib/ai-agent/cost-limits.ts`
  - Per-run + daily/monthly limit enforcement.
  - Shared helpers for usage aggregation, totals math and active limit
    snapshots so runtime and UI-backed actions read the same shapes.
- `apps/crm/src/lib/ai-agent/rate-limits.ts`
  - Conversation rolling-window guard (`6 / minute`) and org concurrent run
    guard (`20 running`).
- Executor integration
  - `tryNativeAgent()` rate-checks before creating a run and returns
    `{ handled: true, skipped: "rate_limited" }` on trip.
  - `executeAgent()` checks cost limits before and after each LLM iteration.
  - Guardrail step reasons now use the PR4 shared enum
    (`run_cost_timeout`, `org_daily_usd`, etc.).
- Server actions
  - `apps/crm/src/actions/ai-agent/limits.ts`
    - `listCostLimits()`
    - `setCostLimit()` (app-level upsert by org+scope+subject)
    - `deleteCostLimit()`
  - `apps/crm/src/actions/ai-agent/usage.ts`
    - `getUsageStats()` with UTC range resolution and zero-filled daily points

Validation from this branch:

- `pnpm --filter @persia/crm build` passes.
- `pnpm --filter @persia/crm test -- src/__tests__/ai-agent-pr4-runtime.test.ts`
  passes.
- `pnpm --filter @persia/crm typecheck` is still blocked by a pre-existing
  `.next/types` mismatch in this repo (missing generated route files referenced
  by `apps/crm/tsconfig.json`). This branch does not introduce a new TS error;
  the Next build's own type check passes.

---

## 2026-04-23 — Claude — PR5 contract additions

Branch: `claude/ai-agent-pr5-contracts` (this PR).

Additive only. Enables `execution_mode='n8n_webhook'` end-to-end — the one
tool path deliberately held back on every prior PR. After PR5 merges, the
platform ships n8n (and any HTTPS webhook endpoint) as an optional provider
alongside native handlers, without loosening the security posture that made
the deferral worth it.

### Files shipped

- `packages/shared/src/ai-agent/types.ts` — additive only
  - `OrganizationWebhookAllowlist` shape, added to `OrganizationSettings`
    under key `webhook_allowlist`.
  - `CreateCustomWebhookToolInput`, `UpdateCustomWebhookToolInput`
  - `AddAllowedDomainInput`
  - `WEBHOOK_ALLOWLIST_KEY`, `WEBHOOK_SECRET_MIN_LENGTH` constants

The PR1 types `CustomWebhookInvocation`, `CustomWebhookResult`, and
`CUSTOM_WEBHOOK_LIMITS` (in `tool-schema.ts`) are the runtime-side
contract for the invoker and remain unchanged.

### Storage decision

Allowlist lives in `public.organizations.settings.webhook_allowlist.domains`
(JSONB). No new table — same reasoning as the native_agent_enabled flag in
PR1. Upgrade to a table with per-entry audit if we ever need "who added
this and when", but the simple case is one dropdown for the admin.

### SSRF hardening — mandatory checks for `webhook-caller.ts`

Every check is an independent gate; the caller is rejected if ANY fails. In
order:

1. **Scheme**: only `https:`. Reject `http:`, `file:`, `ftp:`, `javascript:`, etc.
2. **Hostname parsing**: URL must parse cleanly; no IPv6 literals in
   brackets that bypass hostname comparison.
3. **Allowlist match**: `hostname.toLowerCase()` must be present in
   `organizations.settings.webhook_allowlist.domains`. **Empty/absent
   allowlist = reject all calls.** No fleet-wide default.
4. **DNS resolve**: resolve hostname to IPs (both A and AAAA). If resolution
   fails, reject. Cache the resolved IPs for the duration of the single
   fetch — this is what prevents DNS rebinding (the fetch connects to the
   already-resolved IP, not re-resolving).
5. **Private IP block**: every resolved IP must fall outside:
   - IPv4: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`,
     `169.254.0.0/16` (link-local), `0.0.0.0/8`, `224.0.0.0/4` (multicast),
     `240.0.0.0/4` (reserved), `100.64.0.0/10` (CGNAT).
   - IPv6: `::1/128`, `fc00::/7` (ULA), `fe80::/10` (link-local),
     `::ffff:0:0/96` (IPv4-mapped — re-check underlying IPv4),
     `2001:db8::/32` (doc), `ff00::/8` (multicast).
6. **Port**: only 443 (implicit with `https:`). No custom ports — keeps
   local proxies out even if the hostname passes DNS.
7. **Body cap**: response reader aborts when total bytes exceed
   `CUSTOM_WEBHOOK_LIMITS.max_response_bytes` (256 KB). Stream-check,
   don't buffer to memory first.
8. **Timeout**: total deadline `CUSTOM_WEBHOOK_LIMITS.timeout_ms` (10 s).
   Connection + read combined; use `AbortController`.
9. **Redirects**: disallow. `redirect: "manual"`. A 3xx response is a
   hard error — prevents the allowlist bypass where a listed host
   redirects to an internal one.

### HMAC

Outgoing request carries:

- Header `X-Persia-Signature: sha256=<hex>` where `<hex>` is the HMAC of
  the request body using `agent_tools.webhook_secret` as the key.
- Header `X-Persia-Timestamp: <unix_ms>` — include in signed payload.
- Signed payload = `timestamp + "." + body`.

Webhook secret minimum length: 32 chars (see `WEBHOOK_SECRET_MIN_LENGTH`).
Runtime rejects `createCustomTool` / `updateTool` with shorter secrets.

### Audit

`agent_steps.output` for a custom webhook call stores:

```json
{
  "http_status": 200,
  "duration_ms": 1823,
  "url_host": "n8n.example.com",
  "body_sha256": "<hex>",           // of request body
  "response_size_bytes": 1453,
  "response_sha256": "<hex>"         // of response body
}
```

No raw request or response body in the step. If customers need content,
they read it from n8n's own audit.

### Runtime scope for Codex (PR5)

1. **`apps/crm/src/lib/ai-agent/webhook-caller.ts`** — new, implements all
   checks above. Pure function plus the `CustomWebhookInvocation` input.
   Returns `CustomWebhookResult`. Does NOT access the DB — caller
   upstream resolves the tool row and allowlist.

2. **Executor** (`apps/crm/src/lib/ai-agent/executor.ts`): in
   `executeToolCall`, when `tool.execution_mode === 'n8n_webhook'`:
   - Resolve allowlist for the org.
   - Call `invokeCustomWebhook({ tool, payload, context, allowlist })`.
   - Write the step output as spec'd above.
   - Map `success === false` into the existing tool-result channel the
     LLM reads. Treat timeout / SSRF rejection / non-2xx identically
     from the LLM's perspective: "tool failed, you can react".

3. **`apps/crm/src/actions/ai-agent/tools.ts`**:
   - Remove the PR5 rejection from `createCustomTool`. Now accepts
     `execution_mode === 'n8n_webhook'` iff:
     - `webhook_url` passes URL parse + HTTPS + allowlist match.
     - `webhook_secret.length >= 32`.
     - `native_handler` is null.
   - Add `createCustomWebhookTool(input: CreateCustomWebhookToolInput)`
     as a focused helper that the UI calls, internally forwarding to
     `createCustomTool` after validation.
   - `updateTool` keeps working for `is_enabled` toggles and schema
     edits; when `execution_mode` or `webhook_url` change, re-run the
     allowlist + HTTPS validation.

4. **`apps/crm/src/actions/ai-agent/webhook-allowlist.ts`** (new):

```ts
listAllowedDomains(): Promise<string[]>;
addAllowedDomain(input: AddAllowedDomainInput): Promise<string[]>;
removeAllowedDomain(domain: string): Promise<string[]>;
```

Rules:
- admin/owner only.
- `addAllowedDomain` normalizes: `new URL("https://" + input).hostname.toLowerCase()`.
  Reject any normalized hostname that resolves to a private IP right now
  (same checks as the webhook caller) — stops admins from adding
  `localhost` or similar by accident.
- All three read/write `organizations.settings.webhook_allowlist.domains`.

### Tests Codex must add

- `webhook-caller.ts`:
  - Rejects `http://`, `file://`, `ftp://`.
  - Rejects hostname not in allowlist.
  - Rejects resolved IP in every private range above (parameterize).
  - Rejects DNS rebind (allowed host resolves to internal IP).
  - Rejects 3xx redirect to internal host.
  - Aborts read after body cap.
  - Aborts after timeout.
  - Happy path: HTTPS 2xx with HMAC header structured correctly.
- `tools.ts`:
  - `createCustomTool(n8n_webhook)` rejects non-HTTPS url.
  - Rejects domain not in allowlist.
  - Rejects secret shorter than 32 chars.
  - Happy path creates the row with `native_handler=null`.
- `webhook-allowlist.ts`:
  - Normalizes input to bare hostname.
  - Rejects private-IP-resolving hostnames.
  - Admin gate.

### UI scope for Claude (PR5 follow-up)

- **ToolsTab**: "+ Webhook customizado" button alongside the Decision
  Intelligence modal. Opens a new sheet with URL, secret, schema JSON
  editor. Separate card style in the tools list (webhook icon + URL
  host badge).
- **DecisionIntelligenceModal**: unchanged — only native presets.
- **Settings**: new page (or section in the existing settings page) for
  `webhook_allowlist.domains` management (list + add + remove).
  Suggested location: `/settings/integrations` or a subsection of
  `/automations/agents` for now.
- **Flag**: when `webhook_allowlist.domains` is empty, the "+ Webhook
  customizado" button renders disabled with a link to the settings
  page — makes the "allowlist first" rule discoverable.

### Out of scope (still)

- RAG (PR6).
- Notifications + Agendamento (PR7).
- Meta-IA builders (PR8).
## 2026-04-23 22:15 - Codex - PR5 runtime handoff

- Runtime PR5 branch: `codex/ai-agent-pr5-runtime`
- Implementado `apps/crm/src/lib/ai-agent/webhook-caller.ts` com 9 gates de SSRF:
  HTTPS only, hostname exato na allowlist, DNS resolve A/AAAA, bloqueio de IPs privados/reservados, porta 443, timeout, no redirects, cap de resposta e HMAC `X-Persia-Signature`.
- Liberado `createCustomWebhookTool` e `updateTool` para `execution_mode='n8n_webhook'`, com validacao de allowlist e `WEBHOOK_SECRET_MIN_LENGTH`.
- Adicionadas actions `listAllowedDomains`, `addAllowedDomain`, `removeAllowedDomain` em `apps/crm/src/actions/ai-agent/webhook-allowlist.ts`.
- Executor agora roteia tools `n8n_webhook` via `invokeCustomWebhook()` e persiste em `agent_steps.output` apenas o resumo auditavel (`http_status`, `duration_ms`, `url_host`, `body_sha256`, `response_size_bytes`, `response_sha256`, `error/code` quando houver).
- Nenhum corpo bruto de request/response e salvo no audit step.
- Testes adicionados em `apps/crm/src/__tests__/ai-agent-pr5-runtime.test.ts`; o teste legado da PR3 foi atualizado para o comportamento novo.

---

## 2026-04-23 — Claude — PR5.5 contract additions: message debouncing

Branch: `claude/ai-agent-pr5.5-contracts` (this PR).

Start of Fase 1 (production-readiness blockers). PR5.5 fixes the #1 bug
that would hit the moment `native_agent_enabled` goes true on any real org:
a lead sending "oi" + "tudo bem?" in 2s produces two parallel runs, two
fragmented replies, and a race on `current_stage_id`.

Additive only. No existing PR1–PR5 behavior is changed until Codex ships
the runtime.

### Files shipped

- `packages/shared/src/ai-agent/debounce.ts` — new
  - `PendingMessage` row shape
  - `DebounceFlushBatch` / `DebounceFlushResult`
  - Constants: `DEBOUNCE_WINDOW_MS_DEFAULT=10000`, `DEBOUNCE_WINDOW_MS_MIN=3000`, `DEBOUNCE_WINDOW_MS_MAX=30000`
  - `clampDebounceWindowMs(value)` helper (UI + server both call this)
- `packages/shared/src/ai-agent/types.ts` — additive
  - `AgentConfig.debounce_window_ms: number` (non-nullable at the TS level; migration 019 adds column with DEFAULT 10000)
  - `CreateAgentInput.debounce_window_ms?: number` (optional; runtime applies default + clamp)
  - `UpdateAgentInput` auto-picks via `Partial<CreateAgentInput>`
- `packages/shared/src/ai-agent/index.ts` re-exports `debounce`

### Architecture — this is a real change to the webhook flow

**Before PR5.5** (synchronous, current):

```
UAZAPI webhook -> parse/verify/match -> tryNativeAgent -> executor -> Claude -> UAZAPI send -> 200 OK
```

Latency from receive to 200 OK: 3–10 seconds.

**After PR5.5** (enqueue + out-of-band flush):

```
UAZAPI webhook -> parse/verify/match -> enqueueDebounced -> 200 OK       // <200ms
pg_cron every 2s -> pg_net POST /api/ai-agent/debounce-flush (secret)
flush endpoint -> finds ready conversations -> executor -> Claude -> UAZAPI send
```

Webhook returns 200 OK in <200ms regardless of LLM latency. No more
"UAZAPI webhook timeout" risk when Claude is slow.

### Migration 019 shape — Codex writes this

```sql
BEGIN;

-- Extensions (safe if already present; Supabase ships pg_cron + pg_net)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- 1. Debounce config column on agent_configs.
ALTER TABLE public.agent_configs
  ADD COLUMN debounce_window_ms INTEGER NOT NULL DEFAULT 10000
  CHECK (debounce_window_ms >= 3000 AND debounce_window_ms <= 30000);

-- 2. Flush scheduling marker on agent_conversations.
ALTER TABLE public.agent_conversations
  ADD COLUMN next_flush_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_agent_conversations_next_flush
  ON public.agent_conversations (next_flush_at)
  WHERE next_flush_at IS NOT NULL;

-- 3. pending_messages.
CREATE TABLE IF NOT EXISTS public.pending_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_conversation_id UUID NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  message_type TEXT NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text','image','audio','video','document','location','other')),
  media_ref TEXT,
  inbound_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL,
  flushed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency on webhook retries: unique on non-null inbound_message_id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_messages_inbound_unique
  ON public.pending_messages (inbound_message_id)
  WHERE inbound_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pending_messages_conversation_unflushed
  ON public.pending_messages (agent_conversation_id, received_at)
  WHERE flushed_at IS NULL;

ALTER TABLE public.pending_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pending_messages_select" ON public.pending_messages
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner','admin'));
CREATE POLICY "pending_messages_insert" ON public.pending_messages
  FOR INSERT WITH CHECK (get_user_org_role(organization_id) IN ('owner','admin'));
CREATE POLICY "pending_messages_update" ON public.pending_messages
  FOR UPDATE USING (get_user_org_role(organization_id) IN ('owner','admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner','admin'));

-- 4. pg_cron: every 2s, POST the flush endpoint via pg_net.
--    Operator must set the two db settings below before the cron does
--    anything real (see "Operator steps").
SELECT cron.schedule(
  'ai-agent-debounce-flush',
  '2 seconds',
  'SELECT net.http_post(
     url     := current_setting(''app.settings.debounce_flush_url'', true),
     headers := jsonb_build_object(
       ''Content-Type'', ''application/json'',
       ''X-Persia-Cron-Secret'', current_setting(''app.settings.debounce_flush_secret'', true)
     ),
     body    := ''{}''::jsonb,
     timeout_milliseconds := 5000
   );'
);

COMMIT;
```

Rollback (manual):

```sql
BEGIN;
  SELECT cron.unschedule('ai-agent-debounce-flush');
  DROP TABLE IF EXISTS public.pending_messages;
  ALTER TABLE public.agent_conversations DROP COLUMN IF EXISTS next_flush_at;
  ALTER TABLE public.agent_configs DROP COLUMN IF EXISTS debounce_window_ms;
COMMIT;
```

### Operator steps (required post-migration)

```sql
ALTER DATABASE postgres SET app.settings.debounce_flush_url    TO 'https://crm.funilpersia.top/api/ai-agent/debounce-flush';
ALTER DATABASE postgres SET app.settings.debounce_flush_secret TO '<random 48 chars>';
```

Plus set `PERSIA_DEBOUNCE_FLUSH_SECRET=<same>` in the app env (EasyPanel).
Missing secret or URL = cron runs but `pg_net.http_post` fails silently; no
messages leak, `next_flush_at` keeps advancing, nothing crashes.

### Runtime scope for Codex (PR5.5)

**1. `apps/crm/src/lib/ai-agent/debounce.ts` — new, server-only**

```ts
interface EnqueueDebouncedParams {
  db: AgentDb;
  orgId: string;
  agentConversationId: string;
  debounceWindowMs: number;             // from agent_configs, already clamped
  inboundMessageId: string | null;
  text: string;
  messageType: PendingMessage["message_type"];
  mediaRef: string | null;
  receivedAt: Date;
}

// Insert pending_messages row + set next_flush_at if this is the first
// unflushed message on the conversation. Idempotent via the unique index
// on inbound_message_id (ON CONFLICT DO NOTHING).
export async function enqueueDebounced(p: EnqueueDebouncedParams): Promise<void>;

interface FlushReadyConversationsParams {
  db: AgentDb;
  now?: Date;
  maxConversations?: number;            // default 50
}

// Pulls up to `maxConversations` where next_flush_at <= now, acquires a
// per-conversation advisory lock, loads the pending batch, invokes the
// existing executor path, marks rows flushed, clears next_flush_at in the
// same transaction. Returns a DebounceFlushResult (counts + per-conv detail
// capped at 50).
export async function flushReadyConversations(p: FlushReadyConversationsParams): Promise<DebounceFlushResult>;
```

**2. Webhook router update (`apps/crm/src/app/api/whatsapp/webhook/route.ts`)**

Replace the current `tryNativeAgent(...)` call with `tryEnqueueForNativeAgent`:

```ts
if (nativeEnabled) {
  const enqueued = await tryEnqueueForNativeAgent({
    supabase, orgId, provider, msg, requestId,
  });
  if (enqueued.handled) return NextResponse.json(enqueued.response);
  // handled:false falls through to processIncomingMessage (legacy)
}
```

`tryEnqueueForNativeAgent` lives in `executor.ts` (or a new
`enqueue.ts`) next to `tryNativeAgent`, same fail-closed rules:

| Outcome | Return |
|---|---|
| Feature flag off | `{ handled: false }` |
| No active agent_config | `{ handled: false }` |
| Exception during enqueue | `{ handled: false }` + structured log |
| Happy path | `{ handled: true, response: { ok: true, skipped: "debounced", enqueued: true } }` |

Forbidden changes in the webhook route (still):

- parsing UAZAPI payload
- signature verification
- media download
- `messages` insertion

**3. Flush endpoint `apps/crm/src/app/api/ai-agent/debounce-flush/route.ts` — new**

- POST only. Header `X-Persia-Cron-Secret` must match env
  `PERSIA_DEBOUNCE_FLUSH_SECRET` via `timingSafeEqual`.
- Body is ignored.
- Response: 200 with `DebounceFlushResult` JSON.
- Secret mismatch: 401 with `{ ok: false }`. No timing hints, no
  per-conversation data.
- Without `PERSIA_DEBOUNCE_FLUSH_SECRET` env: 503
  (`{ ok: false, error: "flush_secret_missing" }`), no work done.
- Never throws. Any per-conversation failure is counted in
  `DebounceFlushResult.errors` and logged; other conversations still run.
- Uses Supabase service-role client (no user session here).

**4. Executor change — `executeAgent` accepts a pre-aggregated inbound**

The webhook path previously passed a single `IncomingMessage`. The flush
path now passes a synthetic aggregated message:

- `text` = `DebounceFlushBatch.concatenated_text` (received_at ASC, joined with `"\n"`).
- `messageId` = `DebounceFlushBatch.latest_inbound_message_id`.

Executor internals do not change — the aggregation is done before the
call. `tryNativeAgent` (sync) stays as-is for compatibility but webhook no
longer calls it; only tester does.

**5. Tester unchanged**

`testAgent` keeps calling `executeTesterAgent` directly, never the debounce
path. Dry-run still forced.

### Concurrency guarantees Codex must preserve

1. **Per-conversation single-flight**: when a run is already executing for
   conversation X, a new inbound inserts into `pending_messages` but does
   NOT reset `next_flush_at`. The cron tick after the running run completes
   picks up the new rows. Use advisory lock
   `pg_try_advisory_xact_lock(hashtext('ai-agent:' || agent_conversation_id))`
   around the flush per conversation.
2. **No cross-org interference**: every query in the flush path filters by
   `organization_id`. The flush endpoint is service-role but still scopes
   every read/write.
3. **Idempotent inbound**: the unique index on
   `pending_messages(inbound_message_id)` (where not null) prevents
   duplicate runs on webhook retries. Codex enqueue helper uses
   `ON CONFLICT DO NOTHING`.
4. **Flush-after-flush window reset**: when the flush completes, set
   `agent_conversations.next_flush_at = NULL` in the same transaction that
   marks pending_messages flushed. Next inbound starts a fresh window.
5. **Timeout during Claude call**: if executor takes longer than the cron
   interval, a concurrent cron tick tries to lock the same conversation
   and fails the advisory try-lock — it simply skips that row; the next
   tick after the running run completes will pick it up naturally.

### Tests Codex must add

- `debounce.ts`:
  - burst of 5 messages within `debounce_window_ms` → one run, one reply,
    `pending_messages.flushed_at` set on all 5, one step-sequence in
    `agent_steps`.
  - message arriving during a run-in-progress: not flushed in the current
    cycle; next cycle picks it up.
  - retry with same `inbound_message_id`: second enqueue is idempotent
    (unique index violates cleanly, handler returns without error).
  - per-agent window override honored (agent with `debounce_window_ms=3000`
    flushes faster than default).
- webhook route:
  - flag on + agent_config: returns 200 with
    `{ skipped: "debounced", enqueued: true }`.
  - flag off: legacy path unchanged.
  - exception during enqueue: falls through to legacy, 200 kept.
- flush endpoint:
  - secret mismatch → 401.
  - no secret env → 503.
  - happy path → `DebounceFlushResult` with correct counts.
  - per-conversation error doesn't block others.
  - two concurrent POSTs: advisory lock ensures exactly one executes a
    given conversation; the other returns that row with `status: "skipped"`.

### UI scope for Claude (follow-up)

- `RulesTab` "Guardrails" card gets a new row: "Agregar mensagens por
  (segundos)" slider bound to `debounce_window_ms` (range 3–30, default 10).
- Tooltip: "Espera esse tempo por novas mensagens do mesmo lead antes de
  responder, pra evitar respostas fragmentadas quando o lead digita em
  pedaços curtos."
- Server action `updateAgent` already accepts `debounce_window_ms` via
  `Partial<CreateAgentInput>` — Codex clamps to range on write.
- No pending_messages dashboard in this PR. Operators read it via Supabase
  if needed; a future PR can add "mensagens na fila" count per conversation
  if support traffic justifies.

### Out of scope (still)

- PR5.7 context summarization (next in Fase 1; consumes the flushed batch).
- PR5.6 handoff notification (reads lead phone + template).
- PR5.8 reactivate bot (admin action clears `human_handoff_at`).
- PR6 RAG / PR7 Notifications+Calendar / PR8 Meta-IA — unchanged roadmap.
