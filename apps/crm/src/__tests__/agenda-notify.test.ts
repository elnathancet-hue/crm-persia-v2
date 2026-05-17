// PR-AGENDA-NOTIFY (mai/2026): tests dos templates de notificacao
// imediata de cancel/reschedule. Pure functions — sem fetch, sem mock
// de provider. Foco em:
//   - saudacao com/sem nome (Olá / Olá {primeiroNome})
//   - linha de motivo presente quando reason informado
//   - linha de motivo ausente quando reason vazio/null
//   - reschedule mostra antes + depois
//   - formato data/hora pt-BR (delegado pro labels.ts ja testado)

import { describe, expect, it } from "vitest";
import type { Appointment } from "@persia/shared/agenda";
import {
  buildCancellationMessage,
  buildRescheduleMessage,
} from "@/lib/agenda/notifications/messages";

const BASE: Appointment = {
  id: "a1",
  organization_id: "org-1",
  kind: "appointment",
  title: "Consulta de avaliação",
  description: null,
  lead_id: "lead-1",
  user_id: "user-1",
  service_id: null,
  booking_page_id: null,
  start_at: "2026-05-20T17:00:00Z", // 14:00 BRT
  end_at: "2026-05-20T18:00:00Z",
  duration_minutes: 60,
  timezone: "America/Sao_Paulo",
  status: "confirmed",
  channel: null,
  location: null,
  meeting_url: null,
  cancelled_at: null,
  cancelled_by_user_id: null,
  cancelled_by_role: null,
  cancellation_reason: null,
  rescheduled_from_id: null,
  confirmation_sent_at: null,
  reminder_sent_at: null,
  external_calendar_connection_id: null,
  external_event_id: null,
  external_synced_at: null,
  recurrence_rule: null,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
  deleted_at: null,
};

describe("buildCancellationMessage", () => {
  it("usa primeiro nome do lead na saudacao", () => {
    const msg = buildCancellationMessage({
      appointment: BASE,
      leadName: "Maria das Dores Silva",
      reason: null,
    });
    expect(msg.startsWith("Olá Maria,")).toBe(true);
    expect(msg).not.toContain("das Dores");
  });

  it("usa 'Olá' generico quando lead nao tem nome", () => {
    const msg = buildCancellationMessage({
      appointment: BASE,
      leadName: "",
      reason: null,
    });
    expect(msg.startsWith("Olá,")).toBe(true);
  });

  it("inclui linha de motivo quando reason e informado", () => {
    const msg = buildCancellationMessage({
      appointment: BASE,
      leadName: "Joao",
      reason: "Conflito de agenda do consultor",
    });
    expect(msg).toContain("Motivo: Conflito de agenda do consultor");
  });

  it("NAO inclui linha de motivo quando reason e null", () => {
    const msg = buildCancellationMessage({
      appointment: BASE,
      leadName: "Joao",
      reason: null,
    });
    expect(msg).not.toContain("Motivo:");
  });

  it("NAO inclui linha de motivo quando reason e string vazia/spaces", () => {
    const msg = buildCancellationMessage({
      appointment: BASE,
      leadName: "Joao",
      reason: "   ",
    });
    expect(msg).not.toContain("Motivo:");
  });

  it("inclui titulo do agendamento entre aspas", () => {
    const msg = buildCancellationMessage({
      appointment: BASE,
      leadName: "Joao",
      reason: null,
    });
    expect(msg).toContain('"Consulta de avaliação"');
  });

  it("convida pra remarcar respondendo a mensagem", () => {
    const msg = buildCancellationMessage({
      appointment: BASE,
      leadName: "Joao",
      reason: null,
    });
    expect(msg).toContain("remarcar");
    expect(msg).toContain("responder");
  });
});

describe("buildRescheduleMessage", () => {
  const ORIGINAL: Appointment = { ...BASE };
  const REPLACEMENT: Appointment = {
    ...BASE,
    id: "a2",
    start_at: "2026-05-22T19:00:00Z", // 16:00 BRT
    end_at: "2026-05-22T20:00:00Z",
    rescheduled_from_id: "a1",
  };

  it("usa primeiro nome do lead", () => {
    const msg = buildRescheduleMessage({
      original: ORIGINAL,
      replacement: REPLACEMENT,
      leadName: "Maria Silva",
    });
    expect(msg.startsWith("Olá Maria,")).toBe(true);
  });

  it("mostra Antes (original) e Agora (replacement)", () => {
    const msg = buildRescheduleMessage({
      original: ORIGINAL,
      replacement: REPLACEMENT,
      leadName: "Joao",
    });
    expect(msg).toContain("Antes:");
    expect(msg).toContain("Agora:");
  });

  it("inclui titulo do agendamento", () => {
    const msg = buildRescheduleMessage({
      original: ORIGINAL,
      replacement: REPLACEMENT,
      leadName: "Joao",
    });
    expect(msg).toContain('"Consulta de avaliação"');
  });

  it("convida resposta pra duvidas", () => {
    const msg = buildRescheduleMessage({
      original: ORIGINAL,
      replacement: REPLACEMENT,
      leadName: "Joao",
    });
    expect(msg).toContain("dúvida");
    expect(msg).toContain("responder");
  });
});
