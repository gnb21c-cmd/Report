"""C 서버 — 사무실 안(같은 공유기)에서만 받음

  GET  /            A 입력 화면 (web/entry.html)
  GET  /b/          B 보고 화면 — 사무실에서 바로 보기 (web/report.html, 자료는 아래 /api)
  GET  /api/info    이름 · 판 · 시험 모드 · 못 올린 날 · 날씨 상태 · 비밀번호 필요 여부
  GET  /api/day?date=YYYY-MM-DD    그날 합친 보고 · 날씨
  GET  /api/products               상품 분류표
  GET  /api/reports?after=ISO      (B) 그 뒤에 바뀐 보고들
  GET  /api/weather?after=ISO      (B) 그 뒤에 바뀐 날씨
  POST /api/submit   A 의 '입력완료 · 보고자료 업로드' {date, by, parts, lines?, products?}
  POST /api/import   지난 자료 {by, parts[], products?}
쓰기(POST)는 사무실 비밀번호를 정했으면 머리글 X-Office-Pin 이 맞아야 함
뒤에서 도는 일(Worker): 클라우드에 올리기(못 올리면 1분 뒤 다시) · 기상청 날씨(1시간마다) · 상태 올리기
UDP 8771: 직원 PC 의 A 설치가 'POSREPORT-C?' 를 뿌리면 이 PC 이름 · 주소를 알려 줌
"""
from __future__ import annotations

import datetime as dt
import ipaddress
import json
import logging
import os
import socket
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import VERSION
from .config import DISCOVERY_PORT, trial_mode
from .store import BadInput, Store

KST = dt.timezone(dt.timedelta(hours=9))
MAX_BODY = 40 * 1024 * 1024


def web_dir() -> str:
    """A · B 화면 HTML 이 있는 곳 (exe 안 · 개발 중에는 apps/office/web)"""
    base = getattr(sys, "_MEIPASS", None)
    if base:
        return os.path.join(base, "web")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "web")


def private_client(addr: str) -> bool:
    """사무실 안(사설 주소 · 이 PC)에서 온 것만"""
    try:
        ip = ipaddress.ip_address(addr.split("%")[0])
    except ValueError:
        return False
    if ip.version == 6 and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_private or ip.is_loopback or ip.is_link_local


