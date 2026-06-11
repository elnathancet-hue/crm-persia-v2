"use client";

import { useEffect, useState } from "react";
import { getLeadDetail } from "@/actions/leads";
import { X, Loader2, User, Phone, Mail, Tag, ExternalLink, MapPin } from "lucide-react";
import { hashColor, getInitials } from "@/lib/utils";
import Link from "next/link";

const STATUS_LABEL: Record<string, string> = {
  new: "Novo",
  contacted: "Contatado",
  qualified: "Qualificado",
  customer: "Cliente",
  churned: "Perdido",
};

const STATUS_COLOR: Record<string, string> = {
  new: "text-muted-foreground bg-muted",
  contacted: "text-primary bg-primary/10",
  qualified: "text-progress bg-progress/10",
  customer: "text-success bg-success/10",
  churned: "text-destructive bg-destructive/10",
};

interface Props {
  leadId: string;
  onClose: () => void;
}

type LeadData = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
  source: string | null;
  avatar_url: string | null;
  notes: string | null;
  address_city: string | null;
  address_state: string | null;
  lead_tags?: { tag_id: string; tags: { id: string; name: string; color: string } | null }[];
};

export function LeadInfoPanel({ leadId, onClose }: Props) {
  const [lead, setLead] = useState<LeadData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setLead(null);
    getLeadDetail(leadId).then((result) => {
      if (result.data) setLead(result.data as LeadData);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [leadId]);

  const status = lead?.status ?? "new";
  const statusColor = STATUS_COLOR[status] ?? STATUS_COLOR["new"];

  return (
    <div className="w-72 shrink-0 h-full flex flex-col border-l border-border bg-card overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Info do Lead</p>
        <button
          onClick={onClose}
          className="size-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground/60" />
        </div>
      ) : !lead ? (
        <div className="flex-1 flex items-center justify-center px-4 text-center">
          <p className="text-sm text-muted-foreground">Não foi possível carregar os dados do lead.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Avatar + name */}
          <div className="flex flex-col items-center gap-2 pt-2">
            <div className={`size-14 rounded-full flex items-center justify-center text-white text-lg font-semibold ${hashColor(lead.name ?? null)}`}>
              {getInitials(lead.name ?? null)}
            </div>
            <div className="text-center">
              <p className="font-semibold text-foreground text-sm">{lead.name || "Sem nome"}</p>
              <span className={`mt-1 inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColor}`}>
                {STATUS_LABEL[status] ?? status}
              </span>
            </div>
          </div>

          {/* Contact info */}
          <div className="space-y-2">
            {lead.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="size-3.5 text-muted-foreground shrink-0" />
                <span className="text-foreground truncate">{lead.phone}</span>
              </div>
            )}
            {lead.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="size-3.5 text-muted-foreground shrink-0" />
                <span className="text-foreground truncate">{lead.email}</span>
              </div>
            )}
            {lead.source && (
              <div className="flex items-center gap-2 text-sm">
                <User className="size-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground capitalize">{lead.source}</span>
              </div>
            )}
            {(lead.address_city || lead.address_state) && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="size-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">
                  {[lead.address_city, lead.address_state].filter(Boolean).join(", ")}
                </span>
              </div>
            )}
          </div>

          {/* Tags */}
          {(lead.lead_tags ?? []).length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
                <Tag className="size-3" /> Tags
              </p>
              <div className="flex flex-wrap gap-1">
                {(lead.lead_tags ?? []).map((lt) => {
                  const tag = lt.tags;
                  if (!tag) return null;
                  return (
                    <span
                      key={lt.tag_id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border"
                      style={{
                        backgroundColor: `${tag.color}20`,
                        borderColor: `${tag.color}40`,
                        color: tag.color,
                      }}
                    >
                      {tag.name}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Notes */}
          {lead.notes && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Notas</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{lead.notes}</p>
            </div>
          )}

          {/* Link to CRM */}
          <div className="pt-2 border-t border-border">
            <Link
              href={`/crm?leadId=${lead.id}`}
              className="flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <ExternalLink className="size-3.5" />
              Ver lead no CRM
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
