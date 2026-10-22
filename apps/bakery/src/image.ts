/* ============================================================
   생산 지시 이미지 — 화면 캡처가 아니라 목록 전체를 그림 한 장으로 그려 카톡 등으로 보냄 (잘리지 않음)
   - 최종 확정: 그날 빵별 수량 한 장
   - 다음 주 잠정 확정: 빵 × 월 ~ 일 표 한 장
   폰의 '공유하기'(navigator.share files)로 카톡을 고름. 안 되는 기기는 그림 파일을 내려받음
   ============================================================ */
import { shortLabel, weekday, WEEKDAY_KO } from "@report/core";
import qrcode from "qrcode-generator";

const FONT = `system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif`;
const C = { bg: "#ffffff", ink: "#1a1714", sub: "#6b625a", line: "#e4ddd5", accent: "#8a5a3b", soft: "#f6efe8", wait: "#b25b00" };
const W = 1080;
const PAD = 56;

function canvas(h: number) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = C.bg;
  g.fillRect(0, 0, W, h);
  g.textBaseline = "middle";
  return { c, g };
}
const font = (g: CanvasRenderingContext2D, px: number, bold = false) => (g.font = `${bold ? 700 : 400} ${px}px ${FONT}`);
/** 칸에 맞게 줄임 */
function fit(g: CanvasRenderingContext2D, s: string, w: number): string {
  if (g.measureText(s).width <= w) return s;
  let t = s;
  while (t.length > 1 && g.measureText(t + "…").width > w) t = t.slice(0, -1);
  return t + "…";
}
const blob = (c: HTMLCanvasElement) => new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("그림을 만들지 못했습니다"))), "image/png"));

export interface ImgRow {
  name: string;
  qty: number;
  /** 매니저가 아직 확정 안 함 (계획 수량) */
  pending?: boolean;
}

/** 최종 생산 지시 — 그날 빵별 수량 */
export function finalImage(date: string, rows: ImgRow[], who: string): Promise<Blob> {
  const RH = 64;
  const head = 190;
  const h = head + rows.length * RH + 120 + (rows.some((r) => r.pending) ? 40 : 0);
  const { c, g } = canvas(h);
  g.fillStyle = C.accent;
  g.fillRect(0, 0, W, 14);
  font(g, 46, true);
  g.fillStyle = C.ink;
  g.fillText(`${shortLabel(date)} 최종 생산 지시`, PAD, 76);
  const total = rows.reduce((a, r) => a + r.qty, 0);
  font(g, 28);
  g.fillStyle = C.sub;
  g.fillText(`총 ${total.toLocaleString("ko-KR")}개 · ${rows.length}종 · 확정 ${who}`, PAD, 130);
  let y = head;
  rows.forEach((r, i) => {
    if (i % 2 === 0) {
      g.fillStyle = C.soft;
      g.fillRect(PAD - 16, y, W - 2 * PAD + 32, RH);
    }
    font(g, 34, true);
    g.fillStyle = C.ink;
    g.fillText(fit(g, r.name + (r.pending ? " •" : ""), W - 2 * PAD - 220), PAD, y + RH / 2);
    g.textAlign = "right";
    g.fillStyle = r.pending ? C.wait : C.ink;
    g.fillText(`${r.qty}개`, W - PAD, y + RH / 2);
    g.textAlign = "left";
    y += RH;
  });
  g.strokeStyle = C.ink;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(PAD - 16, y + 6);
  g.lineTo(W - PAD + 16, y + 6);
  g.stroke();
  font(g, 36, true);
  g.fillStyle = C.ink;
  g.fillText("합계", PAD, y + 50);
  g.textAlign = "right";
  g.fillText(`${total.toLocaleString("ko-KR")}개`, W - PAD, y + 50);
  g.textAlign = "left";
  if (rows.some((r) => r.pending)) {
    font(g, 24);
    g.fillStyle = C.wait;
    g.fillText("• = 아직 매니저 확정 전 (최종안 수량)", PAD, y + 104);
  }
  return blob(c);
}

