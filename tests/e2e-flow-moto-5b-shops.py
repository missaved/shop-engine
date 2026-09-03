#!/usr/bin/env python3
# M5.2b 开店/授权链路（垂直无关）闭环验证：
#   admin 新建 moto 测试店 → 到期（老板端横幅 + 客户侧只读不拦）→ admin 续费 → 老板端横幅消失
# 链路完全走通用 Shop/User/billing 逻辑，不触碰 moto 特有代码 → 证明垂直无关
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "lib"))
from e2e_common import (
    BASE,
    ACTION_TIMEOUT,
    ASSERT_TIMEOUT,
    NAV_TIMEOUT,
    make_browser,
    new_context,
    run_assertion,
    save_results,
    unlock_user,
    db_exec,
    _sql_quote,
)

SCRIPT_TAG = "moto-5b-shops"
FLOW = "开店/授权链路（垂直无关）：建店 → 到期横幅/客户只读 → 续费恢复"

ADMIN_PHONE = "0900000000"
ADMIN_PWD = "demo1234"
NEW_SLUG = "demo-moto2"
NEW_NAME = "Demo Moto 2 (M5)"
OWNER_PHONE = "0901122336"
OWNER_PWD = "demo1234"
# 到期文案（vi）
BANNER = "Gói đã hết hạn, liên hệ nền tảng để gia hạn"
CUST_EXPIRED = "Cửa hàng đã hết hạn, vui lòng gia hạn"


def admin_login(ctx):
    page = ctx.new_page()
    page.set_default_timeout(ASSERT_TIMEOUT)
    page.set_default_navigation_timeout(NAV_TIMEOUT)
    page.goto(f"{BASE}/admin/vi/login", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.fill('input[name="phone"]', ADMIN_PHONE, timeout=ASSERT_TIMEOUT)
    page.fill('input[name="password"]', ADMIN_PWD, timeout=ASSERT_TIMEOUT)
    page.click('button[type="submit"]', timeout=ASSERT_TIMEOUT)
    page.wait_for_url(lambda url: "/login" not in url, timeout=ACTION_TIMEOUT)
    page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)
    return page


def owner_login(ctx, phone=OWNER_PHONE, pwd=OWNER_PWD):
    page = ctx.new_page()
    page.set_default_timeout(ASSERT_TIMEOUT)
    page.set_default_navigation_timeout(NAV_TIMEOUT)
    page.goto(f"{BASE}/vi/login", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.fill('input[name="phone"]', phone, timeout=ASSERT_TIMEOUT)
    page.fill('input[name="password"]', pwd, timeout=ASSERT_TIMEOUT)
    page.click('button[type="submit"]', timeout=ASSERT_TIMEOUT)
    page.wait_for_url(lambda url: "/login" not in url, timeout=ACTION_TIMEOUT)
    page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)
    return page


def cleanup():
    # 删测试店（连带 owner 账号/订单），清登录锁定
    db_exec(f'DELETE FROM "Shop" WHERE slug=\'{NEW_SLUG}\'')
    db_exec(f'DELETE FROM "User" WHERE phone=\'{OWNER_PHONE}\'')
    unlock_user(ADMIN_PHONE)
    unlock_user(OWNER_PHONE)


