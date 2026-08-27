# -*- coding: utf-8 -*-
# 中台第 4 批子项 1 验收：切换身份（ADMIN 进店后台 + 返回中台 + 预览菜单 + OWNER 回归）
import sys
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
ADMIN_PHONE = "0900000000"
ADMIN_PWD = "demo1234"
OWNER_PHONE = "0901234567"   # demo-pho 老板
OWNER_PWD = "demo1234"
SLUG = "demo-pho"
SHOP_NAME = "Phở Demo 88"
OTHER_SLUG = "demo-cafe"
OTHER_NAME = "Cà phê 68"

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("✅ " if ok else "❌ ") + name + (f"  — {detail}" if detail else ""))


def card(page, slug):
    """定位测试店卡片（含 slug 文本的 rounded-xl 卡片）。"""
    el = page.locator(f"text={slug}").first
    return el.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]")


def login(page, phone, pwd, expect_url):
    page.goto(f"{BASE}/vi/login", wait_until="networkidle")
    page.fill("input[name=phone]", phone)
    page.fill("input[name=password]", pwd)
    page.click("button[type=submit]")
    page.wait_for_url(expect_url, timeout=15000)
    page.wait_for_load_state("networkidle")


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()

        # 1. ADMIN 登录 → /admin
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()
        login(page, ADMIN_PHONE, ADMIN_PWD, "**/admin")
        check("ADMIN 登录 → /admin", "/admin" in page.url, page.url)

        # 2. 点「进入后台」→ dashboard?shop=demo-pho + 页头「以 [店名] 视角」横幅
        card(page, SLUG).get_by_role("link", name="Vào quản lý").click()
        page.wait_for_url("**/dashboard**", timeout=15000)
        page.wait_for_load_state("networkidle")
        body = page.inner_text("body")
        check("进入后台 URL 含 shop=demo-pho", "shop=" + SLUG in page.url, page.url)
        check(
            "页头「以 [店名] 视角」横幅",
            "Đang xem với tư cách" in body and SHOP_NAME in body,
            "",
        )
        check("返回中台链接存在", "Về trang quản trị" in body, "")

        # 3. 点返回中台 → 回 /admin
        page.get_by_role("link", name="Về trang quản trị").click()
        page.wait_for_url("**/admin", timeout=15000)
        page.wait_for_load_state("networkidle")
        check("返回中台 → /admin", "/admin" in page.url, page.url)

        # 4. 点「查看菜单」→ 新标签 /s/demo-pho
        with ctx.expect_page() as new_page_info:
            card(page, SLUG).get_by_role("link", name="Xem menu").click()
        menu_page = new_page_info.value
        menu_page.wait_for_load_state("networkidle")
        check("查看菜单新标签 /s/demo-pho", f"/s/{SLUG}" in menu_page.url, menu_page.url)
        menu_page.close()

        ctx.close()

        # 5. OWNER 登录 → /dashboard 看自己店（不带 ?shop=）
        ctx_b = b.new_context(viewport={"width": 390, "height": 844})
        page_b = ctx_b.new_page()
        login(page_b, OWNER_PHONE, OWNER_PWD, "**/dashboard")
        body_b = page_b.inner_text("body")
        check("OWNER 登录看自己店", SHOP_NAME in body_b, "")

        # 6. OWNER 访问 /dashboard?shop=demo-cafe → 仍看自己店（忽略参数）
        page_b.goto(f"{BASE}/vi/dashboard?shop={OTHER_SLUG}", wait_until="networkidle")
        body_b2 = page_b.inner_text("body")
        check(
            "OWNER 忽略 ?shop= 仍看自己店",
            SHOP_NAME in body_b2 and OTHER_NAME not in body_b2,
            "",
        )
        ctx_b.close()

        # 7. 未登录访问 /dashboard → 重定向 /login
        ctx_c = b.new_context(viewport={"width": 390, "height": 844})
        page_c = ctx_c.new_page()
        page_c.goto(f"{BASE}/vi/dashboard", wait_until="networkidle")
        check("未登录 /dashboard → /login", "/login" in page_c.url, page_c.url)
        ctx_c.close()

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
