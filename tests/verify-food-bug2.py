# -*- coding: utf-8 -*-
# 问题2 购物车明细预览验收：悬浮栏 + 抽屉明细 + 抽屉内下单
import re, sys
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
results = []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("✅" if ok else "❌") + " " + name + (f"  — {detail}" if detail else ""))

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")

        # 1. 选商品：Bánh mì 35k（plus.nth(0)）
        plus = page.get_by_role("button", name="+", exact=True)
        plus.nth(0).click(); page.wait_for_timeout(200)
        plus.nth(0).click(); page.wait_for_timeout(200)  # 数量 2
        body = page.inner_text("body")
        check("问题2 选商品后悬浮购物车栏出现", "Giỏ hàng · 2" in body, "含 Giỏ hàng · 2")

        # 2. 点悬浮栏打开抽屉
        page.get_by_role("button", name=re.compile("Giỏ hàng · 2")).click()
        page.wait_for_timeout(300)
        body2 = page.inner_text("body")
        check("问题2 抽屉打开显示购物车头", "Giỏ hàng (2)" in body2, "含 Giỏ hàng (2)")
        check("问题2 抽屉明细含商品名", "Bánh mì thịt" in body2, "含 Bánh mì thịt")
        check("问题2 抽屉明细含小计(70.000đ)", "70.000đ" in body2, "2×35k=70k")

        # 3. 抽屉内增减数量：点 + 增到 3
        # 抽屉明细的 + 按钮：抽屉内所有 "+" exact 按钮，最后一个（明细行）
        plus_all = page.get_by_role("button", name="+", exact=True)
        cnt = plus_all.count()
        # 明细行 + 按钮是抽屉里除商品行外的；直接点抽屉区域内的 +
        # 用明细行里的加号：Bánh mì 明细行的 +（在 Giỏ hàng (2) 之后第一个 "+"）
        # 简单：点所有 exact "+" 中数量最多场景的最后一个（明细行 +）
        plus_all.nth(cnt - 1).click(); page.wait_for_timeout(200)
        body3 = page.inner_text("body")
        check("问题2 抽屉内可增加数量(3件)", "Giỏ hàng (3)" in body3, "含 Giỏ hàng (3)")

        # 4. 抽屉内填手机号下单
        page.fill("input[type=tel]", "0904440005")
        page.get_by_role("button", name="Đặt hàng", exact=True).click()
        try:
            page.get_by_text("Đặt hàng thành công").wait_for(timeout=15000)
            check("问题2 抽屉内下单成功", True, "成功")
        except Exception as e:
            check("问题2 抽屉内下单成功", False, str(e)[:120])

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
