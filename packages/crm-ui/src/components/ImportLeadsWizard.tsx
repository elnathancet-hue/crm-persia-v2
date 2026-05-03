"use client";

// ImportLeadsWizard — wizard de 5 passos pra importar leads via CSV/XLSX
// com auto-mapping, deteccao de duplicatas, estrategia (ignore/update/import)
// e auto-criacao opcional de segmento ao final.
//
// Multi-tenant: a server action injeta organization_id (requireRole). O
// componente nao toca em orgId — apenas envia rows + mapping + destination.
//
// Tema PersiaCRM: usa semantic tokens (bg-card, bg-muted, text-foreground,
// border-border, etc) — funciona em light + dark sem ajustes.
//
// Padrao DI: parent passa `onImport` (server action). Pode ser usado em
// /crm, /leads ou qualquer outra rota.

import * as React from "react";
import * as XLSX from "xlsx";
import {
  Upload,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Loader2,
  X,
  Tag as TagIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import { Checkbox } from "@persia/ui/checkbox";
import { Badge } from "@persia/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@persia/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";

// ============================================================================
// Tipos publicos (espelham apps/crm/src/actions/leads-import.ts)
// ============================================================================

export interface ImportTag {
  id: string;
  name: string;
  color?: string | null;
}

export type DuplicateStrategy = "ignore" | "update" | "import";

export interface ImportFieldMapping {
  csvColumn: string;
  crmField: string;
}

export interface ImportDestination {
  tag_ids?: string[];
  tag_names_to_create?: string[];
  source?: string;
  status?: string;
  duplicate_strategy: DuplicateStrategy;
  create_segment?: boolean;
  segment_name?: string;
  segment_description?: string;
}

export interface ImportLeadsInput {
  rows: Record<string, string | number | null | undefined>[];
  mapping: ImportFieldMapping[];
  destination: ImportDestination;
}

export interface ImportLeadsResult {
  total_rows: number;
  invalid: { row_index: number; reason: string }[];
  created_count: number;
  updated_count: number;
  skipped_count: number;
  segment_id: string | null;
}

interface ImportLeadsWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tags existentes da organização (pra dropdown de aplicar tags). */
  tags: ImportTag[];
  /** Server action que executa a importacao. */
  onImport: (input: ImportLeadsInput) => Promise<ImportLeadsResult>;
  /** Callback quando import termina (pra parent revalidar/refetch). */
  onImported?: (result: ImportLeadsResult) => void;
  /** Rota base pra link de segmento criado (default: "/segments"). */
  segmentsBasePath?: string;
}

// ============================================================================
// Constantes
// ============================================================================

const MAX_ROWS = 5000;
const MAX_PREVIEW_ROWS = 5;

const CRM_FIELDS = [
  { value: "ignore", label: "— Ignorar coluna —" },
  { value: "name", label: "Nome (obrigatório)" },
  { value: "phone", label: "Telefone" },
  { value: "email", label: "E-mail" },
  { value: "value", label: "Valor (R$)" },
  { value: "notes", label: "Observações" },
  { value: "tags", label: "Tags (separadas por , ou ;)" },
] as const;

// Auto-mapping por sinonimos comuns em PT-BR e EN
const AUTO_MAP_HINTS: Record<string, string[]> = {
  name: [
    "nome",
    "name",
    "fullname",
    "full name",
    "cliente",
    "lead",
    "contato",
  ],
  phone: [
    "telefone",
    "fone",
    "celular",
    "whatsapp",
    "phone",
    "mobile",
    "tel",
    "numero",
  ],
  email: ["email", "e-mail", "mail", "correio"],
  value: ["valor", "value", "preco", "price", "ticket", "deal"],
  notes: ["observacao", "obs", "notas", "notes", "comentario", "descrição", "descricao"],
  tags: ["tag", "tags", "categoria", "category", "etiqueta", "etiquetas"],
};

