# -*- coding: utf-8 -*-
# E1 备注/口味验收：客户填备注下单 → 老板列表可见 + 摘要带备注
import re
import sys
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
NOTE = "Ít cay, không ngò"
results = []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("✅" if ok else "❌") + " " + name + (f"  — {detail}" if detail else ""))

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # 1. 客户下单，填备注
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        m = ctx.new_page()
        m.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        li = m.locator("ul li").first
        li.get_by_role("button", name="+", exact=True).click()
        li.get_by_role("button", name="+", exact=True).click()
        m.fill("input[placeholder='Bàn 5']", "Bàn 12")
        m.fill("input[type=tel]", "0908888777")
        # 备注输入框（placeholder 为 notePlaceholder）
        m.fill("input[placeholder='VD: ít cay, không ngò']", NOTE)
        check("E1 备注输入框存在", m.locator("input[placeholder='VD: ít cay, không ngò']").count() == 1)
        m.click("button[type=submit]")
        m.get_by_text("Đặt hàng thành công").wait_for(timeout=15000)
        done_text = m.inner_text("body")
        md = re.search(r"CP-\d{6}-\d{3}", done_text)
        check("E1 客户下单成功", md is not None, md.group(0) if md else "")
        display = md.group(0) if md else ""
        ctx.close()

        # 2. 老板登录，看订单列表是否显示备注
        pg = browser.new_context(viewport={"width": 390, "height": 844}).new_page()
        pg.goto(f"{BASE}/vi/login", wait_until="networkidle")
        pg.fill("input[name=phone]", "0901234567")
        pg.fill("input[name=password]", "demo1234")
        pg.click("button[type=submit]")
        pg.wait_for_url("**/dashboard", timeout=15000)
        pg.wait_for_load_state("networkidle")
        body = pg.inner_text("body")
        check("E1 老板列表显示备注", NOTE in body, display)
        check("E1 备注标签显示", "Ghi chú" in body)
        browser.close()
    summarize(display)

def summarize(display):
    fails = [r for r in results if not r[1]]
    print("\n" + "=" * 50)
    print(f"共 {len(results)} 项，通过 {len(results)-len(fails)}，失败 {len(fails)}")
    if display:
        print("订单号:", display)
    if fails:
        for n, _, d in fails:
            print(f"  - {n}: {d}")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
