import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// 발주app(…/f/): 홈 화면에 설치 (앱 아이콘 숫자 · iPhone 푸시는 설치한 앱에서만)
if (/\/f(\/|$)/.test(location.pathname)) {
  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = "/f/manifest.webmanifest";
  document.head.appendChild(link);
  document.title = "발주app";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
