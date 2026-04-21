import { vi } from "vitest";

/**
 * Minimal chainable Supabase query mock.
 *
 * Every chain method returns `this` so calls like
 *   supabase.from("x").select("*").eq("a", 1).limit(10).maybeSingle()
 * terminate in the configured result.
 *
 * Terminal methods (awaited): single, maybeSingle, — and `await` on the
 * builder itself (via `.then`).
 *
 * Per-table results are queued FIFO. Each call to `.from(table)` consumes
 * the next queued result. If the queue is empty the result is `{ data: null, error: null }`.
 */

export type QueryResult<T = unknown> = {
  data: T | null;
  error: { message: string; code?: string } | null;
  count?: number | null;
};

type Queue = Map<string, QueryResult[]>;

export interface MockSupabase {
  from: ReturnType<typeof vi.fn>;
  auth: {
    getUser: ReturnType<typeof vi.fn>;
  };
  storage: {
    from: ReturnType<typeof vi.fn>;
  };
  /** Push a result that will be returned by the next call on `from(table)`. */
  queue: (table: string, result: QueryResult) => void;
  /** Inspect calls for assertions. */
  inserts: Record<string, unknown[]>;
  updates: Record<string, unknown[]>;
  deletes: Record<string, unknown>;
  selects: Record<string, unknown[]>;
  /** Reset state between tests. */
  reset: () => void;
}

export function createSupabaseMock(opts?: {
  authUser?: { id: string } | null;
}): MockSupabase {
  const queues: Queue = new Map();
  const inserts: Record<string, unknown[]> = {};
  const updates: Record<string, unknown[]> = {};
  const deletes: Record<string, unknown> = {};
  const selects: Record<string, unknown[]> = {};

  const nextResult = (table: string): QueryResult => {
    const q = queues.get(table);
    if (!q || q.length === 0) return { data: null, error: null };
    return q.shift()!;
  };

  function makeBuilder(table: string) {
    const pending: QueryResult = { data: null, error: null };
    const builder: Record<string, unknown> = {};
    let resolved: QueryResult | null = null;

    const resolve = () => {
      if (!resolved) resolved = nextResult(table);
      return resolved;
    };

    const chain = [
      "select",
      "eq",
      "neq",
      "in",
      "not",
      "or",
      "ilike",
      "like",
      "lt",
      "gt",
      "gte",
      "lte",
      "order",
      "range",
      "limit",
    ];

    for (const m of chain) {
      builder[m] = vi.fn((...args: unknown[]) => {
        if (m === "select") {
          selects[table] ??= [];
          selects[table].push(args);
        }
        return builder;
      });
    }

    builder.insert = vi.fn((rows: unknown) => {
      inserts[table] ??= [];
      inserts[table].push(rows);
      return builder;
    });
    builder.update = vi.fn((patch: unknown) => {
      updates[table] ??= [];
      updates[table].push(patch);
      return builder;
    });
    builder.upsert = vi.fn((rows: unknown) => {
      inserts[table] ??= [];
      inserts[table].push(rows);
      return builder;
    });
    builder.delete = vi.fn(() => {
      deletes[table] = true;
      return builder;
    });

    builder.single = vi.fn(async () => resolve());
    builder.maybeSingle = vi.fn(async () => resolve());
    builder.then = (onFulfilled: (r: QueryResult) => unknown) => {
      return Promise.resolve(resolve()).then(onFulfilled);
    };

    void pending;
    return builder;
  }

  const mock: MockSupabase = {
    from: vi.fn((table: string) => makeBuilder(table)),
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: opts?.authUser ?? { id: "user-1" } },
        error: null,
      })),
    },
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(async () => ({ data: { path: "x" }, error: null })),
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: "https://pub/x" } })),
      })),
    },
    queue: (table, result) => {
      const q = queues.get(table) ?? [];
      q.push(result);
      queues.set(table, q);
    },
    inserts,
    updates,
    deletes,
    selects,
    reset: () => {
      queues.clear();
      for (const k of Object.keys(inserts)) delete inserts[k];
      for (const k of Object.keys(updates)) delete updates[k];
      for (const k of Object.keys(deletes)) delete deletes[k];
      for (const k of Object.keys(selects)) delete selects[k];
    },
  };

  return mock;
}
