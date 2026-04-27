"use client";

// Tab "Produtos" do drawer "Informacoes do lead" (Fase 4).
// Lista produtos vinculados, permite adicionar do catalogo + remover.
// CRUD do catalogo em si (criar produto novo) fica em /settings/products
// (futuro) — aqui so usa o que ja existe.

import * as React from "react";
import { toast } from "sonner";
import { Loader2, Package, Plus, Trash2 } from "lucide-react";
import type {
  LeadProductWithProduct,
  Product,
} from "@persia/shared/crm";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import {
  addProductToLead,
  getLeadProducts,
  getProducts,
  removeProductFromLead,
} from "@/actions/products";

interface Props {
  leadId: string;
  /** Reabre quando o drawer abre (forca refetch) */
  active: boolean;
}

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function LeadProductsTab({ leadId, active }: Props) {
  const [items, setItems] = React.useState<LeadProductWithProduct[]>([]);
  const [catalog, setCatalog] = React.useState<Product[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [isPending, startTransition] = React.useTransition();

  // Form de adicionar
  const [addProductId, setAddProductId] = React.useState("");
  const [addQuantity, setAddQuantity] = React.useState("1");
  const [addPrice, setAddPrice] = React.useState("");

  React.useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([getLeadProducts(leadId), getProducts()])
      .then(([linked, all]) => {
        if (cancelled) return;
        setItems(linked);
        setCatalog(all);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(
          err instanceof Error ? err.message : "Erro ao carregar produtos",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leadId, active]);

  function handleAdd() {
    if (!addProductId) {
      toast.error("Selecione um produto");
      return;
    }
    const qty = Math.max(1, Math.floor(Number(addQuantity) || 1));
    const priceNum = addPrice ? Number(addPrice) : undefined;

    startTransition(async () => {
      try {
        const created = await addProductToLead({
          lead_id: leadId,
          product_id: addProductId,
          quantity: qty,
          unit_price: priceNum,
        });
        setItems((prev) => [created, ...prev]);
        setAddProductId("");
        setAddQuantity("1");
        setAddPrice("");
        toast.success("Produto vinculado");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Erro ao vincular produto",
        );
      }
    });
  }

  function handleRemove(linkedId: string) {
    const previous = items;
    setItems((prev) => prev.filter((i) => i.id !== linkedId));
    startTransition(async () => {
      try {
        await removeProductFromLead(linkedId);
        toast.success("Produto removido");
      } catch (err) {
        setItems(previous);
        toast.error(
          err instanceof Error ? err.message : "Erro ao remover",
        );
      }
    });
  }

  const total = items.reduce(
    (sum, i) => sum + Number(i.unit_price) * i.quantity,
    0,
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Form de adicionar */}
      <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
        <Label className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
          <Plus className="size-3.5" />
          Vincular produto
        </Label>
        <div className="flex flex-col sm:flex-row gap-2">
          <Select
            value={addProductId}
            onValueChange={(v) => {
              setAddProductId(v ?? "");
              const p = catalog.find((c) => c.id === v);
              if (p) setAddPrice(String(p.price));
            }}
          >
            <SelectTrigger className="w-full sm:flex-1">
              <SelectValue placeholder="Escolha um produto" />
            </SelectTrigger>
            <SelectContent>
              {catalog.length === 0 ? (
                <SelectItem value="_none" disabled>
                  Sem produtos cadastrados
                </SelectItem>
              ) : (
                catalog.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={1}
            value={addQuantity}
            onChange={(e) => setAddQuantity(e.target.value)}
            placeholder="Qtd"
            className="w-full sm:w-20"
            aria-label="Quantidade"
          />
          <Input
            type="number"
            step="0.01"
            min={0}
            value={addPrice}
            onChange={(e) => setAddPrice(e.target.value)}
            placeholder="Preço"
            className="w-full sm:w-28"
            aria-label="Preço unitário"
          />
          <Button
            type="button"
            onClick={handleAdd}
            disabled={isPending || !addProductId}
            size="sm"
            className="shrink-0"
          >
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Adicionar
          </Button>
        </div>
      </div>

      {/* Lista vinculados */}
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          <Package className="mx-auto size-6 mb-2 opacity-60" />
          Nenhum produto vinculado a este lead.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-start justify-between gap-3 rounded-lg border bg-card p-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {item.products?.name ?? "Produto removido"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {item.quantity} × {formatBRL(Number(item.unit_price))} ={" "}
                  <span className="font-medium text-foreground">
                    {formatBRL(Number(item.unit_price) * item.quantity)}
                  </span>
                </p>
                {item.notes ? (
                  <p className="text-[11px] text-muted-foreground mt-0.5 italic">
                    {item.notes}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => handleRemove(item.id)}
                disabled={isPending}
                title="Remover produto"
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="font-semibold">{formatBRL(total)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
