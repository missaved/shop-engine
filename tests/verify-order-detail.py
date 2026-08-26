# -*- coding: utf-8 -*-
# 问题 12 验收：下单含规格/加料 → 老板端订单明细展示规格名 + 加料名
import sys, re
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

        # 1. 菜单页 → Phở bò tái 抽屉 → 选规格 + 加料 → 加购
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        li = page.get_by_text("Phở bò tái", exact=True).first.locator("xpath=ancestor::li[1]")
        li.locator("button", has_text="+").click()
        page.wait_for_timeout(400)
        page.locator("button", has_text="Ít cay").click()
        page.locator("button", has_text="Thêm bò").click()
        page.locator("button", has_text="Thêm vào giỏ").click()
        page.wait_for_timeout(400)
        check("加购成功（购物车栏出现）", page.locator("button", has_text="Giỏ hàng").count() > 0)

        # 2. 打开购物车抽屉 → 下单
        page.locator("button", has_text="Giỏ hàng").click()
        page.wait_for_timeout(400)
        page.locator("button[type=submit]").click()
        page.wait_for_timeout(1500)
        body1 = page.inner_text("body")
        m = re.search(r"CP-\d{6}-\d{3}", body1)
        check("下单成功（显示订单号）", m is not None, m.group(0) if m else body1[:120])

        # 3. 登录老板端 → 最新订单明细显示规格 + 加料
        page.goto(f"{BASE}/vi/login", wait_until="networkidle")
        page.fill("input[type=tel]", "0901234567")
        page.fill("input[type=password]", "demo1234")
        page.click("button[type=submit]")
        page.wait_for_url("**/dashboard", timeout=10000)
        page.wait_for_timeout(800)
        body2 = page.inner_text("body")
        check("老板端明细显示规格 Ít cay", "Ít cay" in body2)
        check("老板端明细显示加料 Thêm bò", "Thêm bò" in body2)

        b.close()
    summarize()

def summarize():
    fails = [r for r in results if not r[1]]
    print("\n" + "=" * 50)
    print(f"共 {len(results)} 项，通过 {len(results)-len(fails)}，失败 {len(fails)}")
    for n, _, d in fails:
        print(f"  - {n}: {d}")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
