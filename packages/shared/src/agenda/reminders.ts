// Agenda — reminder configs + sends.
//
// Modelo: cada org tem N AgendaReminderConfig. Quando um Appointment eh
// criado (ou tem status mudado de volta pra ativo), um trigger DB enfileira
// 1 AgendaReminderSend por config aplicavel. O cron tick processa pendentes
// (`scheduled_for <= now() AND status = 'pending'`).

export type ReminderTriggerWhen = "on_create" | "before_start";
export type ReminderChannel = "whatsapp";
export type ReminderSendStatus =
  | "pending"
  | "sent"
  | "failed"
  | "skipped"
  | "cancelled";

/**
 * Variaveis que o template pode interpolar com {{nome}}. Nomes em snake_case
 * pra match com colunas do DB. Renderer faz fallback string vazia em ausentes.
 */
export const REMINDER_TEMPLATE_VARIABLES = [
  "lead_name",
  "appointment_title",
  "appointment_date", // "04/05/2026"
  "appointment_time", // "09:00"
  "appointment_weekday", // "segunda-feira"
  "appointment_location",
  "appointment_meeting_url",
  "duration_minutes",
  "organization_name",
  "host_name",
] as const;

export type ReminderTemplateVariable =
  (typeof REMINDER_TEMPLATE_VARIABLES)[number];

export interface AgendaReminderConfig {
  id: string;
  organization_id: string;
  name: string;
  trigger_when: ReminderTriggerWhen;
  /**
   * Quando trigger_when='before_start': minutos antes de start_at
   *   (ex: 1440 = 24h, 60 = 1h).
   * Quando trigger_when='on_create': ignorado (DB sempre usa now()+1min).
   */
  trigger_offset_minutes: number;
  channel: ReminderChannel;
  /** Texto com {{variaveis}}. */
  template_text: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgendaReminderSend {
  id: string;
  appointment_id: string;
  reminder_config_id: string;
  organization_id: string;
  scheduled_for: string;
  sent_at: string | null;
  status: ReminderSendStatus;
  message_id: string | null;
  error: string | null;
  attempted_count: number;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Template renderer
// ============================================================================

/**
 * Interpola {{variavel}} no template. Variaveis ausentes ou undefined
 * viram string vazia (nao "{{undefined}}"). Suporta espacos: {{ var }} ok.
 */
export function renderReminderTemplate(
  template: string,
  vars: Partial<Record<ReminderTemplateVariable, string | number | null | undefined>>,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    const value = vars[key as ReminderTemplateVariable];
    if (value === null || value === undefined) return "";
    return String(value);
  });
}

/**
 * Extrai a lista de variaveis usadas no template. Util pra preview / validacao.
 */
export function extractTemplateVariables(template: string): string[] {
  const used = new Set<string>();
  for (const m of template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
    used.add(m[1]!);
  }
  return Array.from(used);
}

// ============================================================================
// Defaults sugeridos pra primeira instalacao da org
// ============================================================================

export interface ReminderDefault {
  name: string;
  trigger_when: ReminderTriggerWhen;
  trigger_offset_minutes: number;
  template_text: string;
}

export const DEFAULT_REMINDERS: ReminderDefault[] = [
  {
    name: "Confirmação imediata",
    trigger_when: "on_create",
    trigger_offset_minutes: 0,
    template_text:
      "Olá {{lead_name}}! 👋\n\nSeu agendamento foi confirmado:\n📅 {{appointment_weekday}}, {{appointment_date}} às {{appointment_time}}\n📋 {{appointment_title}}\n\nQualquer dúvida, é só responder esta mensagem.",
  },
  {
    name: "Lembrete 24h antes",
    trigger_when: "before_start",
    trigger_offset_minutes: 1440,
    template_text:
      "Oi {{lead_name}}! 😊\n\nLembrete: amanhã ({{appointment_date}}) às {{appointment_time}} temos:\n📋 {{appointment_title}}\n\nNos vemos lá!",
  },
  {
    name: "Lembrete 1h antes",
    trigger_when: "before_start",
    trigger_offset_minutes: 60,
    template_text:
      "Oi {{lead_name}}! Em 1 hora começa nosso encontro:\n📋 {{appointment_title}} — {{appointment_time}}\n\nAté já! 🙌",
  },
];
