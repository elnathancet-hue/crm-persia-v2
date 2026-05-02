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
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        Busca de leads não configurada nesta tela.
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      {selected ? (
        <div
          className={[
            "flex items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2",
            invalid ? "border-rose-300" : "border-slate-200",
          ].join(" ")}
        >
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
              <UserIcon size={14} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900">
                {selected.name}
              </p>
              {selected.phone && (
                <p className="truncate text-[10px] font-semibold text-slate-500">
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
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div
          className={[
            "flex items-center gap-2 rounded-xl border bg-white px-3 py-2",
            invalid ? "border-rose-300" : "border-slate-200",
          ].join(" ")}
        >
          <Search size={14} className="text-slate-400" />
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
            className="flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
          />
        </div>
      )}

      {open && !selected && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {query.trim().length < 2 ? (
            <p className="px-3 py-3 text-xs text-slate-400">
              Digite ao menos 2 caracteres
            </p>
          ) : loading ? (
            <p className="px-3 py-3 text-xs text-slate-400">Buscando...</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-xs text-slate-400">
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
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-slate-50"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                      <UserIcon size={12} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-900">
                        {lead.name}
                      </p>
                      {lead.phone && (
                        <p className="truncate text-[10px] font-semibold text-slate-500">
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
