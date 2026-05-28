# 06 — Humanização

> Tudo que faz a IA "parecer humana": split de mensagens longas, pause/resume keywords,
> business hours, after-hours message, auto-pausa quando humano responde, handoff
> com resumo.

## Fonte da verdade

`packages/shared/src/ai-agent/humanization.ts` — todos os helpers + defaults + types.

`agent_configs.humanization_config` JSONB com shape:

```ts
interface HumanizationConfig {
  pause_keywords: string[];        // default ["PAUSAR", "HUMANO", "STOP IA"]
  resume_keywords: string[];       // default ["ATIVAR", "IA ON", "VOLTAR IA"]
  auto_pause_minutes: number;      // default 30, range 0-1440. 0 = nunca

  split_enabled: boolean;          // default false
  split_threshold_chars: number;   // default 200, range 50-1000
  split_delay_seconds: number;     // default 2, range 0-30

  business_hours_enabled: boolean; // default false
  business_hours_timezone: string; // default "America/Sao_Paulo"
  business_hours: BusinessHours;   // default seg-sex 9-18
  after_hours_message: string;     // default "Olá! Recebi sua mensagem..."

  handoff_include_summary: boolean; // default true
}
```

Runtime SEMPRE normaliza via `normalizeHumanizationConfig(raw)`. JSONB pode estar parcial
em ambientes antigos (pré-migration 041).

## Pause / Resume keywords

### Fuzzy matching (PR #369)

`matchesPauseKeyword(text, config)` retorna `true` se `text` contém algum
`config.pause_keywords` como palavra isolada (word boundary regex).

```ts
export function normalizeKeyword(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");  // unaccent
}

function matchesAnyKeyword(text: string, keywords: readonly string[]): boolean {
  if (!text || keywords.length === 0) return false;
  const haystack = normalizeKeyword(text);
  for (const kw of keywords) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`);
    if (re.test(haystack)) return true;
  }
  return false;
}
```

### Trade-offs aceitos

- **False positive: "nao pausar" dispara PAUSAR.** Trade-off aceito V1 — preferimos
  disparar pause em mais casos do que perder intenção real.
- **Multi-palavra "STOP IA" só bate como sequência.** "stop" sozinho não dispara.
- **Acentos absorvidos.** "HUMANÓ" no lead bate com "HUMANO" no catálogo.

### Ações ao detectar

**Pause keyword detectado:**

1. `agent_conversations.human_handoff_at = now()`.
2. `conversations.assigned_to = 'human'` (paridade Kanban — PR #364).
3. Bump epoch (`ai_control_epoch++`) — runs em andamento abortam outbound mid-flight.
4. Log `ai_agent_paused_by_keyword`.
5. Webhook (no executor) retorna `skipped: "paused_by_keyword"`.

**Resume keyword detectado** (mas só se conversation está pausada):

1. `agent_conversations.human_handoff_at = null`.
2. `conversations.assigned_to = 'ai'`.
3. Bump epoch.
4. Log `ai_agent_resumed_by_keyword`.
5. Próxima msg é processada normalmente.

### Auto-pausa quando operator responde

Quando humano envia msg pelo CRM manualmente (sender='operator' em messages),
`pauseAgent()` helper é chamado:

```ts
agent_conversations.human_handoff_at = now();
agent_conversations.auto_pause_expires_at = now() + auto_pause_minutes;
```

`isAutoPauseExpired()` checa em msgs do lead subsequentes. Quando expira (e lead ainda
manda msg), `human_handoff_at` é limpo e IA reativa.

`auto_pause_minutes = 0` desabilita auto-pausa permanentemente — humano respondendo não
trava IA. Útil pra orgs onde operator e IA trabalham em paralelo.

## Split de mensagens (picotar)

Para parecer mais natural, respostas longas são picotadas em N msgs curtas com delay
entre cada uma + setTyping ativo.

```ts
if (split_enabled && reply.length >= split_threshold_chars) {
  const parts = splitMessage(reply, splitConfig);
  for (const part of parts) {
    await provider.setTyping(phone, true);
    await sleep(split_delay_seconds * 1000);
    await provider.sendText({ phone, message: part });
  }
}
```

### Algoritmo de split

`splitMessage()` em `apps/crm/src/lib/ai/message-splitter.ts`. Determinístico (sem GPT
extra desde mai/2026):

1. Quebra por `\n\n` (parágrafos).
2. Se algum parágrafo > threshold, quebra por `. ` (sentenças).
3. Re-agrupa pra não ultrapassar threshold mas manter contexto.

Custo: zero OpenAI (deterministic chunking). Comentário stale anterior dizia que usava
GPT extra — atualizado em PR #369.

### Defaults conservadores

`split_enabled = false` por default — cliente novo recebe msg inteira. Cliente liga em UI
"Humanização" se quer o efeito.

## Business hours

Quando `business_hours_enabled = true` e msg do lead chega fora do range, IA NÃO responde
normalmente — envia `after_hours_message` 1x e cooldown 6h antes de repetir.

### Schema

```ts
type DayName = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

interface DayHours {
  start: string;  // "HH:MM"
  end: string;    // "HH:MM"
}

