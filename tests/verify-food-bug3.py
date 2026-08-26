# -*- coding: utf-8 -*-
# 问题3 起送价仅外送验收（低价 active 商品 = Bánh mì 35k，< 起送 50k）
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

        # 场景A：堂食（默认）选 Bánh mì 35k（<50k 起送），不卡起送，可下单
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        plus = page.get_by_role("button", name="+", exact=True)
        plus.nth(0).click(); page.wait_for_timeout(200)   # Bánh mì 35k
        page.fill("input[type=tel]", "0904440001")
        submit = page.get_by_role("button", name="Đặt hàng", exact=True)
        check("问题3 堂食低价商品不卡起送（按钮可用）", submit.is_enabled(),
              "enabled" if submit.is_enabled() else "disabled")
        if submit.is_enabled():
            submit.click()
            try:
                page.get_by_text("Đặt hàng thành công").wait_for(timeout=15000)
                check("问题3 堂食下单成功", True, "堂食 35000đ 下单成功")
            except Exception as e:
                check("问题3 堂食下单成功", False, str(e)[:120])
        ctx.close()

        # 场景B：外送选 Bánh mì 35k（<50k 起送），应卡起送
        ctx2 = b.new_context(viewport={"width": 390, "height": 844})
        page2 = ctx2.new_page()
        page2.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        page2.get_by_role("button", name="Giao hàng", exact=True).click()
        page2.wait_for_timeout(200)
        plus2 = page2.get_by_role("button", name="+", exact=True)
        plus2.nth(0).click(); page2.wait_for_timeout(200)  # Bánh mì 35k
        page2.fill("input[type=tel]", "0904440002")
        submit2 = page2.get_by_role("button", name="Đặt hàng", exact=True)
        check("问题3 外送低价商品卡起送（按钮禁用）", not submit2.is_enabled(),
              "disabled" if not submit2.is_enabled() else "enabled")
        body = page2.inner_text("body")
        check("问题3 外送显示起送差额提示", "đạt đơn tối thiểu" in body,
              "含 minOrderHint" if "đạt đơn tối thiểu" in body else "缺 minOrderHint")
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
