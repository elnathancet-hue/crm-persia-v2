export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          error_msg: string | null
          id: string
          ip: unknown
          metadata: Json | null
          request_id: string | null
          result: string | null
          target_org_id: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          error_msg?: string | null
          id?: string
          ip?: unknown
          metadata?: Json | null
          request_id?: string | null
          result?: string | null
          target_org_id?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          error_msg?: string | null
          id?: string
          ip?: unknown
          metadata?: Json | null
          request_id?: string | null
          result?: string | null
          target_org_id?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_target_org_id_fkey"
            columns: ["target_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agenda_reminder_configs: {
        Row: {
          channel: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          template_text: string
          trigger_offset_minutes: number
          trigger_when: string
          updated_at: string
        }
        Insert: {
          channel?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          template_text: string
          trigger_offset_minutes?: number
          trigger_when?: string
          updated_at?: string
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          template_text?: string
          trigger_offset_minutes?: number
          trigger_when?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agenda_reminder_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agenda_reminder_sends: {
        Row: {
          appointment_id: string
          attempted_count: number
          created_at: string
          error: string | null
          id: string
          message_id: string | null
          organization_id: string
          reminder_config_id: string
          scheduled_for: string
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          appointment_id: string
          attempted_count?: number
          created_at?: string
          error?: string | null
          id?: string
          message_id?: string | null
          organization_id: string
          reminder_config_id: string
          scheduled_for: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          attempted_count?: number
          created_at?: string
          error?: string | null
          id?: string
          message_id?: string | null
          organization_id?: string
          reminder_config_id?: string
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agenda_reminder_sends_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_reminder_sends_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_reminder_sends_reminder_config_id_fkey"
            columns: ["reminder_config_id"]
            isOneToOne: false
            referencedRelation: "agenda_reminder_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      agenda_services: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean
          name: string
          organization_id: string
          price_cents: number | null
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          price_cents?: number | null
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          price_cents?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agenda_services_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_calendar_connections: {
        Row: {
          connected_by_user_id: string
          created_at: string
          display_name: string
          encrypted_refresh_token_id: string
          google_account_email: string
          google_calendar_id: string
          id: string
          last_error: string | null
          last_refreshed_at: string | null
          organization_id: string
          status: string
          updated_at: string
        }
        Insert: {
          connected_by_user_id: string
          created_at?: string
          display_name: string
          encrypted_refresh_token_id: string
          google_account_email: string
          google_calendar_id?: string
          id?: string
          last_error?: string | null
          last_refreshed_at?: string | null
          organization_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          connected_by_user_id?: string
          created_at?: string
          display_name?: string
          encrypted_refresh_token_id?: string
          google_account_email?: string
          google_calendar_id?: string
          id?: string
          last_error?: string | null
          last_refreshed_at?: string | null
          organization_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_calendar_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_configs: {
        Row: {
          calendar_connection_id: string | null
          context_summary_recent_messages: number
          context_summary_token_threshold: number
          context_summary_turn_threshold: number
          created_at: string
          debounce_window_ms: number
          description: string | null
          guardrails: Json
          handoff_notification_enabled: boolean
          handoff_notification_target_address: string | null
          handoff_notification_target_type: string | null
          handoff_notification_template: string | null
          id: string
          model: string
          name: string
          organization_id: string
          scope_id: string | null
          scope_type: string
          status: string
          system_prompt: string
          updated_at: string
        }
        Insert: {
          calendar_connection_id?: string | null
          context_summary_recent_messages?: number
          context_summary_token_threshold?: number
          context_summary_turn_threshold?: number
          created_at?: string
          debounce_window_ms?: number
          description?: string | null
          guardrails?: Json
          handoff_notification_enabled?: boolean
          handoff_notification_target_address?: string | null
          handoff_notification_target_type?: string | null
          handoff_notification_template?: string | null
          id?: string
          model: string
          name: string
          organization_id: string
          scope_id?: string | null
          scope_type?: string
          status?: string
          system_prompt?: string
          updated_at?: string
        }
        Update: {
          calendar_connection_id?: string | null
          context_summary_recent_messages?: number
          context_summary_token_threshold?: number
          context_summary_turn_threshold?: number
          created_at?: string
          debounce_window_ms?: number
          description?: string | null
          guardrails?: Json
          handoff_notification_enabled?: boolean
          handoff_notification_target_address?: string | null
          handoff_notification_target_type?: string | null
          handoff_notification_template?: string | null
          id?: string
          model?: string
          name?: string
          organization_id?: string
          scope_id?: string | null
          scope_type?: string
          status?: string
          system_prompt?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_configs_calendar_connection_id_fkey"
            columns: ["calendar_connection_id"]
            isOneToOne: false
            referencedRelation: "agent_calendar_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_conversations: {
        Row: {
          config_id: string
          created_at: string
          crm_conversation_id: string | null
          current_stage_id: string | null
          flush_claim_expires_at: string | null
          flush_claimed_at: string | null
          history_summary: string | null
          history_summary_run_count: number
          history_summary_token_count: number
          history_summary_updated_at: string | null
          human_handoff_at: string | null
          human_handoff_reason: string | null
          id: string
          last_interaction_at: string | null
          lead_id: string | null
          next_flush_at: string | null
          organization_id: string
          tokens_used_total: number
          updated_at: string
          variables: Json
        }
        Insert: {
          config_id: string
          created_at?: string
          crm_conversation_id?: string | null
          current_stage_id?: string | null
          flush_claim_expires_at?: string | null
          flush_claimed_at?: string | null
          history_summary?: string | null
          history_summary_run_count?: number
          history_summary_token_count?: number
          history_summary_updated_at?: string | null
          human_handoff_at?: string | null
          human_handoff_reason?: string | null
          id?: string
          last_interaction_at?: string | null
          lead_id?: string | null
          next_flush_at?: string | null
          organization_id: string
          tokens_used_total?: number
          updated_at?: string
          variables?: Json
        }
        Update: {
          config_id?: string
          created_at?: string
          crm_conversation_id?: string | null
          current_stage_id?: string | null
          flush_claim_expires_at?: string | null
          flush_claimed_at?: string | null
          history_summary?: string | null
          history_summary_run_count?: number
          history_summary_token_count?: number
          history_summary_updated_at?: string | null
          human_handoff_at?: string | null
          human_handoff_reason?: string | null
          id?: string
          last_interaction_at?: string | null
          lead_id?: string | null
          next_flush_at?: string | null
          organization_id?: string
          tokens_used_total?: number
          updated_at?: string
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "agent_conversations_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "agent_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_conversations_crm_conversation_id_fkey"
            columns: ["crm_conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_conversations_current_stage_id_fkey"
            columns: ["current_stage_id"]
            isOneToOne: false
            referencedRelation: "agent_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_cost_limits: {
        Row: {
          created_at: string
          id: string
          max_tokens: number | null
          max_usd_cents: number | null
          organization_id: string
          scope: string
          subject_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          max_tokens?: number | null
          max_usd_cents?: number | null
          organization_id: string
          scope: string
          subject_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          max_tokens?: number | null
          max_usd_cents?: number | null
          organization_id?: string
          scope?: string
          subject_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_cost_limits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_cost_limits_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "agent_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_followup_runs: {
        Row: {
          conversation_id: string
          fired_at: string
          followup_id: string
          id: string
          organization_id: string
        }
        Insert: {
          conversation_id: string
          fired_at?: string
          followup_id: string
          id?: string
          organization_id: string
        }
        Update: {
          conversation_id?: string
          fired_at?: string
          followup_id?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_followup_runs_followup_id_fkey"
            columns: ["followup_id"]
            isOneToOne: false
            referencedRelation: "agent_followups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_followup_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_followups: {
        Row: {
          config_id: string
          created_at: string
          delay_hours: number
          id: string
          is_enabled: boolean
          name: string
          order_index: number
          organization_id: string
          template_id: string
          updated_at: string
        }
        Insert: {
          config_id: string
          created_at?: string
          delay_hours: number
          id?: string
          is_enabled?: boolean
          name: string
          order_index?: number
          organization_id: string
          template_id: string
          updated_at?: string
        }
        Update: {
          config_id?: string
          created_at?: string
          delay_hours?: number
          id?: string
          is_enabled?: boolean
          name?: string
          order_index?: number
          organization_id?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_followups_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "agent_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_followups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_followups_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "agent_notification_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_indexing_jobs: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          organization_id: string
          source_id: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          organization_id: string
          source_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          organization_id?: string
          source_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_indexing_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_indexing_jobs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "agent_knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_knowledge_chunks: {
        Row: {
          chunk_index: number
          config_id: string
          content: string
          created_at: string
          embedding: string | null
          id: string
          organization_id: string
          source_id: string
          token_count: number
        }
        Insert: {
          chunk_index: number
          config_id: string
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
          organization_id: string
          source_id: string
          token_count: number
        }
        Update: {
          chunk_index?: number
          config_id?: string
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
          organization_id?: string
          source_id?: string
          token_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_knowledge_chunks_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "agent_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_knowledge_chunks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_knowledge_chunks_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "agent_knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_knowledge_sources: {
        Row: {
          chunk_count: number
          config_id: string
          created_at: string
          id: string
          indexed_at: string | null
          indexing_error: string | null
          indexing_status: string
          metadata: Json
          organization_id: string
          source_type: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          chunk_count?: number
          config_id: string
          created_at?: string
          id?: string
          indexed_at?: string | null
          indexing_error?: string | null
          indexing_status?: string
          metadata?: Json
          organization_id: string
          source_type: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          chunk_count?: number
          config_id?: string
          created_at?: string
          id?: string
          indexed_at?: string | null
          indexing_error?: string | null
          indexing_status?: string
          metadata?: Json
          organization_id?: string
          source_type?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_knowledge_sources_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "agent_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_knowledge_sources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_notification_templates: {
        Row: {
          body_template: string
          config_id: string
          created_at: string
          description: string
          id: string
          name: string
          organization_id: string
          status: string
          target_address: string
          target_type: string
          updated_at: string
        }
        Insert: {
          body_template: string
          config_id: string
          created_at?: string
          description: string
          id?: string
          name: string
          organization_id: string
          status?: string
          target_address: string
          target_type: string
          updated_at?: string
        }
        Update: {
          body_template?: string
          config_id?: string
          created_at?: string
          description?: string
          id?: string
          name?: string
          organization_id?: string
          status?: string
          target_address?: string
          target_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_notification_templates_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "agent_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_notification_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          agent_conversation_id: string
          cost_usd_cents: number
          created_at: string
          duration_ms: number
          error_msg: string | null
          id: string
          inbound_message_id: string | null
          model: string
          organization_id: string
          status: string
          tokens_input: number
          tokens_output: number
        }
        Insert: {
          agent_conversation_id: string
          cost_usd_cents?: number
          created_at?: string
          duration_ms?: number
          error_msg?: string | null
          id?: string
          inbound_message_id?: string | null
          model: string
          organization_id: string
          status?: string
          tokens_input?: number
          tokens_output?: number
        }
        Update: {
          agent_conversation_id?: string
          cost_usd_cents?: number
          created_at?: string
          duration_ms?: number
          error_msg?: string | null
          id?: string
          inbound_message_id?: string | null
          model?: string
          organization_id?: string
          status?: string
          tokens_input?: number
          tokens_output?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_agent_conversation_id_fkey"
            columns: ["agent_conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_inbound_message_id_fkey"
            columns: ["inbound_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_scheduled_jobs: {
        Row: {
          claimed_at: string | null
          config_id: string
          created_at: string
          cron_expr: string
          id: string
          last_run_at: string | null
          last_run_error: string | null
          last_run_leads_processed: number
          lead_filter: Json
          name: string
          next_run_at: string | null
          organization_id: string
          status: string
          template_id: string
          updated_at: string
        }
        Insert: {
          claimed_at?: string | null
          config_id: string
          created_at?: string
          cron_expr: string
          id?: string
          last_run_at?: string | null
          last_run_error?: string | null
          last_run_leads_processed?: number
          lead_filter?: Json
          name: string
          next_run_at?: string | null
          organization_id: string
          status?: string
          template_id: string
          updated_at?: string
        }
        Update: {
          claimed_at?: string | null
          config_id?: string
          created_at?: string
          cron_expr?: string
          id?: string
          last_run_at?: string | null
          last_run_error?: string | null
          last_run_leads_processed?: number
          lead_filter?: Json
          name?: string
          next_run_at?: string | null
          organization_id?: string
          status?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_scheduled_jobs_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "agent_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_scheduled_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_scheduled_jobs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "agent_notification_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_scheduled_runs: {
        Row: {
          duration_ms: number
          error_samples: Json
          errors: number
          finished_at: string | null
          id: string
          leads_matched: number
          leads_processed: number
          leads_skipped: number
          organization_id: string
          scheduled_job_id: string
          started_at: string
        }
        Insert: {
          duration_ms?: number
          error_samples?: Json
          errors?: number
          finished_at?: string | null
          id?: string
          leads_matched?: number
          leads_processed?: number
          leads_skipped?: number
          organization_id: string
          scheduled_job_id: string
          started_at?: string
        }
        Update: {
          duration_ms?: number
          error_samples?: Json
          errors?: number
          finished_at?: string | null
          id?: string
          leads_matched?: number
          leads_processed?: number
          leads_skipped?: number
          organization_id?: string
          scheduled_job_id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_scheduled_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_scheduled_runs_scheduled_job_id_fkey"
            columns: ["scheduled_job_id"]
            isOneToOne: false
            referencedRelation: "agent_scheduled_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_stage_tools: {
        Row: {
          created_at: string
          is_enabled: boolean
          organization_id: string
          stage_id: string
          tool_id: string
        }
        Insert: {
          created_at?: string
          is_enabled?: boolean
          organization_id: string
          stage_id: string
          tool_id: string
        }
        Update: {
          created_at?: string
          is_enabled?: boolean
          organization_id?: string
          stage_id?: string
          tool_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_stage_tools_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_stage_tools_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "agent_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_stage_tools_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "agent_tools"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_stages: {
        Row: {
          config_id: string
          created_at: string
          id: string
          instruction: string
          order_index: number
          organization_id: string
          rag_enabled: boolean
          rag_top_k: number
          situation: string
          slug: string
          transition_hint: string | null
          updated_at: string
        }
        Insert: {
          config_id: string
          created_at?: string
          id?: string
          instruction?: string
          order_index?: number
          organization_id: string
          rag_enabled?: boolean
          rag_top_k?: number
          situation: string
          slug: string
          transition_hint?: string | null
          updated_at?: string
        }
        Update: {
          config_id?: string
          created_at?: string
          id?: string
          instruction?: string
          order_index?: number
          organization_id?: string
          rag_enabled?: boolean
          rag_top_k?: number
          situation?: string
          slug?: string
          transition_hint?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_stages_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "agent_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_stages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_steps: {
        Row: {
          created_at: string
          duration_ms: number
          id: string
          input: Json
          native_handler: string | null
          order_index: number
          organization_id: string
          output: Json
          run_id: string
          step_type: string
          tool_id: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number
          id?: string
          input?: Json
          native_handler?: string | null
          order_index?: number
          organization_id: string
          output?: Json
          run_id: string
          step_type: string
          tool_id?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number
          id?: string
          input?: Json
          native_handler?: string | null
          order_index?: number
          organization_id?: string
          output?: Json
          run_id?: string
          step_type?: string
          tool_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_steps_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "agent_tools"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_tools: {
        Row: {
          config_id: string
          created_at: string
          description: string
          execution_mode: string
          id: string
          input_schema: Json
          is_enabled: boolean
          name: string
          native_handler: string | null
          organization_id: string
          updated_at: string
          webhook_secret: string | null
          webhook_url: string | null
        }
        Insert: {
          config_id: string
          created_at?: string
          description: string
          execution_mode: string
          id?: string
          input_schema: Json
          is_enabled?: boolean
          name: string
          native_handler?: string | null
          organization_id: string
          updated_at?: string
          webhook_secret?: string | null
          webhook_url?: string | null
        }
        Update: {
          config_id?: string
          created_at?: string
          description?: string
          execution_mode?: string
          id?: string
          input_schema?: Json
          is_enabled?: boolean
          name?: string
          native_handler?: string | null
          organization_id?: string
          updated_at?: string
          webhook_secret?: string | null
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_tools_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "agent_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tools_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_assistants: {
        Row: {
          category: string | null
          context_max_messages: number | null
          context_min_messages: number | null
          context_time_window_hours: number | null
          created_at: string | null
          description: string | null
          frequency_penalty: number | null
          icon: string | null
          id: string
          is_active: boolean | null
          max_message_length: number | null
          message_splitting: Json | null
          model: string | null
          name: string
          off_hours_msg: string | null
          organization_id: string
          presence_penalty: number | null
          prompt: string
          provider: string | null
          schedule: Json | null
          sign_messages: boolean | null
          sign_name: string | null
          split_long_messages: boolean | null
          tone: string | null
          top_p: number | null
          total_conversations: number | null
          total_tokens_used: number | null
          typing_delay_seconds: number | null
          updated_at: string | null
          welcome_msg: string | null
        }
        Insert: {
          category?: string | null
          context_max_messages?: number | null
          context_min_messages?: number | null
          context_time_window_hours?: number | null
          created_at?: string | null
          description?: string | null
          frequency_penalty?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          max_message_length?: number | null
          message_splitting?: Json | null
          model?: string | null
          name?: string
          off_hours_msg?: string | null
          organization_id: string
          presence_penalty?: number | null
          prompt: string
          provider?: string | null
          schedule?: Json | null
          sign_messages?: boolean | null
          sign_name?: string | null
          split_long_messages?: boolean | null
          tone?: string | null
          top_p?: number | null
          total_conversations?: number | null
          total_tokens_used?: number | null
          typing_delay_seconds?: number | null
          updated_at?: string | null
          welcome_msg?: string | null
        }
        Update: {
          category?: string | null
          context_max_messages?: number | null
          context_min_messages?: number | null
          context_time_window_hours?: number | null
          created_at?: string | null
          description?: string | null
          frequency_penalty?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          max_message_length?: number | null
          message_splitting?: Json | null
          model?: string | null
          name?: string
          off_hours_msg?: string | null
          organization_id?: string
          presence_penalty?: number | null
          prompt?: string
          provider?: string | null
          schedule?: Json | null
          sign_messages?: boolean | null
          sign_name?: string | null
          split_long_messages?: boolean | null
          tone?: string | null
          top_p?: number | null
          total_conversations?: number | null
          total_tokens_used?: number | null
          typing_delay_seconds?: number | null
          updated_at?: string | null
          welcome_msg?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_assistants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_knowledge_base: {
        Row: {
          assistant_id: string
          content: string
          created_at: string | null
          file_path: string | null
          id: string
          organization_id: string
          source_type: string | null
          source_url: string | null
          title: string
        }
        Insert: {
          assistant_id: string
          content: string
          created_at?: string | null
          file_path?: string | null
          id?: string
          organization_id: string
          source_type?: string | null
          source_url?: string | null
          title: string
        }
        Update: {
          assistant_id?: string
          content?: string
          created_at?: string | null
          file_path?: string | null
          id?: string
          organization_id?: string
          source_type?: string | null
          source_url?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_knowledge_base_assistant_id_fkey"
            columns: ["assistant_id"]
            isOneToOne: false
            referencedRelation: "ai_assistants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_knowledge_base_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_history: {
        Row: {
          action: string
          appointment_id: string
          created_at: string
          id: string
          metadata: Json
          organization_id: string
          performed_by_role: string | null
          performed_by_user_id: string | null
        }
        Insert: {
          action: string
          appointment_id: string
          created_at?: string
          id?: string
          metadata?: Json
          organization_id: string
          performed_by_role?: string | null
          performed_by_user_id?: string | null
        }
        Update: {
          action?: string
          appointment_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          organization_id?: string
          performed_by_role?: string | null
          performed_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointment_history_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          booking_page_id: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by_role: string | null
          cancelled_by_user_id: string | null
          channel: string | null
          confirmation_sent_at: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          duration_minutes: number
          end_at: string
          external_calendar_connection_id: string | null
          external_event_id: string | null
          external_synced_at: string | null
          id: string
          kind: string
          lead_id: string | null
          location: string | null
          meeting_url: string | null
          organization_id: string
          recurrence_rule: string | null
          reminder_sent_at: string | null
          rescheduled_from_id: string | null
          service_id: string | null
          start_at: string
          status: string
          timezone: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          booking_page_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_role?: string | null
          cancelled_by_user_id?: string | null
          channel?: string | null
          confirmation_sent_at?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          duration_minutes: number
          end_at: string
          external_calendar_connection_id?: string | null
          external_event_id?: string | null
          external_synced_at?: string | null
          id?: string
          kind?: string
          lead_id?: string | null
          location?: string | null
          meeting_url?: string | null
          organization_id: string
          recurrence_rule?: string | null
          reminder_sent_at?: string | null
          rescheduled_from_id?: string | null
          service_id?: string | null
          start_at: string
          status?: string
          timezone?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          booking_page_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_role?: string | null
          cancelled_by_user_id?: string | null
          channel?: string | null
          confirmation_sent_at?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          duration_minutes?: number
          end_at?: string
          external_calendar_connection_id?: string | null
          external_event_id?: string | null
          external_synced_at?: string | null
          id?: string
          kind?: string
          lead_id?: string | null
          location?: string | null
          meeting_url?: string | null
          organization_id?: string
          recurrence_rule?: string | null
          reminder_sent_at?: string | null
          rescheduled_from_id?: string | null
          service_id?: string | null
          start_at?: string
          status?: string
          timezone?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_booking_page_id_fkey"
            columns: ["booking_page_id"]
            isOneToOne: false
            referencedRelation: "booking_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_external_calendar_connection_id_fkey"
            columns: ["external_calendar_connection_id"]
            isOneToOne: false
            referencedRelation: "agent_calendar_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_rescheduled_from_id_fkey"
            columns: ["rescheduled_from_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "agenda_services"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_tools: {
        Row: {
          category: string | null
          created_at: string | null
          description: string | null
          file_name: string
          file_size: number | null
          file_type: string
          file_url: string
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
          slug: string | null
          updated_at: string | null
          usage_count: number | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          file_name: string
          file_size?: number | null
          file_type: string
          file_url: string
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
          slug?: string | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          file_name?: string
          file_size?: number | null
          file_type?: string
          file_url?: string
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
          slug?: string | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_tools_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_rules: {
        Row: {
          created_at: string
          days: Json
          default_duration_minutes: number
          id: string
          is_default: boolean
          name: string
          organization_id: string
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          days?: Json
          default_duration_minutes?: number
          id?: string
          is_default?: boolean
          name?: string
          organization_id: string
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          days?: Json
          default_duration_minutes?: number
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_pages: {
        Row: {
          buffer_minutes: number
          created_at: string
          description: string | null
          duration_minutes: number
          id: string
          location: string | null
          lookahead_days: number
          meeting_url: string | null
          organization_id: string
          service_id: string | null
          slug: string
          status: string
          title: string
          total_bookings: number
          updated_at: string
          user_id: string
        }
        Insert: {
          buffer_minutes?: number
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          location?: string | null
          lookahead_days?: number
          meeting_url?: string | null
          organization_id: string
          service_id?: string | null
          slug: string
          status?: string
          title: string
          total_bookings?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          buffer_minutes?: number
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          location?: string | null
          lookahead_days?: number
          meeting_url?: string | null
          organization_id?: string
          service_id?: string | null
          slug?: string
          status?: string
          title?: string
          total_bookings?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_pages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_pages_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "agenda_services"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_sends: {
        Row: {
          campaign_id: string
          created_at: string | null
          delivered_at: string | null
          error: string | null
          id: string
          lead_id: string
          organization_id: string
          phone: string
          read_at: string | null
          replied_at: string | null
          sent_at: string | null
          status: string | null
          whatsapp_msg_id: string | null
        }
        Insert: {
          campaign_id: string
          created_at?: string | null
          delivered_at?: string | null
          error?: string | null
          id?: string
          lead_id: string
          organization_id: string
          phone: string
          read_at?: string | null
          replied_at?: string | null
          sent_at?: string | null
          status?: string | null
          whatsapp_msg_id?: string | null
        }
        Update: {
          campaign_id?: string
          created_at?: string | null
          delivered_at?: string | null
          error?: string | null
          id?: string
          lead_id?: string
          organization_id?: string
          phone?: string
          read_at?: string | null
          replied_at?: string | null
          sent_at?: string | null
          status?: string | null
          whatsapp_msg_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_sends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_sends_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          channel: string | null
          completed_at: string | null
          created_at: string | null
          id: string
          media_type: string | null
          media_url: string | null
          message: string | null
          name: string
          organization_id: string
          scheduled_at: string | null
          segment_id: string | null
          send_interval_seconds: number | null
          started_at: string | null
          status: string | null
          target_tags: string[] | null
          template_id: string | null
          total_delivered: number | null
          total_read: number | null
          total_replied: number | null
          total_sent: number | null
          total_target: number | null
          updated_at: string | null
          variables_template: Json | null
        }
        Insert: {
          channel?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          message?: string | null
          name: string
          organization_id: string
          scheduled_at?: string | null
          segment_id?: string | null
          send_interval_seconds?: number | null
          started_at?: string | null
          status?: string | null
          target_tags?: string[] | null
          template_id?: string | null
          total_delivered?: number | null
          total_read?: number | null
          total_replied?: number | null
          total_sent?: number | null
          total_target?: number | null
          updated_at?: string | null
          variables_template?: Json | null
        }
        Update: {
          channel?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          message?: string | null
          name?: string
          organization_id?: string
          scheduled_at?: string | null
          segment_id?: string | null
          send_interval_seconds?: number | null
          started_at?: string | null
          status?: string | null
          target_tags?: string[] | null
          template_id?: string | null
          total_delivered?: number | null
          total_read?: number | null
          total_replied?: number | null
          total_sent?: number | null
          total_target?: number | null
          updated_at?: string | null
          variables_template?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "wa_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          ai_summary: string | null
          assigned_to: string | null
          channel: string | null
          closed_at: string | null
          created_at: string | null
          id: string
          last_inbound_at: string | null
          last_message_at: string | null
          lead_id: string
          organization_id: string
          queue_id: string | null
          status: string | null
          unread_count: number | null
          updated_at: string | null
        }
        Insert: {
          ai_summary?: string | null
          assigned_to?: string | null
          channel?: string | null
          closed_at?: string | null
          created_at?: string | null
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          lead_id: string
          organization_id: string
          queue_id?: string | null
          status?: string | null
          unread_count?: number | null
          updated_at?: string | null
        }
        Update: {
          ai_summary?: string | null
          assigned_to?: string | null
          channel?: string | null
          closed_at?: string | null
          created_at?: string | null
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          lead_id?: string
          organization_id?: string
          queue_id?: string | null
          status?: string | null
          unread_count?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: false
            referencedRelation: "queues"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_fields: {
        Row: {
          created_at: string | null
          field_key: string
          field_type: string
          id: string
          is_required: boolean | null
          name: string
          options: Json | null
          organization_id: string
          sort_order: number | null
        }
        Insert: {
          created_at?: string | null
          field_key: string
          field_type: string
          id?: string
          is_required?: boolean | null
          name: string
          options?: Json | null
          organization_id: string
          sort_order?: number | null
        }
        Update: {
          created_at?: string | null
          field_key?: string
          field_type?: string
          id?: string
          is_required?: boolean | null
          name?: string
          options?: Json | null
          organization_id?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_fields_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_loss_reasons: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label: string
          organization_id: string
          requires_competitor: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          organization_id: string
          requires_competitor?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          organization_id?: string
          requires_competitor?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_loss_reasons_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          assigned_to: string | null
          closed_at: string | null
          competitor: string | null
          created_at: string | null
          currency: string | null
          id: string
          lead_id: string
          loss_note: string | null
          loss_reason: string | null
          metadata: Json | null
          organization_id: string
          pipeline_id: string
          sort_order: number | null
          stage_id: string
          status: string | null
          title: string
          updated_at: string | null
          value: number | null
        }
        Insert: {
          assigned_to?: string | null
          closed_at?: string | null
          competitor?: string | null
          created_at?: string | null
          currency?: string | null
          id?: string
          lead_id: string
          loss_note?: string | null
          loss_reason?: string | null
          metadata?: Json | null
          organization_id: string
          pipeline_id: string
          sort_order?: number | null
          stage_id: string
          status?: string | null
          title: string
          updated_at?: string | null
          value?: number | null
        }
        Update: {
          assigned_to?: string | null
          closed_at?: string | null
          competitor?: string | null
          created_at?: string | null
          currency?: string | null
          id?: string
          lead_id?: string
          loss_note?: string | null
          loss_reason?: string | null
          metadata?: Json | null
          organization_id?: string
          pipeline_id?: string
          sort_order?: number | null
          stage_id?: string
          status?: string | null
          title?: string
          updated_at?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaigns: {
        Row: {
          created_at: string | null
          html_content: string
          id: string
          name: string
          organization_id: string
          scheduled_at: string | null
          segment_id: string | null
          sent_at: string | null
          status: string | null
          subject: string
          target_tags: string[] | null
          template_id: string | null
          total_clicked: number | null
          total_opened: number | null
          total_sent: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          html_content: string
          id?: string
          name: string
          organization_id: string
          scheduled_at?: string | null
          segment_id?: string | null
          sent_at?: string | null
          status?: string | null
          subject: string
          target_tags?: string[] | null
          template_id?: string | null
          total_clicked?: number | null
          total_opened?: number | null
          total_sent?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          html_content?: string
          id?: string
          name?: string
          organization_id?: string
          scheduled_at?: string | null
          segment_id?: string | null
          sent_at?: string | null
          status?: string | null
          subject?: string
          target_tags?: string[] | null
          template_id?: string | null
          total_clicked?: number | null
          total_opened?: number | null
          total_sent?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaigns_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sends: {
        Row: {
          campaign_id: string
          clicked_at: string | null
          created_at: string | null
          email: string
          id: string
          lead_id: string
          opened_at: string | null
          organization_id: string
          sent_at: string | null
          status: string | null
        }
        Insert: {
          campaign_id: string
          clicked_at?: string | null
          created_at?: string | null
          email: string
          id?: string
          lead_id: string
          opened_at?: string | null
          organization_id: string
          sent_at?: string | null
          status?: string | null
        }
        Update: {
          campaign_id?: string
          clicked_at?: string | null
          created_at?: string | null
          email?: string
          id?: string
          lead_id?: string
          opened_at?: string | null
          organization_id?: string
          sent_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_sends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sends_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          created_at: string | null
          html_content: string
          id: string
          name: string
          organization_id: string
          subject: string
          text_content: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          html_content: string
          id?: string
          name: string
          organization_id: string
          subject: string
          text_content?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          html_content?: string
          id?: string
          name?: string
          organization_id?: string
          subject?: string
          text_content?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_executions: {
        Row: {
          completed_at: string | null
          created_at: string | null
          current_node_id: string | null
          flow_id: string
          id: string
          lead_id: string
          metadata: Json | null
          next_execution_at: string | null
          organization_id: string
          started_at: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          current_node_id?: string | null
          flow_id: string
          id?: string
          lead_id: string
          metadata?: Json | null
          next_execution_at?: string | null
          organization_id: string
          started_at?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          current_node_id?: string | null
          flow_id?: string
          id?: string
          lead_id?: string
          metadata?: Json | null
          next_execution_at?: string | null
          organization_id?: string
          started_at?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flow_executions_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_executions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_executions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      flows: {
        Row: {
          created_at: string | null
          description: string | null
          edges: Json
          id: string
          is_active: boolean | null
          name: string
          nodes: Json
          organization_id: string
          single_entry: boolean | null
          total_leads_entered: number | null
          trigger_config: Json | null
          trigger_type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          edges?: Json
          id?: string
          is_active?: boolean | null
          name: string
          nodes?: Json
          organization_id: string
          single_entry?: boolean | null
          total_leads_entered?: number | null
          trigger_config?: Json | null
          trigger_type?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          edges?: Json
          id?: string
          is_active?: boolean | null
          name?: string
          nodes?: Json
          organization_id?: string
          single_entry?: boolean | null
          total_leads_entered?: number | null
          trigger_config?: Json | null
          trigger_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          config: Json
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
          type: string
          updated_at: string | null
        }
        Insert: {
          config?: Json
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
          type: string
          updated_at?: string | null
        }
        Update: {
          config?: Json
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string | null
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_id: string
          role: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string | null
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          organization_id: string
          role?: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string | null
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_id?: string
          role?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      landing_pages: {
        Row: {
          conversions: number | null
          created_at: string | null
          cta_text: string | null
          cta_type: string | null
          cta_value: string | null
          custom_css: string | null
          description: string | null
          google_tag_id: string | null
          hero_image_url: string | null
          id: string
          is_published: boolean | null
          meta_pixel_id: string | null
          organization_id: string
          slug: string
          template: string | null
          title: string
          updated_at: string | null
          visits: number | null
        }
        Insert: {
          conversions?: number | null
          created_at?: string | null
          cta_text?: string | null
          cta_type?: string | null
          cta_value?: string | null
          custom_css?: string | null
          description?: string | null
          google_tag_id?: string | null
          hero_image_url?: string | null
          id?: string
          is_published?: boolean | null
          meta_pixel_id?: string | null
          organization_id: string
          slug: string
          template?: string | null
          title: string
          updated_at?: string | null
          visits?: number | null
        }
        Update: {
          conversions?: number | null
          created_at?: string | null
          cta_text?: string | null
          cta_type?: string | null
          cta_value?: string | null
          custom_css?: string | null
          description?: string | null
          google_tag_id?: string | null
          hero_image_url?: string | null
          id?: string
          is_published?: boolean | null
          meta_pixel_id?: string | null
          organization_id?: string
          slug?: string
          template?: string | null
          title?: string
          updated_at?: string | null
          visits?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "landing_pages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_activities: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          lead_id: string
          metadata: Json | null
          organization_id: string
          performed_by: string | null
          type: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          lead_id: string
          metadata?: Json | null
          organization_id: string
          performed_by?: string | null
          type: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          lead_id?: string
          metadata?: Json | null
          organization_id?: string
          performed_by?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          lead_id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          lead_id: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          lead_id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_comments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_custom_field_values: {
        Row: {
          created_at: string | null
          custom_field_id: string
          id: string
          lead_id: string
          organization_id: string
          updated_at: string | null
          value: string | null
        }
        Insert: {
          created_at?: string | null
          custom_field_id: string
          id?: string
          lead_id: string
          organization_id: string
          updated_at?: string | null
          value?: string | null
        }
        Update: {
          created_at?: string | null
          custom_field_id?: string
          id?: string
          lead_id?: string
          organization_id?: string
          updated_at?: string | null
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_custom_field_values_custom_field_id_fkey"
            columns: ["custom_field_id"]
            isOneToOne: false
            referencedRelation: "custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_custom_field_values_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_custom_field_values_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_products: {
        Row: {
          created_at: string
          id: string
          lead_id: string
          notes: string | null
          organization_id: string
          product_id: string
          quantity: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          lead_id: string
          notes?: string | null
          organization_id: string
          product_id: string
          quantity?: number
          unit_price?: number
        }
        Update: {
          created_at?: string
          id?: string
          lead_id?: string
          notes?: string | null
          organization_id?: string
          product_id?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "lead_products_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_tags: {
        Row: {
          created_at: string | null
          lead_id: string
          organization_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string | null
          lead_id: string
          organization_id: string
          tag_id: string
        }
        Update: {
          created_at?: string | null
          lead_id?: string
          organization_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_tags_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          address_city: string | null
          address_complement: string | null
          address_country: string | null
          address_neighborhood: string | null
          address_number: string | null
          address_state: string | null
          address_street: string | null
          address_zip: string | null
          assigned_to: string | null
          avatar_url: string | null
          channel: string | null
          created_at: string | null
          email: string | null
          expected_value: number | null
          id: string
          last_interaction_at: string | null
          metadata: Json | null
          name: string | null
          notes: string | null
          opt_in: boolean | null
          organization_id: string
          phone: string | null
          pipeline_id: string | null
          score: number | null
          sort_order: number
          source: string | null
          stage_id: string | null
          status: string | null
          updated_at: string | null
          website: string | null
          whatsapp_id: string | null
        }
        Insert: {
          address_city?: string | null
          address_complement?: string | null
          address_country?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          assigned_to?: string | null
          avatar_url?: string | null
          channel?: string | null
          created_at?: string | null
          email?: string | null
          expected_value?: number | null
          id?: string
          last_interaction_at?: string | null
          metadata?: Json | null
          name?: string | null
          notes?: string | null
          opt_in?: boolean | null
          organization_id: string
          phone?: string | null
          pipeline_id?: string | null
          score?: number | null
          sort_order?: number
          source?: string | null
          stage_id?: string | null
          status?: string | null
          updated_at?: string | null
          website?: string | null
          whatsapp_id?: string | null
        }
        Update: {
          address_city?: string | null
          address_complement?: string | null
          address_country?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          assigned_to?: string | null
          avatar_url?: string | null
          channel?: string | null
          created_at?: string | null
          email?: string | null
          expected_value?: number | null
          id?: string
          last_interaction_at?: string | null
          metadata?: Json | null
          name?: string | null
          notes?: string | null
          opt_in?: boolean | null
          organization_id?: string
          phone?: string | null
          pipeline_id?: string | null
          score?: number | null
          sort_order?: number
          source?: string | null
          stage_id?: string | null
          status?: string | null
          updated_at?: string | null
          website?: string | null
          whatsapp_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          category: string | null
          content: string
          created_at: string | null
          id: string
          name: string
          organization_id: string
          shortcut: string | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          content: string
          created_at?: string | null
          id?: string
          name: string
          organization_id: string
          shortcut?: string | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          content?: string
          created_at?: string | null
          id?: string
          name?: string
          organization_id?: string
          shortcut?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string | null
          conversation_id: string
          created_at: string | null
          id: string
          lead_id: string
          media_type: string | null
          media_url: string | null
          metadata: Json | null
          organization_id: string
          sender: string
          sender_user_id: string | null
          status: string | null
          template_send_id: string | null
          type: string | null
          whatsapp_msg_id: string | null
        }
        Insert: {
          content?: string | null
          conversation_id: string
          created_at?: string | null
          id?: string
          lead_id: string
          media_type?: string | null
          media_url?: string | null
          metadata?: Json | null
          organization_id: string
          sender: string
          sender_user_id?: string | null
          status?: string | null
          template_send_id?: string | null
          type?: string | null
          whatsapp_msg_id?: string | null
        }
        Update: {
          content?: string | null
          conversation_id?: string
          created_at?: string | null
          id?: string
          lead_id?: string
          media_type?: string | null
          media_url?: string | null
          metadata?: Json | null
          organization_id?: string
          sender?: string
          sender_user_id?: string | null
          status?: string | null
          template_send_id?: string | null
          type?: string | null
          whatsapp_msg_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_template_send_id_fkey"
            columns: ["template_send_id"]
            isOneToOne: false
            referencedRelation: "wa_template_sends"
            referencedColumns: ["id"]
          },
        ]
      }
      n8n_chat_histories: {
        Row: {
          id: number
          message: Json
          session_id: string
        }
        Insert: {
          id?: number
          message: Json
          session_id: string
        }
        Update: {
          id?: number
          message?: Json
          session_id?: string
        }
        Relationships: []
      }
      onboarding_progress: {
        Row: {
          completed_at: string | null
          created_at: string | null
          data: Json | null
          id: string
          organization_id: string
          step: number | null
          updated_at: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          data?: Json | null
          id?: string
          organization_id: string
          step?: number | null
          updated_at?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          data?: Json | null
          id?: string
          organization_id?: string
          step?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_progress_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          organization_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          organization_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          category: string | null
          cpf_cnpj: string | null
          created_at: string | null
          id: string
          logo_url: string | null
          name: string
          niche: string | null
          onboarding_completed: boolean | null
          plan: string | null
          services: Json | null
          settings: Json | null
          slug: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string | null
          website: string | null
        }
        Insert: {
          category?: string | null
          cpf_cnpj?: string | null
          created_at?: string | null
          id?: string
          logo_url?: string | null
          name: string
          niche?: string | null
          onboarding_completed?: boolean | null
          plan?: string | null
          services?: Json | null
          settings?: Json | null
          slug: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          category?: string | null
          cpf_cnpj?: string | null
          created_at?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          niche?: string | null
          onboarding_completed?: boolean | null
          plan?: string | null
          services?: Json | null
          settings?: Json | null
          slug?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Relationships: []
      }
      pending_messages: {
        Row: {
          agent_conversation_id: string
          created_at: string
          flushed_at: string | null
          id: string
          inbound_message_id: string | null
          media_ref: string | null
          message_type: string
          organization_id: string
          received_at: string
          text: string
        }
        Insert: {
          agent_conversation_id: string
          created_at?: string
          flushed_at?: string | null
          id?: string
          inbound_message_id?: string | null
          media_ref?: string | null
          message_type?: string
          organization_id: string
          received_at: string
          text?: string
        }
        Update: {
          agent_conversation_id?: string
          created_at?: string
          flushed_at?: string | null
          id?: string
          inbound_message_id?: string | null
          media_ref?: string | null
          message_type?: string
          organization_id?: string
          received_at?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_messages_agent_conversation_id_fkey"
            columns: ["agent_conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_messages_inbound_message_id_fkey"
            columns: ["inbound_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
          outcome: string
          pipeline_id: string
          sort_order: number
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
          outcome?: string
          pipeline_id: string
          sort_order?: number
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          outcome?: string
          pipeline_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      pipelines: {
        Row: {
          created_at: string | null
          id: string
          is_default: boolean | null
          name: string
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipelines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          price: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          price?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          full_name: string | null
          id: string
          is_superadmin: boolean
          phone: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string | null
          id: string
          is_superadmin?: boolean
          phone?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string
          is_superadmin?: boolean
          phone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      queue_members: {
        Row: {
          created_at: string | null
          is_active: boolean | null
          organization_id: string
          queue_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          is_active?: boolean | null
          organization_id: string
          queue_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          is_active?: boolean | null
          organization_id?: string
          queue_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "queue_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_members_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: false
            referencedRelation: "queues"
            referencedColumns: ["id"]
          },
        ]
      }
      queues: {
        Row: {
          created_at: string | null
          description: string | null
          distribution_type: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          distribution_type?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          distribution_type?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "queues_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          action: string
          count: number
          created_at: string
          expires_at: string
          id: string
          organization_id: string | null
          updated_at: string
          user_id: string
          window_started_at: string
        }
        Insert: {
          action: string
          count?: number
          created_at?: string
          expires_at: string
          id?: string
          organization_id?: string | null
          updated_at?: string
          user_id: string
          window_started_at?: string
        }
        Update: {
          action?: string
          count?: number
          created_at?: string
          expires_at?: string
          id?: string
          organization_id?: string | null
          updated_at?: string
          user_id?: string
          window_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_limits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string | null
          created_by: string | null
          id: string
          lead_id: string
          organization_id: string
          scheduled_at: string
          sent_at: string | null
          status: string | null
          type: string | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          lead_id: string
          organization_id: string
          scheduled_at: string
          sent_at?: string | null
          status?: string | null
          type?: string | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          lead_id?: string
          organization_id?: string
          scheduled_at?: string
          sent_at?: string | null
          status?: string | null
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      segments: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          lead_count: number | null
          name: string
          organization_id: string
          rules: Json
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          lead_count?: number | null
          name: string
          organization_id: string
          rules?: Json
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          lead_count?: number | null
          name?: string
          organization_id?: string
          rules?: Json
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "segments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string | null
          created_at: string | null
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_coexistence_events: {
        Row: {
          connection_id: string
          created_at: string
          error_detail: string | null
          event_type: string
          id: string
          organization_id: string
          payload: Json
          status: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          error_detail?: string | null
          event_type: string
          id?: string
          organization_id: string
          payload: Json
          status?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          error_detail?: string | null
          event_type?: string
          id?: string
          organization_id?: string
          payload?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_coexistence_events_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_coexistence_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_template_sends: {
        Row: {
          campaign_id: string | null
          conversation_id: string | null
          created_at: string
          delivered_at: string | null
          error_code: string | null
          error_detail: string | null
          id: string
          lead_id: string | null
          message_id: string | null
          organization_id: string
          read_at: string | null
          replied_at: string | null
          sent_at: string | null
          status: string
          template_id: string
          variables: Json
          wamid: string | null
        }
        Insert: {
          campaign_id?: string | null
          conversation_id?: string | null
          created_at?: string
          delivered_at?: string | null
          error_code?: string | null
          error_detail?: string | null
          id?: string
          lead_id?: string | null
          message_id?: string | null
          organization_id: string
          read_at?: string | null
          replied_at?: string | null
          sent_at?: string | null
          status?: string
          template_id: string
          variables?: Json
          wamid?: string | null
        }
        Update: {
          campaign_id?: string | null
          conversation_id?: string | null
          created_at?: string
          delivered_at?: string | null
          error_code?: string | null
          error_detail?: string | null
          id?: string
          lead_id?: string | null
          message_id?: string | null
          organization_id?: string
          read_at?: string | null
          replied_at?: string | null
          sent_at?: string | null
          status?: string
          template_id?: string
          variables?: Json
          wamid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_template_sends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_template_sends_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_template_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_template_sends_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_template_sends_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_template_sends_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "wa_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_templates: {
        Row: {
          category: string
          components: Json
          connection_id: string
          created_at: string
          id: string
          language: string
          last_synced_at: string
          meta_template_id: string
          name: string
          organization_id: string
          params_schema: Json
          status: string
          updated_at: string
        }
        Insert: {
          category: string
          components: Json
          connection_id: string
          created_at?: string
          id?: string
          language: string
          last_synced_at?: string
          meta_template_id: string
          name: string
          organization_id: string
          params_schema: Json
          status: string
          updated_at?: string
        }
        Update: {
          category?: string
          components?: Json
          connection_id?: string
          created_at?: string
          id?: string
          language?: string
          last_synced_at?: string
          meta_template_id?: string
          name?: string
          organization_id?: string
          params_schema?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_templates_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks: {
        Row: {
          created_at: string | null
          direction: string
          events: string[] | null
          id: string
          is_active: boolean | null
          last_triggered_at: string | null
          name: string
          organization_id: string
          token: string | null
          updated_at: string | null
          url: string | null
        }
        Insert: {
          created_at?: string | null
          direction: string
          events?: string[] | null
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          name: string
          organization_id: string
          token?: string | null
          updated_at?: string | null
          url?: string | null
        }
        Update: {
          created_at?: string | null
          direction?: string
          events?: string[] | null
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          name?: string
          organization_id?: string
          token?: string | null
          updated_at?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_connections: {
        Row: {
          access_token: string | null
          app_last_opened_at: string | null
          coexistence_activated_at: string | null
          coexistence_status: string | null
          created_at: string | null
          display_name: string | null
          id: string
          instance_token: string | null
          instance_url: string | null
          is_coexistence: boolean
          last_api_sent_at: string | null
          organization_id: string
          phone_number: string | null
          phone_number_id: string | null
          provider: string
          status: string | null
          updated_at: string | null
          waba_id: string | null
          webhook_verify_token: string | null
        }
        Insert: {
          access_token?: string | null
          app_last_opened_at?: string | null
          coexistence_activated_at?: string | null
          coexistence_status?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string
          instance_token?: string | null
          instance_url?: string | null
          is_coexistence?: boolean
          last_api_sent_at?: string | null
          organization_id: string
          phone_number?: string | null
          phone_number_id?: string | null
          provider?: string
          status?: string | null
          updated_at?: string | null
          waba_id?: string | null
          webhook_verify_token?: string | null
        }
        Update: {
          access_token?: string | null
          app_last_opened_at?: string | null
          coexistence_activated_at?: string | null
          coexistence_status?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string
          instance_token?: string | null
          instance_url?: string | null
          is_coexistence?: boolean
          last_api_sent_at?: string | null
          organization_id?: string
          phone_number?: string | null
          phone_number_id?: string | null
          provider?: string
          status?: string | null
          updated_at?: string | null
          waba_id?: string | null
          webhook_verify_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_groups: {
        Row: {
          category: string | null
          created_at: string | null
          description: string | null
          group_jid: string
          id: string
          invite_link: string | null
          is_announce: boolean | null
          name: string
          organization_id: string
          participant_count: number | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          group_jid: string
          id?: string
          invite_link?: string | null
          is_announce?: boolean | null
          name: string
          organization_id: string
          participant_count?: number | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          group_jid?: string
          id?: string
          invite_link?: string | null
          is_announce?: boolean | null
          name?: string
          organization_id?: string
          participant_count?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      agent_usage_daily: {
        Row: {
          avg_duration_ms: number | null
          config_id: string | null
          cost_usd_cents: number | null
          day: string | null
          failed_count: number | null
          fallback_count: number | null
          organization_id: string | null
          run_count: number | null
          succeeded_count: number | null
          tokens_input: number | null
          tokens_output: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_conversations_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "agent_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      claim_agent_conversation_flush: {
        Args: {
          p_agent_conversation_id: string
          p_lease_seconds?: number
          p_now?: string
          p_organization_id: string
        }
        Returns: boolean
      }
      claim_agent_indexing_job: {
        Args: { p_max_attempts?: number; p_now?: string }
        Returns: {
          attempts: number
          claimed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          organization_id: string
          source_id: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "agent_indexing_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_agent_scheduled_job: {
        Args: { p_now?: string }
        Returns: {
          claimed_at: string | null
          config_id: string
          created_at: string
          cron_expr: string
          id: string
          last_run_at: string | null
          last_run_error: string | null
          last_run_leads_processed: number
          lead_filter: Json
          name: string
          next_run_at: string | null
          organization_id: string
          status: string
          template_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "agent_scheduled_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_agent_conversation_flush: {
        Args: {
          p_agent_conversation_id: string
          p_completed_at?: string
          p_organization_id: string
          p_pending_message_ids: string[]
        }
        Returns: boolean
      }
      complete_agent_indexing_job: {
        Args: {
          p_chunks: Json
          p_completed_at?: string
          p_config_id: string
          p_job_id: string
          p_organization_id: string
          p_source_id: string
        }
        Returns: number
      }
      complete_agent_scheduled_job: {
        Args: {
          p_completed_at?: string
          p_job_id: string
          p_leads_processed: number
          p_next_run_at: string
          p_organization_id: string
        }
        Returns: boolean
      }
      consume_rate_limit: {
        Args: {
          p_action: string
          p_max_hits: number
          p_now?: string
          p_organization_id?: string
          p_user_id: string
          p_window_seconds: number
        }
        Returns: {
          allowed: boolean
          remaining: number
          reset_at: string
          retry_after_seconds: number
        }[]
      }
      enqueue_pending_message: {
        Args: {
          p_agent_conversation_id: string
          p_debounce_window_ms: number
          p_inbound_message_id?: string
          p_media_ref?: string
          p_message_type?: string
          p_organization_id: string
          p_received_at?: string
          p_text?: string
        }
        Returns: boolean
      }
      fail_agent_indexing_job: {
        Args: {
          p_error_message: string
          p_failed_at?: string
          p_job_id: string
          p_organization_id: string
          p_source_id: string
        }
        Returns: boolean
      }
      fail_agent_scheduled_job: {
        Args: {
          p_error_message: string
          p_failed_at?: string
          p_job_id: string
          p_next_run_at: string
          p_organization_id: string
        }
        Returns: boolean
      }
      generate_short_id: { Args: { length?: number }; Returns: string }
      get_my_org_ids: { Args: never; Returns: string[] }
      get_user_org_ids: { Args: never; Returns: string[] }
      get_user_org_role: { Args: { p_org_id: string }; Returns: string }
      is_org_admin: { Args: { org_id: string }; Returns: boolean }
      is_superadmin:
        | { Args: never; Returns: boolean }
        | { Args: { p_user_id: string }; Returns: boolean }
      match_agent_knowledge_chunks: {
        Args: {
          p_config_id: string
          p_organization_id: string
          p_query_embedding: string
          p_top_k?: number
        }
        Returns: {
          chunk_id: string
          content: string
          distance: number
          source_id: string
          source_title: string
          source_type: string
        }[]
      }
      release_agent_conversation_flush: {
        Args: {
          p_agent_conversation_id: string
          p_organization_id: string
          p_released_at?: string
        }
        Returns: boolean
      }
      seed_default_loss_reasons: {
        Args: { p_org_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
