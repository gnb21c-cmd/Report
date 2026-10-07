/* ============================================================
   발주app(F) 푸시 — Firebase Cloud Messaging (무료). 무료 판에는 Cloud Functions 가 없어 GitHub 작업이 직접 보냄
   - 서비스 계정(GitHub Secret FIREBASE_SERVICE_ACCOUNT, 화면 올리기와 같은 것)으로 1시간짜리 출입증 → FCM v1 으로 폰마다 보냄
   - 폰 토큰은 boards/{열쇠}/pushTokens/{이메일} (F 에서 '알림 켜기'를 누른 폰)
   - 알림을 누르면 …/f/ 가 열림. 안 읽은 수(앱 아이콘 숫자)는 F 가 맞춤
   공개 저장소라 기록에는 보낸 수 · 실패 수만
   ============================================================ */
import { createSign } from "node:crypto";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** 서비스 계정 → FCM 보내기 출입증 */
export async function fcmToken(saJson: string): Promise<{ token: string; project: string }> {
  const sa = JSON.parse(saJson) as ServiceAccount;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sign = createSign("RSA-SHA256");
  sign.update(`${head}.${body}`);
  const jwt = `${head}.${body}.${b64url(sign.sign(sa.private_key))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`FCM 출입증을 못 받음 (${res.status})`);
  return { token: j.access_token, project: sa.project_id };
}

/** 폰 하나에 알림 — 끊긴 토큰이면 "gone" */
export async function fcmSend(auth: { token: string; project: string }, to: string, msg: { title: string; body: string; link: string; tag: string }): Promise<"ok" | "gone" | "fail"> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${auth.project}/messages:send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({
      message: {
        token: to,
        // 폰 위쪽에 누를 때까지 남는 알림 (requireInteraction) · 같은 알림은 하나로 (tag)
        webpush: {
          notification: { title: msg.title, body: msg.body, tag: msg.tag, requireInteraction: true, icon: "/f/icon.svg" },
          fcm_options: { link: msg.link },
        },
        data: { link: msg.link, tag: msg.tag },
      },
    }),
  });
  if (res.ok) return "ok";
  return res.status === 404 || res.status === 400 ? "gone" : "fail";
}
