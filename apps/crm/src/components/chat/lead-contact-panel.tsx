"use client";

import { useEffect, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  ImageIcon,
  MapPin,
  MessageCircle,
  Mic,
  Pencil,
  StickyNote,
  Tag,
  User,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@persia/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@persia/ui/avatar";
import { Badge } from "@persia/ui/badge";
import { TagBadge } from "@persia/tags-ui";
import { getConversationMediaFiles } from "@/actions/messages";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TagEntry {
  tag_id: string;
  tags: { id: string; name: string; color: string } | null;
}

export interface LeadContactData {
  id?: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  status: string | null;
  source: string | null;
  website?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  assigned_to?: string | null;
  address_country?: string | null;
  address_state?: string | null;
  address_city?: string | null;
  address_zip?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  address_neighborhood?: string | null;
  address_complement?: string | null;
  lead_tags?: TagEntry[];
}

interface LeadContactPanelProps {
  lead: LeadContactData;
  conversationId?: string | null;
  onOpenLeadDrawer?: () => void;
  onClose: () => void;
}

type MediaTab = "image" | "document" | "audio";
type MediaItem = {
  id: string;
  type: string;
  media_url: string | null;
  content: string | null;
  created_at: string;
};

// ─── Label maps ───────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  new: "Novo",
  contacted: "Contactado",
  qualified: "Qualificado",
  customer: "Cliente",
  lost: "Perdido",
};

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string | null | undefined) {
  if (!name) return "?";
  return name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function formatDate(iso: string | null | undefined, withTime = false) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
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

function buildAddressLines(lead: LeadContactData): string[] {
  const parts: string[] = [];
  if (lead.address_street) {
    let line = lead.address_street;
    if (lead.address_number) line += `, ${lead.address_number}`;
    if (lead.address_complement) line += ` (${lead.address_complement})`;
    parts.push(line);
  }
  if (lead.address_neighborhood) parts.push(lead.address_neighborhood);
  const cityState = [lead.address_city, lead.address_state].filter(Boolean).join(" – ");
  if (cityState) parts.push(cityState);
  if (lead.address_zip) parts.push(`CEP ${lead.address_zip}`);
  if (lead.address_country && lead.address_country !== "Brasil" && lead.address_country !== "BR") {
    parts.push(lead.address_country);
  }
  return parts;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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

function SectionHeader({
  icon,
  title,
  action,
  collapsible,
  open,
  onToggle,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </span>
        <span className="text-sm font-semibold text-foreground">{title}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {action}
        {collapsible && (
          <Button type="button" variant="ghost" size="icon-xs" onClick={onToggle} className="size-6">
            {open ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LeadContactPanel({ lead, conversationId, onOpenLeadDrawer, onClose }: LeadContactPanelProps) {
  const [mediaOpen, setMediaOpen] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);
  const [mediaTab, setMediaTab] = useState<MediaTab>("image");
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaLoaded, setMediaLoaded] = useState(false);

  const tags = (lead.lead_tags ?? [])
    .map((lt) => lt.tags)
    .filter(Boolean) as { id: string; name: string; color: string }[];

  const responsavel =
    !lead.assigned_to
      ? null
      : lead.assigned_to === "ai"
        ? "Agente IA"
        : lead.assigned_to;

  const addressLines = buildAddressLines(lead);

  // Lazy-load media when section first opens
  useEffect(() => {
    if (!mediaOpen || mediaLoaded || !conversationId) return;
    let cancelled = false;
    setMediaLoading(true);
    getConversationMediaFiles(conversationId)
      .then((items) => { if (!cancelled) { setMediaItems(items); setMediaLoaded(true); } })
      .catch(() => { if (!cancelled) setMediaItems([]); })
      .finally(() => { if (!cancelled) setMediaLoading(false); });
    return () => { cancelled = true; };
  }, [mediaOpen, mediaLoaded, conversationId]);

  const mediaByTab: Record<MediaTab, MediaItem[]> = {
    image: mediaItems.filter((m) => m.type === "image" || m.type === "video"),
    document: mediaItems.filter((m) => m.type === "document"),
    audio: mediaItems.filter((m) => m.type === "audio" || m.type === "ptt"),
  };

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
    window.open(`https://wa.me/${lead.phone.replace(/\D/g, "")}`, "_blank");
  }

  const editLeadHref = lead.id ? `/leads/${lead.id}` : undefined;

  function openLead() {
    if (onOpenLeadDrawer) onOpenLeadDrawer();
    else if (editLeadHref) window.open(editLeadHref, "_blank");
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background">

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/50 px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Detalhes do contato
        </span>
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Fechar painel">
          <X className="size-3.5" />
        </Button>
      </div>

      {/* ── Identidade ────────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-col items-center gap-3 border-b border-border/50 px-5 pb-5 pt-6">
        <Avatar size="lg">
          {lead.avatar_url && <AvatarImage src={lead.avatar_url} alt={lead.name ?? undefined} />}
          <AvatarFallback className="text-base">{getInitials(lead.name)}</AvatarFallback>
        </Avatar>

        <div className="text-center">
          <p className="text-[16px] font-semibold leading-tight">{lead.name || "Sem nome"}</p>
          {lead.phone && (
            <p className="mt-1 text-sm text-muted-foreground">{formatPhone(lead.phone)}</p>
          )}
        </div>

        {(lead.status || lead.source) && (
          <div className="flex flex-wrap justify-center gap-1.5">
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

        {lead.phone && (
          <Button className="w-full gap-2" size="sm" onClick={handleWhatsApp}>
            <MessageCircle className="size-4" />
            Enviar WhatsApp
          </Button>
        )}

        <div className="flex w-full gap-2">
          {editLeadHref && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5 text-xs"
              onClick={openLead}
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

      {/* ── Contato ───────────────────────────────────────────────────── */}
      <div className="space-y-3 border-b border-border/50 px-4 py-4">
        <SectionHeader
          icon={<User className="size-3.5" />}
          title="Contato"
          action={
            editLeadHref && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="gap-1 text-xs text-muted-foreground"
                onClick={openLead}
              >
                <Pencil className="size-3" />
                Editar
              </Button>
            )
          }
        />
        <div className="space-y-2.5 pl-9">
          <InfoRow label="Nome" value={lead.name} />
          <InfoRow label="E-mail" value={lead.email} />
          <InfoRow label="Celular" value={formatPhone(lead.phone)} />
          {lead.website && <InfoRow label="Website" value={lead.website} />}
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
      </div>

      {/* ── Anotações ─────────────────────────────────────────────────── */}
      <div className="space-y-3 border-b border-border/50 px-4 py-4">
        <SectionHeader
          icon={<StickyNote className="size-3.5" />}
          title="Anotações"
          action={
            editLeadHref && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="gap-1 text-xs text-muted-foreground"
                onClick={openLead}
              >
                <Pencil className="size-3" />
                Editar
              </Button>
            )
          }
        />
        <div className="pl-9">
          {lead.notes ? (
            <p className="whitespace-pre-wrap text-sm text-foreground">{lead.notes}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma anotação.</p>
          )}
        </div>
      </div>

      {/* ── Arquivos e mídias ─────────────────────────────────────────── */}
      {conversationId && (
        <div className="space-y-3 border-b border-border/50 px-4 py-4">
          <SectionHeader
            icon={<FileText className="size-3.5" />}
            title="Arquivos e mídias"
            collapsible
            open={mediaOpen}
            onToggle={() => setMediaOpen((v) => !v)}
          />
          {!mediaOpen && (
            <p className="pl-9 text-xs text-muted-foreground">
              Veja documentos, imagens, vídeos e áudios trocados nesta conversa.
            </p>
          )}
          {mediaOpen && (
            <div className="pl-9">
              <div className="flex gap-1.5">
                {(["image", "document", "audio"] as MediaTab[]).map((tab) => {
                  const labels: Record<MediaTab, string> = {
                    image: "Imagens",
                    document: "Documentos",
                    audio: "Áudios",
                  };
                  const count = mediaLoaded ? mediaByTab[tab].length : null;
                  return (
                    <Button
                      key={tab}
                      type="button"
                      variant={mediaTab === tab ? "default" : "outline"}
                      size="xs"
                      onClick={() => setMediaTab(tab)}
                    >
                      {labels[tab]}
                      {count !== null && count > 0 && (
                        <span className="ml-1 rounded-full bg-primary-foreground/20 px-1 text-[10px] tabular-nums">
                          {count}
                        </span>
                      )}
                    </Button>
                  );
                })}
              </div>

              <div className="mt-3 space-y-1.5">
                {mediaLoading && (
                  <p className="text-xs text-muted-foreground">Carregando...</p>
                )}
                {!mediaLoading && mediaLoaded && mediaByTab[mediaTab].length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhum arquivo nesta categoria.</p>
                )}
                {!mediaLoading &&
                  mediaByTab[mediaTab].map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs"
                    >
                      {mediaTab === "image" ? (
                        <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : mediaTab === "audio" ? (
                        <Mic className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {item.content || formatDate(item.created_at)}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {formatDate(item.created_at)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Endereço ──────────────────────────────────────────────────── */}
      <div className="space-y-3 border-b border-border/50 px-4 py-4">
        <SectionHeader
          icon={<MapPin className="size-3.5" />}
          title="Endereço"
          collapsible
          open={addressOpen}
          onToggle={() => setAddressOpen((v) => !v)}
        />
        {!addressOpen && (
          <p className="pl-9 text-sm text-muted-foreground">
            {addressLines.length > 0 ? addressLines[0] : "Endereço —"}
          </p>
        )}
        {addressOpen && (
          <div className="pl-9">
            {addressLines.length > 0 ? (
              <div className="space-y-0.5">
                {addressLines.map((line, i) => (
                  <p key={i} className="text-sm text-foreground">
                    {line}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Endereço —</p>
            )}
          </div>
        )}
      </div>

      {/* ── Tags ──────────────────────────────────────────────────────── */}
      <div className="space-y-2.5 border-b border-border/50 px-4 py-4">
        <SectionHeader icon={<Tag className="size-3.5" />} title="Tags" />
        <div className="flex flex-wrap gap-1.5 pl-9">
          {tags.length > 0 ? (
            tags.map((tag) => <TagBadge key={tag.id} name={tag.name} color={tag.color} />)
          ) : (
            <span className="text-sm text-muted-foreground">Nenhuma tag</span>
          )}
        </div>
      </div>

      {/* ── Participantes ─────────────────────────────────────────────── */}
      <div className="space-y-3 border-b border-border/50 px-4 py-4">
        <SectionHeader icon={<Users className="size-3.5" />} title="Participantes" />
        <div className="flex items-center gap-2 pl-9">
          <Avatar size="sm">
            {lead.avatar_url && (
              <AvatarImage src={lead.avatar_url} alt={lead.name ?? undefined} />
            )}
            <AvatarFallback className="text-[10px]">{getInitials(lead.name)}</AvatarFallback>
          </Avatar>
          <span className="text-sm text-foreground">{lead.name || "Lead"}</span>
        </div>
      </div>

      {/* ── Datas ─────────────────────────────────────────────────────── */}
      <div className="space-y-3 px-4 py-4">
        <SectionHeader icon={<CalendarDays className="size-3.5" />} title="Datas" />
        <div className="space-y-2 pl-9">
          <InfoRow label="Criado em" value={formatDate(lead.created_at, true)} />
          {lead.updated_at && (
            <InfoRow label="Atualizado" value={formatDate(lead.updated_at, true)} />
          )}
        </div>
      </div>

    </div>
  );
}
