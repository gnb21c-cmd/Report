/* 발주app(F) 푸시 켜기 — Firebase Cloud Messaging (무료)
   이 폰을 pushTokens/{이메일} 에 등록 → E 작업(stock.yml)이 발주 필요 · 실셈 알림을 보냄
   iPhone 은 Safari 에서 '홈 화면에 추가'한 앱(iOS 16.4 이상)에서만 됨. 안드로이드 크롬은 그대로
   필요한 공개 설정값(GitHub Variables → 화면 만들 때 들어감): VITE_FIREBASE_MESSAGING_SENDER_ID · VITE_FIREBASE_APP_ID · VITE_FIREBASE_VAPID_KEY */
import { api } from "./data";

const env = import.meta.env;

export function pushReady(): string | null {
  if (__DEMO__) return "체험판에서는 푸시를 보내지 않습니다 (알림 목록 · 아이콘 숫자만).";
  if (!("serviceWorker" in navigator) || !("Notification" in window) || !("PushManager" in window))
    return "이 브라우저는 푸시를 못 받습니다 — iPhone 은 Safari 공유 버튼 → '홈 화면에 추가'로 설치한 뒤 그 앱에서 켜 주세요 (iOS 16.4 이상).";
  if (!env.VITE_FIREBASE_MESSAGING_SENDER_ID || !env.VITE_FIREBASE_APP_ID || !env.VITE_FIREBASE_VAPID_KEY) return "푸시 설정값이 아직 없습니다 — docs/V2_INTEGRATION.md '발주app 푸시 준비'를 봐 주세요.";
  return null;
}

export async function enablePush(): Promise<void> {
  const why = pushReady();
  if (why) throw new Error(why);
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("알림을 허용하지 않았습니다 — 폰 설정에서 이 앱의 알림을 켜 주세요.");
  const cfg = { apiKey: env.VITE_FIREBASE_API_KEY, projectId: env.VITE_FIREBASE_PROJECT_ID, messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID, appId: env.VITE_FIREBASE_APP_ID };
  const qs = new URLSearchParams({ apiKey: cfg.apiKey, projectId: cfg.projectId, senderId: cfg.messagingSenderId, appId: cfg.appId }).toString();
  const reg = await navigator.serviceWorker.register(`/f/firebase-messaging-sw.js?${qs}`, { scope: "/f/" });
  const { initializeApp } = await import("firebase/app");
  const { getMessaging, getToken } = await import("firebase/messaging");
  const messaging = getMessaging(initializeApp(cfg));
  const token = await getToken(messaging, { vapidKey: env.VITE_FIREBASE_VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) throw new Error("푸시 등록 번호를 못 받았습니다. 잠시 뒤 다시 눌러 주세요.");
  await api.savePushToken(token);
  try {
    localStorage.setItem("stock.push", "1");
  } catch {
    /* 이번만 */
  }
}

export const pushOn = () => {
  try {
    return localStorage.getItem("stock.push") === "1" && "Notification" in window && Notification.permission === "granted";
  } catch {
    return false;
  }
};
