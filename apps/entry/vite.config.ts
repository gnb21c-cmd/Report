import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// A 입력 화면 — HTML 한 장 → Firebase Hosting …/a/ (scripts/hosting.mjs)
// --mode demo: 체험판 — 클라우드 없이 이 브라우저 안에만 저장 (dist-demo/index.html)
export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  return {
    define: { __DEMO__: JSON.stringify(demo) },
    plugins: [react(), viteSingleFile()],
    build: { outDir: demo ? "dist-demo" : "dist", emptyOutDir: true },
  };
});
