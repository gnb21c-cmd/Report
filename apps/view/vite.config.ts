import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { viteSingleFile } from "vite-plugin-singlefile";

// 보통 빌드: 설치형 웹앱(PWA) → Firebase Hosting 에 올림. 설치 주소는 /b/<열쇠>/
//   manifest 에 start_url 을 두지 않음 → 폰이 '설치한 그 주소'(열쇠 포함)로 앱을 엶
// --mode demo: 체험판 — 가짜 자료로 HTML 한 장 (dist-demo/index.html)
const manifestLink = (): Plugin => ({
  name: "manifest-link",
  transformIndexHtml: (html) => html.replace("</head>", '    <link rel="manifest" href="/manifest.webmanifest" />\n  </head>'),
});

export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  return {
    define: { __DEMO__: JSON.stringify(demo), __BUILD__: JSON.stringify(new Date().toISOString()) },
    plugins: demo
      ? [react(), viteSingleFile()]
      : [
          react(),
          manifestLink(),
          VitePWA({
            registerType: "autoUpdate",
            manifest: false,
            includeAssets: ["icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "manifest.webmanifest"],
            // 다른 앱 주소(A · D 매니저 · D-1 태블릿 · 근무자 화면 /w/)는 보고 앱 화면으로 가로채지 않음 — 보고 앱을 깐 폰에서 근무자 QR 을 찍어도 근무자 화면이 열리게 (2026-10-22)
            workbox: { navigateFallback: "/index.html", navigateFallbackDenylist: [/^\/__/, /^\/a\//, /^\/d\//, /^\/d1\//, /^\/w\//] },
          }),
        ],
    build: demo ? { outDir: "dist-demo", emptyOutDir: true } : undefined,
  };
});
