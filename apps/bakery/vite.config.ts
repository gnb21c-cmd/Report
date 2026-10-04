import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// D(매니저 …/d/) · D-1(현장 태블릿 …/d1/<열쇠>/) — HTML 한 장을 두 주소에 둠 (scripts/hosting.mjs)
// --mode demo: 체험판 — 가짜 자료, 확정은 이 브라우저에만 저장 (dist-demo/index.html, 주소 끝 #d1 = 태블릿 화면)
export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  return {
    define: { __DEMO__: JSON.stringify(demo) },
    plugins: [react(), viteSingleFile()],
    build: { outDir: demo ? "dist-demo" : "dist", emptyOutDir: true },
  };
});
