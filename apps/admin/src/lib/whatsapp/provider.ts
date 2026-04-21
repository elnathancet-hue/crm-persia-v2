// Re-export from shared package. WhatsApp provider contract lives in
// packages/shared/src/whatsapp.ts (Fase 2.2a). Admin e CRM compartilham
// o mesmo contrato — unified source of truth, fim da divergencia silenciosa.
export * from "@persia/shared/whatsapp";
