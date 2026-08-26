# -*- coding: utf-8 -*-
# 问题 13 验收：下单含规格/加料留手机号 → 查单页显示规格/加料名
import sys, re
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
PHONE = "0912345678"
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

        # 1. 下单（含规格 + 加料 + 手机号）
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        li = page.get_by_text("Phở bò tái", exact=True).first.locator("xpath=ancestor::li[1]")
        li.locator("button", has_text="+").click()
        page.wait_for_timeout(400)
        page.locator("button", has_text="Ít cay").click()
        page.locator("button", has_text="Thêm bò").click()
        page.locator("button", has_text="Thêm vào giỏ").click()
        page.wait_for_timeout(400)
        page.locator("button", has_text="Giỏ hàng").click()
        page.wait_for_timeout(400)
        page.fill("input[type=tel]", PHONE)
        page.locator("button[type=submit]").click()
        page.wait_for_timeout(1500)
        body1 = page.inner_text("body")
        m = re.search(r"CP-\d{6}-\d{3}", body1)
        order_no = m.group(0) if m else None
        check("下单成功", order_no is not None, order_no or body1[:120])

        # 2. 查单页 → 显示规格/加料
        page.goto(f"{BASE}/vi/s/demo-pho/track?orderNo={order_no}&phone={PHONE}", wait_until="networkidle")
        body2 = page.inner_text("body")
        check("查单页显示规格 Ít cay", "Ít cay" in body2)
        check("查单页显示加料 Thêm bò", "Thêm bò" in body2)

        b.close()
    print("ORDER_NO=" + (order_no or ""))
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
