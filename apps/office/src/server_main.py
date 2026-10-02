"""창 없는 판(PosReportC.exe) 입구 — PC 를 켜면 작업 스케줄러가 부름 (검은 창 없이 늘 돌아감)"""
import sys

from report_office.cli import main

sys.exit(main(sys.argv[1:] or ["serve"]))
