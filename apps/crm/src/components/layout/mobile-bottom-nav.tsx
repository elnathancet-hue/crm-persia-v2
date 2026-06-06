"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { navigation } from "@/lib/constants/navigation";
import { useUnreadCount } from "@/lib/hooks/use-unread-count";
import { useGroupsUnreadCount } from "@/lib/hooks/use-groups-unread-count";
import { MoreHorizontal } from "lucide-react";
import { MobileNavDrawer } from "./mobile-nav-drawer";
import { useEffect, useState } from "react";

// Primary tabs always visible in bottom bar
const PRIMARY_HREFS = ["/dashboard", "/chat", "/crm", "/agenda"];

export function MobileBottomNav() {
  const pathname = usePathname();
  const unreadCount = useUnreadCount();
  const groupsUnreadCount = useGroupsUnreadCount();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // PR-HYDRATION: @base-ui/react (Sheet/Dialog) gera IDs diferentes no SSR
  // vs client — mesmo bug do DropdownMenu no Header. Nao renderiza o
  // MobileNavDrawer (que usa Sheet) ate hidratar, evitando crash.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const primaryItems = navigation.filter((item) =>
    PRIMARY_HREFS.includes(item.href)
  );

  return (
    <>
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 h-16 border-t bg-card flex items-stretch">
        {primaryItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const badge =
            item.badge && unreadCount > 0
              ? unreadCount
              : item.href === "/groups" && groupsUnreadCount > 0
                ? groupsUnreadCount
                : 0;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-0.5 relative transition-colors duration-150",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground active:text-foreground"
              )}
            >
              <div className="relative">
                <Icon className="size-5" />
                {badge > 0 && (
                  <span
                    className="absolute -top-1 -right-1.5 min-w-[16px] h-4 rounded-full text-[9px] font-bold flex items-center justify-center px-0.5"
                    style={{
                      background: "var(--badge-notification)",
                      color: "var(--badge-notification-fg)",
                    }}
                  >
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium leading-tight">
                {item.label}
              </span>
            </Link>
          );
        })}

        {/* "Mais" button — opens bottom drawer */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 text-muted-foreground active:text-foreground transition-colors duration-150"
        >
          <MoreHorizontal className="size-5" />
          <span className="text-[10px] font-medium leading-tight">Mais</span>
        </button>
      </nav>

      {mounted && <MobileNavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />}
    </>
  );
}