function autoMapColumn(col: string): string {
  const norm = col
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
  for (const [field, hints] of Object.entries(AUTO_MAP_HINTS)) {
    for (const h of hints) {
      if (norm === h || norm.includes(h)) return field;
    }
  }
  return "ignore";
}

const SOURCE_OPTIONS = [
  { value: "import", label: "Importação" },
  { value: "website", label: "Site" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "google", label: "Google Ads" },
  { value: "indication", label: "Indicação" },
  { value: "manual", label: "Cadastro manual" },
  { value: "other", label: "Outra origem" },
];

const STATUS_OPTIONS = [
  { value: "new", label: "Novo" },
  { value: "contacted", label: "Contactado" },
  { value: "qualified", label: "Qualificado" },
  { value: "lost", label: "Perdido" },
];

const DUPLICATE_STRATEGY_OPTIONS: {
  value: DuplicateStrategy;
  label: string;
  hint: string;
}[] = [
  {
    value: "ignore",
    label: "Pular duplicatas",
    hint: "Mantém o lead atual, ignora a linha do arquivo.",
  },
  {
    value: "update",
    label: "Atualizar leads existentes",
    hint:
      "Mescla observações + aplica as tags. Não sobrescreve nome/email já preenchidos.",
  },
  {
    value: "import",
    label: "Importar mesmo assim",
    hint: "Cria um novo registro mesmo que já exista. Use com cautela.",
  },
];

// ============================================================================
// Componente principal
// ============================================================================

type Step = 1 | 2 | 3 | 4 | 5;

interface ParsedFile {
  filename: string;
  columns: string[];
  rows: Record<string, string | number | null | undefined>[];
}

