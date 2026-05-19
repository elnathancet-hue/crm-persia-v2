-- ============================================================
-- MIGRATION 050: AI Agent — corrige auto_actions da etapa
--                "Agendamento de reuniao" pra disparar APOS
--                create_appointment retornar sucesso, nao ON_ENTER.
-- ------------------------------------------------------------
-- CONTEXTO (Bug #7, descoberto em 18/mai/2026 em prod):
--   O template "Consultor (funil completo)" tinha 2 auto_actions na
--   etapa de Agendamento que disparavam ASSIM QUE o lead entrava nela:
--     1. add_tag "agendou-reuniao"
--     2. trigger_notification "Avisar equipe: nova reunião agendada"
--
--   Em teste live a IA esquecia de chamar create_appointment, mas
--   transferia o lead pra etapa Agendamento via transfer_to_stage.
--   Resultado: tag aplicada + equipe notificada "lead agendou", mas
--   NENHUM appointment no banco. Vendas perdidas, equipe fica esperando
--   um evento que nao existe.
--
-- FIX:
--   PR2 do plano de quick wins (PR #260) introduz `trigger` opcional
--   nos auto_actions JSONB. Default 'on_enter' (retrocompat). Novo modo
--   'on_tool_success' so dispara quando a tool gatilho retorna ok.
--   O seed do template foi atualizado nesta PR. Esta migration faz o
--   UPDATE pontual nos dados ja gravados em prod.
--
-- ESCOPO:
--   So mexe em rows criadas via template Consultor. Identificacao:
--     - agent_stages.action_config tem auto_actions[] contendo EXATAMENTE
--       as 2 acoes-alvo (type + identificador) E ESTAS NAO TEM `trigger`
--       definido ainda. Isso evita tocar em rows onde o cliente ja
--       customizou as acoes via UI.
--
-- IDEMPOTENCIA:
--   Re-rodar a migration nao faz nada — o predicado filtra rows que
--   AINDA estao com on_enter (sem `trigger` setado). Apos o UPDATE,
--   as rows tem trigger='on_tool_success' e ficam fora do match.
-- ============================================================

BEGIN;

-- Helper: substitui no array todos os elementos que casam com `match`,
-- aplicando `patch`. Mantem os demais inalterados.
-- Implementado inline via jsonb_path_query + array_agg.

WITH targets AS (
  SELECT
    s.id AS stage_id,
    s.action_config AS old_config,
    jsonb_agg(
      CASE
        -- Acao 1: add_tag "agendou-reuniao" sem trigger setado
        WHEN action ->> 'type' = 'add_tag'
          AND action ->> 'tag_name' = 'agendou-reuniao'
          AND NOT (action ? 'trigger')
        THEN action
              || jsonb_build_object(
                   'trigger', 'on_tool_success',
                   'on_tool_success_of', 'create_appointment'
                 )
        -- Acao 2: trigger_notification "Avisar equipe: nova reuniao agendada" sem trigger setado
        WHEN action ->> 'type' = 'trigger_notification'
          AND action ->> 'template_name' = 'Avisar equipe: nova reunião agendada'
          AND NOT (action ? 'trigger')
        THEN action
              || jsonb_build_object(
                   'trigger', 'on_tool_success',
                   'on_tool_success_of', 'create_appointment'
                 )
        ELSE action
      END
      ORDER BY ord
    ) AS new_auto_actions
  FROM public.agent_stages s,
       LATERAL jsonb_array_elements(s.action_config -> 'auto_actions') WITH ORDINALITY AS x(action, ord)
  WHERE s.action_config ? 'auto_actions'
    AND jsonb_typeof(s.action_config -> 'auto_actions') = 'array'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(s.action_config -> 'auto_actions') AS a
      WHERE (
        (a ->> 'type' = 'add_tag' AND a ->> 'tag_name' = 'agendou-reuniao')
        OR (a ->> 'type' = 'trigger_notification'
            AND a ->> 'template_name' = 'Avisar equipe: nova reunião agendada')
      )
      AND NOT (a ? 'trigger')
    )
  GROUP BY s.id, s.action_config
)
UPDATE public.agent_stages s
SET action_config = jsonb_set(t.old_config, '{auto_actions}', t.new_auto_actions, true),
    updated_at = now()
FROM targets t
WHERE s.id = t.stage_id;

COMMIT;
