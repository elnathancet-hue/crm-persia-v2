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

## 2026-04-23 22:40 — Codex — PR5.5 runtime handoff

Branch: `codex/ai-agent-pr5.5-runtime`.

Shipped in runtime:

- `apps/crm/supabase/migrations/019_ai_agent_debounce.sql`
  - adds `agent_configs.debounce_window_ms`
  - adds `agent_conversations.next_flush_at`
  - adds internal flush lease columns:
    - `flush_claimed_at`
    - `flush_claim_expires_at`
  - creates `pending_messages`
  - enables RLS
  - adds helper SQL functions:
    - `enqueue_pending_message(...)`
    - `claim_agent_conversation_flush(...)`
    - `complete_agent_conversation_flush(...)`
    - `release_agent_conversation_flush(...)`
  - schedules `cron.schedule('ai-agent-debounce-flush', '2 seconds', ...)`

- `apps/crm/src/lib/ai-agent/debounce.ts`
  - `enqueueDebounced(...)`
  - `flushReadyConversations(...)`
  - uses DB lease helpers rather than Postgres advisory locks. This preserves the
    same single-flight guarantee in the app/runtime context without depending on
    a sticky SQL connection for the whole Claude call duration.

- `apps/crm/src/lib/ai-agent/executor.ts`
  - new `tryEnqueueForNativeAgent(...)` for the webhook router
  - new `executeDebouncedBatch(...)` for flush processing
  - existing `tryNativeAgent(...)` left intact for compatibility / non-webhook use

- `apps/crm/src/app/api/whatsapp/webhook/route.ts`
  - now calls `tryEnqueueForNativeAgent(...)`
  - legacy `processIncomingMessage(...)` remains the fallback path

- `apps/crm/src/app/api/ai-agent/debounce-flush/route.ts`
  - POST only
  - validates `X-Persia-Cron-Secret` against `PERSIA_DEBOUNCE_FLUSH_SECRET`
  - returns `DebounceFlushResult`
  - fail-closed:
    - `401` on secret mismatch
    - `503` when env secret is missing

- `apps/crm/src/actions/ai-agent/{utils,configs}.ts`
  - now clamp/persist `debounce_window_ms`

Behavioral notes for Claude/UI:

- The slider can now safely write `debounce_window_ms`; server-side clamp is in
  place even if the client sends an out-of-range value.
- During an active flush/run, new inbound messages stay queued and do not start
  a parallel agent run. When the current flush completes, remaining queued rows
  are re-scheduled immediately (`next_flush_at = completed_at`) for the next tick.
- If a debounced batch hits `human_handoff_at`, `executeDebouncedBatch(...)`
  returns `status: "skipped"` and the batch is still released cleanly.

Validation on this branch:

- `pnpm --filter @persia/crm build` ✅
- `pnpm --filter @persia/crm typecheck` ✅
- `pnpm -r typecheck` ✅
- `pnpm --filter @persia/crm test -- src/__tests__/ai-agent-pr5.5-runtime.test.ts` ✅
  - suite ran full CRM tests in practice: `16 files / 163 tests` green

Operator reminder after merge/deploy:

```sql
ALTER DATABASE postgres SET app.settings.debounce_flush_url TO 'https://crm.funilpersia.top/api/ai-agent/debounce-flush';
ALTER DATABASE postgres SET app.settings.debounce_flush_secret TO '<same secret as app env>';
```

App env required:

```env
PERSIA_DEBOUNCE_FLUSH_SECRET=<same secret as DB setting>
```

---

## 2026-04-23 — Claude — PR5.7 contract additions: context summarization

Branch: `claude/ai-agent-pr5.7-contracts` (this PR).

Fase 1 PR 2/4. Fixes the third production blocker from the closing plan:
`agent_conversations.history_summary` exists since PR1 but the executor
ignores it, so a 15-turn conversation feeds every Claude call with the full
raw history — tokens grow linearly, `cost_ceiling_tokens` fires early.

Inspired by the `gerarNovoContexto` node in the 03 Console n8n workflow.
Trigger is hybrid: every N runs OR after N accumulated tokens, whichever
fires first. Additive contract only; runtime stays unchanged until Codex
ships the next PR.

### Files shipped

- `packages/shared/src/ai-agent/summarization.ts` — new
  - Thresholds + constants (`CONTEXT_SUMMARY_TURN_THRESHOLD_DEFAULT=10`,
    `CONTEXT_SUMMARY_TOKEN_THRESHOLD_DEFAULT=20000`,
    `CONTEXT_SUMMARY_RECENT_MESSAGES_DEFAULT=6`, each with MIN/MAX)
  - `ContextSummarizationConfig` shape + `DEFAULT_CONTEXT_SUMMARIZATION`
  - Clamp helpers: `clampTurnThreshold`, `clampTokenThreshold`, `clampRecentMessagesCount`
  - `ConversationSummaryCounters` + `shouldTriggerSummarization(counters, config)`
  - Audit types: `SummarizationStepInput`, `SummarizationStepOutput`
- `packages/shared/src/ai-agent/types.ts` — additive only
  - `AgentConfig.context_summary_turn_threshold?: number`
  - `AgentConfig.context_summary_token_threshold?: number`
  - `AgentConfig.context_summary_recent_messages?: number`
  - `AgentConversation.history_summary_updated_at?: string | null`
  - `AgentConversation.history_summary_run_count?: number`
  - `AgentConversation.history_summary_token_count?: number`
  - `CreateAgentInput` picks up the three new optional fields
  - `AgentStepType` gains `"summarization"` variant
- `packages/shared/src/ai-agent/index.ts` re-exports `summarization`

### Migration 020 shape — Codex writes this

```sql
BEGIN;

ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS context_summary_turn_threshold INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS context_summary_token_threshold INTEGER NOT NULL DEFAULT 20000,
  ADD COLUMN IF NOT EXISTS context_summary_recent_messages INTEGER NOT NULL DEFAULT 6;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_configs_turn_threshold_check') THEN
    ALTER TABLE public.agent_configs
      ADD CONSTRAINT agent_configs_turn_threshold_check
      CHECK (context_summary_turn_threshold BETWEEN 3 AND 50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_configs_token_threshold_check') THEN
    ALTER TABLE public.agent_configs
      ADD CONSTRAINT agent_configs_token_threshold_check
      CHECK (context_summary_token_threshold BETWEEN 5000 AND 100000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_configs_recent_messages_check') THEN
    ALTER TABLE public.agent_configs
      ADD CONSTRAINT agent_configs_recent_messages_check
      CHECK (context_summary_recent_messages BETWEEN 2 AND 20);
  END IF;
END
$$;

ALTER TABLE public.agent_conversations
  ADD COLUMN IF NOT EXISTS history_summary_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS history_summary_run_count INTEGER NOT NULL DEFAULT 0
    CHECK (history_summary_run_count >= 0),
  ADD COLUMN IF NOT EXISTS history_summary_token_count INTEGER NOT NULL DEFAULT 0
    CHECK (history_summary_token_count >= 0);

-- Relax agent_steps.step_type check to accept the new 'summarization' value.
ALTER TABLE public.agent_steps
  DROP CONSTRAINT IF EXISTS agent_steps_step_type_check;

ALTER TABLE public.agent_steps
  ADD CONSTRAINT agent_steps_step_type_check
  CHECK (step_type IN ('llm','tool','guardrail','summarization'));

COMMIT;
```

Rollback (manual):

```sql
BEGIN;
  ALTER TABLE public.agent_steps DROP CONSTRAINT IF EXISTS agent_steps_step_type_check;
  ALTER TABLE public.agent_steps
    ADD CONSTRAINT agent_steps_step_type_check
    CHECK (step_type IN ('llm','tool','guardrail'));
  ALTER TABLE public.agent_conversations
    DROP COLUMN IF EXISTS history_summary_token_count,
    DROP COLUMN IF EXISTS history_summary_run_count,
    DROP COLUMN IF EXISTS history_summary_updated_at;
  ALTER TABLE public.agent_configs
    DROP COLUMN IF EXISTS context_summary_recent_messages,
    DROP COLUMN IF EXISTS context_summary_token_threshold,
    DROP COLUMN IF EXISTS context_summary_turn_threshold;
COMMIT;
```

### Executor flow changes — Codex implements this

#### 1. Context loader reads summary instead of full history

Today the executor loads every CRM message for the conversation. After
PR5.7:

```ts
async function buildLlmMessages(agentConv, config) {
  const recentLimit = config.context_summary_recent_messages ?? 6;
  const recentMessages = await loadRecentMessages(agentConv.crm_conversation_id, recentLimit);

  const priorContext = agentConv.history_summary
    ? [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Contexto consolidado da conversa ate aqui:\n\n${agentConv.history_summary}`,
            },
          ],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "Contexto carregado." }],
        },
      ]
    : [];

  return [...priorContext, ...recentMessages];
}
```

When `history_summary` is null (new conversation or never summarized yet),
fall back to the existing behavior (load recent N messages only — not the
full history, since that is exactly the problem we're fixing). For a
brand-new conversation recentLimit is fine; for a pre-PR5.7 conversation
without a summary yet, the next run will cross the threshold and write
one.

#### 2. Counter maintenance on every successful run

At the end of `executeAgent` after `finishRun(status='succeeded')`:

```sql
UPDATE agent_conversations
SET
  history_summary_run_count = history_summary_run_count + 1,
  history_summary_token_count = history_summary_token_count + <tokens_input + tokens_output>,
  updated_at = now()
