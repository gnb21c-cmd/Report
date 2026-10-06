"""베이커리 빵 총 개수 예측 비교 — 지금 방식(세 시각 비율 + 빵용 날씨) vs 기계학습(LightGBM)
입력: apps/collector exportDaily.ts 가 실행기 임시 폴더에 쓴 하루 표 (DAILY). 저장소 · 기록에는 오차 % · 항목 이름만
시험: 2026-04 ~ 09 달마다 '그달 첫날의 앞 lead 일까지 알던 자료'로만 배워 그달을 예측 (7일 앞 = 목요일 주간 계획, 날씨 모름 · 4일 앞 = 최종, 날씨 앎)
"""
from __future__ import annotations

import json
import math
import os
import sys
from datetime import date, timedelta

import lightgbm as lgb
import numpy as np
import pandas as pd

rows = json.load(open(os.environ.get("DAILY", "daily.json"), encoding="utf-8"))
df = pd.DataFrame(rows)
df["d"] = pd.to_datetime(df["date"]).dt.date
df = df.set_index("d").sort_index()
bread = {k: v for k, v in df["bread"].items() if v and v > 0}
D = lambda s: date.fromisoformat(s)
KIND = {"평일": 0, "금요일": 1, "휴일": 2}
SEASON = {"비수기": 0, "평상시": 1, "성수기": 2}
info = df.to_dict("index")


def val(x: date, as_of: date):
    return bread.get(x) if x <= as_of else None


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else math.nan


def feats(d: date, lead: int, weather: bool) -> dict:
    a = d - timedelta(days=lead)
    i = info[d]
    sw = []
    x = d - timedelta(days=7)
    while len(sw) < 2 and x > d - timedelta(days=70):
        if x <= a and bread.get(x):
            sw.append(bread[x])
        x -= timedelta(days=7)
    sk = []
    x = a
    while len(sk) < 2 and x > a - timedelta(days=60):
        if bread.get(x) and info.get(x, {}).get("kind") == i["kind"]:
            sk.append(bread[x])
        x -= timedelta(days=1)
    m7 = mean([val(a - timedelta(days=k), a) for k in range(7)])
    m28 = mean([val(a - timedelta(days=k), a) for k in range(28)])
    ly28 = mean([bread.get(a - timedelta(days=k + 364)) for k in range(28)])
    ly7 = mean([bread.get(a - timedelta(days=k + 364)) for k in range(7)])
    trend = m28 / ly28 if ly28 and not math.isnan(ly28) and not math.isnan(m28) else math.nan
    ly = bread.get(d - timedelta(days=364))
    dom = d.day
    f = {
        "같은요일1": sw[0] if sw else math.nan,
        "같은요일2": sw[1] if len(sw) > 1 else math.nan,
        "같은날유형2": mean(sk),
        "최근7일평균": m7,
        "최근28일평균": m28,
        "작년같은날": ly if ly else math.nan,
        "작년다음주": bread.get(d - timedelta(days=357)) or math.nan,
        "작년지난주": bread.get(d - timedelta(days=371)) or math.nan,
        "추세28일": trend,
        "작년x추세": (ly * trend) if ly and not math.isnan(trend) else math.nan,
        "요일": i["wd"],
        "날유형": KIND[i["kind"]],
        "휴일": i["holiday"],
        "명절": i["lunar"],
        "기간스티커": SEASON.get(i["season"], 1),
        "달": d.month,
        # 월급 · 풍선효과 가설
        "며칠째": dom,
        "월급날부터": (dom - 25) % 31 if dom >= 25 else dom + 6,
        "몇째주": (dom - 1) // 7,
        "쏠림_최근7대28": (m7 / m28) if m28 and not math.isnan(m7) else math.nan,
        "쏠림_지난주대작년": (m7 / ly7 / trend) if ly7 and trend and not math.isnan(trend) and not math.isnan(m7) else math.nan,
    }
    if weather:
        f.update({"최고기온": i["tmax"] if i["tmax"] is not None else math.nan, "비": i["rain"] if i["rain"] is not None else math.nan, "눈": i["snow"]})
    return f


BALLOON = ["며칠째", "월급날부터", "몇째주", "쏠림_최근7대28", "쏠림_지난주대작년"]
PARAMS = dict(objective="regression_l1", n_estimators=500, learning_rate=0.03, num_leaves=8, min_child_samples=12, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, verbose=-1)