/** 다음 주 잠정 생산 — 빵 × 월 ~ 일 표 */
export function weekImage(dates: string[], names: string[], qty: (date: string, name: string) => { qty: number; pending: boolean } | null, who: string): Promise<Blob> {
  const RH = 54;
  const nameW = 300;
  const colW = (W - 2 * PAD - nameW) / dates.length;
  const head = 240;
  const h = head + names.length * RH + 150;
  const { c, g } = canvas(h);
  g.fillStyle = C.accent;
  g.fillRect(0, 0, W, 14);
  font(g, 44, true);
  g.fillStyle = C.ink;
  const [a, b] = [dates[0], dates[dates.length - 1]];
  g.fillText(`다음 주 잠정 생산 (${Number(a.slice(5, 7))}/${Number(a.slice(8, 10))} ~ ${Number(b.slice(5, 7))}/${Number(b.slice(8, 10))})`, PAD, 76);
  font(g, 26);
  g.fillStyle = C.sub;
  g.fillText(`잠정 확정 ${who} · 최종 수량은 3일 전에 따로 확정 (±10% 안)`, PAD, 126);
  // 머리줄 — 요일
  let y = 170;
  font(g, 28, true);
  g.textAlign = "center";
  dates.forEach((d, i) => {
    const x = PAD + nameW + colW * i + colW / 2;
    const w = weekday(d);
    g.fillStyle = w === 0 || w === 6 ? "#c23b3b" : C.ink;
    g.fillText(`${WEEKDAY_KO[w]} ${Number(d.slice(8, 10))}`, x, y + 20);
  });
  g.textAlign = "left";
  y = head;
  const totals = dates.map(() => 0);
  let anyPending = false;
  names.forEach((n, r) => {
    if (r % 2 === 0) {
      g.fillStyle = C.soft;
      g.fillRect(PAD - 16, y, W - 2 * PAD + 32, RH);
    }
    font(g, 28, true);
    g.fillStyle = C.ink;
    g.fillText(fit(g, n, nameW - 16), PAD, y + RH / 2);
    g.textAlign = "center";
    dates.forEach((d, i) => {
      const q = qty(d, n);
      const x = PAD + nameW + colW * i + colW / 2;
      font(g, 28, !!q && !q.pending);
      g.fillStyle = q?.pending ? C.wait : C.ink;
      g.fillText(q && q.qty ? `${q.qty}${q.pending ? "•" : ""}` : "—", x, y + RH / 2);
      if (q) totals[i] += q.qty;
      if (q?.pending) anyPending = true;
    });
    g.textAlign = "left";
    y += RH;
  });
  g.strokeStyle = C.ink;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(PAD - 16, y + 6);
  g.lineTo(W - PAD + 16, y + 6);
  g.stroke();
  font(g, 28, true);
  g.fillStyle = C.ink;
  g.fillText("합계", PAD, y + 44);
  g.textAlign = "center";
  dates.forEach((_, i) => g.fillText(String(totals[i]), PAD + nameW + colW * i + colW / 2, y + 44));
  g.textAlign = "left";
  if (anyPending) {
    font(g, 22);
    g.fillStyle = C.wait;
    g.fillText("• = 아직 매니저 잠정 확정 전 (계획 수량)", PAD, y + 100);
  }
  return blob(c);
}

/** 카톡 등으로 보내기 — 그림 파일 공유가 안 되면 내려받기 */
export async function shareImage(b: Blob, name: string, title: string): Promise<string> {
  const file = new File([b], name, { type: "image/png" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return "";
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return "";
  }
  saveImage(b, name);
  return "이 기기는 바로 공유가 안 되어 그림 파일을 내려받았습니다 — 카톡에서 사진으로 보내 주세요.";
}

/** 그림 파일로 내려받기만 (공유 창 없이 — 뽑아서 붙일 QR 등) */
export function saveImage(b: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/* ---------- 주소 QR (2026-10-22 — 근무자 화면 · 현장 태블릿 주소를 폰 카메라로) ---------- */
/** QR 칸 (true = 검은 칸) — 오류 고침 M */
export function qrModules(text: string): boolean[][] {
  const q = qrcode(0, "M");
  q.addData(text, "Byte");
  q.make();
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
}

/** 화면에 그릴 QR (SVG 글) */
export function qrSvg(text: string, px = 220): string {
  const m = qrModules(text);
  const n = m.length + 8; // 둘레 4칸 비움
  let d = "";
  m.forEach((row, r) => row.forEach((on, c) => on && (d += `M${c + 4} ${r + 4}h1v1h-1z`)));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** 주소 QR 그림 한 장 — 제목 · QR · 안내 (뽑아서 매장에 붙임) */
export function qrImage(url: string, title: string, note: string): Promise<Blob> {
  const m = qrModules(url);
  const n = m.length + 8;
  const cell = Math.floor((W - PAD * 2) / n);
  const size = cell * n;
  const top = 170;
  const { c, g } = canvas(top + size + 190);
  font(g, 54, true);
  g.fillStyle = C.ink;
  g.textAlign = "center";
  g.fillText(title, W / 2, 90);
  // 칸 경계가 픽셀에 맞아야 칸 사이 흰 줄이 안 생김 (QR 이 잘 읽히게)
  const x0 = Math.round((W - size) / 2);
  g.fillStyle = "#000";
  m.forEach((row, r) => row.forEach((on, col) => on && g.fillRect(x0 + (col + 4) * cell, top + (r + 4) * cell, cell, cell)));
  font(g, 34);
  g.fillStyle = C.sub;
  g.fillText(note, W / 2, top + size + 60);
  font(g, 26);
  g.fillText(fit(g, url, W - PAD * 2), W / 2, top + size + 120);
  return blob(c);
}
