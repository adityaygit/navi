import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Bundled into the Capacitor app: relative asset paths, no server.
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      // Shared response types from the web app's server (types only, no runtime code).
      "@shared": fileURLToPath(new URL("../src/lib", import.meta.url)),
    },
  },
  build: { outDir: "dist", target: "es2022", sourcemap: false },
});
