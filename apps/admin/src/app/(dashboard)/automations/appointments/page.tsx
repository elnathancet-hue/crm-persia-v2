import { Badge } from "@persia/ui/badge";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import {
  createAppointmentType,
  getAppointmentTypes,
  toggleAppointmentType,
} from "@/actions/appointment-types";
import { AppointmentDeleteButton } from "./delete-button";
import { AppointmentEditButton } from "./edit-button";

export const metadata = { title: "Tipos de agendamento" };

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  phone: "Telefone",
  online: "Online",
  in_person: "Presencial",
};

export default async function AppointmentTypesPage() {
  const types = await getAppointmentTypes();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tipos de agendamento</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cadastre os serviços que o agente IA pode agendar para a conta selecionada.
        </p>
      </div>

      <form action={createAppointmentType} className="rounded-lg border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_160px_170px_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="appointment-type-name">Nome</Label>
            <Input id="appointment-type-name" name="name" placeholder="Consulta inicial" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="appointment-type-duration">Duração</Label>
            <Input
              id="appointment-type-duration"
              name="duration_minutes"
              type="number"
              min={5}
              max={1440}
              defaultValue={30}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="appointment-type-channel">Canal</Label>
            <select
              id="appointment-type-channel"
              name="default_channel"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              defaultValue="whatsapp"
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="phone">Telefone</option>
              <option value="online">Online</option>
              <option value="in_person">Presencial</option>
            </select>
          </div>
          <Button type="submit">Criar tipo</Button>
        </div>
        <div className="mt-3 space-y-1.5">
          <Label htmlFor="appointment-type-description">Descrição</Label>
          <Input id="appointment-type-description" name="description" placeholder="Descrição opcional" />
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Nome</th>
              <th className="px-4 py-3 font-medium">Duração</th>
              <th className="px-4 py-3 font-medium">Canal</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {types.map((type) => (
              <tr key={type.id} className="border-b last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium">{type.name}</div>
                  {type.description ? (
                    <div className="text-xs text-muted-foreground">{type.description}</div>
                  ) : null}
                </td>
                <td className="px-4 py-3">{type.duration_minutes} min</td>
                <td className="px-4 py-3">
                  {type.default_channel ? CHANNEL_LABELS[type.default_channel] ?? type.default_channel : "-"}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={type.is_active ? "success" : "secondary"}>
                    {type.is_active ? "Ativo" : "Inativo"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <form action={toggleAppointmentType.bind(null, type.id, !type.is_active)}>
                      <Button type="submit" variant="outline" size="sm">
                        {type.is_active ? "Desativar" : "Ativar"}
                      </Button>
                    </form>
                    <AppointmentEditButton
                      id={type.id}
                      name={type.name}
                      description={type.description ?? null}
                      durationMinutes={type.duration_minutes}
                      defaultChannel={type.default_channel ?? null}
                    />
                    <AppointmentDeleteButton id={type.id} />
                  </div>
                </td>
              </tr>
            ))}
            {types.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  Nenhum tipo de agendamento cadastrado.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
