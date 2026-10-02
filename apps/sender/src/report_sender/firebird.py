"""OK포스 Firebird DB 읽기

매장 카페 메인 PC 점검(2026-09-29) 결과:
- OK포스 매출 DB 는 Firebird (C:\\_OKPOS\\DATA\\OKPOS.FDB, 서비스 "Firebird Server - DefaultInstance", 포트 3050)
- 서브 PC 의 결제도 메인 PC 의 이 DB 에 쌓임 (서브 결제 때 메인의 OKPOS.FDB 가 바뀜)

지키는 것:
- 읽기 전용 트랜잭션으로만 엶 (DB 엔진이 쓰기를 거부) + 쿼리도 SELECT 만 (sources.check_read_only)
- 한글: DB 문자셋이 NONE·KSC_5601 이면 바이트를 CP949 로 풀어 읽음 (못 읽는 글자는 �)
- 클라이언트 라이브러리는 OK포스가 설치한 fbclient.dll·gds32.dll 중 이 프로그램(32비트)에 맞는 것
"""
from __future__ import annotations

import codecs
import os
import re
import struct

DEFAULT_DB = r"C:\_OKPOS\DATA\OKPOS.FDB"
CLIENT_CANDIDATES = [
    r"C:\_OKPOS\DATA\FDB\bin\fbclient.dll",
    r"C:\_OKPOS\DATA\FDB\fbclient.dll",
    r"C:\_OKPOS\BIN\fbclient.dll",
    r"C:\_OKPOS\BIN\gds32.dll",
    r"C:\_OKPOS\DATA\FDB\bin\gds32.dll",
    r"C:\Windows\SysWOW64\fbclient.dll",
    r"C:\Windows\SysWOW64\gds32.dll",
    r"C:\Windows\System32\fbclient.dll",
    r"C:\Windows\System32\gds32.dll",
]
CODEC = "report_cp949"


class FirebirdError(Exception):
    def __init__(self, msg: str, reason: str | None = None):
        super().__init__(msg)
        self.reason = reason or msg  # Firebird 오류 원문 한 줄 (점검 결과용)


class ClientBitsError(FirebirdError):
    """맞는 비트수의 fbclient 가 없음 (64비트 판으로 다시)"""


def _register_codec():
    """CP949 로 풀되 깨진 바이트가 있어도 멈추지 않는 코덱 (Firebird 문자셋 NONE·KSC_5601 용)"""
    base = codecs.lookup("cp949")

    def search(name):
        if name != CODEC:
            return None
        return codecs.CodecInfo(
            name=CODEC,
            encode=lambda s, errors="strict": base.encode(s, "replace"),
            decode=lambda b, errors="strict": base.decode(bytes(b), "replace"),
        )

    codecs.register(search)


_register_codec()


def pe_bits(path: str):
    """DLL 이 32비트인지 64비트인지 (PE 머리글). 모르면 None"""
    try:
        with open(path, "rb") as f:
            head = f.read(4096)
        off = struct.unpack_from("<I", head, 0x3C)[0]
        if head[off : off + 4] != b"PE\0\0":
            return None
        machine = struct.unpack_from("<H", head, off + 4)[0]
        return {0x14C: 32, 0x8664: 64, 0xAA64: 64}.get(machine)
    except (OSError, struct.error):
        return None


def my_bits() -> int:
    return struct.calcsize("P") * 8


def client_candidates(explicit: str | None = None) -> list:
    """(경로, 비트수) — 있는 것만, 이 프로그램과 비트수가 같은 것 먼저"""
    paths = [explicit] if explicit else []
    paths += [p for p in CLIENT_CANDIDATES if p not in paths]
    found = [(p, pe_bits(p)) for p in paths if p and os.path.exists(p)]
    return sorted(found, key=lambda x: 0 if x[1] == my_bits() else 1)


_loaded = None


def load_client(explicit: str | None = None) -> str:
    """fbclient 를 한 번만 읽어 들임. 읽은 파일 경로"""
    global _loaded
    if _loaded:
        return _loaded
    import fdb

    tried = []
    for path, bits in client_candidates(explicit):
        if bits and bits != my_bits():
            tried.append(f"{path} ({bits}비트라 이 프로그램({my_bits()}비트)과 맞지 않음)")
            continue
        folder = os.path.dirname(path)
        try:
            if hasattr(os, "add_dll_directory"):
                os.add_dll_directory(folder)  # fbclient 가 같은 폴더의 msvcr80.dll 등을 찾게
            fdb.load_api(path)
            _loaded = path
            return path
        except Exception as e:  # OSError (DLL 못 읽음) 등
            tried.append(f"{path} ({str(e)[:120]})")
    if not tried:
        raise FirebirdError("Firebird 클라이언트(fbclient.dll)를 찾지 못했습니다. OK포스 설치 폴더를 알려 주세요.")
    if all("비트라" in t for t in tried):
        raise ClientBitsError("이 PC 의 Firebird 클라이언트는 모두 다른 비트수입니다: " + " / ".join(tried))
    raise FirebirdError("Firebird 클라이언트를 읽지 못했습니다: " + " / ".join(tried))


