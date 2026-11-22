import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Trailblazer",
        short_name: "Trailblazer",
        description: "Trail training plan, nutrition and coach",
        theme_color: "#1f3a2e",
        background_color: "#f6f4ef",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//, /^\/cdn-cgi\//],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    // `npm run dev:web` proxies the API to `wrangler dev` on :8787
    proxy: { "/api": "http://localhost:8787" },
  },
});
