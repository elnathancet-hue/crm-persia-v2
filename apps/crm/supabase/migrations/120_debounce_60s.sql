-- Expand debounce_window_ms CHECK constraint from 40 s to 60 s.
--
-- User request (jun/2026): slider na UI deve ir até 60 s pra dar mais
-- flexibilidade em funis de vendas com leads lentos ao digitar.
-- O CHECK anterior era: debounce_window_ms >= 0 AND debounce_window_ms <= 40000
-- Novo range: 0..60000

ALTER TABLE agent_configs
  DROP CONSTRAINT IF EXISTS agent_configs_debounce_window_ms_check;

ALTER TABLE agent_configs
  ADD CONSTRAINT agent_configs_debounce_window_ms_check
  CHECK (debounce_window_ms >= 0 AND debounce_window_ms <= 60000);
