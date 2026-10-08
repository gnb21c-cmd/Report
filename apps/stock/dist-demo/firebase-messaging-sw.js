/* 발주app(F) 푸시 받기 — 화면이 닫혀 있어도 폰 위쪽에 알림 (누를 때까지 남음) · 누르면 …/f/
   설정 값은 등록할 때 주소 뒤에 붙여 줌 (apiKey · projectId · senderId · appId — 화면에도 들어 있는 공개 값) */
importScripts("https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js");
const q = new URL(self.location.href).searchParams;
firebase.initializeApp({ apiKey: q.get("apiKey"), projectId: q.get("projectId"), messagingSenderId: q.get("senderId"), appId: q.get("appId") });
const messaging = firebase.messaging();
// 앱 아이콘 숫자: 알림이 올 때마다 하나씩 (앱을 열면 F 가 안 읽은 수로 맞춤)
messaging.onBackgroundMessage(async () => {
  try {
    const n = (await self.registration.getNotifications()).length;
    if (self.navigator.setAppBadge) await self.navigator.setAppBadge(n + 1);
  } catch (e) {}
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.FCM_MSG && e.notification.data.FCM_MSG.data && e.notification.data.FCM_MSG.data.link) || "/f/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if (c.url.includes("/f/") && "focus" in c) return c.focus();
      return self.clients.openWindow(link);
    }),
  );
});
