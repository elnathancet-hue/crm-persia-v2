"use client";

import { useState, useRef, useEffect } from "react";
import { User, LogOut, Settings, Moon, Sun } from "lucide-react";
import { signOut } from "@/actions/auth";
import Link from "next/link";

export function HeaderUserMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("admin-theme");
    if (saved === "dark") {
      document.documentElement.classList.add("dark");
      setIsDark(true);
    } else {
      document.documentElement.classList.remove("dark");
      setIsDark(false);
    }
  }, []);

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
