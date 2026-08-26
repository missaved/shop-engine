# -*- coding: utf-8 -*-
# P0-5 Toast 反馈验收：标记收款 / 推进状态 点击后出现可见 toast
import sys, time
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
results = []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("✅" if ok else "❌") + " " + name + (f"  — {detail}" if detail else ""))

def toast_visible(page, text, timeout=3000):
    try:
        page.get_by_text(text, exact=True).wait_for(timeout=timeout)
        return True
    except Exception:
        return False

def main():
    time.sleep(62)  # 等 P0-1 登录限流 60s 窗口过期，避免验收被自身累积的失败锁住
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_context(viewport={"width": 390, "height": 844}).new_page()

        # 登录老板后台
        page.goto(f"{BASE}/vi/login", wait_until="networkidle")
        page.fill("input[name=phone]", "0901234567")
        page.fill("input[name=password]", "demo1234")
        page.click("button[type=submit]")
        try:
            page.wait_for_url("**/dashboard", timeout=15000)
            check("P0-5 登录成功进入 dashboard", True, page.url)
        except Exception:
            body = page.inner_text("body")
            check("P0-5 登录成功进入 dashboard", False, body[:160])
            b.close(); summarize(); return

        # 标记收款（Thu đủ）
        page.get_by_role("button", name="Thu đủ", exact=True).first.click()
        check("P0-5 标记收款后 toast「Đã cập nhật thu tiền」", toast_visible(page, "Đã cập nhật thu tiền"))

        # 推进状态（Tiếp tục）
        page.get_by_role("button", name="Tiếp tục", exact=True).first.click()
        check("P0-5 推进状态后 toast「Đã chuyển trạng thái」", toast_visible(page, "Đã chuyển trạng thái"))

        b.close()
    summarize()

def summarize():
    fails = [r for r in results if not r[1]]
    print("\n" + "=" * 50)
    print(f"共 {len(results)} 项，通过 {len(results)-len(fails)}，失败 {len(fails)}")
    if fails:
        for n, _, d in fails:
            print(f"  - {n}: {d}")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
