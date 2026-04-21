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
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json | null
          target_org_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          target_org_id?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          target_org_id?: string | null
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
      campaign_sends: {
        Row: {
          campaign_id: string
          created_at: string | null
          delivered_at: string | null
          error: string | null
          id: string
          lead_id: string
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
      deals: {
        Row: {
          assigned_to: string | null
          closed_at: string | null
          created_at: string | null
          currency: string | null
          id: string
          lead_id: string | null
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
          created_at?: string | null
          currency?: string | null
          id?: string
          lead_id?: string | null
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
          created_at?: string | null
          currency?: string | null
          id?: string
          lead_id?: string | null
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
          avatar_url: string | null
          channel: string | null
          created_at: string | null
          email: string | null
          id: string
          last_interaction_at: string | null
          metadata: Json | null
          name: string | null
          opt_in: boolean | null
          organization_id: string
          phone: string | null
          score: number | null
          source: string | null
          status: string | null
          updated_at: string | null
          whatsapp_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          channel?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          last_interaction_at?: string | null
          metadata?: Json | null
          name?: string | null
          opt_in?: boolean | null
          organization_id: string
          phone?: string | null
          score?: number | null
          source?: string | null
          status?: string | null
          updated_at?: string | null
          whatsapp_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          channel?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          last_interaction_at?: string | null
          metadata?: Json | null
          name?: string | null
          opt_in?: boolean | null
          organization_id?: string
          phone?: string | null
          score?: number | null
          source?: string | null
          status?: string | null
          updated_at?: string | null
          whatsapp_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      pipeline_stages: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
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
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          full_name: string | null
          id: string
          is_superadmin: boolean | null
          phone: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string | null
          id: string
          is_superadmin?: boolean | null
          phone?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string
          is_superadmin?: boolean | null
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
      [_ in never]: never
    }
    Functions: {
      generate_short_id: { Args: { length?: number }; Returns: string }
      get_my_org_ids: { Args: never; Returns: string[] }
      get_user_org_ids: { Args: never; Returns: string[] }
      get_user_org_role: { Args: { p_org_id: string }; Returns: string }
      is_org_admin: { Args: { org_id: string }; Returns: boolean }
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
  public: {
    Enums: {},
  },
} as const
