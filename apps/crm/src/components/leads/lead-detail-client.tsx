"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ReactivateAgentButton } from "@persia/ai-agent-ui";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from "@persia/ui/card";
import { Badge } from "@persia/ui/badge";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Separator } from "@persia/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@persia/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@persia/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import { LeadForm } from "@/components/leads/lead-form";
import {
  updateLead,
  deleteLead,
  addTagToLead,
  removeTagFromLead,
  type LeadDetail,
  type LeadActivity,
} from "@/actions/leads";
import {
  type LeadAgentHandoffState,
  reactivateAgent as reactivateLeadAgent,
} from "@/actions/ai-agent/reactivate";
import { createDeal, getPipelines, getStages } from "@/actions/crm";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Phone,
  Mail,
  MessageCircle,
  Star,
  Tag,
  X,
  Plus,
  Clock,
  User,
  Activity,
} from "lucide-react";
import { Spinner } from "@persia/ui/spinner";
import { useRole } from "@/lib/hooks/use-role";
import { toast } from "sonner";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  new: { label: "Novo", variant: "default" },
  contacted: { label: "Contactado", variant: "secondary" },
  qualified: { label: "Qualificado", variant: "outline" },
  customer: { label: "Cliente", variant: "default" },
  lost: { label: "Perdido", variant: "destructive" },
};

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  message: <MessageCircle className="size-4" />,
  call: <Phone className="size-4" />,
  email: <Mail className="size-4" />,
  note: <Pencil className="size-4" />,
  status_change: <Activity className="size-4" />,
};

type OrgTag = {
  id: string;
  name: string;
  color: string;
  organization_id: string;
  created_at: string;
};

type LeadDetailClientProps = {
  lead: LeadDetail;
  activities: LeadActivity[];
  orgTags: OrgTag[];
  agentHandoff: LeadAgentHandoffState;
};

type Pipeline = {
  id: string;
  name: string;
};

type Stage = {
  id: string;
  name: string;
};

