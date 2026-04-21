"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { navigation } from "@/lib/constants/navigation";
import { useUnreadCount } from "@/lib/hooks/use-unread-count";
import { useTabTitleBadge } from "@/lib/hooks/use-notification";
import { useRole } from "@/lib/hooks/use-role";
import { useState, useRef, useEffect, useMemo } from "react";

export function Sidebar() {
  const pathname = usePathname();
  const { canAccess, loading: roleLoading } = useRole();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const unreadCount = useUnreadCount();
  const { setUnreadCount } = useTabTitleBadge();

  // Filter navigation items by role — items without minRole are visible to all
  const visibleNav = useMemo(
    () => navigation.filter((item) => canAccess(item.minRole ?? "viewer")),
    [canAccess]
  );

  // Sync unread count to tab title
  useEffect(() => {
    setUnreadCount(unreadCount);
  }, [unreadCount, setUnreadCount]);

  // Close popover on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Close flyout submenu on Escape key
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape" && openMenu) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [openMenu]);

  // Close popover on route change
  useEffect(() => {
    setOpenMenu(null);
  }, [pathname]);

  function handleItemClick(item: typeof navigation[0]) {
    if (item.children) {
      setOpenMenu(openMenu === item.label ? null : item.label);
    } else {
      setOpenMenu(null);
    }
  }

  return (
    <aside className="hidden md:flex w-[72px] flex-col border-r bg-sidebar h-screen sticky top-0 items-center shrink-0 z-40">
      {/* Brand — PérsiaCRM */}
      <div className="py-4 w-full flex justify-center">
        <Link href="/dashboard">
          <div className="size-10 rounded-xl flex items-center justify-center hover:opacity-90 transition-opacity bg-sidebar-accent text-[#090B1A] dark:text-[#C9A84C]">
            <svg width="24" height="24" viewBox="0 0 40 40" fill="none">
              <path d="M20 2L32 14L20 26L8 14Z" fill="none" stroke="currentColor" strokeWidth="1.8"/>
              <path d="M20 14L32 26L20 38L8 26Z" fill="none" stroke="currentColor" strokeWidth="1.8" opacity="0.5"/>
              <circle cx="20" cy="20" r="3" fill="currentColor"/>
            </svg>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 flex flex-col items-center gap-0.5 w-full" ref={popoverRef}>
        {roleLoading ? (
          /* Skeleton while role is loading — prevents flashing wrong menu */
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-[60px] h-[44px] rounded-xl bg-sidebar-accent/30 animate-pulse" />
          ))
        ) : visibleNav.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            pathname.startsWith(item.href + "/") ||
            item.children?.some((c) => pathname === c.href || pathname.startsWith(c.href + "/"));
          const isPopoverOpen = openMenu === item.label;

          return (
            <div key={item.label} className="relative w-full flex justify-center">
              {/* Nav item - icon + label */}
              {item.children ? (
                <button
                  onClick={() => handleItemClick(item)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-xl w-[60px] transition-colors duration-150",
                    isActive
                      ? "text-primary"
                      : "text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                  )}
                >
                  <Icon className="size-5" />
                  <span className="text-[10px] font-medium leading-tight">{item.label}</span>
                </button>
              ) : (
                <Link
                  href={item.href}
                  onClick={() => setOpenMenu(null)}
                  className={cn(
                    "relative flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-xl w-[60px] transition-colors duration-150",
                    isActive
                      ? "text-primary"
                      : "text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                  )}
                >
                  <Icon className="size-5" />
                  <span className="text-[10px] font-medium leading-tight">{item.label}</span>
                  {item.badge && unreadCount > 0 && (
                    <span className="absolute top-1 right-1 size-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </Link>
              )}

              {/* Flyout sub-menu */}
              {item.children && isPopoverOpen && (
                <div
                  role="menu"
                  className="fixed z-[9999] min-w-[170px] rounded-lg border bg-card shadow-lg py-1 ring-1 ring-black/5 dark:ring-white/10"
                  ref={(el) => {
                    if (el) {
                      const parent = el.parentElement;
                      if (parent) {
                        const rect = parent.getBoundingClientRect();
                        el.style.top = `${rect.top}px`;
                        el.style.left = `${73}px`;
                        const elRect = el.getBoundingClientRect();
                        if (elRect.bottom > window.innerHeight) {
                          el.style.top = `${window.innerHeight - elRect.height - 8}px`;
                        }
                      }
                    }
                  }}
                >
                  {item.children.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      role="menuitem"
                      onClick={() => setOpenMenu(null)}
                      className={cn(
                        "block px-3 py-1.5 text-sm transition-colors duration-150 hover:bg-accent",
                        pathname === child.href || pathname.startsWith(child.href + "/")
                          ? "text-primary font-medium"
                          : "text-popover-foreground"
                      )}
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="py-3">
        <div className="size-2 rounded-full bg-green-500 animate-pulse" />
      </div>
    </aside>
  );
}
