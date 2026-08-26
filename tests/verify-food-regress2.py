# -*- coding: utf-8 -*-
# 规格流程下核心回归：外送配送费/起送价 + 堂食下单
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

        # A 外送 Phở bò tái 60k：选默认规格 → 60k，配送费 15k → 应付 75k，下单成功
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        page.get_by_role("button", name="+", exact=True).nth(2).click()  # Phở bò tái → 抽屉
        page.wait_for_timeout(300)
        page.get_by_role("button", name=re.compile("Thêm vào giỏ")).click()  # 默认规格
        page.wait_for_timeout(300)
        page.get_by_role("button", name=re.compile("Giỏ hàng")).click()
        page.wait_for_timeout(300)
        page.get_by_role("button", name="Giao hàng", exact=True).click()
        page.wait_for_timeout(200)
        page.fill("input[type=text]", "12 Nguyễn Huệ")
        body = page.inner_text("body")
        check("回归 外送配送费显示", "Phí giao hàng" in body, "含 Phí giao hàng")
        check("回归 外送应付75k", "75.000đ" in body, "60k+15k")
        page.fill("input[type=tel]", "0904440007")
        page.get_by_role("button", name="Đặt hàng", exact=True).click()
        try:
            page.get_by_text("Đặt hàng thành công").wait_for(timeout=15000)
            check("回归 外送规格下单成功", True, "成功")
        except Exception as e:
            check("回归 外送规格下单成功", False, str(e)[:100])
        ctx.close()

        # B 外送 Bánh mì 35k：选默认规格 → 35k < 50k 起送，卡起送
        ctx2 = b.new_context(viewport={"width": 390, "height": 844})
        page2 = ctx2.new_page()
        page2.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        page2.get_by_role("button", name="+", exact=True).nth(0).click()  # Bánh mì → 抽屉
        page2.wait_for_timeout(300)
        page2.get_by_role("button", name=re.compile("Thêm vào giỏ")).click()
        page2.wait_for_timeout(300)
        page2.get_by_role("button", name=re.compile("Giỏ hàng")).click()
        page2.wait_for_timeout(300)
        page2.get_by_role("button", name="Giao hàng", exact=True).click()
        page2.wait_for_timeout(200)
        page2.fill("input[type=text]", "12 Nguyễn Huệ")
        submit2 = page2.get_by_role("button", name="Đặt hàng", exact=True)
        check("回归 外送低价卡起送(禁用)", not submit2.is_enabled(),
              "disabled" if not submit2.is_enabled() else "enabled")
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
