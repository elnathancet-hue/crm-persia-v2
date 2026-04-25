// AI Agent — PR7.2 scheduled jobs contract.
//
// Cron-based reminders: dispara templates de notificação (criados em
// PR7.1) em horários programados, filtrando leads por critério. Resolve
// o gap "Lembretes Multi-Agendas" do n8n original (JSON 04).
//
// Diferente do handler `trigger_notification` (que o agente chama
// durante uma conversa), o scheduler roda no background via pg_cron —
// sem conversa ativa, sem LLM. O scheduler itera leads que batem com
// o filtro e dispara o template pra cada um.
//
// Schema lives em migration 025. Runtime lives em
// `apps/crm/src/lib/ai-agent/scheduler/` + endpoint
// `/api/ai-agent/scheduler/tick` (Codex, PR7.2b).

// ============================================================================
// Cron expression — 5-field POSIX cron
// ============================================================================

// Ex: "0 9 * * *" (todo dia 9h), "0 10 * * 1-5" (seg-sex 10h),
// "*/30 * * * *" (a cada 30min).
// Runtime valida via lib `cron-parser`. UI pode oferecer presets.
export const SCHEDULED_JOB_CRON_PRESETS: ReadonlyArray<{
  label: string;
  expr: string;
  description: string;
}> = [
  { label: "Todo dia às 9h", expr: "0 9 * * *", description: "Manhã útil" },
  {
    label: "Todo dia às 18h",
    expr: "0 18 * * *",
    description: "Fim do expediente",
  },
  {
    label: "Seg a sex, 9h",
    expr: "0 9 * * 1-5",
    description: "Só dias úteis",
  },
  {
    label: "Seg a sex, 10h e 16h",
    expr: "0 10,16 * * 1-5",
    description: "Dois disparos/dia úteis",
  },
  { label: "Toda hora", expr: "0 * * * *", description: "Teste rápido" },
  { label: "A cada 6 horas", expr: "0 */6 * * *", description: "4x/dia" },
];

// Limites
export const SCHEDULED_JOB_NAME_MIN_CHARS = 3;
export const SCHEDULED_JOB_NAME_MAX_CHARS = 80;
export const SCHEDULED_JOBS_MAX_PER_AGENT = 10;

// Runtime NÃO processa leads indefinidamente num único tick. Cap previne
// tick explodindo quando o filtro retorna milhares de linhas.
export const SCHEDULED_JOB_LEADS_PER_TICK_MAX = 500;

// Menor intervalo aceito entre execuções (anti-spam). Cron "* * * * *"
// (toda hora) passa, mas "*/1 * * * *" (todo minuto) não — rejeita.
export const SCHEDULED_JOB_MIN_INTERVAL_MINUTES = 15;

// ============================================================================
// Filtro de leads — JSONB serializado
// ============================================================================

export type LeadFilterAgeComparison = "gt" | "gte" | "lt" | "lte";

// Cada filtro é um AND implícito. Se vazio, aplica a TODOS os leads da
// org — perigoso, então UI obriga pelo menos um critério.
export interface LeadFilter {
  // Leads com qualquer uma dessas tags (slug match, OR).
  tag_slugs?: string[];

  // Leads num desses stages do pipeline.
  pipeline_stage_ids?: string[];

  // Leads num desses status ("ativo", "qualificado", "perdido", etc.).
  statuses?: string[];

  // Idade do lead (dias desde created_at).
  //  { days: 7, comparison: "gt" } => leads criados > 7 dias atrás
  age_days?: {
    days: number;
    comparison: LeadFilterAgeComparison;
  };

  // Quando true, só leads que ainda têm bot ativo (human_handoff_at IS
  // NULL em agent_conversations). Evita spam em lead que já foi pra
  // humano.
  only_active_agents?: boolean;

  // Debounce: pula leads que receberam mensagem do agente nas últimas
  // N horas (evita duplicar disparos quando lead responde).
  silence_recent_hours?: number;
}

