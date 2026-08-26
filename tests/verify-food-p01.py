# -*- coding: utf-8 -*-
# P0-1 登录限流验收：连错 5 次后第 6 次（即使密码正确）被临时锁
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
        page.goto(f"{BASE}/vi/login", wait_until="networkidle")

        # 连错 5 次
        for i in range(5):
            page.fill("input[name=phone]", "0901234567")
            page.fill("input[name=password]", "wrongpass%d" % i)
            page.click("button[type=submit]")
            page.wait_for_timeout(1200)

        # 第 6 次：正确密码也应被锁（限流在密码校验之前）
        page.fill("input[name=phone]", "0901234567")
        page.fill("input[name=password]", "demo1234")
        page.click("button[type=submit]")
        page.wait_for_timeout(1200)

        body = page.inner_text("body")
        check("P0-1 连错5次后第6次被锁（限流文案）", "Quá nhiều lần thử" in body, body[:200])

        # 确认没跳转 dashboard（仍停在 login）
        check("P0-1 锁定期未跳转 dashboard", "/dashboard" not in page.url, page.url)

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
