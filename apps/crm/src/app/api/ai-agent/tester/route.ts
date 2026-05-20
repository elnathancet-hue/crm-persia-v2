import { NextRequest, NextResponse } from "next/server";

// PR-FLOW-PIVOT (mai/2026): rota de Tester desligada durante a migração
// pra flow runtime (PR 2). Retorna 503 pra UI mostrar mensagem amigável.
// Quando flow-executor.ts entrar, esta rota volta com mesmo contrato.

export async function POST(_request: NextRequest) {
  return NextResponse.json(
    {
      ok: false,
      error:
        "AI Agent em migração pra novo runtime (flow canvas). Tester volta no PR 2 do pivot.",
    },
    { status: 503 },
  );
}
