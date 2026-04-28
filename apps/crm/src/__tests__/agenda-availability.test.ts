// Tests pra packages/shared/src/agenda/availability.ts
//
// Cobertura focada em:
//   1) Bug fix do isoToMinutes: comparar timestamps absolutos, NAO horas locais
//   2) Timezone-aware availability check (rule em America/Sao_Paulo, instante UTC)
//   3) Slot generation respeitando duration + buffer + step + conflitos
//   4) projectLocalToUtc lidando com DST
//   5) Validacoes de input

import { describe, expect, it } from "vitest";
import {
  type Appointment,
  type AvailabilityRule,
  findScheduleConflict,
  getAvailableSlots,
  getTimezoneOffsetMinutes,
  getZonedTime,
  isWithinAvailability,
  minutesToTimeString,
  projectLocalToUtc,
  timeStringToMinutes,
} from "@persia/shared/agenda";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG = "00000000-0000-0000-0000-000000000001";
const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: overrides.id ?? "app-1",
    organization_id: ORG,
    kind: "appointment",
    title: "Consulta",
    description: null,
    lead_id: null,
    user_id: USER_A,
    service_id: null,
    booking_page_id: null,
    start_at: "2026-05-04T13:00:00Z", // segunda 10:00 BRT
    end_at: "2026-05-04T14:00:00Z", // segunda 11:00 BRT
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
    ...overrides,
  };
}

function fullWeekRule(
  intervals: { start: string; end: string }[],
  user_id = USER_A,
  timezone = "America/Sao_Paulo",
): AvailabilityRule {
  return {
    id: "rule-1",
    organization_id: ORG,
    user_id,
    name: "Padrão",
    timezone,
    default_duration_minutes: 60,
    days: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
      day_of_week: dow as 0 | 1 | 2 | 3 | 4 | 5 | 6,
      enabled: true,
      intervals,
    })),
    is_default: true,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
  };
}

// ---------------------------------------------------------------------------
// Time string helpers
// ---------------------------------------------------------------------------

describe("timeStringToMinutes", () => {
  it("aceita HH:mm 24h", () => {
    expect(timeStringToMinutes("00:00")).toBe(0);
    expect(timeStringToMinutes("09:30")).toBe(570);
    expect(timeStringToMinutes("23:59")).toBe(1439);
  });

  it("aceita 24:00 como fim-de-dia", () => {
    expect(timeStringToMinutes("24:00")).toBe(1440);
  });

  it("rejeita formato invalido", () => {
    expect(() => timeStringToMinutes("9:30")).not.toThrow(); // single-digit hour OK
    expect(() => timeStringToMinutes("25:00")).toThrow();
    expect(() => timeStringToMinutes("12:60")).toThrow();
    expect(() => timeStringToMinutes("12-30")).toThrow();
    expect(() => timeStringToMinutes("24:01")).toThrow();
  });
});