export function ImportLeadsWizard({
  open,
  onOpenChange,
  tags,
  onImport,
  onImported,
  segmentsBasePath = "/segments",
}: ImportLeadsWizardProps) {
  const [step, setStep] = React.useState<Step>(1);

  // Estado do arquivo + mapeamento
  const [file, setFile] = React.useState<ParsedFile | null>(null);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [parseError, setParseError] = React.useState<string | null>(null);

  // Estado do destino
  const [selectedTagIds, setSelectedTagIds] = React.useState<string[]>([]);
  const [newTagsRaw, setNewTagsRaw] = React.useState<string>("");
  const [source, setSource] = React.useState<string>("import");
  const [status, setStatus] = React.useState<string>("new");
  const [duplicateStrategy, setDuplicateStrategy] =
    React.useState<DuplicateStrategy>("ignore");
  const [createSegment, setCreateSegment] = React.useState<boolean>(true);
  const [segmentName, setSegmentName] = React.useState<string>("");
  const [segmentDescription, setSegmentDescription] = React.useState<string>("");

  // Estado de execucao
  const [isImporting, setIsImporting] = React.useState(false);
  const [result, setResult] = React.useState<ImportLeadsResult | null>(null);

  // Reset ao fechar
  React.useEffect(() => {
    if (!open) {
      // Delay pra animacao de fechamento nao ver os campos limpando
      const t = setTimeout(() => {
        setStep(1);
        setFile(null);
        setMapping({});
        setParseError(null);
        setSelectedTagIds([]);
        setNewTagsRaw("");
        setSource("import");
        setStatus("new");
        setDuplicateStrategy("ignore");
        setCreateSegment(true);
        setSegmentName("");
        setSegmentDescription("");
        setIsImporting(false);
        setResult(null);
      }, 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Default segment_name: nome do arquivo
  React.useEffect(() => {
    if (file && !segmentName) {
      const base = file.filename.replace(/\.(csv|xlsx|xls)$/i, "");
      setSegmentName(`Importação ${base} — ${new Date().toLocaleDateString("pt-BR")}`);
    }
  }, [file, segmentName]);

  // ----- Step 1: Parse arquivo -----
  const handleFileSelect = async (input: HTMLInputElement) => {
    const f = input.files?.[0];
    if (!f) return;
    setParseError(null);
    try {
      const buffer = await f.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheet = workbook.SheetNames[0];
      if (!firstSheet) {
        setParseError("Arquivo vazio ou sem planilhas.");
        return;
      }
      const sheet = workbook.Sheets[firstSheet];
      const rows = XLSX.utils.sheet_to_json<Record<string, string | number | null | undefined>>(
        sheet,
        { defval: "", raw: false },
      );

      if (rows.length === 0) {
        setParseError("Nenhuma linha encontrada no arquivo.");
        return;
      }
      if (rows.length > MAX_ROWS) {
        setParseError(
          `Limite máximo: ${MAX_ROWS.toLocaleString("pt-BR")} linhas por importação. Seu arquivo tem ${rows.length.toLocaleString("pt-BR")}. Quebre em arquivos menores.`,
        );
        return;
      }

      const columns = Object.keys(rows[0] ?? {});
      if (columns.length === 0) {
        setParseError("Não consegui identificar colunas no arquivo.");
        return;
      }

      // Auto-map
      const autoMap: Record<string, string> = {};
      const usedFields = new Set<string>();
      for (const col of columns) {
        const guess = autoMapColumn(col);
        if (guess !== "ignore" && !usedFields.has(guess)) {
          autoMap[col] = guess;
          usedFields.add(guess);
        } else {
          autoMap[col] = "ignore";
        }
      }

      setFile({ filename: f.name, columns, rows });
      setMapping(autoMap);
      // Reset input pra permitir re-upload do mesmo arquivo
      input.value = "";
    } catch (err) {
      setParseError(
        err instanceof Error
          ? `Erro ao ler arquivo: ${err.message}`
          : "Erro ao ler arquivo.",
      );
    }
  };

  // ----- Step 2: Validacao do mapping -----
  const mappingValid = React.useMemo(() => {
    return Object.values(mapping).includes("name");
  }, [mapping]);

  const setColumnMapping = (col: string, field: string) => {
    setMapping((prev) => {
      const next = { ...prev, [col]: field };
      // Se o campo selecionado ja estiver em outra coluna (exceto 'ignore'),
      // muda essa outra pra 'ignore' (evita 2 colunas mapeando pra 'name')
      if (field !== "ignore") {
        for (const [otherCol, otherField] of Object.entries(prev)) {
          if (otherCol !== col && otherField === field) {
            next[otherCol] = "ignore";
          }
        }
      }
      return next;
    });
  };

  // ----- Step 3: Tags -----
  const newTagNames = React.useMemo(
    () =>
      newTagsRaw
        .split(/[,;|\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    [newTagsRaw],
  );

  const toggleTag = (id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  };

  // ----- Step 4: Estatisticas pra preview -----
  const stats = React.useMemo(() => {
    if (!file) return { total: 0, withName: 0, withContact: 0, missingBoth: 0 };
    const nameCol = Object.entries(mapping).find(([, f]) => f === "name")?.[0];
    const phoneCol = Object.entries(mapping).find(([, f]) => f === "phone")?.[0];
    const emailCol = Object.entries(mapping).find(([, f]) => f === "email")?.[0];

    let withName = 0;
    let withContact = 0;
    let missingBoth = 0;
    for (const row of file.rows) {
      const hasName = nameCol ? !!String(row[nameCol] ?? "").trim() : false;
      const hasPhone = phoneCol ? !!String(row[phoneCol] ?? "").trim() : false;
      const hasEmail = emailCol ? !!String(row[emailCol] ?? "").trim() : false;
      if (hasName) withName++;
      if (hasPhone || hasEmail) withContact++;
      if (!hasPhone && !hasEmail) missingBoth++;
    }
    return { total: file.rows.length, withName, withContact, missingBoth };
  }, [file, mapping]);

  // ----- Step 5: Confirmacao + execucao -----
  const handleConfirmImport = async () => {
    if (!file) return;
    setIsImporting(true);
    try {
      const mappingArr: ImportFieldMapping[] = Object.entries(mapping).map(
        ([csvColumn, crmField]) => ({ csvColumn, crmField }),
      );

      const destination: ImportDestination = {
        tag_ids: selectedTagIds,
        tag_names_to_create: newTagNames,
        source,
        status,
        duplicate_strategy: duplicateStrategy,
        create_segment: createSegment,
        segment_name: createSegment ? segmentName.trim() : undefined,
        segment_description: createSegment ? segmentDescription.trim() : undefined,
      };

      const res = await onImport({
        rows: file.rows,
        mapping: mappingArr,
        destination,
      });
      setResult(res);
      setStep(5);
      onImported?.(res);
      toast.success(
        `${res.created_count} novo${res.created_count === 1 ? "" : "s"} lead${res.created_count === 1 ? "" : "s"} criado${res.created_count === 1 ? "" : "s"}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Erro ao importar: ${msg}`);
    } finally {
      setIsImporting(false);
    }
  };

  // ----- Navegacao entre passos -----
  const canGoNext = (): boolean => {
    switch (step) {
      case 1:
        return file !== null;
      case 2:
        return mappingValid;
      case 3:
        if (createSegment && segmentName.trim().length === 0) return false;
        return true;
      case 4:
        return true;
      default:
        return false;
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>Importar leads</SheetTitle>
          <SheetDescription>
            Upload de CSV ou XLSX, com auto-mapeamento, detecção de duplicatas e
            criação automática de segmento.
          </SheetDescription>
          <StepIndicator current={step} />
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 1 && (
            <Step1Upload
              file={file}
              parseError={parseError}
              onFileSelect={handleFileSelect}
              onClear={() => {
                setFile(null);
                setMapping({});
                setParseError(null);
              }}
            />
          )}
          {step === 2 && file && (
            <Step2Mapping
              file={file}
              mapping={mapping}
              onChange={setColumnMapping}
              valid={mappingValid}
            />
          )}
          {step === 3 && (
            <Step3Destination
              tags={tags}
              selectedTagIds={selectedTagIds}
              onToggleTag={toggleTag}
              newTagsRaw={newTagsRaw}
              onChangeNewTags={setNewTagsRaw}
              source={source}
              onChangeSource={setSource}
              status={status}
              onChangeStatus={setStatus}
              duplicateStrategy={duplicateStrategy}
              onChangeDuplicateStrategy={setDuplicateStrategy}
              createSegment={createSegment}
              onChangeCreateSegment={setCreateSegment}
              segmentName={segmentName}
              onChangeSegmentName={setSegmentName}
              segmentDescription={segmentDescription}
              onChangeSegmentDescription={setSegmentDescription}
            />
          )}
          {step === 4 && file && (
            <Step4Review
              file={file}
              stats={stats}
              mapping={mapping}
              tags={tags}
              selectedTagIds={selectedTagIds}
              newTagNames={newTagNames}
              source={source}
              status={status}
              duplicateStrategy={duplicateStrategy}
              createSegment={createSegment}
              segmentName={segmentName}
            />
          )}
          {step === 5 && result && (
            <Step5Result result={result} segmentsBasePath={segmentsBasePath} />
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-6 py-4">
          {step < 5 ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (step === 1) {
                    onOpenChange(false);
                  } else {
                    setStep((s) => (s > 1 ? ((s - 1) as Step) : s));
                  }
                }}
                disabled={isImporting}
              >
                {step === 1 ? (
                  <>
                    <X className="size-4" />
                    Cancelar
                  </>
                ) : (
                  <>
                    <ArrowLeft className="size-4" />
                    Voltar
                  </>
                )}
              </Button>
              {step < 4 ? (
                <Button
                  onClick={() => setStep((s) => ((s + 1) as Step))}
                  disabled={!canGoNext()}
                >
                  Próximo
                  <ArrowRight className="size-4" />
                </Button>
              ) : (
                <Button onClick={handleConfirmImport} disabled={isImporting}>
                  {isImporting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Importando…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="size-4" />
                      Confirmar importação
                    </>
                  )}
                </Button>
              )}
            </>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">
                Pronto! Você pode fechar essa janela.
              </span>
              <Button onClick={() => onOpenChange(false)}>Concluir</Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ============================================================================
// Subcomponentes (mantidos no mesmo arquivo pra contexto colado)
// ============================================================================

function StepIndicator({ current }: { current: Step }) {
  const labels = ["Arquivo", "Mapear", "Destino", "Revisar", "Pronto"];
  return (
    <ol className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
      {labels.map((label, i) => {
        const num = (i + 1) as Step;
        const active = num === current;
        const done = num < current;
        return (
          <React.Fragment key={label}>
            <li
              className={[
                "flex items-center gap-1.5",
                active ? "font-semibold text-foreground" : "",
                done ? "text-primary" : "",
              ].join(" ")}
            >
              <span
                className={[
                  "inline-flex size-5 items-center justify-center rounded-full text-[10px] font-semibold",
                  active
                    ? "bg-primary text-primary-foreground"
                    : done
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground",
                ].join(" ")}
              >
                {done ? "✓" : num}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </li>
            {i < labels.length - 1 && (
              <span className="h-px w-3 bg-border sm:w-6" aria-hidden />
            )}
          </React.Fragment>
        );
      })}
    </ol>
  );
}

// ----- Step 1: Upload -----
function Step1Upload({
  file,
  parseError,
  onFileSelect,
  onClear,
}: {
  file: ParsedFile | null;
  parseError: string | null;
  onFileSelect: (input: HTMLInputElement) => void;
  onClear: () => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          Selecione o arquivo
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Aceitamos CSV ou Excel (.xlsx). Limite de{" "}
          {MAX_ROWS.toLocaleString("pt-BR")} linhas por arquivo.
        </p>
      </div>

      {!file ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/30 px-6 py-12 text-center transition-colors hover:border-primary hover:bg-primary/5"
        >
          <Upload className="size-8 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            Clique pra escolher o arquivo
          </span>
          <span className="text-xs text-muted-foreground">
            CSV, XLSX • até {MAX_ROWS.toLocaleString("pt-BR")} linhas
          </span>
        </button>
      ) : (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                <span className="truncate text-sm font-medium text-foreground">
                  {file.filename}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {file.rows.length.toLocaleString("pt-BR")} linha
                {file.rows.length === 1 ? "" : "s"} · {file.columns.length}{" "}
                coluna{file.columns.length === 1 ? "" : "s"}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={onClear}>
              Trocar
            </Button>
          </div>

          <div className="mt-3 overflow-hidden rounded-lg border border-border">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    {file.columns.map((c) => (
                      <th
                        key={c}
                        className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-foreground"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {file.rows.slice(0, MAX_PREVIEW_ROWS).map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      {file.columns.map((c) => (
                        <td
                          key={c}
                          className="max-w-[180px] truncate px-2 py-1.5 text-muted-foreground"
                          title={String(r[c] ?? "")}
                        >
                          {String(r[c] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {file.rows.length > MAX_PREVIEW_ROWS && (
              <div className="border-t border-border bg-muted/30 px-2 py-1 text-center text-[11px] text-muted-foreground">
                + {(file.rows.length - MAX_PREVIEW_ROWS).toLocaleString("pt-BR")}{" "}
                linhas
              </div>
            )}
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => onFileSelect(e.currentTarget)}
      />

      {parseError && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{parseError}</span>
        </div>
      )}
    </div>
  );
}

// ----- Step 2: Mapping -----
function Step2Mapping({
  file,
  mapping,
  onChange,
  valid,
}: {
  file: ParsedFile;
  mapping: Record<string, string>;
  onChange: (col: string, field: string) => void;
  valid: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          Mapear colunas
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Escolha o que cada coluna do arquivo representa no CRM. Pelo menos a
          coluna <strong className="text-foreground">Nome</strong> é obrigatória.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="grid grid-cols-2 gap-3 border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>Coluna do arquivo</span>
          <span>Campo no CRM</span>
        </div>
        <ul className="divide-y divide-border">
          {file.columns.map((col) => {
            const sample = String(file.rows[0]?.[col] ?? "");
            return (
              <li key={col} className="grid grid-cols-2 gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    {col}
                  </div>
                  {sample && (
                    <div className="truncate text-[11px] text-muted-foreground">
                      Ex: {sample}
                    </div>
                  )}
                </div>
                <Select
                  value={mapping[col] ?? "ignore"}
                  onValueChange={(v) => onChange(col, v ?? "ignore")}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue>
                      {CRM_FIELDS.find((f) => f.value === (mapping[col] ?? "ignore"))?.label ?? "—"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CRM_FIELDS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </li>
            );
          })}
        </ul>
      </div>

      {!valid && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertCircle className="size-4 shrink-0" />
          <span>
            Mapeie pelo menos uma coluna como <strong>Nome</strong> pra
            continuar.
          </span>
        </div>
      )}
    </div>
  );
}

// ----- Step 3: Destination -----
function Step3Destination({
  tags,
  selectedTagIds,
  onToggleTag,
  newTagsRaw,
  onChangeNewTags,
  source,
  onChangeSource,
  status,
  onChangeStatus,
  duplicateStrategy,
  onChangeDuplicateStrategy,
  createSegment,
  onChangeCreateSegment,
  segmentName,
  onChangeSegmentName,
  segmentDescription,
  onChangeSegmentDescription,
}: {
  tags: ImportTag[];
  selectedTagIds: string[];
  onToggleTag: (id: string) => void;
  newTagsRaw: string;
  onChangeNewTags: (v: string) => void;
  source: string;
  onChangeSource: (v: string) => void;
  status: string;
  onChangeStatus: (v: string) => void;
  duplicateStrategy: DuplicateStrategy;
  onChangeDuplicateStrategy: (v: DuplicateStrategy) => void;
  createSegment: boolean;
  onChangeCreateSegment: (v: boolean) => void;
  segmentName: string;
  onChangeSegmentName: (v: string) => void;
  segmentDescription: string;
  onChangeSegmentDescription: (v: string) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Origem + Status */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="import-source">Origem (source)</Label>
          <Select
            value={source}
            onValueChange={(v) => onChangeSource(v ?? "import")}
          >
            <SelectTrigger id="import-source" className="h-10">
              <SelectValue>
                {SOURCE_OPTIONS.find((o) => o.value === source)?.label ?? source}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="import-status">Status inicial</Label>
          <Select
            value={status}
            onValueChange={(v) => onChangeStatus(v ?? "new")}
          >
            <SelectTrigger id="import-status" className="h-10">
              <SelectValue>
                {STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tags existentes */}
      {tags.length > 0 && (
        <div className="space-y-2">
          <Label>Aplicar tags existentes</Label>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => {
              const selected = selectedTagIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onToggleTag(t.id)}
                  className={[
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-muted text-foreground hover:bg-muted/70",
                  ].join(" ")}
                >
                  <TagIcon className="size-3" />
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Tags novas */}
      <div className="space-y-1.5">
        <Label htmlFor="import-new-tags">Criar novas tags</Label>
        <Input
          id="import-new-tags"
          value={newTagsRaw}
          onChange={(e) => onChangeNewTags(e.target.value)}
          placeholder="Ex: VIP, Cliente recorrente, Janeiro 2026"
        />
        <p className="text-[11px] text-muted-foreground">
          Separadas por vírgula, ponto-e-vírgula ou nova linha. Tags duplicadas
          (mesmo nome) são reaproveitadas.
        </p>
      </div>

      {/* Estrategia de duplicatas */}
      <div className="space-y-2">
        <Label>Quando o lead já existir</Label>
        <div className="grid grid-cols-1 gap-2">
          {DUPLICATE_STRATEGY_OPTIONS.map((opt) => {
            const selected = duplicateStrategy === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChangeDuplicateStrategy(opt.value)}
                className={[
                  "rounded-lg border px-3 py-2 text-left transition-colors",
                  selected
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border bg-card hover:bg-muted/40",
                ].join(" ")}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={[
                      "inline-flex size-4 shrink-0 items-center justify-center rounded-full border",
                      selected
                        ? "border-primary bg-primary"
                        : "border-border bg-background",
                    ].join(" ")}
                  >
                    {selected && (
                      <span className="size-1.5 rounded-full bg-primary-foreground" />
                    )}
                  </span>
                  <span className="text-sm font-medium text-foreground">
                    {opt.label}
                  </span>
                </div>
                <p className="ml-6 mt-0.5 text-xs text-muted-foreground">
                  {opt.hint}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Auto-segmento */}
      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <Checkbox
            checked={createSegment}
            onCheckedChange={(v) => onChangeCreateSegment(v === true)}
            className="mt-0.5"
          />
          <div className="flex-1 space-y-1">
            <span className="text-sm font-medium text-foreground">
              Criar segmento automaticamente
            </span>
            <p className="text-xs text-muted-foreground">
              Os leads importados ficam num segmento próprio pra você acionar
              campanhas, follow-up ou agente IA depois.
            </p>
          </div>
        </label>

        {createSegment && (
          <div className="mt-3 space-y-3 border-t border-border pt-3">
            <div className="space-y-1.5">
              <Label htmlFor="seg-name">Nome do segmento</Label>
              <Input
                id="seg-name"
                value={segmentName}
                onChange={(e) => onChangeSegmentName(e.target.value)}
                placeholder="Ex: Importação Janeiro 2026"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seg-desc">Descrição (opcional)</Label>
              <Textarea
                id="seg-desc"
                value={segmentDescription}
                onChange={(e) => onChangeSegmentDescription(e.target.value)}
                placeholder="Notas internas sobre essa importação"
                rows={2}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ----- Step 4: Review -----
function Step4Review({
  file,
  stats,
  mapping,
  tags,
  selectedTagIds,
  newTagNames,
  source,
  status,
  duplicateStrategy,
  createSegment,
  segmentName,
}: {
  file: ParsedFile;
  stats: { total: number; withName: number; withContact: number; missingBoth: number };
  mapping: Record<string, string>;
  tags: ImportTag[];
  selectedTagIds: string[];
  newTagNames: string[];
  source: string;
  status: string;
  duplicateStrategy: DuplicateStrategy;
  createSegment: boolean;
  segmentName: string;
}) {
  const mappedFields = React.useMemo(
    () => Object.entries(mapping).filter(([, f]) => f !== "ignore"),
    [mapping],
  );
  const selectedTagNames = tags
    .filter((t) => selectedTagIds.includes(t.id))
    .map((t) => t.name);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          Revise e confirme
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Conferimos seu arquivo. Veja o resumo abaixo antes de importar.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total de linhas" value={stats.total} tone="neutral" />
        <StatCard label="Com nome" value={stats.withName} tone="positive" />
        <StatCard
          label="Com contato"
          value={stats.withContact}
          tone="positive"
        />
        <StatCard
          label="Sem telefone/email"
          value={stats.missingBoth}
          tone={stats.missingBoth > 0 ? "warning" : "neutral"}
        />
      </div>

      {stats.missingBoth > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertCircle className="size-4 shrink-0" />
          <span>
            {stats.missingBoth} linha{stats.missingBoth === 1 ? "" : "s"} sem
            telefone nem e-mail será{stats.missingBoth === 1 ? "" : "ão"}{" "}
            ignorada{stats.missingBoth === 1 ? "" : "s"} (precisa de pelo menos
            um contato).
          </span>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card">
        <ReviewRow
          label="Arquivo"
          value={`${file.filename} · ${file.rows.length.toLocaleString("pt-BR")} linhas`}
        />
        <ReviewRow
          label="Campos mapeados"
          value={mappedFields
            .map(([col, field]) => {
              const f = CRM_FIELDS.find((cf) => cf.value === field)?.label ?? field;
              return `${col} → ${f.replace(" (obrigatório)", "")}`;
            })
            .join(", ")}
        />
        <ReviewRow
          label="Origem"
          value={SOURCE_OPTIONS.find((o) => o.value === source)?.label ?? source}
        />
        <ReviewRow
          label="Status inicial"
          value={STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status}
        />
        <ReviewRow
          label="Tags"
          value={
            selectedTagNames.length + newTagNames.length === 0
              ? "—"
              : [...selectedTagNames, ...newTagNames.map((n) => `${n} (nova)`)].join(", ")
          }
        />
        <ReviewRow
          label="Duplicatas"
          value={
            DUPLICATE_STRATEGY_OPTIONS.find((d) => d.value === duplicateStrategy)
              ?.label ?? duplicateStrategy
          }
        />
        <ReviewRow
          label="Segmento"
          value={createSegment && segmentName ? segmentName : "Não criar"}
          last
        />
      </div>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      className={[
        "grid grid-cols-3 gap-2 px-4 py-2.5 text-sm",
        last ? "" : "border-b border-border",
      ].join(" ")}
    >
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="col-span-2 text-foreground">{value}</span>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "positive" | "warning";
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className={["text-2xl font-bold", toneClass].join(" ")}>
        {value.toLocaleString("pt-BR")}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

// ----- Step 5: Result -----
function Step5Result({
  result,
  segmentsBasePath,
}: {
  result: ImportLeadsResult;
  segmentsBasePath: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
        <CheckCircle2 className="size-8 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div>
          <h3 className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
            Importação concluída!
          </h3>
          <p className="text-xs text-emerald-800 dark:text-emerald-200">
            Veja abaixo o resumo do que aconteceu.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total enviadas" value={result.total_rows} tone="neutral" />
        <StatCard label="Novos leads" value={result.created_count} tone="positive" />
        <StatCard
          label="Atualizados"
          value={result.updated_count}
          tone="positive"
        />
        <StatCard
          label="Ignorados"
          value={result.skipped_count + result.invalid.length}
          tone={
            result.skipped_count + result.invalid.length > 0 ? "warning" : "neutral"
          }
        />
      </div>

      {result.segment_id && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium text-foreground">
            Segmento criado
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Você pode acionar campanhas, follow-up ou agente IA pra esse grupo.
          </p>
          <div className="mt-2">
            <a
              href={`${segmentsBasePath}/${result.segment_id}`}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-muted dark:border-input dark:bg-input/30 dark:hover:bg-input/50"
            >
              Abrir segmento
              <ArrowRight className="size-3.5" />
            </a>
          </div>
        </div>
      )}

      {result.invalid.length > 0 && (
        <details className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <summary className="cursor-pointer text-xs font-medium text-amber-900 dark:text-amber-200">
            {result.invalid.length} linha
            {result.invalid.length === 1 ? "" : "s"} inválida
            {result.invalid.length === 1 ? "" : "s"} (clique pra ver)
          </summary>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-amber-900 dark:text-amber-200">
            {result.invalid.slice(0, 50).map((iv) => (
              <li key={iv.row_index}>
                Linha {iv.row_index + 1}: {iv.reason}
              </li>
            ))}
            {result.invalid.length > 50 && (
              <li className="text-amber-700 dark:text-amber-400">
                + {result.invalid.length - 50} outras…
              </li>
            )}
          </ul>
        </details>
      )}
    </div>
  );
}
