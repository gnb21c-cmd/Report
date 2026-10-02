"""설정 파일 (config.json) — 보통 C:\\ProgramData\\PosReport\\config.json (이 PC 에만, 저장소에 넣지 않음)

{
  "name": "사무실 C",                    A 화면 위에 보이는 이름
  "port": 8770,                          A · B 화면 주소 http://이PC이름:8770/  (PC 찾기는 UDP 8771)
  "officePin": "",                       사무실 비밀번호 — 비워 두면 묻지 않음 (손님 와이파이가 같은 공유기면 정하기)
  "firebase": {                          클라우드 보관함 (docs/SETUP.md) — 비어 있으면 '시험 모드' (C 에만 쌓고 폰에는 안 감)
    "apiKey": "…", "projectId": "…",
    "email": "office@…", "password": "…",  올리기 전용 계정 (senders 문서 pos = "all")
    "board": "…"                          매장 열쇠 (보고 앱 설치 주소 /b/{열쇠}/ 와 같은 값)
  },
  "weather": { "serviceKey": "…" }      기상청 공공데이터포털 인증키 (없으면 날씨는 건너뜀). 기본 위치: 격자 61·119, 관측소 119 수원
}
"""
from __future__ import annotations

import json
import os

DEFAULTS = {
    "name": "사무실 C",
    "port": 8770,
    "officePin": "",
    "firebase": {"apiKey": "", "projectId": "", "email": "", "password": "", "board": ""},
    "weather": {"serviceKey": ""},
}
DISCOVERY_PORT = 8771


class ConfigError(Exception):
    pass


def data_dir() -> str:
    """설정 · 보관함(office.db) · 기록을 두는 폴더"""
    home = os.environ.get("POS_REPORT_HOME")
    if home:
        return home
    base = os.environ.get("PROGRAMDATA") or os.path.expanduser("~")
    return os.path.join(base, "PosReport")


def default_path() -> str:
    return os.path.join(data_dir(), "config.json")


def load(path: str | None = None, must_exist: bool = True) -> dict:
    path = path or default_path()
    raw: dict = {}
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8-sig") as f:
                raw = json.load(f)
        except ValueError as e:
            raise ConfigError(f"설정 파일을 읽지 못했습니다 ({path}): {e}")
        if not isinstance(raw, dict):
            raise ConfigError(f"설정 파일 모양이 이상합니다: {path}")
    elif must_exist:
        raise ConfigError(f"설정 파일이 없습니다: {path} — install-c.bat 으로 설치해 주세요.")
    conf = {**DEFAULTS, **raw}
    conf["firebase"] = {**DEFAULTS["firebase"], **(raw.get("firebase") or {})}
    conf["weather"] = {**DEFAULTS["weather"], **(raw.get("weather") or {})}
    for old in ("stores", "pos", "source", "catchUpDays"):  # 예전 '매출 보내기' 설정은 버림
        conf.pop(old, None)
    conf["_path"] = path
    return conf


def save(conf: dict, path: str | None = None) -> str:
    path = path or conf.get("_path") or default_path()
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    body = {k: v for k, v in conf.items() if not k.startswith("_")}
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(body, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)
    return path


def trial_mode(conf: dict) -> bool:
    """클라우드 보관함 설정이 아직 없음 → 시험 모드 (C 에만 쌓고 폰에는 올리지 않음)"""
    fb = conf.get("firebase") or {}
    return not all(str(fb.get(k) or "").strip() for k in ("apiKey", "projectId", "board", "email", "password"))


def problems(conf: dict) -> list:
    """설정에서 고쳐야 할 것 (없으면 빈 목록)"""
    out = []
    port = conf.get("port")
    if not isinstance(port, int) or not 1024 <= port <= 65535:
        out.append("port 는 1024~65535 사이 정수여야 합니다.")
    fb = conf.get("firebase") or {}
    filled = [k for k in ("apiKey", "projectId", "board", "email", "password") if str(fb.get(k) or "").strip()]
    if filled and len(filled) < 5:
        for k, label in (("apiKey", "API 키"), ("projectId", "프로젝트 ID"), ("board", "매장 열쇠"), ("email", "올리기 계정"), ("password", "올리기 계정 비밀번호")):
            if k not in filled:
                out.append(f"클라우드 보관함 {label}({k})가 비어 있습니다.")
    return out
