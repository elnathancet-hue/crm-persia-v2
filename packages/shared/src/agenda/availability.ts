// Agenda — pure logic for availability + slot calculation + conflict detection.
//
// IMPORTANTE: este arquivo eh PURE FUNCTIONS — sem fetch, sem Supabase, sem
// React. Roda igual em server (actions/cron) e em client (preview no form).
//
// FIX vs versao Vite original:
// O codigo antigo (`availabilityUtils.ts`) usava Date.getHours() que retorna
// horario LOCAL DO SERVIDOR. Em prod (servidor UTC) um agendamento
// `2026-05-01T14:00:00-03:00` virava 17:00 na deteccao de conflito —
// silenciosamente bug. Aqui resolvemos de duas formas:
//
//   1) Conflito (overlap) compara timestamps direto (getTime()), sem extrair
//      hora — "intervalo A sobrepoe B" eh propriedade absoluta de tempo.
//   2) Disponibilidade (isWithinAvailability) extrai hora-no-fuso-do-rule
//      via Intl.DateTimeFormat, garantindo coerencia mesmo cruzando DST.

import {
  type Appointment,
  type AppointmentStatus,
  type AvailabilityRule,
  type DayOfWeek,
  BLOCKING_APPOINTMENT_STATUSES,
} from "./types";

// ============================================================================
// Timezone helpers (Intl-only, zero deps)
// ============================================================================

/**
 * Retorna o instante de `iso` projetado em `timezone`, decomposto em
 * day-of-week e minutos-do-dia. Usado pra checar se um agendamento cai
 * dentro da janela semanal definida em `availability_rules.days`.
 */
export function getZonedTime(
  iso: string,
  timezone: string,
): { day_of_week: DayOfWeek; minutes_in_day: number } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`getZonedTime: invalid ISO date "${iso}"`);
  }

  // Formatter retorna partes separadas no fuso pedido. weekday="short" devolve
  // "Sun".."Sat" — mais estavel que parsing de string ja formatada.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  let weekday = "";
  let hour = 0;
  let minute = 0;
  for (const part of formatter.formatToParts(date)) {
    if (part.type === "weekday") weekday = part.value;
    else if (part.type === "hour") hour = parseInt(part.value, 10);
    else if (part.type === "minute") minute = parseInt(part.value, 10);
  }

  // hour12=false ainda devolve "24" pra meia-noite em alguns runtimes; normaliza.
  if (hour === 24) hour = 0;

  const weekdayMap: Record<string, DayOfWeek> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const day_of_week = weekdayMap[weekday];
  if (day_of_week === undefined) {
    throw new Error(`getZonedTime: unexpected weekday "${weekday}"`);
  }

  return {
    day_of_week,
    minutes_in_day: hour * 60 + minute,
  };
}

/**
 * Converte "HH:mm" em minutos desde 00:00. Aceita "24:00" como sinonimo de
 * fim-de-dia (1440), pra permitir intervalo inclusivo "00:00..24:00".
 */
export function timeStringToMinutes(time: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) {
    throw new Error(`timeStringToMinutes: invalid time "${time}"`);
  }
  const hours = parseInt(match[1]!, 10);
  const minutes = parseInt(match[2]!, 10);
  if (hours < 0 || hours > 24 || minutes < 0 || minutes > 59) {
    throw new Error(`timeStringToMinutes: out-of-range time "${time}"`);
  }
  if (hours === 24 && minutes !== 0) {
    throw new Error(`timeStringToMinutes: only "24:00" is allowed past 23:59`);
  }
  return hours * 60 + minutes;
}

