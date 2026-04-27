"use client";

// Drawer "Informacoes do lead" — abre dentro do /crm e /leads sem
// navegar pra rota separada. Espelha o design da referencia (Fase 2):
// header com etapa atual clicavel, 3 tabs (Dados/Produtos/Comentarios),
// e secoes CONTATO + ENDERECO + ANOTACOES dentro de Dados.
//
// Tabs Produtos e Comentarios ficam vazios por ora — Fase 4 adiciona
// schema (lead_products, lead_comments).

import * as React from "react";
import { toast } from "sonner";
import {
  Contact,
  MapPin,
  StickyNote,
  Loader2,
  Save,
} from "lucide-react";
import type { LeadWithTags } from "@persia/shared/crm";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@persia/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@persia/ui/tabs";
import { updateLead } from "@/actions/leads";

type Stage = { id: string; name: string };
type Member = { user_id: string; name: string };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: LeadWithTags;
  /** Nome da etapa atual do lead (etapa do deal aberto, se houver). */
  currentStageName?: string | null;
  /** Membros do org pra dropdown "Responsável". */
  members?: Member[];
  /** Lista das stages disponiveis pra trocar (futuro). */
  stages?: Stage[];
  /** Callback apos salvar com sucesso (parent re-busca/sincroniza). */
  onSaved?: (updated: Partial<LeadWithTags>) => void;
}

interface FormState {
  name: string;
  email: string;
  phone: string;
  // Telefone fixo: separamos do `phone` (whatsapp) — armazenado em
  // metadata.landline pra nao impactar campanhas WhatsApp.
  landline: string;
  assigned_to: string;
  website: string;
  address_country: string;
  address_state: string;
  address_city: string;
  address_zip: string;
  address_street: string;
  address_number: string;
  address_neighborhood: string;
  address_complement: string;
  notes: string;
}

function leadToFormState(lead: LeadWithTags): FormState {
  const meta = (lead.metadata ?? {}) as Record<string, unknown>;
  return {
    name: lead.name ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    landline:
      typeof meta.landline === "string" ? (meta.landline as string) : "",
    assigned_to: lead.assigned_to ?? "",
    website: lead.website ?? "",
    address_country: lead.address_country ?? "",
    address_state: lead.address_state ?? "",
    address_city: lead.address_city ?? "",
    address_zip: lead.address_zip ?? "",
    address_street: lead.address_street ?? "",
    address_number: lead.address_number ?? "",
    address_neighborhood: lead.address_neighborhood ?? "",
    address_complement: lead.address_complement ?? "",
    notes: lead.notes ?? "",
  };
}

