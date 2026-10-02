"""콘솔 판(PosReport.exe) 입구 — 설치·점검 명령용 (PyInstaller 는 패키지 밖 파일을 입구로 써야 함)"""
import sys

from report_sender.cli import main

sys.exit(main())
