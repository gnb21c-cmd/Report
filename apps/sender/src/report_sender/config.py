"""설정 파일 (config.json) — 보통 C:\\ProgramData\\PosReport\\config.json (이 PC 에만, 저장소에 넣지 않음)

{
  "pos": "cafe" | "kids",               이 PC 가 어느 POS 인지
  "firebase": {                          클라우드 보관함 (docs/SETUP.md)
    "apiKey": "…", "projectId": "…",
    "email": "cafe-pos@…", "password": "…",  이 PC 전용 계정 (자기 POS 자료만 쓸 수 있음)
    "board": "…"                          매장 열쇠 (보고 앱 설치 주소 /b/{열쇠}/ 와 같은 값)
  },
  "weather": { "serviceKey": "…" },     기상청 공공데이터포털 인증키 (없으면 날씨는 건너뜀). 위치 기본값: 격자 61·119, 관측소 119 수원
  "catchUpDays": 3,                      보낼 때 지난 며칠도 다시 맞춰 봄 (늦은 취소·못 보낸 날)
  "source": { "type": "folder" | "firebird" | "none", … }   POS 자료 읽는 방법 (sources.py)
}
"""
from __future__ import annotations

import json
import os

POS_LABEL = {"cafe": "카페", "kids": "키즈"}

DEFAULTS = {
    "pos": "",
    "firebase": {"apiKey": "", "projectId": "", "email": "", "password": "", "board": ""},
    "catchUpDays": 3,
    "weather": {"serviceKey": ""},
    "source": {"type": "none"},
}


class ConfigError(Exception):
    pass


def data_dir() -> str:
    """설정·보관함·기록을 두는 폴더"""
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
        raise ConfigError(f"설정 파일이 없습니다: {path} — install.bat 으로 설치해 주세요.")
    conf = {**DEFAULTS, **raw}
    conf["firebase"] = {**DEFAULTS["firebase"], **(raw.get("firebase") or {})}
    conf["source"] = {**DEFAULTS["source"], **(raw.get("source") or {})}
    conf["weather"] = {**DEFAULTS["weather"], **(raw.get("weather") or {})}
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


def problems(conf: dict) -> list:
    """설정에서 고쳐야 할 것 (없으면 빈 목록)"""
    out = []
    if conf.get("pos") not in POS_LABEL:
        out.append('이 PC 가 어느 POS 인지(pos: "cafe" 또는 "kids") 정해지지 않았습니다.')
    fb = conf.get("firebase") or {}
    for k, label in (("apiKey", "API 키"), ("projectId", "프로젝트 ID"), ("board", "매장 열쇠"), ("email", "보내기 계정"), ("password", "보내기 계정 비밀번호")):
        if not str(fb.get(k) or "").strip():
            out.append(f"클라우드 보관함 {label}({k})가 비어 있습니다.")
    n = conf.get("catchUpDays")
    if not isinstance(n, int) or not 0 <= n <= 31:
        out.append("catchUpDays 는 0~31 사이 정수여야 합니다.")
    return out


def pos_label(conf: dict) -> str:
    return POS_LABEL.get(conf.get("pos") or "", "?")


def trial_mode(conf: dict) -> bool:
    """보관함(Firebase) 설정이 아직 없음 → 시험 모드 (읽기만, 보내지 않음)"""
    fb = conf.get("firebase") or {}
    return not all(str(fb.get(k) or "").strip() for k in ("apiKey", "projectId", "board", "email", "password"))


def basic_problems(conf: dict) -> list:
    """시험 모드에서도 필요한 것 (POS 구분)"""
    return [p for p in problems(conf) if "pos" in p]
