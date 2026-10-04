/* 홈 화면에 설치 — 링크로 처음 연 폰(브라우저)에서만 맨 위에 한 줄
   안드로이드 Chrome: 설치 창을 바로 띄움 (beforeinstallprompt) · 아이폰 Safari: 공유 → 홈 화면에 추가 안내
   이미 설치해서 아이콘으로 연 경우(standalone)나 '닫기' 한 뒤에는 안 보임 */
import { useEffect, useState } from "react";

const HIDE = "report.installHidden";

function standalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}
const ios = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);

export function InstallBanner() {
  const [prompt, setPrompt] = useState<any>(null);
  const [hidden, setHidden] = useState(() => {
    try {
      return standalone() || localStorage.getItem(HIDE) === "1";
    } catch {
      return standalone();
    }
  });
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault();
      setPrompt(e);
    };
    const done = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", on);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", on);
      window.removeEventListener("appinstalled", done);
    };
  }, []);
  if (hidden || __DEMO__ || (!prompt && !ios())) return null;
  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem(HIDE, "1");
    } catch {
      /* 저장 못 해도 이번에는 닫힘 */
    }
  };
  return (
    <div className="install-banner" role="region" aria-label="홈 화면에 설치">
      {prompt ? (
        <button
          className="primary"
          onClick={async () => {
            prompt.prompt();
            const r = await prompt.userChoice.catch(() => null);
            if (r?.outcome === "accepted") setHidden(true);
            setPrompt(null);
          }}
        >
          📲 홈 화면에 설치
        </button>
      ) : (
        <span>
          📲 아래 <b>공유 ⬆</b> → <b>홈 화면에 추가</b> 를 누르면 아이콘이 생깁니다
        </span>
      )}
      <button className="ghost small" onClick={close} aria-label="닫기">
        ✕
      </button>
    </div>
  );
}
