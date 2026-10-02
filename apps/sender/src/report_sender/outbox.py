"""PC 안의 보관함 (outbox.db, SQLite) — 보낼 하루치를 먼저 여기 적고, 보관함(클라우드)에 올라가면 지움

- 같은 날의 새 자료가 오면 아직 못 보낸 옛 자료는 버림 (하루치를 통째로 바꾸므로 마지막 것만 있으면 됨)
- 마지막으로 보낸 내용과 같으면 다시 보내지 않음
- 인터넷이 끊겨 못 보낸 날은 남아 있다가 다음에 보냄
아스타나 apps/pos-sync 의 outbox.py 를 하루 단위로 줄임
"""
from __future__ import annotations

import json
import sqlite3
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS pending (
  date TEXT PRIMARY KEY,
  rows TEXT NOT NULL,
  hash TEXT NOT NULL,
  source TEXT NOT NULL,
  created REAL NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS sent (date TEXT PRIMARY KEY, hash TEXT NOT NULL, count INTEGER NOT NULL, net INTEGER NOT NULL, at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS files (name TEXT PRIMARY KEY, sig TEXT NOT NULL, at REAL NOT NULL);
"""


class Outbox:
    def __init__(self, path: str, clock=time.time):
        self.db = sqlite3.connect(path, timeout=10)
        self.db.executescript(SCHEMA)
        self.clock = clock

    def close(self):
        self.db.close()

    def enqueue(self, date: str, rows: list, hash_: str, source: str, force: bool = False) -> bool:
        """하루치를 넣음. 이미 보낸 것과 같으면 False (보낼 필요 없음)"""
        with self.db:
            if not force and self.sent_hash(date) == hash_:
                self.db.execute("DELETE FROM pending WHERE date=?", (date,))
                return False
            self.db.execute(
                "INSERT OR REPLACE INTO pending (date, rows, hash, source, created, tries, last_error) "
                "VALUES (?, ?, ?, ?, ?, COALESCE((SELECT tries FROM pending WHERE date=?), 0), NULL)",
                (date, json.dumps(rows, ensure_ascii=False), hash_, source, self.clock(), date),
            )
        return True

    def due(self) -> list:
        cur = self.db.execute("SELECT date, rows, hash, source, tries FROM pending ORDER BY date")
        return [{"date": d, "rows": json.loads(r), "hash": h, "source": s, "tries": t} for d, r, h, s, t in cur.fetchall()]

    def mark_sent(self, item: dict):
        rows = item["rows"]
        with self.db:
            self.db.execute("DELETE FROM pending WHERE date=? AND hash=?", (item["date"], item["hash"]))
            self.db.execute(
                "INSERT OR REPLACE INTO sent (date, hash, count, net, at) VALUES (?, ?, ?, ?, ?)",
                (item["date"], item["hash"], len(rows), sum(int(r.get("net") or 0) for r in rows), self.clock()),
            )

    def mark_failed(self, item: dict, error: str):
        with self.db:
            self.db.execute("UPDATE pending SET tries=tries+1, last_error=? WHERE date=?", (error[:500], item["date"]))

    def pending(self) -> int:
        return self.db.execute("SELECT count(*) FROM pending").fetchone()[0]

    def sent_hash(self, date: str):
        row = self.db.execute("SELECT hash FROM sent WHERE date=?", (date,)).fetchone()
        return row[0] if row else None

    def ever_sent(self, date: str) -> bool:
        return self.sent_hash(date) is not None

    def last_sent(self):
        """(날짜, 상품 수, 실매출, 보낸 시각) — 가장 늦은 날"""
        return self.db.execute("SELECT date, count, net, at FROM sent ORDER BY date DESC LIMIT 1").fetchone()

    def file_sig(self, name: str):
        row = self.db.execute("SELECT sig FROM files WHERE name=?", (name,)).fetchone()
        return row[0] if row else None

    def set_file_sig(self, name: str, sig: str):
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO files (name, sig, at) VALUES (?, ?, ?)", (name, sig, self.clock()))
