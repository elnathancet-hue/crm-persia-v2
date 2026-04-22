-- ============================================================
-- MIGRATION 015: rate_limits for sensitive admin actions
-- ------------------------------------------------------------
-- Motivation:
--   Add a small, DB-backed fixed-window limiter for high-risk admin
--   actions without affecting chat/runtime traffic.
--
-- Scope:
--   - Service-role only writes/reads via consume_rate_limit().
--   - RLS enabled, no direct table policies.
--   - One row per user/action[/org] holds the current window.
--
-- Safe on live DB: additive table/function only.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.rate_limits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 1 CHECK (count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limits_user_action_global
  ON public.rate_limits(user_id, action)
  WHERE organization_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limits_user_org_action
  ON public.rate_limits(user_id, organization_id, action)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rate_limits_expires_at
  ON public.rate_limits(expires_at);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- No SELECT/INSERT/UPDATE/DELETE policies: authenticated/anon cannot touch it.
REVOKE ALL ON public.rate_limits FROM PUBLIC;
REVOKE ALL ON public.rate_limits FROM anon;
REVOKE ALL ON public.rate_limits FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_user_id UUID,
  p_action TEXT,
  p_window_seconds INTEGER,
  p_max_hits INTEGER,
  p_organization_id UUID DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  allowed BOOLEAN,
  remaining INTEGER,
  reset_at TIMESTAMPTZ,
  retry_after_seconds INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_row public.rate_limits%ROWTYPE;
  window_seconds INTEGER;
  max_hits INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  IF p_action IS NULL OR length(trim(p_action)) = 0 THEN
    RAISE EXCEPTION 'p_action is required';
  END IF;

  window_seconds := greatest(coalesce(p_window_seconds, 60), 1);
  max_hits := greatest(coalesce(p_max_hits, 1), 1);

  -- Opportunistic cleanup keeps the table small without a cron.
  DELETE FROM public.rate_limits
  WHERE expires_at < (p_now - interval '1 day');

  IF p_organization_id IS NULL THEN
    INSERT INTO public.rate_limits (
      user_id,
      organization_id,
      action,
      window_started_at,
      expires_at,
      count,
      created_at,
      updated_at
    )
    VALUES (
      p_user_id,
      NULL,
      p_action,
      p_now,
      p_now + make_interval(secs => window_seconds),
      0,
      p_now,
      p_now
    )
    ON CONFLICT (user_id, action) WHERE organization_id IS NULL
    DO NOTHING;

    SELECT *
    INTO current_row
    FROM public.rate_limits
    WHERE user_id = p_user_id
      AND action = p_action
      AND organization_id IS NULL
    FOR UPDATE;
  ELSE
    INSERT INTO public.rate_limits (
      user_id,
      organization_id,
      action,
      window_started_at,
      expires_at,
      count,
      created_at,
      updated_at
    )
    VALUES (
      p_user_id,
      p_organization_id,
      p_action,
      p_now,
      p_now + make_interval(secs => window_seconds),
      0,
      p_now,
      p_now
    )
    ON CONFLICT (user_id, organization_id, action) WHERE organization_id IS NOT NULL
    DO NOTHING;

    SELECT *
    INTO current_row
    FROM public.rate_limits
    WHERE user_id = p_user_id
      AND organization_id = p_organization_id
      AND action = p_action
    FOR UPDATE;
  END IF;

  IF current_row.id IS NULL THEN
    RAISE EXCEPTION 'failed to initialize rate limit row';
  END IF;

  IF current_row.expires_at <= p_now THEN
    UPDATE public.rate_limits
    SET
      window_started_at = p_now,
      expires_at = p_now + make_interval(secs => window_seconds),
      count = 1,
      updated_at = p_now
    WHERE id = current_row.id
    RETURNING * INTO current_row;

    RETURN QUERY SELECT
      TRUE,
      greatest(max_hits - current_row.count, 0),
      current_row.expires_at,
      0;
    RETURN;
  END IF;

  IF current_row.count >= max_hits THEN
    RETURN QUERY SELECT
      FALSE,
      0,
      current_row.expires_at,
      greatest(ceil(extract(epoch from (current_row.expires_at - p_now)))::integer, 0);
    RETURN;
  END IF;

  UPDATE public.rate_limits
  SET
    count = count + 1,
    updated_at = p_now
  WHERE id = current_row.id
  RETURNING * INTO current_row;

  RETURN QUERY SELECT
    TRUE,
    greatest(max_hits - current_row.count, 0),
    current_row.expires_at,
    0;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(UUID, TEXT, INTEGER, INTEGER, UUID, TIMESTAMPTZ)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_rate_limit(UUID, TEXT, INTEGER, INTEGER, UUID, TIMESTAMPTZ)
  FROM anon;
REVOKE ALL ON FUNCTION public.consume_rate_limit(UUID, TEXT, INTEGER, INTEGER, UUID, TIMESTAMPTZ)
  FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(UUID, TEXT, INTEGER, INTEGER, UUID, TIMESTAMPTZ)
  TO service_role;

COMMIT;

-- ============================================================
-- Rollback (manual):
-- ============================================================
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.consume_rate_limit(UUID, TEXT, INTEGER, INTEGER, UUID, TIMESTAMPTZ);
--   DROP TABLE IF EXISTS public.rate_limits;
-- COMMIT;
