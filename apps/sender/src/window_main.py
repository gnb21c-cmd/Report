"""창 있는 판(PosReportW.exe) 입구 — 바탕화면 '매출 보내기' 아이콘과 작업 스케줄러가 부름 (검은 창 없이)"""
import sys

from report_sender.cli import main

sys.exit(main(sys.argv[1:] or ["window"]))
