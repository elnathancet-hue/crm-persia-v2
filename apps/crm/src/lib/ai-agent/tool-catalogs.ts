import "server-only";

import type { AgentDb } from "./db";

// PR-AI-AGENT-TOOLS-NAMES (mai/2026): catalogos injetados no system
// prompt pra que o LLM saiba quais OPCOES existem antes de chamar uma
// tool. Sem isso a IA inventa nomes (add_tag) ou precisa de UUID na
// configuracao (move_pipeline_stage/transfer_*).
//
// Cada loader retorna `null` quando nao ha nada (silencia o bloco no
// prompt) e e chamado SO se a tool correspondente esta habilitada na
// stage atual (evita query desnecessaria).
//
// Limite por catalogo: 50 itens. Acima disso vira ruido + bloat de
// tokens. Org com mais que isso vai ter que filtrar via convencao
// (ex: tags arquivadas ja sao filtradas).

const CATALOG_LIMIT = 50;

// ============================================================================
// Tags da organizacao — para `add_tag`
// ============================================================================

export async function loadTagCatalog(
  db: AgentDb,
  orgId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("tags")
    .select("name, description, color")
    .eq("organization_id", orgId)
    .order("name", { ascending: true })
    .limit(CATALOG_LIMIT);
  if (error || !data || data.length === 0) return null;

  const rows = data as ReadonlyArray<{
    name?: string | null;
    description?: string | null;
  }>;
  const lines = rows
    .filter((r) => r.name)
    .map((r) =>
      r.description?.trim()
        ? `- "${r.name}" — ${r.description.trim()}`
        : `- "${r.name}"`,
    );
  if (lines.length === 0) return null;

  return [
    "Tags disponíveis nesta organização (use add_tag com o nome EXATO):",
    ...lines,
    "Não invente tags novas — se nenhuma encaixa, deixe sem tag.",
  ].join("\n");
}

// ============================================================================
// Membros da equipe — para `transfer_to_user`
// ============================================================================

export async function loadMemberCatalog(
  db: AgentDb,
  orgId: string,
): Promise<string | null> {
  // Pega user_ids ativos da org, depois resolve profiles em separado
  // (membership + profiles sao tabelas diferentes — joins via embed
  // sofrem com RLS em alguns ambientes).
  const { data: members, error: memberError } = await db
    .from("organization_members")
    .select("user_id, role")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .limit(CATALOG_LIMIT);
  if (memberError || !members || members.length === 0) return null;

  const memberRows = members as ReadonlyArray<{
    user_id?: string | null;
    role?: string | null;
  }>;
  const userIds = memberRows
    .map((m) => m.user_id)
    .filter((id): id is string => Boolean(id));
  if (userIds.length === 0) return null;

  const { data: profiles, error: profilesError } = await db
    .from("profiles")
    .select("id, full_name, email")
    .in("id", userIds);
  if (profilesError || !profiles) return null;

  type ProfileRow = { id: string; full_name?: string | null; email?: string | null };
  const profileMap = new Map<string, ProfileRow>();
  for (const p of profiles as ReadonlyArray<ProfileRow>) {
    profileMap.set(p.id, p);
  }

  const lines: string[] = [];
  for (const m of memberRows) {
    if (!m.user_id) continue;
    const p = profileMap.get(m.user_id);
    if (!p) continue;
    const name = p.full_name?.trim() || p.email?.trim() || `user-${m.user_id.slice(0, 8)}`;
    const role = m.role ? ` (${m.role})` : "";
    lines.push(`- "${name}"${p.email ? ` — ${p.email}` : ""}${role}`);
  }
  if (lines.length === 0) return null;

  return [
    "Membros da equipe disponíveis para transferência (use transfer_to_user com o nome OU email):",
    ...lines,
  ].join("\n");
}

// ============================================================================
// Agentes IA — para `transfer_to_agent` (exclui o config atual)
// ============================================================================

export async function loadAgentCatalog(
  db: AgentDb,
  orgId: string,
  currentConfigId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("agent_configs")
    .select("name, description")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .neq("id", currentConfigId)
    .order("name", { ascending: true })
    .limit(CATALOG_LIMIT);
  if (error || !data || data.length === 0) return null;

  const rows = data as ReadonlyArray<{
    name?: string | null;
    description?: string | null;
  }>;
  const lines = rows
    .filter((r) => r.name)
    .map((r) =>
      r.description?.trim()
        ? `- "${r.name}" — ${r.description.trim()}`
        : `- "${r.name}"`,
    );
  if (lines.length === 0) return null;

  return [
    "Outros agentes IA disponíveis para transferência (use transfer_to_agent com o nome EXATO):",
    ...lines,
  ].join("\n");
}

// ============================================================================
// Etapas do Kanban — para `move_pipeline_stage` (do funil do lead atual)
// ============================================================================

