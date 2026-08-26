# -*- coding: utf-8 -*-
# P0-6 设置区可发现性验收：顶部锚点导航存在 + 点击跳转
import sys
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
results = []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("✅" if ok else "❌") + " " + name + (f"  — {detail}" if detail else ""))

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_context(viewport={"width": 390, "height": 844}).new_page()

        # 登录
        page.goto(f"{BASE}/vi/login", wait_until="networkidle")
        page.fill("input[name=phone]", "0901234567")
        page.fill("input[name=password]", "demo1234")
        page.click("button[type=submit]")
        try:
            page.wait_for_url("**/dashboard", timeout=15000)
        except Exception:
            check("P0-6 登录进入 dashboard", False, page.url)
            b.close(); summarize(); return

        # 顶部锚点导航存在（vi 文案）
        check("P0-6 顶部「Đơn hàng」锚点链接", page.get_by_role("link", name="Đơn hàng", exact=True).count() == 1)
        check("P0-6 顶部「Cài đặt」锚点链接", page.get_by_role("link", name="Cài đặt", exact=True).count() == 1)

        # 锚点目标元素存在
        check("P0-6 订单区 #orders 存在", page.locator("#orders").count() == 1)
        check("P0-6 设置区 #settings 存在", page.locator("#settings").count() == 1)

        # 点击「Cài đặt」→ URL 带 #settings（跳转到设置区）
        page.get_by_role("link", name="Cài đặt", exact=True).click()
        page.wait_for_timeout(500)
        check("P0-6 点击设置后跳转到 #settings", "#settings" in page.url, page.url)

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
