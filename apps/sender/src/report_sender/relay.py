"""클라우드 보관함(Firebase) 에 올리기 — 우리가 운영하는 서버 없이, Google 이 운영하는 보관함을 우편함처럼 씀

- 로그인: 이 PC 전용 계정(이메일·비밀번호) → 1시간짜리 출입증(idToken)
- 매장 자료는 boards/{열쇠}/ 아래 (열쇠 = 보고 앱 설치 주소 /b/{열쇠}/ 와 같은 값)
- 하루치: boards/{열쇠}/days/{pos}_{date} 문서 하나를 통째로 덮어씀 (rows 는 JSON 글자 한 칸)
- 상태: boards/{열쇠}/devices/{pos} — 마지막 송부·프로그램 판·남은 묶음·오류 (보고 앱 설정에 보임)
보안 규칙(firebase/firestore.rules)이 이 계정은 자기 POS 문서만 쓰게 막음
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
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
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
        return "보내기 계정(이메일·비밀번호)이 맞지 않습니다 — 설정을 확인해 주세요."
    if "USER_DISABLED" in low:
        return "보내기 계정이 사용 중지되었습니다 — 관리자에게 문의해 주세요."
    if "API_KEY" in low or "API KEY" in low:
        return "클라우드 보관함 API 키가 맞지 않습니다 — 설정을 확인해 주세요."
    if code == 403 or "PERMISSION" in low:
        return "이 PC 계정으로는 쓸 수 없는 곳입니다 (보안 규칙) — 설정의 pos 와 계정을 확인해 주세요."
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


def day_doc(pos: str, date: str, rows: list, source: str, sender: str, version: str, now: dt.datetime) -> dict:
    """days/{pos}_{date} 문서 내용 (보고 앱 apps/view/src/data/firebase.ts 가 읽는 모양)"""
    return {
        "pos": pos,
        "date": date,
        "rows": json.dumps(rows, ensure_ascii=False, separators=(",", ":")),
        "count": len(rows),
        "net": sum(int(r.get("net") or 0) for r in rows),
        "source": source[:120],
        "sender": sender,
        "version": version,
        "sentAt": now,
    }


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
            raise RelayError("보내기 계정으로 로그인하지 못했습니다.", retry=True)
        self._until = self.clock() + max(60, int(res.get("expiresIn") or 3600) - 300)
        return self._token

    def put(self, path: str, data: dict):
        url = DOC_URL.format(project=self.project, path=path)
        return self.post(url, fields(data), token=self.token(), method="PATCH")

    def put_day(self, pos: str, date: str, rows: list, source: str, version: str, now: dt.datetime | None = None):
        now = now or dt.datetime.now(dt.timezone.utc)
        return self.put(f"boards/{self.board}/days/{pos}_{date}", day_doc(pos, date, rows, source, self.email, version, now))

    def put_status(self, pos: str, status: dict):
        return self.put(f"boards/{self.board}/devices/{pos}", {**status, "at": dt.datetime.now(dt.timezone.utc)})
