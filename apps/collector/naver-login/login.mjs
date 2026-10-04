// 네이버 예약 자동 수집 — 처음 한 번(또는 로그인이 풀렸을 때) POS 메인 PC에서 사람이 직접 로그인하는 창
// naver-login.cmd 를 더블클릭하면 이 파일이 돎. 자동 수집이 이 폴더에 깔아 둠 (apps/collector/src/naver.ts)
// 브라우저 창에서 네이버에 로그인 → 예약 관리 화면이 보이면 로그인 상태(state.json)를 이 폴더에 저장하고 창을 닫음
// 비밀번호는 저장하지 않음 · state.json 은 이 PC에만 있음 (GitHub 에 올리지 않음)
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./node_modules/playwright-core/index.mjs";

const dir = dirname(fileURLToPath(import.meta.url));
const statePath = join(dir, "state.json");
const START = "https://partner.booking.naver.com/";

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ locale: "ko-KR", timezoneId: "Asia/Seoul", viewport: null, ...(existsSync(statePath) ? { storageState: statePath } : {}) });
const page = await context.newPage();
await page.goto(START).catch(() => {});
console.log("");
console.log("  열린 창에서 네이버에 로그인해 주세요.");
console.log("  - 아이디 · 비밀번호 입력, '로그인 상태 유지' 체크");
console.log("  - 예약 관리 화면이 보이면 몇 초 안에 '저장했습니다' 가 나옵니다. 그다음 창을 닫으면 됩니다.");
console.log("");

// 열린 탭 중 하나라도 예약 관리 화면(로그인 화면 아님)이면 몇 초마다 로그인 상태를 저장 — 창을 닫을 때까지
let saved = false;
let closed = false;
browser.on("disconnected", () => (closed = true));
for (let t = 0; t < 30 * 60 && !closed; t += 3) {
  const pages = context.pages().filter((p) => !p.isClosed());
  if (!pages.length) break;
  const onBooking = pages.some((p) => /partner\.booking\.naver\.com/.test(p.url()) && !/nid\.naver\.com/.test(p.url()));
  if (onBooking) {
    await new Promise((r) => setTimeout(r, 2000));
    const ok = await context.storageState({ path: statePath }).then(() => true, () => false);
    if (ok && !saved) {
      saved = true;
      console.log("  저장했습니다. 이제 브라우저 창을 닫고, 이 검은 창도 아무 키나 눌러 닫으면 됩니다.");
      console.log("  (자동 수집이 매일 아침 이 로그인으로 어제 예약을 읽습니다)");
    }
  }
  await new Promise((r) => setTimeout(r, 3000));
}
if (!saved) console.log("  예약 관리 화면을 확인하지 못해 저장하지 못했습니다. 다시 실행해 주세요.");
await browser.close().catch(() => {});
