// Templates de mensagens WhatsApp pra eventos imediatos da Agenda
// (cancel / reschedule). Pure functions — sem fetch, sem provider,
// faceis de testar.
//
// PR-AGENDA-NOTIFY (mai/2026): antes do fix, cancelamento/reagendamento
// nao avisavam o lead. Lembrete inicial funcionava (sistema queueado de
// `reminder_configs`), mas eventos pos-criacao eram silenciosos. Agora:
// imediato + fire-and-forget na server action.

import { formatDate, formatTime, type Appointment } from "@persia/shared/agenda";

/**
 * Renderiza saudacao do lead. Se nao tem nome, usa "Olá".
 * Primeiro nome apenas (corta no primeiro espaco) — soa mais pessoal
 * em mensagem automatica.
 */
function renderGreeting(leadName: string): string {
  const trimmed = leadName.trim();
  if (!trimmed) return "Olá";
  const first = trimmed.split(/\s+/)[0];
  return `Olá ${first}`;
}

export interface CancellationMessageInput {
  appointment: Appointment;
  leadName: string;
  reason?: string | null;
}

export function buildCancellationMessage(input: CancellationMessageInput): string {
  const { appointment, leadName, reason } = input;
  const greeting = renderGreeting(leadName);
  const date = formatDate(appointment.start_at, appointment.timezone);
  const time = formatTime(appointment.start_at, appointment.timezone);

  // Linha de motivo so aparece quando passado e nao vazio. Usuario
  // pode cancelar sem motivo (no_show, ausencia, etc).
  const reasonLine =
    reason && reason.trim().length > 0 ? `\n\nMotivo: ${reason.trim()}` : "";

  return (
    `${greeting}, seu agendamento "${appointment.title}" ` +
    `de ${date} às ${time} foi cancelado.${reasonLine}\n\n` +
    `Se quiser remarcar, é só responder essa mensagem.`
  );
}

// PR-AGENT-INTEGRATION-6 (mai/2026): mensagem de confirmacao quando
// booking publico (pagina /agendar) cria o appointment. Antes a pagina
// promete "Voce recebera uma confirmacao no WhatsApp" mas nada era
// enviado. Agora notifica imediatamente apos criar (fire-and-forget).
export interface BookingConfirmationMessageInput {
  appointment: Appointment;
  leadName: string;
}

export function buildBookingConfirmationMessage(
  input: BookingConfirmationMessageInput,
): string {
  const { appointment, leadName } = input;
  const greeting = renderGreeting(leadName);
  const date = formatDate(appointment.start_at, appointment.timezone);
  const time = formatTime(appointment.start_at, appointment.timezone);

  // appointment.status na criacao publica e "awaiting_confirmation"
  // (atendente humano confirma no admin). Avisa o lead que recebemos
  // e que vamos confirmar.
  return (
    `${greeting}! Recebemos seu agendamento "${appointment.title}" ` +
    `para ${date} às ${time}.\n\n` +
    `Vamos confirmar em breve. Se precisar mudar, é só responder.`
  );
}

export interface ConfirmationMessageInput {
  appointment: Appointment;
  leadName: string;
}

export function buildConfirmationMessage(input: ConfirmationMessageInput): string {
  const { appointment, leadName } = input;
  const greeting = renderGreeting(leadName);
  const date = formatDate(appointment.start_at, appointment.timezone);
  const time = formatTime(appointment.start_at, appointment.timezone);

  return (
    `${greeting}! Seu agendamento "${appointment.title}" ` +
    `para ${date} às ${time} foi *confirmado*.\n\n` +
    `Qualquer dúvida ou se precisar reagendar, é só responder.`
  );
}

export interface RescheduleMessageInput {
  original: Appointment;
  replacement: Appointment;
  leadName: string;
}

export function buildRescheduleMessage(input: RescheduleMessageInput): string {
  const { original, replacement, leadName } = input;
  const greeting = renderGreeting(leadName);
  const oldDate = formatDate(original.start_at, original.timezone);
  const oldTime = formatTime(original.start_at, original.timezone);
  const newDate = formatDate(replacement.start_at, replacement.timezone);
  const newTime = formatTime(replacement.start_at, replacement.timezone);

  return (
    `${greeting}, seu agendamento "${original.title}" foi reagendado.\n\n` +
    `Antes: ${oldDate} às ${oldTime}\n` +
    `Agora: ${newDate} às ${newTime}\n\n` +
    `Qualquer dúvida, é só responder.`
  );
}
