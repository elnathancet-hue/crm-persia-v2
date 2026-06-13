-- Migration 123: trigger DB que enfileira agenda_reminder_sends ao criar um appointment.
-- O modelo ficou incompleto na migration 031: a tabela existe mas nada inseriu nela.
-- Agora: AFTER INSERT ON appointments → enqueue 1 send por config ativa da org.
-- Cancel: handled no tick (checks status = 'cancelled' → skips). Sends obsoletos
-- ficam como skipped no processamento normal.

CREATE OR REPLACE FUNCTION public.enqueue_appointment_reminders()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg RECORD;
  scheduled_ts TIMESTAMPTZ;
BEGIN
  -- Nao enfileira se ja nasceu cancelado / soft-deleted
  IF NEW.deleted_at IS NOT NULL
     OR NEW.status IN ('cancelled', 'completed', 'no_show') THEN
    RETURN NEW;
  END IF;

  FOR cfg IN
    SELECT id, trigger_when, trigger_offset_minutes
    FROM public.agenda_reminder_configs
    WHERE organization_id = NEW.organization_id
      AND is_active = true
  LOOP
    IF cfg.trigger_when = 'on_create' THEN
      -- Dispara 1 minuto depois da criacao (evita corrida com o cron do mesmo tick)
      scheduled_ts := NOW() + INTERVAL '1 minute';

    ELSIF cfg.trigger_when = 'before_start' THEN
      scheduled_ts := NEW.start_at - (cfg.trigger_offset_minutes * INTERVAL '1 minute');
      -- Pula se o horario calculado ja passou
      IF scheduled_ts <= NOW() THEN
        CONTINUE;
      END IF;

    ELSE
      CONTINUE;
    END IF;

    INSERT INTO public.agenda_reminder_sends (
      appointment_id,
      reminder_config_id,
      organization_id,
      scheduled_for,
      status
    ) VALUES (
      NEW.id,
      cfg.id,
      NEW.organization_id,
      scheduled_ts,
      'pending'
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Remove trigger antigo se existir (idempotente)
DROP TRIGGER IF EXISTS trg_enqueue_appointment_reminders ON public.appointments;

CREATE TRIGGER trg_enqueue_appointment_reminders
  AFTER INSERT ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_appointment_reminders();
