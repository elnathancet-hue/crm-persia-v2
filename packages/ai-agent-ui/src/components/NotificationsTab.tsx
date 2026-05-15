"use client";

import * as React from "react";
import {
  Bell,
  Loader2,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  NOTIFICATION_PHONE_MAX_DIGITS,
  NOTIFICATION_PHONE_MIN_DIGITS,
  NOTIFICATION_TEMPLATE_BODY_MAX_LENGTH,
  NOTIFICATION_TEMPLATE_DESCRIPTION_MAX_CHARS,
  NOTIFICATION_TEMPLATE_DESCRIPTION_MIN_CHARS,
  NOTIFICATION_TEMPLATE_NAME_MAX_CHARS,
  NOTIFICATION_TEMPLATE_NAME_MIN_CHARS,
  NOTIFICATION_TEMPLATES_MAX_PER_AGENT,
  buildNotificationToolName,
  isKnownFixedVariable,
  listNotificationPlaceholders,
  NOTIFICATION_FIXED_VARIABLES,
  type AgentNotificationTemplate,
  type NotificationTargetType,
} from "@persia/shared/ai-agent";
import { Badge } from "@persia/ui/badge";
import { Button } from "@persia/ui/button";
import { Card, CardContent } from "@persia/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import { cn } from "@persia/ui/utils";
import { useAgentActions } from "../context";

interface Props {
  configId: string;
  templates: AgentNotificationTemplate[];
  onChange: (templates: AgentNotificationTemplate[]) => void;
  onRefresh: () => Promise<void>;
}

interface EditorState {
  open: boolean;
  source: AgentNotificationTemplate | null; // null = create
  name: string;
  description: string;
  target_type: NotificationTargetType;
  target_address: string;
  body_template: string;
}

const EMPTY_EDITOR: EditorState = {
  open: false,
  source: null,
  name: "",
  description: "",
  target_type: "phone",
  target_address: "",
  body_template: "",
};