WHERE id = $agent_conversation_id AND organization_id = $org_id;
```

Skip the increment on `failed` / `fallback` runs — they are not real
conversational turns.

#### 3. Trigger check + summarization step

After the counter increment, read the fresh counters and the config
thresholds:

```ts
if (shouldTriggerSummarization(counters, cfg)) {
  await runSummarization({ db, orgId, agentConv, runId, cfg });
}
```

`runSummarization` is in-band (after the assistant reply was already sent
to UAZAPI, before `executeAgent` returns). It:

1. Loads `history_summary` (previous, may be null) + all messages since
   `history_summary_updated_at ?? agent_conversation.created_at` ordered
   by `created_at ASC`.
2. Calls Claude with the summarization prompt (template below).
3. On success: writes `history_summary = <new text>`,
   `history_summary_updated_at = now()`, zeroes
   `history_summary_run_count` and `history_summary_token_count`.
   Persists an `agent_steps` row with `step_type='summarization'`,
   `input` = `SummarizationStepInput`, `output` = `SummarizationStepOutput`.
4. On failure: logs, inserts a failed `agent_steps` row, does NOT reset
   the counters (so the next run retries). Never throws out of
   `executeAgent`.

Model used: `agent.model`. Summarization cost is counted in the
`agent_runs.tokens_*` of the parent run (keeps org cost tracking in one
place).

Parent-run attribution: the summarization step points to the run whose
completion triggered the summarization via `agent_steps.run_id`.

#### 4. Summarization prompt template (Codex copies this verbatim)

System:

```
Voce e um assistente que consolida o contexto de uma conversa entre um
agente IA e um lead. Produza um resumo estruturado em prosa cobrindo os
topicos abaixo, na mesma ordem, sem listas numeradas:

- Perfil do lead: nome, telefone, empresa, cargo (se conhecidos). Escreva
  "nao informado" nos campos faltantes.
- Dores e objetivos: principais motivacoes, problemas, metas que apareceram.
- Etapa do funil: onde esta a conversa no processo de vendas/atendimento.
- Estado conversacional: nivel de qualificacao do lead, intencao de
  continuar, tom geral. Use adjetivos concretos.
- Historico narrativo: em ate 3 paragrafos curtos, conte o que aconteceu
  desde o ultimo resumo. Preserve decisoes tomadas, promessas do agente,
  duvidas pendentes. NAO inclua transcricoes literais — isto e um briefing
  pra o proximo turno do agente.

Responda apenas com o resumo. Sem prefacios, sem JSON, sem markdown.
Portugues brasileiro, 400 a 800 palavras.
```

User (with previous summary):

```
Resumo anterior:

{{previous_summary}}

Mensagens novas desde o ultimo resumo (em ordem cronologica):

{{messages_formatted_as_role_text_pairs}}

Gere o novo resumo consolidado.
```

User (without previous summary):

```
Mensagens da conversa (em ordem cronologica):

{{messages_formatted_as_role_text_pairs}}

