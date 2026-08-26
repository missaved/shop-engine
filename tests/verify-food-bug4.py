# -*- coding: utf-8 -*-
# 问题4 外送配送费验收：配送费计入应付，起送价按商品小计判断
import sys
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
results = []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("✅" if ok else "❌") + " " + name + (f"  — {detail}" if detail else ""))

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()

        # 场景A：外送选 Phở bò tái 60k（subtotal 60000 >= 起送 50000），不卡起送，应付=60000+15000=75000
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        page.get_by_role("button", name="Giao hàng", exact=True).click()
        page.wait_for_timeout(200)
        plus = page.get_by_role("button", name="+", exact=True)
        plus.nth(2).click(); page.wait_for_timeout(200)  # Phở bò tái 60k
        page.fill("input[type=tel]", "0904440003")
        submit = page.get_by_role("button", name="Đặt hàng", exact=True)
        body = page.inner_text("body")
        check("问题4 外送显示配送费标签", "Phí giao hàng" in body, "含 Phí giao hàng")
        check("问题4 外送应付含配送费(75.000đ)", "75.000đ" in body, "总价 60k+15k=75k")
        check("问题4 外送达起送(小计60k>=50k)按钮可用", submit.is_enabled(),
              "enabled" if submit.is_enabled() else "disabled")
        ctx.close()

        # 场景B：外送选 Bánh mì 35k（subtotal 35000 < 起送 50000），卡起送（按小计），但仍显示配送费
        ctx2 = b.new_context(viewport={"width": 390, "height": 844})
        page2 = ctx2.new_page()
        page2.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        page2.get_by_role("button", name="Giao hàng", exact=True).click()
        page2.wait_for_timeout(200)
        plus2 = page2.get_by_role("button", name="+", exact=True)
        plus2.nth(0).click(); page2.wait_for_timeout(200)  # Bánh mì 35k
        page2.fill("input[type=tel]", "0904440004")
        submit2 = page2.get_by_role("button", name="Đặt hàng", exact=True)
        body2 = page2.inner_text("body")
        check("问题4 外送低价仍卡起送(按钮禁用)", not submit2.is_enabled(),
              "disabled" if not submit2.is_enabled() else "enabled")
        check("问题4 外送低价显示配送费标签", "Phí giao hàng" in body2, "含 Phí giao hàng")
        check("问题4 外送低价显示起送差额", "đạt đơn tối thiểu" in body2, "含 minOrderHint")
        ctx2.close()

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
