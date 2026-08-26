# -*- coding: utf-8 -*-
# P0-3 补校验验收：phone 格式错被拒 + 正常下单回归
import sys
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
results = []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("✅" if ok else "❌") + " " + name + (f"  — {detail}" if detail else ""))

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_context(viewport={"width": 390, "height": 844}).new_page()
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")

        # 加两次商品（首项 Bánh mì 35000đ，x2 = 70000 ≥ 起送价 50000）
        plus = page.get_by_role("button", name="+", exact=True)
        plus.nth(0).click()
        page.wait_for_timeout(200)
        plus.nth(0).click()
        page.wait_for_timeout(300)

        # 场景1：phone 格式错（abc）
        page.fill("input[type=tel]", "abc")
        page.get_by_role("button", name="Đặt hàng", exact=True).click()
        page.wait_for_timeout(1500)
        body = page.inner_text("body")
        check("P0-3 phone 格式错被拒（服务端文案）", "手机号格式不正确" in body, body[:160])

        # 场景2：正常手机号下单成功（回归，确认格式校验不误伤）
        page.fill("input[type=tel]", "0901234567")
        page.get_by_role("button", name="Đặt hàng", exact=True).click()
        ok = True
        try:
            page.get_by_text("Đặt hàng thành công").wait_for(timeout=15000)
        except Exception:
            ok = False
        check("P0-3 正常手机号下单成功（回归）", ok, page.url)

        browser.close()
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
