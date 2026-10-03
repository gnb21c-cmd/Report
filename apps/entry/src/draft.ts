/* 임시저장 — 계산하지 않고 넣은 값과 올린 엑셀 파일을 이 PC(브라우저 저장소 IndexedDB)에만 보관. 날짜별 하나 */
import type { StoreId } from "@report/core";

export interface DraftFile {
  name: string;
  buf: ArrayBuffer;
}
export interface Draft {
  date: string;
  tickets: string[];
  newVisitors: string[];
  files: Partial<Record<StoreId, DraftFile>>;
  /** 새 상품 분류를 사람이 고른 것 */
  overrides: Record<string, string>;
  savedAt: string;
}

const DB = "entry-drafts";
const STORE = "drafts";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadDraft(date: string): Promise<Draft | null> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(date);
      req.onsuccess = () => resolve((req.result as Draft) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function saveDraft(d: Draft): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(d, d.date);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteDraft(date: string): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(date);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* 없음 */
  }
}

/** 임시저장이 있는 날짜들 (최근 것부터) */
export async function draftDates(): Promise<string[]> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result as string[]).sort().reverse());
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}
