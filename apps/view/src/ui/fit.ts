/* 글자 맞추기 — 폰마다 글꼴 · 화면 폭이 달라도 줄이 바뀌거나 잘리지 않게
   - 묶음(ref) 안의 글자 크기는 모두 em 으로 쓰고, 묶음의 font-size 에 var(--fit) 을 곱해 둠
   - 묶음 또는 [data-fit] 줄 하나라도 칸을 넘치면 묶음 전체를 같은 비율로 줄임 (가능한 큰 크기 유지 · 줄끼리 크기 같음)
   - 화면 폭이 바뀌면 다시 맞춤 */
import { useLayoutEffect, type DependencyList, type RefObject } from "react";

export function useFit(ref: RefObject<HTMLElement | null>, deps: DependencyList, opts: { height?: boolean } = {}) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const over = () => {
      let o = 0;
      for (const n of [el, ...el.querySelectorAll<HTMLElement>("[data-fit]")]) {
        if (n.clientWidth > 0) o = Math.max(o, n.scrollWidth / n.clientWidth);
        if (opts.height && n.clientHeight > 0) o = Math.max(o, n.scrollHeight / n.clientHeight);
      }
      return o;
    };
    let lastW = -1;
    const run = () => {
      lastW = el.clientWidth;
      let s = 1;
      el.style.setProperty("--fit", "1");
      for (let i = 0; i < 5; i++) {
        const o = over();
        if (o <= 1) break;
        s = (s / o) * 0.98;
        el.style.setProperty("--fit", s.toFixed(3));
      }
    };
    run();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== lastW) run();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
