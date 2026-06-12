"use client";

import * as React from "react";
import { Pencil, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@persia/ui/dialog";
import { updateAppointmentType } from "@/actions/appointment-types";
import { toast } from "sonner";

interface Props {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  defaultChannel: string | null;
}

export function AppointmentEditButton({ id, name, description, durationMinutes, defaultChannel }: Props) {
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [nameVal, setNameVal] = React.useState(name);
  const [descVal, setDescVal] = React.useState(description ?? "");
  const [durationVal, setDurationVal] = React.useState(String(durationMinutes));
  const [channelVal, setChannelVal] = React.useState(defaultChannel ?? "whatsapp");
  const router = useRouter();

  async function handleSave() {
    const minutes = parseInt(durationVal, 10);
    if (!nameVal.trim() || !Number.isFinite(minutes) || minutes < 5) {
      toast.error("Verifique os campos obrigatórios");
      return;
    }
    setSaving(true);
    try {
      await updateAppointmentType(id, {
        name: nameVal.trim(),
        description: descVal.trim() || undefined,
        duration_minutes: minutes,
        default_channel: channelVal as never,
      });
      toast.success("Tipo atualizado");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="size-3.5" />
        Editar
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar tipo de agendamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Nome</Label>
              <Input id="edit-name" value={nameVal} onChange={(e) => setNameVal(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-description">Descrição</Label>
              <Input id="edit-description" value={descVal} onChange={(e) => setDescVal(e.target.value)} placeholder="Opcional" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-duration">Duração (min)</Label>
                <Input id="edit-duration" type="number" min={5} max={1440} value={durationVal} onChange={(e) => setDurationVal(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-channel">Canal</Label>
                <select
                  id="edit-channel"
                  value={channelVal}
                  onChange={(e) => setChannelVal(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="phone">Telefone</option>
                  <option value="online">Online</option>
                  <option value="in_person">Presencial</option>
                </select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button onClick={handleSave} disabled={saving || !nameVal.trim()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />}
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
