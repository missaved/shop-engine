#!/usr/bin/env python3
# M5.2 moto 端到端真实流程演练（FB 素材截图版）：
#   登录 → 搜车牌带档案 → 七步开单 → 今日列表 → 推进进度至交接 → 概览/流水 → 设置
#   每关键步截图存 tests/screenshots/fb-moto-*.png（可剪 FB 推广短内容）
import re
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

SCRIPT_TAG = "moto-5-demo"
FLOW = "moto 端到端真实流程演练（截图素材）"

SLUG = "demo-moto"
MOTO_PHONE = "0901122334"
MOTO_PWD = "demo1234"
PLATE = "59X123456"
PRICE = "150kđ"
SHOT = Path("/root/shop-saas/app/tests/screenshots")


def moto_shop_id():
    rows = db_exec(f'SELECT id FROM "Shop" WHERE slug=\'{SLUG}\'')
    return rows[0]["value"] if rows else None


def cleanup():
    sid = moto_shop_id()
    if not sid:
        return
    # 清空演示店订单与 moto 提醒，重置测试车保养字段，截图目录图片（素材每次演练重新生成）
    db_exec(
        f'DELETE FROM "Reminder" WHERE "shopId"={_sql_quote(sid)} AND "templateKey"=\'MOTO_SERVICE_DUE\''
    )
    db_exec(f'DELETE FROM "Order" WHERE "shopId"={_sql_quote(sid)}')
    db_exec(
        f'UPDATE "Vehicle" SET "lastServiceAt"=NULL,"nextServiceKm"=NULL,"nextServiceDue"=NULL,"lastIntervalDays"=NULL '
        f'WHERE "shopId"={_sql_quote(sid)} AND plate=\'{PLATE}\''
    )
    for f in SHOT.glob("fb-moto-*.png"):
        f.unlink()
    unlock_user(MOTO_PHONE)


def login_moto_owner(ctx):
    page = ctx.new_page()
    page.set_default_timeout(ASSERT_TIMEOUT)
    page.set_default_navigation_timeout(NAV_TIMEOUT)
    page.goto(f"{BASE}/vi/login", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.fill('input[name="phone"]', MOTO_PHONE, timeout=ASSERT_TIMEOUT)
    page.fill('input[name="password"]', MOTO_PWD, timeout=ASSERT_TIMEOUT)
    page.click('button[type="submit"]', timeout=ASSERT_TIMEOUT)
    page.wait_for_url(lambda url: "/login" not in url, timeout=ACTION_TIMEOUT)
    page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)
    return page


def shot(page, name: str):
    page.screenshot(path=str(SHOT / name), full_page=False)


