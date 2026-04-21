"use client";

import * as React from "react";
import {
  Bot,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Save,
  Send,
  ShoppingCart,
  Headphones,
  GraduationCap,
  Briefcase,
  MoreHorizontal,
  Power,
  PowerOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToneSelector } from "@/components/ai/tone-selector";
import { createAssistant, updateAssistant, deleteAssistant, testAssistant } from "@/actions/ai";
import { toast } from "sonner";

interface Assistant {
  id: string;
  name: string;
  description: string | null;
  category: string;
  prompt: string;
  tone: string;
  model: string;
  is_active: boolean;
  created_at: string;
}

const CATEGORY_CONFIG: Record<string, { label: string; icon: typeof Bot; color: string }> = {
  geral: { label: "Geral", icon: Bot, color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  vendas: { label: "Vendas", icon: ShoppingCart, color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
  suporte: { label: "Suporte", icon: Headphones, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  educacao: { label: "Educação", icon: GraduationCap, color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" },
  consultoria: { label: "Consultoria", icon: Briefcase, color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" },
};

export function AssistantListClient({ initialAssistants }: { initialAssistants: Assistant[] }) {
  const [assistants, setAssistants] = React.useState<Assistant[]>(initialAssistants);
  const [editOpen, setEditOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  // Form state
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [category, setCategory] = React.useState("geral");
  const [prompt, setPrompt] = React.useState("");
  const [tone, setTone] = React.useState("amigavel");
  const [isActive, setIsActive] = React.useState(true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  function setError(field: string, msg: string) {
    setErrors(prev => ({ ...prev, [field]: msg }));
  }

  function clearError(field: string) {
    setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  }

  function validateAssistantField(field: string, value: string, rules: { required?: boolean; minLength?: number }) {
    if (rules.required && !value.trim()) { setError(field, "Campo obrigatório"); return false; }
    if (rules.minLength && value.trim().length < rules.minLength) { setError(field, `Mínimo ${rules.minLength} caracteres`); return false; }
    clearError(field);
    return true;
  }

  // Test
  const [testOpen, setTestOpen] = React.useState(false);
  const [testId, setTestId] = React.useState<string | null>(null);
  const [testMsg, setTestMsg] = React.useState("");
  const [testResp, setTestResp] = React.useState("");
  const [testing, setTesting] = React.useState(false);

  function openCreate() {
    setEditingId(null);
    setName("");
    setDescription("");
    setCategory("geral");
    setPrompt("");
    setTone("amigavel");
    setIsActive(true);
    setErrors({});
    setEditOpen(true);
  }

  function openEdit(a: Assistant) {
    setEditingId(a.id);
    setName(a.name);
    setDescription(a.description || "");
    setCategory(a.category || "geral");
    setPrompt(a.prompt);
    setTone(a.tone || "amigavel");
    setIsActive(a.is_active);
    setEditOpen(true);
  }

  async function handleSave() {
    let valid = true;
    if (!validateAssistantField("ai_name", name, { required: true })) valid = false;
    if (!validateAssistantField("ai_prompt", prompt, { required: true, minLength: 20 })) valid = false;
    if (!valid) return;
    setSaving(true);
    try {
      const data: Record<string, any> = { name: name.trim(), description: description.trim() || "", category, prompt: prompt.trim(), tone, is_active: isActive };

      if (editingId) {
        await updateAssistant(editingId, data as any);
        setAssistants((prev) => prev.map((a) => (a.id === editingId ? { ...a, ...data } as Assistant : a)));
        toast.success("Assistente atualizado");
      } else {
        const newA = await createAssistant(data as any);
        if (newA) setAssistants((prev) => [...prev, newA as Assistant]);
        toast.success("Assistente criado");
      }
      setEditOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteAssistant(id);
      setAssistants((prev) => prev.filter((a) => a.id !== id));
      toast.success("Assistente removido");
    } catch (err: any) {
      toast.error(err.message || "Erro ao remover");
    }
  }

  async function handleToggle(a: Assistant) {
    try {
      await updateAssistant(a.id, { is_active: !a.is_active });
      setAssistants((prev) => prev.map((x) => (x.id === a.id ? { ...x, is_active: !x.is_active } : x)));
    } catch {}
  }

  async function handleTest() {
    if (!testId || !testMsg.trim()) return;
    setTesting(true);
    setTestResp("");
    try {
      const result = await testAssistant(testId, testMsg.trim());
      if (result.error) toast.error(result.error);
      else setTestResp(result.response);
    } catch {
      toast.error("Erro ao testar");
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          Novo Assistente
        </Button>
      </div>

      {assistants.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="size-14 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
              <Bot className="size-7 text-muted-foreground/60" />
            </div>
            <p className="text-base font-semibold">Nenhum assistente</p>
            <p className="text-sm text-muted-foreground mt-1">
              Crie assistentes especializados para apoiar seus agentes
            </p>
            <Button className="mt-4" onClick={openCreate}>
              <Plus className="size-4" />
              Criar primeiro assistente
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {assistants.map((a) => {
            const cat = CATEGORY_CONFIG[a.category] || CATEGORY_CONFIG.geral;
            const CatIcon = cat.icon;
            return (
              <Card key={a.id} className="hover:border-primary/30 transition-colors">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`size-10 rounded-xl flex items-center justify-center ${cat.color}`}>
                        <CatIcon className="size-5" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{a.name}</p>
                        <Badge variant="secondary" className={`text-[10px] mt-0.5 ${cat.color}`}>
                          {cat.label}
                        </Badge>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger>
                        <Button variant="ghost" size="icon-sm" className="size-7">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(a)}>
                          <Pencil className="size-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setTestId(a.id); setTestMsg(""); setTestResp(""); setTestOpen(true); }}>
                          <Send className="size-4" />
                          Testar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleToggle(a)}>
                          {a.is_active ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                          {a.is_active ? "Desativar" : "Ativar"}
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => handleDelete(a.id)}>
                          <Trash2 className="size-4" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {a.description && (
                    <p className="text-xs text-muted-foreground mt-3 line-clamp-2">{a.description}</p>
                  )}

                  <div className="flex items-center gap-2 mt-3">
                    <div className={`size-2 rounded-full ${a.is_active ? "bg-green-500" : "bg-gray-400"}`} />
                    <span className="text-xs text-muted-foreground">{a.is_active ? "Ativo" : "Inativo"}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{a.model || "gpt-4.1-mini"}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Assistente" : "Novo Assistente"}</DialogTitle>
            <DialogDescription>
              {editingId ? "Atualize as configuracoes do assistente" : "Crie um assistente especializado para apoiar seus agentes"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input
                  placeholder="Ex: Agente de Vendas"
                  value={name}
                  onChange={(e) => { setName(e.target.value); clearError("ai_name"); }}
                  onBlur={() => validateAssistantField("ai_name", name, { required: true })}
                  className={errors.ai_name ? "border-destructive focus-visible:ring-destructive/50" : ""}
                />
                {errors.ai_name && <p className="text-xs text-destructive mt-1">{errors.ai_name}</p>}
              </div>
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select value={category} onValueChange={(v) => setCategory(v ?? "geral")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="geral">Geral</SelectItem>
                    <SelectItem value="vendas">Vendas</SelectItem>
                    <SelectItem value="suporte">Suporte</SelectItem>
                    <SelectItem value="educacao">Educação</SelectItem>
                    <SelectItem value="consultoria">Consultoria</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Descrição curta</Label>
              <Input placeholder="Ex: Especialista em fechar vendas com leads quentes" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Prompt (Instrucoes) *</Label>
              <Textarea
                placeholder="Descreva tudo que esse assistente deve saber: produtos, precos, FAQ, regras de atendimento..."
                value={prompt}
                onChange={(e) => { setPrompt(e.target.value); clearError("ai_prompt"); }}
                onBlur={() => validateAssistantField("ai_prompt", prompt, { required: true, minLength: 20 })}
                className={`min-h-32 ${errors.ai_prompt ? "border-destructive focus-visible:ring-destructive/50" : ""}`}
              />
              {errors.ai_prompt && <p className="text-xs text-destructive mt-1">{errors.ai_prompt}</p>}
              <p className="text-xs text-muted-foreground">Quanto mais detalhado, melhor o apoio ao agente</p>
            </div>

            <div className="space-y-2">
              <Label>Tom de conversa</Label>
              <ToneSelector value={tone} onChange={setTone} />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Ativo</p>
                <p className="text-xs text-muted-foreground">Disponivel para uso no chat</p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test Dialog */}
      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="size-5" />
              Testar Assistente
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Faca uma pergunta..."
                value={testMsg}
                onChange={(e) => setTestMsg(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleTest(); }}
              />
              <Button onClick={handleTest} disabled={testing || !testMsg.trim()}>
                {testing ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </div>
            {testing && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Gerando...
              </div>
            )}
            {testResp && (
              <div className="rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap">{testResp}</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