def main():
    started = datetime.now()
    records = []
    cleanup()

    with make_browser() as p:
        # ============ B1 建店（admin UI）============
        ctx = new_context(p, tag="admin5b")
        adm = admin_login(ctx)
        adm.goto(f"{BASE}/admin/vi/shops", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)

        def b1():
            # 展开折叠建店表单
            adm.get_by_text("＋ Cửa hàng mới", exact=True).click(timeout=ASSERT_TIMEOUT)
            adm.get_by_text("Tạo cửa hàng + tài khoản chủ").wait_for(state="visible", timeout=ACTION_TIMEOUT)
            adm.get_by_label("Tên cửa hàng (EN)").fill(NEW_NAME)
            adm.get_by_label("slug").fill(NEW_SLUG)
            adm.get_by_label("Ngành").select_option("MOTO")
            adm.get_by_label("SĐT chủ").fill(OWNER_PHONE)
            adm.get_by_label("Mật khẩu ban đầu").fill(OWNER_PWD)
            adm.get_by_role("button", name="Tạo", exact=True).click(timeout=ASSERT_TIMEOUT)
            adm.get_by_text("Đã tạo cửa hàng").wait_for(state="visible", timeout=ACTION_TIMEOUT)
            # DB 核验：Shop 存在 + vertical=MOTO + owner 账号
            s = db_exec(
                f'SELECT vertical, currency FROM "Shop" WHERE slug=\'{NEW_SLUG}\''
            )
            assert s, "Shop 未创建"
            cols = s[0]["cols"]
            assert cols[0] == "MOTO", cols
            u = db_exec(f'SELECT count(*) FROM "User" WHERE phone=\'{OWNER_PHONE}\'')
            assert u and int(u[0]["value"]) >= 1, u

        records.append(
            run_assertion(b1, "moto-b1", "admin 新建 moto 店（vertical=MOTO + owner 账号）", script_tag=SCRIPT_TAG, screenshot_page=adm)
        )
        ctx.close()

        # ============ B2 到期 → 老板端横幅 ============
        db_exec(f'UPDATE "Shop" SET "subscribedUntil" = NOW() - INTERVAL \'10 days\' WHERE slug=\'{NEW_SLUG}\'')
        ctx2 = new_context(p, tag="owner5b")
        owner = owner_login(ctx2)

        def b2():
            owner.reload(wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            # moto 老板端 dashboard（MOTO 视图）顶部出现到期横幅
            owner.get_by_text(BANNER).wait_for(state="visible", timeout=ACTION_TIMEOUT)

        records.append(
            run_assertion(b2, "moto-b2", "到期后老板端 dashboard 出现订阅到期横幅", script_tag=SCRIPT_TAG, screenshot_page=owner)
        )
        ctx2.close()

        # ============ B3 客户侧只读不拦（订正为 moto 实况）============
        # 原 URL /vi/s/{slug} 二层路由不存在（404）；moto 顾客入口 = /vi/{city}/{vertical}/{slug}/lookup 查询站。
        # getShopBySlug 对到期店不拦截（仅 maintenance/not_approved 拦）→ 到期店 lookup 照常可访问。
        # 到期提示只在老板端横幅（dashboard.subscriptionExpired）；顾客端无 .menu.expired（food 菜单页专属）。
        ctx3 = new_context(p, tag="cust5b")

        def b3():
            page = ctx3.new_page()
            page.set_default_timeout(ASSERT_TIMEOUT)
            page.set_default_navigation_timeout(NAV_TIMEOUT)
            page.goto(f"{BASE}/vi/hcm/moto/{NEW_SLUG}/lookup", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            page.wait_for_timeout(1500)
            body = page.locator("body").inner_text()
            # ① 店名可见（到期不拦浏览/查询）② lookup 查询区可操作（含匿名查询标题/按钮）
            assert NEW_NAME in body, f"店名不可见:\n{body[:200]}"
            assert "Tra cứu" in body, f"lookup 查询区不可用:\n{body[:300]}"
            # ③ 顾客端无到期提示文案（到期仅在老板端呈现，锁定语义）
            assert CUST_EXPIRED not in body, f"顾客端出现到期提示（不应有）:\n{body[:300]}"
            page.close()

        records.append(
            run_assertion(b3, "moto-b3", "到期店客户侧 /lookup 只读可访问（店名+查询区可用，无顾客端到期提示）", script_tag=SCRIPT_TAG, screenshot_page=None)
        )
        ctx3.close()

        # ============ B4 admin 续费 → 老板端横幅消失 ============
        ctx4 = new_context(p, tag="admin5b2")
        adm2 = admin_login(ctx4)
        adm2.goto(f"{BASE}/admin/vi/shops", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)

        def b4():
            # 列表卡片（div.rounded-xl）中找到 demo-moto2 → 展开续费面板 → 填 3 个月 → 确认
            card = adm2.locator("div.rounded-xl").filter(has_text=NEW_SLUG)
            card.get_by_role("button", name="Gia hạn", exact=True).click(timeout=ASSERT_TIMEOUT)
            months_input = card.get_by_placeholder("Số tháng")
            months_input.fill("3")
            card.get_by_role("button", name="Xác nhận", exact=True).click(timeout=ASSERT_TIMEOUT)
            adm2.get_by_text("Đã gia hạn").wait_for(state="visible", timeout=ACTION_TIMEOUT)
            # DB：subscribedUntil 已推进到未来
            r = db_exec(
                f'SELECT ("subscribedUntil" > NOW() + INTERVAL \'50 days\') FROM "Shop" WHERE slug=\'{NEW_SLUG}\''
            )
            assert r and r[0]["value"] == "t", r

        records.append(
            run_assertion(b4, "moto-b4", "admin 续费 3 个月 → subscribedUntil 推进", script_tag=SCRIPT_TAG, screenshot_page=adm2)
        )
        ctx4.close()

        # B5 续费后老板端横幅消失（复用 owner 会话重登）
        ctx5 = new_context(p, tag="owner5b2")
        owner2 = owner_login(ctx5)

        def b5():
            owner2.reload(wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            owner2.wait_for_timeout(1200)
            assert owner2.get_by_text(BANNER).count() == 0, "续费后横幅仍显示"
            # dashboard 正常渲染 moto 视图
            owner2.get_by_text("Lệnh hôm nay").wait_for(state="visible", timeout=ACTION_TIMEOUT)

        records.append(
            run_assertion(b5, "moto-b5", "续费后老板端到期横幅消失", script_tag=SCRIPT_TAG, screenshot_page=owner2)
        )
        ctx5.close()

    ended = datetime.now()
    save_results(SCRIPT_TAG, FLOW, records, started, ended)
    return 0 if all(r.status != "FAIL" for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())
