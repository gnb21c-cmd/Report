"""python -m report_weather.check — 클라우드에 올라간 최근 날씨를 날짜마다 보여 줌 (확인용, 쓰지 않음)
기상청에도 어제 관측 · 오늘 예보를 직접 물어 최고/최저가 오는지 봄. 날씨는 공개 정보라 기록에 남겨도 됨
"""
from __future__ import annotations

import datetime as dt
import os

from .relay import DOC_URL, FirebaseRelay
from .weather import Kma, WeatherError

KST = dt.timezone(dt.timedelta(hours=9))
env = os.environ
relay = FirebaseRelay({"apiKey": env["FIREBASE_API_KEY"], "projectId": env["FIREBASE_PROJECT_ID"], "board": env["REPORT_BOARD_KEY"], "email": env["WEATHER_EMAIL"], "password": env["WEATHER_PASSWORD"]})
now = dt.datetime.now(KST)
print(f"지금 {now:%Y-%m-%d %H:%M} (한국)")
print("── 클라우드에 있는 날씨 (최근 14일 + 앞 4일)")
for i in range(-14, 5):
    d = (now.date() + dt.timedelta(days=i)).isoformat()
    try:
        doc = relay.post(DOC_URL.format(project=relay.project, path=f"boards/{relay.board}/weather/{d}"), None, token=relay.token(), method="GET")
        f = {k: list(v.values())[0] for k, v in (doc.get("fields") or {}).items()}
        print(f"  {d}: {f.get('source', '?'):8} 최고 {f.get('tempMax')} · 최저 {f.get('tempMin')} · {f.get('label')} · 기준 {f.get('basis')} · 올린 때 {f.get('at')}")
    except Exception as e:
        print(f"  {d}: 없음 ({str(e)[:60]})")
kma = Kma({"serviceKey": env["KMA_SERVICE_KEY"]})
y = (now.date() - dt.timedelta(days=1)).isoformat()
print("── 기상청에 직접: 어제 관측")
try:
    for x in kma.observed((now.date() - dt.timedelta(days=3)).isoformat(), y):
        print(f"  {x['date']}: 관측 최고 {x['tempMax']} · 최저 {x['tempMin']}")
except WeatherError as e:
    print("  실패:", e)
print("── 기상청에 직접: 오늘 예보")
try:
    for x in kma.forecast(now.replace(tzinfo=None)):
        print(f"  {x['date']}: 예보 최고 {x['tempMax']} · 최저 {x['tempMin']} · 기준 {x['basis']}")
except WeatherError as e:
    print("  실패:", e)
print("── 고친 규칙으로 보면 (쓰지 않음)")
have = relay.weather_sources()
part = sorted(d for d, s in have.items() if s == "observed-partial")
print("  최고/최저가 빈 관측일:", ", ".join(part) or "없음")
