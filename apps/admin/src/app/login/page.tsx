"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, Loader2, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const fd = new FormData(e.currentTarget);
    const email = fd.get("email") as string;
    const password = fd.get("password") as string;

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Erro ao entrar");
        setLoading(false);
        return;
      }

      // Success - redirect to dashboard
      router.push("/");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro de conexão");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Left - Login Form */}
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-6">
          {/* Logo */}
          <div className="flex flex-col items-center gap-3">
            <div className="size-14 rounded-2xl flex items-center justify-center bg-muted">
              <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
                <path d="M20 2L32 14L20 26L8 14Z" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-foreground"/>
                <path d="M20 14L32 26L20 38L8 26Z" fill="none" stroke="currentColor" strokeWidth="1.8" opacity="0.4" className="text-foreground"/>
                <circle cx="20" cy="20" r="3" fill="currentColor" className="text-foreground"/>
              </svg>
            </div>
            <div className="flex items-baseline gap-0.5">
              <span className="text-xl font-bold tracking-tight text-foreground">Pérsia</span>
              <span className="text-xl font-bold tracking-tight text-primary">CRM</span>
              <span className="text-xs font-medium text-primary/60 ml-1">ADMIN</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Email *</label>
              <div className="relative">
                <Shield className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="admin@empresa.com"
                  className="w-full h-10 rounded-md border border-border bg-card pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Senha *</label>
              <div className="relative">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="Sua senha"
                  className="w-full h-10 rounded-md border border-border bg-card px-3 pr-10 text-sm outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-500 bg-red-500/10 rounded-md p-3">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded-md bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/80 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>
      </div>

      {/* Right - Marketing Panel */}
      <div className="hidden lg:flex w-[480px] bg-[#090B1A] flex-col justify-center px-12 shrink-0 border-l border-[#1B1E4B]">
        <div className="space-y-6">
          <div className="size-12 rounded-xl flex items-center justify-center">
            <svg width="36" height="36" viewBox="0 0 40 40" fill="none">
              <path d="M20 2L32 14L20 26L8 14Z" fill="none" stroke="#C9A84C" strokeWidth="1.8"/>
              <path d="M20 14L32 26L20 38L8 26Z" fill="none" stroke="#C9A84C" strokeWidth="1.8" opacity="0.5"/>
              <circle cx="20" cy="20" r="3" fill="#C9A84C"/>
            </svg>
          </div>
          <h2 className="text-3xl font-bold text-[#F8F5F0] leading-tight">
            Gerencie todos os seus clientes em um só lugar
          </h2>
          <p className="text-[#F8F5F0]/70 text-sm leading-relaxed">
            O painel administrativo do PérsiaCRM dá controle total sobre organizações, WhatsApp, IA e atendimento.
          </p>
          <div className="flex gap-8 pt-4">
            <div>
              <p className="text-2xl font-bold text-[#C9A84C]">100%</p>
              <p className="text-xs text-[#F8F5F0]/50">Controle total</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-[#C9A84C]">24/7</p>
              <p className="text-xs text-[#F8F5F0]/50">IA ativa</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-[#C9A84C]">Multi</p>
              <p className="text-xs text-[#F8F5F0]/50">Organizações</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
