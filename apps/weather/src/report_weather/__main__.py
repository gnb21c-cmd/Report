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
from .weather import Kma, days_to_fetch

KST = dt.timezone(dt.timedelta(hours=9))


def run(relay, kma, now: dt.datetime) -> list:
    """한 번 돌기 → 올린 (날짜, 종류) 목록"""
    have = relay.weather_sources()
    span = days_to_fetch(now.date(), {d for d, s in have.items() if s == "observed"}, kma.conf.get("since", "2025-01-01"))
    days = kma.observed(*span) if span else []
    days += kma.forecast(now.replace(tzinfo=None))
    done = []
    for d in days:
        if d["source"] != "observed" and have.get(d["date"]) == "observed":
            continue  # 예보는 관측을 못 바꿈
        relay.put_weather(d)
        have[d["date"]] = d["source"]
        done.append((d["date"], d["source"]))
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
    done = run(relay, kma, dt.datetime.now(KST))
    print(f"날씨 {len(done)}일 올림" + (f" ({done[0][0]} ~ {done[-1][0]})" if done else ""))
    return 0


sys.exit(main())