describe("minutesToTimeString", () => {
  it("formata corretamente", () => {
    expect(minutesToTimeString(0)).toBe("00:00");
    expect(minutesToTimeString(570)).toBe("09:30");
    expect(minutesToTimeString(1439)).toBe("23:59");
    expect(minutesToTimeString(1440)).toBe("24:00");
  });

  it("rejeita fora de range", () => {
    expect(() => minutesToTimeString(-1)).toThrow();
    expect(() => minutesToTimeString(1441)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Timezone helpers
// ---------------------------------------------------------------------------

describe("getZonedTime", () => {
  it("converte UTC pra America/Sao_Paulo (-03:00 todo o ano desde 2019)", () => {
    // 2026-05-04T13:00:00Z = segunda 10:00 BRT
    expect(getZonedTime("2026-05-04T13:00:00Z", "America/Sao_Paulo")).toEqual({
      day_of_week: 1,
      minutes_in_day: 600,
    });
  });

  it("dia da semana muda quando cruza meia-noite local", () => {
    // 2026-05-05T02:00:00Z = segunda 23:00 BRT
    expect(getZonedTime("2026-05-05T02:00:00Z", "America/Sao_Paulo")).toEqual({
      day_of_week: 1,
      minutes_in_day: 23 * 60,
    });
    // 2026-05-05T03:00:00Z = terca 00:00 BRT
    expect(getZonedTime("2026-05-05T03:00:00Z", "America/Sao_Paulo")).toEqual({
      day_of_week: 2,
      minutes_in_day: 0,
    });
  });

  it("funciona em UTC", () => {
    expect(getZonedTime("2026-05-04T13:00:00Z", "UTC")).toEqual({
      day_of_week: 1,
      minutes_in_day: 13 * 60,
    });
  });

  it("rejeita ISO invalido", () => {
    expect(() => getZonedTime("not a date", "UTC")).toThrow();
  });
});

describe("getTimezoneOffsetMinutes", () => {
  it("America/Sao_Paulo retorna -180 (UTC-3)", () => {
    const offset = getTimezoneOffsetMinutes(
      new Date("2026-05-04T13:00:00Z"),
      "America/Sao_Paulo",
    );
    expect(offset).toBe(-180);
  });

  it("UTC retorna 0", () => {
    const offset = getTimezoneOffsetMinutes(
      new Date("2026-05-04T13:00:00Z"),
      "UTC",
    );
    expect(offset).toBe(0);
  });

  it("Europe/London muda com DST (BST = +60)", () => {
    // janeiro = GMT (offset 0)
    expect(
      getTimezoneOffsetMinutes(new Date("2026-01-15T12:00:00Z"), "Europe/London"),
    ).toBe(0);
    // julho = BST (offset +60)
    expect(
      getTimezoneOffsetMinutes(new Date("2026-07-15T12:00:00Z"), "Europe/London"),
    ).toBe(60);
  });
});

describe("projectLocalToUtc", () => {
  it("interpreta horario local como timezone do rule", () => {
    // "2026-05-04T09:00:00" em BRT = 12:00 UTC
    expect(projectLocalToUtc("2026-05-04T09:00:00", "America/Sao_Paulo")).toBe(
      "2026-05-04T12:00:00.000Z",
    );
  });

  it("identidade em UTC", () => {
    expect(projectLocalToUtc("2026-05-04T09:00:00", "UTC")).toBe(
      "2026-05-04T09:00:00.000Z",
    );
  });

  it("lida com DST: London 09:00 em julho = 08:00 UTC (BST)", () => {
    expect(projectLocalToUtc("2026-07-15T09:00:00", "Europe/London")).toBe(
      "2026-07-15T08:00:00.000Z",
    );
  });

  it("lida com DST: London 09:00 em janeiro = 09:00 UTC (GMT)", () => {
    expect(projectLocalToUtc("2026-01-15T09:00:00", "Europe/London")).toBe(
      "2026-01-15T09:00:00.000Z",
    );
  });
});

// ---------------------------------------------------------------------------
// findScheduleConflict — o bug raiz que estamos consertando
// ---------------------------------------------------------------------------

describe("findScheduleConflict", () => {
  const baseExisting = makeAppointment({
    id: "existing-1",
    start_at: "2026-05-04T13:00:00Z", // segunda 10:00 BRT
    end_at: "2026-05-04T14:00:00Z", // segunda 11:00 BRT
  });

  it("detecta sobreposicao real (mesmo user, mesmo periodo)", () => {
    const conflict = findScheduleConflict(
      {
        start_at: "2026-05-04T13:30:00Z", // 10:30 BRT
        end_at: "2026-05-04T14:30:00Z", // 11:30 BRT
        user_id: USER_A,
      },
      [baseExisting],
    );
    expect(conflict?.id).toBe("existing-1");
  });

  it("ignora appointment do proprio id (caso edicao)", () => {
    const conflict = findScheduleConflict(
      {
        id: "existing-1",
        start_at: "2026-05-04T13:00:00Z",
        end_at: "2026-05-04T14:00:00Z",
        user_id: USER_A,
      },
      [baseExisting],
    );
    expect(conflict).toBeUndefined();
  });

  it("ignora user diferente", () => {
    const conflict = findScheduleConflict(
      {
        start_at: "2026-05-04T13:30:00Z",
        end_at: "2026-05-04T14:30:00Z",
        user_id: USER_B,
      },
      [baseExisting],
    );
    expect(conflict).toBeUndefined();
  });

  it("ignora appointment cancelado/concluido (status nao bloqueante)", () => {
    const cancelled = makeAppointment({
      id: "cancelled-1",
      status: "cancelled",
      cancelled_at: "2026-05-04T12:00:00Z",
    });
    const completed = makeAppointment({
      id: "completed-1",
      status: "completed",
    });
    const noShow = makeAppointment({ id: "no-show-1", status: "no_show" });

    const conflict = findScheduleConflict(
      {
        start_at: "2026-05-04T13:30:00Z",
        end_at: "2026-05-04T14:30:00Z",
        user_id: USER_A,
      },
      [cancelled, completed, noShow],
    );
    expect(conflict).toBeUndefined();
  });

  it("ignora appointment soft-deleted", () => {
    const deleted = makeAppointment({
      id: "deleted-1",
      deleted_at: "2026-05-04T12:00:00Z",
    });
    const conflict = findScheduleConflict(
      {
        start_at: "2026-05-04T13:30:00Z",
        end_at: "2026-05-04T14:30:00Z",
        user_id: USER_A,
      },
      [deleted],
    );
    expect(conflict).toBeUndefined();
  });

  it("considera awaiting_confirmation E rescheduled como bloqueantes", () => {
    const awaiting = makeAppointment({
      id: "awaiting-1",
      status: "awaiting_confirmation",
    });
    expect(
      findScheduleConflict(
        {
          start_at: "2026-05-04T13:30:00Z",
          end_at: "2026-05-04T14:30:00Z",
          user_id: USER_A,
        },
        [awaiting],
      )?.id,
    ).toBe("awaiting-1");

    const rescheduled = makeAppointment({
      id: "resch-1",
      status: "rescheduled",
    });
    expect(
      findScheduleConflict(
        {
          start_at: "2026-05-04T13:30:00Z",
          end_at: "2026-05-04T14:30:00Z",
          user_id: USER_A,
        },
        [rescheduled],
      )?.id,
    ).toBe("resch-1");
  });

  it("borda: encostar end no start NAO conflita (semi-aberto)", () => {
    // existente: 13:00..14:00. candidato: 14:00..15:00. Nao deveria conflitar.
    const conflict = findScheduleConflict(
      {
        start_at: "2026-05-04T14:00:00Z",
        end_at: "2026-05-04T15:00:00Z",
        user_id: USER_A,
      },
      [baseExisting],
    );
    expect(conflict).toBeUndefined();
  });

  it("BUG REGRESSION: nao confunde dias diferentes mesma hora local", () => {
    // Bug original: getHours()*60 ignorava data. Dois agendamentos as
    // 10:00 BRT em dias diferentes pareciam conflitar.
    const segunda = makeAppointment({
      id: "segunda",
      start_at: "2026-05-04T13:00:00Z", // segunda 10:00 BRT
      end_at: "2026-05-04T14:00:00Z",
    });
    const conflict = findScheduleConflict(
      {
        start_at: "2026-05-08T13:00:00Z", // sexta 10:00 BRT
        end_at: "2026-05-08T14:00:00Z",
        user_id: USER_A,
      },
      [segunda],
    );
    expect(conflict).toBeUndefined();
  });

  it("BUG REGRESSION: detecta conflito mesmo com servidor em UTC", () => {
    // Bug original: rodando em UTC (servidor prod), getHours retornava
    // 13 (UTC) em vez de 10 (BRT), e a comparacao com "10:00..11:00" do
    // appointment existente nao batia → falso negativo.
    // Aqui forcamos: dois appointments cobrindo o MESMO instante UTC.
    const existing = makeAppointment({
      id: "existing-utc",
      start_at: "2026-05-04T13:00:00Z",
      end_at: "2026-05-04T14:00:00Z",
    });
    const conflict = findScheduleConflict(
      {
        start_at: "2026-05-04T13:30:00Z",
        end_at: "2026-05-04T14:30:00Z",
        user_id: USER_A,
      },
      [existing],
    );
    expect(conflict).toBeDefined();
  });

  it("rejeita end <= start", () => {
    expect(() =>
      findScheduleConflict(
        {
          start_at: "2026-05-04T14:00:00Z",
          end_at: "2026-05-04T13:00:00Z",
          user_id: USER_A,
        },
        [],
      ),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// isWithinAvailability — timezone-aware
// ---------------------------------------------------------------------------

describe("isWithinAvailability", () => {
  it("retorna true se rule eh undefined", () => {
    expect(
      isWithinAvailability(
        undefined,
        "2026-05-04T13:00:00Z",
        "2026-05-04T14:00:00Z",
      ),
    ).toBe(true);
  });

  it("aceita quando esta dentro do intervalo no fuso da rule", () => {
    const rule = fullWeekRule([{ start: "09:00", end: "18:00" }]);
    // segunda 10:00..11:00 BRT — dentro
    expect(
      isWithinAvailability(
        rule,
        "2026-05-04T13:00:00Z",
        "2026-05-04T14:00:00Z",
      ),
    ).toBe(true);
  });

  it("rejeita quando esta fora do intervalo", () => {
    const rule = fullWeekRule([{ start: "09:00", end: "18:00" }]);
    // segunda 19:00..20:00 BRT — fora
    expect(
      isWithinAvailability(
        rule,
        "2026-05-04T22:00:00Z",
        "2026-05-04T23:00:00Z",
      ),
    ).toBe(false);
  });

  it("rejeita dia desabilitado", () => {
    const rule = fullWeekRule([{ start: "09:00", end: "18:00" }]);
    // desabilita segunda
    rule.days[1]!.enabled = false;
    expect(
      isWithinAvailability(
        rule,
        "2026-05-04T13:00:00Z",
        "2026-05-04T14:00:00Z",
      ),
    ).toBe(false);
  });

  it("rejeita atravessar a meia-noite local", () => {
    const rule = fullWeekRule([{ start: "00:00", end: "24:00" }]);
    // 2026-05-05T02:00:00Z = segunda 23:00 BRT
    // 2026-05-05T04:00:00Z = terca 01:00 BRT — atravessa meia-noite
    expect(
      isWithinAvailability(
        rule,
        "2026-05-05T02:00:00Z",
        "2026-05-05T04:00:00Z",
      ),
    ).toBe(false);
  });

  it("BUG REGRESSION: nao usa hora do servidor", () => {
    // Bug original em servidor UTC: 13:00Z virava 13:00 (em vez de 10:00 BRT),
    // e regra "09:00..18:00 BRT" rejeitava porque 13 > 18 era falso, mas a
    // logica de span quebrava. Aqui forcamos: appointment 19:00..20:00 BRT
    // (= 22:00..23:00 UTC) deve ser rejeitado pela regra "09:00..18:00 BRT".
    const rule = fullWeekRule([{ start: "09:00", end: "18:00" }]);
    expect(
      isWithinAvailability(
        rule,
        "2026-05-04T22:00:00Z", // 19:00 BRT
        "2026-05-04T23:00:00Z", // 20:00 BRT
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAvailableSlots
// ---------------------------------------------------------------------------

describe("getAvailableSlots", () => {
  it("gera slots de hora em hora dentro do intervalo (segunda 09:00-12:00 BRT)", () => {
    const rule = fullWeekRule([{ start: "09:00", end: "12:00" }]);
    const slots = getAvailableSlots({
      date: "2026-05-04",
      rule,
      duration_minutes: 60,
      existing: [],
    });
    expect(slots.map((s) => s.display_time)).toEqual([
      "09:00",
      "10:00",
      "11:00",
    ]);
    // Primeiro slot: 09:00 BRT = 12:00 UTC
    expect(slots[0]?.start_at).toBe("2026-05-04T12:00:00.000Z");
    expect(slots[0]?.end_at).toBe("2026-05-04T13:00:00.000Z");
  });

  it("respeita buffer entre slots", () => {
    const rule = fullWeekRule([{ start: "09:00", end: "12:00" }]);
    const slots = getAvailableSlots({
      date: "2026-05-04",
      rule,
      duration_minutes: 60,
      buffer_minutes: 30,
      existing: [],
    });
    // 09:00..10:00, +30min buffer = 10:30..11:30. Cabe um terceiro? 12:00..13:00 nao cabe.
    expect(slots.map((s) => s.display_time)).toEqual(["09:00", "10:30"]);
  });

  it("filtra slots conflitantes", () => {
    const rule = fullWeekRule([{ start: "09:00", end: "12:00" }]);
    const conflicting = makeAppointment({
      id: "block-10",
      start_at: "2026-05-04T13:00:00Z", // 10:00 BRT
      end_at: "2026-05-04T14:00:00Z", // 11:00 BRT
      user_id: USER_A,
    });
    const slots = getAvailableSlots({
      date: "2026-05-04",
      rule,
      duration_minutes: 60,
      existing: [conflicting],
    });
    // 10:00 deveria sumir
    expect(slots.map((s) => s.display_time)).toEqual(["09:00", "11:00"]);
  });

  it("retorna vazio quando o dia esta desabilitado", () => {
    const rule = fullWeekRule([{ start: "09:00", end: "12:00" }]);
    rule.days[1]!.enabled = false; // segunda
    const slots = getAvailableSlots({
      date: "2026-05-04", // segunda
      rule,
      duration_minutes: 60,
      existing: [],
    });
    expect(slots).toEqual([]);
  });

  it("step_minutes diferente da duration permite slots sobrepostos descartaveis", () => {
    const rule = fullWeekRule([{ start: "09:00", end: "11:00" }]);
    const slots = getAvailableSlots({
      date: "2026-05-04",
      rule,
      duration_minutes: 60,
      step_minutes: 30,
      existing: [],
    });
    // 09:00..10:00, 09:30..10:30, 10:00..11:00
    expect(slots.map((s) => s.display_time)).toEqual([
      "09:00",
      "09:30",
      "10:00",
    ]);
  });

  it("rejeita date em formato invalido", () => {
    const rule = fullWeekRule([{ start: "09:00", end: "12:00" }]);
    expect(() =>
      getAvailableSlots({
        date: "04/05/2026",
        rule,
        duration_minutes: 60,
        existing: [],
      }),
    ).toThrow();
  });

  it("ignora appointment de outro user", () => {
    const rule = fullWeekRule([{ start: "09:00", end: "11:00" }], USER_A);
    const otherUser = makeAppointment({
      id: "other-user",
      user_id: USER_B,
      start_at: "2026-05-04T13:00:00Z",
      end_at: "2026-05-04T14:00:00Z",
    });
    const slots = getAvailableSlots({
      date: "2026-05-04",
      rule,
      duration_minutes: 60,
      existing: [otherUser],
    });
    expect(slots.map((s) => s.display_time)).toEqual(["09:00", "10:00"]);
  });
});
