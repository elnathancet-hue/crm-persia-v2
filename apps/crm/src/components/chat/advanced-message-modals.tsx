"use client";

import { useState } from "react";
import { Button } from "@persia/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@persia/ui/dialog";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { sendAdvancedMessageViaWhatsApp } from "@/actions/messages";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type ModalsProps = {
  conversationId: string;
  type: "location" | "contact" | "pix" | "payment" | "location_button" | null;
  onClose: () => void;
  onSent: (msg: any) => void;
};

export function AdvancedMessageModals({ conversationId, type, onClose, onSent }: ModalsProps) {
  const [sending, setSending] = useState(false);

  // States
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!type) return;

    setSending(true);
    let payloadData: any = {};

    try {
      switch (type) {
        case "location":
          payloadData = { latitude: parseFloat(latitude), longitude: parseFloat(longitude), name };
          break;
        case "contact":
          payloadData = { fullName: name, phoneNumber: phone };
          break;
        case "pix":
          payloadData = { pixKey, pixName: name, pixType: "EVP" }; // simplification
          break;
        case "payment":
          payloadData = { amount: parseFloat(amount), pixKey };
          break;
        case "location_button":
          payloadData = { text: name };
          break;
      }

      const { data, error } = await sendAdvancedMessageViaWhatsApp(conversationId, {
        type,
        data: payloadData,
      });

      if (data) {
        onSent(data);
        onClose();
        toast.success("Mensagem enviada");
      }
      if (error) throw new Error(error);
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar mensagem");
    } finally {
      setSending(false);
    }
  };

  const getTitle = () => {
    switch (type) {
      case "location": return "Enviar Localização";
      case "contact": return "Enviar Contato";
      case "pix": return "Enviar Chave PIX";
      case "payment": return "Enviar Cobrança";
      case "location_button": return "Botão de Localização";
      default: return "";
    }
  };

  return (
    <Dialog open={!!type} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {type === "location" && (
            <>
              <div className="grid gap-2">
                <Label>Nome do local (Opcional)</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Latitude</Label>
                  <Input required value={latitude} onChange={(e) => setLatitude(e.target.value)} type="number" step="any" />
                </div>
                <div className="grid gap-2">
                  <Label>Longitude</Label>
                  <Input required value={longitude} onChange={(e) => setLongitude(e.target.value)} type="number" step="any" />
                </div>
              </div>
            </>
          )}

          {type === "contact" && (
            <>
              <div className="grid gap-2">
                <Label>Nome completo</Label>
                <Input required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Telefone</Label>
                <Input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ex: 5511999999999" />
              </div>
            </>
          )}

          {(type === "pix" || type === "payment") && (
            <>
              {type === "payment" && (
                <div className="grid gap-2">
                  <Label>Valor (R$)</Label>
                  <Input required value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" />
                </div>
              )}
              <div className="grid gap-2">
                <Label>Chave PIX</Label>
                <Input required value={pixKey} onChange={(e) => setPixKey(e.target.value)} />
              </div>
              {type === "pix" && (
                <div className="grid gap-2">
                  <Label>Nome do Beneficiário (Opcional)</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
              )}
            </>
          )}

          {type === "location_button" && (
            <div className="grid gap-2">
              <Label>Texto do botão</Label>
              <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Enviar minha localização" />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={sending}>Cancelar</Button>
            <Button type="submit" disabled={sending}>
              {sending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Enviar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
