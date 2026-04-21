// Re-export from shared package. Types live in packages/shared/src/database.ts
// (Fase 2.2a — single source of truth). This stub keeps existing import paths
// in apps/crm working; follow-up will migrate to direct @persia/shared imports.
export * from "@persia/shared/database";
