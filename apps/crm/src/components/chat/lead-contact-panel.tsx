"use client";

import { Copy, ExternalLink, MessageCircle, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@persia/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@persia/ui/avatar";
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
  // Remove non-digits
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 13) {
    // +55 (XX) XXXXX-XXXX
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
    <div className="flex h-full w-[280px] shrink-0 flex-col border-l border-[color:var(--chat-sidebar-divider)] bg-background overflow-y-auto">
      {/* Header row with close button */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
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

      {/* Avatar + name block */}
      <div className="flex flex-col items-center gap-2 px-4 py-5 border-b border-border/50">
        <Avatar size="lg">
          {lead.avatar_url && (
            <AvatarImage src={lead.avatar_url} alt={lead.name ?? undefined} />
          )}
          <AvatarFallback className="text-base">
            {getInitials(lead.name)}
          </AvatarFallback>
        </Avatar>
        <div className="text-center">
          <p className="font-semibold text-[15px] leading-tight">
            {lead.name || "Sem nome"}
          </p>
          {lead.phone && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {formatPhone(lead.phone)}
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mt-1">
          {lead.id && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => window.open(`/leads/${lead.id}`, "_blank")}
            >
              <ExternalLink className="size-3" />
              Ver lead
            </Button>
          )}
          {lead.phone && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={handleWhatsApp}
            >
              <MessageCircle className="size-3" />
              WhatsApp
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={handleCopyData}
          >
            <Copy className="size-3" />
            Copiar
          </Button>
        </div>
      </div>

      {/* Contato section */}
      <div className="px-4 py-4 border-b border-border/50 space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Contato
        </p>
        <InfoRow label="Nome" value={lead.name} />
        <InfoRow label="E-mail" value={lead.email} />
        <InfoRow label="Celular" value={formatPhone(lead.phone)} />
        {lead.status && (
          <InfoRow
            label="Status"
            value={STATUS_LABEL[lead.status] || lead.status}
          />
        )}
        {lead.source && (
          <InfoRow
            label="Origem"
            value={SOURCE_LABEL[lead.source] || lead.source}
          />
        )}
        <InfoRow
          label="Responsável"
          value={responsavel ?? "Não atribuído"}
        />
      </div>

      {/* Tags section — only if there are tags */}
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

      {/* Datas section */}
      <div className="px-4 py-4 space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Datas
        </p>
        <InfoRow label="Adicionado em" value={formatDate(lead.created_at)} />
      </div>
    </div>
  );
}
