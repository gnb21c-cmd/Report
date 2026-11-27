/* ============================================================
   나이스 NIBS 2차 인증번호 — 메일함에서 꺼내기 (2026-11-25 ~ 나이스 로그인 2차 인증, 사장님 2026-11-26)
   - 로그인 → 2차 인증 창 → '이메일로 인증번호 받기' → [인증번호 전송] → 나이스가 가입 메일(다우 tax 메일함)로 보냄
     → 이 파일이 그 메일함을 **읽기 전용**으로 열어(읽음 표시를 바꾸지 않음 — 회계팀이 같이 봄) 전송을 누른 뒤 온 나이스 메일의 번호만 꺼냄
   - 번호는 매번 다름 → [전송]을 누른 시각 뒤(시계 차이 1분 여유)에 온 메일 중 가장 새것. 3분 안에 넣어야 해서 3초마다 보고 2분 30초까지 기다림
   - 인증번호 · 메일 주소 · 비밀번호는 기록에 남기지 않음 (공개 저장소)
   그룹웨어 서버도 이 파일을 그대로 씀 (tools/sync-report.mjs — 그룹웨어 저장소)
   ============================================================ */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

/** 나이스가 인증번호를 보내는 주소 */
export const NICE_OTP_SENDER = "nibs@nicevan.co.kr";

export interface MailBox {
  host: string;
  /** 993(암호화) 또는 143 */
  port: number;
  user: string;
  pass: string;
}
export interface OtpMail {
  /** 메일 서버가 받은 시각 */
  at: Date;
  from: string;
  text: string;
}

