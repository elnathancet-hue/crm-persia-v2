-- Migration 090: colunas de progresso denormalizadas em crm_campaigns + trigger
-- Elimina a necessidade de query extra na listagem de campanhas.

-- 1. Colunas de contagem
ALTER TABLE crm_campaigns
  ADD COLUMN IF NOT EXISTS total_count  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_count   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_count INTEGER NOT NULL DEFAULT 0;

-- 2. Índice composto para o trigger (COUNT filtrado por campaign_id + status)
CREATE INDEX IF NOT EXISTS idx_campaign_jobs_campaign_status
  ON crm_campaign_message_jobs (campaign_id, status);

-- 3. Função do trigger
CREATE OR REPLACE FUNCTION sync_campaign_job_counts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_campaign_id uuid;
BEGIN
  v_campaign_id := COALESCE(NEW.campaign_id, OLD.campaign_id);

  UPDATE crm_campaigns SET
    total_count  = counts.total,
    sent_count   = counts.sent,
    failed_count = counts.failed
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE status != 'cancelled') AS total,
      COUNT(*) FILTER (WHERE status = 'sent')       AS sent,
      COUNT(*) FILTER (WHERE status = 'failed')     AS failed
    FROM crm_campaign_message_jobs
    WHERE campaign_id = v_campaign_id
  ) AS counts
  WHERE id = v_campaign_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 4. Trigger
DROP TRIGGER IF EXISTS trg_sync_campaign_counts ON crm_campaign_message_jobs;
CREATE TRIGGER trg_sync_campaign_counts
  AFTER INSERT OR UPDATE OF status OR DELETE
  ON crm_campaign_message_jobs
  FOR EACH ROW EXECUTE FUNCTION sync_campaign_job_counts();

-- 5. Backfill de campanhas existentes
UPDATE crm_campaigns c SET
  total_count  = counts.total,
  sent_count   = counts.sent,
  failed_count = counts.failed
FROM (
  SELECT
    campaign_id,
    COUNT(*) FILTER (WHERE status != 'cancelled') AS total,
    COUNT(*) FILTER (WHERE status = 'sent')       AS sent,
    COUNT(*) FILTER (WHERE status = 'failed')     AS failed
  FROM crm_campaign_message_jobs
  GROUP BY campaign_id
) AS counts
WHERE c.id = counts.campaign_id;
