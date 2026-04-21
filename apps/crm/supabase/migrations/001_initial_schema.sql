-- ============================================================
-- CRM PERSIA - Schema Completo do Banco de Dados
-- PostgreSQL (Supabase)
-- ~30 tabelas para 19 modulos
-- ============================================================

-- ============================================================
-- FUNCOES AUXILIARES
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_short_id(length INT DEFAULT 8)
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'abcdefghijklmnopqrstuvwxyz0123456789';
  result TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..length LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- MODULO 1: MULTI-TENANT E ORGANIZACOES
-- ============================================================

CREATE TABLE public.organizations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  niche TEXT, -- advocacia, clinica, loja, agencia, educacao, restaurante, outro
  website TEXT,
  logo_url TEXT,
  plan TEXT DEFAULT 'trial', -- trial, starter, pro, scale
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  onboarding_completed BOOLEAN DEFAULT false,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.organization_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'agent', -- owner, admin, agent, viewer
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);

CREATE TABLE public.invitations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent',
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  token TEXT UNIQUE NOT NULL DEFAULT generate_short_id(32),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.onboarding_progress (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE UNIQUE,
  step INT DEFAULT 1, -- 1-5
  data JSONB DEFAULT '{}', -- dados coletados em cada passo
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Perfil do usuario (extensao do auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MODULO 5-8: LEADS, TAGS, SEGMENTACOES, CAMPOS PERSONALIZADOS
-- ============================================================

CREATE TABLE public.leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT,
  phone TEXT,
  email TEXT,
  avatar_url TEXT,
  source TEXT DEFAULT 'whatsapp', -- whatsapp, landing_page, import, manual, webhook
  status TEXT DEFAULT 'new', -- new, contacted, qualified, customer, lost
  score INT DEFAULT 0,
  whatsapp_id TEXT, -- ID do contato no WhatsApp
  channel TEXT DEFAULT 'whatsapp', -- whatsapp, instagram, messenger, email
  opt_in BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}',
  last_interaction_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.lead_activities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- created, edited, tag_added, tag_removed, flow_entered, flow_exited, message_sent, message_received, assigned, status_changed, score_changed, merged, imported
  description TEXT,
  metadata JSONB DEFAULT '{}',
  performed_by UUID REFERENCES auth.users(id), -- null = sistema/IA
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.tags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3b82f6', -- hex color
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, name)
);

CREATE TABLE public.lead_tags (
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (lead_id, tag_id)
);

CREATE TABLE public.segments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  rules JSONB NOT NULL DEFAULT '{"operator":"AND","conditions":[]}',
  -- rules example: {"operator":"AND","conditions":[{"field":"tags","op":"contains","value":"interessado"},{"field":"status","op":"eq","value":"new"}]}
  lead_count INT DEFAULT 0, -- cache, atualizado periodicamente
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.custom_fields (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  field_key TEXT NOT NULL, -- slug do campo (ex: "data_nascimento")
  field_type TEXT NOT NULL, -- text, number, date, select, multi_select, boolean, url, phone, email
  options JSONB, -- para select/multi_select: ["opcao1", "opcao2"]
  is_required BOOLEAN DEFAULT false,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, field_key)
);

CREATE TABLE public.lead_custom_field_values (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  custom_field_id UUID NOT NULL REFERENCES public.custom_fields(id) ON DELETE CASCADE,
  value TEXT, -- valor armazenado como texto, convertido conforme field_type
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(lead_id, custom_field_id)
);

-- ============================================================
-- MODULO 9: CRM KANBAN (FUNIL DE VENDAS)
-- ============================================================

CREATE TABLE public.pipelines (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.pipeline_stages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pipeline_id UUID NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3b82f6',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.deals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES public.pipeline_stages(id),
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  value DECIMAL(12,2) DEFAULT 0,
  currency TEXT DEFAULT 'BRL',
  assigned_to UUID REFERENCES auth.users(id),
  status TEXT DEFAULT 'open', -- open, won, lost
  closed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MODULO 10: EMAIL MARKETING
-- ============================================================

CREATE TABLE public.email_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_content TEXT NOT NULL,
  text_content TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.email_campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template_id UUID REFERENCES public.email_templates(id),
  subject TEXT NOT NULL,
  html_content TEXT NOT NULL,
  segment_id UUID REFERENCES public.segments(id),
  target_tags TEXT[], -- alternativa a segmento: tags alvo
  status TEXT DEFAULT 'draft', -- draft, scheduled, sending, sent, cancelled
  total_sent INT DEFAULT 0,
  total_opened INT DEFAULT 0,
  total_clicked INT DEFAULT 0,
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.email_sends (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, sent, delivered, opened, clicked, bounced, failed
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MODULO 11: LANDING PAGES
-- ============================================================

CREATE TABLE public.landing_pages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL, -- subdominio: slug.persiacrm.com
  description TEXT,
  hero_image_url TEXT,
  cta_text TEXT DEFAULT 'Fale conosco',
  cta_type TEXT DEFAULT 'whatsapp', -- whatsapp, form, link
  cta_value TEXT, -- numero WhatsApp, URL, etc.
  template TEXT DEFAULT 'default', -- template base
  custom_css TEXT,
  meta_pixel_id TEXT,
  google_tag_id TEXT,
  is_published BOOLEAN DEFAULT false,
  visits INT DEFAULT 0,
  conversions INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, slug)
);

