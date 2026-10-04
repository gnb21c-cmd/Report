// 올릴 화면 모으기 — B(apps/view/dist, 폰 앱) + A(apps/entry/dist) 를 /a/ 로 + D(apps/bakery/dist) 를 /d/ · /d1/ 로 → firebase/public (firebase deploy 가 올림)
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const a = join(root, "apps/entry/dist/index.html");
const b = join(root, "apps/view/dist/index.html");
const d = join(root, "apps/bakery/dist/index.html");
for (const f of [a, b, d]) if (!existsSync(f)) throw new Error(`${f} 이 없습니다 — 먼저 빌드해 주세요`);
// firebase deploy 는 firebase/ 폴더 안만 올릴 수 있어 firebase/public 으로 모음
const out = join(root, "firebase/public");
rmSync(out, { recursive: true, force: true });
cpSync(join(root, "apps/view/dist"), out, { recursive: true });
mkdirSync(join(out, "a"), { recursive: true });
copyFileSync(a, join(out, "a/index.html"));
// D 매니저(…/d/) · D-1 현장 태블릿(…/d1/<열쇠>/) — 같은 HTML 한 장, 주소로 화면이 갈림
for (const dir of ["d", "d1"]) {
  mkdirSync(join(out, dir), { recursive: true });
  copyFileSync(d, join(out, dir, "index.html"));
}
console.log("firebase/public ← B(…/b/<열쇠>/) + A(…/a/) + D(…/d/) · D-1(…/d1/<열쇠>/)");
