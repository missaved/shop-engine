# -*- coding: utf-8 -*-
# P0-6 端到端补测：老板 UI 切售罄 → 客户菜单即时隐藏（+ 恢复，不留脏数据）
import sys
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
TARGET = "Bánh mì thịt"  # 第一个商品，种子 active=t
results = []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("✅" if ok else "❌") + " " + name + (f"  — {detail}" if detail else ""))

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # 老板页：登录
        dash = browser.new_context(viewport={"width": 900, "height": 1000}).new_page()
        dash.goto(f"{BASE}/vi/login", wait_until="networkidle")
        dash.fill("input[name=phone]", "0901234567")
        dash.fill("input[name=password]", "demo1234")
        dash.click("button[type=submit]")
        try:
            dash.wait_for_url("**/dashboard", timeout=10000)
        except Exception:
            pass
        check("P0-6 老板登录进入 dashboard", "/dashboard" in dash.url, dash.url)

        # 客户菜单页
        menu = browser.new_context(viewport={"width": 390, "height": 844}).new_page()
        menu.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        check("P0-6 切售罄前客户菜单显示目标商品", TARGET in menu.inner_text("body"),
              "菜单含 Bánh mì thịt")

        # 老板切售罄：定位含目标商品名的行，点该行「Đang bán」按钮
        try:
            row = dash.locator("div", has_text=TARGET).filter(
                has=dash.get_by_role("button", name="Đang bán", exact=True)
            )
            row.get_by_role("button", name="Đang bán", exact=True).first.click()
            dash.wait_for_timeout(2500)  # 等 router.refresh + revalidate
            # 按钮应变「Hết hàng」
            gone = dash.locator("div", has_text=TARGET).filter(
                has=dash.get_by_role("button", name="Hết hàng", exact=True)
            )
            check("P0-6 老板侧按钮翻转为「Hết hàng」", gone.count() >= 1,
                  f"row with Hết hàng = {gone.count()}")
        except Exception as e:
            check("P0-6 老板侧按钮翻转为「Hết hàng」", False, str(e)[:120])

        # 刷新客户菜单 → 目标商品消失
        menu.reload(wait_until="networkidle")
        menu.wait_for_timeout(800)
        body2 = menu.inner_text("body")
        check("P0-6 切售罄后客户菜单隐藏目标商品", TARGET not in body2,
              "菜单已不含 Bánh mì thịt")

        # 恢复：老板点「Hết hàng」→「Đang bán」
        try:
            row2 = dash.locator("div", has_text=TARGET).filter(
                has=dash.get_by_role("button", name="Hết hàng", exact=True)
            )
            row2.get_by_role("button", name="Hết hàng", exact=True).first.click()
            dash.wait_for_timeout(2500)
            back = dash.locator("div", has_text=TARGET).filter(
                has=dash.get_by_role("button", name="Đang bán", exact=True)
            )
            check("P0-6 恢复后老板侧按钮回「Đang bán」", back.count() >= 1,
                  f"row with Đang bán = {back.count()}")
        except Exception as e:
            check("P0-6 恢复后老板侧按钮回「Đang bán」", False, str(e)[:120])

        # 刷新客户菜单 → 恢复显示
        menu.reload(wait_until="networkidle")
        menu.wait_for_timeout(800)
        body3 = menu.inner_text("body")
        check("P0-6 恢复后客户菜单重新显示目标商品", TARGET in body3,
              "菜单重新含 Bánh mì thịt")

        browser.close()
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
