"use client";

import { useState, useRef, useEffect } from "react";
import {
  Bell,
  BellOff,
  LogOut,
  Moon,
  Settings,
  Volume2,
  VolumeX,
  Sun,
  User,
} from "lucide-react";
import { signOut } from "@/actions/auth";
import Link from "next/link";
// PR-V1b: mute toggle pra toasts de realtime (comentario novo, lead
// atribuido). Mesma key de localStorage do CRM ("crm:toast:muted")
// pra consistencia mental — mas como sao origins distintas, cada app
// tem sua propria preferencia (intencional).
import { useToastMuted } from "@persia/leads-ui";
import { CHAT_SOUND_MUTED_KEY } from "@/lib/hooks/use-notification";

export function HeaderUserMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [isDark, setIsDark] = useState(false);
  const [toastMuted, setToastMuted] = useToastMuted();
  const [soundMuted, setSoundMuted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("admin-theme");
    if (saved === "dark") {
      document.documentElement.classList.add("dark");
      queueMicrotask(() => setIsDark(true));
    } else {
      document.documentElement.classList.remove("dark");
      queueMicrotask(() => setIsDark(false));
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => setSoundMuted(localStorage.getItem(CHAT_SOUND_MUTED_KEY) === "true"));
  }, []);

  function toggleSound() {
    const next = !soundMuted;
    localStorage.setItem(CHAT_SOUND_MUTED_KEY, String(next));
    setSoundMuted(next);
  }

  function toggleTheme() {
    if (isDark) {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("admin-theme", "light");
    } else {
      document.documentElement.classList.add("dark");
      localStorage.setItem("admin-theme", "dark");
    }
    setIsDark(!isDark);
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="flex items-center gap-2">
      {/* PR-V1b: mute toggle de toasts realtime. Sino aberto = notificacoes
          ativas; sino cortado = silenciado. Paridade visual com CRM. */}
      <button
        onClick={() => setToastMuted(!toastMuted)}
        className="size-8 rounded-full bg-primary/10 flex items-center justify-center text-primary hover:ring-2 hover:ring-primary/20 transition-all"
        aria-label={
          toastMuted
            ? "Reativar avisos laterais"
            : "Silenciar avisos laterais"
        }
        title={
          toastMuted
            ? "Avisos laterais silenciados — clique pra reativar"
            : "Avisos laterais ativos — clique pra silenciar"
        }
      >
        {toastMuted ? (
          <BellOff className="size-4" />
        ) : (
          <Bell className="size-4" />
        )}
      </button>

      <button
        onClick={toggleSound}
        className="size-8 rounded-full bg-primary/10 flex items-center justify-center text-primary hover:ring-2 hover:ring-primary/20 transition-all"
        aria-label={soundMuted ? "Reativar som do chat" : "Silenciar som do chat"}
        title={soundMuted ? "Som do chat silenciado" : "Som do chat ativo"}
      >
        {soundMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </button>

      <button
        onClick={toggleTheme}
        className="size-8 rounded-full bg-primary/10 flex items-center justify-center text-primary hover:ring-2 hover:ring-primary/20 transition-all"
        aria-label="Alternar tema"
      >
        {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>

      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setOpen(!open)}
          aria-label="Menu do usuario"
          className="size-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold hover:ring-2 hover:ring-primary/20 transition-all"
        >
          <User className="size-4" />
        </button>

        {open && (
          <div role="menu" aria-label="Menu do usuario" className="absolute right-0 top-10 w-48 bg-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
            <div className="px-3 py-2 border-b border-border">
              <p className="text-xs font-medium text-foreground">Administrador</p>
              <p className="text-[10px] text-muted-foreground truncate">Superadmin</p>
            </div>
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
            >
              <Settings className="size-4" />
              Configurações
            </Link>
            <button
              onClick={() => signOut()}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-muted transition-colors"
            >
              <LogOut className="size-4" />
              Sair
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
