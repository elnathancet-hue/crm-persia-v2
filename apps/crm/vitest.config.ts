import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", ".next", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "src/actions/messages.ts",
        "src/actions/leads.ts",
        "src/lib/whatsapp/incoming-pipeline.ts",
        "src/lib/whatsapp/providers/**/*.ts",
      ],
      exclude: ["**/*.test.ts", "**/__tests__/**"],
    },
  },
});
