"""기상청 날씨 — 아스타나 packages/domain/src/weather.ts · apps/server/src/integrations/kma.ts 와 같은 규칙

서버가 없으므로 POS PC 의 A 가 송부할 때 함께 받아 보관함 boards/{열쇠}/weather/{날짜} 에 쌓음
- 지난 날: 지상관측(ASOS) 일자료 → 실제 최고/최저기온 · 날씨 (관측소 119 수원)
- 오늘: 단기예보 → 예보 최고/최저 · 날씨 (격자 61·119, 화성 매장). 다음 날 관측값이 오면 관측으로 바뀜
- 날씨 5종: 맑음 ☀️ · 구름 ☁️ · 비 🌧️ · 강우 ⛈️ · 눈 ❄️
"""
from __future__ import annotations

import datetime as dt
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://apis.data.go.kr/1360000"
TYPES = {"sunny": ("맑음", "☀️"), "cloudy": ("구름", "☁️"), "rain": ("비", "🌧️"), "heavyrain": ("강우", "⛈️"), "snow": ("눈", "❄️")}
HEAVY_RAIN_MM = 30
FORECAST_BASE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23]
MESSAGES = {
    "03": "해당 조건의 자료가 없습니다",
    "10": "요청 값이 잘못되었습니다",
    "11": "필수 요청 값이 빠졌습니다",
    "20": "서비스 접근이 거부되었습니다 (활용신청 확인)",
    "22": "하루 호출 한도를 넘었습니다",
    "30": "등록되지 않은 인증키입니다 (활용신청 승인·키 확인)",
    "31": "활용 기간이 만료되었습니다",
    "32": "등록되지 않은 IP 입니다",
}

DEFAULTS = {"serviceKey": "", "nx": 61, "ny": 119, "asosStn": "119", "since": "2025-01-01"}


class WeatherError(Exception):
    """retry=True 면 잠시 뒤 다시 하면 될 수 있는 오류 (네트워크 · 기상청 일시 오류)"""

    def __init__(self, msg: str, retry: bool = False):
        super().__init__(msg)
        self.retry = retry