export function minutesToTimeString(total: number): string {
  if (!Number.isFinite(total) || total < 0 || total > 1440) {
    throw new Error(`minutesToTimeString: out-of-range minutes ${total}`);
  }
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ============================================================================
// Conflict detection (timestamp-based, timezone-agnostic)
// ============================================================================

interface ConflictCandidate {
  start_at: string;
  end_at: string;
  user_id: string;
  /** ID atual (pra excluir o proprio appointment ao editar). */
  id?: string;
}

/**
 * Retorna o appointment conflitante ou undefined. Conflito = mesmo user_id +
 * status bloqueante (awaiting_confirmation/confirmed/rescheduled) + sobreposicao
 * temporal real (start_a < end_b && start_b < end_a).
 *
 * NAO depende de timezone — tudo eh comparacao de timestamps absolutos.
 */
export function findScheduleConflict(
  candidate: ConflictCandidate,
  existing: readonly Appointment[],
): Appointment | undefined {
  const candStart = new Date(candidate.start_at).getTime();
  const candEnd = new Date(candidate.end_at).getTime();
  if (Number.isNaN(candStart) || Number.isNaN(candEnd)) {
    throw new Error("findScheduleConflict: invalid candidate timestamps");
  }
  if (candEnd <= candStart) {
    throw new Error("findScheduleConflict: end_at must be after start_at");
  }

  const blocking = new Set<AppointmentStatus>(BLOCKING_APPOINTMENT_STATUSES);

  for (const app of existing) {
    if (candidate.id && app.id === candidate.id) continue;
    if (app.user_id !== candidate.user_id) continue;
    if (app.deleted_at) continue;
    if (!blocking.has(app.status)) continue;

    const appStart = new Date(app.start_at).getTime();
    const appEnd = new Date(app.end_at).getTime();
    if (candStart < appEnd && appStart < candEnd) {
      return app;
    }
  }
  return undefined;
}

// ============================================================================
// Availability check (timezone-aware via rule.timezone)
// ============================================================================

/**
 * Verifica se o intervalo [start_at, end_at) cabe dentro da disponibilidade
 * definida pela regra. Cruzamento de dia local NAO eh permitido — o intervalo
 * inteiro precisa estar no MESMO dia-da-semana, dentro de UM intervalo
 * configurado.
 *
 * Retorna true se cabe (ou se rule undefined = "sem regra, libera tudo").
 */
export function isWithinAvailability(
  rule: AvailabilityRule | undefined,
  start_at: string,
  end_at: string,
): boolean {
  if (!rule) return true;

  const startZ = getZonedTime(start_at, rule.timezone);
  const endZ = getZonedTime(end_at, rule.timezone);

  // Intervalo nao pode atravessar a meia-noite local.
  if (startZ.day_of_week !== endZ.day_of_week) return false;

  // end pode ser exatamente "fim do dia anterior" se end_at = 24:00 do dia
  // start. Mas como Intl projeta "24:00" como 00:00 do dia seguinte, o caso
  // soh acontece se start=00:00, end=24:00 no MESMO dia — entao adicionamos:
  // tratamento especial omitido por enquanto; UI nunca permite 24:00 inteiro.

  const dayConfig = rule.days.find((d) => d.day_of_week === startZ.day_of_week);
  if (!dayConfig || !dayConfig.enabled || dayConfig.intervals.length === 0) {
    return false;
  }

  const startMin = startZ.minutes_in_day;
  // Se end caiu exatamente em 00:00 do dia seguinte, mas startZ ainda eh o
  // dia anterior, o `if` acima ja barrou. Aqui endMin eh always >= startMin
  // dentro do mesmo dia.
  const endMin = endZ.minutes_in_day === 0 ? 1440 : endZ.minutes_in_day;

  return dayConfig.intervals.some((interval) => {
    const iStart = timeStringToMinutes(interval.start);
    const iEnd = timeStringToMinutes(interval.end);
    return startMin >= iStart && endMin <= iEnd;
  });
}

// ============================================================================
// Slot generation pra UI / booking pages
// ============================================================================

export interface GetAvailableSlotsInput {
  /** Data alvo no formato YYYY-MM-DD. Interpretada no timezone do rule. */
  date: string;
  rule: AvailabilityRule;
  duration_minutes: number;
  /** Buffer entre slots, em minutos. Default 0. */
  buffer_minutes?: number;
  /** Appointments existentes (so importam os do user da rule e da data). */
  existing: readonly Appointment[];
  /** Step de geracao em minutos. Default = duration_minutes. */
  step_minutes?: number;
}

export interface AvailableSlot {
  /** ISO timestamp UTC (start). */
  start_at: string;
  /** ISO timestamp UTC (end). */
  end_at: string;
  /** "HH:mm" no fuso do rule, pra exibir na UI. */
  display_time: string;
}

/**
 * Gera os slots livres em `date` segundo a regra. Filtra automaticamente
 * conflitos com `existing` (mesma logica do findScheduleConflict).
 *
 * IMPORTANTE: `date` eh interpretado no fuso do rule. Ex: se rule.timezone =
 * "America/Sao_Paulo" e date = "2026-05-01", o dia comeca a 00:00 BRT
 * (= 03:00 UTC).
 */
export function getAvailableSlots(
  input: GetAvailableSlotsInput,
): AvailableSlot[] {
  const {
    date,
    rule,
    duration_minutes,
    buffer_minutes = 0,
    existing,
    step_minutes = duration_minutes,
  } = input;

  if (duration_minutes <= 0) {
    throw new Error("getAvailableSlots: duration_minutes must be > 0");
  }
  if (step_minutes <= 0) {
    throw new Error("getAvailableSlots: step_minutes must be > 0");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`getAvailableSlots: invalid date "${date}", expected YYYY-MM-DD`);
  }

  // Descobre dia-da-semana de `date` no fuso do rule. Truque: usa meio-dia
  // como referencia (12:00 local) — evita falso DOW por DST nas bordas.
  const refIso = `${date}T12:00:00`;
  const localOffsetIso = projectLocalToUtc(refIso, rule.timezone);
  const { day_of_week } = getZonedTime(localOffsetIso, rule.timezone);

  const dayConfig = rule.days.find((d) => d.day_of_week === day_of_week);
  if (!dayConfig || !dayConfig.enabled) return [];

  const slots: AvailableSlot[] = [];
  const userExisting = existing.filter(
    (a) => a.user_id === rule.user_id && !a.deleted_at,
  );

  for (const interval of dayConfig.intervals) {
    const iStart = timeStringToMinutes(interval.start);
    const iEnd = timeStringToMinutes(interval.end);

    let cursor = iStart;
    while (cursor + duration_minutes <= iEnd) {
      const display = minutesToTimeString(cursor);
      const slotStartLocalIso = `${date}T${display}:00`;
      const slotStartUtcIso = projectLocalToUtc(slotStartLocalIso, rule.timezone);
      const slotEndUtcIso = new Date(
        new Date(slotStartUtcIso).getTime() + duration_minutes * 60_000,
      ).toISOString();

      const conflict = findScheduleConflict(
        {
          start_at: slotStartUtcIso,
          end_at: slotEndUtcIso,
          user_id: rule.user_id,
        },
        userExisting,
      );

      if (!conflict) {
        slots.push({
          start_at: slotStartUtcIso,
          end_at: slotEndUtcIso,
          display_time: display,
        });
      }

      cursor += step_minutes + buffer_minutes;
    }
  }

  return slots;
}

