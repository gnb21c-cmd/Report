/* 클라우드(Firebase) 쓰기 — 입력 화면 cloud.ts writePieces 와 같은 모양으로 cafe · kids 칸과 정리한 줄을 올림
   계정: 날씨와 같은 전용 계정(WEATHER_EMAIL) — senders 명단에 있어야 보안 규칙이 쓰기를 허락함 */

export interface Fb {
  apiKey: string;
  projectId: string;
  board: string;
  id: string;
}

async function http(url: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`클라우드 오류 ${res.status} ${String(body?.error?.message || "").slice(0, 80)}`);
  return body;
}

export async function fbLogin(env: { apiKey: string; projectId: string; board: string; email: string; password: string }): Promise<Fb> {
  const r = await http(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: env.email, password: env.password, returnSecureToken: true }),
  });
  return { apiKey: env.apiKey, projectId: env.projectId, board: env.board, id: r.idToken };
}

const base = (fb: Fb) => `https://firestore.googleapis.com/v1/projects/${fb.projectId}/databases/(default)/documents`;
const str = (s: string) => ({ stringValue: s });

/** 상품 분류표 (입력 화면에서 사람이 고른 분류) */
export async function readProducts(fb: Fb): Promise<Record<string, string>> {
  try {
    const doc = await http(`${base(fb)}/boards/${fb.board}/config/products`, { headers: { Authorization: `Bearer ${fb.id}` } });
    return JSON.parse(doc.fields?.table?.stringValue || "{}");
  } catch {
    return {};
  }
}

/** 그날 보고에 이미 있는 칸 → 누가 올렸는지 (사람이 올린 칸은 덮지 않으려고) */
export async function readBy(fb: Fb, date: string): Promise<Record<string, string>> {
  try {
    const doc = await http(`${base(fb)}/boards/${fb.board}/reports/${date}`, { headers: { Authorization: `Bearer ${fb.id}` } });
    const out: Record<string, string> = {};
    for (const k of ["cafe", "kids"]) {
      const v = doc.fields?.[k]?.stringValue;
      if (v) out[k] = String(JSON.parse(v).by || "");
    }
    return out;
  } catch {
    return {};
  }
}

export async function writeStores(fb: Fb, by: string, date: string, parts: { kind: "cafe" | "kids"; part: unknown; file: string; lines: unknown[] }[]): Promise<void> {
  if (!parts.length) return;
  const root = `projects/${fb.projectId}/databases/(default)/documents/boards/${fb.board}`;
  const now = new Date().toISOString();
  const fields: Record<string, any> = { date: str(date), at: { timestampValue: now } };
  for (const p of parts) fields[p.kind] = str(JSON.stringify({ p: p.part, by, at: now, file: p.file }));
  const writes: any[] = [{ update: { name: `${root}/reports/${date}`, fields }, updateMask: { fieldPaths: Object.keys(fields) } }];
  for (const p of parts) writes.push({ update: { name: `${root}/lines/${date}_${p.kind}`, fields: { date: str(date), store: str(p.kind), lines: str(JSON.stringify(p.lines)), at: { timestampValue: now } } } });
  await http(`${base(fb)}:commit`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${fb.id}` }, body: JSON.stringify({ writes }) });
}
