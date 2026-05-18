import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import { nowIso } from "../db";
import { failureResult, getHandlerDb, insertLeadActivity, successResult, trimReason } from "./shared";

// PR-AI-AGENT-TOOLS-NAMES (mai/2026): aceita `user` (nome ou email
// vindo do catalogo no system prompt) OU `user_id` (UUID — retrocompat).
// Pelo menos um obrigatorio.
const transferToUserSchema = z.object({
  user: z.string().trim().min(1).max(200).optional(),
  user_id: z.string().uuid().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

interface MemberLookup {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

async function resolveTargetUser(
  db: ReturnType<typeof getHandlerDb>,
  orgId: string,
  input: { user?: string; user_id?: string },
): Promise<MemberLookup | { error: string }> {
  if (!db) return { error: "database context missing" };

  // Strategy: pega membros ativos da org + profiles deles. Em memoria
  // resolve por user_id (UUID), email exato (case-insensitive) ou
  // full_name exato (case-insensitive). Lista pequena (~10-20 typical),
  // 2 queries totais — eficiente o suficiente sem index custom.
  const { data: members, error: memberError } = await db
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("is_active", true);
  if (memberError) return { error: memberError.message };

  const memberIds = ((members ?? []) as Array<{ user_id?: string | null }>)
    .map((m) => m.user_id)
    .filter((id): id is string => Boolean(id));
  if (memberIds.length === 0) {
    return { error: "no active members in organization" };
  }

  const { data: profiles, error: profileError } = await db
    .from("profiles")
    .select("id, full_name, email")
    .in("id", memberIds);
  if (profileError) return { error: profileError.message };

  const lookups = ((profiles ?? []) as Array<{
    id: string;
    full_name?: string | null;
    email?: string | null;
  }>).map<MemberLookup>((p) => ({
    user_id: p.id,
    full_name: p.full_name ?? null,
    email: p.email ?? null,
  }));

  // 1. UUID exato (retrocompat)
  if (input.user_id) {
    const match = lookups.find((l) => l.user_id === input.user_id);
    if (match) return match;
  }

  // 2. Email/nome (novo path)
  if (input.user) {
    const needle = input.user.trim().toLowerCase();
    const byEmail = lookups.find(
      (l) => l.email?.toLowerCase() === needle,
    );
    if (byEmail) return byEmail;
    const byName = lookups.find(
      (l) => l.full_name?.toLowerCase() === needle,
    );
    if (byName) return byName;
  }

  return {
    error: "membro nao encontrado nesta organizacao",
  };
}

export const transferToUserHandler: NativeHandler = async (context, input) => {
  const parsed = transferToUserSchema.safeParse(input);
  if (!parsed.success) {
    return failureResult("invalid tool input", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  if (!parsed.data.user && !parsed.data.user_id) {
    return failureResult("informe user (recomendado) ou user_id");
  }

  const db = getHandlerDb(context);
  if (!db) return failureResult("database context missing");

  const reason = trimReason(parsed.data.reason, "agent_requested_transfer");

  const resolved = await resolveTargetUser(db, context.organization_id, {
    user: parsed.data.user,
    user_id: parsed.data.user_id,
  });
  if ("error" in resolved) {
    return failureResult(resolved.error, {
      requested: parsed.data.user ?? parsed.data.user_id,
    });
  }

  const targetUserId = resolved.user_id;
  const displayName =
    resolved.full_name?.trim() ||
    resolved.email?.trim() ||
    `user:${targetUserId.slice(0, 8)}`;

  if (context.dry_run) {
    return successResult(
      {
        user_id: targetUserId,
        assigned_to: targetUserId,
        assignee_name: displayName,
        reason,
      },
      [`would assign lead to ${displayName}`],
    );
  }

  const { error: leadError } = await db
    .from("leads")
    .update({
      assigned_to: targetUserId,
      updated_at: nowIso(),
    })
    .eq("id", context.lead_id)
    .eq("organization_id", context.organization_id);

  if (leadError) return failureResult(leadError.message);

  await insertLeadActivity({
    db,
    organizationId: context.organization_id,
    leadId: context.lead_id,
    type: "assigned",
    description: `Nota interna do agente: lead transferido para ${displayName}. Motivo: ${reason}`,
    metadata: {
      conversation_id: context.crm_conversation_id,
      agent_conversation_id: context.agent_conversation_id,
      assigned_to: targetUserId,
      run_id: context.run_id,
    },
  });

  return successResult(
    {
      user_id: targetUserId,
      assigned_to: targetUserId,
      assignee_name: displayName,
      reason,
    },
    [`assigned lead to ${displayName}`, "added internal lead activity note"],
  );
};

