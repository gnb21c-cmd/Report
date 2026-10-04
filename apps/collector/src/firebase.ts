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

/** 그날 보고에 이미 있는 칸 → 누가 올렸는지 · 그 값 (사람이 올린 칸은 덮지 않으려고, 확인할 때 견주려고) */
export async function readStores(fb: Fb, date: string): Promise<Record<string, { by: string; p: any }>> {
  try {
    const doc = await http(`${base(fb)}/boards/${fb.board}/reports/${date}`, { headers: { Authorization: `Bearer ${fb.id}` } });
    const out: Record<string, { by: string; p: any }> = {};
    for (const k of ["cafe", "kids"]) {
      const v = doc.fields?.[k]?.stringValue;
      if (v) {
        const j = JSON.parse(v);
        out[k] = { by: String(j.by || ""), p: j.p };
      }
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

/** 작업지시 계획 쓰기 — plans/{날짜} = { date, at, json } */
export async function writePlans(fb: Fb, plans: { date: string; json: string }[]): Promise<void> {
  if (!plans.length) return;
  const root = `projects/${fb.projectId}/databases/(default)/documents/boards/${fb.board}`;
  const now = new Date().toISOString();
  const writes = plans.map((p) => ({ update: { name: `${root}/plans/${p.date}`, fields: { date: str(p.date), at: { timestampValue: now }, json: str(p.json) } } }));
  await http(`${base(fb)}:commit`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${fb.id}` }, body: JSON.stringify({ writes }) });
}

/** 작업지시 계획 읽기 (없으면 undefined) */
export async function readPlan(fb: Fb, date: string): Promise<string | undefined> {
  try {
    const doc = await http(`${base(fb)}/boards/${fb.board}/plans/${date}`, { headers: { Authorization: `Bearer ${fb.id}` } });
    return doc.fields?.json?.stringValue;
  } catch {
    return undefined;
  }
}

/** 정리한 영수증 줄 (lines/{날짜}_{매장}) — 없으면 null */
export async function readLines(fb: Fb, date: string, store: "cafe" | "kids"): Promise<any[] | null> {
  try {
    const doc = await http(`${base(fb)}/boards/${fb.board}/lines/${date}_${store}`, { headers: { Authorization: `Bearer ${fb.id}` } });
    const v = doc.fields?.lines?.stringValue;
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

/** 그날 카페 칸 원문 조각 { p, by, at, file } */
export async function readCafePiece(fb: Fb, date: string): Promise<any | null> {
  try {
    const doc = await http(`${base(fb)}/boards/${fb.board}/reports/${date}`, { headers: { Authorization: `Bearer ${fb.id}` } });
    const v = doc.fields?.cafe?.stringValue;
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

/** 카페 칸만 바꿔 씀 (올린 사람 · 시각은 그대로, 문서 at 은 지금 → 보고 앱이 새로 받음) */
export async function writeCafePiece(fb: Fb, date: string, piece: unknown): Promise<void> {
  const now = new Date().toISOString();
  await http(`${base(fb)}/boards/${fb.board}/reports/${date}?updateMask.fieldPaths=cafe&updateMask.fieldPaths=at&updateMask.fieldPaths=date`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${fb.id}` },
    body: JSON.stringify({ fields: { date: str(date), at: { timestampValue: now }, cafe: str(JSON.stringify(piece)) } }),
  });
}

/** 정리한 영수증 줄만 쓰기 */
export async function writeLines(fb: Fb, date: string, store: "cafe" | "kids", lines: unknown[]): Promise<void> {
  const now = new Date().toISOString();
  await http(`${base(fb)}/boards/${fb.board}/lines/${date}_${store}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${fb.id}` },
    body: JSON.stringify({ fields: { date: str(date), store: str(store), lines: str(JSON.stringify(lines)), at: { timestampValue: now } } }),
  });
}

/** 매니저 확정 읽기 (없으면 undefined) */
export async function readOrder(fb: Fb, date: string): Promise<string | undefined> {
  try {
    const doc = await http(`${base(fb)}/boards/${fb.board}/orders/${date}`, { headers: { Authorization: `Bearer ${fb.id}` } });
    return doc.fields?.json?.stringValue;
  } catch {
    return undefined;
  }
}
