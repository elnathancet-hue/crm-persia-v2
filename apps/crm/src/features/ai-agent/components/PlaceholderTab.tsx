import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Props {
  icon: LucideIcon;
  title: string;
  description: string;
  phase: string;
}

export function PlaceholderTab({ icon: Icon, title, description, phase }: Props) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 flex flex-col items-center text-center gap-4">
        <div className="size-14 rounded-2xl bg-muted flex items-center justify-center">
          <Icon className="size-7 text-muted-foreground" />
        </div>
        <div className="space-y-1 max-w-md">
          <div className="flex items-center justify-center gap-2">
            <h2 className="font-semibold">{title}</h2>
            <Badge variant="outline" className="text-xs">
              Em breve · {phase}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}
