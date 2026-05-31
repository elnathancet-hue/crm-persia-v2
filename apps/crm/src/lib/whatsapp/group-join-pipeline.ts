/**
 * group-join-pipeline.ts
 *
 * Motor de detecção e vinculação de leads quando um participante entra
 * em um grupo WhatsApp monitorado pelo CRM.
 *
 * Chamado por dois caminhos:
 *   1. Smart link (recordGroupJoin em groups.ts) — temos nome + UTM
 *   2. UAZAPI webhook `groups` event — temos JID + ação
 *
 * Algoritmo de matching (em ordem de confiança):
 *   1. Phone E.164 exato
 *   2. Phone variante com 9° dígito (com/sem) — problema clássico BR
 *   3. Phone somente DDD+número (sem DDI) — raro mas ocorre
 *   4. Nome similar (tokenização + score) — só quando temos nome
 *
 * Quando encontra lead: vincula group_memberships.lead_id + cria
 * lead_activity com type="group_join".
 *
 * Idempotente: upsert no membership + check de atividade existente.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Phone normalization ──────────────────────────────────────────────────────

/**
 * Extrai dígitos de uma string (ignora @domínio WhatsApp JID).
 *
 * "558699421406@s.whatsapp.net" → "558699421406"
 * "+55 86 9 9421-406"           → "558699421406"
 */
export function extractPhoneDigits(raw: string): string {
  const noDomain = raw.replace(/@[a-zA-Z0-9._-]+$/, "");
  return noDomain.replace(/\D/g, "");
}

/**
 * Normaliza qualquer string de telefone para E.164 BR.
 *
 * Regra:
 *   - Se tem 12-13 dígitos começando com 55 → +{digits}
 *   - Se tem 10-11 dígitos → +55{digits}
 *   - Outros → null (não é phone BR válido)
 */
export function normalizePhoneBR(raw: string): string | null {
  const digits = extractPhoneDigits(raw);
  if (digits.length === 0) return null;

  if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 13) {
    return `+${digits}`;
  }
  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }
  return null;
}

/**
 * Gera todas as variantes de um phone E.164 BR considerando o 9° dígito.
 *
 * Contexto: em 2012-2016 os celulares brasileiros passaram a ter 9 dígitos
 * no número (ex: DDD 86: 9421-406 → 9 9421-406). Muitos sistemas antigos
 * (e algumas operadoras) ainda trafegam sem o dígito extra.
 *
 * Exemplos:
 *   "+558699421406" (com 9°) → ["+558699421406", "+55869421406"]
 *   "+55869421406"  (sem 9°) → ["+55869421406", "+558699421406"]
 */
export function generatePhoneVariants(e164: string): string[] {
  const variants = new Set<string>([e164]);
  const digits = e164.replace(/\D/g, "");

  if (!digits.startsWith("55")) return Array.from(variants);

  const afterDDI = digits.slice(2); // 2 = "55"
  if (afterDDI.length < 10 || afterDDI.length > 11) return Array.from(variants);

  const ddd = afterDDI.slice(0, 2);
  const number = afterDDI.slice(2);

  // Com 9° dígito (11 dígitos após DDI, número = 9 dígitos, começa com 9)
  if (number.length === 9 && number.startsWith("9")) {
    variants.add(`+55${ddd}${number.slice(1)}`); // sem 9°
  }

  // Sem 9° dígito (10 dígitos após DDI, número = 8 dígitos)
  if (number.length === 8) {
    variants.add(`+55${ddd}9${number}`); // com 9°
  }

  return Array.from(variants);
}

// ─── Lead matching ────────────────────────────────────────────────────────────

export interface LeadMatch {
  id: string;
  name: string | null;
  phone: string | null;
  matchMethod: "phone_exact" | "phone_variant" | "name";
}

/**
 * Busca lead existente por phone (com variantes do 9° dígito).
 *
 * Retorna o match de maior confiança ou null se não encontrar.
 */
export async function matchLeadByPhone(
  supabase: SupabaseClient,
  orgId: string,
  phone: string,
): Promise<LeadMatch | null> {
  const variants = generatePhoneVariants(phone);

  const { data } = await supabase
    .from("leads")
    .select("id, name, phone")
    .eq("organization_id", orgId)
    .in("phone", variants)
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const isExact = data.phone === phone;
  return {
    id: data.id,
    name: data.name as string | null,
    phone: data.phone as string | null,
    matchMethod: isExact ? "phone_exact" : "phone_variant",
  };
}

/**
 * Normaliza um nome para comparação: lowercase, sem acentos, sem pontuação.
 *
 * "El Nathan Nicolás" → "el nathan nicolas"
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacritics
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

/**
 * Score de similaridade entre dois nomes (0..1).
 *
 * Estratégia: tokeniza ambos, conta interseção de tokens com ≥ 3 chars.
 * Score = |intersecao| / max(|tokens_a|, |tokens_b|)
 */
