import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH || "/OfftargetPred-web-server/",
  server: {
    proxy: { "/api": { target: "http://127.0.0.1:8010", changeOrigin: true } },
  },
});
