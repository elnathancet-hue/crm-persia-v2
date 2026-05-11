"use client";

import { AppSidebar } from "@/components/admin-sidebar";
import { ClientBanner } from "@/components/client-banner";
import { HeaderOrgBadge } from "@/components/header-org-badge";
import { HeaderUserMenu } from "@/components/header-user-menu";
import { AdminRealtimeMount } from "@/components/admin-realtime-mount";
import { clientNavigation, clientMobileItems } from "@/lib/constants/navigation";

export function ClientShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* PR-S3: monta listeners de realtime (toasts globais) so
          enquanto admin esta em modo cliente. Em modo admin puro
          nao ha org pra escutar. */}
      <AdminRealtimeMount />

      {/* Left sidebar - full CRM navigation */}
      <AppSidebar items={clientNavigation} mobileItems={clientMobileItems} brandAction="home" />

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Banner when accessing client account */}
        <ClientBanner />

        {/* Header */}
        <header className="h-14 border-b border-border bg-card flex items-center justify-between px-6 shrink-0">
          <div className="flex flex-col">
            <div className="flex items-baseline gap-0.5">
              <span className="text-sm font-bold tracking-tight text-foreground">Persia</span>
              <span className="text-sm font-bold tracking-tight text-primary">CRM</span>
            </div>
            <span className="text-[10px] text-muted-foreground">Modo conta</span>
          </div>
          <div className="flex items-center gap-3">
            <HeaderOrgBadge />
            <HeaderUserMenu />
          </div>
        </header>

        <main id="main-content" className="flex-1 overflow-y-auto p-6 pb-20 md:pb-6">{children}</main>
      </div>
    </>
  );
}
