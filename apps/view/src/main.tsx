import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// 새 버전이 깔리면(배포 뒤) 한 번 저절로 다시 열어 새 화면으로 — 예전 화면이 남아 바뀐 것이 늦게 보이지 않게
// 처음 설치(이전 버전 없음)에는 다시 열지 않음. 앱을 다시 볼 때마다 새 버전이 있는지 확인
if ("serviceWorker" in navigator) {
  const had = !!navigator.serviceWorker.controller;
  let done = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!had || done) return;
    done = true;
    location.reload();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
