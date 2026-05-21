"use client";

// PR 22 UX (mai/2026): construtor estruturado de prompt no estilo do
// Jordan. Cliente leigo nao precisa entender "prompt engineering" pra
// construir um agente bom — divide em 5 perguntas claras:
//   1. Persona — Quem é
//   2. Missão — O que faz
//   3. Regras — Limites e comportamento
//   4. Estilo — Como conversa
//   5. Conhecimento — Informações específicas do produto/serviço
//
// 2 modos:
//   - "Texto corrido" — textarea livre (legado, avançado)
//   - "Por partes" — 5 campos curtos, montagem automática
//
// Persistência: 1 único campo system_prompt na DB. Modo "Por partes"
// monta o prompt com headers `## Persona\n...\n\n## Missão\n...` etc.
// Modo "Texto corrido" exibe a string crua. Alternar entre modos:
//   - Texto → Por partes: tenta parsear headers. Se não achar headers
//     conhecidos, coloca tudo em "Conhecimento" pra preservar conteúdo.
//   - Por partes → Texto: concatena as 5 seções com headers.
//
// Sem migration. Modo escolhido fica em localStorage por agente —
// outro user vendo o mesmo agente vê o último modo USADO PELO PRÓPRIO
// browser. Aceitável: o conteúdo é o mesmo, só muda a apresentação.

import * as React from "react";
import { FileText, Layers, Info } from "lucide-react";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";

type Mode = "text" | "sections";

const SECTION_KEYS = [
  "persona",
  "missao",
  "regras",
  "estilo",
  "conhecimento",
] as const;
type SectionKey = (typeof SECTION_KEYS)[number];

const SECTION_LABELS: Record<SectionKey, string> = {
  persona: "Persona",
  missao: "Missão",
  regras: "Regras",
  estilo: "Estilo de mensagens",
  conhecimento: "Conhecimento",
};

const SECTION_PLACEHOLDERS: Record<SectionKey, string> = {
  persona:
    "Você é a Carla, consultora de planos de saúde da Humana Saúde com 5 anos de experiência atendendo famílias.",
  missao:
    "Qualificar leads que chegam pelo WhatsApp:\n1. Entender quem é o lead (idade, família, profissão).\n2. Coletar nome, idade, telefone e e-mail.\n3. Apresentar 2 opções de plano e marcar reunião com humano.",
  regras:
    "- Nunca invente preços nem prazos. Se não souber, diga que vai checar.\n- Nunca prometa cobertura sem confirmar com a equipe.\n- Se o lead pedir pra falar com humano, transfira sem insistir.\n- Não cite concorrentes pelo nome.",
  estilo:
    "- Fale em português brasileiro, em tom amigável e profissional.\n- Mensagens curtas (no máximo 2 linhas por resposta).\n- Use 1 emoji por mensagem, no máximo.\n- Trate o lead pelo primeiro nome.",
  conhecimento:
    "A Humana Saúde tem 3 planos:\n- Essencial: cobertura básica, R$ 199/mês.\n- Família: 4 vidas inclusas, R$ 599/mês.\n- Premium: cobertura nacional + odonto, R$ 899/mês.\n\nReuniões são feitas via Google Meet, sempre de terça a sexta, 9h-17h.",
};

const SECTION_HINTS: Record<SectionKey, string> = {
  persona: "Quem é o agente? Nome, função, experiência.",
  missao: "O que o agente faz numa conversa? Passo a passo.",
  regras: "O que o agente nunca pode fazer. Limites.",
  estilo: "Como o agente conversa. Tom, comprimento, emojis.",
  conhecimento:
    "Informações específicas sobre seu produto/serviço que o agente precisa saber.",
};

interface Props {
  value: string;
  onChange: (next: string) => void;
  agentId: string;
}

const STORAGE_KEY_PREFIX = "persia.prompt-mode.";

function loadMode(agentId: string): Mode {
  if (typeof window === "undefined") return "text";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY_PREFIX + agentId);
    if (v === "sections" || v === "text") return v;
  } catch {
    /* ignore (private mode etc) */
  }
  return "text";
}

function saveMode(agentId: string, mode: Mode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY_PREFIX + agentId, mode);
  } catch {
    /* ignore */
  }
}

/**
 * Parsea um system_prompt texto-livre em seções estruturadas.
 *
 * Heurística:
 *  - Procura por linhas `## <Label>` (case-insensitive) marcando início
 *    de seção.
 *  - Se achar pelo menos 1 header conhecido, divide o texto por header.
 *  - Se não achar, coloca o texto inteiro em "conhecimento" pra
 *    preservar conteúdo.
 */
function parsePromptToSections(prompt: string): Record<SectionKey, string> {
  const empty: Record<SectionKey, string> = {
    persona: "",
    missao: "",
    regras: "",
    estilo: "",
    conhecimento: "",
  };
  if (!prompt.trim()) return empty;

  // Match `## Persona`, `## Missão` etc (com ou sem acentos, case-insensitive).
  const headerRegex = /^##\s+(persona|missao|missão|regras|estilo|conhecimento|estilo de mensagens)\s*$/gim;
  const matches = Array.from(prompt.matchAll(headerRegex));

  if (matches.length === 0) {
    return { ...empty, conhecimento: prompt.trim() };
  }

  const result = { ...empty };
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (!match.index && match.index !== 0) continue;
    const rawLabel = match[1].toLowerCase();
    const key = labelToKey(rawLabel);
    if (!key) continue;
    const start = match.index + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? prompt.length : prompt.length;
    result[key] = prompt.slice(start, end).trim();
  }
  return result;
}

