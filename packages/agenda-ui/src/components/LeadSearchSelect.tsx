"use client";

import * as React from "react";
import { Search, X, User as UserIcon } from "lucide-react";
import { useAgendaCallbacks } from "../context";
import type { LeadOption } from "../actions";

interface LeadSearchSelectProps {
  value: string | null;
  onChange: (leadId: string | null, lead?: LeadOption) => void;
  /** Lead pre-selecionado (mostra nome ja antes do user mudar). */
  initialSelected?: LeadOption | null;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
}

export const LeadSearchSelect: React.FC<LeadSearchSelectProps> = ({
  value,
  onChange,
  initialSelected = null,
  placeholder = "Buscar lead por nome ou telefone...",
  disabled = false,
  invalid = false,
}) => {
  const { searchLeads } = useAgendaCallbacks();
  const [selected, setSelected] = React.useState<LeadOption | null>(
    initialSelected,
  );
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [results, setResults] = React.useState<LeadOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sincroniza state local com prop value quando ele muda externamente
  React.useEffect(() => {
    if (!value) setSelected(null);
    else if (initialSelected && initialSelected.id === value) {
      setSelected(initialSelected);
    }
  }, [value, initialSelected]);

  // Click outside fecha
  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced search
  React.useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (!searchLeads || query.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceTimerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await searchLeads(query.trim(), 8);
        setResults(data);
      } catch (err) {
        console.error("[LeadSearchSelect] busca falhou:", err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [query, searchLeads]);

  const handleSelect = (lead: LeadOption) => {
    setSelected(lead);
    setQuery("");
    setOpen(false);
    onChange(lead.id, lead);
  };

  const handleClear = () => {
    setSelected(null);
    setQuery("");
    setResults([]);
    onChange(null);
  };

  // Sem callback de busca → mostra disabled
  if (!searchLeads) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
        Busca de leads não configurada nesta tela.
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      {selected ? (
        <div
          className={[
            "flex items-center justify-between gap-2 rounded-xl border bg-card px-3 py-2",
            invalid ? "border-destructive/50" : "border-border",
          ].join(" ")}
        >
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <UserIcon size={14} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-foreground">
                {selected.name}
              </p>
              {selected.phone && (
                <p className="truncate text-[10px] font-semibold text-muted-foreground">
                  {selected.phone}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            aria-label="Remover lead"
            className="rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div
          className={[
            "flex items-center gap-2 rounded-xl border bg-card px-3 py-2",
            invalid ? "border-destructive/50" : "border-border",
          ].join(" ")}
        >
          <Search size={14} className="text-muted-foreground/70" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            disabled={disabled}
            placeholder={placeholder}
            aria-invalid={invalid}
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
          />
        </div>
      )}

      {open && !selected && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
          {query.trim().length < 2 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground/70">
              Digite ao menos 2 caracteres
            </p>
          ) : loading ? (
            <p className="px-3 py-3 text-xs text-muted-foreground/70">Buscando...</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground/70">
              Nenhum lead encontrado
            </p>
          ) : (
            <ul role="listbox">
              {results.map((lead) => (
                <li key={lead.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => handleSelect(lead)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-primary/10 hover:text-primary"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <UserIcon size={12} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {lead.name}
                      </p>
                      {lead.phone && (
                        <p className="truncate text-xs text-muted-foreground">
                          {lead.phone}
                        </p>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
