"use client";

import * as React from "react";
import Image from "next/image";
import { Users, MessageCircle, Loader2, ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { recordGroupJoin, type SmartLinkResolution } from "@/actions/groups";

interface Props {
  resolution: SmartLinkResolution;
  orgSlug: string;
  campaignSlug: string;
  utms: Record<string, string>;
}

export function SmartLinkClient({ resolution, utms }: Props) {
  const { status, organizationId, campaign, organization, group } = resolution;

  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState("");

  // Auto-redirect if status ok and no capture needed (fast path)
  // We always show the form to capture lead data before redirect

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!group) return;
    setLoading(true);
    setError("");
    try {
      await recordGroupJoin({
        organizationId,
        groupId: group.id,
        campaignId: campaign.id,
        phone: phone.trim() || undefined,
        name: name.trim() || undefined,
        utmSource: utms.utm_source,
        utmMedium: utms.utm_medium,
        utmCampaign: utms.utm_campaign,
        utmContent: utms.utm_content,
        utmTerm: utms.utm_term,
      });
      setDone(true);
      // Redirect to WhatsApp after short delay
      setTimeout(() => {
        window.location.href = group.invite_link;
      }, 800);
    } catch {
      setError("Erro ao registrar. Tente novamente.");
      setLoading(false);
    }
  }

  function handleDirectJoin() {
    if (!group) return;
    setLoading(true);
    window.location.href = group.invite_link;
  }

  // ─── Inactive / Not found ────────────────────────────────────────────────
  if (status === "inactive") {
    return <StatusScreen icon="🔒" title="Campanha desativada" description={campaign.fallback_message ?? "Este link não está ativo no momento."} />;
  }

  // ─── All groups full ─────────────────────────────────────────────────────
  if (status === "full") {
    return (
      <StatusScreen
        icon="😕"
        title="Grupos lotados"
        description={campaign.fallback_message ?? "Todos os grupos estão lotados no momento."}
        action={
          campaign.fallback_url ? (
            <Button className="rounded-full" render={<a href={campaign.fallback_url} />}>
              Continuar <ArrowRight className="size-4" />
            </Button>
          ) : undefined
        }
        org={organization}
      />
    );
  }

  // ─── Success state (after submit) ────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center">
        <CheckCircle2 className="size-16 text-success mb-4" />
        <h1 className="text-xl font-semibold">Redirecionando para o grupo...</h1>
        <p className="text-muted-foreground text-sm mt-2">Abrindo o WhatsApp em instantes.</p>
      </div>
    );
  }

  // ─── Main form ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        {/* Org branding */}
        <div className="flex flex-col items-center mb-8 text-center">
          {organization.logo_url ? (
            <Image
              src={organization.logo_url}
              alt={organization.name}
              width={64}
              height={64}
              className="size-16 rounded-2xl object-cover mb-3 shadow-sm"
            />
          ) : (
            <div className="size-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
              <Users className="size-8 text-primary" />
            </div>
          )}
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{organization.name}</p>
          <h1 className="text-2xl font-bold mt-1">{campaign.name}</h1>
          {campaign.description && (
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{campaign.description}</p>
          )}
        </div>

        {/* Group info */}
        <div className="flex items-center gap-3 rounded-2xl bg-muted/40 px-4 py-3 mb-6">
          <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <MessageCircle className="size-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">{group!.name}</p>
            <p className="text-xs text-muted-foreground">Grupo do WhatsApp</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleJoin} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Seu nome <span className="opacity-60">(opcional)</span>
            </Label>
            <Input
              type="text"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Maria Silva"
              autoComplete="name"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Seu WhatsApp <span className="opacity-60">(opcional)</span>
            </Label>
            <Input
              type="tel"
              name="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(11) 99999-9999"
              autoComplete="tel"
              inputMode="tel"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button
            type="submit"
            disabled={loading}
            className="w-full rounded-full mt-2"
            size="lg"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <>
                Entrar no Grupo <ArrowRight className="size-4" />
              </>
            )}
          </Button>
        </form>

        {/* Skip form */}
        <Button
          variant="ghost"
          onClick={handleDirectJoin}
          className="w-full mt-3 text-xs text-muted-foreground underline underline-offset-2"
        >
          Entrar sem informar dados
        </Button>

        <p className="text-center text-[11px] text-muted-foreground/60 mt-6 leading-relaxed">
          Ao entrar, você concorda em participar do grupo e receber mensagens relacionadas a este produto/serviço.
        </p>
      </div>
    </div>
  );
}

// ─── Helper: status screens ───────────────────────────────────────────────────

function StatusScreen({
  icon,
  title,
  description,
  action,
  org,
}: {
  icon: string;
  title: string;
  description: string;
  action?: React.ReactNode;
  org?: { name: string; logo_url: string | null };
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center gap-3">
      {org && <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">{org.name}</p>}
      <p className="text-5xl">{icon}</p>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">{description}</p>
      {action}
    </div>
  );
}
