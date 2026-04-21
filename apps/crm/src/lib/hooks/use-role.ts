"use client";

import { useOrganization } from "./use-organization";

/**
 * Client-side role type — mirrors OrgRole from lib/auth.ts (server-only).
 * Kept here to avoid importing from a "use server" module.
 */
export type OrgRole = "owner" | "admin" | "agent" | "viewer";

const ROLE_HIERARCHY: Record<OrgRole, number> = {
  owner: 40,
  admin: 30,
  agent: 20,
  viewer: 10,
};

/**
 * Client-side role hook for UI-level permission checks.
 *
 * This is a UX layer — the backend (requireRole) remains the real defense.
 * The hierarchy mirrors server-side exactly: owner > admin > agent > viewer.
 *
 * Semantics:
 *   isAdmin = admin+  (owner OR admin)
 *   isAgent = agent+  (owner OR admin OR agent)
 */
export function useRole() {
  const { membership, loading } = useOrganization();
  const role = (membership?.role as OrgRole) || null;

  function canAccess(minRole: OrgRole): boolean {
    if (!role) return false;
    return (ROLE_HIERARCHY[role] || 0) >= ROLE_HIERARCHY[minRole];
  }

  return {
    role,
    loading,
    canAccess,
    isOwner: role === "owner",
    isAdmin: canAccess("admin"),   // admin+ (owner OR admin)
    isAgent: canAccess("agent"),   // agent+ (owner OR admin OR agent)
    isViewer: role === "viewer",
  };
}
