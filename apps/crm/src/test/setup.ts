import { afterEach, beforeEach, vi } from "vitest";

// Stable env for deterministic tests. Never point to real infra.
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.OPENAI_API_KEY = "";
process.env.N8N_WEBHOOK_URL = "";

// Default stub for global fetch: tests that hit HTTP must opt-in by
// overriding vi.spyOn(global, "fetch"). Unstubbed calls fail loud.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Unexpected fetch call in test — stub it explicitly");
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
