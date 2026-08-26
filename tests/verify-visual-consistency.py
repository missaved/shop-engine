# -*- coding: utf-8 -*-
# 视觉一致性验收：登录页 / 查单页 / 落地页主按钮 amber 化
import sys
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
results = []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    mark = "✅" if ok else "❌"
    print(f"{mark} {name}" + (f"  — {detail}" if detail else ""))

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()

        # 落地页下单按钮
        page.goto(f"{BASE}/vi", wait_until="networkidle")
        demo_btn = page.locator("a", has_text="Cửa hàng demo").first
        dc = demo_btn.get_attribute("class") or ""
        check("落地页下单按钮 amber", "bg-amber-500" in dc)

        # 登录页提交按钮
        page.goto(f"{BASE}/vi/login", wait_until="networkidle")
        login_btn = page.locator("button[type=submit]").first
        lc = login_btn.get_attribute("class") or ""
        check("登录页提交按钮 amber", "bg-amber-500" in lc)

        # 查单页提交按钮
        page.goto(f"{BASE}/vi/s/demo-pho/track", wait_until="networkidle")
        track_btn = page.locator("button[type=submit]").first
        tc = track_btn.get_attribute("class") or ""
        check("查单页提交按钮 amber", "bg-amber-500" in tc)

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