class Office:
    """C 가 하는 일 — 받기 · 합치기 · 올리기 · 날씨 (HTTP 와 떨어져 있어 시험하기 쉬움)"""

    def __init__(self, conf: dict, store: Store, relay=None, kma=None, now=None):
        self.conf, self.store, self.relay, self.kma = conf, store, relay, kma
        self.now = now or (lambda: dt.datetime.now(KST))
        self.last_push_at: str | None = None
        self.last_error = ""
        self.weather_error = ""
        self.weather_at = 0.0
        self.weather_due = True
        self.status_at = 0.0
        self.wake = threading.Event()
        self.push_lock = threading.Lock()

    # ---------- 화면에 주는 것 ----------

    def info(self) -> dict:
        return {
            "name": self.conf.get("name") or "사무실 C",
            "version": VERSION,
            "trial": trial_mode(self.conf),
            "publish": {"pending": 0 if trial_mode(self.conf) else self.store.pending(), "at": self.last_push_at, "error": self.last_error},
            "weather": {"ok": not self.weather_error, "error": self.weather_error},
            "pin": bool(str(self.conf.get("officePin") or "")),
            # B(사무실에서 바로 보기) 설정 화면용
            "at": self.last_push_at,
            "lastDate": self.store.last_date(),
            "pending": self.store.pending(),
            "lastError": self.last_error,
        }

    def day(self, date: str) -> dict:
        return {"date": date, "report": self.store.report(date), "weather": self.store.weather(date)}

    def submit(self, body: dict) -> dict:
        report = self.store.submit(body.get("date"), body.get("by"), body.get("parts") or {}, body.get("lines"), body.get("products"))
        logging.info("받음 %s %s (%s)", report["date"], ",".join(k for k in ("naver", "cafe", "kids") if (body.get("parts") or {}).get(k)), body.get("by"))
        if report["date"] < self.now().date().isoformat() and not self.store.weather(report["date"]):
            self.weather_due = True
        # 클라우드에 올리기 — 인터넷이 느려도 A 가 오래 기다리지 않게 8초까지만 기다림 (못 끝내면 뒤에서 계속)
        t = threading.Thread(target=self.push_now, daemon=True)
        t.start()
        t.join(8)
        published = not t.is_alive() and not trial_mode(self.conf) and self.store.pending() == 0
        if not published:
            self.wake.set()
        if trial_mode(self.conf):
            msg = f"C 에 저장했습니다. 클라우드 보관함 설정 전(시험 모드)이라 폰에는 아직 올리지 않았습니다 — 사무실에서는 http://{socket.gethostname()}:{self.conf.get('port') or 8770}/b/ 로 볼 수 있습니다."
        elif published:
            msg = "폰(B)에도 올렸습니다."
        else:
            msg = f"C 에 저장했습니다. 클라우드에 올리지 못해 잠시 뒤 다시 올립니다 ({self.last_error or '인터넷 확인'})."
        return {"ok": True, "report": report, "publish": {"ok": published, "message": msg}}

    def import_past(self, body: dict) -> dict:
        saved, skipped = self.store.import_daily(body.get("by"), body.get("parts") or [], body.get("products"))
        self.wake.set()
        return {"ok": True, "saved": saved, "skipped": skipped}

    # ---------- 뒤에서 도는 일 ----------

    def push_now(self) -> bool:
        """못 올린 것을 모두 올려 봄 → 보고가 모두 올라갔으면 True"""
        if trial_mode(self.conf) or not self.relay:
            return False
        if not self.push_lock.acquire(blocking=False):  # 다른 쪽(뒤에서 도는 일)이 올리는 중
            return False
        try:
            return self._push()
        finally:
            self.push_lock.release()

    def _push(self) -> bool:
        for kind, key, tries, queued in self.store.due():
            try:
                if kind == "report":
                    report = self.store.report(key)
                    if report:
                        self.relay.put_report(report, VERSION)
                elif kind == "weather":
                    w = self.store.weather(key)
                    if w:
                        self.relay.put_weather(w)
                self.store.pushed(kind, key, queued)
                self.last_error = ""
                self.last_push_at = dt.datetime.now(dt.timezone.utc).isoformat()
            except Exception as e:  # 인터넷 · 계정 문제 — 남겨 두고 다음에
                self.last_error = str(e)[:200]
                self.store.push_failed(kind, key, str(e))
                logging.warning("클라우드에 못 올림 %s %s: %s", kind, key, e)
                break
        return self.store.pending() == 0

    def sync_weather(self):
        """기상청: 관측이 없는 지난 날 (2025-01-01 부터) + 오늘 예보"""
        if not self.kma:
            return
        from .weather import days_to_fetch

        now = self.now()
        try:
            span = days_to_fetch(now.date(), self.store.weather_observed(), self.kma.conf.get("since", "2025-01-01"))
            days = self.kma.observed(*span) if span else []
            days += self.kma.forecast(now.replace(tzinfo=None))
            n = sum(1 for d in days if self.store.put_weather(d))
            self.weather_error = ""
            if n:
                logging.info("날씨 %d일 새로 받음", n)
        except Exception as e:
            self.weather_error = str(e)[:200]
            logging.warning("날씨 못 받음: %s", e)

    def tick(self):
        """한 번 돌기 — Worker 가 30초마다 (또는 받자마자) 부름"""
        t = time.time()
        if self.weather_due or t - self.weather_at > 3600:
            self.weather_due = False
            self.weather_at = t
            self.sync_weather()
        self.push_now()
        if self.relay and not trial_mode(self.conf) and t - self.status_at > 3600:
            self.status_at = t
            try:
                self.relay.put_status({"version": VERSION, "name": self.conf.get("name") or "", "lastDate": self.store.last_date() or "", "pending": self.store.pending(), "lastError": self.last_error})
            except Exception as e:
                logging.warning("상태 못 올림: %s", e)

    def run_worker(self, stop: threading.Event):
        while not stop.is_set():
            try:
                self.tick()
            except Exception:
                logging.exception("뒤에서 도는 일 오류")
            self.wake.wait(30)
            self.wake.clear()