export function LeadInfoDrawer({
  open,
  onOpenChange,
  lead,
  currentStageName,
  members = [],
  onSaved,
}: Props) {
  const [form, setForm] = React.useState<FormState>(() =>
    leadToFormState(lead),
  );
  const [isPending, startTransition] = React.useTransition();

  // Re-hidrata o form quando trocar de lead ou reabrir.
  React.useEffect(() => {
    if (open) setForm(leadToFormState(lead));
  }, [open, lead]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        // updateLead agora aceita objeto direto (alem de FormData),
        // entao mandamos todos os campos do drawer numa unica chamada.
        await updateLead(lead.id, {
          name: form.name || null,
          email: form.email || null,
          phone: form.phone || null,
          assigned_to: form.assigned_to || null,
          website: form.website || null,
          address_country: form.address_country || null,
          address_state: form.address_state || null,
          address_city: form.address_city || null,
          address_zip: form.address_zip || null,
          address_street: form.address_street || null,
          address_number: form.address_number || null,
          address_neighborhood: form.address_neighborhood || null,
          address_complement: form.address_complement || null,
          notes: form.notes || null,
        });
        toast.success("Lead atualizado");
        onSaved?.({
          name: form.name,
          phone: form.phone,
          email: form.email,
          assigned_to: form.assigned_to || null,
          website: form.website || null,
          address_country: form.address_country || null,
          address_state: form.address_state || null,
          address_city: form.address_city || null,
          address_zip: form.address_zip || null,
          address_street: form.address_street || null,
          address_number: form.address_number || null,
          address_neighborhood: form.address_neighborhood || null,
          address_complement: form.address_complement || null,
          notes: form.notes || null,
        });
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao salvar");
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl overflow-y-auto p-0 flex flex-col"
      >
        <SheetHeader className="px-5 pt-5 pb-2 border-b">
          <SheetTitle>Informações do lead</SheetTitle>
          {currentStageName ? (
            <SheetDescription className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Etapa atual:</span>
              <span className="font-medium text-cyan-600">
                {currentStageName}
              </span>
            </SheetDescription>
          ) : null}
        </SheetHeader>

        <Tabs defaultValue="dados" className="flex-1 flex flex-col">
          <TabsList className="mx-5 mt-3 grid grid-cols-3">
            <TabsTrigger value="dados">
              <Contact className="size-4" />
              Dados
            </TabsTrigger>
            <TabsTrigger value="produtos">
              <span className="size-4 inline-flex items-center justify-center">
                📦
              </span>
              Produtos
            </TabsTrigger>
            <TabsTrigger value="comentarios">
              <span className="size-4 inline-flex items-center justify-center">
                💬
              </span>
              Comentários
            </TabsTrigger>
          </TabsList>

          <form
            id="lead-info-form"
            onSubmit={handleSave}
            className="flex-1 overflow-y-auto px-5 py-4 space-y-6"
          >
            <TabsContent value="dados" className="space-y-6 mt-0">
              {/* ============ CONTATO ============ */}
              <section className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Contact className="size-4 text-cyan-600" />
                  CONTATO
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Nome">
                    <Input
                      value={form.name}
                      onChange={(e) => set("name", e.target.value)}
                      placeholder="Nome do contato"
                    />
                  </Field>
                  <Field label="E-mail">
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(e) => set("email", e.target.value)}
                      placeholder="email@exemplo.com"
                    />
                  </Field>
                  <Field label="Celular">
                    <Input
                      value={form.phone}
                      onChange={(e) => set("phone", e.target.value)}
                      placeholder="+55 (00) 00000-0000"
                    />
                  </Field>
                  <Field label="Telefone">
                    <Input
                      value={form.landline}
                      onChange={(e) => set("landline", e.target.value)}
                      placeholder="(00) 3000-0000"
                    />
                  </Field>
                  <Field label="Responsável">
                    <Select
                      value={form.assigned_to || ""}
                      onValueChange={(v) => set("assigned_to", v ?? "")}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {members.length === 0 ? (
                          <SelectItem value="_none" disabled>
                            Sem responsáveis disponíveis
                          </SelectItem>
                        ) : (
                          members.map((m) => (
                            <SelectItem key={m.user_id} value={m.user_id}>
                              {m.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Website">
                    <Input
                      type="url"
                      value={form.website}
                      onChange={(e) => set("website", e.target.value)}
                      placeholder="https://..."
                    />
                  </Field>
                </div>
              </section>

              {/* ============ ENDEREÇO ============ */}
              <section className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <MapPin className="size-4 text-cyan-600" />
                  ENDEREÇO
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="País">
                    <Input
                      value={form.address_country}
                      onChange={(e) => set("address_country", e.target.value)}
                      placeholder="Brasil"
                    />
                  </Field>
                  <Field label="Estado">
                    <Input
                      value={form.address_state}
                      onChange={(e) => set("address_state", e.target.value)}
                      placeholder="SP"
                    />
                  </Field>
                  <Field label="Cidade">
                    <Input
                      value={form.address_city}
                      onChange={(e) => set("address_city", e.target.value)}
                      placeholder="São Paulo"
                    />
                  </Field>
                  <Field label="CEP">
                    <Input
                      value={form.address_zip}
                      onChange={(e) => set("address_zip", e.target.value)}
                      placeholder="00000-000"
                    />
                  </Field>
                  <Field label="Endereço">
                    <Input
                      value={form.address_street}
                      onChange={(e) => set("address_street", e.target.value)}
                      placeholder="Rua, Av..."
                    />
                  </Field>
                  <Field label="Número">
                    <Input
                      value={form.address_number}
                      onChange={(e) => set("address_number", e.target.value)}
                      placeholder="123"
                    />
                  </Field>
                  <Field label="Bairro" className="sm:col-span-1">
                    <Input
                      value={form.address_neighborhood}
                      onChange={(e) =>
                        set("address_neighborhood", e.target.value)
                      }
                      placeholder="Bairro"
                    />
                  </Field>
                  <Field label="Complemento" className="sm:col-span-2">
                    <Input
                      value={form.address_complement}
                      onChange={(e) =>
                        set("address_complement", e.target.value)
                      }
                      placeholder="Apto, bloco..."
                    />
                  </Field>
                </div>
              </section>

              {/* ============ ANOTAÇÕES ============ */}
              <section className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <StickyNote className="size-4 text-amber-600" />
                  ANOTAÇÕES
                </h3>
                <Textarea
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder="Observações gerais sobre o lead..."
                  rows={5}
                />
              </section>
            </TabsContent>

            <TabsContent value="produtos" className="mt-0">
              <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
                Em breve. Vincule produtos ao lead pra montar propostas.
              </div>
            </TabsContent>

            <TabsContent value="comentarios" className="mt-0">
              <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
                Em breve. Comentários internos da equipe sobre o lead.
              </div>
            </TabsContent>
          </form>
        </Tabs>

        <SheetFooter className="px-5 py-3 border-t">
          <Button
            type="submit"
            form="lead-info-form"
            disabled={isPending}
            className="w-full"
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Salvar e fechar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// Helper local — Field padroniza Label + child sem precisar repetir
// markup. Mantem o componente principal mais legivel.
function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className ? `space-y-1 ${className}` : "space-y-1"}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