def _num(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _day(date: str, key: str, tmax, tmin, rain, source: str, basis: str | None) -> dict:
    label, icon = TYPES[key]
    return {"date": date, "key": key, "label": label, "icon": icon, "tempMax": tmax, "tempMin": tmin, "rainMm": rain, "source": source, "basis": basis or ""}


def parse_precip(v) -> float:
    """예보 강수량(PCP) → mm. 강수없음=0, 1mm 미만=0.5, 30.0~50.0mm=30, 50.0mm 이상=50"""
    s = str(v or "").strip()
    if not s or s in ("강수없음", "0"):
        return 0.0
    if "미만" in s:
        return 0.5
    m = re.search(r"(\d+(?:\.\d+)?)", s)
    return float(m.group(1)) if m else 0.0


def parse_asos(items: list) -> list:
    """지상관측 일자료 → 날짜별 날씨 (관측 확정값)"""
    out = []
    for it in items:
        rain = _num(it.get("sumRn"))
        cloud = _num(it.get("avgTca"))
        snow = (_num(it.get("ddMefs")) or 0) > 0 or "눈" in str(it.get("iscs") or "")
        r = rain or 0
        key = "snow" if snow else "heavyrain" if r >= HEAVY_RAIN_MM else "rain" if r >= 1 else "cloudy" if cloud is not None and cloud > 5 else "sunny"
        out.append(_day(str(it.get("tm"))[:10], key, _num(it.get("maxTa")), _num(it.get("minTa")), r, "observed", str(it.get("stnId") or "")))
    return out


def parse_forecast(items: list) -> list:
    """단기예보 → 날짜별 날씨. 최고/최저는 TMX/TMN, 없으면 하루 온전한 시간별 기온(TMP)의 최대/최소. 날씨는 영업 시간(06~21시) 기준"""
    by_date: dict = {}
    for it in items:
        by_date.setdefault(it["fcstDate"], []).append(it)
    out = []
    day = lambda i: "0600" <= i["fcstTime"] <= "2100"
    for d, lst in sorted(by_date.items()):
        if not any(day(i) for i in lst):
            continue
        vals = lambda c: [i for i in lst if i["category"] == c]
        tmx = _num(vals("TMX")[0]["fcstValue"]) if vals("TMX") else None
        tmn = _num(vals("TMN")[0]["fcstValue"]) if vals("TMN") else None
        tmps = [x for x in (_num(i["fcstValue"]) for i in vals("TMP")) if x is not None]
        full = len(tmps) >= 20
        tmax = tmx if tmx is not None else (max(tmps) if full else None)
        tmin = tmn if tmn is not None else (min(tmps) if full else None)
        pty = [int(float(i["fcstValue"])) for i in vals("PTY") if day(i)]
        sky = [int(float(i["fcstValue"])) for i in vals("SKY") if day(i)]
        pcp = [parse_precip(i["fcstValue"]) for i in vals("PCP")]
        rain = round(sum(pcp), 1) if pcp else None
        if any(p in (3, 7) for p in pty):
            key = "snow"
        elif any(p in (1, 2, 4, 5, 6) for p in pty):
            key = "heavyrain" if (rain or 0) >= HEAVY_RAIN_MM else "rain"
        else:
            key = "sunny" if sky and sum(1 for s in sky if s == 1) * 2 >= len(sky) else "cloudy"
        date = f"{d[:4]}-{d[4:6]}-{d[6:8]}"
        out.append(_day(date, key, tmax, tmin, rain, "forecast", lst[0]["baseDate"] + lst[0]["baseTime"]))
    return out


def latest_forecast_base(now: dt.datetime) -> tuple:
    """지금(한국 시간) 조회할 수 있는 가장 최근 단기예보 발표 (발표 10분 뒤부터)"""
    minutes = now.hour * 60 + now.minute
    avail = [h for h in FORECAST_BASE_HOURS if h * 60 + 10 <= minutes]
    if avail:
        return now.strftime("%Y%m%d"), f"{avail[-1]:02d}00"
    return (now - dt.timedelta(days=1)).strftime("%Y%m%d"), "2300"


def service_key(k: str) -> str:
    """Encoding 키를 넣었으면 풀어서 씀"""
    k = (k or "").strip()
    return urllib.parse.unquote(k) if re.search(r"%[0-9A-Fa-f]{2}", k) else k


class Kma:
    def __init__(self, conf: dict, opener=None):
        self.conf = {**DEFAULTS, **(conf or {})}
        self.key = service_key(self.conf["serviceKey"])
        self.open = opener or (lambda url: urllib.request.urlopen(url, timeout=60).read().decode("utf-8"))

    def _once(self, path: str, params: dict) -> tuple:
        qs = urllib.parse.urlencode({"serviceKey": self.key, "dataType": "JSON", **params})
        try:
            text = self.open(f"{BASE}/{path}?{qs}")
        except urllib.error.HTTPError as e:
            raise WeatherError(f"기상청 HTTP {e.code}", retry=e.code >= 500)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise WeatherError(f"기상청 서버에 연결하지 못했습니다 ({str(e)[:80]})", retry=True)
        if text.lstrip().startswith("<"):
            m = re.search(r"<returnReasonCode>(\d+)<", text) or re.search(r"<resultCode>(\d+)<", text)
            code = m.group(1) if m else "99"
            raise WeatherError(f"기상청 오류 {code}: {MESSAGES.get(code, '알 수 없는 오류')}")
        j = json.loads(text)
        head = (j.get("response") or {}).get("header") or {}
        if head.get("resultCode") == "03":
            return [], 0
        if head.get("resultCode") != "00":
            code = head.get("resultCode")
            raise WeatherError(f"기상청 오류 {code}: {MESSAGES.get(code, head.get('resultMsg'))}", retry=code in ("01", "02", "04", "05", "99"))
        body = j["response"].get("body") or {}
        raw = (body.get("items") or {}).get("item") or []
        return (raw if isinstance(raw, list) else [raw]), int(body.get("totalCount") or 0)

    def _all(self, path: str, params: dict, rows: int) -> list:
        out = []
        for page in range(1, 21):
            for attempt in range(3):
                try:
                    items, total = self._once(path, {**params, "numOfRows": rows, "pageNo": page})
                    break
                except WeatherError as e:
                    if not e.retry or attempt == 2:
                        raise
                    time.sleep(1 + attempt * 2)
            out += items
            if len(out) >= total or len(items) < rows:
                break
        return out

    def observed(self, start: str, end: str) -> list:
        """start~end (YYYY-MM-DD, 어제까지) 관측 일자료"""
        items = self._all(
            "AsosDalyInfoService/getWthrDataList",
            {"dataCd": "ASOS", "dateCd": "DAY", "startDt": start.replace("-", ""), "endDt": end.replace("-", ""), "stnIds": self.conf["asosStn"]},
            999,
        )
        return parse_asos(items)

    def forecast(self, now: dt.datetime) -> list:
        """오늘 예보 — 오늘 02시 발표에 그날 최고(TMX)·최저(TMN, 06시 칸)가 다 있으므로 그것을 씀 (그 전이면 가장 최근 발표)"""
        if now.hour * 60 + now.minute >= 2 * 60 + 10:
            bd, bt = now.strftime("%Y%m%d"), "0200"
        else:
            bd, bt = latest_forecast_base(now)
        items = self._all("VilageFcstInfoService_2.0/getVilageFcst", {"base_date": bd, "base_time": bt, "nx": self.conf["nx"], "ny": self.conf["ny"]}, 1000)
        return parse_forecast(items)


def days_to_fetch(today: dt.date, have: set, since: str) -> tuple | None:
    """받을 관측 기간 (시작, 끝) — since 부터 보아 관측값이 아직 없는 가장 이른 날 ~ 어제. 다 있으면 None
    (PC 가 오래 꺼져 있었어도 빈 날을 모두 채움. 기상청은 기간을 한 번에 돌려주므로 호출은 1~2번)"""
    yesterday = today - dt.timedelta(days=1)
    d = dt.date.fromisoformat(since)
    while d <= yesterday and d.isoformat() in have:
        d += dt.timedelta(days=1)
    if d > yesterday:
        return None
    return d.isoformat(), yesterday.isoformat()