function labelToKey(rawLabel: string): SectionKey | null {
  // Remove combining diacritics (U+0300-U+036F) — "missão" → "missao".
  // Unicode escape em vez de range literal pra evitar combining chars
  // invisíveis no source.
  const normalized = rawLabel
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+de\s+mensagens/, "")
    .trim();
  if (normalized === "persona") return "persona";
  if (normalized === "missao") return "missao";
  if (normalized === "regras") return "regras";
  if (normalized === "estilo") return "estilo";
  if (normalized === "conhecimento") return "conhecimento";
  return null;
}

/**
 * Monta o prompt final concatenando seções não-vazias com headers.
 * Seções vazias são omitidas (não polui o prompt com headers órfãos).
 */
function sectionsToPrompt(sections: Record<SectionKey, string>): string {
  const parts: string[] = [];
  for (const key of SECTION_KEYS) {
    const content = sections[key].trim();
    if (!content) continue;
    parts.push(`## ${SECTION_LABELS[key]}\n${content}`);
  }
  return parts.join("\n\n");
}

export function PromptBuilderSection({ value, onChange, agentId }: Props) {
  const [mode, setMode] = React.useState<Mode>(() => loadMode(agentId));
  // Sections só são lidas/escritas no modo "sections" — em "text",
  // o textarea opera direto sobre `value`. Lazy init pra evitar parse
  // desnecessário no mount em modo text.
  const [sections, setSections] = React.useState<Record<SectionKey, string>>(
    () => parsePromptToSections(value),
  );

  // Quando `value` muda externamente (server response), e estamos em
  // modo sections, re-parsea. Em modo text, o textarea já reflete.
  React.useEffect(() => {
    if (mode === "sections") {
      setSections(parsePromptToSections(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function handleModeChange(next: Mode) {
    if (next === mode) return;
    if (next === "sections") {
      // Text → Sections: parsea o conteúdo atual.
      setSections(parsePromptToSections(value));
    } else {
      // Sections → Text: monta o prompt final a partir das seções.
      const built = sectionsToPrompt(sections);
      // Só atualiza se diferente — evita marcar dirty desnecessário.
      if (built !== value) {
        onChange(built);
      }
    }
    setMode(next);
    saveMode(agentId, next);
  }

  function handleSectionChange(key: SectionKey, content: string) {
    const next = { ...sections, [key]: content };
    setSections(next);
    // Propaga prompt completo (concatenado) pro parent. Mantém DB
    // limpa com 1 campo só.
    onChange(sectionsToPrompt(next));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="prompt-builder">Como o agente se comporta</Label>
        <ModeToggle mode={mode} onChange={handleModeChange} />
      </div>

      {mode === "text" ? (
        <>
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <Info className="size-3.5 shrink-0 mt-0.5" />
            Texto livre. Escreva quem é o agente, o que ele faz, regras e
            informações. Cada tarefa do fluxo pode adicionar instruções
            específicas por cima.
          </p>
          <Textarea
            id="prompt-builder"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={14}
            className="font-mono text-sm"
            placeholder="Você é um atendente..."
          />
        </>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <Info className="size-3.5 shrink-0 mt-0.5" />
            Preencha cada parte. Seções em branco são ignoradas. O texto
            final é montado automaticamente com os títulos.
          </p>
          {SECTION_KEYS.map((key) => (
            <div key={key} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor={`prompt-section-${key}`} className="text-sm">
                  {SECTION_LABELS[key]}
                </Label>
                <span className="text-[10px] text-muted-foreground">
                  {SECTION_HINTS[key]}
                </span>
              </div>
              <Textarea
                id={`prompt-section-${key}`}
                value={sections[key]}
                onChange={(e) => handleSectionChange(key, e.target.value)}
                placeholder={SECTION_PLACEHOLDERS[key]}
                rows={key === "missao" || key === "conhecimento" ? 5 : 3}
                className="text-sm"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (next: Mode) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-card p-0.5 text-xs">
      <button
        type="button"
        onClick={() => onChange("text")}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors ${
          mode === "text"
            ? "bg-muted text-foreground font-medium"
            : "text-muted-foreground hover:text-foreground"
        }`}
        aria-pressed={mode === "text"}
      >
        <FileText className="size-3.5" />
        Texto corrido
      </button>
      <button
        type="button"
        onClick={() => onChange("sections")}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors ${
          mode === "sections"
            ? "bg-muted text-foreground font-medium"
            : "text-muted-foreground hover:text-foreground"
        }`}
        aria-pressed={mode === "sections"}
      >
        <Layers className="size-3.5" />
        Por partes
      </button>
    </div>
  );
}