export async function loadKanbanStageCatalog(
  db: AgentDb,
  orgId: string,
  leadId: string,
): Promise<string | null> {
  // Descobre o pipeline do lead
  const { data: lead } = await db
    .from("leads")
    .select("pipeline_id, stage_id")
    .eq("organization_id", orgId)
    .eq("id", leadId)
    .maybeSingle();
  const leadRow = lead as { pipeline_id?: string | null; stage_id?: string | null } | null;
  if (!leadRow?.pipeline_id) return null;

  // Lista etapas do funil
  const { data: stages, error } = await db
    .from("pipeline_stages")
    .select("name, sort_order, outcome")
    .eq("organization_id", orgId)
    .eq("pipeline_id", leadRow.pipeline_id)
    .order("sort_order", { ascending: true })
    .limit(CATALOG_LIMIT);
  if (error || !stages || stages.length === 0) return null;

  // Nome da stage atual pra anotar no catalogo
  let currentStageName: string | null = null;
  if (leadRow.stage_id) {
    const { data: current } = await db
      .from("pipeline_stages")
      .select("name")
      .eq("id", leadRow.stage_id)
      .maybeSingle();
    currentStageName = (current as { name?: string | null } | null)?.name ?? null;
  }

  const rows = stages as ReadonlyArray<{
    name?: string | null;
    outcome?: string | null;
  }>;
  const lines = rows
    .filter((s) => s.name)
    .map((s) => {
      const tag =
        s.outcome === "bem_sucedido"
          ? " (sucesso)"
          : s.outcome === "falha"
          ? " (perdido)"
          : "";
      const here = currentStageName === s.name ? " ← lead está aqui" : "";
      return `- "${s.name}"${tag}${here}`;
    });
  if (lines.length === 0) return null;

  return [
    "Etapas do funil de vendas (use move_pipeline_stage com o nome EXATO):",
    ...lines,
  ].join("\n");
}

// ============================================================================
// Etapas do agente atual — para `transfer_to_stage`
// ============================================================================

export async function loadAgentStageCatalog(
  db: AgentDb,
  orgId: string,
  configId: string,
  currentStageId: string | null,
): Promise<string | null> {
  const { data, error } = await db
    .from("agent_stages")
    .select("id, situation, order_index")
    .eq("organization_id", orgId)
    .eq("config_id", configId)
    .order("order_index", { ascending: true })
    .limit(CATALOG_LIMIT);
  if (error || !data || data.length === 0) return null;

  const rows = data as ReadonlyArray<{
    id?: string | null;
    situation?: string | null;
    order_index?: number | null;
  }>;
  const lines = rows
    .filter((s) => s.situation)
    .map((s, idx) => {
      const here = s.id === currentStageId ? " ← você está aqui" : "";
      const order = typeof s.order_index === "number" ? s.order_index + 1 : idx + 1;
      return `- ${order}. "${s.situation}"${here}`;
    });
  if (lines.length === 0) return null;

  return [
    "Etapas deste agente (use transfer_to_stage com o nome EXATO da etapa):",
    ...lines,
  ].join("\n");
}

// ============================================================================
// Tipos de agendamento — para `create_appointment`
// ============================================================================

export async function loadAppointmentTypeCatalog(
  db: AgentDb,
  orgId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("agenda_services")
    .select(
      "slug, name, description, duration_minutes, default_channel, default_location, default_meeting_url",
    )
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .not("slug", "is", null)
    .order("name", { ascending: true })
    .limit(CATALOG_LIMIT);
  if (error || !data || data.length === 0) return null;

  const rows = data as ReadonlyArray<{
    slug?: string | null;
    name?: string | null;
    description?: string | null;
    duration_minutes?: number | null;
    default_channel?: string | null;
  }>;
  const lines: string[] = [];
  for (const r of rows) {
    if (!r.slug || !r.name) continue;
    const parts: string[] = [`- slug: "${r.slug}" — ${r.name}`];
    if (typeof r.duration_minutes === "number") {
      parts.push(`(${r.duration_minutes}min)`);
    }
    if (r.default_channel) {
      const labels: Record<string, string> = {
        whatsapp: "WhatsApp",
        phone: "telefone",
        online: "online",
        in_person: "presencial",
      };
      parts.push(`[${labels[r.default_channel] ?? r.default_channel}]`);
    }
    const line = parts.join(" ");
    const desc = r.description?.trim();
    lines.push(desc ? `${line} — ${desc}` : line);
  }
  if (lines.length === 0) return null;

  return [
    "Tipos de agendamento disponíveis (use create_appointment com o slug EXATO — duracao, canal e local saem do tipo):",
    ...lines,
    "Se nenhum tipo encaixar, transfira pra humano (stop_agent) em vez de inventar.",
  ].join("\n");
}

// ============================================================================
// Templates de notificacao — para `trigger_notification`
// ============================================================================

export async function loadNotificationTemplateCatalog(
  db: AgentDb,
  orgId: string,
  configId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("agent_notification_templates")
    .select("name, description, target_address, target_type")
    .eq("organization_id", orgId)
    .eq("config_id", configId)
    .eq("status", "active")
    .order("name", { ascending: true })
    .limit(CATALOG_LIMIT);
  if (error || !data || data.length === 0) return null;

  const rows = data as ReadonlyArray<{
    name?: string | null;
    description?: string | null;
    target_type?: string | null;
  }>;
  const lines = rows
    .filter((t) => t.name)
    .map((t) => {
      const target = t.target_type ? ` (envia para ${t.target_type})` : "";
      const desc = t.description?.trim();
      return desc
        ? `- "${t.name}"${target} — ${desc}`
        : `- "${t.name}"${target}`;
    });
  if (lines.length === 0) return null;

  return [
    "Notificações configuradas para a equipe (use trigger_notification com o nome EXATO):",
    ...lines,
  ].join("\n");
}
