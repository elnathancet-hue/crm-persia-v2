"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { navigation } from "@/lib/constants/navigation";
import { useRole } from "@/lib/hooks/use-role";
import { useUser } from "@/lib/hooks/use-user";
import { signOut } from "@/actions/auth";
import { Sheet, SheetContent } from "@persia/ui/sheet";
import { LogOut, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

// Items NOT in the primary bottom bar go in the drawer
const PRIMARY_HREFS = ["/dashboard", "/chat", "/crm", "/agenda"];

interface MobileNavDrawerProps {
  open: boolean;
  onClose: () => void;
  groupsUnreadCount: number;
}

export function MobileNavDrawer({ open, onClose, groupsUnreadCount }: MobileNavDrawerProps) {
  const pathname = usePathname();
  const { canAccess, canAccessModule } = useRole();
  const { profile } = useUser();
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const secondaryItems = useMemo(
    () =>
      navigation.filter(
        (item) =>
          !PRIMARY_HREFS.includes(item.href) &&
          canAccess(item.minRole ?? "viewer") &&
          (item.module === undefined || canAccessModule(item.module)),
      ),
    [canAccess, canAccessModule],
  );

  function handleLinkClick() {
    setExpandedItem(null);
    onClose();
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl px-0 pb-safe pt-0 max-h-[85dvh] overflow-y-auto" showCloseButton={false}>
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* User info */}
        {profile && (
          <div className="px-4 py-3 border-b">
            <p className="text-sm font-semibold text-foreground">{profile.full_name || "Usuário"}</p>
          </div>
        )}

        {/* Secondary nav items */}
        <nav className="py-2">
          {secondaryItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              pathname.startsWith(item.href + "/") ||
              item.children?.some(
                (c) => pathname === c.href || pathname.startsWith(c.href + "/")
              );
            const badge =
              item.href === "/groups" && groupsUnreadCount > 0
                ? groupsUnreadCount
                : 0;
            const isExpanded = expandedItem === item.label;

            if (item.children) {
              return (
                <div key={item.href}>
                  <button
                    onClick={() =>
                      setExpandedItem(isExpanded ? null : item.label)
                    }
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors",
                      isActive ? "text-primary" : "text-foreground"
                    )}
                  >
                    <Icon className="size-5 shrink-0" />
                    <span className="flex-1 text-left font-medium">
                      {item.label}
                    </span>
                    <ChevronRight
                      className={cn(
                        "size-4 text-muted-foreground transition-transform duration-150",
                        isExpanded && "rotate-90"
                      )}
                    />
                  </button>
                  {isExpanded && (
                    <div className="bg-muted/30 border-y">
                      {item.children.map((child) => {
                        const childActive =
                          pathname === child.href ||
                          pathname.startsWith(child.href + "/");
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            onClick={handleLinkClick}
                            className={cn(
                              "block pl-12 pr-4 py-2.5 text-sm transition-colors",
                              childActive
                                ? "text-primary font-medium"
                                : "text-foreground"
                            )}
                          >
                            {child.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={handleLinkClick}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 text-sm transition-colors",
                  isActive ? "text-primary" : "text-foreground"
                )}
              >
                <Icon className="size-5 shrink-0" />
                <span className="flex-1 font-medium">{item.label}</span>
                {badge > 0 && (
                  <span
                    className="min-w-[20px] h-5 rounded-full text-[10px] font-bold flex items-center justify-center px-1"
                    style={{
                      background: "var(--badge-notification)",
                      color: "var(--badge-notification-fg)",
                    }}
                  >
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Sign out */}
        <div className="border-t mx-4 mt-1 pt-2 pb-4">
          <button
            onClick={() => { onClose(); signOut(); }}
            className="flex items-center gap-3 px-0 py-3 text-sm text-destructive w-full transition-colors"
          >
            <LogOut className="size-5 shrink-0" />
            <span className="font-medium">Sair</span>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
