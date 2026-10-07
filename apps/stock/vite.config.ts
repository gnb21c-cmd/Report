import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// E-1(…/e1/, 창고 입구 …/e1/#in) · F(…/f/) — HTML 한 장을 두 주소에 둠 (scripts/hosting.mjs)
// --mode demo: 체험판 — 가짜 자료, 이 브라우저에만 저장 (dist-demo/index.html, 주소 끝 #f = 발주app)
export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  return {
    define: { __DEMO__: JSON.stringify(demo) },
    plugins: [react(), viteSingleFile()],
    build: { outDir: demo ? "dist-demo" : "dist", emptyOutDir: true },
  };
});
