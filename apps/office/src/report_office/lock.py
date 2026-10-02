"""한 PC 에서 하나만 돌게 (작업 스케줄러가 5분마다 다시 켜도 이미 돌고 있으면 바로 끝남)"""
from __future__ import annotations

import os


class AlreadyRunning(Exception):
    pass


def acquire(path: str):
    f = open(path, "a+", encoding="utf-8")
    try:
        f.seek(0)
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        f.close()
        raise AlreadyRunning("이미 실행 중입니다.")
    return f  # 프로그램이 끝날 때까지 열어 둠
