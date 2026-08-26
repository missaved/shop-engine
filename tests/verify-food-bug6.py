# -*- coding: utf-8 -*-
# 问题6 手机号仅外送强制验收
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

        # 场景A：堂食不填手机号，选 Bánh mì 35k，应下单成功
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        page.get_by_role("button", name="+", exact=True).nth(0).click()
        page.wait_for_timeout(200)
        page.get_by_role("button", name="Đặt hàng", exact=True).click()
        try:
            page.get_by_text("Đặt hàng thành công").wait_for(timeout=15000)
            check("问题6 堂食不填手机号可下单", True, "成功")
        except Exception as e:
            check("问题6 堂食不填手机号可下单", False, str(e)[:100])
        ctx.close()

        # 场景B：外带不填手机号，选 Bánh mì 35k，应下单成功
        ctx2 = b.new_context(viewport={"width": 390, "height": 844})
        page2 = ctx2.new_page()
        page2.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        page2.get_by_role("button", name="Mang đi", exact=True).click()
        page2.wait_for_timeout(200)
        page2.get_by_role("button", name="+", exact=True).nth(0).click()
        page2.wait_for_timeout(200)
        page2.get_by_role("button", name="Đặt hàng", exact=True).click()
        try:
            page2.get_by_text("Đặt hàng thành công").wait_for(timeout=15000)
            check("问题6 外带不填手机号可下单", True, "成功")
        except Exception as e:
            check("问题6 外带不填手机号可下单", False, str(e)[:100])
        ctx2.close()

        # 场景C：外送填非法手机号 "123"，应被拒
        ctx3 = b.new_context(viewport={"width": 390, "height": 844})
        page3 = ctx3.new_page()
        page3.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        page3.get_by_role("button", name="Giao hàng", exact=True).click()
        page3.wait_for_timeout(200)
        page3.get_by_role("button", name="+", exact=True).nth(2).click()  # Phở bò tái 60k
        page3.wait_for_timeout(200)
        page3.fill("input[type=text]", "12 Nguyễn Huệ, P.5")  # 地址
        page3.fill("input[type=tel]", "123")  # 非法手机号
        page3.get_by_role("button", name="Đặt hàng", exact=True).click()
        page3.wait_for_timeout(3000)
        body3 = page3.inner_text("body")
        ok3 = "Đặt hàng thành công" not in body3
        check("问题6 外送非法手机号被拒", ok3, "未出现下单成功" if ok3 else "竟下单成功")
        ctx3.close()

        # 场景D：外送不填手机号，应被拒（前端 required 阻止或服务端拒）
        ctx4 = b.new_context(viewport={"width": 390, "height": 844})
        page4 = ctx4.new_page()
        page4.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        page4.get_by_role("button", name="Giao hàng", exact=True).click()
        page4.wait_for_timeout(200)
        page4.get_by_role("button", name="+", exact=True).nth(2).click()
        page4.wait_for_timeout(200)
        page4.fill("input[type=text]", "12 Nguyễn Huệ, P.5")
        page4.get_by_role("button", name="Đặt hàng", exact=True).click()
        page4.wait_for_timeout(3000)
        body4 = page4.inner_text("body")
        ok4 = "Đặt hàng thành công" not in body4
        check("问题6 外送不填手机号被拒", ok4, "未出现下单成功" if ok4 else "竟下单成功")
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
