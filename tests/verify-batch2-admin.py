# -*- coding: utf-8 -*-
# 中台第 2 批验收：ADMIN 登录分流 + 建店 + 列表试用中徽章 + 新店老板空店 + 页面门禁 + 删除
import sys
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
TEST_SLUG = "test-mvp-01"
TEST_NAME = "Test MVP Shop"
TEST_OWNER_PHONE = "0911111001"
TEST_OWNER_PWD = "test1234"
results = []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("✅ " if ok else "❌ ") + name + (f"  — {detail}" if detail else ""))

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()

        # 1. 未登录访问 /admin → 重定向 /login
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()
        page.goto(f"{BASE}/vi/admin", wait_until="networkidle")
        check("未登录 /admin 重定向 /login", "/login" in page.url, page.url)

        # 2. OWNER 登录 → /dashboard（不变）
        page.goto(f"{BASE}/vi/login", wait_until="networkidle")
        page.fill("input[name=phone]", "0901234567")
        page.fill("input[name=password]", "demo1234")
        page.click("button[type=submit]")
        page.wait_for_url("**/dashboard", timeout=15000)
        check("OWNER 登录 → /dashboard", "/dashboard" in page.url)

        # 3. OWNER 访问 /admin → 踢回 /dashboard
        page.goto(f"{BASE}/vi/admin", wait_until="networkidle")
        check("OWNER /admin 踢回 /dashboard", "/dashboard" in page.url, page.url)
        ctx.close()

        # 4. ADMIN 登录 → /admin
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()
        page.goto(f"{BASE}/vi/login", wait_until="networkidle")
        page.fill("input[name=phone]", "0900000000")
        page.fill("input[name=password]", "demo1234")
        page.click("button[type=submit]")
        page.wait_for_url("**/admin", timeout=15000)
        page.wait_for_load_state("networkidle")
        check("ADMIN 登录 → /admin", "/admin" in page.url, page.url)

        # 5. 建店（受控表单：name 为第一个 text，slug 靠 placeholder，ownerPhone 为最后一个 tel）
        page.locator("input[type=text]").first.fill(TEST_NAME)
        page.fill("input[placeholder='demo-pho']", TEST_SLUG)
        page.locator("input[type=tel]").last.fill(TEST_OWNER_PHONE)
        page.locator("input[type=password]").fill(TEST_OWNER_PWD)
        page.get_by_role("button", name="Tạo").click()
        page.wait_for_timeout(2500)
        body = page.inner_text("body")
        check("建店成功（新店出现或 toast）", TEST_SLUG in body, "")

        # 6. 列表出现新店 + 「试用中」徽章
        body = page.inner_text("body")
        check("列表出现新店 slug", TEST_SLUG in body)
        check("试用中徽章存在", "Dùng thử" in body or "试用中" in body or "Trial" in body)

        # 7. 新店老板登录 → /dashboard 空店
        ctx2 = b.new_context(viewport={"width": 390, "height": 844})
        page2 = ctx2.new_page()
        page2.goto(f"{BASE}/vi/login", wait_until="networkidle")
        page2.fill("input[name=phone]", TEST_OWNER_PHONE)
        page2.fill("input[name=password]", TEST_OWNER_PWD)
        page2.click("button[type=submit]")
        page2.wait_for_url("**/dashboard", timeout=15000)
        page2.wait_for_load_state("networkidle")
        body2 = page2.inner_text("body")
        check("新店老板登录 → /dashboard", "/dashboard" in page2.url)
        check("新店为空店（暂无订单）", "Chưa có đơn hàng" in body2 or "暂无订单" in body2 or "No orders yet" in body2)
        ctx2.close()

        # 8. 删除测试店（验证 deleteShop + 级联）
        page.on("dialog", lambda d: d.accept())
        page.get_by_role("button", name="Xóa").first.click()
        page.wait_for_timeout(2500)
        body = page.inner_text("body")
        check("删除店后列表消失", TEST_SLUG not in body)

        ctx.close()
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
