import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { viteSingleFile } from "vite-plugin-singlefile";

// 보통 빌드: 설치형 웹앱(PWA) → Firebase Hosting 에 올림. 설치 주소는 /b/<열쇠>/
//   manifest 에 start_url 을 두지 않음 → 폰이 '설치한 그 주소'(열쇠 포함)로 앱을 엶
// --mode demo: 체험판 — 가짜 자료로 HTML 한 장 (dist-demo/index.html)
// --mode office: 사무실 PC(C)가 직접 보여 주는 판 — HTML 한 장 (dist-office/index.html → C 가 /b/ 로 보여 줌, 자료는 C 의 /api)
const manifestLink = (): Plugin => ({
  name: "manifest-link",
  transformIndexHtml: (html) => html.replace("</head>", '    <link rel="manifest" href="/manifest.webmanifest" />\n  </head>'),
});

export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  const office = mode === "office";
  return {
    define: { __DEMO__: JSON.stringify(demo), __OFFICE__: JSON.stringify(office) },
    plugins: demo || office
      ? [react(), viteSingleFile()]
      : [
          react(),
          manifestLink(),
          VitePWA({
            registerType: "autoUpdate",
            manifest: false,
            includeAssets: ["icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "manifest.webmanifest"],
            workbox: { navigateFallback: "/index.html", navigateFallbackDenylist: [/^\/__/] },
          }),
        ],
    build: demo ? { outDir: "dist-demo", emptyOutDir: true } : office ? { outDir: "dist-office", emptyOutDir: true } : undefined,
  };
});
