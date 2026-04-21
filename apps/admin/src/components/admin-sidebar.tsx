"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { LogOut, MoreHorizontal, X } from "lucide-react";
import { signOut } from "@/actions/auth";
import { useClientStore } from "@/lib/stores/client-store";
import type { NavItem } from "@/lib/constants/navigation";

interface AppSidebarProps {
  items: NavItem[];
  mobileItems: NavItem[];
  brandAction: "panel" | "home";
}

export function AppSidebar({ items, mobileItems, brandAction }: AppSidebarProps) {
  const pathname = usePathname();
  const { togglePanel, panelOpen } = useClientStore();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

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

  // Close popover on route change
  useEffect(() => {
    setOpenMenu(null);
  }, [pathname]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMoreOpen(false);
  }, [pathname]);

  const mobileMoreItems = items.filter(
    (item) => !mobileItems.some((b) => b.href === item.href)
  );

  return (
    <>
    <aside className="hidden md:flex w-[72px] flex-col border-r border-border bg-[#090B1A] h-screen sticky top-0 items-center shrink-0 z-40">
      {/* Brand */}
      <div className="py-4 w-full flex justify-center">
        {brandAction === "panel" ? (
          <button onClick={togglePanel} title="Painel de clientes">
            <div className={`size-10 rounded-xl flex items-center justify-center transition-all ${
              panelOpen ? "bg-[#090B1A] ring-2 ring-primary" : "bg-[#090B1A] hover:opacity-90"
            }`}>
              <svg width="24" height="24" viewBox="0 0 40 40" fill="none" className="text-white dark:text-[#C9A84C]">
                <path d="M20 2L32 14L20 26L8 14Z" fill="none" stroke="currentColor" strokeWidth="1.8"/>
                <path d="M20 14L32 26L20 38L8 26Z" fill="none" stroke="currentColor" strokeWidth="1.8" opacity="0.5"/>
                <circle cx="20" cy="20" r="3" fill="currentColor"/>
              </svg>
            </div>
          </button>
        ) : (
          <Link href="/" title="Voltar ao inicio">
            <div className="size-10 rounded-xl flex items-center justify-center hover:opacity-90 transition-opacity bg-[#090B1A]">
              <svg width="24" height="24" viewBox="0 0 40 40" fill="none" className="text-white dark:text-[#C9A84C]">
                <path d="M20 2L32 14L20 26L8 14Z" fill="none" stroke="currentColor" strokeWidth="1.8"/>
                <path d="M20 14L32 26L20 38L8 26Z" fill="none" stroke="currentColor" strokeWidth="1.8" opacity="0.5"/>
                <circle cx="20" cy="20" r="3" fill="currentColor"/>
              </svg>
            </div>
          </Link>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 flex flex-col items-center gap-0.5 w-full" ref={popoverRef}>
        {items.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href + "/")) ||
            (item.href !== "/" && pathname === item.href) ||
            item.children?.some((c) => pathname === c.href || pathname.startsWith(c.href + "/"));
          const isPopoverOpen = openMenu === item.label;

          return (
            <div key={item.label} className="relative w-full flex justify-center">
              {item.children ? (
                <button
                  onClick={() => setOpenMenu(openMenu === item.label ? null : item.label)}
                  className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-xl w-[60px] transition-colors duration-150 ${
                    isActive ? "text-primary" : "text-white hover:text-blue-400 hover:bg-white/10"
                  }`}
                >
                  <Icon className="size-5" />
                  <span className="text-[10px] font-medium leading-tight">{item.label}</span>
                </button>
              ) : (
                <Link
                  href={item.href}
                  onClick={() => setOpenMenu(null)}
                  className={`relative flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-xl w-[60px] transition-colors duration-150 ${
                    isActive ? "text-primary" : "text-white hover:text-blue-400 hover:bg-white/10"
                  }`}
                >
                  <Icon className="size-5" />
                  <span className="text-[10px] font-medium leading-tight">{item.label}</span>
                </Link>
              )}

              {/* Flyout submenu */}
              {item.children && isPopoverOpen && (
                <div
                  className="fixed z-[9999] min-w-[170px] rounded-lg border border-border bg-card shadow-lg py-1"
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
                      onClick={() => setOpenMenu(null)}
                      className={`block px-3 py-1.5 text-sm transition-colors duration-150 hover:bg-muted ${
                        pathname === child.href || pathname.startsWith(child.href + "/")
                          ? "text-primary font-medium"
                          : "text-foreground"
                      }`}
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
      <div className="py-3 flex flex-col items-center gap-2">
        <div className="size-2 rounded-full bg-green-500 animate-pulse" title="Online" />
      </div>
    </aside>

    {/* Mobile bottom navigation */}
    <nav className="flex md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[#090B1A] border-t border-border z-50 items-center justify-around px-2">
      {mobileItems.map((item) => {
        const Icon = item.icon;
        const isActive =
          pathname === item.href ||
          (item.href !== "/" && pathname.startsWith(item.href + "/"));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center justify-center gap-0.5 py-1 px-3 rounded-lg transition-colors ${
              isActive ? "text-primary" : "text-white"
            }`}
          >
            <Icon className="size-5" />
            <span className="text-[10px] font-medium">{item.label}</span>
          </Link>
        );
      })}
      <button
        onClick={() => setMobileMoreOpen(true)}
        className={`flex flex-col items-center justify-center gap-0.5 py-1 px-3 rounded-lg transition-colors ${
          mobileMoreOpen ? "text-primary" : "text-white"
        }`}
      >
        <MoreHorizontal className="size-5" />
        <span className="text-[10px] font-medium">Mais</span>
      </button>
    </nav>

    {/* Mobile "More" overlay */}
    {mobileMoreOpen && (
      <div className="fixed inset-0 z-[60] flex md:hidden flex-col justify-end">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/60"
          onClick={() => setMobileMoreOpen(false)}
        />
        {/* Sheet */}
        <div className="relative bg-[#090B1A] border-t border-border rounded-t-2xl max-h-[70vh] overflow-y-auto pb-20">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <span className="text-sm font-semibold text-white">Menu</span>
            <button onClick={() => setMobileMoreOpen(false)} aria-label="Fechar menu" className="text-[#666] hover:text-white">
              <X className="size-5" />
            </button>
          </div>
          <div className="py-2">
            {mobileMoreItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href + "/")) ||
                item.children?.some((c) => pathname === c.href || pathname.startsWith(c.href + "/"));
              return (
                <div key={item.label}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-3 px-5 py-3 transition-colors ${
                      isActive ? "text-primary" : "text-white"
                    }`}
                  >
                    <Icon className="size-5" />
                    <span className="text-sm font-medium">{item.label}</span>
                  </Link>
                  {item.children && (
                    <div className="ml-12 border-l border-border mb-1">
                      {item.children.map((child) => {
                        const childActive = pathname === child.href || pathname.startsWith(child.href + "/");
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            className={`block px-4 py-2 text-sm transition-colors ${
                              childActive ? "text-primary font-medium" : "text-[#A6A6A6]"
                            }`}
                          >
                            {child.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* Sign out */}
          <div className="border-t border-border px-5 py-3">
            <button
              onClick={() => signOut()}
              className="flex items-center gap-3 text-[#666] hover:text-red-500 transition-colors"
            >
              <LogOut className="size-5" />
              <span className="text-sm font-medium">Sair</span>
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
