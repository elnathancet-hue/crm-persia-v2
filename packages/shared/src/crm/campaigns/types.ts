// types.ts — Tipos compartilhados do módulo de campanhas.
// Espelham exatamente o schema SQL da migration 088.

// ─── Enums ────────────────────────────────────────────────────────────────────

export type CampaignKind = "lead_campaign" | "group_campaign";

export type CampaignMode = "single" | "sequence" | "recurring";

export type CampaignStatus =
  | "draft"
  | "validating"
  | "scheduled"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export type StepSendMode =
  | "immediate"
  | "scheduled_at"
  | "delay_after_previous";

export type StepDelayUnit = "minutes" | "hours" | "days";

export type StepMediaType = "none" | "image" | "video" | "audio" | "document";

export type TargetKind =
  | "segment"
  | "tag"
  | "funnel_stage"
  | "lead"
  | "group"
  | "manual";

export type RecipientType = "lead" | "group";

export type RecipientStatus =
  | "pending"
  | "active"
  | "completed"
  | "stopped"
  | "failed"
  | "ineligible";

export type JobStatus =
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "skipped"
  | "cancelled";

// ─── DB Row types ─────────────────────────────────────────────────────────────

export interface CrmCampaign {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  kind: CampaignKind;
  mode: CampaignMode;
  status: CampaignStatus;
  timezone: string;
  send_window_start: string | null; // "HH:MM:SS"
  send_window_end: string | null;
  rate_limit_per_minute: number | null;
  stop_on_reply: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmCampaignStep {
  id: string;
  organization_id: string;
  campaign_id: string;
  position: number;
  send_mode: StepSendMode;
  scheduled_at: string | null;
  delay_amount: number | null;
  delay_unit: StepDelayUnit | null;
  message_text: string | null;
  media_type: StepMediaType;
  media_url: string | null;
  media_filename: string | null;
  media_mime_type: string | null;
  media_size: number | null;
  caption: string | null;
  stop_if_replied: boolean | null;
  created_at: string;
}

export interface CrmCampaignTarget {
  id: string;
  organization_id: string;
  campaign_id: string;
  target_kind: TargetKind;
  target_id: string | null;
  filters: Record<string, unknown>;
  created_at: string;
}

export interface CrmCampaignRecipient {
  id: string;
  organization_id: string;
  campaign_id: string;
  recipient_type: RecipientType;
  lead_id: string | null;
  group_id: string | null;
  conversation_id: string | null;
  phone: string | null;
  chat_jid: string | null;
  display_name: string | null;
  status: RecipientStatus;
  ineligible_reason: string | null;
  last_response_at: string | null;
  resolved_from: Record<string, unknown>;
  created_at: string;
}

export interface CrmCampaignMessageJob {
  id: string;
  organization_id: string;
  campaign_id: string;
  step_id: string;
  recipient_id: string;
  send_at: string;
  status: JobStatus;
  attempts: number;
  last_error: string | null;
  provider_message_id: string | null;
  sent_at: string | null;
  locked_at: string | null;
  locked_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmCampaignEvent {
  id: string;
  organization_id: string;
  campaign_id: string;
  recipient_id: string | null;
  job_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

// ─── Input types ──────────────────────────────────────────────────────────────

export interface CreateCampaignStepInput {
  position: number;
  send_mode: StepSendMode;
  scheduled_at?: string | null;
  delay_amount?: number | null;
  delay_unit?: StepDelayUnit | null;
  message_text?: string | null;
  media_type?: StepMediaType;
  media_url?: string | null;
  media_filename?: string | null;
  media_mime_type?: string | null;
  media_size?: number | null;
  caption?: string | null;
  stop_if_replied?: boolean | null;
}

export interface CreateCampaignTargetInput {
  target_kind: TargetKind;
  target_id?: string | null;
  filters?: Record<string, unknown>;
}

export interface CreateCampaignDraftInput {
  name: string;
  description?: string | null;
  kind: CampaignKind;
  mode?: CampaignMode;
  timezone?: string;
  send_window_start?: string | null;
  send_window_end?: string | null;
  rate_limit_per_minute?: number | null;
  stop_on_reply?: boolean;
  steps: CreateCampaignStepInput[];
  targets: CreateCampaignTargetInput[];
}

export interface UpdateCampaignDraftInput {
  name?: string;
  description?: string | null;
  mode?: CampaignMode;
  timezone?: string;
  send_window_start?: string | null;
  send_window_end?: string | null;
  rate_limit_per_minute?: number | null;
  stop_on_reply?: boolean;
  steps?: CreateCampaignStepInput[];
  targets?: CreateCampaignTargetInput[];
}

// ─── Audience preview ─────────────────────────────────────────────────────────

export interface AudienceRecipientPreview {
  recipient_type: RecipientType;
  lead_id?: string;
  group_id?: string;
  phone?: string | null;
  chat_jid?: string | null;
  display_name?: string | null;
  eligible: boolean;
  ineligible_reason?: string;
  resolved_from: Record<string, unknown>;
}

export interface CampaignAudiencePreview {
  found_count: number;
  eligible_count: number;
  ineligible_count: number;
  duplicate_count: number;
  recipients: AudienceRecipientPreview[];
  warnings: string[];
  errors: string[];
  snapshot_hash: string;
}

export interface CampaignTargetInput {
  target_kind: TargetKind;
  target_id?: string | null;
  filters?: Record<string, unknown>;
}

// ─── Campaign with detail ─────────────────────────────────────────────────────

export interface CrmCampaignWithDetails extends CrmCampaign {
  steps: CrmCampaignStep[];
  targets: CrmCampaignTarget[];
  recipient_counts?: {
    total: number;
    pending: number;
    active: number;
    completed: number;
    stopped: number;
    failed: number;
    ineligible: number;
  };
  job_counts?: {
    queued: number;
    sent: number;
    failed: number;
    skipped: number;
    cancelled: number;
  };
}