def _text(v):
    if isinstance(v, (bytes, bytearray, memoryview)):
        return bytes(v).decode("cp949", "replace").rstrip()
    if isinstance(v, str):
        return v.rstrip()
    return v


LOCAL = "local"  # host 를 이렇게 적으면 네트워크(3050) 대신 이 PC 안에서 바로 연결 (Windows XNET)


class FirebirdDb:
    """읽기 전용 연결. conf: host · port · database · user · password · client · trusted

    - host "local" → 이 PC 안에서 바로 연결 (포트를 거치지 않음)
    - trusted true → 사용자 이름·비밀번호 없이 Windows 로그인으로 (Firebird 설정이 허락할 때만 됨)
    """

    def __init__(self, conf: dict):
        self.host = conf.get("host") or "localhost"
        self.port = int(conf.get("port") or 3050)
        self.database = conf.get("database") or DEFAULT_DB
        self.trusted = bool(conf.get("trusted"))
        self.user = conf.get("user") or "SYSDBA"
        self.password = conf.get("password") or "masterkey"
        self.client = conf.get("client") or None
        self.conn = None
        self.charset = None  # DB 기본 문자셋

    def who(self) -> str:
        """어떤 계정·방식으로 연결하는지 (비밀번호는 빼고)"""
        how = "이 PC 안에서 바로" if self.host.lower() == LOCAL else f"{self.host}:{self.port}"
        return f"{'Windows 로그인' if self.trusted else self.user} · {how}"

    def connect(self):
        import fdb

        if os.name == "nt":
            load_client(self.client)
        # 문자셋 NONE·KSC_5601 → 바이트를 CP949 로. UTF8 DB 면 UTF8 로 다시 연결
        fdb.ibase.charset_map["NONE"] = CODEC
        fdb.ibase.charset_map["KSC_5601"] = CODEC
        try:
            conn = self._open(fdb, "NONE")
            cs = self._scalar(conn, "SELECT RDB$CHARACTER_SET_NAME FROM RDB$DATABASE")
            self.charset = (cs or "NONE").strip()
            if self.charset.upper() in ("UTF8", "UNICODE_FSS"):
                conn.close()
                conn = self._open(fdb, "UTF8")
        except fdb.DatabaseError as e:
            raise FirebirdError(explain(e, self), fb_message(e))
        self.conn = conn
        return self

    def _open(self, fdb, charset):
        # 읽기 전용(read-only · read committed) 트랜잭션으로 엶 — DB 엔진이 쓰기를 거부함
        # (연결한 뒤 default_tpb 를 바꾸면 이미 만든 기본 트랜잭션에는 적용되지 않으므로 연결할 때 정함)
        local = self.host.lower() == LOCAL
        return fdb.connect(
            host=None if local else self.host,
            port=None if local else self.port,
            database=self.database,
            user=None if self.trusted else self.user,
            password=None if self.trusted else self.password,
            charset=charset,
            isolation_level=fdb.ISOLATION_LEVEL_READ_COMMITED_RO,
        )

    @staticmethod
    def _scalar(conn, sql):
        cur = conn.cursor()
        cur.execute(sql)
        row = cur.fetchone()
        conn.commit()
        return _text(row[0]) if row else None

    def query(self, sql: str, params=()):
        """(칸 이름들, 행들) — 글자는 한글로 풀어서"""
        if self.conn is None:
            self.connect()
        import fdb

        try:
            cur = self.conn.cursor()
            cur.execute(sql, list(params))
            cols = [str(d[0]).strip() for d in (cur.description or [])]
            rows = [tuple(_text(v) for v in r) for r in cur.fetchall()]
            self.conn.commit()  # 짧게 끝냄 (OK포스 쓰기를 막지 않게)
            return cols, rows
        except fdb.DatabaseError as e:
            self.close()
            raise FirebirdError(explain(e, self), fb_message(e))

    def version(self):
        try:
            return self.query("SELECT RDB$GET_CONTEXT('SYSTEM', 'ENGINE_VERSION') FROM RDB$DATABASE")[1][0][0]
        except FirebirdError:
            return None

    def tables(self) -> list:
        sql = (
            "SELECT TRIM(RDB$RELATION_NAME) FROM RDB$RELATIONS "
            "WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 AND RDB$VIEW_BLR IS NULL ORDER BY 1"
        )
        return [r[0] for r in self.query(sql)[1]]

    def count(self, table: str) -> int:
        return int(self.query(f"SELECT COUNT(*) FROM {ident(table)}")[1][0][0])

    def columns(self, table: str) -> list:
        """[(칸 이름, 종류)]"""
        sql = (
            "SELECT TRIM(rf.RDB$FIELD_NAME), f.RDB$FIELD_TYPE, f.RDB$FIELD_LENGTH, f.RDB$FIELD_SCALE "
            "FROM RDB$RELATION_FIELDS rf JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE "
            "WHERE rf.RDB$RELATION_NAME = ? ORDER BY rf.RDB$FIELD_POSITION"
        )
        return [(n, type_name(t, ln, sc)) for n, t, ln, sc in self.query(sql, [table])[1]]

    def recent(self, table: str, n: int = 3):
        """마지막에 들어간 것으로 보이는 몇 행 — 시각(TIMESTAMP) 칸이 있으면 그 순서, 없으면 저장 위치(DB_KEY) 역순"""
        stamp = next((c for c, ty in self.columns(table) if ty == "TIMESTAMP"), None)
        t = ident(table)
        tries = [f"SELECT FIRST {int(n)} * FROM {t} ORDER BY {ident(stamp)} DESC"] if stamp else []
        tries += [f"SELECT FIRST {int(n)} * FROM {t} ORDER BY RDB$DB_KEY DESC", f"SELECT FIRST {int(n)} * FROM {t}"]
        last = None
        for sql in tries:
            try:
                return self.query(sql)
            except FirebirdError as e:
                last = e
        raise last

    def close(self):
        try:
            if self.conn is not None:
                self.conn.close()
        except Exception:
            pass
        self.conn = None


