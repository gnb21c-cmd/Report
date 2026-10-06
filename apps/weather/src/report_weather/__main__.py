"""python -m report_weather — 기상청에서 날씨를 받아 클라우드에 올림

환경 변수 (GitHub 저장소 Secrets · Variables)
  FIREBASE_API_KEY · FIREBASE_PROJECT_ID   클라우드 주소
  REPORT_BOARD_KEY                         매장 열쇠
  WEATHER_EMAIL · WEATHER_PASSWORD         날씨 전용 계정 (senders 명단에 board 와 함께)
  KMA_SERVICE_KEY                          기상청 인증키
처음에는 2025-01-01 부터 관측이 빈 날을 모두 채우고, 그 뒤로는 어제 관측 + 오늘 예보만
"""
from __future__ import annotations

import datetime as dt
import os
import sys

from .relay import FirebaseRelay
from .weather import Kma, WeatherError, days_to_fetch

KST = dt.timezone(dt.timedelta(hours=9))


CHUNK_DAYS = 60  # 기상청은 긴 기간을 한 번에 달라면 늦게 답해서 나눠 받음
# 기상청은 어제 관측을 아침 일찍 최고/최저 없이 먼저 내줄 때가 있음 → 'observed-partial' 로 두고 다시 받음
# (최근 7일만 — 오래전 날이 끝내 비어 있어도 매시간 그날부터 다시 받지 않게)
PARTIAL_DAYS = 7


def chunks(start: str, end: str, size: int = CHUNK_DAYS) -> list:
    """(시작, 끝) 기간을 size 일씩 자름"""
    a, b = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    out = []
    while a <= b:
        z = min(b, a + dt.timedelta(days=size - 1))
        out.append((a.isoformat(), z.isoformat()))
        a = z + dt.timedelta(days=1)
    return out


def run(relay, kma, now: dt.datetime, errors: list | None = None) -> list:
    """한 번 돌기 → 올린 (날짜, 종류) 목록. 실패한 부분은 errors 에 적고 나머지는 계속"""
    errors = [] if errors is None else errors
    have = relay.weather_sources()
    done = []

    def put(days):
        for d in days:
            if d["source"] != "observed" and have.get(d["date"], "").startswith("observed"):
                continue  # 예보는 관측을 못 바꿈
            relay.put_weather(d)
            partial = d["source"] == "observed" and (d.get("tempMax") is None or d.get("tempMin") is None)
            have[d["date"]] = "observed-partial" if partial else d["source"]
            done.append((d["date"], d["source"]))

    recent = (now.date() - dt.timedelta(days=PARTIAL_DAYS)).isoformat()
    finished = {d for d, s in have.items() if s == "observed" or (s == "observed-partial" and d < recent)}
    span = days_to_fetch(now.date(), finished, kma.conf.get("since", "2025-01-01"))
    for a, b in chunks(*span) if span else []:
        try:
            put(kma.observed(a, b))  # 받은 만큼 바로 올림 → 다음 번엔 이어서
        except WeatherError as e:
            errors.append(f"관측 {a}~{b}: {e}")
            break
    try:
        put(kma.forecast(now.replace(tzinfo=None)))
    except WeatherError as e:
        errors.append(f"예보: {e}")
    return done


def main() -> int:
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    env = os.environ
    need = ["FIREBASE_API_KEY", "FIREBASE_PROJECT_ID", "REPORT_BOARD_KEY", "WEATHER_EMAIL", "WEATHER_PASSWORD", "KMA_SERVICE_KEY"]
    missing = [k for k in need if not env.get(k, "").strip()]
    if missing:
        print("설정이 비어 있어 건너뜀:", ", ".join(missing))
        return 0
    relay = FirebaseRelay({"apiKey": env["FIREBASE_API_KEY"], "projectId": env["FIREBASE_PROJECT_ID"], "board": env["REPORT_BOARD_KEY"], "email": env["WEATHER_EMAIL"], "password": env["WEATHER_PASSWORD"]})
    kma = Kma({"serviceKey": env["KMA_SERVICE_KEY"]})
    errors: list = []
    done = run(relay, kma, dt.datetime.now(KST), errors)
    print(f"날씨 {len(done)}일 올림" + (f" ({done[0][0]} ~ {done[-1][0]})" if done else ""))
    for e in errors:
        print("실패:", e)
    return 1 if errors else 0


sys.exit(main())
