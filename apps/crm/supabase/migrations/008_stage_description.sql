-- Migration 008: Add description column to pipeline_stages
-- Used by AI automation to understand when to move leads between stages.
-- Idempotent — safe to run multiple times.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pipeline_stages'
      AND column_name = 'description'
  ) THEN
    ALTER TABLE public.pipeline_stages ADD COLUMN description TEXT;
  END IF;
END $$;
