// Re-export from shared package. WhatsApp provider contract lives in
// packages/shared/src/whatsapp.ts (Fase 2.2a — single source of truth).
// This stub keeps existing import paths in apps/crm working while migration
// is in progress. Follow-up will rewrite call sites to @persia/shared direct.
export * from "@persia/shared/whatsapp";
