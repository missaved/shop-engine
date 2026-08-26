# -*- coding: utf-8 -*-
# 问题 17 验收：新增商品排末尾（sortOrder = max+1）
import sys
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
NEW_NAME = "测试排序商品"
results = []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    mark = "✅" if ok else "❌"
    print(f"{mark} {name}" + (f"  — {detail}" if detail else ""))

def get_order(page):
    return page.locator('#settings span.text-sm.font-medium').all_inner_texts()

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()

        page.goto(f"{BASE}/vi/login", wait_until="networkidle")
        page.fill("input[type=tel]", "0901234567")
        page.fill("input[type=password]", "demo1234")
        page.click("button[type=submit]")
        page.wait_for_url("**/dashboard", timeout=10000)
        page.wait_for_timeout(800)

        order1 = get_order(page)
        print("初始顺序:", order1)
        check("初始商品列表加载", len(order1) >= 5, str(order1))

        # 填新增商品表单（名称 + 价格，required 定位唯一）
        page.fill('input[type=text][required]', NEW_NAME)
        page.fill('input[type=number][required]', "10000")
        page.get_by_role("button", name="Thêm").click()
        page.wait_for_timeout(1500)  # 等 router.refresh()

        order2 = get_order(page)
        print("新增后顺序:", order2)
        check("新商品出现在列表末尾", order2[-1] == NEW_NAME, str(order2))
        check("商品总数 +1", len(order2) == len(order1) + 1,
              f"{len(order1)} -> {len(order2)}")

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
