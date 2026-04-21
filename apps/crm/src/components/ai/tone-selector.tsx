"use client";

import { cn } from "@/lib/utils";
import { Briefcase, Smile, Coffee } from "lucide-react";

interface ToneSelectorProps {
  value: string;
  onChange: (tone: string) => void;
}

const TONES = [
  {
    id: "formal",
    label: "Formal",
    description: "Linguagem profissional e respeitosa",
    icon: Briefcase,
  },
  {
    id: "amigavel",
    label: "Amigável",
    description: "Próximo e acolhedor",
    icon: Smile,
  },
  {
    id: "casual",
    label: "Casual",
    description: "Descontraído e informal",
    icon: Coffee,
  },
];

export function ToneSelector({ value, onChange }: ToneSelectorProps) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {TONES.map((tone) => {
        const Icon = tone.icon;
        const isSelected = value === tone.id;

        return (
          <button
            key={tone.id}
            type="button"
            onClick={() => onChange(tone.id)}
            className={cn(
              "flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all",
              isSelected
                ? "border-primary bg-primary/5"
                : "border-transparent bg-muted/50 hover:bg-muted"
            )}
          >
            <div
              className={cn(
                "flex size-10 items-center justify-center rounded-full",
                isSelected ? "bg-primary text-primary-foreground" : "bg-muted-foreground/10 text-muted-foreground"
              )}
            >
              <Icon className="size-5" />
            </div>
            <div>
              <p className={cn("text-sm font-medium", isSelected && "text-primary")}>
                {tone.label}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {tone.description}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