/** 메일 글 → 인증번호 (없으면 null) — "… 님의 인증번호는 [123456] 입니다" */
export function niceCodeOf(text: string): string | null {
  const t = String(text || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ");
  const m = t.match(/인증\s*번호\s*(?:는|은|:)?\s*\[\s*(\d{4,8})\s*\]/) || t.match(/인증\s*번호\s*(?:는|은|:)\s*(\d{4,8})\b/) || t.match(/\[\s*(\d{6})\s*\]/);
  return m ? m[1] : null;
}

/** 받은 메일들 → [전송]을 누른 뒤(sentAt − 여유) 나이스가 보낸 메일 중 가장 새 번호 (없으면 null) */
export function pickNiceCode(mails: OtpMail[], sentAt: Date, slackMs = 60_000): string | null {
  const from = sentAt.getTime() - slackMs;
  const mine = mails
    .filter((m) => m.at.getTime() >= from && m.from.toLowerCase().includes(NICE_OTP_SENDER))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  for (const m of mine) {
    const code = niceCodeOf(m.text);
    if (code) return code;
  }
  return null;
}

/** 메일함에 못 들어간 까닭 → 알아듣기 쉬운 글 + 짧은 원인 (2026-11-27 — 비밀번호가 틀려도 메일 라이브러리 글이 'Command failed' 라
 *  '주소 · 포트를 확인'으로 잘못 알렸음). 비밀번호 · 메일 주소 · 긴 숫자는 남기지 않음 (공개 저장소 기록) */
export function mailFailReason(e: unknown): string {
  const x = (e || {}) as { message?: string; code?: string; authenticationFailed?: boolean; serverResponseCode?: string; responseText?: string };
  const raw = [x.serverResponseCode, x.code, x.responseText, x.message].filter(Boolean).join(" ");
  const why = x.authenticationFailed || /AUTHENTICATIONFAILED|AUTHORIZATIONFAILED|auth|login|credential|password|인증|비밀번호|계정/i.test(raw)
    ? "아이디 · 비밀번호(또는 메일 프로그램 접속 허용)를 확인해 주세요"
    : /ENOTFOUND|EAI_AGAIN/i.test(raw)
      ? "메일 서버 주소를 확인해 주세요"
      : /ECONNREFUSED|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|ENETUNREACH|timeout|timed out/i.test(raw)
        ? "메일 서버에 연결되지 않음 — 주소 · 포트(993) 또는 이 컴퓨터의 인터넷을 확인해 주세요"
        : /certificate|TLS|SSL|self.signed/i.test(raw)
          ? "메일 서버 보안 연결(인증서) 문제 — 포트 993 이 맞는지 확인해 주세요"
          : "메일 서버 주소 · 포트를 확인해 주세요";
  const code = String(x.serverResponseCode || x.code || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 30);
  const text = String(x.responseText || (x.authenticationFailed || code ? "" : x.message) || "")
    .replace(/\S+@\S+/g, "…")
    .replace(/\d{4,}/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const detail = [code, text].filter(Boolean).join(" ");
  return `인증번호 메일함에 들어가지 못함 — ${why}${detail ? ` (${detail})` : ""}`;
}

/** 메일함 읽기 — 받은편지함을 읽기 전용으로 열어 오늘 · 어제 나이스 메일만 (연결은 한 번, 볼 때마다 다시 찾음) */
export function imapReader(box: MailBox) {
  let client: ImapFlow | null = null;
  const open = async () => {
    if (client?.usable) return client;
    client = new ImapFlow({ host: box.host, port: box.port, secure: box.port === 993, auth: { user: box.user, pass: box.pass }, logger: false, socketTimeout: 60_000 });
    try {
      await client.connect();
      await client.mailboxOpen("INBOX", { readOnly: true });
    } catch (e) {
      const c = client;
      client = null;
      await c?.logout().catch(() => {});
      throw new Error(mailFailReason(e));
    }
    return client;
  };
  return {
    async read(since: Date): Promise<OtpMail[]> {
      const c = await open();
      const day = new Date(since.getTime() - 86400_000);
      const uids = (await c.search({ since: day, from: NICE_OTP_SENDER }, { uid: true })) || [];
      const out: OtpMail[] = [];
      for (const uid of uids.slice(-10)) {
        const m = await c.fetchOne(String(uid), { source: true, internalDate: true, envelope: true }, { uid: true });
        if (!m || !m.source) continue;
        const at = m.internalDate ? new Date(m.internalDate) : new Date(0);
        if (at.getTime() < since.getTime() - 5 * 60_000) continue;
        const p = await simpleParser(m.source);
        out.push({ at, from: (m.envelope?.from || []).map((x) => x.address || "").join(" "), text: [p.subject || "", p.text || "", typeof p.html === "string" ? p.html : ""].join("\n") });
      }
      return out;
    },
    async close() {
      const c = client;
      client = null;
      await c?.logout().catch(() => {});
    },
  };
}

/** [전송]을 누른 뒤 온 인증번호를 기다림 — 3초마다 보고 정한 시간까지 (못 받으면 오류) */
export async function waitNiceCode(read: (since: Date) => Promise<OtpMail[]>, sentAt: Date, opts: { timeoutMs?: number; everyMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 150_000;
  const everyMs = opts.everyMs ?? 3_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastErr: unknown = null;
  for (let waited = 0; waited <= timeoutMs; waited += everyMs) {
    try {
      const code = pickNiceCode(await read(sentAt), sentAt);
      if (code) return code;
      lastErr = null;
    } catch (e) {
      lastErr = e;
      if (/들어가지 못함/.test(String((e as Error)?.message))) throw e; // 비밀번호 · 주소가 틀리면 기다려도 안 됨
    }
    await sleep(everyMs);
  }
  throw new Error(`인증번호 메일이 ${Math.round(timeoutMs / 1000)}초 안에 오지 않음${lastErr ? ` (${String((lastErr as Error)?.message || lastErr).slice(0, 60)})` : ""}`);
}

/** 환경 값 → 메일함 (없으면 null) — NICE_MAIL_HOST · NICE_MAIL_PORT(기본 993) · NICE_MAIL_USER · NICE_MAIL_PW */
export function mailBoxFromEnv(env: Record<string, string | undefined>): MailBox | null {
  const host = (env.NICE_MAIL_HOST || "").trim();
  const user = (env.NICE_MAIL_USER || "").trim();
  const pass = env.NICE_MAIL_PW || "";
  if (!host || !user || !pass) return null;
  return { host, port: Number(env.NICE_MAIL_PORT || 993) || 993, user, pass };
}

/** 로그인 2차 인증에 넘길 것 — 메일함에서 번호를 받아 돌려줌 (끝나면 연결을 닫음) */
export function niceOtpFrom(box: MailBox) {
  return async (sentAt: Date) => {
    const r = imapReader(box);
    try {
      return await waitNiceCode((since) => r.read(since), sentAt);
    } finally {
      await r.close();
    }
  };
}
