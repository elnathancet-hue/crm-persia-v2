"use client";

import { useTransition, useState } from "react";
import { signUp } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Link from "next/link";
import { Loader2, User, Building2, Mail, Lock } from "lucide-react";

const NICHES = [
  { value: "advocacia", label: "Advocacia" },
  { value: "clinica", label: "Clínica / Saúde" },
  { value: "imobiliaria", label: "Imobiliária" },
  { value: "ecommerce", label: "E-commerce / Loja" },
  { value: "agencia", label: "Agência de Marketing" },
  { value: "educacao", label: "Educação" },
  { value: "restaurante", label: "Restaurante / Alimentação" },
  { value: "beleza", label: "Beleza / Estética" },
  { value: "contabilidade", label: "Contabilidade" },
  { value: "tecnologia", label: "Tecnologia / SaaS" },
  { value: "outro", label: "Outro" },
];

export default function RegisterPage() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [niche, setNiche] = useState<string>("");

  function handleSubmit(formData: FormData) {
    setError("");
    formData.set("niche", niche);
    startTransition(async () => {
      try {
        await signUp(formData);
      } catch (e: any) {
        setError(e.message || "Erro ao criar conta");
      }
    });
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Criar Conta</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Configure sua IA em 5 minutos
        </p>
      </div>

      <form action={handleSubmit} className="space-y-5">
        {error && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 px-4 py-3 rounded-lg flex items-center gap-2">
            <span className="shrink-0 size-5 rounded-full bg-destructive/20 flex items-center justify-center text-xs font-bold">!</span>
            {error}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="fullName" className="text-sm font-medium">Seu nome</Label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input id="fullName" name="fullName" required placeholder="Seu nome completo" className="h-10 pl-10 rounded-md" />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="company" className="text-sm font-medium">Nome da empresa</Label>
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input id="company" name="company" required placeholder="Nome da sua empresa" className="h-10 pl-10 rounded-md" />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Segmento</Label>
          <Select value={niche} onValueChange={(v) => setNiche(v ?? "")} required>
            <SelectTrigger className="h-10 rounded-md">
              <SelectValue placeholder="Selecione seu nicho" />
            </SelectTrigger>
            <SelectContent>
              {NICHES.map((n) => (
                <SelectItem key={n.value} value={n.value}>
                  {n.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium">Email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input id="email" name="email" type="email" required placeholder="seu@email.com" className="h-10 pl-10 rounded-md" />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password" className="text-sm font-medium">Senha</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input id="password" name="password" type="password" required minLength={6} placeholder="Mínimo 6 caracteres" className="h-10 pl-10 rounded-md" />
          </div>
        </div>

        <Button type="submit" className="w-full h-11 font-medium rounded-md" disabled={isPending}>
          {isPending ? (
            <><Loader2 className="size-4 mr-2 animate-spin" /> Criando conta...</>
          ) : (
            "Criar conta gratuita"
          )}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Já tem conta?{" "}
        <Link href="/login" className="text-primary hover:underline font-medium transition-colors duration-150">
          Entrar
        </Link>
      </p>
    </div>
  );
}