function nameScore(a: string, b: string): number {
  const tokensA = normalizeName(a)
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  const tokensB = normalizeName(b)
    .split(/\s+/)
    .filter((t) => t.length >= 3);

  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setA = new Set(tokensA);
  const matches = tokensB.filter((t) => setA.has(t)).length;
  return matches / Math.max(tokensA.length, tokensB.length);
}

/**
 * Busca lead existente por similaridade de nome (fallback quando não há phone).
 *
 * Só retorna match se score ≥ 0.5 (pelo menos metade dos tokens coincidem)
 * E o candidato tem pelo menos 2 tokens no nome (evitar falsos positivos em
 * nomes de uma palavra como "João").
 */
export async function matchLeadByName(
  supabase: SupabaseClient,
  orgId: string,
  name: string,
): Promise<LeadMatch | null> {
  const normalized = normalizeName(name);
  const tokens = normalized.split(/\s+/).filter((t) => t.length >= 3);
  if (tokens.length < 2) return null; // nome muito curto pra ser confiável

  // Busca pelo token mais longo (mais distintivo)
  const anchor = tokens.sort((a, b) => b.length - a.length)[0]!;

  const { data: candidates } = await supabase
    .from("leads")
    .select("id, name, phone")
    .eq("organization_id", orgId)
    .ilike("name", `%${anchor}%`)
    .limit(20);

  if (!candidates || candidates.length === 0) return null;

  let best: (typeof candidates)[0] | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    if (!candidate.name) continue;
    const score = nameScore(candidate.name as string, name);
    if (score > bestScore && score >= 0.5) {
      best = candidate;
      bestScore = score;
    }
  }

  if (!best) return null;
  return {
    id: best.id,
    name: best.name as string | null,
    phone: best.phone as string | null,
    matchMethod: "name",
  };
}

// ─── Membership + Activity ────────────────────────────────────────────────────

/**
 * Contexto passado para `linkGroupMembership`.
 */
export interface GroupJoinContext {
  supabase: SupabaseClient;
  orgId: string;
  groupId: string;
  groupName: string;
  /** JID ou phone do participante (ex: "558699421406@s.whatsapp.net"). */
  participantJid: string;
  /** Nome do participante (push name — pode ser null). */
  participantName: string | null;
  /** Fonte da entrada: "smart_link" | "manual" | "webhook". */
  source: "smart_link" | "manual" | "webhook";
  /** campaign_id se veio por smart link. */
  campaignId?: string | null;
  /** UTM fields (smart link path). */
  utm?: {
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    content?: string | null;
    term?: string | null;
  };
  /** SHA-256 do IP do visitante (smart link path). */
  ipHash?: string | null;
}

export interface GroupJoinResult {
  membershipId: string | null;
  lead: LeadMatch | null;
  activityCreated: boolean;
  alreadyLinked: boolean;
}

/**
 * Motor principal: normaliza o telefone, faz o matching contra leads
 * existentes, faz upsert do membership e cria lead_activity.
 *
 * Idempotente: upsert por (org, group, phone); atividade só criada
 * se ainda não existe uma com type="group_join" para este lead+grupo.
 */
