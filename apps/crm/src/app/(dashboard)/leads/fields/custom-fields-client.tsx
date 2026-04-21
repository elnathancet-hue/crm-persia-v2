"use client";

import * as React from "react";
import { Plus, Pencil, Trash2, TextCursorInput } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import {
  createCustomField,
  updateCustomField,
  deleteCustomField,
} from "@/actions/custom-fields";

interface CustomField {
  id: string;
  name: string;
  field_key: string;
  field_type: string;
  options: string[];
  created_at: string;
}

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: "Texto",
  number: "Número",
  date: "Data",
  select: "Seleção",
  boolean: "Sim/Não",
  url: "URL",
  email: "Email",
  phone: "Telefone",
};

function toFieldKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/(^_|_$)/g, "");
}

export function CustomFieldsClient({
  initialFields,
}: {
  initialFields: CustomField[];
}) {
  const [fields, setFields] = React.useState<CustomField[]>(initialFields);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [editingField, setEditingField] = React.useState<CustomField | null>(null);
  const [deletingField, setDeletingField] = React.useState<CustomField | null>(null);
  const [saving, setSaving] = React.useState(false);

  const [name, setName] = React.useState("");
  const [fieldKey, setFieldKey] = React.useState("");
  const [fieldType, setFieldType] = React.useState("text");
  const [options, setOptions] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  function setError(field: string, msg: string) {
    setErrors(prev => ({ ...prev, [field]: msg }));
  }

  function clearError(field: string) {
    setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  }

  function openCreateDialog() {
    setEditingField(null);
    setName("");
    setFieldKey("");
    setFieldType("text");
    setOptions("");
    setErrors({});
    setDialogOpen(true);
  }

  function openEditDialog(field: CustomField) {
    setEditingField(field);
    setName(field.name);
    setFieldKey(field.field_key);
    setFieldType(field.field_type);
    setOptions((field.options || []).join(", "));
    setDialogOpen(true);
  }

  function handleNameChange(value: string) {
    setName(value);
    if (!editingField) {
      setFieldKey(toFieldKey(value));
    }
  }

  async function handleSave() {
    let valid = true;
    if (!name.trim()) { setError("cf_name", "Campo obrigatório"); valid = false; } else { clearError("cf_name"); }
    if (!fieldKey.trim()) { setError("cf_key", "Campo obrigatório"); valid = false; } else { clearError("cf_key"); }
    if (!valid) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set("name", name.trim());
      fd.set("field_key", fieldKey.trim());
      fd.set("field_type", fieldType);
      fd.set("options", options);

      if (editingField) {
        await updateCustomField(editingField.id, fd);
        setFields((prev) =>
          prev.map((f) =>
            f.id === editingField.id
              ? {
                  ...f,
                  name: name.trim(),
                  field_type: fieldType,
                  options: options
                    ? options
                        .split(",")
                        .map((o) => o.trim())
                        .filter(Boolean)
                    : [],
                }
              : f
          )
        );
      } else {
        const newField = await createCustomField(fd);
        if (newField) {
          setFields((prev) => [newField as CustomField, ...prev]);
        }
      }
      setDialogOpen(false);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  function openDeleteDialog(field: CustomField) {
    setDeletingField(field);
    setDeleteOpen(true);
  }

  async function handleDelete() {
    if (!deletingField) return;
    setSaving(true);
    try {
      await deleteCustomField(deletingField.id);
      setFields((prev) => prev.filter((f) => f.id !== deletingField.id));
      setDeleteOpen(false);
      setDeletingField(null);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={openCreateDialog}>
          <Plus className="size-4" />
          Novo Campo
        </Button>
      </div>

      {fields.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <TextCursorInput className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Nenhum campo personalizado</p>
            <p className="text-sm text-muted-foreground">
              Crie campos extras para capturar dados dos leads
            </p>
            <Button className="mt-4" onClick={openCreateDialog}>
              <Plus className="size-4" />
              Criar primeiro campo
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Chave</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Opções</TableHead>
              <TableHead>Criação</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((field) => (
              <TableRow key={field.id}>
                <TableCell className="font-medium">{field.name}</TableCell>
                <TableCell>
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                    {field.field_key}
                  </code>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {FIELD_TYPE_LABELS[field.field_type] || field.field_type}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                  {field.field_type === "select"
                    ? (field.options || []).join(", ") || "-"
                    : "-"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(field.created_at).toLocaleDateString("pt-BR")}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditDialog(field)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() => openDeleteDialog(field)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingField ? "Editar Campo" : "Novo Campo Personalizado"}
            </DialogTitle>
            <DialogDescription>
              {editingField
                ? "Altere as configuracoes do campo"
                : "Defina um campo extra para seus leads"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cf-name">Nome *</Label>
              <Input
                id="cf-name"
                placeholder="Ex: Empresa"
                value={name}
                onChange={(e) => { handleNameChange(e.target.value); clearError("cf_name"); }}
                onBlur={() => { if (!name.trim()) setError("cf_name", "Campo obrigatório"); else clearError("cf_name"); }}
                className={errors.cf_name ? "border-destructive focus-visible:ring-destructive/50" : ""}
              />
              {errors.cf_name && <p className="text-xs text-destructive mt-1">{errors.cf_name}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="cf-key">Chave *</Label>
              <Input
                id="cf-key"
                placeholder="empresa"
                value={fieldKey}
                onChange={(e) => { setFieldKey(e.target.value); clearError("cf_key"); }}
                onBlur={() => { if (!fieldKey.trim()) setError("cf_key", "Campo obrigatório"); else clearError("cf_key"); }}
                disabled={!!editingField}
                className={errors.cf_key ? "border-destructive focus-visible:ring-destructive/50" : ""}
              />
              {errors.cf_key && <p className="text-xs text-destructive mt-1">{errors.cf_key}</p>}
              <p className="text-xs text-muted-foreground">
                Identificador unico do campo (gerado automaticamente)
              </p>
            </div>
            <div className="space-y-2">
              <Label>Tipo do campo</Label>
              <Select
                value={fieldType}
                onValueChange={(v) => setFieldType(v ?? "text")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Texto</SelectItem>
                  <SelectItem value="number">Número</SelectItem>
                  <SelectItem value="date">Data</SelectItem>
                  <SelectItem value="select">Seleção</SelectItem>
                  <SelectItem value="boolean">Sim/Não</SelectItem>
                  <SelectItem value="url">URL</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="phone">Telefone</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {fieldType === "select" && (
              <div className="space-y-2">
                <Label htmlFor="cf-options">Opcoes (separadas por virgula)</Label>
                <Input
                  id="cf-options"
                  placeholder="Ex: Opcao 1, Opcao 2, Opcao 3"
                  value={options}
                  onChange={(e) => setOptions(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button
              onClick={handleSave}
              disabled={saving || !name.trim() || !fieldKey.trim()}
            >
              {saving
                ? "Salvando..."
                : editingField
                ? "Salvar"
                : "Criar Campo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir Campo</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir o campo{" "}
              <strong>{deletingField?.name}</strong>? Todos os valores salvos
              serao perdidos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={saving}
            >
              {saving ? "Excluindo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
