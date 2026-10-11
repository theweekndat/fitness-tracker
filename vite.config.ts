import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // zxing alone is ~450 kB; it lives in the lazy spike/scanner chunk.
  build: { chunkSizeWarningLimit: 700 },
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
});
