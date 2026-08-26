# -*- coding: utf-8 -*-
# 问题 16 验收：商品排序（上移/下移交换相邻商品 + sortOrder 持久化）
import sys
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
results = []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    mark = "✅" if ok else "❌"
    print(f"{mark} {name}" + (f"  — {detail}" if detail else ""))

def get_order(page):
    """提取 #settings 内商品名列表（按 DOM 顺序）"""
    return page.locator('#settings span.text-sm.font-medium').all_inner_texts()

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()

        # 登录
        page.goto(f"{BASE}/vi/login", wait_until="networkidle")
        page.fill("input[type=tel]", "0901234567")
        page.fill("input[type=password]", "demo1234")
        page.click("button[type=submit]")
        page.wait_for_url("**/dashboard", timeout=10000)
        page.wait_for_timeout(800)

        order1 = get_order(page)
        print("初始顺序:", order1)
        check("商品列表已加载", len(order1) >= 2, str(order1))

        # 点第一个商品的下移按钮（↓）
        first = order1[0]
        row = page.get_by_text(first, exact=True).first.locator(
            "xpath=ancestor::div[contains(@class,'justify-between')]"
        )
        row.locator("button[aria-label='下移']").click()
        page.wait_for_timeout(1200)  # 等 router.refresh()

        order2 = get_order(page)
        print("下移后顺序:", order2)
        check("下移后顺序交换", order2[0] == order1[1] and order2[1] == order1[0],
              f"{order1} -> {order2}")

        # 上移 order2[1]（即原 first，现在第二位，上移可用）还原
        moved = order2[1]
        row2 = page.get_by_text(moved, exact=True).first.locator(
            "xpath=ancestor::div[contains(@class,'justify-between')]"
        )
        row2.locator("button[aria-label='上移']").click()
        page.wait_for_timeout(1200)
        order3 = get_order(page)
        print("上移还原后:", order3)
        check("上移还原顺序", order3 == order1, f"{order3}")

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
