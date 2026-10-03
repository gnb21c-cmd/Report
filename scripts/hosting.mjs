// 올릴 화면 모으기 — B(apps/view/dist, 폰 앱) 안에 A(apps/entry/dist) 를 /a/ 로 넣음 → firebase deploy 가 apps/view/dist 를 올림
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const a = join(root, "apps/entry/dist/index.html");
const b = join(root, "apps/view/dist/index.html");
for (const f of [a, b]) if (!existsSync(f)) throw new Error(`${f} 이 없습니다 — 먼저 빌드해 주세요`);
mkdirSync(join(root, "apps/view/dist/a"), { recursive: true });
copyFileSync(a, join(root, "apps/view/dist/a/index.html"));
console.log("A → apps/view/dist/a/index.html (주소 …/a/) · B → …/b/<열쇠>/");
