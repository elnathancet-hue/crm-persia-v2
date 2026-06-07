"use client";

import * as React from "react";
import { toast } from "sonner";
import { Package, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import { Switch } from "@persia/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Badge } from "@persia/ui/badge";
import type { OrgProduct } from "@persia/shared/crm";
import {
  createOrgProduct,
  updateOrgProduct,
  deleteOrgProduct,
  getOrgProducts,
} from "@/actions/products";
import { useRole } from "@/lib/hooks/use-role";

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface ProductFormState {
  name: string;
  description: string;
  price: string;
  is_active: boolean;
}

const EMPTY_FORM: ProductFormState = {
  name: "",
  description: "",
  price: "0,00",
  is_active: true,
};

function productToForm(p: OrgProduct): ProductFormState {
  return {
    name: p.name,
    description: p.description ?? "",
    price: formatBRL(p.price),
    is_active: p.is_active,
  };
}

export function ProdutosTab({ initialProducts }: { initialProducts: OrgProduct[] }) {
  const { isAdmin } = useRole();
  const [products, setProducts] = React.useState<OrgProduct[]>(initialProducts);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<OrgProduct | null>(null);
  const [form, setForm] = React.useState<ProductFormState>(EMPTY_FORM);
  const [pending, setPending] = React.useState(false);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (p: OrgProduct) => {
    setEditing(p);
    setForm(productToForm(p));
    setDialogOpen(true);
  };

  const set = (key: keyof ProductFormState, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    const price = parseFloat(form.price.replace(/\./g, "").replace(",", "."));
    if (isNaN(price) || price < 0) {
      toast.error("Valor inválido");
      return;
    }
    setPending(true);
    try {
      if (editing) {
        await updateOrgProduct(editing.id, {
          name: form.name.trim(),
          description: form.description.trim() || null,
          price,
          is_active: form.is_active,
        });
        setProducts((prev) =>
          prev.map((p) =>
            p.id === editing.id
              ? { ...p, name: form.name.trim(), description: form.description.trim() || null, price, is_active: form.is_active }
              : p,
          ),
        );
        toast.success("Produto atualizado");
      } else {
        const created = await createOrgProduct({
          name: form.name.trim(),
          description: form.description.trim() || null,
          price,
          is_active: form.is_active,
        });
        setProducts((prev) => [...prev, created]);
        toast.success("Produto criado");
      }
      setDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar");
    } finally {
      setPending(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteOrgProduct(id);
      setProducts((prev) => prev.filter((p) => p.id !== id));
      toast.success("Produto excluído");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível excluir");
    }
  };

  const handleToggleActive = async (p: OrgProduct) => {
    try {
      await updateOrgProduct(p.id, { is_active: !p.is_active });
      setProducts((prev) =>
        prev.map((item) => (item.id === p.id ? { ...item, is_active: !p.is_active } : item)),
      );
    } catch {
      toast.error("Não foi possível atualizar o status");
      // Recarrega do servidor em caso de falha
      getOrgProducts().then(setProducts).catch(() => {});
    }
  };

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">
              Catálogo de produtos e serviços disponíveis para vincular a leads.
            </p>
          </div>
          <Button type="button" onClick={openCreate} className="h-9 gap-1.5 shrink-0">
            <Plus className="size-4" aria-hidden />
            Novo produto
          </Button>
        </div>

        {/* Lista */}
        {products.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-12 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Package className="size-6" />
            </div>
            <h2 className="mt-3 text-base font-semibold">Nenhum produto cadastrado</h2>
            <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
              Cadastre produtos ou serviços para vincular a leads no drawer de informações.
            </p>
            <Button type="button" onClick={openCreate} className="mt-5 h-10 gap-1.5">
              <Plus className="size-4" aria-hidden />
              Cadastrar produto
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Nome</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden sm:table-cell">Descrição</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Valor</th>
                  <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products.map((p) => (
                  <tr key={p.id} className="bg-card hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Package className="size-4 shrink-0 text-primary/60" />
                        <span className="font-medium text-foreground">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell max-w-[200px] truncate">
                      {p.description ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                      R$ {formatBRL(p.price)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(p)}
                        title={p.is_active ? "Desativar" : "Ativar"}
                        className="inline-flex"
                      >
                        <Badge
                          variant={p.is_active ? "default" : "secondary"}
                          className={p.is_active ? "bg-success text-success-foreground" : ""}
                        >
                          {p.is_active ? "Ativo" : "Inativo"}
                        </Badge>
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(p)}
                          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          title="Editar"
                        >
                          <Pencil className="size-4" />
                        </button>
                        {isAdmin && (
                          <AlertDialog>
                            <AlertDialogTrigger
                              type="button"
                              className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                              title="Excluir"
                            >
                              <Trash2 className="size-4" />
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Excluir produto</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Tem certeza que deseja excluir <strong>{p.name}</strong>? Esta ação não pode ser desfeita.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDelete(p.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Excluir
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dialog criar/editar */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="rounded-2xl w-[92vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar produto" : "Novo produto"}</DialogTitle>
            <DialogDescription className="sr-only">
              Preencha os dados do produto ou serviço.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input
                name="nome"
                placeholder="Ex: Consultoria jurídica"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Textarea
                name="descricao"
                placeholder="Breve descrição do produto/serviço"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Valor (R$)</Label>
              <Input
                name="preco"
                placeholder="0,00"
                value={form.price}
                onChange={(e) => set("price", e.target.value)}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => set("is_active", v)}
                id="product-active"
              />
              <Label htmlFor="product-active">Ativo</Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : editing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
