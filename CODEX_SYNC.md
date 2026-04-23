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
