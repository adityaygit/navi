import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src"), "server-only": path.resolve(import.meta.dirname, "tests/server-only-stub.ts") } },
  test: { setupFiles: ["tests/setup-env.ts"], fileParallelism: false, include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"], testTimeout: 30000 },
});
