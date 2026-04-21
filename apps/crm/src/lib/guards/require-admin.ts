import { getAuthContext } from "@/lib/auth";
import { redirect } from "next/navigation";

const ROLE_HIERARCHY: Record<string, number> = {
  owner: 40,
  admin: 30,
  agent: 20,
  viewer: 10,
};

/**
 * Server-side guard for admin-only pages.
 * Redirects to /dashboard if the user's role is below admin.
 *
 * Handles all cases:
 *   - role is null (no org membership) → redirect
 *   - role is viewer/agent → redirect
 *   - role is admin/owner → pass through
 *
 * Use in server components (pages and layouts):
 *   await requireAdminPageAccess();
 *
 * This is a UX guard. The real defense is requireRole("admin") in server actions.
 */
export async function requireAdminPageAccess() {
  const ctx = await getAuthContext();
  const level = ROLE_HIERARCHY[ctx.role ?? ""] ?? 0;

  if (level < ROLE_HIERARCHY.admin) {
    redirect("/dashboard");
  }

  return ctx;
}