export function LeadDetailClient({
  lead,
  activities,
  orgTags,
  agentHandoff,
}: LeadDetailClientProps) {
  const router = useRouter();
  const { isAdmin, isAgent } = useRole(); // agent+ can edit/delete/tag
  const [isEditOpen, setIsEditOpen] = React.useState(false);
  const [isCreateDealOpen, setIsCreateDealOpen] = React.useState(false);
  const [isDeleting, startDeleteTransition] = React.useTransition();
  const [isAddingTag, startAddTagTransition] = React.useTransition();
  const [isCreatingDeal, startCreateDealTransition] = React.useTransition();
  const [selectedTagToAdd, setSelectedTagToAdd] = React.useState("");
  const [pipelines, setPipelines] = React.useState<Pipeline[]>([]);
  const [stages, setStages] = React.useState<Stage[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = React.useState("");
  const [selectedStageId, setSelectedStageId] = React.useState("");
  const [dealTitle, setDealTitle] = React.useState("");
  const [dealValue, setDealValue] = React.useState("");
  const [dealFormError, setDealFormError] = React.useState("");

  const statusInfo = STATUS_MAP[lead.status] ?? {
    label: lead.status,
    variant: "outline" as const,
  };

  const currentTagIds = lead.lead_tags?.map((lt) => lt.tag_id) ?? [];
  const availableTags = orgTags.filter((t) => !currentTagIds.includes(t.id));

  React.useEffect(() => {
    if (!isCreateDealOpen) return;

    const defaultTitle = lead.name ? `Negocio - ${lead.name}` : "Novo negocio";
    setDealTitle(defaultTitle);
    setDealFormError("");

    getPipelines()
      .then((data) => {
        const pipelineList = (data || []) as Pipeline[];
        setPipelines(pipelineList);
        const firstPipelineId = pipelineList[0]?.id || "";
        setSelectedPipelineId(firstPipelineId);
      })
      .catch(() => {
        setPipelines([]);
        setSelectedPipelineId("");
      });
  }, [isCreateDealOpen, lead.name]);

  React.useEffect(() => {
    if (!isCreateDealOpen || !selectedPipelineId) {
      setStages([]);
      setSelectedStageId("");
      return;
    }

    getStages(selectedPipelineId)
      .then((data) => {
        const stageList = (data || []) as Stage[];
        setStages(stageList);
        setSelectedStageId(stageList[0]?.id || "");
      })
      .catch(() => {
        setStages([]);
        setSelectedStageId("");
      });
  }, [isCreateDealOpen, selectedPipelineId]);

  async function handleUpdate(formData: FormData) {
    await updateLead(lead.id, formData);
    setIsEditOpen(false);
    router.refresh();
  }

  function handleDelete() {
    startDeleteTransition(async () => {
      await deleteLead(lead.id);
      router.push("/leads");
    });
  }

  function handleAddTag(tagId: string) {
    if (!tagId) return;
    startAddTagTransition(async () => {
      await addTagToLead(lead.id, tagId);
      setSelectedTagToAdd("");
      router.refresh();
    });
  }

  function handleRemoveTag(tagId: string) {
    startAddTagTransition(async () => {
      await removeTagFromLead(lead.id, tagId);
      router.refresh();
    });
  }

  function handleCreateDeal() {
    if (!selectedPipelineId || !selectedStageId || !dealTitle.trim()) {
      setDealFormError("Preencha titulo, funil e etapa.");
      return;
    }

    setDealFormError("");
    startCreateDealTransition(async () => {
      const formData = new FormData();
      formData.set("pipeline_id", selectedPipelineId);
      formData.set("stage_id", selectedStageId);
      formData.set("lead_id", lead.id);
      formData.set("title", dealTitle.trim());
      if (dealValue.trim()) {
        formData.set("value", dealValue.trim());
      }

      try {
        await createDeal(formData);
        setIsCreateDealOpen(false);
        setDealValue("");
        toast.success("Negocio criado no CRM.");
        router.push("/crm");
      } catch {
        toast.error("Nao foi possivel criar o negocio.");
      }
    });
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function openWhatsApp() {
    if (!lead.phone) return;
    const cleaned = lead.phone.replace(/\D/g, "");
    const number = cleaned.startsWith("55") ? cleaned : `55${cleaned}`;
    window.open(`https://wa.me/${number}`, "_blank");
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/leads")}
            aria-label="Voltar para leads"
          >
            <ArrowLeft />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">
              {lead.name || "Sem nome"}
            </h1>
            <p className="text-sm text-muted-foreground">
              Criado em {formatDate(lead.created_at)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lead.phone && (
            <Button variant="outline" onClick={openWhatsApp}>
              <MessageCircle className="size-4" data-icon="inline-start" />
              Chamar no WhatsApp
            </Button>
          )}
          {isAdmin && agentHandoff.isPaused ? (
            <ReactivateAgentButton
              pausedAt={agentHandoff.pausedAt}
              reason={agentHandoff.reason}
              pausedConversationCount={agentHandoff.pausedConversationCount}
              onReactivate={() => reactivateLeadAgent(lead.id)}
              onSuccess={() => router.refresh()}
            />
          ) : null}
          {isAgent && (
            <>
              <Button variant="outline" onClick={() => setIsCreateDealOpen(true)}>
                <Plus className="size-4" data-icon="inline-start" />
                Criar Negocio
              </Button>
              <Button variant="outline" onClick={() => setIsEditOpen(true)}>
                <Pencil className="size-4" data-icon="inline-start" />
                Editar
              </Button>
              <AlertDialog>
                <AlertDialogTrigger
                  render={<Button variant="destructive" />}
                >
                  {isDeleting ? <Spinner className="mr-1.5" /> : <Trash2 className="size-4" data-icon="inline-start" />}
                  Excluir
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir lead</AlertDialogTitle>
                    <AlertDialogDescription>
                      Tem certeza que deseja excluir este lead? Esta ação não pode ser desfeita.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDelete}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {isDeleting && <Spinner className="mr-1.5" />}
                      Excluir
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Left column: lead info */}
        <div className="flex flex-col gap-6 md:col-span-2">
          {/* Info card */}
          <Card>
            <CardHeader>
              <CardTitle>Informacoes do Lead</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <InfoRow icon={<User className="size-4" />} label="Nome" value={lead.name || "-"} />
                <InfoRow icon={<Phone className="size-4" />} label="Telefone" value={lead.phone || "-"} />
                <InfoRow icon={<Mail className="size-4" />} label="E-mail" value={lead.email || "-"} />
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 text-muted-foreground">
                    <Activity className="size-4" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                  </div>
                </div>
                <InfoRow icon={<Tag className="size-4" />} label="Origem" value={lead.source} />
                <InfoRow icon={<Star className="size-4" />} label="Score" value={String(lead.score)} />
                <InfoRow icon={<MessageCircle className="size-4" />} label="Canal" value={lead.channel} />
                <InfoRow
                  icon={<Clock className="size-4" />}
                  label="Última interação"
                  value={formatDate(lead.last_interaction_at)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Tags card */}
          <Card>
            <CardHeader>
              <CardTitle>Tags</CardTitle>
              <CardAction>
                {isAgent && availableTags.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Select
                      value={selectedTagToAdd}
                      onValueChange={(val) => {
                        setSelectedTagToAdd(val ?? "");
                        if (val) handleAddTag(val);
                      }}
                    >
                      <SelectTrigger size="sm">
                        <Plus className="size-3.5 mr-1" />
                        <SelectValue placeholder="Adicionar tag" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableTags.map((tag) => (
                          <SelectItem key={tag.id} value={tag.id}>
                            <span
                              className="mr-1.5 inline-block size-2 rounded-full"
                              style={{ backgroundColor: tag.color }}
                            />
                            {tag.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {isAddingTag && <Spinner className="size-3.5" />}
                  </div>
                )}
              </CardAction>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {lead.lead_tags?.map((lt) => (
                  <Badge
                    key={lt.tag_id}
                    variant="secondary"
                    className="gap-1 pr-1"
                    style={{
                      backgroundColor: lt.tags?.color
                        ? `${lt.tags.color}20`
                        : undefined,
                      color: lt.tags?.color || undefined,
                    }}
                  >
                    {lt.tags?.name}
                    {isAgent && (
                      <button
                        type="button"
                        className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10"
                        onClick={() => handleRemoveTag(lt.tag_id)}
                        aria-label={`Remover tag ${lt.tags?.name || ""}`}
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </Badge>
                ))}
                {(!lead.lead_tags || lead.lead_tags.length === 0) && (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma tag adicionada.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Custom fields */}
          {lead.lead_custom_field_values &&
            lead.lead_custom_field_values.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Campos personalizados</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {lead.lead_custom_field_values.map((cfv) => (
                      <div key={cfv.id}>
                        <p className="text-xs text-muted-foreground">
                          {cfv.custom_fields?.name ?? "Campo"}
                        </p>
                        <p className="text-sm font-medium">{cfv.value}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
        </div>

        {/* Right column: timeline */}
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Atividades</CardTitle>
            </CardHeader>
            <CardContent>
              {activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma atividade registrada.
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  {activities.map((act, idx) => (
                    <div key={act.id}>
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          {ACTIVITY_ICONS[act.type] ?? (
                            <Activity className="size-4" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">{act.description}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(act.created_at)}
                          </p>
                        </div>
                      </div>
                      {idx < activities.length - 1 && (
                        <Separator className="mt-4" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Lead</DialogTitle>
            <DialogDescription>
              Altere os dados do lead.
            </DialogDescription>
          </DialogHeader>
          <LeadForm
            defaultValues={{
              name: lead.name,
              phone: lead.phone,
              email: lead.email,
              source: lead.source,
              status: lead.status,
              channel: lead.channel,
            }}
            onSubmit={handleUpdate}
            onCancel={() => setIsEditOpen(false)}
            submitLabel="Salvar alteracoes"
          />
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateDealOpen} onOpenChange={setIsCreateDealOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Criar Negocio</DialogTitle>
            <DialogDescription>
              Crie um negocio para este lead e acompanhe no Kanban.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Titulo</Label>
              <Input
                value={dealTitle}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setDealTitle(e.target.value)
                }
                placeholder="Nome do negocio"
              />
            </div>
            <div className="space-y-2">
              <Label>Funil</Label>
              <Select
                value={selectedPipelineId}
                onValueChange={(value) => setSelectedPipelineId(value ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um funil" />
                </SelectTrigger>
                <SelectContent>
                  {pipelines.map((pipeline) => (
                    <SelectItem key={pipeline.id} value={pipeline.id}>
                      {pipeline.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Etapa</Label>
              <Select
                value={selectedStageId}
                onValueChange={(value) => setSelectedStageId(value ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma etapa" />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      {stage.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Valor (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={dealValue}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setDealValue(e.target.value)
                }
                placeholder="0.00"
              />
            </div>
            {dealFormError && (
              <p className="text-sm text-destructive">{dealFormError}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateDealOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={handleCreateDeal}
                disabled={isCreatingDeal}
              >
                {isCreatingDeal ? "Criando..." : "Criar no CRM"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}