export async function linkGroupMembership(
  ctx: GroupJoinContext,
): Promise<GroupJoinResult> {
  const { supabase, orgId, groupId, groupName, participantJid, participantName, source, campaignId, utm } = ctx;
  const db = supabase as any; // migration 079 tables not in generated types yet

  // 1. Normalize phone from JID
  const e164 = normalizePhoneBR(participantJid);

  // 2. Match lead
  let lead: LeadMatch | null = null;
  if (e164) {
    lead = await matchLeadByPhone(supabase, orgId, e164);
  }
  // Fallback: name matching (only when phone didn't match and name is available)
  if (!lead && participantName && participantName.trim().length >= 4) {
    lead = await matchLeadByName(supabase, orgId, participantName.trim());
  }

  // 3. Upsert membership
  const membershipPayload: Record<string, unknown> = {
    organization_id: orgId,
    group_id: groupId,
    phone: e164,
    name: participantName || null,
    joined_at: new Date().toISOString(),
    source,
    campaign_id: campaignId ?? null,
    lead_id: lead?.id ?? null,
    utm_source: utm?.source ?? null,
    utm_medium: utm?.medium ?? null,
    utm_campaign: utm?.campaign ?? null,
    utm_content: utm?.content ?? null,
    utm_term: utm?.term ?? null,
    ip_hash: ctx.ipHash ?? null,
  };

  let membershipId: string | null = null;
  let alreadyLinked = false;

  if (e164) {
    // Upsert por (org, group, phone) — índice único na migration 079
    const { data: upserted } = await db
      .from("group_memberships")
      .upsert(membershipPayload, {
        onConflict: "organization_id,group_id,phone",
        ignoreDuplicates: false,
      })
      .select("id, lead_id")
      .single();

    if (upserted) {
      membershipId = upserted.id as string;
      // Se já tinha lead_id de uma entrada anterior, não sobrescreve com null
      alreadyLinked = Boolean(upserted.lead_id);
      // Se agora temos um lead e antes não tinha, atualiza
      if (lead && !alreadyLinked) {
        await db
          .from("group_memberships")
          .update({ lead_id: lead.id })
          .eq("id", membershipId)
          .eq("organization_id", orgId);
      }
    }
  } else {
    // Sem phone: só insere se vier de smart_link (tem UTMs/campaign = valor de negócio).
    // Webhook sem phone = participante não identificável = sem valor, e geraria
    // duplicatas a cada retry do UAZAPI para o mesmo evento.
    if (source === "smart_link" || source === "manual") {
      const { data: inserted } = await db
        .from("group_memberships")
        .insert(membershipPayload)
        .select("id")
        .single();
      if (inserted) membershipId = inserted.id as string;
    }
  }

  // 4. Criar lead_activity se encontrou lead
  let activityCreated = false;
  if (lead && !alreadyLinked) {
    // Idempotência: checa se já existe atividade de group_join para este lead+grupo
    const { data: existingActivity } = await supabase
      .from("lead_activities")
      .select("id")
      .eq("organization_id", orgId)
      .eq("lead_id", lead.id)
      .eq("type", "group_join")
      .contains("metadata", { group_id: groupId })
      .limit(1)
      .maybeSingle();

    if (!existingActivity) {
      const confidence =
        lead.matchMethod === "phone_exact"
          ? "telefone exato"
          : lead.matchMethod === "phone_variant"
            ? "variante do 9° dígito"
            : "nome similar";

      await supabase.from("lead_activities").insert({
        organization_id: orgId,
        lead_id: lead.id,
        type: "group_join",
        description: `Entrou no grupo "${groupName}"`,
        metadata: {
          group_id: groupId,
          group_name: groupName,
          membership_id: membershipId,
          participant_phone: e164,
          match_method: lead.matchMethod,
          match_confidence: confidence,
          source,
        },
      });
      activityCreated = true;
    }
  }

  return { membershipId, lead, activityCreated, alreadyLinked };
}

// ─── Webhook event handler ────────────────────────────────────────────────────

/**
 * Processa um evento UAZAPI `EventType: "groups"` (participante entrou/saiu).
 *
 * Payload esperado (formato flat UAZAPI v2):
 * {
 *   EventType: "groups",
 *   chatid: "120363...@g.us",
 *   action: "add" | "remove" | "promote" | "demote",
 *   participants: string | string[],
 *   senderName?: string,
 *   owner: string
 * }
 */
export async function processGroupWebhookEvent(
  supabase: SupabaseClient,
  orgId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const action =
    typeof body.action === "string" ? body.action.toLowerCase() : null;

  if (action !== "add" && action !== "remove") return;

  const groupJid =
    typeof body.chatid === "string"
      ? body.chatid
      : typeof body.groupJid === "string"
        ? body.groupJid
        : null;
  if (!groupJid) return;

  // Resolve group_id pelo JID
  const { data: group } = await supabase
    .from("whatsapp_groups")
    .select("id, name")
    .eq("organization_id", orgId)
    .eq("group_jid", groupJid)
    .maybeSingle();

  if (!group) return; // grupo não monitorado → ignora

  // Normaliza participants (pode ser string ou array)
  const rawParticipants = body.participants;
  const participantList: string[] = Array.isArray(rawParticipants)
    ? (rawParticipants as unknown[]).filter((p) => typeof p === "string") as string[]
    : typeof rawParticipants === "string"
      ? [rawParticipants]
      : [];

  if (participantList.length === 0) return;

  const db = supabase as any; // migration 079/081 tables not in generated types yet

  // Processa cada participante (em série para não sobrecarregar o DB)
  for (const jid of participantList) {
    if (!jid) continue;
    try {
      if (action === "add") {
        await linkGroupMembership({
          supabase,
          orgId,
          groupId: group.id as string,
          groupName: group.name as string,
          participantJid: jid,
          participantName: null, // UAZAPI groups event não tem nome dos participantes
          source: "webhook",
        });
      } else {
        // action === "remove": marca left_at + decrementa contador
        const phone = normalizePhoneBR(jid);
        if (phone) {
          await db
            .from("group_memberships")
            .update({ left_at: new Date().toISOString() })
            .eq("organization_id", orgId)
            .eq("group_id", group.id)
            .eq("phone", phone)
            .is("left_at", null); // apenas se ainda ativo

          await db
            .rpc("decrement_group_participant_count", {
              p_group_id: group.id,
            })
            .catch(() => {});
        }
      }
    } catch {
      // Best-effort: um participante falhando não bloqueia os outros
    }
  }
}