/**
 * Recebe `localIso` (sem zona, ex: "2026-05-01T09:00:00") e o interpreta
 * como "9h da manha em `timezone`", devolvendo o ISO UTC equivalente.
 *
 * Usa o truque de descobrir o offset do fuso pra o instante em questao via
 * Intl.DateTimeFormat. Funciona pra DST porque o offset eh recalculado pra
 * cada instante.
 */
export function projectLocalToUtc(localIso: string, timezone: string): string {
  // Step 1: assume que `localIso` JA eh UTC, calcula o offset desse instante
  // no fuso `timezone`, e ajusta. Itera 1x pra acomodar travessia de DST.
  const naive = new Date(`${localIso}Z`);
  if (Number.isNaN(naive.getTime())) {
    throw new Error(`projectLocalToUtc: invalid local ISO "${localIso}"`);
  }

  const offsetMin = getTimezoneOffsetMinutes(naive, timezone);
  const guess = new Date(naive.getTime() - offsetMin * 60_000);

  // Recalcula offset no instante "guess" — corrige se cruzou DST.
  const offsetMin2 = getTimezoneOffsetMinutes(guess, timezone);
  if (offsetMin2 === offsetMin) {
    return guess.toISOString();
  }
  return new Date(naive.getTime() - offsetMin2 * 60_000).toISOString();
}

/**
 * Offset (em minutos) entre `timezone` e UTC pro instante `instant`.
 * Positivo = timezone esta a frente de UTC, negativo = atras.
 * Ex: America/Sao_Paulo retorna -180.
 */
export function getTimezoneOffsetMinutes(
  instant: Date,
  timezone: string,
): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);

  let hour = get("hour");
  if (hour === 24) hour = 0;

  // Reconstroi como se fosse UTC pra comparar com instant.getTime().
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}
