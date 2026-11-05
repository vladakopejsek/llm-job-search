import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // `pnpm --filter @llm-job-search/queue dev:web` + `dev:server`: the API runs on 5175.
  server: { port: 5176, proxy: { "/api": "http://127.0.0.1:5175" } },
});
