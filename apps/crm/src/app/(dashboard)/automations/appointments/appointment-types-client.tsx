"use client";

import * as React from "react";
import {
  Plus,
  CalendarClock,
  Clock,
  Loader2,
  MoreHorizontal,
  Trash2,
  Power,
  PowerOff,
  Search,
  Video,
  MapPin,
  Phone,
  MessageCircle,
} from "lucide-react";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Badge } from "@persia/ui/badge";
import { Card, CardContent } from "@persia/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@persia/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@persia/ui/dropdown-menu";
import {
  createAppointmentType,
  deleteAppointmentType,
  updateAppointmentType,
  type AppointmentType,
  type OrgMemberOption,
} from "@/actions/appointment-types";
import { toast } from "sonner";

// PR-AI-AGENT-APPOINTMENT-TYPES (mai/2026): UI de tipos de agendamento.
// Cliente cadastra "Consulta inicial 30min", "Avaliacao 60min", etc, e
// a IA passa a usar o tipo via slug em vez de inventar titulos.

const CHANNEL_LABELS: Record<NonNullable<AppointmentType["default_channel"]>, string> = {
  whatsapp: "WhatsApp",
  phone: "Telefone",
  online: "Online",
  in_person: "Presencial",
};

const CHANNEL_ICONS: Record<
  NonNullable<AppointmentType["default_channel"]>,
  typeof MessageCircle
> = {
  whatsapp: MessageCircle,
  phone: Phone,
  online: Video,
  in_person: MapPin,
};

interface Props {
  initialTypes: AppointmentType[];
  members: OrgMemberOption[];
}

