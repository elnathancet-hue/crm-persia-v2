import {
  ArrowRightCircle,
  AudioLines,
  BellRing,
  Bot,
  Building2,
  CalendarPlus,
  FolderInput,
  HelpCircle,
  Package,
  PowerOff,
  Repeat,
  Shuffle,
  Tag,
  UserCheck,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";
import * as React from "react";

const ICONS: Record<string, LucideIcon> = {
  ArrowRightCircle,
  AudioLines,
  BellRing,
  Bot,
  Building2,
  CalendarPlus,
  FolderInput,
  Package,
  PowerOff,
  Repeat,
  Shuffle,
  Tag,
  UserCheck,
};

// Stable lookup from preset.icon_name → lucide-react component. Falls back to
// HelpCircle when the name is unknown. Returned as a React element to satisfy
// the "no components created during render" lint rule while keeping the API
// ergonomic for callers.
export function renderToolIcon(iconName: string, props?: LucideProps): React.ReactElement {
  const Icon = ICONS[iconName] ?? HelpCircle;
  return React.createElement(Icon, props);
}
