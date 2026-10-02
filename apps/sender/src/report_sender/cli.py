"""명령 — PosReport.exe 뒤에

  window              근무자 '보내기' 창 (바탕화면 아이콘)
  auto                창 없이 한 번 보냄 (카페: 정해진 시각 · PC 켤 때 못 보낸 날)
  check               설정 · POS 자료 읽기 · 보관함 연결 점검 (아무것도 안 보냄)
  dry-run             오늘 자료를 읽어 보낼 내용만 보여 줌
  import 폴더 --pos   지난 엑셀(상품별 일자별) 여러 개를 한 번에 올림 (작년 비교용)
  setup               설정 넣기 (설치 스크립트가 부름)
  version
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import logging.handlers
import os
import sys

from . import VERSION
from .config import ConfigError, basic_problems, data_dir, load, pos_label, problems, save, trial_mode
from .lock import AlreadyRunning, acquire
from .normalize import aggregate, totals, won


def setup_logging():
    os.makedirs(os.path.join(data_dir(), "logs"), exist_ok=True)
    h = logging.handlers.RotatingFileHandler(os.path.join(data_dir(), "logs", "send.log"), maxBytes=1_000_000, backupCount=5, encoding="utf-8")
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(h)


def make_sender(conf):
    from .runner import Sender

    if trial_mode(conf):
        from .trial import TrialSender

        bad = basic_problems(conf)
        if bad:
            raise ConfigError(" / ".join(bad))
        return TrialSender(conf)
    bad = problems(conf)
    if bad:
        raise ConfigError(" / ".join(bad))
    return Sender(conf)


def cmd_auto(conf, args):
    from .gui import result_lines

    if trial_mode(conf):
        return 0  # 시험 모드에서는 저절로 하지 않음

    try:
        lock = acquire(os.path.join(data_dir(), "send.lock"))
    except AlreadyRunning:
        return 0
    sender = make_sender(conf)
    try:
        res = sender.run()
    finally:
        sender.close()
        lock.close()
    for ln in result_lines(res):
        print(ln)
        logging.info(ln)
    return 0 if res.error is None else 1


def cmd_window(conf, args):
    from .gui import run_window

    run_window(conf, lambda: make_sender(conf))
    return 0


def cmd_check(conf, args):
    print(f"판 {VERSION} · 이 PC: {pos_label(conf)} POS · 설정 {conf['_path']}")
    bad = problems(conf)
    for b in bad:
        print("[확인 필요]", b)
    from .outbox import Outbox
    from .relay import FirebaseRelay, RelayError
    from .sources import SourceError, make_source

    ob = Outbox(os.path.join(data_dir(), "outbox.db"))
    try:
        src = make_source(conf.get("source") or {}, ob)
        print("읽는 방법:", src.describe())
        if src.type == "firebird":
            today = dt.date.today().isoformat()
            rows = src.poll([today])[0].rows
            t = totals(rows)
            print(f"[정상] 오늘 상품 {len(rows)}개 · 실매출 {won(t['net'])}")
        elif src.type == "folder":
            print(f"[정상] 엑셀 {len(src.files())}개가 폴더에 있음")
    except SourceError as e:
        print("[확인 필요]", e)
    if not bad:
        try:
            FirebaseRelay(conf["firebase"]).token()
            print("[정상] 클라우드 보관함 로그인")
        except RelayError as e:
            print("[확인 필요]", e)
    print("아직 못 보낸 날:", ob.pending())
    ob.close()
    return 0


def cmd_dry_run(conf, args):
    from .outbox import Outbox
    from .runner import days_to_read
    from .sources import make_source

    ob = Outbox(":memory:")
    src = make_source(conf.get("source") or {}, ob)
    for it in src.poll(days_to_read(dt.date.today(), 0)):
        t = totals(it.rows)
        print(f"{it.date} · 상품 {len(it.rows)}개 · 실매출 {won(t['net'])} ({it.source})")
        for r in sorted(it.rows, key=lambda r: -r["net"])[:5]:
            print(f"   {r['name']} × {r['qty']} = {won(r['net'])}")
    return 0


def cmd_trial(conf, args):
    """보내지 않고 읽기만 → 바탕화면 결과 파일"""
    from .gui import result_lines
    from .trial import TrialSender

    t = TrialSender(conf)
    try:
        res = t.run()
    finally:
        t.close()
    for ln in result_lines(res):
        print(ln)
    return 0


def cmd_import(conf, args):
    """지난 엑셀 → 하루씩 올림 (같은 날은 통째로 바뀜)"""
    from .outbox import Outbox
    from .relay import FirebaseRelay
    from .runner import Result, Sender
    from .xls_report import days_between, read_report

    pos = args.pos or conf.get("pos")
    if pos not in ("cafe", "kids"):
        raise ConfigError("--pos cafe 또는 --pos kids 를 붙여 주세요.")
    conf = {**conf, "pos": pos}
    ob = Outbox(os.path.join(data_dir(), f"import-{pos}.db"))
    by_day: dict = {}
    for name in sorted(os.listdir(args.folder)):
        if not name.lower().endswith((".xls",)):
            continue
        rep = read_report(os.path.join(args.folder, name))
        if rep["truncated"]:
            print(f"[건너뜀] {name}: 잘린 파일 (조회줄수 제한)")
            continue
        rows = aggregate(rep["rows"])
        for d in days_between(rep["start"], rep["end"]):
            by_day[d] = ([r for r in rows if r["date"] == d], "엑셀:" + name)
        print(f"[읽음] {name}: {rep['start']} ~ {rep['end']} · {len(rows)}행")
    from .normalize import rows_hash

    for d, (rows, src) in sorted(by_day.items()):
        if rows:
            ob.enqueue(d, rows, rows_hash(rows), src)
    print(f"올릴 날 {ob.pending()}일")
    if args.dry:
        return 0

    class Nothing:
        type = "none"

        def describe(self):
            return "지난 엑셀 올리기"

        def close(self):
            pass

    sender = Sender(conf, outbox=ob, source=Nothing(), relay=FirebaseRelay(conf["firebase"]))
    res = Result()
    sender.flush(res)
    sender.close()
    print(f"올림 {len(res.sent)}일 · 남음 {res.pending}일" + (f" · 오류: {res.error}" if res.error else ""))
    return 0 if res.error is None else 1


def cmd_setup(conf, args):
    if args.pos:
        conf["pos"] = args.pos
    fb = conf["firebase"]
    for k in ("apiKey", "projectId", "email", "password", "board"):
        v = getattr(args, k.lower())
        if v:
            fb[k] = v
    if args.kma_key:
        conf.setdefault("weather", {})["serviceKey"] = args.kma_key
    if args.source_file:
        with open(args.source_file, encoding="utf-8-sig") as f:
            conf["source"] = json.load(f)
    if args.folder:
        conf["source"] = {"type": "folder", "folder": args.folder, "pattern": "*.xls"}
        os.makedirs(args.folder, exist_ok=True)
    path = save(conf)
    print("설정 저장:", path)
    if trial_mode(conf):
        for b in basic_problems(conf):
            print("[확인 필요]", b)
        print("[시험 모드] 클라우드 보관함 설정이 없어 보내지 않고 읽기만 합니다 (바탕화면에 결과 파일).")
        return 0
    for b in problems(conf):
        print("[확인 필요]", b)
    return 0


def safe_console():
    """한글을 못 쓰는 창(영문 Windows 등)에서도 멈추지 않게 — 한글을 쓸 수 없으면 UTF-8 로, 그래도 안 되는 글자는 ? 로"""
    for stream in (sys.stdout, sys.stderr):
        try:
            "가".encode(stream.encoding or "ascii")
            stream.reconfigure(errors="replace")
        except (UnicodeEncodeError, LookupError):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
        except Exception:
            pass


def main(argv=None) -> int:
    safe_console()
    p = argparse.ArgumentParser(prog="PosReport", description="매장 POS 매출 보내기")
    p.add_argument("--config", help="설정 파일 경로")
    sub = p.add_subparsers(dest="cmd")
    sub.add_parser("window")
    sub.add_parser("auto")
    sub.add_parser("check")
    sub.add_parser("dry-run")
    sub.add_parser("trial")
    sub.add_parser("version")
    im = sub.add_parser("import")
    im.add_argument("folder")
    im.add_argument("--pos", choices=["cafe", "kids"])
    im.add_argument("--dry", action="store_true", help="읽기만, 올리지 않음")
    st = sub.add_parser("setup")
    st.add_argument("--pos", choices=["cafe", "kids"])
    st.add_argument("--apikey")
    st.add_argument("--projectid")
    st.add_argument("--email")
    st.add_argument("--password")
    st.add_argument("--board", help="매장 열쇠 (보고 앱 설치 주소의 /b/ 뒤)")
    st.add_argument("--kma-key", help="기상청 공공데이터포털 인증키")
    st.add_argument("--folder", help="엑셀 폴더 (엑셀 방식으로 정함)")
    st.add_argument("--source-file", help="읽는 방법 JSON 파일")
    args = p.parse_args(argv)
    cmd = args.cmd or "window"
    if cmd == "version":
        print(VERSION)
        return 0
    try:
        setup_logging()
        conf = load(args.config, must_exist=cmd not in ("setup",))
        return {
            "window": cmd_window,
            "auto": cmd_auto,
            "check": cmd_check,
            "dry-run": cmd_dry_run,
            "trial": cmd_trial,
            "import": cmd_import,
            "setup": cmd_setup,
        }[cmd](conf, args)
    except ConfigError as e:
        print("[설정]", e, file=sys.stderr)
        if cmd == "window":
            _show_error(str(e))
        return 2


def _show_error(text: str):
    try:
        import tkinter as tk
        from tkinter import messagebox

        r = tk.Tk()
        r.withdraw()
        messagebox.showerror("매출 보내기", text)
        r.destroy()
    except Exception:
        pass
