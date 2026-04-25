import "server-only";

import { CronExpressionParser } from "cron-parser";

export const SCHEDULER_DEFAULT_TIMEZONE = "UTC";

export function computeNextScheduledRunAt(
  cronExpr: string,
  currentDate: Date | string | number = new Date(),
  timezone = SCHEDULER_DEFAULT_TIMEZONE,
): string {
  const expression = CronExpressionParser.parse(cronExpr, {
    currentDate,
    tz: timezone,
  });

  return expression.next().toDate().toISOString();
}
