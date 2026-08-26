# -*- coding: utf-8 -*-
# 问题 9 验收：老板端加料（extras）编辑 → 保存 → 菜单页显示加料
import sys
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
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

        # 1. 登录老板后台
        page.goto(f"{BASE}/vi/login", wait_until="networkidle")
        page.fill("input[type=tel]", "0901234567")
        page.fill("input[type=password]", "demo1234")
        page.click("button[type=submit]")
        page.wait_for_url("**/dashboard", timeout=10000)
        check("登录进入 dashboard", True)

        # 2. 展开 Phở gà 编辑表单
        pho_ga = page.get_by_text("Phở gà", exact=True).first
        card_ga = pho_ga.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]")
        card_ga.locator("button", has_text="Sửa").click()
        page.wait_for_timeout(300)
        ta_ga = card_ga.locator("textarea")
        check("编辑表单出现加料 textarea", ta_ga.count() == 1)
        check("空加料回显为空", ta_ga.count() == 1 and ta_ga.input_value() == "")

        # 3. 填加料 + 保存
        ta_ga.fill("Thêm thịt 20000\nTrứng 10000")
        card_ga.locator("button[type=submit]").click()
        page.wait_for_timeout(1200)
        check("保存后表单收起", card_ga.locator("textarea").count() == 0)

        # 4. 展开 Phở bò tái 编辑 → 验证已有加料回显（serializeExtras）
        pho_bo = page.get_by_text("Phở bò tái", exact=True).first
        card_bt = pho_bo.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]")
        card_bt.locator("button", has_text="Sửa").click()
        page.wait_for_timeout(300)
        val = card_bt.locator("textarea").input_value()
        check("已有加料回显", "Thêm bò 20000" in val and "Trứng 10000" in val, repr(val))

        # 5. 客户菜单页 → 点 Phở gà「+」（有规格 → 打开抽屉）→ 抽屉显示加料
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        li_ga = page.get_by_text("Phở gà", exact=True).first.locator("xpath=ancestor::li[1]")
        li_ga.locator("button", has_text="+").click()
        page.wait_for_timeout(500)
        body = page.inner_text("body")
        check("抽屉显示加料 Thêm thịt +20.000đ", "Thêm thịt +20.000" in body)
        check("抽屉显示加料 Trứng +10.000đ", "Trứng +10.000" in body)

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
