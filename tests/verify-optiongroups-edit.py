# -*- coding: utf-8 -*-
# 问题 10 验收：老板端规格组（optionGroups）编辑 → 保存 → 菜单页抽屉显示规格选择
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

        # 1. 登录
        page.goto(f"{BASE}/vi/login", wait_until="networkidle")
        page.fill("input[type=tel]", "0901234567")
        page.fill("input[type=password]", "demo1234")
        page.click("button[type=submit]")
        page.wait_for_url("**/dashboard", timeout=10000)
        check("登录进入 dashboard", True)

        # 2. 展开 Trà đá（无规格）编辑 → 规格 textarea 为空
        tra_da = page.get_by_text("Trà đá", exact=True).first
        card_td = tra_da.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]")
        card_td.locator("button", has_text="Sửa").click()
        page.wait_for_timeout(300)
        og_ta = card_td.locator("textarea").nth(1)  # 第 2 个 textarea = 规格组
        check("编辑表单出现规格 textarea", og_ta.count() == 1)
        check("空规格回显为空", og_ta.count() == 1 and og_ta.input_value() == "")

        # 3. 填规格 + 保存
        og_ta.fill("Cay*: Không cay, Ít cay\nĐá: Ít, Nhiều")
        card_td.locator("button[type=submit]").click()
        page.wait_for_timeout(1200)
        check("保存后表单收起", card_td.locator("textarea").count() == 0)

        # 4. 展开 Phở bò tái（已有 3 组规格）→ 回显（serializeOptionGroups）
        pho_bo = page.get_by_text("Phở bò tái", exact=True).first
        card_bt = pho_bo.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]")
        card_bt.locator("button", has_text="Sửa").click()
        page.wait_for_timeout(300)
        val = card_bt.locator("textarea").nth(1).input_value()
        check("已有规格回显", ":" in val and len(val) > 0, repr(val))

        # 5. 菜单页 → 点 Trà đá「+」→ 抽屉显示规格组
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        li_td = page.get_by_text("Trà đá", exact=True).first.locator("xpath=ancestor::li[1]")
        li_td.locator("button", has_text="+").click()
        page.wait_for_timeout(500)
        body = page.inner_text("body")
        check("抽屉显示规格组 Cay（选项 Không cay）", "Không cay" in body)
        check("抽屉显示规格组 Đá", "Đá" in body)

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
