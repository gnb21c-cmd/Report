import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// A 입력 화면 — HTML 한 장으로 만들어 사무실 PC(C) 프로그램에 넣음 (C 가 http://C이름:8770/ 으로 보여 줌)
// --mode demo: 체험판 — C 없이 이 브라우저 안에만 저장 (dist-demo/index.html)
export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  return {
    define: { __DEMO__: JSON.stringify(demo) },
    plugins: [react(), viteSingleFile()],
    build: { outDir: demo ? "dist-demo" : "dist", emptyOutDir: true },
  };
});