export function AppointmentTypesClient({ initialTypes, members }: Props) {
  const [types, setTypes] = React.useState<AppointmentType[]>(initialTypes);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [search, setSearch] = React.useState("");

  // Form state
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [duration, setDuration] = React.useState("30");
  const [channel, setChannel] = React.useState<AppointmentType["default_channel"]>(
    null,
  );
  const [location, setLocation] = React.useState("");
  const [meetingUrl, setMeetingUrl] = React.useState("");
  const [defaultUserId, setDefaultUserId] = React.useState<string | null>(null);

  function openCreate() {
    setName("");
    setDescription("");
    setDuration("30");
    setChannel(null);
    setLocation("");
    setMeetingUrl("");
    setDefaultUserId(null);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Informe o nome do tipo de agendamento");
      return;
    }
    const minutes = parseInt(duration, 10);
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 1440) {
      toast.error("Duracao deve estar entre 5 e 1440 minutos");
      return;
    }

    setSaving(true);
    try {
      const created = await createAppointmentType({
        name: name.trim(),
        description: description.trim() || undefined,
        duration_minutes: minutes,
        default_channel: channel ?? undefined,
        default_location: location.trim() || undefined,
        default_meeting_url: meetingUrl.trim() || undefined,
        default_user_id: defaultUserId,
      });
      setTypes((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      toast.success("Tipo de agendamento criado");
      setDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(type: AppointmentType) {
    try {
      await updateAppointmentType(type.id, { is_active: !type.is_active });
      setTypes((prev) =>
        prev.map((t) => (t.id === type.id ? { ...t, is_active: !t.is_active } : t)),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao alternar");
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteAppointmentType(id);
      setTypes((prev) => prev.filter((t) => t.id !== id));
      toast.success("Tipo removido");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover");
    }
  }

  const filtered = types.filter((t) => {
    if (!search) return true;
    const needle = search.toLowerCase();
    return (
      t.name.toLowerCase().includes(needle) ||
      (t.description?.toLowerCase().includes(needle) ?? false)
    );
  });

  return (
    <>
      {/* Top bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Buscar tipo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Button onClick={openCreate} className="ml-auto">
          <Plus className="size-4" />
          Novo tipo
        </Button>
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="size-14 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
              <CalendarClock className="size-7 text-muted-foreground/60" />
            </div>
            <p className="text-base font-semibold">Nenhum tipo cadastrado</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md text-center">
              Sem tipos cadastrados, a IA não consegue agendar de forma padronizada — ela vai inventar
              títulos e durações diferentes a cada conversa.
            </p>
            <Button className="mt-4" onClick={openCreate}>
              <Plus className="size-4" />
              Criar primeiro tipo
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((type) => {
            const ChannelIcon = type.default_channel
              ? CHANNEL_ICONS[type.default_channel]
              : null;
            return (
              <Card
                key={type.id}
                className={`hover:border-primary/30 transition-colors ${
                  !type.is_active ? "opacity-60" : ""
                }`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="size-9 rounded-lg flex items-center justify-center shrink-0 bg-primary/10 text-primary">
                        <CalendarClock className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{type.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 flex items-center gap-1"
                          >
                            <Clock className="size-3" />
                            {type.duration_minutes} min
                          </Badge>
                          {ChannelIcon && type.default_channel ? (
                            <Badge variant="outline" className="text-[10px] px-1.5 flex items-center gap-1">
                              <ChannelIcon className="size-3" />
                              {CHANNEL_LABELS[type.default_channel]}
                            </Badge>
                          ) : null}
                          {!type.is_active && (
                            <Badge variant="outline" className="text-[10px] px-1.5">
                              Inativo
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger>
                        <Button variant="ghost" size="icon-sm" className="size-7 shrink-0">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleToggle(type)}>
                          {type.is_active ? (
                            <PowerOff className="size-4" />
                          ) : (
                            <Power className="size-4" />
                          )}
                          {type.is_active ? "Desativar" : "Ativar"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => handleDelete(type.id)}
                        >
                          <Trash2 className="size-4" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {type.description && (
                    <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                      {type.description}
                    </p>
                  )}

                  {(type.default_location || type.default_meeting_url) && (
                    <div className="mt-2 text-[11px] text-muted-foreground space-y-0.5">
                      {type.default_location && (
                        <div className="flex items-center gap-1.5">
                          <MapPin className="size-3" />
                          <span className="truncate">{type.default_location}</span>
                        </div>
                      )}
                      {type.default_meeting_url && (
                        <div className="flex items-center gap-1.5">
                          <Video className="size-3" />
                          <span className="truncate">{type.default_meeting_url}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {type.slug && (
                    <div className="mt-2 text-[10px] text-muted-foreground">
                      slug: <code className="bg-muted px-1 py-0.5 rounded">{type.slug}</code>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo tipo de agendamento</DialogTitle>
            <DialogDescription>
              Define um padrão para a IA agendar (nome, duração, canal). Em vez de inventar a cada conversa.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                placeholder="Ex: Consulta inicial, Avaliação completa"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Descrição (a IA usa pra decidir quando ofertar)</Label>
              <Input
                placeholder="Ex: Primeira conversa de 30min pra entender o caso"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Duração (minutos)</Label>
                <Input
                  type="number"
                  min={5}
                  max={1440}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Canal padrão</Label>
                <Select
                  value={channel ?? "none"}
                  onValueChange={(v) =>
                    setChannel(
                      v === "none" ? null : (v as AppointmentType["default_channel"]),
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Não definido</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="phone">Telefone</SelectItem>
                    <SelectItem value="online">Online</SelectItem>
                    <SelectItem value="in_person">Presencial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {channel === "in_person" && (
              <div className="space-y-2">
                <Label>Endereço padrão</Label>
                <Input
                  placeholder="Ex: Rua das Flores, 123 — São Paulo"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>
            )}

            {channel === "online" && (
              <div className="space-y-2">
                <Label>URL de reunião padrão</Label>
                <Input
                  placeholder="https://meet.google.com/abc-xyz"
                  value={meetingUrl}
                  onChange={(e) => setMeetingUrl(e.target.value)}
                />
              </div>
            )}

            {members.length > 0 && (
              <div className="space-y-2">
                <Label>Profissional padrão (opcional)</Label>
                <Select
                  value={defaultUserId ?? "none"}
                  onValueChange={(v) => setDefaultUserId(v === "none" ? null : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Qualquer responsável do lead" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Qualquer responsável do lead</SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Quando definido, a IA sempre agenda com este profissional, independente de quem é o responsável do lead.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button onClick={handleSave} disabled={saving || !name.trim()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {saving ? "Salvando..." : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
