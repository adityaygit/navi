import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@shared": fileURLToPath(new URL("../src/lib", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"], env: { VITE_SUPABASE_URL: "http://localhost:54321", VITE_SUPABASE_ANON_KEY: "test-anon-key", VITE_API_BASE: "http://localhost:3000" } },
});
