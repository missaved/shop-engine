# -*- coding: utf-8 -*-
# 中台第 3 批验收：订阅到期停用（客户菜单拦截 + 老板横幅）+ 续费闭环（Billing 流水 + 到期推进 + 徽章恢复）
import sys
import re
import subprocess
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
ENV = "/root/shop-saas/app/.env"
TEST_SLUG = "test-bill-01"
TEST_NAME = "Test Billing Shop"
TEST_OWNER_PHONE = "0911111002"
TEST_OWNER_PWD = "test1234"

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("✅ " if ok else "❌ ") + name + (f"  — {detail}" if detail else ""))


def pgurl():
    s = open(ENV).read()
    m = re.search(r"^DATABASE_URL=(\S+)", s, re.M)
    return m.group(1).strip().strip('"').strip("'").split("?")[0]


def sql(q):
    """执行单条 SQL，返回 stdout 文本（psql -tA，无表头）。失败返回 None。"""
    r = subprocess.run(["psql", pgurl(), "-tA", "-c", q], capture_output=True, text=True)
    if r.returncode != 0:
        print("SQL 错误:", r.stderr.strip())
        return None
    return r.stdout.strip()


def badge_text(page):
    """定位测试店卡片的订阅状态徽章 span，返回其文本（精确，避开统计区与到期时间字段的「Hết hạn」用词重叠）。"""
    el = page.locator(f"text={TEST_SLUG}").first
    card = el.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]")
    return card.locator("span.rounded-full").first.inner_text()