export function isEmptyLeadFilter(filter: LeadFilter): boolean {
  return (
    (!filter.tag_slugs || filter.tag_slugs.length === 0) &&
    (!filter.pipeline_stage_ids || filter.pipeline_stage_ids.length === 0) &&
    (!filter.statuses || filter.statuses.length === 0) &&
    !filter.age_days &&
    !filter.only_active_agents &&
    !filter.silence_recent_hours
  );
}

// ============================================================================
// Status lifecycle
// ============================================================================

export type ScheduledJobStatus = "active" | "paused";

// ============================================================================
// Domain types — mirror agent_scheduled_jobs
// ============================================================================

export interface AgentScheduledJob {
  id: string;
  organization_id: string;
  config_id: string;
  name: string;
  // Template de notificação que será disparado pra cada lead do filtro.
  // FK pra agent_notification_templates(id). Runtime rejeita job se o
  // template foi deletado ou arquivado no tick.
  template_id: string;
  cron_expr: string;
  lead_filter: LeadFilter;
  status: ScheduledJobStatus;
  last_run_at: string | null;
  last_run_leads_processed: number;
  last_run_error: string | null;
  next_run_at: string | null; // computado quando status=active
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Input/output das server actions
// ============================================================================

export interface CreateScheduledJobInput {
  config_id: string;
  name: string;
  template_id: string;
  cron_expr: string;
  lead_filter: LeadFilter;
}

export interface UpdateScheduledJobInput {
  name?: string;
  template_id?: string;
  cron_expr?: string;
  lead_filter?: LeadFilter;
  status?: ScheduledJobStatus;
}

// ============================================================================
// Audit — scheduler não passa pelo executor (não é decisão do agente),
// mas o tick loga em agent_steps? Decisão do Codex em PR7.2b. Por ora,
// o scheduler grava métricas em last_run_* na própria row e opcionalmente
// em agent_scheduled_runs (tabela nova, audit trail por execução).
// ============================================================================

export interface ScheduledJobRunResult {
  job_id: string;
  started_at: string;
  finished_at: string;
  leads_matched: number;
  leads_processed: number;
  leads_skipped: number;
  errors: number;
  // Erros por lead (capped em 20 pra não virar log bomb).
  error_samples?: Array<{ lead_id: string; error: string }>;
}

// ============================================================================
// Validation helpers (UI + server)
// ============================================================================

// Validação leve de cron expression — só checa número de campos.
// Runtime (Codex) usa cron-parser pra validação completa.
export function isValidCronShape(expr: string): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return false;
  const parts = trimmed.split(/\s+/);
  // POSIX cron tem 5 campos. Algumas libs aceitam 6 (com segundos), mas
  // pg_cron só aceita 5, então restringe.
  return parts.length === 5;
}

export function validateLeadFilter(filter: LeadFilter): void {
  if (isEmptyLeadFilter(filter)) {
    throw new Error(
      "Filtro de leads precisa ter pelo menos um critério (tag, etapa, status, idade ou bot ativo)",
    );
  }
  if (filter.age_days) {
    if (
      !Number.isInteger(filter.age_days.days) ||
      filter.age_days.days < 0 ||
      filter.age_days.days > 3650
    ) {
      throw new Error("Idade em dias deve ser entre 0 e 3650");
    }
  }
  if (
    filter.silence_recent_hours !== undefined &&
    (filter.silence_recent_hours < 0 || filter.silence_recent_hours > 720)
  ) {
    throw new Error("Silêncio recente deve ser entre 0 e 720 horas (30 dias)");
  }
  if (filter.tag_slugs && filter.tag_slugs.length > 50) {
    throw new Error("Máximo 50 tags no filtro");
  }
  if (filter.pipeline_stage_ids && filter.pipeline_stage_ids.length > 50) {
    throw new Error("Máximo 50 etapas no filtro");
  }
  if (filter.statuses && filter.statuses.length > 20) {
    throw new Error("Máximo 20 status no filtro");
  }
}
