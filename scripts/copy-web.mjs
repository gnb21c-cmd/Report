// A · B 화면 HTML 을 C 프로그램 폴더(apps/office/web)로 복사 — pnpm build:web 끝에 부름
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "apps/office/web");
mkdirSync(out, { recursive: true });
for (const [from, to] of [
  ["apps/entry/dist/index.html", "entry.html"],
  ["apps/view/dist-office/index.html", "report.html"],
]) {
  const src = join(root, from);
  if (!existsSync(src)) throw new Error(`${from} 이 없습니다 — 먼저 빌드해 주세요`);
  copyFileSync(src, join(out, to));
  console.log(`${from} → apps/office/web/${to}`);
}