def fit_predict(X: pd.DataFrame, y: np.ndarray, Xt: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    preds, gains = [], []
    for seed in range(5):
        m = lgb.LGBMRegressor(random_state=seed, **PARAMS)
        m.fit(X, y)
        preds.append(m.predict(Xt))
        gains.append(m.booster_.feature_importance("gain"))
    return np.mean(preds, axis=0), np.mean(gains, axis=0)


PAY_BUCKETS = [(1, 5), (6, 10), (11, 15), (16, 20), (21, 24), (25, 31)]


def payday_factors(cut: date):
    """날짜 구간별 배수 — cut 전 자료만, 전체 평균을 1 로 맞춤"""
    dev = {}
    for d in bread:
        if d >= cut - timedelta(days=14):
            continue
        k = info[d]["kind"]
        near = [bread[x] for x in (d + timedelta(days=j) for j in range(-14, 15) if j) if x in bread and info.get(x, {}).get("kind") == k]
        if len(near) >= 2:
            dev[d] = math.log(bread[d] / (sum(near) / len(near)))
    mid = sum(dev.values()) / len(dev) if dev else 0
    fac = []
    for lo, hi in PAY_BUCKETS:
        xs = [v for d, v in dev.items() if lo <= d.day <= hi]
        fac.append(math.exp((sum(xs) / len(xs) - mid) * len(xs) / (len(xs) + 20)) if xs else 1.0)
    return lambda d: next(f for (lo, hi), f in zip(PAY_BUCKETS, fac) if lo <= d.day <= hi)


def run(lead: int, weather: bool, months: list[str]):
    bkey = "blend7" if lead == 7 else "blend4"
    days = [d for d in df.index if d >= D("2025-02-01") and bread.get(d)]
    F = {d: feats(d, lead, weather) for d in days}
    out = {k: [] for k in ["지금 방식", "지금 방식 × 월급 배수", "기계학습", "기계학습(잔차)", "둘 평균", "둘 평균 × 월급 배수", "기계학습-월급·쏠림 뺌"]}
    gain_sum = None
    for mo in months:
        start = D(mo + "-01")
        end = (start + timedelta(days=32)).replace(day=1)
        cut = start - timedelta(days=lead)
        train = [d for d in days if d < cut]
        test = [d for d in days if start <= d < end and info[d][bkey]]
        if not test:
            continue
        # 월급 배수 — 그 전 자료(앞뒤 2주가 모두 cut 전인 날)로 날짜 구간별 '평소보다' 비율
        pay = payday_factors(cut)
        X = pd.DataFrame([F[d] for d in train])
        y = np.log([bread[d] for d in train])
        Xt = pd.DataFrame([F[d] for d in test])
        p, g = fit_predict(X, y, Xt)
        gain_sum = g if gain_sum is None else gain_sum + g
        cols = [c for c in X.columns if c not in BALLOON]
        p2, _ = fit_predict(X[cols], y, Xt[cols])
        # 잔차: 지금 방식 예측에서 얼마나 벗어나는지 배움 (지금 방식 예측이 있는 날만 — 2026-01 부터)
        tr2 = [d for d in train if info[d][bkey]]
        if len(tr2) >= 40:
            X3 = pd.DataFrame([{**F[d], "지금방식": info[d][bkey]} for d in tr2])
            y3 = np.log([bread[d] / info[d][bkey] for d in tr2])
            Xt3 = pd.DataFrame([{**F[d], "지금방식": info[d][bkey]} for d in test])
            p3, _ = fit_predict(X3, y3, Xt3)
        else:
            p3 = np.zeros(len(test))
        for k, d in enumerate(test):
            a = bread[d]
            b = info[d][bkey]
            ml = math.exp(p[k])
            e = lambda q: abs(q - a) / a
            out["지금 방식"].append((d, e(b)))
            out["기계학습"].append((d, e(ml)))
            out["기계학습(잔차)"].append((d, e(b * math.exp(p3[k]))))
            out["둘 평균"].append((d, e((b + ml) / 2)))
            out["지금 방식 × 월급 배수"].append((d, e(b * pay(d))))
            out["둘 평균 × 월급 배수"].append((d, e((b * pay(d) + ml) / 2)))
            out["기계학습-월급·쏠림 뺌"].append((d, e(math.exp(p2[k]))))
    return out, (list(X.columns), gain_sum)


def pct(xs):
    return f"{round(sum(e for _, e in xs) / len(xs) * 1000) / 10}%" if xs else "—"


print("빵 총 개수 하루 오차 (절대 %, 작을수록 좋음) — 달마다 그 전 자료로만 배움")
for lead, wx in [(7, False), (4, True)]:
    out, (names, gain) = run(lead, wx, [f"2026-{m:02d}" for m in range(4, 10)])
    print(f"\n[{lead}일 앞 · 날씨 {'앎' if wx else '모름'}] {'목요일 주간 계획' if lead == 7 else '3일 전 최종 계획'}")
    for k, xs in out.items():
        a = [x for x in xs if x[0] < D("2026-07-01")]
        b = [x for x in xs if x[0] >= D("2026-07-01")]
        print(f"  {k:<16} 4~6월 {pct(a):>6} · 7~9월 {pct(b):>6} · 전체 {pct(xs):>6} ({len(xs)}일)")
        months = sorted({d.strftime('%m') for d, _ in xs})
        print("      달마다 " + " · ".join(f"{m}월 {pct([x for x in xs if x[0].strftime('%m') == m])}" for m in months))
    tot = gain.sum()
    top = sorted(zip(names, gain), key=lambda t: -t[1])
    print("  기계학습이 많이 쓴 항목: " + " · ".join(f"{n} {round(g / tot * 100)}%" for n, g in top[:12]))

# 월급 · 풍선효과 직접 보기 — 앞뒤 2주 같은 날 유형 평균 대비
print("\n월급날 · 그달 몇째 주 — 앞뒤 2주 같은 날 유형 평균보다 많이(+)/적게(−)")
dev = {}
for d in bread:
    k = info[d]["kind"]
    near = [bread[x] for x in (d + timedelta(days=j) for j in range(-14, 15) if j) if x in bread and info.get(x, {}).get("kind") == k]
    if len(near) >= 2:
        dev[d] = math.log(bread[d] / (sum(near) / len(near)))
buckets = [("1~5일", 1, 5), ("6~10일", 6, 10), ("11~15일", 11, 15), ("16~20일", 16, 20), ("21~24일", 21, 24), ("25~31일 (월급 뒤)", 25, 31)]
for name, lo, hi in buckets:
    xs = [v for d, v in dev.items() if lo <= d.day <= hi]
    print(f"  {name:<14} {round((math.exp(sum(xs) / len(xs)) - 1) * 1000) / 10:+}% ({len(xs)}일)")
# 풍선효과 — 한 주가 평소보다 많으면 다음 주는 적은가 (주 합계, 앞뒤 4주 평균 대비)
weeks = {}
for d, v in bread.items():
    mon = d - timedelta(days=d.weekday())
    weeks.setdefault(mon, []).append(v)
wk = {m: sum(v) for m, v in weeks.items() if len(v) == 7}
wdev = {}
for m in wk:
    near = [wk[m + timedelta(days=7 * j)] for j in range(-4, 5) if j and (m + timedelta(days=7 * j)) in wk]
    if len(near) >= 4:
        wdev[m] = math.log(wk[m] / (sum(near) / len(near)))
pairs = [(wdev[m], wdev[m + timedelta(days=7)]) for m in wdev if m + timedelta(days=7) in wdev]
if len(pairs) > 5:
    a, b = np.array(pairs).T
    print(f"\n풍선효과 — 이번 주 쏠림과 다음 주 쏠림의 상관 {np.corrcoef(a, b)[0, 1]:+.2f} ({len(pairs)}쌍) · 음수면 '많은 주 다음엔 적다'")
    hi = [y for x, y in pairs if x > 0.05]
    lo = [y for x, y in pairs if x < -0.05]
    f = lambda xs: f"{round((math.exp(sum(xs) / len(xs)) - 1) * 1000) / 10:+}%" if xs else "—"
    print(f"  평소보다 5% 넘게 많은 주 다음 주: {f(hi)} ({len(hi)}주) · 5% 넘게 적은 주 다음 주: {f(lo)} ({len(lo)}주)")
