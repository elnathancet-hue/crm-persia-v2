"use client";

import { useTransition, useState } from "react";
import { signIn } from "@/actions/auth";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Loader2, Mail, Lock, MessageCircle } from "lucide-react";

const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_PERSIA_WHATSAPP || "5511930413221";
const WHATSAPP_MESSAGE = encodeURIComponent("Olá! Tenho interesse no PérsiaCRM. Gostaria de saber mais sobre o serviço.");

export default function LoginPage() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");

  function validateEmail(email: string) {
    if (!email) { setEmailError("Email é obrigatório"); return false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setEmailError("Digite um email válido"); return false; }
    setEmailError("");
    return true;
  }

  function validatePassword(password: string) {
    if (!password) { setPasswordError("Senha é obrigatória"); return false; }
    if (password.length < 6) { setPasswordError("Mínimo 6 caracteres"); return false; }
    setPasswordError("");
    return true;
  }

  function handleSubmit(formData: FormData) {
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const emailOk = validateEmail(email);
    const passwordOk = validatePassword(password);
    if (!emailOk || !passwordOk) return;

    setError("");
    startTransition(async () => {
      try {
        // PR-B10: signIn agora retorna { error: string } | void.
        // O try/catch antigo NAO capturava o throw original (server
        // action throw vira 500 no React 19, nao chega no caller).
        const result = await signIn(formData);
        if (result?.error) {
          setError(result.error);
        }
      } catch (e: any) {
        // Fallback defensivo: redirect() do server action throw
        // NEXT_REDIRECT, que pode propagar como rejection silenciosa.
        // Erro real de auth (credencial inválida) ja foi tratado acima.
        setError(e?.message || "Erro ao entrar. Tente novamente.");
      }
    });
  }

  return (
    <div className="space-y-8">
      {/* Logo PérsiaCRM */}
      <div className="flex flex-col items-center gap-4">
        <div className="size-14 rounded-2xl flex items-center justify-center bg-muted">
          <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
            <path d="M20 2L32 14L20 26L8 14Z" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-foreground"/>
            <path d="M20 14L32 26L20 38L8 26Z" fill="none" stroke="currentColor" strokeWidth="1.8" opacity="0.4" className="text-foreground"/>
            <circle cx="20" cy="20" r="3" fill="currentColor" className="text-foreground"/>
          </svg>
        </div>
        <div className="text-center">
          <div className="flex items-baseline justify-center gap-0.5">
            <span className="text-xl font-bold tracking-tight font-heading text-foreground">Pérsia</span>
            <span className="text-xl font-bold tracking-tight font-heading text-primary">CRM</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Produto exclusivo da Pérsia Consultoria Digital
          </p>
        </div>
      </div>

      <form action={handleSubmit} className="space-y-5">
        {error && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 px-4 py-3 rounded-lg flex items-center gap-2">
            <span className="shrink-0 size-5 rounded-full bg-destructive/20 flex items-center justify-center text-xs font-bold">!</span>
            {error}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium">Email *</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              id="email"
              name="email"
              type="email"
              required
              placeholder="seu@email.com"
              autoComplete="email"
              className={`h-10 pl-10 rounded-md ${emailError ? "border-destructive focus-visible:ring-destructive/50" : ""}`}
              onBlur={(e) => e.target.value && validateEmail(e.target.value)}
              onChange={() => emailError && setEmailError("")}
            />
          </div>
          {emailError && <p className="text-xs text-destructive mt-1">{emailError}</p>}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-sm font-medium">Senha *</Label>
            <a href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("Olá! Esqueci minha senha do PérsiaCRM. Pode me ajudar?")}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline transition-colors duration-150">
              Esqueceu?
            </a>
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              id="password"
              name="password"
              type="password"
              required
              placeholder="Sua senha"
              autoComplete="current-password"
              className={`h-10 pl-10 rounded-md ${passwordError ? "border-destructive focus-visible:ring-destructive/50" : ""}`}
              onBlur={(e) => e.target.value && validatePassword(e.target.value)}
              onChange={() => passwordError && setPasswordError("")}
            />
          </div>
          {passwordError && <p className="text-xs text-destructive mt-1">{passwordError}</p>}
        </div>

        <Button type="submit" className="w-full h-11 font-medium rounded-md" disabled={isPending}>
          {isPending ? (
            <><Loader2 className="size-4 mr-2 animate-spin" /> Entrando...</>
          ) : (
            "Entrar"
          )}
        </Button>
      </form>

      <div className="text-center space-y-3">
        <p className="text-sm text-muted-foreground">
          Ainda não é cliente?
        </p>
        <a
          href={`https://wa.me/${WHATSAPP_NUMBER}?text=${WHATSAPP_MESSAGE}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-sm font-medium hover:bg-emerald-500/20 transition-colors"
        >
          <MessageCircle className="size-4" />
          Fale conosco pelo WhatsApp
        </a>
      </div>
    </div>
  );
}
