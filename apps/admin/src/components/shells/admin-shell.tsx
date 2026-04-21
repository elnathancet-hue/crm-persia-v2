"use client";

import { AppSidebar } from "@/components/admin-sidebar";
import { ClientSidebar } from "@/components/client-sidebar";
import { HeaderOrgBadge } from "@/components/header-org-badge";
import { HeaderUserMenu } from "@/components/header-user-menu";
import { adminNavigation, adminMobileItems } from "@/lib/constants/navigation";

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Left sidebar - admin navigation (short) */}
      <AppSidebar items={adminNavigation} mobileItems={adminMobileItems} brandAction="panel" />

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-14 border-b border-border bg-card flex items-center justify-between px-6 shrink-0">
          <div className="flex flex-col">
            <div className="flex items-baseline gap-0.5">
              <span className="text-sm font-bold tracking-tight text-foreground">Persia</span>
              <span className="text-sm font-bold tracking-tight text-primary">CRM</span>
              <span className="text-[10px] font-medium text-primary/60 ml-1">ADMIN</span>
            </div>
            <span className="text-[10px] text-muted-foreground">Painel administrativo</span>
          </div>
          <div className="flex items-center gap-3">
            <HeaderOrgBadge />
            <HeaderUserMenu />
          </div>
        </header>

        <main id="main-content" className="flex-1 overflow-y-auto p-6 pb-20 md:pb-6">{children}</main>
      </div>

      {/* Right sidebar - client accounts */}
      <ClientSidebar />
    </>
  );
}