def quote(name: str) -> str:
    return str(name).replace('"', '""')


def ident(name: str) -> str:
    """표·칸 이름 — 보통 이름(대문자·숫자·_)은 그대로 (따옴표는 SQL 방언 1 DB 에서 글자로 읽힘), 아니면 따옴표로"""
    return name if re.fullmatch(r"[A-Z][A-Z0-9_$]*", name) else f'"{quote(name)}"'


FB_TYPES = {7: "SMALLINT", 8: "INTEGER", 10: "FLOAT", 12: "DATE", 13: "TIME", 14: "CHAR", 16: "BIGINT", 23: "BOOLEAN", 27: "DOUBLE", 35: "TIMESTAMP", 37: "VARCHAR", 261: "BLOB"}


def type_name(t, length, scale) -> str:
    name = FB_TYPES.get(t, str(t))
    if name in ("CHAR", "VARCHAR"):
        return f"{name}({length})"
    if scale and scale < 0:
        return f"NUMERIC(scale {-scale})"
    return name


def fb_message(e: Exception) -> str:
    """Firebird 오류 원문 한 줄 (SQLCODE 줄은 빼고, 끝에 오류 번호)"""
    first = e.args[0] if e.args and isinstance(e.args[0], str) else str(e)
    parts = [ln.strip()[2:] for ln in first.splitlines() if ln.strip().startswith("- ") and "SQLCODE" not in ln]
    code = e.args[2] if len(e.args) > 2 and isinstance(e.args[2], int) else None
    return (" / ".join(parts) or " ".join(first.split()))[:300] + (f" (오류 {code})" if code else "")


def explain(e: Exception, db: "FirebirdDb") -> str:
    """Firebird 오류 → 알아듣기 쉬운 말"""
    msg = " ".join(str(e).split())
    low = msg.lower()
    if "user name and password" in low or "login" in low or "password" in low:
        return f"POS DB 로그인 실패 ({db.who()}) — OK포스에 DB 접속 계정(읽기 전용)을 문의해 주세요. [{msg[:200]}]"
    if "unavailable database" in low or "connection refused" in low or "network request" in low or "network error" in low:
        where = "이 PC 안에서 바로" if db.host.lower() == LOCAL else f"{db.host}:{db.port}"
        return f"POS DB 서버에 연결하지 못했습니다 ({where}) — OK포스 DB 서비스(Firebird)가 켜져 있는지 확인해 주세요. [{msg[:200]}]"
    if "no such file" in low or "cannot find" in low or ("i/o error" in low and "lock" not in low):
        return f"POS DB 파일을 찾지 못했습니다 ({db.database}). [{msg[:200]}]"
    return f"POS DB 오류 [{msg[:300]}]"
