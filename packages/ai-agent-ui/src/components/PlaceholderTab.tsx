import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@persia/ui/card";
import { Badge } from "@persia/ui/badge";

interface Props {
  icon: LucideIcon;
  title: string;
  description: string;
  /**
   * @deprecated Internal phase tag — no longer rendered. Kept on the
   * interface so callers don't need to update right away.
   */
  phase?: string;
}

export function PlaceholderTab({ icon: Icon, title, description }: Props) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 flex flex-col items-center text-center gap-4">
        <div className="size-14 rounded-2xl bg-muted flex items-center justify-center">
          <Icon className="size-7 text-muted-foreground" />
        </div>
        <div className="space-y-1 max-w-md">
          <div className="flex items-center justify-center gap-2">
            <h2 className="font-semibold tracking-tight">{title}</h2>
            <Badge variant="outline" className="text-xs">
              Em breve
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}
