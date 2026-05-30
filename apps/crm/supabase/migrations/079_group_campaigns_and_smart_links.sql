-- 079: group_campaigns + smart link distribution for WhatsApp groups
-- Adds campaign model so multiple groups can share a single public link.
-- Distribution modes: sequential (fill in order) or balanced (spread evenly).
-- group_memberships tracks who entered via smart link with UTM and lead linkage.

-- ─── Group campaigns ──────────────────────────────────────────────────────────

CREATE TABLE public.group_campaigns (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  slug            TEXT        NOT NULL,
  description     TEXT,
  distribution_mode TEXT      NOT NULL DEFAULT 'balanced'
                                CHECK (distribution_mode IN ('sequential', 'balanced')),
  fallback_url    TEXT,
  fallback_message TEXT       DEFAULT 'Todos os grupos estão lotados no momento. Seu contato foi registrado e entraremos em breve.',
  is_active       BOOL        NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_group_campaigns_org_slug
  ON public.group_campaigns(organization_id, slug);

CREATE INDEX idx_group_campaigns_org
  ON public.group_campaigns(organization_id);

ALTER TABLE public.group_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_campaigns_org_members"
  ON public.group_campaigns FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- ─── Extend whatsapp_groups ───────────────────────────────────────────────────

ALTER TABLE public.whatsapp_groups
  ADD COLUMN IF NOT EXISTS campaign_id      UUID  REFERENCES public.group_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS max_participants INT   NOT NULL DEFAULT 256,
  ADD COLUMN IF NOT EXISTS is_accepting     BOOL  NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_campaign
  ON public.whatsapp_groups(campaign_id) WHERE campaign_id IS NOT NULL;

-- ─── Group memberships ───────────────────────────────────────────────────────

CREATE TABLE public.group_memberships (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  group_id        UUID        NOT NULL REFERENCES public.whatsapp_groups(id) ON DELETE CASCADE,
  campaign_id     UUID        REFERENCES public.group_campaigns(id) ON DELETE SET NULL,
  lead_id         UUID        REFERENCES public.leads(id) ON DELETE SET NULL,
  phone           TEXT,
  name            TEXT,
  joined_at       TIMESTAMPTZ DEFAULT NOW(),
  source          TEXT        NOT NULL DEFAULT 'smart_link'
                                CHECK (source IN ('smart_link', 'manual', 'webhook')),
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,
  utm_content     TEXT,
  utm_term        TEXT,
  ip_hash         TEXT
);

CREATE UNIQUE INDEX idx_group_memberships_phone_group
  ON public.group_memberships(organization_id, group_id, phone)
  WHERE phone IS NOT NULL;

CREATE INDEX idx_group_memberships_org_group
  ON public.group_memberships(organization_id, group_id);

CREATE INDEX idx_group_memberships_campaign
  ON public.group_memberships(campaign_id) WHERE campaign_id IS NOT NULL;

CREATE INDEX idx_group_memberships_lead
  ON public.group_memberships(lead_id) WHERE lead_id IS NOT NULL;

ALTER TABLE public.group_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_memberships_select"
  ON public.group_memberships FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

CREATE POLICY "group_memberships_insert"
  ON public.group_memberships FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );
