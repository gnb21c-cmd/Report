"""클라우드 보관함(Firebase) 에 날씨 올리기 — GitHub 가 1시간마다 부름 (.github/workflows/weather.yml)

- 로그인: 날씨 전용 계정(weather@…, 이메일·비밀번호) → 1시간짜리 출입증(idToken)
- 날씨: boards/{열쇠}/weather/{날짜} (열쇠 = 보고 앱 설치 주소 /b/{열쇠}/ 와 같은 값)
보안 규칙(firebase/firestore.rules)이 senders 명단에 있는 계정만 쓰게 막음
"""
from __future__ import annotations

import datetime as dt
import json
import time
import urllib.error
import urllib.request

AUTH_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={key}"
DOC_URL = "https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents/{path}"


class RelayError(Exception):
    """보관함에 올리지 못함. retry=True 면 인터넷 문제라 나중에 다시"""

    def __init__(self, msg: str, retry: bool = True):
        super().__init__(msg)
        self.retry = retry


def _post(url: str, body: dict, token: str | None = None, method: str = "POST", timeout: float = 20) -> dict:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json; charset=utf-8"})
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode("utf-8")).get("error", {})
            msg = detail.get("message") or str(detail)
        except Exception:
            msg = str(e)
        retry = e.code >= 500 or e.code == 429
        raise RelayError(explain(e.code, str(msg)), retry=retry)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise RelayError(f"인터넷에 연결하지 못했습니다 — 보관해 두었다가 다음에 보냅니다. ({str(e)[:120]})", retry=True)


def explain(code: int, msg: str) -> str:
    low = msg.upper()
    if "INVALID_PASSWORD" in low or "EMAIL_NOT_FOUND" in low or "INVALID_LOGIN_CREDENTIALS" in low:
        return "올리기 계정(이메일·비밀번호)이 맞지 않습니다 — 설정을 확인해 주세요."
    if "USER_DISABLED" in low:
        return "올리기 계정이 사용 중지되었습니다 — 관리자에게 문의해 주세요."
    if "API_KEY" in low or "API KEY" in low:
        return "클라우드 보관함 API 키가 맞지 않습니다 — 설정을 확인해 주세요."
    if code == 403 or "PERMISSION" in low:
        return "이 계정으로는 쓸 수 없는 곳입니다 (보안 규칙) — Firebase senders 문서의 board 와 매장 열쇠를 확인해 주세요."
    if code == 404:
        return "클라우드 보관함(프로젝트)을 찾지 못했습니다 — projectId 를 확인해 주세요."
    return f"클라우드 보관함 오류 {code}: {msg[:200]}"


def _value(v):
    """파이썬 값 → Firestore REST 값"""
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, dt.datetime):
        return {"timestampValue": v.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")}
    if v is None:
        return {"nullValue": None}
    return {"stringValue": str(v)}


def fields(d: dict) -> dict:
    return {"fields": {k: _value(v) for k, v in d.items()}}


class FirebaseRelay:
    def __init__(self, fb: dict, clock=time.time, post=_post):
        self.api_key = str(fb.get("apiKey") or "")
        self.project = str(fb.get("projectId") or "")
        self.email = str(fb.get("email") or "")
        self.password = str(fb.get("password") or "")
        self.board = str(fb.get("board") or "")
        self.clock, self.post = clock, post
        self._token, self._until = None, 0.0

    def token(self) -> str:
        if self._token and self.clock() < self._until:
            return self._token
        res = self.post(AUTH_URL.format(key=self.api_key), {"email": self.email, "password": self.password, "returnSecureToken": True})
        self._token = res.get("idToken")
        if not self._token:
            raise RelayError("올리기 계정으로 로그인하지 못했습니다.", retry=True)
        self._until = self.clock() + max(60, int(res.get("expiresIn") or 3600) - 300)
        return self._token

    def put(self, path: str, data: dict):
        url = DOC_URL.format(project=self.project, path=path)
        return self.post(url, fields(data), token=self.token(), method="PATCH")

    def put_weather(self, day: dict):
        """boards/{열쇠}/weather/{날짜} — 보고 앱이 at 으로 새로 온 것만 받음"""
        body = {k: day.get(k) for k in ("date", "key", "label", "icon", "tempMax", "tempMin", "rainMm", "source", "basis")}
        return self.put(f"boards/{self.board}/weather/{day['date']}", {**body, "at": dt.datetime.now(dt.timezone.utc)})

    def weather_sources(self) -> dict:
        """이미 올린 날씨 {날짜: observed|observed-partial|forecast} — 관측인데 최고/최저가 비었으면 observed-partial (다시 받을 날)"""
        out, page = {}, ""
        for _ in range(50):
            url = DOC_URL.format(project=self.project, path=f"boards/{self.board}/weather") + f"?pageSize=300&mask.fieldPaths=source&mask.fieldPaths=tempMax&mask.fieldPaths=tempMin{'&pageToken=' + page if page else ''}"
            res = self.post(url, None, token=self.token(), method="GET")
            for d in res.get("documents") or []:
                f = d.get("fields") or {}
                src = (f.get("source") or {}).get("stringValue", "")
                blank = any(k not in f or "nullValue" in f[k] for k in ("tempMax", "tempMin"))
                out[d["name"].rsplit("/", 1)[-1]] = "observed-partial" if src == "observed" and blank else src
            page = res.get("nextPageToken") or ""
            if not page:
                break
        return out