export function NotificationsTab({
  configId,
  templates,
  onChange,
  onRefresh,
}: Props) {
  const {
    createNotificationTemplate,
    updateNotificationTemplate,
    deleteNotificationTemplate,
  } = useAgentActions();
  const [editor, setEditor] = React.useState<EditorState>(EMPTY_EDITOR);
  const [isPending, startTransition] = React.useTransition();
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const limitReached = templates.length >= NOTIFICATION_TEMPLATES_MAX_PER_AGENT;

  const openCreate = () => setEditor({ ...EMPTY_EDITOR, open: true });
  const openEdit = (source: AgentNotificationTemplate) =>
    setEditor({
      open: true,
      source,
      name: source.name,
      description: source.description,
      target_type: source.target_type,
      target_address: source.target_address,
      body_template: source.body_template,
    });

  const editorErrors = React.useMemo(
    () => validateEditor(editor),
    [editor],
  );
  const editorHasErrors = Object.keys(editorErrors).length > 0;

  const handleSave = () => {
    if (editorHasErrors) return;
    const name = editor.name.trim();
    const description = editor.description.trim();
    const body = editor.body_template.trim();
    const address = editor.target_address.trim();

    startTransition(async () => {
      try {
        if (editor.source) {
          const updated = await updateNotificationTemplate(editor.source.id, {
            name,
            description,
            target_type: editor.target_type,
            target_address: address,
            body_template: body,
          });
          onChange(
            templates.map((t) => (t.id === updated.id ? updated : t)),
          );
          toast.success("Notificação atualizada");
        } else {
          const created = await createNotificationTemplate({
            config_id: configId,
            name,
            description,
            target_type: editor.target_type,
            target_address: address,
            body_template: body,
          });
          onChange([...templates, created]);
          toast.success("Notificação criada");
        }
        setEditor(EMPTY_EDITOR);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao salvar");
      }
    });
  };

  const handleDelete = (template: AgentNotificationTemplate) => {
    if (
      !window.confirm(
        `Apagar notificação "${template.name}"? O agente perde acesso a esse template.`,
      )
    ) {
      return;
    }
    setDeletingId(template.id);
    startTransition(async () => {
      try {
        await deleteNotificationTemplate(template.id);
        onChange(templates.filter((t) => t.id !== template.id));
        toast.success("Notificação removida");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao remover");
      } finally {
        setDeletingId(null);
      }
    });
  };

  const handleArchiveToggle = (template: AgentNotificationTemplate) => {
    const nextStatus =
      template.status === "active" ? "archived" : "active";
    startTransition(async () => {
      try {
        const updated = await updateNotificationTemplate(template.id, {
          status: nextStatus,
        });
        onChange(templates.map((t) => (t.id === updated.id ? updated : t)));
        toast.success(
          nextStatus === "archived"
            ? "Notificação arquivada"
            : "Notificação reativada",
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao atualizar");
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Bell className="size-5 text-primary" />
            <h2 className="font-semibold">Notificações</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Templates WhatsApp que o agente dispara como decisão. Cada template
            vira uma ferramenta com nome <code className="font-mono text-[11px]">notify_&lt;slug&gt;</code> e
            descrição visível pro agente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void onRefresh();
            }}
            disabled={isPending}
          >
            <RotateCcw className="size-4" />
            Atualizar
          </Button>
          <Button
            onClick={openCreate}
            disabled={isPending || limitReached}
            title={
              limitReached
                ? `Limite de ${NOTIFICATION_TEMPLATES_MAX_PER_AGENT} templates atingido`
                : undefined
            }
          >
            <Plus className="size-4" />
            Nova notificação
          </Button>
        </div>
      </div>

      {templates.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 flex flex-col items-center text-center gap-3">
            <div className="size-12 rounded-2xl bg-muted flex items-center justify-center">
              <Bell className="size-6 text-muted-foreground" />
            </div>
            <div className="max-w-md space-y-1">
              <p className="font-semibold text-sm tracking-tight">
                Avise a equipe quando o agente tomar uma decisão
              </p>
              <p className="text-xs text-muted-foreground">
                Crie templates WhatsApp pra eventos importantes — lead qualificado,
                agendamento confirmado, pedido de orçamento — e o agente decide
                quando disparar.
              </p>
            </div>
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              Criar primeira notificação
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {templates.map((template) => (
            <NotificationCard
              key={template.id}
              template={template}
              onEdit={() => openEdit(template)}
              onDelete={() => handleDelete(template)}
              onArchiveToggle={() => handleArchiveToggle(template)}
              deleting={deletingId === template.id}
              disabled={isPending}
            />
          ))}
        </div>
      )}

      <NotificationEditorDialog
        editor={editor}
        errors={editorErrors}
        hasErrors={editorHasErrors}
        onChange={setEditor}
        onSave={handleSave}
        isPending={isPending}
      />
    </div>
  );
}

interface CardProps {
  template: AgentNotificationTemplate;
  onEdit: () => void;
  onDelete: () => void;
  onArchiveToggle: () => void;
  deleting: boolean;
  disabled: boolean;
}

function NotificationCard({
  template,
  onEdit,
  onDelete,
  onArchiveToggle,
  deleting,
  disabled,
}: CardProps) {
  const toolName = buildNotificationToolName(template.name);
  const TargetIcon = template.target_type === "phone" ? Phone : Users;

  return (
    <Card className="transition-shadow hover:shadow-sm">
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-sm truncate tracking-tight">
                {template.name}
              </p>
              <Badge
                variant="outline"
                className="text-xs gap-1 font-mono"
                title="Nome do tool visível pro agente"
              >
                {toolName}
              </Badge>
              {template.status === "archived" ? (
                <Badge variant="outline" className="text-xs">
                  Arquivada
                </Badge>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">
              {template.description}
            </p>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <TargetIcon className="size-3" />
              <span>
                {template.target_type === "phone" ? "Telefone" : "Grupo"} ·{" "}
              </span>
              <span className="font-mono">
                {maskAddress(template.target_type, template.target_address)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              aria-label={
                template.status === "active" ? "Arquivar" : "Reativar"
              }
              onClick={onArchiveToggle}
              disabled={disabled}
              title={
                template.status === "active" ? "Arquivar" : "Reativar"
              }
            >
              <span
                className={cn(
                  "size-2 rounded-full",
                  template.status === "active"
                    ? "bg-success"
                    : "bg-muted-foreground/40",
                )}
                aria-hidden
              />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              aria-label="Editar"
              onClick={onEdit}
              disabled={disabled}
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              aria-label="Apagar"
              onClick={onDelete}
              disabled={disabled}
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

type EditorErrors = Partial<Record<
  "name" | "description" | "target_address" | "body_template",
  string
>>;

interface EditorDialogProps {
  editor: EditorState;
  errors: EditorErrors;
  hasErrors: boolean;
  onChange: React.Dispatch<React.SetStateAction<EditorState>>;
  onSave: () => void;
  isPending: boolean;
}

function NotificationEditorDialog({
  editor,
  errors,
  hasErrors,
  onChange,
  onSave,
  isPending,
}: EditorDialogProps) {
  const placeholders = React.useMemo(
    () => listNotificationPlaceholders(editor.body_template),
    [editor.body_template],
  );
  const unknownFixed = placeholders.filter(
    (p) => p.kind === "fixed" && !isKnownFixedVariable(p.name),
  );

  return (
    <Dialog
      open={editor.open}
      onOpenChange={(open) => {
        if (!open) onChange(EMPTY_EDITOR);
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editor.source ? "Editar notificação" : "Nova notificação"}
          </DialogTitle>
          <DialogDescription>
            O agente lê a descrição pra decidir quando disparar. Use variáveis{" "}
            <code className="font-mono">{`{{lead_name}}`}</code>,{" "}
            <code className="font-mono">{`{{custom.foo}}`}</code> no corpo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="notif-name">Nome</Label>
            <Input
              id="notif-name"
              value={editor.name}
              onChange={(e) =>
                onChange((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder="Ex: Lead qualificado"
              disabled={isPending}
              maxLength={NOTIFICATION_TEMPLATE_NAME_MAX_CHARS}
              aria-invalid={!!errors.name}
              className={errors.name ? "border-destructive focus-visible:ring-destructive/40" : undefined}
            />
            {errors.name ? (
              <p className="text-xs text-destructive">{errors.name}</p>
            ) : editor.name.trim() ? (
              <p className="text-xs text-muted-foreground">
                Tool registrada como{" "}
                <code className="font-mono">
                  {buildNotificationToolName(editor.name)}
                </code>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Mínimo {NOTIFICATION_TEMPLATE_NAME_MIN_CHARS} caracteres. Vira o nome do tool que o agente enxerga.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notif-description">Quando disparar (pro agente)</Label>
            <Textarea
              id="notif-description"
              value={editor.description}
              onChange={(e) =>
                onChange((prev) => ({ ...prev, description: e.target.value }))
              }
              placeholder="Ex: Quando o lead confirmar interesse no produto e dizer que tem orçamento."
              rows={2}
              disabled={isPending}
              maxLength={NOTIFICATION_TEMPLATE_DESCRIPTION_MAX_CHARS}
              aria-invalid={!!errors.description}
              className={errors.description ? "border-destructive focus-visible:ring-destructive/40" : undefined}
            />
            <div className="flex items-center justify-between gap-2">
              {errors.description ? (
                <p className="text-xs text-destructive flex-1">{errors.description}</p>
              ) : (
                <p className="text-xs text-muted-foreground flex-1">
                  Descreva pra o LLM quando este template deve ser disparado.
                </p>
              )}
              <p className="text-xs text-muted-foreground tabular-nums shrink-0">
                {editor.description.length} /{" "}
                {NOTIFICATION_TEMPLATE_DESCRIPTION_MAX_CHARS}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Tipo de destino</Label>
            <div className="flex gap-2">
              <TargetTypeButton
                active={editor.target_type === "phone"}
                icon={Phone}
                label="Telefone"
                onClick={() =>
                  onChange((prev) => ({ ...prev, target_type: "phone" }))
                }
              />
              <TargetTypeButton
                active={editor.target_type === "group"}
                icon={Users}
                label="Grupo"
                onClick={() =>
                  onChange((prev) => ({ ...prev, target_type: "group" }))
                }
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notif-address">
              {editor.target_type === "phone"
                ? "Número de telefone"
                : "JID do grupo"}
            </Label>
            <Input
              id="notif-address"
              value={editor.target_address}
              onChange={(e) =>
                onChange((prev) => ({
                  ...prev,
                  target_address: e.target.value,
                }))
              }
              placeholder={
                editor.target_type === "phone"
                  ? "Ex: 5511999999999"
                  : "Ex: 120363027489123456@g.us"
              }
              disabled={isPending}
              aria-invalid={!!errors.target_address}
              className={errors.target_address ? "border-destructive focus-visible:ring-destructive/40" : undefined}
            />
            {errors.target_address ? (
              <p className="text-xs text-destructive">{errors.target_address}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {editor.target_type === "phone"
                  ? `Número completo com DDI + DDD. ${NOTIFICATION_PHONE_MIN_DIGITS}–${NOTIFICATION_PHONE_MAX_DIGITS} dígitos.`
                  : "JID do grupo no formato 1203...@g.us. Copie do UAZAPI ou WhatsApp Business."}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notif-body">Corpo da mensagem</Label>
            <Textarea
              id="notif-body"
              value={editor.body_template}
              onChange={(e) =>
                onChange((prev) => ({
                  ...prev,
                  body_template: e.target.value,
                }))
              }
              placeholder={`Lead {{lead_name}} ({{lead_phone}}) qualificou. Abrir conversa: {{wa_link}}`}
              rows={6}
              disabled={isPending}
              maxLength={NOTIFICATION_TEMPLATE_BODY_MAX_LENGTH}
              aria-invalid={!!errors.body_template}
              className={cn(
                "font-mono text-xs",
                errors.body_template && "border-destructive focus-visible:ring-destructive/40",
              )}
            />
            {errors.body_template ? (
              <p className="text-xs text-destructive">{errors.body_template}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground mr-1">
                Variáveis fixas:
              </span>
              {NOTIFICATION_FIXED_VARIABLES.map((variable) => {
                const used = placeholders.some(
                  (p) => p.kind === "fixed" && p.name === variable,
                );
                return (
                  <Badge
                    key={variable}
                    variant={used ? "default" : "outline"}
                    className={cn(
                      "text-xs font-mono cursor-pointer transition-opacity",
                      used ? "opacity-100" : "opacity-70 hover:opacity-100",
                    )}
                    onClick={() =>
                      onChange((prev) => ({
                        ...prev,
                        body_template: `${prev.body_template}{{${variable}}}`,
                      }))
                    }
                  >
                    {`{{${variable}}}`}
                  </Badge>
                );
              })}
              <span className="text-xs text-muted-foreground/70 ml-1">
                + variáveis customizadas via{" "}
                <code className="font-mono">{`{{custom.foo}}`}</code>
              </span>
            </div>
            {unknownFixed.length > 0 ? (
              <p className="text-xs text-warning">
                Placeholders desconhecidos serão renderizados vazios:{" "}
                {unknownFixed.map((p) => `{{${p.name}}}`).join(", ")}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground tabular-nums">
              {editor.body_template.length} /{" "}
              {NOTIFICATION_TEMPLATE_BODY_MAX_LENGTH}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onChange(EMPTY_EDITOR)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={isPending || hasErrors}>
            {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function validateEditor(editor: EditorState): EditorErrors {
  const errors: EditorErrors = {};
  const name = editor.name.trim();
  const description = editor.description.trim();
  const body = editor.body_template.trim();
  const address = editor.target_address.trim();

  if (!name) {
    errors.name = "Nome é obrigatório";
  } else if (name.length < NOTIFICATION_TEMPLATE_NAME_MIN_CHARS) {
    errors.name = `Mínimo ${NOTIFICATION_TEMPLATE_NAME_MIN_CHARS} caracteres`;
  } else if (name.length > NOTIFICATION_TEMPLATE_NAME_MAX_CHARS) {
    errors.name = `Máximo ${NOTIFICATION_TEMPLATE_NAME_MAX_CHARS} caracteres`;
  }

  if (!description) {
    errors.description = "Descrição é obrigatória";
  } else if (description.length < NOTIFICATION_TEMPLATE_DESCRIPTION_MIN_CHARS) {
    errors.description = `Mínimo ${NOTIFICATION_TEMPLATE_DESCRIPTION_MIN_CHARS} caracteres. Descreva quando o agente deve usar esse template.`;
  } else if (description.length > NOTIFICATION_TEMPLATE_DESCRIPTION_MAX_CHARS) {
    errors.description = `Máximo ${NOTIFICATION_TEMPLATE_DESCRIPTION_MAX_CHARS} caracteres`;
  }

  if (!address) {
    errors.target_address = "Destino é obrigatório";
  } else if (editor.target_type === "phone") {
    const digits = address.replace(/\D/g, "");
    if (digits.length < NOTIFICATION_PHONE_MIN_DIGITS) {
      errors.target_address = `Telefone tem menos de ${NOTIFICATION_PHONE_MIN_DIGITS} dígitos`;
    } else if (digits.length > NOTIFICATION_PHONE_MAX_DIGITS) {
      errors.target_address = `Telefone tem mais de ${NOTIFICATION_PHONE_MAX_DIGITS} dígitos`;
    }
  } else if (address.length < 5) {
    errors.target_address = "JID do grupo é muito curto";
  }

  if (!body) {
    errors.body_template = "Corpo da mensagem é obrigatório";
  } else if (body.length > NOTIFICATION_TEMPLATE_BODY_MAX_LENGTH) {
    errors.body_template = `Máximo ${NOTIFICATION_TEMPLATE_BODY_MAX_LENGTH} caracteres`;
  }

  return errors;
}

interface TargetTypeButtonProps {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}

function TargetTypeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: TargetTypeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
        active
          ? "border-primary bg-primary/5 text-foreground"
          : "border-input hover:border-foreground/30 text-muted-foreground",
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}

function maskAddress(
  type: NotificationTargetType,
  address: string,
): string {
  const trimmed = address.trim();
  if (trimmed.length <= 4) return trimmed;
  const visible = trimmed.slice(-4);
  return type === "phone" ? `***${visible}` : `***${visible}@g.us`;
}
