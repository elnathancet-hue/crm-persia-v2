"use client";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ScheduleData {
  start: string;
  end: string;
  days: number[];
}

interface ScheduleConfigProps {
  value: ScheduleData;
  onChange: (schedule: ScheduleData) => void;
}

const DAYS = [
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sab" },
  { value: 0, label: "Dom" },
];

export function ScheduleConfig({ value, onChange }: ScheduleConfigProps) {
  function toggleDay(day: number) {
    const newDays = value.days.includes(day)
      ? value.days.filter((d) => d !== day)
      : [...value.days, day].sort((a, b) => a - b);
    onChange({ ...value, days: newDays });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="schedule-start">Inicio</Label>
          <Input
            id="schedule-start"
            type="time"
            value={value.start}
            onChange={(e) => onChange({ ...value, start: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="schedule-end">Fim</Label>
          <Input
            id="schedule-end"
            type="time"
            value={value.end}
            onChange={(e) => onChange({ ...value, end: e.target.value })}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Dias de funcionamento</Label>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((day) => {
            const isActive = value.days.includes(day.value);
            return (
              <button
                key={day.value}
                type="button"
                onClick={() => toggleDay(day.value)}
                className={cn(
                  "flex size-10 items-center justify-center rounded-lg border-2 text-sm font-medium transition-all",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                )}
              >
                {day.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
