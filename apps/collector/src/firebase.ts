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

/** 오늘 마감 전 영업정보 — live/{날짜} 의 cafe · kids · naver 칸 (조각 JSON {p, by, at}). 보낸 칸만 바꿈 (packages/core/src/live.ts) */
export async function writeLive(fb: Fb, date: string, by: string, parts: { kind: "cafe" | "kids" | "naver"; part: unknown }[]): Promise<void> {
  if (!parts.length) return;
  const now = new Date().toISOString();
  const fields: Record<string, any> = { date: str(date), at: { timestampValue: now } };
  for (const p of parts) fields[p.kind] = str(JSON.stringify({ p: p.part, by, at: now }));
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join("&");
  await http(`${base(fb)}/boards/${fb.board}/live/${date}?${mask}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${fb.id}` }, body: JSON.stringify({ fields }) });
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

/** 현장 태블릿 열쇠 (매니저 앱이 처음 만들 때까지는 없음) */
export async function readFloorKey(fb: Fb): Promise<string | null> {
  try {
    const doc = await http(`${base(fb)}/boards/${fb.board}/config/floor`, { headers: { Authorization: `Bearer ${fb.id}` } });
    return doc.fields?.key?.stringValue || null;
  } catch {
    return null;
  }
}

/** 현장 태블릿 복사본 쓰기 — floor/{열쇠}/days/{날짜} */
export async function writeFloor(fb: Fb, floor: string, days: { date: string; json: string }[]): Promise<void> {
  if (!days.length) return;
  const root = `projects/${fb.projectId}/databases/(default)/documents/floor/${floor}/days`;
  const now = new Date().toISOString();
  const writes = days.map((d) => ({ update: { name: `${root}/${d.date}`, fields: { date: str(d.date), at: { timestampValue: now }, json: str(d.json) } } }));
  await http(`${base(fb)}:commit`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${fb.id}` }, body: JSON.stringify({ writes }) });
}

/** 그날 자판기 · 네컷 · 주차 칸 원문 조각 { p, by, at, file } — 없으면 null */
export async function readExtraPiece(fb: Fb, date: string): Promise<any | null> {
  try {
    const doc = await http(`${base(fb)}/boards/${fb.board}/reports/${date}`, { headers: { Authorization: `Bearer ${fb.id}` } });
    const v = doc.fields?.extra?.stringValue;
    return v ? JSON.parse(v) : null;
  } catch (e) {
    // 문서가 없는 날은 null, 그 밖의 오류(로그인 · 권한)는 멈춤 — 사람이 올린 칸을 모르고 덮지 않게
    if (/클라우드 오류 404/.test(String((e as Error).message))) return null;
    throw e;
  }
}

/** 자판기 · 네컷 · 주차 칸만 바꿔 씀 (입력 화면과 같은 모양 { p, by, at, file }) */
export async function writeExtraPieces(fb: Fb, by: string, items: { date: string; part: unknown }[]): Promise<void> {
  if (!items.length) return;
  const root = `projects/${fb.projectId}/databases/(default)/documents/boards/${fb.board}`;
  const now = new Date().toISOString();
  const writes = items.map((x) => {
    const fields = { date: str(x.date), at: { timestampValue: now }, extra: str(JSON.stringify({ p: x.part, by, at: now, file: "나이스 자동 수집" })) };
    return { update: { name: `${root}/reports/${x.date}`, fields }, updateMask: { fieldPaths: Object.keys(fields) } };
  });
  for (let i = 0; i < writes.length; i += 400)
    await http(`${base(fb)}:commit`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${fb.id}` }, body: JSON.stringify({ writes: writes.slice(i, i + 400) }) });
}

/** 그날 보고의 한 칸 원문 조각 { p, by, at, file } — 없으면 null (문서가 없는 날은 null, 그 밖의 오류는 멈춤) */
export async function readPiece(fb: Fb, date: string, field: "naver" | "extra"): Promise<any | null> {
  try {
    const doc = await http(`${base(fb)}/boards/${fb.board}/reports/${date}`, { headers: { Authorization: `Bearer ${fb.id}` } });
    const v = doc.fields?.[field]?.stringValue;
    return v ? JSON.parse(v) : null;
  } catch (e) {
    if (/클라우드 오류 404/.test(String((e as Error).message))) return null;
    throw e;
  }
}

/** 그날 보고의 한 칸만 바꿔 씀 (입력 화면과 같은 모양 { p, by, at, file }) */
export async function writePiecesOf(fb: Fb, field: "naver", by: string, file: string, items: { date: string; part: unknown }[]): Promise<void> {
  if (!items.length) return;
  const root = `projects/${fb.projectId}/databases/(default)/documents/boards/${fb.board}`;
  const now = new Date().toISOString();
  const writes = items.map((x) => {
    const fields = { date: str(x.date), at: { timestampValue: now }, [field]: str(JSON.stringify({ p: x.part, by, at: now, file })) };
    return { update: { name: `${root}/reports/${x.date}`, fields }, updateMask: { fieldPaths: Object.keys(fields) } };
  });
  await http(`${base(fb)}:commit`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${fb.id}` }, body: JSON.stringify({ writes }) });
}

/** 설정 문서 하나를 JSON 한 칸으로 씀 — config/{문서} = { json, at } (네이버 다시 확인 결과 등) */
export async function writeConfigJson(fb: Fb, doc: string, value: unknown): Promise<void> {
  await http(`${base(fb)}/boards/${fb.board}/config/${doc}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${fb.id}` },
    body: JSON.stringify({ fields: { json: str(JSON.stringify(value)), at: { timestampValue: new Date().toISOString() } } }),
  });
}