-- ============================================================
-- MODULO 12-13: CHAT LIVE E FILAS DE ATENDIMENTO
-- ============================================================

CREATE TABLE public.queues (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- Vendas, Suporte, Atendimento
  description TEXT,
  distribution_type TEXT DEFAULT 'round_robin', -- round_robin, manual
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.queue_members (
  queue_id UUID NOT NULL REFERENCES public.queues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (queue_id, user_id)
);

CREATE TABLE public.conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  channel TEXT DEFAULT 'whatsapp', -- whatsapp, instagram, messenger, email, web
  status TEXT DEFAULT 'active', -- active, waiting_human, assigned, closed
  assigned_to TEXT DEFAULT 'ai', -- 'ai' ou UUID do agente
  queue_id UUID REFERENCES public.queues(id),
  ai_summary TEXT, -- resumo gerado pela IA ao transferir
  unread_count INT DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  sender TEXT NOT NULL, -- 'lead', 'ai', 'agent'
  sender_user_id UUID REFERENCES auth.users(id), -- se sender = 'agent'
  content TEXT,
  type TEXT DEFAULT 'text', -- text, image, audio, video, document, template, interactive
  media_url TEXT,
  media_type TEXT, -- mime type
  whatsapp_msg_id TEXT, -- ID da mensagem no WhatsApp
  status TEXT DEFAULT 'sent', -- sent, delivered, read, failed
  metadata JSONB DEFAULT '{}', -- dados extras (botoes, lista, etc.)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.message_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT DEFAULT 'general', -- general, greeting, follow_up, closing
  shortcut TEXT, -- atalho (ex: /ola)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MODULO 14: ASSISTENTE VIRTUAL (IA)
-- ============================================================

CREATE TABLE public.ai_assistants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Assistente Principal',
  prompt TEXT NOT NULL,
  welcome_msg TEXT,
  off_hours_msg TEXT,
  schedule JSONB DEFAULT '{"start":"08:00","end":"18:00","days":[1,2,3,4,5]}',
  tone TEXT DEFAULT 'professional', -- professional, friendly, casual
  model TEXT DEFAULT 'gpt-4o-mini', -- modelo OpenAI (interno, cliente nao ve)
  is_active BOOLEAN DEFAULT true,
  total_tokens_used BIGINT DEFAULT 0,
  total_conversations INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.ai_knowledge_base (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  assistant_id UUID NOT NULL REFERENCES public.ai_assistants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL, -- conteudo textual do documento
  source_type TEXT DEFAULT 'text', -- text, file, url
  source_url TEXT,
  file_path TEXT, -- path no Supabase Storage
  -- embedding VECTOR(1536), -- habilitar depois: CREATE EXTENSION vector;
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MODULO 15: FLUXOS DE AUTOMACAO
-- ============================================================

CREATE TABLE public.flows (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  nodes JSONB NOT NULL DEFAULT '[]',
  -- nodes: [{id, type, position:{x,y}, data:{...config}}]
  -- types: lead_arrived, keyword, send_message, wait, ai_respond, transfer, add_tag, condition
  edges JSONB NOT NULL DEFAULT '[]',
  -- edges: [{id, source, target, sourceHandle}]
  trigger_type TEXT NOT NULL DEFAULT 'new_lead', -- new_lead, keyword, manual
  trigger_config JSONB DEFAULT '{}', -- ex: {"keywords":["ola","preco"]}
  is_active BOOLEAN DEFAULT false,
  single_entry BOOLEAN DEFAULT false, -- lead so entra uma vez
  total_leads_entered INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.flow_executions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  flow_id UUID NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  current_node_id TEXT, -- ID do no atual
  status TEXT DEFAULT 'running', -- running, waiting, completed, failed, cancelled
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  next_execution_at TIMESTAMPTZ, -- para nos de "esperar"
  metadata JSONB DEFAULT '{}', -- dados acumulados durante execucao
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MODULO 16: CAMPANHAS WHATSAPP (ENVIO EM MASSA)
-- ============================================================

CREATE TABLE public.campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  media_url TEXT,
  media_type TEXT,
  channel TEXT DEFAULT 'whatsapp', -- whatsapp, email (email usa email_campaigns)
  segment_id UUID REFERENCES public.segments(id),
  target_tags TEXT[],
  status TEXT DEFAULT 'draft', -- draft, scheduled, sending, paused, completed, cancelled
  total_target INT DEFAULT 0,
  total_sent INT DEFAULT 0,
  total_delivered INT DEFAULT 0,
  total_read INT DEFAULT 0,
  total_replied INT DEFAULT 0,
  send_interval_seconds INT DEFAULT 30, -- intervalo entre envios
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.campaign_sends (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, sent, delivered, read, replied, failed
  whatsapp_msg_id TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MODULO 17: INTEGRACOES
-- ============================================================

CREATE TABLE public.whatsapp_connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE UNIQUE,
  phone_number_id TEXT NOT NULL,
  waba_id TEXT NOT NULL, -- WhatsApp Business Account ID
  access_token TEXT NOT NULL, -- encrypted
  phone_number TEXT NOT NULL,
  display_name TEXT,
  status TEXT DEFAULT 'connected', -- connected, disconnected, error
  webhook_verify_token TEXT DEFAULT generate_short_id(32),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.integrations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- smtp, google_calendar, custom_webhook
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}', -- configuracao especifica por tipo (encrypted no app)
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.webhooks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  direction TEXT NOT NULL, -- inbound, outbound
  url TEXT, -- para outbound: URL de destino
  token TEXT DEFAULT generate_short_id(32), -- para inbound: token de validacao
  events TEXT[] DEFAULT '{}', -- eventos que acionam (lead.created, message.received, etc.)
  is_active BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDICES
-- ============================================================

-- Organizations
CREATE INDEX idx_org_slug ON public.organizations(slug);
CREATE INDEX idx_org_members_user ON public.organization_members(user_id);
CREATE INDEX idx_org_members_org ON public.organization_members(organization_id);

-- Leads
CREATE INDEX idx_leads_org ON public.leads(organization_id);
CREATE INDEX idx_leads_phone ON public.leads(phone);
CREATE INDEX idx_leads_email ON public.leads(email);
CREATE INDEX idx_leads_status ON public.leads(status);
CREATE INDEX idx_leads_source ON public.leads(source);
CREATE INDEX idx_leads_whatsapp ON public.leads(whatsapp_id);
CREATE INDEX idx_leads_created ON public.leads(created_at DESC);
CREATE INDEX idx_leads_last_interaction ON public.leads(last_interaction_at DESC);
CREATE INDEX idx_lead_activities_lead ON public.lead_activities(lead_id);
CREATE INDEX idx_lead_activities_org ON public.lead_activities(organization_id);

-- Tags
CREATE INDEX idx_tags_org ON public.tags(organization_id);
CREATE INDEX idx_lead_tags_lead ON public.lead_tags(lead_id);
CREATE INDEX idx_lead_tags_tag ON public.lead_tags(tag_id);

-- Segments
CREATE INDEX idx_segments_org ON public.segments(organization_id);

-- Custom Fields
CREATE INDEX idx_custom_fields_org ON public.custom_fields(organization_id);
CREATE INDEX idx_lead_cf_values_lead ON public.lead_custom_field_values(lead_id);

-- CRM Kanban
CREATE INDEX idx_pipelines_org ON public.pipelines(organization_id);
CREATE INDEX idx_stages_pipeline ON public.pipeline_stages(pipeline_id);
CREATE INDEX idx_deals_org ON public.deals(organization_id);
CREATE INDEX idx_deals_stage ON public.deals(stage_id);
CREATE INDEX idx_deals_lead ON public.deals(lead_id);
CREATE INDEX idx_deals_status ON public.deals(status);

-- Email
CREATE INDEX idx_email_templates_org ON public.email_templates(organization_id);
CREATE INDEX idx_email_campaigns_org ON public.email_campaigns(organization_id);
CREATE INDEX idx_email_campaigns_status ON public.email_campaigns(status);
CREATE INDEX idx_email_sends_campaign ON public.email_sends(campaign_id);

-- Landing Pages
CREATE INDEX idx_landing_pages_org ON public.landing_pages(organization_id);
CREATE INDEX idx_landing_pages_slug ON public.landing_pages(slug);

-- Chat
CREATE INDEX idx_conversations_org ON public.conversations(organization_id);
CREATE INDEX idx_conversations_lead ON public.conversations(lead_id);
CREATE INDEX idx_conversations_status ON public.conversations(status);
CREATE INDEX idx_conversations_assigned ON public.conversations(assigned_to);
CREATE INDEX idx_conversations_last_msg ON public.conversations(last_message_at DESC);
CREATE INDEX idx_messages_conversation ON public.messages(conversation_id);
CREATE INDEX idx_messages_org ON public.messages(organization_id);
CREATE INDEX idx_messages_created ON public.messages(created_at DESC);
CREATE INDEX idx_messages_whatsapp ON public.messages(whatsapp_msg_id);
CREATE INDEX idx_queues_org ON public.queues(organization_id);

-- IA
CREATE INDEX idx_ai_assistants_org ON public.ai_assistants(organization_id);
CREATE INDEX idx_ai_kb_assistant ON public.ai_knowledge_base(assistant_id);

-- Flows
CREATE INDEX idx_flows_org ON public.flows(organization_id);
CREATE INDEX idx_flows_active ON public.flows(is_active);
CREATE INDEX idx_flow_exec_flow ON public.flow_executions(flow_id);
CREATE INDEX idx_flow_exec_lead ON public.flow_executions(lead_id);
CREATE INDEX idx_flow_exec_status ON public.flow_executions(status);
CREATE INDEX idx_flow_exec_next ON public.flow_executions(next_execution_at);

-- Campaigns
CREATE INDEX idx_campaigns_org ON public.campaigns(organization_id);
CREATE INDEX idx_campaigns_status ON public.campaigns(status);
CREATE INDEX idx_campaign_sends_campaign ON public.campaign_sends(campaign_id);
CREATE INDEX idx_campaign_sends_status ON public.campaign_sends(status);

-- Integrations
CREATE INDEX idx_whatsapp_org ON public.whatsapp_connections(organization_id);
CREATE INDEX idx_integrations_org ON public.integrations(organization_id);
CREATE INDEX idx_webhooks_org ON public.webhooks(organization_id);

-- ============================================================
-- TRIGGERS: updated_at automatico
-- ============================================================

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.onboarding_progress FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.segments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.lead_custom_field_values FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pipelines FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.email_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.email_campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.landing_pages FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.queues FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.message_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.ai_assistants FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.flows FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.flow_executions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.whatsapp_connections FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.webhooks FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Habilitar RLS em TODAS as tabelas
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_custom_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_assistants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;

-- Funcao auxiliar: obter organization_ids do usuario
CREATE OR REPLACE FUNCTION get_user_org_ids()
RETURNS SETOF UUID AS $$
  SELECT organization_id FROM public.organization_members
  WHERE user_id = auth.uid() AND is_active = true;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- POLICIES: Usuario so acessa dados da sua organizacao
-- ============================================================

-- Profiles: usuario ve e edita o proprio
CREATE POLICY "Users manage own profile" ON public.profiles
  FOR ALL USING (id = auth.uid());

-- Organizations: membro ve sua org
CREATE POLICY "Members see own org" ON public.organizations
  FOR SELECT USING (id IN (SELECT get_user_org_ids()));
CREATE POLICY "Owner updates org" ON public.organizations
  FOR UPDATE USING (id IN (
    SELECT organization_id FROM public.organization_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- Organization Members: membro ve membros da sua org
CREATE POLICY "Members see org members" ON public.organization_members
  FOR SELECT USING (organization_id IN (SELECT get_user_org_ids()));
CREATE POLICY "Admin manages members" ON public.organization_members
  FOR ALL USING (organization_id IN (
    SELECT organization_id FROM public.organization_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- Macro policy para tabelas com organization_id
-- (Aplicar para: leads, lead_activities, tags, segments, custom_fields, pipelines, deals,
--  email_templates, email_campaigns, landing_pages, queues, conversations, messages,
--  message_templates, ai_assistants, ai_knowledge_base, flows, flow_executions,
--  campaigns, campaign_sends, whatsapp_connections, integrations, webhooks,
--  onboarding_progress, invitations)

-- LEADS
CREATE POLICY "Org members access leads" ON public.leads
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- LEAD ACTIVITIES
CREATE POLICY "Org members access lead_activities" ON public.lead_activities
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- TAGS
CREATE POLICY "Org members access tags" ON public.tags
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- LEAD TAGS
CREATE POLICY "Org members access lead_tags" ON public.lead_tags
  FOR ALL USING (lead_id IN (SELECT id FROM public.leads WHERE organization_id IN (SELECT get_user_org_ids())));

-- SEGMENTS
CREATE POLICY "Org members access segments" ON public.segments
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- CUSTOM FIELDS
CREATE POLICY "Org members access custom_fields" ON public.custom_fields
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- LEAD CUSTOM FIELD VALUES
CREATE POLICY "Org members access cf values" ON public.lead_custom_field_values
  FOR ALL USING (lead_id IN (SELECT id FROM public.leads WHERE organization_id IN (SELECT get_user_org_ids())));

-- PIPELINES
CREATE POLICY "Org members access pipelines" ON public.pipelines
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- PIPELINE STAGES
CREATE POLICY "Org members access stages" ON public.pipeline_stages
  FOR ALL USING (pipeline_id IN (SELECT id FROM public.pipelines WHERE organization_id IN (SELECT get_user_org_ids())));

-- DEALS
CREATE POLICY "Org members access deals" ON public.deals
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- EMAIL TEMPLATES
CREATE POLICY "Org members access email_templates" ON public.email_templates
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- EMAIL CAMPAIGNS
CREATE POLICY "Org members access email_campaigns" ON public.email_campaigns
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- EMAIL SENDS
CREATE POLICY "Org members access email_sends" ON public.email_sends
  FOR ALL USING (campaign_id IN (SELECT id FROM public.email_campaigns WHERE organization_id IN (SELECT get_user_org_ids())));

-- LANDING PAGES
CREATE POLICY "Org members access landing_pages" ON public.landing_pages
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- QUEUES
CREATE POLICY "Org members access queues" ON public.queues
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- QUEUE MEMBERS
CREATE POLICY "Org members access queue_members" ON public.queue_members
  FOR ALL USING (queue_id IN (SELECT id FROM public.queues WHERE organization_id IN (SELECT get_user_org_ids())));

-- CONVERSATIONS
CREATE POLICY "Org members access conversations" ON public.conversations
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- MESSAGES
CREATE POLICY "Org members access messages" ON public.messages
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- MESSAGE TEMPLATES
CREATE POLICY "Org members access message_templates" ON public.message_templates
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- AI ASSISTANTS
CREATE POLICY "Org members access ai_assistants" ON public.ai_assistants
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- AI KNOWLEDGE BASE
CREATE POLICY "Org members access ai_kb" ON public.ai_knowledge_base
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- FLOWS
CREATE POLICY "Org members access flows" ON public.flows
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- FLOW EXECUTIONS
CREATE POLICY "Org members access flow_executions" ON public.flow_executions
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- CAMPAIGNS
CREATE POLICY "Org members access campaigns" ON public.campaigns
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- CAMPAIGN SENDS
CREATE POLICY "Org members access campaign_sends" ON public.campaign_sends
  FOR ALL USING (campaign_id IN (SELECT id FROM public.campaigns WHERE organization_id IN (SELECT get_user_org_ids())));

-- WHATSAPP CONNECTIONS
CREATE POLICY "Org members access whatsapp" ON public.whatsapp_connections
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- INTEGRATIONS
CREATE POLICY "Org members access integrations" ON public.integrations
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- WEBHOOKS
CREATE POLICY "Org members access webhooks" ON public.webhooks
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- INVITATIONS
CREATE POLICY "Org members access invitations" ON public.invitations
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- ONBOARDING PROGRESS
CREATE POLICY "Org members access onboarding" ON public.onboarding_progress
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- ============================================================
-- REALTIME: Habilitar para tabelas que precisam de updates ao vivo
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.leads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.deals;

-- ============================================================
-- TRIGGER: Criar profile automaticamente ao registrar usuario
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- TRIGGER: Atualizar last_interaction_at do lead ao receber mensagem
-- ============================================================

CREATE OR REPLACE FUNCTION update_lead_last_interaction()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.leads
  SET last_interaction_at = NOW()
  WHERE id = NEW.lead_id;

  UPDATE public.conversations
  SET last_message_at = NOW(),
      unread_count = CASE WHEN NEW.sender = 'lead' THEN unread_count + 1 ELSE unread_count END
  WHERE id = NEW.conversation_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_message_created
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION update_lead_last_interaction();

-- ============================================================
-- FIM DO SCHEMA
-- Total: 31 tabelas, ~70 indices, RLS em todas as tabelas
-- ============================================================
