import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { viteSingleFile } from "vite-plugin-singlefile";

// 보통 빌드: 설치형 웹앱(PWA) → Firebase Hosting 에 올림
// --mode demo: 체험판 — 가짜 자료로 HTML 한 장 (dist-demo/report-demo.html)
export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  return {
    define: { __DEMO__: JSON.stringify(demo) },
    plugins: demo
      ? [react(), viteSingleFile()]
      : [
          react(),
          VitePWA({
            registerType: "autoUpdate",
            includeAssets: ["icon.svg"],
            manifest: {
              name: "매출 보고",
              short_name: "매출 보고",
              description: "카페 · 키즈 POS 일일 매출 보고",
              lang: "ko",
              display: "standalone",
              background_color: "#f9f9f7",
              theme_color: "#2a78d6",
              start_url: "/",
              icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
            },
          }),
        ],
    build: demo ? { outDir: "dist-demo", emptyOutDir: true } : undefined,
  };
});
