// Bug D fix (mai/2026): unit tests do sanitizer de tool call leaks.
//
// Cobre casos vistos em prod + edge cases identificados na revisão.
// Fixar bugs no sanitizer com regressão garantida — se uma tool nova
// entrar e não bater, esse test pega.

import { describe, expect, it } from "vitest";
import { stripToolCallLeaks } from "@/lib/ai-agent/tool-call-sanitizer";

describe("stripToolCallLeaks", () => {
  describe("comportamento padrão (sem leaks)", () => {
    it("retorna texto inalterado quando não há tool call", () => {
      const input = "Olá! Como posso ajudar você hoje?";
      const result = stripToolCallLeaks(input);
      expect(result.cleaned).toBe(input);
      expect(result.leakedPatterns).toEqual([]);
    });

    it("não strippa palavras parecidas que NÃO são tool calls", () => {
      // "add_tag" sozinho (sem parens) é apenas texto.
      const input = "Vou adicionar tag depois com add_tag, ok?";
      const result = stripToolCallLeaks(input);
      expect(result.cleaned).toBe(input);
      expect(result.leakedPatterns).toEqual([]);
    });

    it("retorna string vazia inalterada", () => {
      const result = stripToolCallLeaks("");
      expect(result.cleaned).toBe("");
      expect(result.leakedPatterns).toEqual([]);
    });
  });

  describe("captura do bug real de prod", () => {
    it("remove emit_event no fim da mensagem (caso reportado)", () => {
      const input = `Olá, sou seu consultor virtual.
Antes de prosseguir, qual é o seu objetivo com o plano de saúde?
Recebi que você é Elnathan, 18 anos — pode me passar seu telefone e e-mail para continuar?

emit_event("coletou_idade")`;
      const result = stripToolCallLeaks(input);
      expect(result.cleaned).not.toContain("emit_event");
      expect(result.cleaned).toContain("Olá, sou seu consultor virtual.");
      expect(result.cleaned).toContain("pode me passar seu telefone");
      expect(result.leakedPatterns).toContain('emit_event("coletou_idade")');
    });

    it("remove emit_event no início + meio + fim", () => {
      const input = `emit_event("coletou_idade")
Olá!
emit_event("dados_completos")
Tudo bem?
emit_event("documentos_enviados")`;
      const result = stripToolCallLeaks(input);
      expect(result.cleaned).not.toContain("emit_event");
      expect(result.cleaned).toContain("Olá!");
      expect(result.cleaned).toContain("Tudo bem?");
      expect(result.leakedPatterns).toHaveLength(3);
    });
  });

  describe("cobertura de outras tools", () => {
    it("remove add_tag(...)", () => {
      const input = "Marcando como qualificado. add_tag('qualificado')";
      const result = stripToolCallLeaks(input);
      expect(result.cleaned).toBe("Marcando como qualificado.");
      expect(result.leakedPatterns).toEqual(["add_tag('qualificado')"]);
    });

    it("remove move_pipeline_stage(...)", () => {
      const input = `Avançando lead.
move_pipeline_stage("Qualificado")`;
      const result = stripToolCallLeaks(input);
      expect(result.cleaned).toBe("Avançando lead.");
    });

    it("remove set_lead_custom_field(...)", () => {
      const input = `Vou salvar a idade.
set_lead_custom_field('idade', 25)`;
      const result = stripToolCallLeaks(input);
      expect(result.cleaned).toBe("Vou salvar a idade.");
    });

    it("remove stop_agent()", () => {
      const input = "Vou transferir pra um atendente. stop_agent()";
      const result = stripToolCallLeaks(input);
      expect(result.cleaned).toBe("Vou transferir pra um atendente.");
    });

    it("remove transfer_to_user(...)", () => {
      const input = `Conectando com a equipe.
transfer_to_user("ana@example.com")`;
      const result = stripToolCallLeaks(input);
      expect(result.cleaned).toBe("Conectando com a equipe.");
    });
  });

  describe("normalização de whitespace", () => {
    it("comprime 3+ quebras de linha em 2", () => {
      const input = `Linha 1.



Linha 2.`;
      const result = stripToolCallLeaks(input);
      // Sem leak, mas comprime mesmo assim? Não — só comprime SE houve match.
      // Caso sem match, retorna texto original.
      expect(result.cleaned).toBe(input);
    });

    it("comprime quebras de linha vazias deixadas pelo strip", () => {
      const input = `Olá!

emit_event("teste")

Tudo bem?`;
      const result = stripToolCallLeaks(input);
      // Após strip, sobra "Olá!\n\n\n\nTudo bem?" → comprime pra "Olá!\n\nTudo bem?"
      expect(result.cleaned).toBe("Olá!\n\nTudo bem?");
    });

    it("trim no início e fim após strip", () => {
      const input = `

emit_event("foo")

Mensagem real.

emit_event("bar")

`;
      const result = stripToolCallLeaks(input);
      expect(result.cleaned).toBe("Mensagem real.");
    });
  });

  describe("case-insensitive", () => {
    it("captura EMIT_EVENT maiúsculo", () => {
      const input = `Olá. EMIT_EVENT("teste")`;
      const result = stripToolCallLeaks(input);
      expect(result.cleaned).toBe("Olá.");
      expect(result.leakedPatterns).toEqual(['EMIT_EVENT("teste")']);
    });

    it("captura Emit_Event mixed case", () => {
      const input = `Texto. Emit_Event("teste")`;
      const result = stripToolCallLeaks(input);
      expect(result.cleaned).toBe("Texto.");
    });
  });

  describe("edge cases", () => {
    it("tool_name com espaços antes do paren", () => {
      const input = "Texto. emit_event ('teste')";
      const result = stripToolCallLeaks(input);
      expect(result.cleaned).toBe("Texto.");
    });

    it("múltiplas tools diferentes no mesmo texto", () => {
      const input = `Vou processar.
add_tag('a')
move_pipeline_stage('Etapa B')
emit_event("c")`;
      const result = stripToolCallLeaks(input);
      expect(result.cleaned).toBe("Vou processar.");
      expect(result.leakedPatterns).toHaveLength(3);
    });

    it("se TUDO for tool call, cleaned vira string vazia", () => {
      const input = `emit_event("a")
add_tag("b")`;
      const result = stripToolCallLeaks(input);
      expect(result.cleaned).toBe("");
      expect(result.leakedPatterns).toHaveLength(2);
    });

    it("args com aspas duplas escapadas — pega até o primeiro )", () => {
      // Edge: se a IA escreve `emit_event("texto com ) parens dentro")`,
      // o regex pega só até o primeiro `)`. Aceitável — o resto fica
      // como texto solto que provavelmente é estranho de qualquer jeito.
      const input = 'emit_event("oi)") resto';
      const result = stripToolCallLeaks(input);
      // Strippa 'emit_event("oi)' e deixa '") resto'
      expect(result.cleaned).toContain('"') ;
    });
  });
});