Gere o resumo consolidado.
```

Max tokens on the Anthropic call: 1200.

#### 5. Tester untouched

`executeTesterAgent` does NOT trigger summarization. Tester conversations
are synthetic and short-lived.

### Concurrency guarantees Codex must preserve

1. The summarization runs serially after the main run response is sent.
   If the same conversation gets a new inbound during summarization, the
   debounce flush (PR5.5) already gates on the same lease — the new
   inbound waits for the current flush (including summarization) to
   complete before the next cycle.
2. Counter updates are a single UPDATE statement scoped by
   `organization_id` — no read-then-write race.
3. If summarization fails, the next successful run WITH the counters
   still above threshold will retry. Repeated failures never block the
   main conversation.

### Tests Codex must add

- `shouldTriggerSummarization`:
  - turn threshold reached — returns true.
  - token threshold reached — returns true.
  - neither — returns false.
  - missing counters — treats as 0.
- Executor integration:
  - 10 successful runs on the same conversation trigger one summarization
    step; `history_summary` populated; counters reset.
  - tokens-first trigger: single run crossing 20k tokens fires the
    summarization.
  - summarization failure: logs, inserts failed step, counters NOT reset,
    next run retries.
  - `step_type='summarization'` row persisted with the expected input/
    output shape.
  - failed / fallback runs do NOT increment counters.
- Context loader:
  - with summary present — injects summary as first message pair, then
    last K messages.
  - with summary null — loads only last K messages (not full history).
  - `context_summary_recent_messages` override honored.
- Migration:
  - idempotent re-run.
  - existing rows get the NOT NULL default values without error.
  - RLS unchanged on the extended tables.

### UI scope for Claude (follow-up)

- `RulesTab` "Guardrails" card gets three new rows under the existing
  debounce slider:
  - `context_summary_turn_threshold` slider 3–50 (default 10).
  - `context_summary_token_threshold` slider 5k–100k step 1k (default 20k).
  - `context_summary_recent_messages` slider 2–20 (default 6).
- Tooltip: "Quando a conversa atingir um desses limites, o agente resume
  o historico pra manter o custo sob controle. O resumo fica no topo das
  proximas mensagens."
- `AuditTab` step inspector already renders any step_type via the output
  shape — no change needed there beyond showing the new "summarization"
  label. Codex may want a dedicated color in the audit view; if so,
  that's a small follow-up.

### Out of scope (still)

- PR5.6 handoff notification (next; depends on summary for the wa.me
  link narrative).
- PR5.8 reactivate bot.
- PR6+ unchanged.

## 2026-04-23 23:20 - Codex - PR5.7 runtime handoff

- Branch: `codex/ai-agent-pr5.7-runtime`
- Runtime delivered:
  - `020_ai_agent_context_summarization.sql`
  - local helper `apps/crm/src/lib/ai-agent/summarization.ts`
  - executor now injects `history_summary + last K messages`
  - successful runs increment `history_summary_run_count` /
    `history_summary_token_count`
  - in-band summarization step persisted as `agent_steps.step_type='summarization'`
  - tester path explicitly skips summarization
  - config/actions normalize and persist the three new threshold fields
- Important implementation note:
  - I kept the current webhook/runtime assumption that the inbound CRM
    message is already persisted before `executeAgent`, so the executor
    does NOT append `params.msg` again when `inboundMessageId` +
    `crm_conversation_id` are present. This avoids duplicating the same
    inbound text in the Claude context during debounced flushes.
- Validation on this branch:
  - `pnpm --filter @persia/crm build` ✅
  - `pnpm --filter @persia/crm test -- src/__tests__/ai-agent-pr5.7-runtime.test.ts` ✅
    - Vitest ran the whole CRM suite here: `17 files / 174 tests` green.
  - `pnpm --filter @persia/crm typecheck` ⚠️ still failing for the same
    repo-local `.next/types/**/*.ts` issue (missing generated files in
    `apps/crm/tsconfig.json` include). The PR5.7 code itself builds and
    passes Next's type validation during `next build`.
- Claude UI follow-up is unblocked for the 3 RulesTab sliders.

---

## 2026-04-23 — Claude — PR5.6 contract additions: handoff notification

Branch: `claude/ai-agent-pr5.6-contracts` (this PR).

Fase 1 PR 3/4. When `stop_agent` fires today, `human_handoff_at` is set and
a `lead_activities` note is written — but the human team has no outbound
ping. The JSON 03 Encaminhamento workflow sends a WhatsApp message to a
configured group with lead name, phone, a short summary, and a `wa.me`
deep link. PR5.6 brings that inside the native agent.

Additive. Existing PR5/PR5.5/PR5.7 behavior unchanged until Codex ships
the runtime.

### Files shipped

- `packages/shared/src/ai-agent/handoff.ts` — new
  - `HandoffNotificationTargetType` = `'phone' | 'group'`
  - `HandoffNotificationTarget`, `HandoffNotificationConfig`
  - `HandoffNotificationVariables` — the fixed set the renderer fills
  - `HANDOFF_DEFAULT_TEMPLATE` — sensible PT-BR default with all six vars
  - `HANDOFF_TEMPLATE_MAX_LENGTH` (1500), `HANDOFF_PHONE_MIN_DIGITS` (10), `HANDOFF_PHONE_MAX_DIGITS` (15)
  - `renderHandoffTemplate(template, vars)` — `{{var}}` substitution; unknown keys render as empty
  - `listTemplatePlaceholders` + `isKnownTemplateVariable` helpers for the UI editor
  - `SetHandoffTargetInput` DTO
- `packages/shared/src/ai-agent/types.ts` — additive only
  - `AgentConfig.handoff_notification_enabled?: boolean`
  - `AgentConfig.handoff_notification_target_type?: HandoffNotificationTargetType | null`
  - `AgentConfig.handoff_notification_target_address?: string | null`
  - `AgentConfig.handoff_notification_template?: string | null`
  - Same four fields on `CreateAgentInput`
  - Top of file imports `HandoffNotificationTargetType` from `./handoff`
- `packages/shared/src/ai-agent/index.ts` re-exports `handoff`

### Migration 021 shape — Codex writes this

```sql
BEGIN;

ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS handoff_notification_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS handoff_notification_target_type TEXT,
  ADD COLUMN IF NOT EXISTS handoff_notification_target_address TEXT,
  ADD COLUMN IF NOT EXISTS handoff_notification_template TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_configs_handoff_target_type_check') THEN
    ALTER TABLE public.agent_configs
      ADD CONSTRAINT agent_configs_handoff_target_type_check
      CHECK (handoff_notification_target_type IS NULL
        OR handoff_notification_target_type IN ('phone','group'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_configs_handoff_target_consistency_check') THEN
    ALTER TABLE public.agent_configs
      ADD CONSTRAINT agent_configs_handoff_target_consistency_check
      CHECK (
        handoff_notification_enabled = false
        OR (
          handoff_notification_target_type IS NOT NULL
          AND handoff_notification_target_address IS NOT NULL
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_configs_handoff_template_length_check') THEN
    ALTER TABLE public.agent_configs
      ADD CONSTRAINT agent_configs_handoff_template_length_check
      CHECK (
        handoff_notification_template IS NULL
        OR char_length(handoff_notification_template) <= 1500
      );
  END IF;
END
$$;

COMMIT;
```

Rollback (manual):

```sql
BEGIN;
  ALTER TABLE public.agent_configs
    DROP CONSTRAINT IF EXISTS agent_configs_handoff_template_length_check,
    DROP CONSTRAINT IF EXISTS agent_configs_handoff_target_consistency_check,
    DROP CONSTRAINT IF EXISTS agent_configs_handoff_target_type_check,
    DROP COLUMN IF EXISTS handoff_notification_template,
    DROP COLUMN IF EXISTS handoff_notification_target_address,
    DROP COLUMN IF EXISTS handoff_notification_target_type,
    DROP COLUMN IF EXISTS handoff_notification_enabled;
COMMIT;
```

The consistency CHECK is the important guardrail: an operator cannot flip
`enabled=true` without providing target fields; avoids silent drops at send
time.

### Runtime scope for Codex (PR5.6)

#### 1. `apps/crm/src/lib/ai-agent/handoff-notification.ts` — new

```ts
interface SendHandoffNotificationParams {
  db: AgentDb;
  orgId: string;
  runId: string;
  stepOrderIndex: number;
  config: AgentConfig;
  conversation: AgentConversation;
  leadId: string;
  handoffReason: string;
  provider: WhatsAppProvider | null; // null during executor-initiated handoff before provider is resolved
  anthropicClient: Anthropic;
}

// Always fail-soft. Returns whether the notification was attempted + any
// error. The executor / stop_agent handler logs a step regardless.
interface SendHandoffNotificationResult {
  attempted: boolean;
  sent: boolean;
  error?: string;
  audit: Record<string, unknown>; // sanitized (no message body, hashes only)
}

export async function sendHandoffNotification(
  params: SendHandoffNotificationParams,
): Promise<SendHandoffNotificationResult>;
```

Internal flow:

1. Guard on `config.handoff_notification_enabled === true` AND target fields
   populated AND `provider != null`. Any miss → `{ attempted: false, sent: false }`.
2. Load lead (`leads` by id scoped by org) for `name` + `phone`.
3. Build `summary`:
   - If `conversation.history_summary` exists, take first 500 chars.
   - Else, one-shot Claude call to `config.model`, system prompt
     "Gere em 2 frases, em portugues brasileiro, o que aconteceu nessa
     conversa pra alguem da equipe assumir." Max tokens 200.
   - On Claude failure: fall back to the plain text "Lead acionou o agente
     e pediu atendimento humano." Do not block the notification on this.
4. Build `wa_link` = `${process.env.PERSIA_APP_URL ?? 'https://crm.funilpersia.top'}/chat/${conversation.crm_conversation_id}`.
   Env missing → use the hardcoded default.
5. Build `HandoffNotificationVariables`:
   - `lead_name` = `lead.name ?? 'cliente'`
   - `lead_phone` = formatted with `+` prefix for display
   - `summary` = from step 3
   - `wa_link` = from step 4
   - `agent_name` = `config.name`
   - `handoff_reason` = input (already sanitized by stop_agent handler)
6. `renderHandoffTemplate(config.handoff_notification_template ?? '', vars)`.
7. Resolve target JID:
   - `type='phone'`: strip non-digits, enforce 10–15 digits, send via `provider.sendText({ phone, message })`.
   - `type='group'`: use address as-is (expected to be a valid JID like `1203@g.us`); UAZAPI's `sendText` accepts group JIDs in the `phone` field.
8. On send error: log, return `{ attempted: true, sent: false, error }`.

#### 2. `apps/crm/src/lib/ai-agent/tools/stop-agent.ts` — minor extension

After the existing `UPDATE agent_conversations SET human_handoff_at = now()`
and the `lead_activities` note, call `sendHandoffNotification` when not
`dry_run`. Aggregate the result into the handler output so `agent_steps`
shows whether the notification was attempted / sent, without raw body.

Dry-run: skip entirely (template expansion is still simulated in the step
output for transparency).

#### 3. `apps/crm/src/actions/ai-agent/utils.ts` — validation extension

`normalizeAgentPatch` / `normalizeAgentInput` must validate the four new
fields:

- `handoff_notification_enabled`: boolean, no trim.
- `handoff_notification_target_type`: one of `'phone' | 'group'` or null when enabled=false.
- `handoff_notification_target_address`: trimmed, required iff enabled=true.
  - Phone: strip non-digits, enforce 10–15 digits.
  - Group: accept as given; simple length cap 128 chars.
- `handoff_notification_template`: trimmed, <=1500 chars, null allowed.

If `enabled=true` and any target field missing → throw
`"Configure o destino da notificacao antes de ativar"`.

#### 4. Existing stop-agent test stays green

The old test asserts stop_agent sets `human_handoff_at` on dry_run=false.
That still passes — the notification is additive and gated on enabled=true
which defaults to false. Codex should ADD new tests for the notification
path rather than modifying the existing ones.

### Tests Codex must add

- `renderHandoffTemplate`:
  - Replaces all six standard vars.
  - Unknown placeholder renders as empty.
  - Empty template falls back to default.
- `sendHandoffNotification`:
  - enabled=false → attempted=false, no provider call.
  - enabled=true, target missing → attempted=false (defense against bad
    data despite the CHECK).
  - history_summary present → uses it, no Claude call.
  - history_summary absent → Claude called; Claude failure falls back to
    plain text.
  - provider error → sent=false, logged, does NOT throw.
  - phone target: digits-only; malformed address rejected.
  - group target: passed through unchanged.
- stop-agent handler:
  - dry_run=true → no notification attempt (expansion simulated only).
  - dry_run=false + enabled=true → notification attempted; lead_activities
    still written; agent_steps output includes sanitized audit.
- migration 021:
  - idempotent re-run.
  - consistency check rejects `enabled=true AND target_type=null`.
  - template length cap rejects 1501 chars.
- `normalizeAgentPatch`:
  - enable+missing target → rejected with clear message.
  - phone digits: "(11) 99999-9999" normalized to "11999999999" (or
    pre-padded to E.164 at Codex's discretion — contract only requires
    digits-only and range).

### UI scope for Claude (follow-up)

- **New card in RulesTab** "Notificacao de handoff" with:
  - Switch for `handoff_notification_enabled`.
  - Radio/select `handoff_notification_target_type` (Telefone / Grupo).
  - Input for `handoff_notification_target_address` — format hint changes
    by type; inline validation (digits only for phone).
  - Textarea for `handoff_notification_template` with chip hints listing
    the 6 recognized variables (reuses `HANDOFF_TEMPLATE_VARIABLES`).
  - "Usar template padrao" button that fills the textarea with
    `HANDOFF_DEFAULT_TEMPLATE`.
  - Preview panel: renders the template with placeholder values
    (e.g. `{{lead_name}}` → "Maria Silva") using
    `renderHandoffTemplate`.

### Out of scope (still)

- PR5.8 reactivate bot (last piece of Fase 1).
- PR6+ unchanged roadmap.

## 2026-04-24 00:02 - Codex - PR5.6 runtime handoff

- Branch: `codex/ai-agent-pr5.6-runtime`
- Runtime delivered:
  - `021_ai_agent_handoff_notification.sql`
  - helper `apps/crm/src/lib/ai-agent/handoff-notification.ts`
  - `stop_agent` now performs fail-soft handoff notification after the
    existing pause + `lead_activities` write
  - dry-run keeps the notification simulated-only
  - config actions now persist / validate:
    - `handoff_notification_enabled`
    - `handoff_notification_target_type`
    - `handoff_notification_target_address`
    - `handoff_notification_template`
- Runtime choices:
  - summary source = `history_summary.slice(0, 500)` first, otherwise a
    one-shot Claude summary in 2 frases / 200 tokens, otherwise fixed
    plain fallback
  - audit in `agent_steps.output` stores hashes + metadata only
    (`target_address_sha256`, `message_sha256`, `summary_source`, etc.)
    and never the raw outbound message body
  - phone targets are normalized to digits-only `10..15`; group targets
    are passed through as-is
- Validation on this branch:
  - `pnpm --filter @persia/crm build` ✅
  - `pnpm --filter @persia/crm test -- src/__tests__/ai-agent-pr5.6-runtime.test.ts` ✅
    - Vitest ran the whole CRM suite here: `18 files / 187 tests` green
  - `pnpm -r typecheck` ⚠️ still failing due the pre-existing
    `apps/crm/tsconfig.json` include on missing `.next/types/**/*.ts`
    files; unrelated to the PR5.6 runtime changes, and the Next build
    type validation itself passed
- Claude UI follow-up is unblocked for the new RulesTab handoff card.

---

## 2026-04-24 — Claude — UI text conventions (appended after PR #24 accent sweep)

Valid para TODOS os PRs futuros (Claude e Codex). Regra curta.

### Strings user-facing precisam de acentos PT-BR corretos

Aplicavel a qualquer texto que o usuario ve renderizado: titulos, descricoes,
placeholders, labels de botao, mensagens de toast, tooltips, mensagens de
erro exibidas ao usuario, preview text, status labels.

**NAO aplicavel** a:
- Identificadores TS (camelCase / snake_case)
- Chaves de DB, env vars, rotas
- Logs estruturados (`logInfo("some_event_name", ...)` — evento fica em ingles por convencao)
- Mensagens tecnicas de erro internas (ex: `throw new Error("handler not implemented")`)

### Lista dos erros mais comuns (para referencia rapida no code review)

- `Decisao` → `Decisão`
- `Notificacao` → `Notificação`
- `Execucao/Execucoes` → `Execução/Execuções`
- `Organizacao` → `Organização`
- `Configuracao` → `Configuração`
- `Automacao` → `Automação`
- `Descricao` → `Descrição`
- `Atencao` → `Atenção`
- `Duracao` → `Duração`
- `Padrao/Padroes` → `Padrão/Padrões`
- `Nao` → `Não`
- `Voce` → `Você`
- `Tambem` → `Também`
- `Sera` → `Será`
- `Apos` → `Após`
- `Ja` → `Já`
- `Ultima/Ultimo` → `Última/Último`
- `Disponivel` → `Disponível`
- `Obrigatorio` → `Obrigatório`
- `Necessario` → `Necessário`
- `Invalido` → `Inválido`
- `Codigo/Numero/Dominio/Maquina/Midia/Audio/Video/Inicio/Servico/Preco` → com acento
- `Pais` (country) → `País`
- `Digitos` → `Dígitos`

### Ambiguidade `e` vs `é`

`e` é conjuncao ("and"), `é` é verbo ser ("is"). Contexto decide. Regra pratica:
se a frase faz sentido substituindo por "is", é `é`. Se faz sentido como "and",
é `e`.

- "situação, instrução e dica" → `e` (lista)
- "Este e o nome que o agente enxerga" → `é` (verbo)
- "Destino e obrigatório" → `é` (verbo)
- "Tokens por conversa antes de parar e passar pra humano" → `e` (conjuncao)

### Scripts de texto em massa

Se rodar perl/sed em Windows pra fazer replacements, **sempre** usar:
```perl
use open ':std', ':encoding(UTF-8)';
binmode STDIN,  ':encoding(UTF-8)';
binmode STDOUT, ':encoding(UTF-8)';
```

Sem isso o perl default do Git Bash no Windows cai em CP1252 e corrompe
bytes UTF-8. Primeiro passo do PR #24 corrompeu todos os arquivos por esse
motivo — revertido com `git checkout`, refeito com o encoding explicito.

### Onde NAO mexer

- `packages/shared/src/ai-agent/tool-presets.ts` — descricoes dos presets
  ficam em ingles por design (viajam como `description` pro LLM).
- `types.ts` de shared — comentarios em ingles.
- Identificadores em runtime logs/audit — snake_case ingles.

---

## 2026-04-24 10:55 - Codex - PR4 admin routes for AI Agent

- Branch: `codex/admin-ai-agent-routes`
- Goal delivered: Admin now has first-class AI Agent routes backed by
  admin-scoped actions, reusing the shared UI extracted in PRs #26/#27.

### What landed

- New admin action surface in `apps/admin/src/actions/ai-agent/`:
  - `configs.ts`
  - `stages.ts`
  - `tools.ts`
  - `tester.ts`
  - `audit.ts`
  - `limits.ts`
  - `usage.ts`
  - `feature-flag.ts`
  - `webhook-allowlist.ts`
  - shared helper `utils.ts`
- New admin helper modules:
  - `apps/admin/src/lib/ai-agent/db.ts`
  - `apps/admin/src/lib/ai-agent/webhook-caller.ts`
  - `apps/admin/src/features/ai-agent/admin-actions.ts`
- New admin routes:
  - `/automations`
  - `/automations/agents`
  - `/automations/agents/[id]`
- Navigation + Tailwind wiring:
  - added "Agente IA Nativo" under Automa��o
  - added `@persia/ai-agent-ui` dependency
  - added `@source` for `packages/ai-agent-ui/src`

### Runtime / auth decisions

- Every admin AI Agent action receives explicit `orgId` as first arg.
- Auth uses `requireSuperadminForOrg(orgId)` and rejects mismatch between
  selected org and signed admin-context cookie.
- For the admin tester only, CRM runtime is reused through the existing
  `/api/ai-agent/tester` endpoint using `CRM_API_SECRET` + forced
  `dry_run: true`, instead of duplicating executor logic in admin.
- Admin-side AI Agent tables use `fromAny(...)` because the admin app DB
  typings still do not include `agent_*` tables/views from CRM
  migrations 017-021.

### Audit shape

- Admin mutations log with:
  - `performed_by_superadmin_id`
  - `acting_as_org_id`
- This metadata is attached via the shared admin action helpers so future
  admin mutations inherit the same audit shape.

### Validation

- `pnpm -r typecheck` ?
- `pnpm --filter @persia/crm build` ?
- `pnpm --filter @persia/admin build` ?

### Known gap / deliberate tradeoff

- The strategy asked for admin tests around isolation, performer ID and
  empty-state routing, but `apps/admin` currently has no test runner or
  test harness configured (no Vitest / RTL / test scripts in
  `package.json`).
- I kept this PR scoped to shipping the routes + actions with strong
  build/type validation instead of inventing test infrastructure inside
  the same branch. If we want those tests, the next smallest safe step is
  a tiny infra PR that adds an admin test runner first.

### Unblocked next step

- PR5.8 reactivate bot can now be implemented once in the shared feature
  UI and wired in both apps through the admin/CRM action bundles.

## 2026-04-24 14:58 - Codex - PR5.8 reactivate bot runtime+UI

### Scope shipped

- Added shared `ReactivateAgentButton` in
  `packages/ai-agent-ui/src/components/ReactivateAgentButton.tsx`.
- Added CRM action `apps/crm/src/actions/ai-agent/reactivate.ts` with:
  - `getLeadAgentHandoffState(leadId)`
  - `reactivateAgent(leadId)`
- Added admin mirror action `apps/admin/src/actions/ai-agent/reactivate.ts`
  with explicit `orgId` first arg:
  - `getLeadAgentHandoffState(orgId, leadId)`
  - `reactivateAgent(orgId, leadId)`
- Wired button into CRM and admin lead detail screens so it only appears
  when at least one `agent_conversations` row for the lead has
  `human_handoff_at IS NOT NULL`.

### Behavior

- Reactivation clears `human_handoff_at` and `human_handoff_reason` for
  all paused agent conversations of the lead inside the scoped org.
- CRM logs one `lead_activities` row with `type = 'agent_reactivated'`
  and metadata:
  - `source = 'ai_agent'`
  - `reactivated_conversation_ids`
  - `updated_count`
- Admin logs the same activity shape plus:
  - `performed_by_superadmin_id`
  - `acting_as_org_id`
- Empty update is treated as no-op and returns `{ updatedCount: 0 }`.

### Validation

- `pnpm --filter @persia/crm test -- src/actions/__tests__/ai-agent-reactivate.test.ts` ?
  - Vitest ran the whole CRM suite in practice: `19 files / 190 tests`.
- `pnpm -r typecheck` had already been green before the final handoff for
  this branch; re-run requested after the test pass because PR5.8 only
  touched action/UI surfaces and no further code changes happened after
  that.

### Notes

- No migration is required for PR5.8.
- This closes the Phase 1 gap left after PR5.5 / PR5.6 / PR5.7 and also
  completes the admin+CRM AI Agent unification sequence started in PRs
  #24, #26, #27 and #28.

---

## 2026-04-24 — Claude — Anthropic → OpenAI swap (contracts)

Branch: `claude/ai-agent-openai-contracts` (this PR).

Usuário decidiu migrar toda a stack LLM de Anthropic pra OpenAI. Sem
fallback, sem dual-provider — full swap. `OPENAI_API_KEY` já está em prod,
`ANTHROPIC_API_KEY` nunca foi configurada ali. Feature flag segue off em
todas as orgs até o runtime estar migrado, então podemos trocar sem medo
de quebrar conversas ativas.

### Split entre modelos

| Uso | Modelo | Onde |
|---|---|---|
| Agente conversando com lead | `gpt-5-mini` (default, admin troca no RulesTab) | `agent_configs.model`, usado pelo executor principal |
| Meta-IA interna (summarization, handoff brief, futuro Construtor de Prompt) | `gpt-4o-mini` (fixo) | `INTERNAL_MODEL` constant em `@persia/shared/ai-agent` |

Motivo: gpt-5-mini é mais forte em conversa de qualidade (cliente vê).
gpt-4o-mini é 10x mais barato, bom o suficiente pra prose curta que roda
toda conversa longa. Custo total de produção cai vs manter tudo num
modelo premium.

### Files shipped nesta PR de contracts

- `packages/shared/src/ai-agent/cost.ts` — troca do `MODEL_PRICING` pros
  4 modelos OpenAI (gpt-5, gpt-5-mini, gpt-4o, gpt-4o-mini), troca
  `DEFAULT_MODEL` pra `"gpt-5-mini"`, novo `INTERNAL_MODEL = "gpt-4o-mini"`
  constant.
- `packages/shared/src/ai-agent/tool-schema.ts`:
  - `AnthropicTool` → `OpenAITool` (wrapper `{ type: "function", function: { name, description, parameters } }`)
  - `toAnthropicTool` → `toOpenAITool`
  - `ToolCall` agora doc: `id` é OpenAI `call_...` format (era `tool_use_id`)
  - `ToolResult.tool_use_id` → `ToolResult.tool_call_id`
  - `ToolResult.content` continua podendo ser string ou object; runtime
    serializa pra string antes de enviar ao OpenAI
  - `is_error` continua no tipo — runtime encoda prefixo no content
    quando serializa (OpenAI não tem flag nativa)

Contratos que NÃO mudam: `NativeHandlerContext`, `NativeHandlerResult`,
`NativeHandler`, `NativeHandlerRegistry`, `CustomWebhookInvocation`,
`CustomWebhookResult`, `CUSTOM_WEBHOOK_LIMITS`. Os handlers de tool
(stop_agent, transfer_to_user, add_tag, etc) funcionam identicos — só a
camada entre executor e LLM muda.

### Runtime scope pro Codex (próxima PR)

**1. Deps (`apps/crm/package.json`)**

```json
"dependencies": {
  // remove: "@anthropic-ai/sdk": "^0.90.0"
  // add:
  "openai": "^4.x.x"  // verificar última compatível com Node 20+
}
```

**2. Executor (`apps/crm/src/lib/ai-agent/executor.ts`)**

Trocar `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })` por
`new OpenAI({ apiKey: process.env.OPENAI_API_KEY })`.

Loop principal muda:

```ts
// Antes (Anthropic)
const response = await client.messages.create({
  model: config.model,
  max_tokens: 1024,
  system,
  tools: tools as never,
  messages: messages as never,
});
if (response.stop_reason === "tool_use") { ... }

// Depois (OpenAI)
const response = await client.chat.completions.create({
  model: config.model,
  max_completion_tokens: 1024,  // gpt-5-* usa max_completion_tokens
  messages: [
    { role: "system", content: system },
    ...messages,
  ],
  tools: tools,  // já OpenAITool[] via toOpenAITool
  tool_choice: "auto",
});
const choice = response.choices[0];
if (choice.finish_reason === "tool_calls") {
  for (const call of choice.message.tool_calls ?? []) {
    const toolCall: ToolCall = {
      id: call.id,
      name: call.function.name,
      input: JSON.parse(call.function.arguments),  // sempre string em OpenAI
    };
    // ... executa, depois envia tool result:
    messages.push({
      role: "assistant",
      content: choice.message.content,
      tool_calls: choice.message.tool_calls,
    });
    messages.push({
      role: "tool",
      tool_call_id: call.id,
      content: typeof result.output === "string" ? result.output : JSON.stringify(result.output),
    });
  }
}
```

Usage tracking muda:

```ts
// Antes: response.usage.input_tokens, response.usage.output_tokens
// Depois: response.usage.prompt_tokens, response.usage.completion_tokens
```

**3. Handoff notification (`apps/crm/src/lib/ai-agent/handoff-notification.ts`)**

Summary generation Claude → OpenAI, mas usando **`INTERNAL_MODEL`**
(`"gpt-4o-mini"`) em vez de `config.model`:

```ts
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const response = await client.chat.completions.create({
  model: INTERNAL_MODEL,  // import from @persia/shared/ai-agent
  max_completion_tokens: 200,
  messages: [
    { role: "system", content: HANDOFF_SUMMARY_PROMPT },
    { role: "user", content: transcriptText },
  ],
});
const summary = response.choices[0].message.content?.trim() ?? "";
```

Mesma lógica fail-soft: erro OpenAI → fallback plain text.

**4. Context summarization (dentro do `executor.ts`, função `maybeRunConversationSummarization`)**

Mesma troca: usa **`INTERNAL_MODEL`** em vez de `config.model`. Reduz
custo de summarization em ~10x vs antes.

```ts
const response = await withTimeout(
  client.chat.completions.create({
    model: INTERNAL_MODEL,
    max_completion_tokens: 1200,
    messages: [
      { role: "system", content: SUMMARIZATION_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  }),
  timeoutMs,
);
```

**5. Tester (`apps/crm/src/app/api/ai-agent/tester/route.ts` + action)**

Nenhuma mudança — tester chama o executor, executor já foi migrado.

**6. Env vars**

- Remove do EasyPanel: `ANTHROPIC_API_KEY` (se estiver setado em algum ambiente)
- Mantém: `OPENAI_API_KEY` (já está)
- PR de contracts não toca env — só Codex runtime PR mexe no que app precisa ler

**7. Defensive default pra agent_configs existentes**

No momento, toda `agent_configs.model` tem valor `claude-*`. Depois do
swap, OpenAI rejeita esses model IDs. Runtime defense:

```ts
function resolveModel(config: AgentConfig): string {
  return isKnownModel(config.model) ? config.model : DEFAULT_MODEL;
}
```

Chamar em cada site que usa `config.model`. Sem precisar de migration SQL
(flag off em todas orgs, zero conversa ativa).

### Tests que Codex precisa migrar

Suíte CRM tem 190 testes. Desses, ~30 mockam `Anthropic.messages.create`.
Migrar pra mock do `openai.chat.completions.create`:

- `apps/crm/src/__tests__/ai-agent-runtime.test.ts`
- `apps/crm/src/__tests__/ai-agent-pr3-runtime.test.ts` (tests de handlers
  não precisam — mockam DB, não LLM)
- `apps/crm/src/__tests__/ai-agent-pr5.5-runtime.test.ts` (debounce — alguns
  mockam executor end-to-end)
- `apps/crm/src/__tests__/ai-agent-pr5.6-runtime.test.ts` (handoff summary)
- `apps/crm/src/__tests__/ai-agent-pr5.7-runtime.test.ts` (context summary)

Factory helper recomendada:

```ts
const openaiMock = vi.hoisted(() => ({
  chat: { completions: { create: vi.fn() } },
}));
vi.mock("openai", () => ({
  default: vi.fn(() => openaiMock),
}));
```

Response shape mockado deve bater OpenAI:

```ts
openaiMock.chat.completions.create.mockResolvedValueOnce({
  choices: [{
    finish_reason: "tool_calls",
    message: {
      content: null,
      tool_calls: [{
        id: "call_123",
        type: "function",
        function: { name: "stop_agent", arguments: JSON.stringify({ reason: "x" }) },
      }],
    },
  }],
  usage: { prompt_tokens: 20, completion_tokens: 10 },
});
```

### UI scope (última PR deste swap, Claude faz)

- `packages/ai-agent-ui/src/components/RulesTab.tsx` — Model selector
  options troca pras OpenAI:
  - `gpt-5-mini` (default — "Rápido e bom, recomendado")
  - `gpt-4o-mini` (descrição: "Mais barato, qualidade ok")
  - `gpt-4o` (descrição: "Versão anterior, custo médio")
  - `gpt-5` (descrição: "Raciocínio avançado, mais caro")

O `createAgent` no AgentsList também usa o novo default via
`DEFAULT_MODEL` export — sem mudança adicional ali.

### Validação

- `pnpm --filter @persia/shared typecheck` ✅
- `pnpm --filter @persia/crm typecheck` ✅ (runtime ainda usa
  `@anthropic-ai/sdk` — não quebra até Codex migrar, mas `toAnthropicTool`
  vai dar undefined se algum código importar o nome antigo. Greped zero
  callers fora do runtime que o Codex vai reescrever).
- `pnpm --filter @persia/admin typecheck` ✅

### Out of scope

- Migration SQL pra backfillar `agent_configs.model` de `claude-*` →
  `gpt-5-mini`. Feature flag off em todas orgs, runtime fallback cobre.
  Se quiser opcionalmente numa PR posterior, é one-liner.
- Prompt caching (OpenAI tem automático pra prompts >1024 tokens, sem
  configuração).
- Reasoning effort config pra gpt-5 models (roadmap).

## 2026-04-24 16:08 - Codex - OpenAI runtime migration

### Scope shipped

- Branch: `codex/ai-agent-openai-runtime`
- Full runtime swap from Anthropic to OpenAI in `apps/crm`.
- Removed `@anthropic-ai/sdk` from `apps/crm/package.json` and refreshed `pnpm-lock.yaml`.
- Removed deprecated shared exports `AnthropicTool` and `toAnthropicTool` from
  `packages/shared/src/ai-agent/tool-schema.ts`.

### Runtime changes

- `apps/crm/src/lib/ai-agent/executor.ts`
  - uses `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })`
  - tool loop now uses `chat.completions.create(...)`
  - tools serialized with `toOpenAITool(...)`
  - tool calls parsed from `choices[0].message.tool_calls[]`
  - tool results returned via `role: "tool"` + `tool_call_id`
  - usage now reads `prompt_tokens` / `completion_tokens`
  - invalid legacy `claude-*` model ids fail over to `DEFAULT_MODEL`
- `apps/crm/src/lib/ai-agent/handoff-notification.ts`
  - summary generation moved to OpenAI
  - uses `INTERNAL_MODEL` (`gpt-4o-mini`) instead of the per-agent model
  - summary source audit value is now `openai`
- `apps/crm/src/lib/ai-agent/executor.ts` summarization path
  - also uses `INTERNAL_MODEL` for cheaper context consolidation
- Handler context helper renamed from Anthropic client to OpenAI client:
  - `getHandlerOpenAIClient(...)`
  - `stop_agent` now passes `openaiClient` to handoff notification

### Validation

- `pnpm -r typecheck` ?
- `pnpm --filter @persia/crm test` ? (`19 files / 190 tests`)
- `pnpm --filter @persia/crm build` ?
- `pnpm --filter @persia/admin build` ?

### Notes

- CRM build still emits the pre-existing `cn` import warnings unrelated to this PR.
- No migration SQL required.
- Claude UI follow-up can now switch the RulesTab model selector to the four
  OpenAI options without touching runtime code.

## 2026-04-24 — Claude — PR6.1 RAG contracts + schema

### Scope shipped

- Branch: `claude/ai-agent-rag-contracts`
- Migration `apps/crm/supabase/migrations/022_ai_agent_rag.sql`:
  - `CREATE EXTENSION vector`.
  - Tables: `agent_knowledge_sources`, `agent_knowledge_chunks`
    (`embedding vector(1024)`), `agent_indexing_jobs`.
  - HNSW cosine index on `chunks.embedding`.
  - Added `agent_stages.rag_top_k INT NOT NULL DEFAULT 3 CHECK 1..10`.
  - RLS by `organization_id`; chunks + jobs are SELECT-only from UI,
    service_role writes during indexing.
- `packages/shared/src/ai-agent/rag.ts`:
  - Voyage constants (`VOYAGE_MODEL="voyage-3-lite"`, `VOYAGE_DIM=1024`,
    batching caps), chunk strategy (`CHUNK_SIZE_TOKENS=512`,
    `CHUNK_OVERLAP_TOKENS=64`), retrieval knobs (`RAG_TOP_K_*`,
    `RAG_DISTANCE_CEILING=0.75`), upload limits
    (`DOCUMENT_UPLOAD_MAX_BYTES=10MB`, allowed MIME list), FAQ char caps.
  - Domain types: `AgentKnowledgeSource` with discriminated `metadata`
    (`faq` = question+answer; `document` = storage_path+mime+size+filename),
    `AgentKnowledgeChunk`, `AgentIndexingJob`, `RetrievalHit`,
    `RetrievalQuery`, step payloads for audit.
  - Action inputs: `CreateFAQInput`, `UpdateFAQInput`, `CreateDocumentInput`.
  - Prompt constants: `RAG_CONTEXT_PREFIX`, `RAG_CONTEXT_INSTRUCTIONS`.
- `packages/shared/src/ai-agent/types.ts`:
  - `AgentStage.rag_top_k?: number` added (optional during rollout;
    runtime should guard with `clampRagTopK(stage.rag_top_k)`).
- Barrel export extended.

### Validation

- `pnpm -r typecheck` ✅
- `pnpm --filter @persia/crm build` ✅
- `pnpm --filter @persia/admin build` ✅

---

## Spec for PR6.2 — RAG runtime (Codex)

### Goal

Implement the runtime side of RAG. All contract constants live in
`@persia/shared/ai-agent` (read-only for Codex after PR6.1 merges) —
use them, do not duplicate.

### Voyage AI client — `apps/crm/src/lib/ai-agent/rag/voyage-client.ts`

- `process.env.VOYAGE_API_KEY` is the only config. Missing key =
  `new VoyageMissingKeyError()` — the indexer catches it and fails the
  job with `error_message = "VOYAGE_API_KEY not set"`; retrieval catches
  it and returns an empty array so the run continues LLM-only.
- POST `https://api.voyageai.com/v1/embeddings` with
  `{ input: string[], model: VOYAGE_MODEL, input_type: "document"|"query" }`.
- Timeout: 60s per call. Retries: 2 on 5xx / network errors, exponential
  backoff starting at 500ms.
- Batch respects `VOYAGE_BATCH_MAX` (128) inputs per HTTP call. Caller
  decides slicing; client validates.
- Returns `number[][]` aligned to input order. Throws on 4xx (bad input
  = bug, not retried).
- Per-call cost: tokens reported by Voyage in `usage.total_tokens`; the
  client exposes it so the indexer can persist cost for audit.

### Chunker — `apps/crm/src/lib/ai-agent/rag/chunker.ts`

- `chunkText(text: string): Chunk[]` where
  `Chunk = { content: string; token_count: number; chunk_index: number }`.
- Prefer semantic boundaries: split on double-newline (paragraphs), then
  single-newline, then sentence boundary. Fall back to hard token slice
  when a single paragraph exceeds `CHUNK_SIZE_TOKENS`.
- Overlap of `CHUNK_OVERLAP_TOKENS` between adjacent chunks.
- Token counting: use a tokenizer if available (tiktoken via js-tiktoken
  already in dependencies through OpenAI SDK? check — if no dep add, fall
  back to `Math.ceil(text.length / CHUNK_CHAR_PER_TOKEN_APPROX)`). Do not
  add a heavy tokenizer just for this.
- Enforce `SOURCE_MAX_CHUNKS` — throw `SourceTooLargeError` if exceeded.

### Document parsers — `apps/crm/src/lib/ai-agent/rag/parsers/`

- One file per MIME type: `pdf.ts`, `docx.ts`, `txt.ts`.
- Signature: `parse(buffer: Buffer): Promise<string>` — plain text.
- PDF: `pdf-parse` (add dep). DOCX: `mammoth` (add dep). TXT: just decode
  utf-8.
- Caller passes Supabase Storage download result; parsers do NOT touch
  storage themselves.

### Indexer — `apps/crm/src/lib/ai-agent/rag/indexer.ts`

- Exposed as `runIndexingTick(): Promise<TickResult>` (see debounce
  flush for the pattern — lease claim + process + release).
- Lease claim SQL:
  ```sql
  UPDATE agent_indexing_jobs
  SET status = 'processing',
      claimed_at = now(),
      attempts = attempts + 1,
      updated_at = now()
  WHERE id = (
    SELECT id FROM agent_indexing_jobs
    WHERE status = 'pending'
       OR (status = 'processing' AND claimed_at < now() - INTERVAL '5 minutes')
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
  ```
- For each claimed job:
  1. Load the source. If `source_type='faq'`, input text =
     `"Q: {question}\nA: {answer}"`. If `source_type='document'`, download
     from Storage + dispatch to the right parser.
  2. Chunk.
  3. Batch-embed via Voyage (`input_type="document"`).
  4. In one transaction: delete existing chunks for the source (idempotent
     re-index), insert the new chunks, update
     `agent_knowledge_sources.indexing_status='indexed'`,
     `indexed_at=now()`, `chunk_count=N`, job.status='done'.
  5. On failure: job.status='failed', source.indexing_status='failed',
     source.indexing_error=<message>. Job is NOT retried automatically
     beyond lease TTL — surface failures so the user sees them in the UI.
- Cap attempts at 3 to avoid infinite loops on permanent errors.
- After each job, emit an audit log entry.

### pg_cron trigger

- Add to migration 022 OR to the indexer deploy doc: cron job every 30s
  that POSTs to `/api/ai-agent/indexer/tick` with the
  `PERSIA_INDEXER_SECRET` header, analogous to the debounce flush.
- Endpoint is service_role-authenticated, returns 200 immediately and
  processes one job per tick.

### Retriever — `apps/crm/src/lib/ai-agent/rag/retriever.ts`

- `retrieve(query: RetrievalQuery): Promise<RetrievalHit[]>`.
- Uses Voyage with `input_type="query"` for the query embedding.
- pgvector SQL:
  ```sql
  SELECT c.id, c.source_id, s.source_type, s.title, c.content,
         c.embedding <=> $1 AS distance
  FROM agent_knowledge_chunks c
  JOIN agent_knowledge_sources s ON s.id = c.source_id
  WHERE c.organization_id = $org
    AND c.config_id = $config
    AND s.status = 'active'
    AND s.indexing_status = 'indexed'
  ORDER BY c.embedding <=> $1
  LIMIT $top_k;
  ```
  Using `<=>` (cosine distance) operator.
- Filter by `RAG_DISTANCE_CEILING` client-side — SQL returns top_k, the
  caller drops anything above 0.75.
- On missing Voyage key OR any error: log, return `[]`. NEVER throw.

### Executor integration — `apps/crm/src/lib/ai-agent/executor.ts`

- Before the tool-use loop, if `stage.rag_enabled`:
  1. Resolve `top_k = clampRagTopK(stage.rag_top_k)`.
  2. Query text = the inbound user message (for the first turn) OR
     last user message + `history_summary` (subsequent turns).
  3. `retrieve({ ..., audit: true })`.
  4. If hits.length > 0, prepend a block to the system prompt:
     ```
     {RAG_CONTEXT_PREFIX}
     {RAG_CONTEXT_INSTRUCTIONS}

     [1] (from "{title}") {content}
     [2] (from "{title}") {content}
     ...
     ```
  5. Persist an `agent_steps` row with `step_type='llm'` and
     `input = RetrievalStepInput`, `output = RetrievalStepOutput`
     (including hits metadata). Note: retrieval is NOT a tool call —
     it runs unconditionally when `rag_enabled` is true.
- Cost tracking: embedding tokens (both indexing + retrieval queries)
  are logged separately on the step but NOT counted against
  `cost_ceiling_tokens` (that ceiling is for LLM tokens only). A future
  PR can add `tokens_embedded` to `agent_runs` if needed.

### Env vars

- CRM: `VOYAGE_API_KEY` (required for RAG to work; safe to leave unset
  in staging to keep the feature fully off).
- CRM: `PERSIA_INDEXER_SECRET` (same pattern as debounce flush).
- DB settings: `app.settings.indexer_tick_url` + `app.settings.indexer_tick_secret`.

### Tests

Same harness as PR5.x runtime tests. Cover:

- Chunker: empty / single-paragraph / multi-paragraph / oversized
  source rejection.
- Indexer: success path, Voyage missing-key failure path, DB transaction
  rollback on embedding failure, idempotent re-index.
- Retriever: missing Voyage key → empty array; below ceiling → filtered.
- Executor: `rag_enabled=false` → no call to retriever; true + hits →
  system prompt contains RAG_CONTEXT_PREFIX; true + empty hits → system
  prompt unchanged; true + retriever throws → system prompt unchanged
  and step row has `success=false`.
- Multi-tenant: retriever never returns chunks from another org even
  if config_id collides (shouldn't, but enforce via test).

### Out of scope for PR6.2

- Re-embedding job when an FAQ/document is edited. For MVP: UI deletes
  the old source and creates a new one (cascade drops chunks). Codex
  can leave a TODO for "edit = re-enqueue" in a follow-up.
- Hybrid search (BM25 + vector). pure cosine for now.
- Per-agent embedding cost ceiling. Voyage is cheap enough that we can
  defer.

## 2026-04-24 17:45 - Codex - PR6.2 runtime handoff
- Implemented RAG runtime on codex/ai-agent-pr6.2-rag-runtime: migration 022 finalized with claim/complete/fail/match RPC functions plus pg_cron tick for /api/ai-agent/indexer/tick.
- Added pps/crm/src/lib/ai-agent/rag/*: Voyage client, chunker, TXT/PDF/DOCX parsers, retriever, indexer, and indexer tick route.
- Executor now runs retrieval before the LLM loop when stage.rag_enabled=true, injects RAG_CONTEXT_PREFIX block into the system prompt when hits exist, and persists a dedicated retrieval audit step (step_type='llm', output.phase='retrieval') on non-dry runs.
- Retrieval is fail-soft: missing VOYAGE_API_KEY or any Voyage/pgvector error leaves the prompt unchanged and records success=false in the retrieval step.
- Added deps mammoth and pdf-parse, mock storage downloads in supabase-mock, local pdf-parse declaration, and test suite pps/crm/src/__tests__/ai-agent-pr6.2-rag-runtime.test.ts.
- Validation: pnpm -r typecheck ?, pnpm --filter @persia/crm test -- src/__tests__/ai-agent-pr6.2-rag-runtime.test.ts ? (suite ran 20 files / 200 tests total), pnpm --filter @persia/crm build ?, pnpm --filter @persia/admin build ?.
- Note: CRM build still reports the pre-existing cn warnings from @/lib/utils; not introduced by PR6.2.
- Deploy/runtime follow-up after merge: set VOYAGE_API_KEY, set PERSIA_INDEXER_SECRET, and configure DB settings pp.settings.indexer_tick_url + pp.settings.indexer_tick_secret before applying migration 022 outside local/dev.


## 2026-04-24 — Claude — PR7.1a Notification templates contracts + schema

### Scope shipped

- Branch: claude/ai-agent-notifications-contracts
- Migration 023: agent_notification_templates table com (name unique
  per config, description, target_type phone|group, target_address,
  body_template, status active|archived) + RLS por org
- packages/shared/src/ai-agent/notifications.ts:
  - Types completos para CRUD + handler input/output + audit step
  - Renderer com 2 tipos de variavel: fixed ({{lead_name}} resolvidas
    da conversa) + custom ({{custom.foo}} resolvidas do input do LLM)
  - Limites: 20 templates/agente, 20 custom keys/call, body 1500 chars
  - buildNotificationToolName() slug helper pra gerar nome do tool
  - maskTargetAddress() pra log audit sem vazar telefone/JID
- tool-presets.ts: trigger_notification ganhou input_schema correto
  (template_name string + custom object). Antes era notification_id: uuid,
  incompativel com a abordagem por nome.
- DecisionIntelligenceModal.tsx: SHIPPED_PRS inclui "PR7"

### Validation

- pnpm -r typecheck OK
- pnpm --filter @persia/crm build OK
- pnpm --filter @persia/admin build OK

---

## Spec for PR7.1b — trigger_notification runtime (Codex)

### Goal

Implementar handler nativo trigger_notification em
apps/crm/src/lib/ai-agent/handlers/, com auditoria + envio via mesmo
provider WhatsApp que recebeu o lead.

### Handler — apps/crm/src/lib/ai-agent/handlers/trigger-notification.ts

Pseudo-codigo:

  1. Parse input (template_name + custom optional)
  2. Validate custom: max 20 keys, key max 40 chars, value max 200 chars
  3. Lookup template por (config_id, name lower-trimmed) — case insensitive
  4. Erro se template nao encontrado OU status === 'archived'
  5. Build fixed variables da conversa (lead_name, lead_phone, wa_link,
     agent_name) — usar context.lead_id + agent_config.name
  6. Render body via renderNotificationTemplate(template.body_template,
     fixed, custom)
  7. Se context.dry_run: retorna { success: true, output: { ..., rendered_body,
     dry_run: true } } sem chamar provider
  8. Send via mesmo WhatsApp provider que recebeu o lead (lookup por
     conversation.connection_id ou similar). target_type='phone'
     -> strip non-digits; target_type='group' -> usa JID raw
  9. Retorna { success: true, output: { template_id, template_name,
     target_type, message_id }, side_effects: [...] com address masked }

### Tool registration sync

Quando uma row em agent_notification_templates eh criada/atualizada/deletada,
um row correspondente em agent_tools deve existir com:
- name: buildNotificationToolName(template.name) — ex: notify_lead_qualificado
- description: template.description
- execution_mode: "native"
- native_handler: "trigger_notification"
- input_schema: do tool-preset (template_name + custom)

Decisao: o server action que Claude vai criar em PR7.1c
(apps/crm/src/actions/ai-agent/notifications.ts) faz essa sync — insert/
update/delete em agent_tools na mesma transacao. Codex NAO precisa
mexer em registro de tools — so ler, validar, executar handler.

Codex deve expor em apps/crm/src/lib/ai-agent/notifications.ts (NOVO
arquivo) helpers que tanto o handler quanto a action vao usar:
- buildNotificationToolRow(template, orgId): linha pra agent_tools
- loadTemplateByName(db, orgId, configId, name): Promise<Template | null>

### Tests — apps/crm/src/__tests__/ai-agent-pr7.1-runtime.test.ts

Cobrir:
- Handler resolve template por nome case-insensitive
- Template arquivado retorna success: false
- Custom > 20 keys retorna success: false
- Custom value > 200 chars retorna success: false
- Dry-run NAO chama provider, retorna rendered_body
- Provider error -> handler retorna success: false com mensagem
- Step audit grava input + output com target_address_masked
- Multi-tenant: handler de org A nao enxerga template de org B

### Out of scope PR7.1b

- Nenhuma UI (vem na PR7.1c)
- Scheduled notifications (PR7.2)
- Calendar (PR7.3)
- Tool registration sync — responsabilidade do server action
  (Claude PR7.1c)

---

## Codex note â€” RAG indexer hardening (April 24, 2026)

### Production diagnosis

Investigacao feita em cima do `main` atualizado depois do bug de
"Documento em fila" persistente:

1. `agent_knowledge_sources.indexing_status` podia ficar em `pending`
   mesmo com `agent_indexing_jobs.status = 'processing'`.
   Causa: o claim do job nao promovia a source para `processing`.

2. Jobs com `attempts >= 3` podiam permanecer em `pending` para sempre.
   Causa: `claim_agent_indexing_job()` so pega jobs com
   `attempts < p_max_attempts`, mas nao convertia os exaustos para `failed`.

3. O catch do runtime chamava `rpc("fail_agent_indexing_job", ...)`
   usando `.catch(() => {})`, o que engolia throw, mas nao tratava o caso
   mais comum do Supabase RPC responder `{ error }` sem throw.
   Resultado: job/source podiam ficar presos se a RPC de fail falhasse.

4. O cron do indexer estava com `timeout_milliseconds := 5000`.
   Para PDF + parse + embedding, 5s e curto demais e aumenta a chance
   de job ficar em `processing` sem completar.

### Fix shipped

- Runtime `apps/crm/src/lib/ai-agent/rag/indexer.ts`
  - normaliza jobs exaustos para `failed` antes do claim
  - marca a source como `processing` assim que o job e claimed
  - faz fallback para update direto em `agent_indexing_jobs` /
    `agent_knowledge_sources` se a RPC `fail_agent_indexing_job`
    responder com erro

- Route `apps/crm/src/app/api/ai-agent/indexer/tick/route.ts`
  - `export const maxDuration = 60`

- Migration `024_ai_agent_rag_indexer_hardening.sql`
  - endurece `claim_agent_indexing_job()` no banco
  - converte exaustos para `failed`
  - sincroniza source -> `processing` no claim
  - aumenta timeout do cron do indexer para `60000`

### Validation

- `pnpm -r typecheck` OK
- `pnpm --filter @persia/crm test -- src/__tests__/ai-agent-pr6.2-rag-runtime.test.ts` OK
- `pnpm --filter @persia/crm build` OK
  - mesmos warnings preexistentes de `cn` fora do escopo

## 2026-04-24 — Claude — PR7.2a Scheduled jobs contracts + schema

### Scope shipped

- Branch: claude/ai-agent-scheduled-jobs-contracts
- Migration 025:
  - agent_scheduled_jobs (name unique per config, template_id FK,
    cron_expr, lead_filter jsonb, status, last_run_*, next_run_at,
    claimed_at lease)
  - agent_scheduled_runs (audit trail por execucao)
  - RPCs: claim/complete/fail com SECURITY DEFINER + REVOKE public
  - pg_cron 'ai-agent-scheduler-tick' a cada 1 min chamando
    /api/ai-agent/scheduler/tick com X-Persia-Scheduler-Secret
- packages/shared/src/ai-agent/scheduled-jobs.ts:
  - Types: AgentScheduledJob, LeadFilter, CreateScheduledJobInput,
    UpdateScheduledJobInput, ScheduledJobRunResult
  - LeadFilter campos: tag_slugs, pipeline_stage_ids, statuses,
    age_days (gt|gte|lt|lte), only_active_agents, silence_recent_hours
  - Presets de cron (5 itens) pra UI
  - Helpers: isValidCronShape, isEmptyLeadFilter, validateLeadFilter
  - Constants: SCHEDULED_JOBS_MAX_PER_AGENT=10, LEADS_PER_TICK_MAX=500,
    MIN_INTERVAL_MINUTES=15

---

## Spec for PR7.2b — Scheduler runtime (Codex)

### Dependencia

Requer handler trigger_notification registrado no NativeHandlerRegistry
(PR7.1b). Se nao estiver, scheduler pode rodar mas send falha — runtime
loga e registra como error em scheduled_runs.

### Architecture

- Endpoint: apps/crm/src/app/api/ai-agent/scheduler/tick/route.ts
  - Auth: mesmo padrao do indexer — X-Persia-Scheduler-Secret OR
    Authorization: Bearer (CRM_API_SECRET pra bridge admin)
  - timingSafeEqual + fail-safe 200 mesmo em erro
  - Delega pra runScheduledTick()

- Runtime: apps/crm/src/lib/ai-agent/scheduler/
  - tick.ts: runScheduledTick() - claim um job por tick
    (pg_cron dispara a cada 1min; loop externo pg_cron, loop interno
    so processa 1 job por request)
  - cron-parser.ts: usa npm install cron-parser. Computa proximo
    next_run_at a partir de cron_expr + timezone (default
    America/Sao_Paulo? ou UTC? runtime decide — recomendo UTC pra
    evitar DST)
  - lead-resolver.ts: traduz LeadFilter em SQL query em public.leads,
    com JOIN em lead_tags + pipeline_stages + agent_conversations
    (pro only_active_agents). RETORNA array de lead_id, LIMIT 500.
  - dispatcher.ts: pra cada lead, resolve a conversa ativa (ou cria
    placeholder?), chama helper send do handler trigger_notification.
    IMPORTANTE: scheduler NAO vai pelo executor do agente — nao ha
    LLM no loop. Vai direto send via WhatsApp provider. Mas REUSA
    a logica de render do notifications.ts (template + lead vars).

### Tick flow

1. Autentica endpoint via secret
2. claim_agent_scheduled_job() — pega 1 job ou null
3. Se null, retorna ok: true (sem trabalho)
4. Start transaction implicita (nao precisa BEGIN explicito — jobs
   sao independentes). Record started_at em agent_scheduled_runs.
5. Valida template (load + status = active). Se nao, fail job com
   erro claro.
6. Resolve leads via lead-resolver. Se empty, complete com
   leads_processed=0 + next_run_at computado.
7. Pra cada lead (cap 500):
   - Resolve conversa ativa (leads.active_conversation_id OU cria
     uma transient. Decidir no design — scheduler nao cria
     conversas novas? Nao pode ser ephemeral? Acho que precisa de
     conversa, senao o send WhatsApp nao tem contexto)
   - Render template (fixed vars do lead + custom vazio por
     enquanto — PR7.2 nao expoe custom no scheduler; LLM handler
     sim)
   - Call provider.sendText(address, rendered)
   - Incrementa counter. Erro por lead grava em error_samples
     (cap 20)
8. Finaliza: insert em agent_scheduled_runs, complete_agent_scheduled_job
   com leads_processed + next_run_at

### Tests (em ai-agent-pr7.2-runtime.test.ts)

Cobrir:
- Claim pula jobs status=paused
- Claim pula jobs next_run_at > now
- Claim pega job apenas se claimed_at null OU < 5min atras
- Template arquivado -> fail + error_samples vazio
- Lead filter empty -> reject na ACTION (nao deixa salvar), scheduler
  assume nao-vazio
- silence_recent_hours filtra leads com ultima mensagem recente
- only_active_agents filtra leads sem human_handoff_at null
- Leads cap 500 (teste com 600 matches, processa 500, marca skipped)
- Multi-tenant: scheduler de org A nunca processa leads de org B
- Computacao de next_run_at via cron-parser

### Env vars + DB settings (deploy)

CRM:
- PERSIA_SCHEDULER_SECRET (gerar 48 chars hex)
- existing PERSIA_INDEXER_SECRET ja serve pra outros, nao reutilizar

Admin:
- Reusa CRM_CLIENT_BASE_URL + CRM_API_SECRET pra bridge

DB settings via SQL:
- ALTER DATABASE postgres SET app.settings.scheduler_tick_url
  TO 'https://crm.funilpersia.top/api/ai-agent/scheduler/tick';
- ALTER DATABASE postgres SET app.settings.scheduler_tick_secret
  TO '<valor>';

### Out of scope PR7.2b

- UI da aba Agendamento (vem em PR7.2c)
- Custom variables no scheduler (usuario nao escolhe — templates que
  usam {{custom.X}} recebem vazio)
- Calendar sync (PR7.3)