type BusinessHours = Record<DayName, DayHours | null>;  // null = fechado
```

Default:

```ts
{
  monday: { start: "09:00", end: "18:00" },
  tuesday: { start: "09:00", end: "18:00" },
  wednesday: { start: "09:00", end: "18:00" },
  thursday: { start: "09:00", end: "18:00" },
  friday: { start: "09:00", end: "18:00" },
  saturday: null,
  sunday: null,
}
```

### Algoritmo

`isWithinBusinessHours(now, hours, timezone)` em humanization.ts:

```ts
1. Intl.DateTimeFormat({ timeZone, weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now)
2. Extrai weekday + HH + MM.
3. Olha hours[weekday]:
     - null → fechado → return false.
     - { start, end } → return nowMinutes >= startMinutes && nowMinutes < endMinutes.
4. Em qualquer erro de parsing → return TRUE (defensive — não bloquear silenciosamente).
```

Único caso especial: `hour = "24"` em alguns engines pra meia-noite → clamp pra 0.

### Cooldown after-hours

`shouldSendAfterHoursMessage(lastNotifiedAtIso, now)` checa
`agent_conversations.after_hours_notified_at`. Cooldown:

```ts
const AFTER_HOURS_NOTIFICATION_COOLDOWN_HOURS = 6;
```

Lógica:

```
Se não notificou ainda OU passou > 6h desde última notificação → envia.
Caso contrário → skip (não responde fora do horário).
```

`after_hours_message` max 500 chars, hardcoded. Cliente edita via UI.

### Timezone

`business_hours_timezone` default `"America/Sao_Paulo"`. UI não expõe Select pra outras
timezones — admin de outra tz precisa SQL Editor pra mudar JSONB.

Defensive: tenta criar `Intl.DateTimeFormat({ timeZone: raw })`. Se falhar (ex
"America/InvalidCity"), cai pro default.

## Handoff notification

Quando `stop_agent` é chamado E `agent_configs.handoff_notification_enabled = true`:

1. Carrega `handoff_notification_target_type` (`user` | `phone` | `email`) e
   `handoff_notification_target_address`.
2. Se `handoff_include_summary = true` (default), gera resumo via GPT (1 chamada
   `gpt-4o-mini` extra).
3. Render `handoff_notification_template` com vars:
   - `{{lead_name}}` — nome do lead.
   - `{{lead_phone}}` — phone normalizado.
   - `{{wa_link}}` — link pra abrir conversation no CRM.
   - `{{summary}}` — resumo gerado (vazio se include_summary=false).
   - `{{agent_name}}` — nome do agente.
4. Envia via provider.sendText pro target.

### Custo

- 1 call gpt-4o-mini extra por handoff quando `include_summary=true` (~$0.005).
- Cliente desliga em UI pra economizar — recebe notificação "enxuta" sem resumo.

### Template default

```
🚨 *Atendimento solicitado*

Lead: {{lead_name}}
WhatsApp: {{lead_phone}}
Link: {{wa_link}}

{{summary}}

Agente: {{agent_name}}
```

Cliente edita em UI "Notificações". Empty `{{summary}}` colapsa pra string vazia (não
deixa linha em branco).

## Tabela resumo de campos

| Campo | Default | Validação | Comportamento se 0/empty |
| --- | --- | --- | --- |
| `pause_keywords` | `["PAUSAR","HUMANO","STOP IA"]` | dedup + uppercase + unaccent | Array vazio = nenhuma keyword pausa |
| `resume_keywords` | `["ATIVAR","IA ON","VOLTAR IA"]` | idem | idem |
| `auto_pause_minutes` | 30 | clamp 0..1440 | 0 = nunca auto-pausa |
| `split_enabled` | false | boolean | false = nunca splita |
| `split_threshold_chars` | 200 | clamp 50..1000 | n/a (só lê se enabled) |
| `split_delay_seconds` | 2 | clamp 0..30 | 0 = sem delay (envia em sequência imediata) |
| `business_hours_enabled` | false | boolean | false = sempre dentro do horário |
| `business_hours_timezone` | "America/Sao_Paulo" | Intl.DateTimeFormat check | invalid → default |
| `business_hours` | seg-sex 9-18 | sanitize HH:MM | null no dia = fechado |
| `after_hours_message` | "Olá! Recebi..." | max 500 chars | empty → default |
| `handoff_include_summary` | true | boolean | false = template recebe `{{summary}}=""` |

## Pontos de extensão

### Timezone selecionável em UI

Hoje hardcoded em UI. Pra liberar:

1. Adicionar Select em `packages/ai-agent-ui/src/components/AgentEditor.tsx` aba
   "Humanização".
2. Validação via `Intl.supportedValuesOf("timeZone")`.
3. Salvar em `humanization_config.business_hours_timezone`.

Sem migration porque já é JSONB.

### Múltiplas janelas por dia (8-12 + 14-18)

Hoje cada dia tem 1 janela contígua. Pra suportar gap (almoço):

1. Mudar `DayHours` pra `{ ranges: DayRange[] }`.
2. `sanitizeDayHours` aceita array.
3. `isWithinBusinessHours` checa cada range.

Compatibility: ler `{ start, end }` legacy como `{ ranges: [{ start, end }] }`.

Não implementado — clientes hoje usam 8-18 simples.

### Keyword com efeito custom (não só pause/resume)

Cliente quer: "Se lead disser 'preço', mover pra stage X". Hoje precisa fazer via
`entry_node.trigger="keyword_match"` + edge nomeada. Solução existente — não adicionar
campo novo no humanization_config.

## Cross-refs

- Helpers compartilhados: `packages/shared/src/ai-agent/humanization.ts`
- Pause/resume runtime: `apps/crm/src/lib/ai-agent/executor.ts` (`matchPause`/`matchResume`)
- Conversation parity (assigned_to): [INVARIANTS § 3.4](./INVARIANTS.md)
- Send-guard: [03-flow-runtime.md § Send-guard](./03-flow-runtime.md)
- Troubleshoot "IA fora do horário": [10-runbooks.md](./10-runbooks.md)
