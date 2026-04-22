import "server-only";

import { withAdmin, type AdminClient } from "@/lib/supabase-admin";

export type SensitiveRateLimitAction =
  | "add_superadmin"
  | "delete_organization"
  | "execute_campaign";

interface RateLimitPolicy {
  windowSeconds: number;
  maxHits: number;
  scope: "global" | "org";
}

const POLICIES: Record<SensitiveRateLimitAction, RateLimitPolicy> = {
  add_superadmin: { windowSeconds: 10 * 60, maxHits: 3, scope: "global" },
  delete_organization: { windowSeconds: 10 * 60, maxHits: 2, scope: "global" },
  execute_campaign: { windowSeconds: 5 * 60, maxHits: 3, scope: "org" },
};

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  resetAt: string | null;
  retryAfterSeconds: number;
  bypassed?: boolean;
}

interface ConsumeRateLimitParams {
  admin?: AdminClient;
  userId: string;
  orgId?: string | null;
  action: SensitiveRateLimitAction;
}

interface RateLimitRpcRow {
  allowed: boolean;
  remaining: number;
  reset_at: string | null;
  retry_after_seconds: number;
}

interface RateLimitRpcClient {
  rpc(
    fn: "consume_rate_limit",
    args: {
      p_user_id: string;
      p_action: string;
      p_window_seconds: number;
      p_max_hits: number;
      p_organization_id: string | null;
    },
  ): Promise<{ data: RateLimitRpcRow[] | null; error: { message: string } | null }>;
}

export class RateLimitExceededError extends Error {
  readonly retryAfterSeconds: number;
  readonly resetAt: string | null;

  constructor(action: SensitiveRateLimitAction, decision: RateLimitDecision) {
    const minutes = Math.max(1, Math.ceil(decision.retryAfterSeconds / 60));
    super(`Muitas tentativas para ${action}. Tente novamente em ${minutes} min.`);
    this.name = "RateLimitExceededError";
    this.retryAfterSeconds = decision.retryAfterSeconds;
    this.resetAt = decision.resetAt;
  }
}

function isFailClosed(): boolean {
  return process.env.ADMIN_RATE_LIMIT_FAIL_CLOSED === "true";
}

async function consumeWithClient(
  admin: AdminClient,
  params: ConsumeRateLimitParams,
): Promise<RateLimitDecision> {
  const policy = POLICIES[params.action];
  const scopedOrgId = policy.scope === "org" ? params.orgId ?? null : null;

  const { data, error } = await (admin as unknown as RateLimitRpcClient).rpc(
    "consume_rate_limit",
    {
      p_user_id: params.userId,
      p_action: params.action,
      p_window_seconds: policy.windowSeconds,
      p_max_hits: policy.maxHits,
      p_organization_id: scopedOrgId,
    },
  );

  if (error) throw new Error(error.message);

  const row = data?.[0];
  if (!row) throw new Error("consume_rate_limit returned no rows");

  return {
    allowed: row.allowed,
    remaining: row.remaining,
    resetAt: row.reset_at,
    retryAfterSeconds: row.retry_after_seconds,
  };
}

export async function consumeRateLimit(
  params: ConsumeRateLimitParams,
): Promise<RateLimitDecision> {
  try {
    if (params.admin) {
      return await consumeWithClient(params.admin, params);
    }

    return await withAdmin("rate_limit_consume", (admin) => consumeWithClient(admin, params));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[rate-limit] check failed", {
      action: params.action,
      organization_id: params.orgId ?? null,
      user_id: params.userId,
      fail_closed: isFailClosed(),
      error: message,
    });

    if (isFailClosed()) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: null,
        retryAfterSeconds: 60,
      };
    }

    // Rollout safety: if the migration has not landed yet, keep current
    // behavior and log loudly. Actual limit hits still fail closed.
    return {
      allowed: true,
      remaining: Number.MAX_SAFE_INTEGER,
      resetAt: null,
      retryAfterSeconds: 0,
      bypassed: true,
    };
  }
}

export async function assertRateLimit(
  params: ConsumeRateLimitParams,
): Promise<RateLimitDecision> {
  const decision = await consumeRateLimit(params);
  if (!decision.allowed) {
    throw new RateLimitExceededError(params.action, decision);
  }
  return decision;
}
