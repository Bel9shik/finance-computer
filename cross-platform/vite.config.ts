import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => ({
  base: mode === "pwa" ? "./" : "/",
  plugins: [
    react(),
    ...(mode === "pwa"
      ? [
          {
            name: "finance-pwa",
            transformIndexHtml() {
              return [
                {
                  tag: "link",
                  attrs: { rel: "manifest", href: "./manifest.webmanifest" },
                },
                {
                  tag: "link",
                  attrs: {
                    rel: "apple-touch-icon",
                    href: "./apple-touch-icon.png",
                  },
                },
                {
                  tag: "meta",
                  attrs: { name: "theme-color", content: "#0c2430" },
                },
                {
                  tag: "meta",
                  attrs: {
                    "http-equiv": "Content-Security-Policy",
                    content:
                      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-src 'none'",
                  },
                  injectTo: "head-prepend" as const,
                },
              ];
            },
          },
        ]
      : []),
  ],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022", outDir: mode === "pwa" ? "dist-pwa" : "dist" },
  worker: { format: "es" },
}));