def make_handler(office: Office):
    pages = {"/": "entry.html", "/index.html": "entry.html", "/b": "report.html", "/b/": "report.html"}

    class Handler(BaseHTTPRequestHandler):
        server_version = f"PosReportC/{VERSION}"

        def log_message(self, fmt, *args):  # 기록 파일에만
            logging.debug("%s %s", self.address_string(), fmt % args)

        def send_json(self, code: int, body: dict):
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def guard(self) -> bool:
            if not private_client(self.client_address[0]):
                self.send_json(403, {"error": "사무실 안에서만 쓸 수 있습니다."})
                return False
            return True

        def do_GET(self):
            if not self.guard():
                return
            url = urllib.parse.urlparse(self.path)
            q = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
            try:
                if url.path in pages:
                    return self.send_page(pages[url.path])
                if url.path == "/api/info":
                    return self.send_json(200, office.info())
                if url.path == "/api/day":
                    date = q.get("date", "")
                    if len(date) != 10:
                        return self.send_json(400, {"error": "날짜가 없습니다."})
                    return self.send_json(200, office.day(date))
                if url.path == "/api/products":
                    return self.send_json(200, {"products": office.store.products()})
                if url.path == "/api/reports":
                    reports, last = office.store.reports_after(q.get("after"))
                    return self.send_json(200, {"reports": reports, "last": last})
                if url.path == "/api/weather":
                    days, last = office.store.weather_after(q.get("after"))
                    return self.send_json(200, {"days": days, "last": last})
                self.send_json(404, {"error": "없는 주소입니다."})
            except Exception as e:
                logging.exception("GET %s", self.path)
                self.send_json(500, {"error": f"C 오류: {e}"})

        def do_POST(self):
            if not self.guard():
                return
            pin = str(office.conf.get("officePin") or "")
            if pin and urllib.parse.unquote(self.headers.get("X-Office-Pin") or "") != pin:
                return self.send_json(401, {"error": "사무실 비밀번호가 맞지 않습니다. 오른쪽 위 이름을 눌러 비밀번호를 넣어 주세요."})
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > MAX_BODY:
                return self.send_json(413, {"error": "보낸 자료가 없거나 너무 큽니다."})
            try:
                body = json.loads(self.rfile.read(n).decode("utf-8"))
            except ValueError:
                return self.send_json(400, {"error": "보낸 자료 모양이 이상합니다."})
            path = urllib.parse.urlparse(self.path).path
            try:
                if path == "/api/submit":
                    return self.send_json(200, office.submit(body))
                if path == "/api/import":
                    return self.send_json(200, office.import_past(body))
                self.send_json(404, {"error": "없는 주소입니다."})
            except BadInput as e:
                self.send_json(400, {"error": str(e)})
            except Exception as e:
                logging.exception("POST %s", path)
                self.send_json(500, {"error": f"C 오류: {e}"})

        def send_page(self, name: str):
            path = os.path.join(web_dir(), name)
            if not os.path.exists(path):
                data = f"<!doctype html><meta charset=utf-8><title>매출 보고</title><p>화면 파일({name})이 없습니다. C 프로그램을 다시 설치해 주세요.</p>".encode("utf-8")
            else:
                with open(path, "rb") as f:
                    data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    return Handler


def discovery(port: int, stop: threading.Event, udp_port: int = DISCOVERY_PORT):
    """직원 PC 가 사무실 공유기 안에 'POSREPORT-C?' 를 뿌리면 이 PC 이름 · 주소로 답함"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("0.0.0.0", udp_port))
    s.settimeout(1.0)
    reply = json.dumps({"app": "posreport-c", "name": socket.gethostname(), "port": port}).encode("utf-8")
    while not stop.is_set():
        try:
            data, addr = s.recvfrom(256)
        except socket.timeout:
            continue
        except OSError:
            break
        if data.strip() == b"POSREPORT-C?" and private_client(addr[0]):
            try:
                s.sendto(reply, addr)
            except OSError:
                pass
    s.close()


def serve(office: Office, port: int, stop: threading.Event | None = None, host: str = "0.0.0.0", udp: bool = True) -> ThreadingHTTPServer:
    """HTTP 서버 + 뒤에서 도는 일 + PC 찾기 답하기를 띄움 (돌려받은 서버의 serve_forever 를 부르면 계속 돎)"""
    stop = stop or threading.Event()
    httpd = ThreadingHTTPServer((host, port), make_handler(office))
    httpd.daemon_threads = True
    threading.Thread(target=office.run_worker, args=(stop,), daemon=True, name="worker").start()
    if udp:
        try:
            threading.Thread(target=discovery, args=(port, stop), daemon=True, name="discovery").start()
        except OSError as e:
            logging.warning("PC 찾기(UDP %d)를 열지 못함: %s", DISCOVERY_PORT, e)
    return httpd
