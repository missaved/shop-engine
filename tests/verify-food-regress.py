# -*- coding: utf-8 -*-
# 综合回归：重构后核心路径（起送价/配送费/手机号/下单）
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

        # A 堂食 Bánh mì 35k 不填手机号下单成功
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        page.get_by_role("button", name="+", exact=True).nth(0).click()
        page.wait_for_timeout(200)
        page.get_by_role("button", name=re.compile("Giỏ hàng")).click()
        page.wait_for_timeout(300)
        page.get_by_role("button", name="Đặt hàng", exact=True).click()
        try:
            page.get_by_text("Đặt hàng thành công").wait_for(timeout=15000)
            check("回归 堂食低价不卡起送可下单", True, "成功")
        except Exception as e:
            check("回归 堂食低价不卡起送可下单", False, str(e)[:100])
        ctx.close()

        # B 外送 Bánh mì 35k（<50k）卡起送（按钮禁用）
        ctx2 = b.new_context(viewport={"width": 390, "height": 844})
        page2 = ctx2.new_page()
        page2.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        page2.get_by_role("button", name="+", exact=True).nth(0).click()
        page2.wait_for_timeout(200)
        page2.get_by_role("button", name=re.compile("Giỏ hàng")).click()
        page2.wait_for_timeout(300)
        page2.get_by_role("button", name="Giao hàng", exact=True).click()
        page2.wait_for_timeout(200)
        page2.fill("input[type=text]", "12 Nguyễn Huệ")  # 地址
        submit2 = page2.get_by_role("button", name="Đặt hàng", exact=True)
        check("回归 外送低价卡起送(按钮禁用)", not submit2.is_enabled(),
              "disabled" if not submit2.is_enabled() else "enabled")
        ctx2.close()

        # C 外送 Phở bò tái 60k 显示配送费 + 应付 75k
        ctx3 = b.new_context(viewport={"width": 390, "height": 844})
        page3 = ctx3.new_page()
        page3.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        page3.get_by_role("button", name="+", exact=True).nth(2).click()  # Phở bò tái 60k
        page3.wait_for_timeout(200)
        page3.get_by_role("button", name=re.compile("Giỏ hàng")).click()
        page3.wait_for_timeout(300)
        page3.get_by_role("button", name="Giao hàng", exact=True).click()
        page3.wait_for_timeout(200)
        page3.fill("input[type=text]", "12 Nguyễn Huệ")
        body3 = page3.inner_text("body")
        check("回归 外送显示配送费标签", "Phí giao hàng" in body3, "含 Phí giao hàng")
        check("回归 外送应付含配送费(75k)", "75.000đ" in body3, "60k+15k=75k")
        ctx3.close()

        # D 外送不填手机号被拒（required）
        ctx4 = b.new_context(viewport={"width": 390, "height": 844})
        page4 = ctx4.new_page()
        page4.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        page4.get_by_role("button", name="+", exact=True).nth(2).click()
        page4.wait_for_timeout(200)
        page4.get_by_role("button", name=re.compile("Giỏ hàng")).click()
        page4.wait_for_timeout(300)
        page4.get_by_role("button", name="Giao hàng", exact=True).click()
        page4.wait_for_timeout(200)
        page4.fill("input[type=text]", "12 Nguyễn Huệ")
        page4.get_by_role("button", name="Đặt hàng", exact=True).click()
        page4.wait_for_timeout(3000)
        body4 = page4.inner_text("body")
        check("回归 外送不填手机号被拒", "Đặt hàng thành công" not in body4, "未下单成功")
        ctx4.close()

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
