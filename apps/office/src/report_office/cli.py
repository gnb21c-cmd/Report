"""명령 — PosReport.exe 뒤에 (PosReportC.exe 는 창 없이 serve)

  serve               C 서버 돌리기 (PC 켤 때 작업 스케줄러가 부름 — 늘 켜져 있음)
  check               설정 · 화면 파일 · 클라우드 · 기상청 점검 (아무것도 안 바꿈)
  publish             못 올린 보고를 지금 클라우드에 올림
  republish           모든 보고 · 날씨를 다시 올림 (클라우드를 새로 만들었을 때)
  setup               설정 넣기 (설치 스크립트가 부름)
  version
"""
from __future__ import annotations

import argparse
import logging
import logging.handlers
import os
import socket
import sys
import threading

from . import VERSION
from .config import ConfigError, data_dir, load, problems, save, trial_mode


def safe_console():
    """Windows 콘솔(cp949 등)에서 한글 · 이모지 때문에 멈추지 않게"""
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def setup_logging(console: bool = False):
    os.makedirs(os.path.join(data_dir(), "logs"), exist_ok=True)
    h = logging.handlers.RotatingFileHandler(os.path.join(data_dir(), "logs", "office.log"), maxBytes=2_000_000, backupCount=5, encoding="utf-8")
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(h)
    if console:
        root.addHandler(logging.StreamHandler())


def make_office(conf):
    from .server import Office
    from .store import Store

    store = Store(os.path.join(data_dir(), "office.db"))
    relay = kma = None
    if not trial_mode(conf):
        from .relay import FirebaseRelay

        relay = FirebaseRelay(conf["firebase"])
    if str((conf.get("weather") or {}).get("serviceKey") or "").strip():
        from .weather import Kma

        kma = Kma(conf["weather"])
    return Office(conf, store, relay=relay, kma=kma)


def cmd_serve(conf, args):
    from .lock import AlreadyRunning, acquire
    from .server import serve

    try:
        lock = acquire(os.path.join(data_dir(), "serve.lock"))
    except AlreadyRunning:
        print("C 서버가 이미 돌고 있습니다.")
        return 0
    office = make_office(conf)
    port = int(conf.get("port") or 8770)
    httpd = serve(office, port)
    logging.info("C 서버 시작 — 판 %s · http://%s:%d/ (%s)", VERSION, socket.gethostname(), port, "시험 모드" if trial_mode(conf) else "클라우드에 올림")
    print(f"C 서버: http://{socket.gethostname()}:{port}/  (B: /b/) — 끝내려면 Ctrl+C")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        lock.close()
    return 0


def cmd_check(conf, args):
    from .server import web_dir

    ok = True
    print(f"C 프로그램 판 {VERSION} · 이 PC 이름 {socket.gethostname()} · 주소 http://{socket.gethostname()}:{conf.get('port')}/")
    for p in problems(conf):
        ok = False
        print(f"[확인 필요] {p}")
    for name in ("entry.html", "report.html"):
        path = os.path.join(web_dir(), name)
        print(f"[{'정상' if os.path.exists(path) else '확인 필요'}] 화면 파일 {name}")
        ok = ok and os.path.exists(path)
    if trial_mode(conf):
        print("[시험 모드] 클라우드 보관함 설정 전 — 자료는 C 에만 쌓이고 폰에는 안 감 (사무실에서는 /b/ 로 볼 수 있음)")
    else:
        from .relay import FirebaseRelay

        try:
            FirebaseRelay(conf["firebase"]).token()
            print("[정상] 클라우드 보관함 로그인")
        except Exception as e:
            ok = False
            print(f"[확인 필요] 클라우드 보관함: {e}")
    if str((conf.get("weather") or {}).get("serviceKey") or "").strip():
        import datetime as dt

        from .weather import Kma

        try:
            y = (dt.date.today() - dt.timedelta(days=1)).isoformat()
            days = Kma(conf["weather"]).observed(y, y)
            print(f"[정상] 기상청 — 어제 {days[0]['icon']} {days[0]['label']} 최고 {days[0]['tempMax']}°" if days else "[정상] 기상청 연결 (어제 관측값은 아직 없음)")
        except Exception as e:
            ok = False
            print(f"[확인 필요] 기상청: {e}")
    else:
        print("[건너뜀] 기상청 인증키가 없어 날씨는 받지 않습니다.")
    print("점검 끝 — 모두 정상" if ok else "점검 끝 — [확인 필요] 를 고쳐 주세요")
    return 0 if ok else 1


def cmd_publish(conf, args, everything=False):
    office = make_office(conf)
    if trial_mode(conf):
        print("시험 모드라 올리지 않습니다 (클라우드 보관함 설정 전).")
        return 1
    if everything:
        office.store.requeue_all()
    office.sync_weather()
    done = office.push_now()
    print(f"못 올린 보고 {office.store.pending()}일" + (f" — {office.last_error}" if office.last_error else ""))
    return 0 if done else 1


def cmd_setup(conf, args):
    for k in ("apikey", "projectid", "email", "password", "board"):
        v = getattr(args, k)
        if v is not None:
            conf["firebase"][{"apikey": "apiKey", "projectid": "projectId"}.get(k, k)] = v.strip()
    if args.kma_key is not None:
        conf["weather"]["serviceKey"] = args.kma_key.strip()
    if args.pin is not None:
        conf["officePin"] = args.pin.strip()
    if args.name is not None:
        conf["name"] = args.name.strip() or "사무실 C"
    if args.port is not None:
        conf["port"] = args.port
    bad = problems(conf)
    if bad:
        for p in bad:
            print(f"[확인 필요] {p}")
        return 1
    path = save(conf)
    print(f"설정 저장: {path}" + (" (시험 모드 — 클라우드 설정 전)" if trial_mode(conf) else ""))
    return 0


def main(argv=None) -> int:
    safe_console()
    ap = argparse.ArgumentParser(prog="PosReport", description="매출 보고 — 사무실 PC (C)")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("serve")
    sub.add_parser("check")
    sub.add_parser("publish")
    sub.add_parser("republish")
    sub.add_parser("version")
    s = sub.add_parser("setup")
    for k in ("apikey", "projectid", "email", "password", "board", "pin", "name"):
        s.add_argument(f"--{k}")
    s.add_argument("--kma-key", dest="kma_key")
    s.add_argument("--port", type=int)
    args = ap.parse_args(argv)
    if args.cmd == "version":
        print(VERSION)
        return 0
    cmd = args.cmd or "serve"
    setup_logging(console=cmd != "serve")
    try:
        conf = load(must_exist=cmd not in ("setup",))
        if cmd == "setup":
            return cmd_setup(conf, args)
        if cmd == "serve":
            return cmd_serve(conf, args)
        if cmd == "check":
            return cmd_check(conf, args)
        if cmd == "publish":
            return cmd_publish(conf, args)
        if cmd == "republish":
            return cmd_publish(conf, args, everything=True)
    except ConfigError as e:
        print(f"[설정 오류] {e}")
        logging.error("설정 오류: %s", e)
        return 2
    return 0