def main():
    started = datetime.now()
    records = []
    cleanup()
    SHOT.mkdir(parents=True, exist_ok=True)

    with make_browser() as p:
        ctx = new_context(p, tag="demo")
        boss = login_moto_owner(ctx)

        # D1 搜车牌 → 档案详情（FB 素材：档案/车牌档案页）
        def d1():
            boss.reload(wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            boss.get_by_text("Lệnh hôm nay").wait_for(state="visible", timeout=ACTION_TIMEOUT)
            boss.fill('input[placeholder="VD: 59X123456"]', PLATE, timeout=ASSERT_TIMEOUT)
            boss.keyboard.press("Enter")
            boss.get_by_text("Honda Wave Alpha").first.wait_for(state="visible", timeout=ACTION_TIMEOUT)
            boss.get_by_text("12.000").first.wait_for(state="visible", timeout=ASSERT_TIMEOUT)
            shot(boss, "fb-moto-01-archives.png")

        records.append(
            run_assertion(d1, "moto-d1", "搜车牌带出档案（素材①档案详情）", script_tag=SCRIPT_TAG, screenshot_page=boss)
        )

        # D2 七步开单：换机油 150kđ → 开工 → 今日列表（素材②③）
        def d2():
            boss.reload(wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            boss.fill('input[placeholder="VD: 59X123456"]', PLATE, timeout=ASSERT_TIMEOUT)
            boss.keyboard.press("Enter")
            boss.get_by_role("button", name="Mở lệnh sửa", exact=True).click(timeout=ASSERT_TIMEOUT)
            boss.get_by_text("Chọn mẫu xe").wait_for(state="visible", timeout=ACTION_TIMEOUT)
            boss.get_by_role("button", name="Lưu", exact=True).click(timeout=ASSERT_TIMEOUT)
            boss.get_by_role("button", name="Khó đề", exact=True).click(timeout=ASSERT_TIMEOUT)
            boss.get_by_role("button", name=re.compile("Tiếp tục")).click(timeout=ASSERT_TIMEOUT)
            boss.get_by_role("button", name=re.compile("Thay nhớt máy")).click(timeout=ASSERT_TIMEOUT)
            boss.get_by_role("button", name=re.compile("Tiếp tục")).click(timeout=ASSERT_TIMEOUT)
            boss.get_by_text(PRICE).first.wait_for(state="visible", timeout=ASSERT_TIMEOUT)
            shot(boss, "fb-moto-02-quote.png")
            boss.locator('input[type="checkbox"]').check(timeout=ASSERT_TIMEOUT)
            boss.get_by_role("button", name=re.compile("Tiếp tục")).click(timeout=ASSERT_TIMEOUT)
            boss.get_by_role("button", name="2 giờ", exact=True).click(timeout=ASSERT_TIMEOUT)
            boss.get_by_role("button", name=re.compile("Tiếp tục")).click(timeout=ASSERT_TIMEOUT)
            boss.get_by_role("button", name="Bỏ qua", exact=True).click(timeout=ASSERT_TIMEOUT)
            boss.get_by_role("button", name=re.compile("Bắt đầu")).click(timeout=ASSERT_TIMEOUT)
            boss.get_by_text("Lệnh hôm nay").wait_for(state="visible", timeout=ACTION_TIMEOUT)
            boss.get_by_text(re.compile("MT-")).first.wait_for(state="visible", timeout=ASSERT_TIMEOUT)
            shot(boss, "fb-moto-03-orders.png")

        records.append(
            run_assertion(d2, "moto-d2", "七步开单换机油 → 今日列表（素材②报价③订单）", script_tag=SCRIPT_TAG, screenshot_page=boss)
        )

        # D3 推进进度至交接 picked_up（素材④）
        def d3():
            boss.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            boss.get_by_text("Lệnh hôm nay").wait_for(state="visible", timeout=ACTION_TIMEOUT)
            for target in ["Đang kiểm tra", "Đã báo giá", "Đang sửa", "Chờ lấy xe", "Đã bàn giao"]:
                # Block D 订单卡默认折叠：每次点车牌展开(reset 10s 收回)，再点推进按钮
                boss.get_by_text(PLATE).first.click(timeout=ASSERT_TIMEOUT)
                boss.get_by_role("button", name=re.compile(f"→ {target}")).first.click(
                    timeout=ASSERT_TIMEOUT
                )
                if target == "Đã bàn giao":
                    # M6b 交接后自动跳凭证页（既有行为），不再等 badge；回 dashboard 展开截 picked_up 订单卡
                    boss.wait_for_timeout(1600)
                    boss.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
                    boss.get_by_text("Lệnh hôm nay").wait_for(state="visible", timeout=ACTION_TIMEOUT)
                    boss.get_by_text(PLATE).first.click(timeout=ASSERT_TIMEOUT)
                else:
                    boss.get_by_text(target, exact=True).first.wait_for(
                        state="visible", timeout=ACTION_TIMEOUT
                    )
            shot(boss, "fb-moto-04-picked.png")

        records.append(
            run_assertion(d3, "moto-d3", "推进进度至交接（素材④交接完成）", script_tag=SCRIPT_TAG, screenshot_page=boss)
        )

        # D4 概览：营业额卡 + 每日流水（素材⑤）—— F-m 后概览 4卡/流水已收进 ☰ 抽屉（决策⑤⑥）
        # 注：M6b 后交接（d3 最后一步）自动跳凭证页，此处先导航回 dashboard 再开抽屉验证概览
        def d4():
            boss.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            boss.get_by_text("☰").first.click(timeout=ASSERT_TIMEOUT)
            boss.wait_for_timeout(500)
            boss.get_by_text("Doanh thu").first.wait_for(state="visible", timeout=ACTION_TIMEOUT)
            ledger = boss.locator("section").filter(has_text="Sổ thu")
            ledger.get_by_text(PRICE).first.wait_for(state="visible", timeout=ACTION_TIMEOUT)
            shot(boss, "fb-moto-05-overview.png")

        records.append(
            run_assertion(d4, "moto-d4", "抽屉营业额卡(Doanh thu) + 每日流水(Sổ thu)（素材⑤概览）", script_tag=SCRIPT_TAG, screenshot_page=boss)
        )

        # D5 设置视图：服务预设/车型/收款/店铺（素材⑥）
        def d5():
            boss.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            # Block C/F-m：设置收进 ☰ 抽屉，点 ☰ 店名 trigger 开抽屉
            boss.get_by_text("☰").first.click(timeout=ASSERT_TIMEOUT)
            boss.wait_for_timeout(500)
            boss.get_by_text("Dịch vụ của tiệm").wait_for(state="visible", timeout=ACTION_TIMEOUT)
            shot(boss, "fb-moto-06-settings.png")

        records.append(
            run_assertion(d5, "moto-d5", "进入设置视图（素材⑥设置页）", script_tag=SCRIPT_TAG, screenshot_page=boss)
        )

        # D6 DB 核验：开单-交接闭环落库（订单 + 保养提醒 + 车辆保养字段）
        def d6():
            sid = moto_shop_id()
            o = db_exec(
                f'SELECT status, config->>\'motoProgress\', total FROM "Order" WHERE "shopId"={_sql_quote(sid)} '
                f'AND config->>\'plate\'=\'{PLATE}\' ORDER BY "createdAt" DESC LIMIT 1'
            )
            assert o, "无测试订单"
            cols = o[0]["cols"]
            assert cols[0] == "COMPLETED", cols
            assert cols[1] == "picked_up", cols
            r = db_exec(
                f'SELECT count(*) FROM "Reminder" WHERE "shopId"={_sql_quote(sid)} AND "templateKey"=\'MOTO_SERVICE_DUE\' '
                f'AND payload->>\'plate\'=\'{PLATE}\''
            )
            assert r and int(r[0]["value"]) >= 1, r
            v = db_exec(
                f'SELECT "nextServiceKm" FROM "Vehicle" WHERE "shopId"={_sql_quote(sid)} AND plate=\'{PLATE}\''
            )
            assert v and v[0]["value"] not in ("", None), v

        records.append(
            run_assertion(d6, "moto-d6", "DB 核验：订单交接 + 保养提醒 + 车辆保养字段", script_tag=SCRIPT_TAG, screenshot_page=boss)
        )

        ctx.close()

    ended = datetime.now()
    save_results(SCRIPT_TAG, FLOW, records, started, ended)
    # 列素材清单
    print("\nFB 素材截图:")
    for f in sorted(SHOT.glob("fb-moto-*.png")):
        print(f"  {f.name} ({f.stat().st_size // 1024}KB)")
    return 0 if all(r.status != "FAIL" for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())
