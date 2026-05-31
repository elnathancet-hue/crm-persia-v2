"use client";

import { Copy, ExternalLink, MessageCircle, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@persia/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@persia/ui/avatar";
import { Badge } from "@persia/ui/badge";
import { TagBadge } from "@persia/tags-ui";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TagEntry {
  tag_id: string;
  tags: { id: string; name: string; color: string } | null;
}

export interface LeadContactData {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  status: string | null;
  source: string | null;
  created_at: string;
  assigned_to?: string | null;
  lead_tags?: TagEntry[];
}

interface LeadContactPanelProps {
  lead: LeadContactData;
  onClose: () => void;
}

// ─── Label maps ──────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  new: "Novo",
  contacted: "Contactado",
  qualified: "Qualificado",
  customer: "Cliente",
  lost: "Perdido",
};

// Maps status → Badge variant for visual hierarchy
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  new: "secondary",
  contacted: "secondary",
  qualified: "default",
  customer: "default",
  lost: "destructive",
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  whatsapp: "WhatsApp",
  website: "Website",
  instagram: "Instagram",
  facebook: "Facebook",
  indicacao: "Indicação",
  outro: "Outro",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name: string | null | undefined) {
  if (!name) return "?";
  return name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatPhone(phone: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 13) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  return phone;
}

// ─── Row component ────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
        {label}
      </span>
      <span className="text-sm text-foreground break-all">{value || "—"}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LeadContactPanel({ lead, onClose }: LeadContactPanelProps) {
  const tags = (lead.lead_tags ?? [])
    .map((lt) => lt.tags)
    .filter(Boolean) as { id: string; name: string; color: string }[];

  const responsavel =
    lead.assigned_to === null || lead.assigned_to === undefined
      ? null
      : lead.assigned_to === "ai"
        ? "IA"
        : lead.assigned_to;

  function handleCopyData() {
    const lines = [
      `Nome: ${lead.name || "—"}`,
      `Celular: ${lead.phone || "—"}`,
      `E-mail: ${lead.email || "—"}`,
      `Status: ${STATUS_LABEL[lead.status ?? ""] || lead.status || "—"}`,
    ];
    if (responsavel) lines.push(`Responsável: ${responsavel}`);
    navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Dados copiados");
  }

  function handleWhatsApp() {
    if (!lead.phone) return;
    const digits = lead.phone.replace(/\D/g, "");
    window.open(`https://wa.me/${digits}`, "_blank");
  }

  return (
    <div className="flex h-full flex-col bg-background overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Detalhes do contato
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label="Fechar painel"
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Identity block: avatar + name + phone + status badges */}
      <div className="flex flex-col items-center gap-3 px-5 pt-6 pb-5 border-b border-border/50">
        <Avatar size="lg">
          {lead.avatar_url && (
            <AvatarImage src={lead.avatar_url} alt={lead.name ?? undefined} />
          )}
          <AvatarFallback className="text-base">
            {getInitials(lead.name)}
          </AvatarFallback>
        </Avatar>

        <div className="text-center">
          <p className="font-semibold text-[16px] leading-tight">
            {lead.name || "Sem nome"}
          </p>
          {lead.phone && (
            <p className="text-sm text-muted-foreground mt-1">
              {formatPhone(lead.phone)}
            </p>
          )}
        </div>

        {/* Status + source chips */}
        {(lead.status || lead.source) && (
          <div className="flex flex-wrap gap-1.5 justify-center">
            {lead.status && (
              <Badge variant={STATUS_VARIANT[lead.status] ?? "secondary"} className="text-xs">
                {STATUS_LABEL[lead.status] || lead.status}
              </Badge>
            )}
            {lead.source && (
              <Badge variant="outline" className="text-xs">
                {SOURCE_LABEL[lead.source] || lead.source}
              </Badge>
            )}
          </div>
        )}

        {/* WhatsApp — primary CTA */}
        {lead.phone && (
          <Button
            className="w-full gap-2"
            size="sm"
            onClick={handleWhatsApp}
          >
            <MessageCircle className="size-4" />
            Enviar WhatsApp
          </Button>
        )}

        {/* Secondary actions */}
        <div className="flex w-full gap-2">
          {lead.id && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5 text-xs"
              onClick={() => window.open(`/leads/${lead.id}`, "_blank")}
            >
              <ExternalLink className="size-3.5" />
              Ver lead
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5 text-xs"
            onClick={handleCopyData}
          >
            <Copy className="size-3.5" />
            Copiar dados
          </Button>
        </div>
      </div>

      {/* Contato section — omite campos vazios */}
      <div className="px-4 py-4 border-b border-border/50 space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Contato
        </p>
        <InfoRow label="Celular" value={formatPhone(lead.phone)} />
        {lead.email && <InfoRow label="E-mail" value={lead.email} />}
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Responsável
          </span>
          {responsavel ? (
            <span className="text-sm text-foreground">{responsavel}</span>
          ) : (
            <span className="text-sm text-warning">Não atribuído</span>
          )}
        </div>
      </div>

      {/* Tags section — só aparece se houver tags */}
      {tags.length > 0 && (
        <div className="px-4 py-4 border-b border-border/50 space-y-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Tags
          </p>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <TagBadge key={tag.id} tag={tag} />
            ))}
          </div>
        </div>
      )}

      {/* Datas */}
      <div className="px-4 py-4 space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Datas
        </p>
        <InfoRow label="Adicionado em" value={formatDate(lead.created_at)} />
      </div>
    </div>
  );
}
