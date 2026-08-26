# -*- coding: utf-8 -*-
# 问题 11 验收：老板端菜单分类 → 保存 → 客户菜单页按分类分组展示
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

        # 2. 展开 Phở bò tái 编辑 → 分类输入框存在
        pho_bo = page.get_by_text("Phở bò tái", exact=True).first
        card = pho_bo.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]")
        card.locator("button", has_text="Sửa").click()
        page.wait_for_timeout(300)
        cat = card.locator("input[placeholder='Phở / Đồ uống']")
        check("编辑表单出现分类输入框", cat.count() == 1)

        # 3. 填分类 + 保存
        cat.fill("Phở")
        card.locator("button[type=submit]").click()
        page.wait_for_timeout(1200)
        check("保存后表单收起", card.locator("textarea").count() == 0)

        # 4. 菜单页 → 分类标题 Phở + 其他
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        h2s = page.locator("h2").all_inner_texts()
        check("菜单页显示分类标题 Phở", "Phở" in h2s, repr(h2s))
        check("无分类商品归「其他」Món khác", "Món khác" in h2s, repr(h2s))

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
