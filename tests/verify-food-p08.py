# -*- coding: utf-8 -*-
# P0-8 会话生命周期验收：登录后 session-token cookie Max-Age ≈ 604800（7 天）
import sys, time
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
        page.fill("input[name=phone]", "0901234567")
        page.fill("input[name=password]", "demo1234")
        page.click("button[type=submit]")
        try:
            page.wait_for_url("**/dashboard", timeout=10000)
        except Exception:
            pass

        check("P0-8 登录成功跳转 dashboard", "/dashboard" in page.url, page.url)

        now = int(time.time())
        for c in page.context.cookies():
            if "session-token" in c["name"]:
                age = c.get("expires", -1) - now
                ok = 604000 <= age <= 604900  # 容差：约 7 天
                check("P0-8 session-token Max-Age≈604800", ok,
                      f"name={c['name']} expires={c.get('expires')} age≈{age}s")
                break
        else:
            check("P0-8 session-token Max-Age≈604800", False, "未找到 session-token cookie")

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