def main():
    # 0. 清理可能残留的测试店（级联删 product / billing）
    sql(f"DELETE FROM \"Shop\" WHERE slug = '{TEST_SLUG}'")

    with sync_playwright() as p:
        b = p.chromium.launch()

        # 1. ADMIN 登录 → /admin
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()
        page.goto(f"{BASE}/vi/login", wait_until="networkidle")
        page.fill("input[name=phone]", "0900000000")
        page.fill("input[name=password]", "demo1234")
        page.click("button[type=submit]")
        page.wait_for_url("**/admin", timeout=15000)
        page.wait_for_load_state("networkidle")
        check("ADMIN 登录 → /admin", "/admin" in page.url, page.url)

        # 2. 建店（TRIAL + 默认 30 天试用）
        page.locator("input[type=text]").first.fill(TEST_NAME)
        page.fill("input[placeholder='demo-pho']", TEST_SLUG)
        page.locator("input[type=tel]").last.fill(TEST_OWNER_PHONE)
        page.locator("input[type=password]").fill(TEST_OWNER_PWD)
        page.get_by_role("button", name="Tạo").click()
        page.wait_for_timeout(2500)
        body = page.inner_text("body")
        check("建店成功（列表出现新店）", TEST_SLUG in body, "")

        # 3. DB 验证建店：plan=TRIAL + subscribedUntil 非空
        plan1 = sql(f"SELECT plan FROM \"Shop\" WHERE slug = '{TEST_SLUG}'")
        sub1 = sql(f"SELECT extract(epoch from \"subscribedUntil\") FROM \"Shop\" WHERE slug = '{TEST_SLUG}'")
        check("建店后 plan=TRIAL", plan1 == "TRIAL", plan1)
        check("建店后有试用到期时间", bool(sub1) and float(sub1) > 0, sub1)

        # 4. 到期停用：DB 把 subscribedUntil 改到过去
        sql(f"UPDATE \"Shop\" SET \"subscribedUntil\" = now() - interval '1 day' WHERE slug = '{TEST_SLUG}'")
        page.goto(f"{BASE}/vi/admin", wait_until="networkidle")
        page.wait_for_timeout(500)
        check("到期后测试店徽章「已到期」", badge_text(page) == "Hết hạn", badge_text(page))

        # 5. 插入一个测试商品（客户菜单走完整下单流程用）
        sql(
            f"INSERT INTO \"Product\" (id, \"shopId\", name, price, \"sortOrder\", active, \"createdAt\", \"updatedAt\") "
            f"SELECT 'test-prod-bill-01', id, 'Test item', 10000, 0, true, now(), now() FROM \"Shop\" WHERE slug = '{TEST_SLUG}'"
        )

        # 6. 客户菜单：welcome 页「已到期」文案
        ctx_menu = b.new_context(viewport={"width": 390, "height": 844})
        page_m = ctx_menu.new_page()
        page_m.goto(f"{BASE}/vi/s/{TEST_SLUG}", wait_until="networkidle")
        body_m = page_m.inner_text("body")
        check(
            "客户菜单「已到期」文案",
            ("hết hạn" in body_m) or ("已到期" in body_m) or ("expired" in body_m.lower()),
            "",
        )

        # 7. 完整流程：堂食 → 选商品 → 加购 → 打开购物车 → 下单按钮禁用
        page_m.get_by_role("button", name="Ăn tại chỗ").click()
        page_m.wait_for_timeout(600)
        page_m.get_by_role("button", name="Test item").first.click()
        page_m.wait_for_timeout(600)
        page_m.get_by_role("button", name="Thêm vào giỏ").click()
        page_m.wait_for_timeout(600)
        page_m.get_by_role("button", name="Giỏ hàng").click()
        page_m.wait_for_timeout(600)
        submit = page_m.get_by_role("button", name="Đặt hàng")
        disabled = submit.is_disabled() if submit.count() > 0 else None
        check("下单按钮禁用（不可下单）", disabled is True, f"disabled={disabled}")
        ctx_menu.close()

        # 8. 老板登录 → 顶部到期横幅
        ctx_boss = b.new_context(viewport={"width": 390, "height": 844})
        page_b = ctx_boss.new_page()
        page_b.goto(f"{BASE}/vi/login", wait_until="networkidle")
        page_b.fill("input[name=phone]", TEST_OWNER_PHONE)
        page_b.fill("input[name=password]", TEST_OWNER_PWD)
        page_b.click("button[type=submit]")
        page_b.wait_for_url("**/dashboard", timeout=15000)
        page_b.wait_for_load_state("networkidle")
        body_b = page_b.inner_text("body")
        check(
            "老板后台到期横幅",
            ("hết hạn" in body_b) or ("已到期" in body_b) or ("expired" in body_b.lower()),
            "",
        )
        ctx_boss.close()

        # 9. 续费：测试店（列表最上）续费按钮展开 → 填月数/金额 → 确认
        page.get_by_role("button", name="Gia hạn").first.click()
        page.wait_for_timeout(500)
        page.fill("input[placeholder='Số tháng']", "1")
        page.fill("input[placeholder='Số tiền']", "50000")
        page.get_by_role("button", name="Xác nhận").first.click()
        page.wait_for_timeout(1200)
        body = page.inner_text("body")
        check("续费 toast（已续费）", "Đã gia hạn" in body, "")

        # 10. DB 验证续费：Billing 多一条 + 到期推进到未来
        billing_n = sql(
            f"SELECT count(*) FROM \"Billing\" b JOIN \"Shop\" s ON s.id = b.\"shopId\" WHERE s.slug = '{TEST_SLUG}'"
        )
        future_n = sql(
            f"SELECT count(*) FROM \"Shop\" WHERE slug = '{TEST_SLUG}' AND \"subscribedUntil\" > now()"
        )
        check("Billing 多一条流水", bool(billing_n) and int(billing_n) >= 1, billing_n)
        check("续费后到期时间推进到未来", future_n == "1", future_n)

        # 11. 徽章恢复：刷新 admin，测试店卡片「已到期」→「试用中」
        page.goto(f"{BASE}/vi/admin", wait_until="networkidle")
        page.wait_for_timeout(500)
        bt = badge_text(page)
        check("续费后徽章恢复（试用中）", bt == "Dùng thử", bt)

        # 11.5 平台停用三态（检查点第 5 项）：停用 → 徽章「已停用」+ 客户菜单「暂停营业」
        sql(f"UPDATE \"Shop\" SET \"platformSuspended\" = true WHERE slug = '{TEST_SLUG}'")
        page.goto(f"{BASE}/vi/admin", wait_until="networkidle")
        page.wait_for_timeout(500)
        bt2 = badge_text(page)
        check("平台停用后徽章「已停用」", bt2 == "Đã tạm ngưng", bt2)
        ctx_menu2 = b.new_context(viewport={"width": 390, "height": 844})
        page_m2 = ctx_menu2.new_page()
        page_m2.goto(f"{BASE}/vi/s/{TEST_SLUG}", wait_until="networkidle")
        body_m2 = page_m2.inner_text("body")
        check(
            "客户菜单「暂停营业」文案",
            ("Tạm ngừng" in body_m2) or ("暂停营业" in body_m2) or ("suspended" in body_m2.lower()),
            "",
        )
        ctx_menu2.close()
        sql(f"UPDATE \"Shop\" SET \"platformSuspended\" = false WHERE slug = '{TEST_SLUG}'")

        # 12. 清理：删除测试店（级联删 product / billing）
        sql(f"DELETE FROM \"Shop\" WHERE slug = '{TEST_SLUG}'")
        check("清理测试店", True, "")

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
