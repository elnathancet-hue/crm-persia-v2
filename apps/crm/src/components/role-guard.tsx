"use client";

import { useRole, type OrgRole } from "@/lib/hooks/use-role";

interface RoleGuardProps {
  minRole: OrgRole;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Conditionally renders children based on the current user's role.
 *
 * UX layer only — does NOT replace server-side requireRole().
 * Returns null during loading to avoid flashing unauthorized content.
 * Optionally renders a fallback for users without access.
 */
export function RoleGuard({ minRole, children, fallback = null }: RoleGuardProps) {
  const { canAccess, loading } = useRole();

  if (loading) return null;
  if (!canAccess(minRole)) return <>{fallback}</>;

  return <>{children}</>;
}
