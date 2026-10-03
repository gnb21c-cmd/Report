/* 올린 영수증별 엑셀 한 개 → 확인 · 계산 (A 에서 함) */
import {
  buildStorePart,
  guessSector,
  isSector,
  kidsKind,
  parseReceiptSheet,
  partCheck,
  SheetError,
  STORE_LABEL,
  type BuildResult,
  type ReceiptSheet,
  type Sector,
  type StoreId,
} from "@report/core";
import { fingerprint, readRows } from "./excel";

export interface Loaded {
  store: StoreId;
  name: string;
  buf: ArrayBuffer;
  print: string;
  sheet: ReceiptSheet | null;
  /** 보내지 못하게 막는 문제 */
  error: string | null;
  /** 알려만 줌 */
  warnings: string[];
}

/** 파일 읽기 + 매장 · 날짜 확인 */
export function loadFile(store: StoreId, name: string, buf: ArrayBuffer, date: string): Loaded {
  const base: Loaded = { store, name, buf, print: fingerprint(buf), sheet: null, error: null, warnings: [] };
  let rows: unknown[][];
  try {
    rows = readRows(buf);
  } catch {
    return { ...base, error: "엑셀 파일을 열지 못했습니다. 백오피스에서 받은 .xls 파일이 맞는지 확인해 주세요." };
  }
  let sheet: ReceiptSheet;
  try {
    sheet = parseReceiptSheet(rows);
  } catch (e) {
    return { ...base, error: e instanceof SheetError ? e.message : "엑셀 모양을 알아보지 못했습니다." };
  }
  const out: Loaded = { ...base, sheet };
  if (!sheet.from) out.warnings.push("엑셀 위쪽에서 조회일자를 찾지 못했습니다 — 날짜를 직접 확인해 주세요.");
  else if (sheet.from !== sheet.to) out.error = `조회일자가 ${sheet.from} ~ ${sheet.to} 여러 날입니다. 하루치만 받아 주세요 (조회일자 시작·끝을 같은 날로).`;
  else if (sheet.from !== date) out.error = `이 파일은 ${sheet.from} 자료입니다 (지금 입력하는 날은 ${date}).`;
  if (!sheet.lines.length) out.warnings.push("판매 줄이 없습니다 (휴무일이면 그대로 보내도 됩니다).");
  // 매장 확인 — 키즈 입장권이 많으면 아스타나키즈, 음료·빵이 많으면 카페아스타나
  const sales = sheet.lines.filter((l) => !l.refund);
  const kidsLike = sales.filter((l) => kidsKind(l) !== "기타").length;
  const cafeLike = sales.filter((l) => kidsKind(l) === "기타" && guessSector(l.name) !== "기타").length;
  const n = Math.max(1, sales.length);
  if (kidsLike / n > 0.1 && cafeLike / n > 0.1) out.error = "카페 상품과 키즈 입장권이 섞여 있습니다. 매장을 [전체]로 받은 파일 같습니다 — 매장을 하나씩 골라 따로 받아 주세요.";
  else if (store === "cafe" && kidsLike / n > 0.3) out.error = `${STORE_LABEL.kids} 파일 같습니다 (입장권이 대부분). 오른쪽 '${STORE_LABEL.kids}' 칸에 올려 주세요.`;
  else if (store === "kids" && cafeLike / n > 0.3) out.error = `${STORE_LABEL.cafe} 파일 같습니다 (음료·빵이 대부분). 왼쪽 '${STORE_LABEL.cafe}' 칸에 올려 주세요.`;
  return out;
}

export interface NewProduct {
  name: string;
  guess: Sector;
  qty: number;
  net: number;
}

/** 분류표에 없는 카페 상품 (돈이 오가는 것만 — 0원 옵션은 짐작대로) */
export function newProducts(l: Loaded | undefined, table: Record<string, string>): NewProduct[] {
  if (!l?.sheet || l.store !== "cafe") return [];
  const map = new Map<string, NewProduct>();
  for (const x of l.sheet.lines) {
    if (x.refund || isSector(table[x.name]) || /종이쿠폰|상품권|교환권|금액권/.test(x.name)) continue;
    const p = map.get(x.name) || { name: x.name, guess: guessSector(x.name), qty: 0, net: 0 };
    p.qty += x.qty;
    p.net += x.net;
    map.set(x.name, p);
  }
  return [...map.values()].filter((p) => p.net !== 0).sort((a, b) => a.guess.localeCompare(b.guess) || b.net - a.net);
}

/** 계산 (분류표 + 사람이 고른 분류 + 짐작) */
export function compute(l: Loaded, date: string, table: Record<string, string>, overrides: Record<string, string>): (BuildResult & { check: { ok: boolean; text: string } }) | null {
  if (!l.sheet || l.error) return null;
  const sectorOf = (name: string): Sector => {
    const o = overrides[name] ?? table[name];
    return isSector(o) ? o : guessSector(name);
  };
  const r = buildStorePart({ store: l.store, date, file: l.name, sheet: l.sheet, sectorOf });
  return { ...r, check: partCheck(r.part) };
}
