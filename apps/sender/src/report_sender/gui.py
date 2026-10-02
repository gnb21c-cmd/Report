"""근무자용 '마감 자료 보내기' 창 (바탕화면 아이콘으로 엶)

[카페 POS 마감 자료 보내기]
  오늘 10월 2일 (금)
  ( 보내기 )                     ← 누르면 읽고 → 보냄
  ✔ 10월 2일 상품 54개 · 실매출 1,234,000원 보냈습니다
엑셀 폴더 방식이면 먼저 OK포스에서 '상품별 (일자별)' 을 그 폴더에 저장하라고 안내
"""
from __future__ import annotations

import datetime as dt
import threading

from .config import POS_LABEL, pos_label, trial_mode
from .normalize import won

WEEK = "월화수목금토일"


def day_label(iso: str) -> str:
    d = dt.date.fromisoformat(iso)
    return f"{d.month}월 {d.day}일 ({WEEK[d.weekday()]})"


def result_lines(res) -> list:
    """보내기 결과 → 창에 보일 줄들 (시험: tests/test_runner.py)"""
    out = []
    if res.trial_file:
        for date, count, net, _ in res.read:
            out.append(f"✔ {day_label(date)} 상품 {count}개 · 실매출 {won(net)} 읽음")
        if not res.read and not res.error:
            out.append("읽은 자료가 없습니다")
        for w in res.warnings:
            out.append("⚠ " + w)
        if res.error:
            out.append("✖ " + res.error)
        return out
    for date, count, net in res.sent:
        out.append(f"✔ {day_label(date)} 상품 {count}개 · 실매출 {won(net)} 보냈습니다")
    if not res.sent and not res.error:
        if res.read:
            out.append("✔ 바뀐 것이 없어 다시 보내지 않았습니다 (이미 보낸 자료와 같음)")
        else:
            out.append("보낼 자료가 없습니다")
    for w in res.warnings:
        out.append("⚠ " + w)
    if res.error:
        out.append("✖ " + res.error)
    if res.weather_error:
        out.append("⚠ 날씨: " + res.weather_error + " (매출은 보냈습니다)")
    if res.pending:
        out.append(f"아직 못 보낸 날 {res.pending}일 — PC 에 보관했다가 다음에 보냅니다")
    return out


def office_lines(results: list) -> list:
    """여러 매장 결과 → 창에 보일 줄들 ([카페] … / [키즈] …)"""
    from .config import POS_LABEL

    out = []
    trial_file = None
    for pos, res in results:
        out.append(f"[{POS_LABEL.get(pos, pos)}]")
        out += ["  " + ln for ln in result_lines(res)]
        trial_file = trial_file or res.trial_file
    if trial_file:
        out += ["", "시험 모드라 보내지 않았습니다. 바탕화면에 결과 파일을 남겼습니다:", trial_file]
    return out


def run_window(conf: dict, make_sender):
    import tkinter as tk
    from tkinter import font as tkfont

    root = tk.Tk()
    root.title("매출 보내기")
    root.geometry("600x560")
    root.configure(bg="#f9f9f7")
    big = tkfont.Font(family="맑은 고딕", size=18, weight="bold")
    mid = tkfont.Font(family="맑은 고딕", size=12)

    title = f"{pos_label(conf)} 매출 보내기" + (" (시험 모드)" if trial_mode(conf) else "")
    tk.Label(root, text=title, font=big, bg="#f9f9f7").pack(pady=(24, 4))
    tk.Label(root, text=f"오늘 {day_label(dt.date.today().isoformat())}", font=mid, bg="#f9f9f7", fg="#52514e").pack()
    folders = [f"{POS_LABEL.get(p, p)}: {s.get('folder')}" for p, s in (conf.get("stores") or {}).items() if s.get("type") == "folder"]
    if folders:
        tip = "백오피스(nice.okpos.co.kr) '상품별 (일자별)' 을 매장별로 받아\n" + "\n".join(folders) + "\n폴더에 저장한 뒤 누르세요."
        tk.Label(root, text=tip, font=mid, bg="#f9f9f7", fg="#52514e", justify="center").pack(pady=(10, 0))

    msg = tk.StringVar(value="")
    btn = tk.Button(root, text="보내기", font=big, bg="#2a78d6", fg="white", activebackground="#256abf", width=12, height=2, relief="flat")
    btn.pack(pady=20)
    tk.Label(root, textvariable=msg, font=mid, bg="#f9f9f7", justify="left", wraplength=480).pack(padx=16)

    def work():
        sender = None
        try:
            sender = make_sender()
            text = "\n".join(office_lines(sender.run()))
        except Exception as e:  # 설정 오류 등 — 창에 그대로
            text = "✖ " + str(e)[:300]
        finally:
            if sender:
                sender.close()
        root.after(0, lambda: (msg.set(text), btn.config(state="normal", text="다시 보내기")))

    def click():
        btn.config(state="disabled", text="보내는 중…")
        msg.set("POS 자료를 읽는 중입니다…")
        threading.Thread(target=work, daemon=True).start()

    btn.config(command=click)
    root.mainloop()
