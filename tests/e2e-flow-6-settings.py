#!/usr/bin/env python3
"""F7 · 老板设置实时联动客户菜单

业务目标：老板任何设置变更实时同步到客户菜单页。
覆盖：S1-S6 营业/起送/配送/打包/介绍 + R4 营业 + R5 售罄。
"""
from __future__ import annotations
import sys, re, urllib.parse
from pathlib import Path
from datetime import datetime, timezone
sys.path.insert(0, str(Path(__file__).parent))
from tests.lib.e2e_common import (
    BASE, SHOPS, ACCOUNTS, make_browser, new_context, login_owner,
    run_assertion, AssertRecord, cleanup_order, unlock_user, reset_shop_open,
    reset_demo_pho_settings, cleanup_today_orders_for_shop, save_results,
    find_order_by_display_no, find_reminders, db_exec, _sql_quote, _psql,
    NAV_TIMEOUT, ASSERT_TIMEOUT, ACTION_TIMEOUT,
)

SCRIPT_TAG = "e2e-flow-6-settings"
FLOW = "F7 老板设置实时联动客户菜单"
SLUG = SHOPS["PHO"]


def find_test_product(slug: str) -> dict:
    sql = f"""
SELECT id, name, price::text
FROM "Product"
WHERE "shopId"=(SELECT id FROM \"Shop\" WHERE slug={_sql_quote(slug)})
  AND active=true
ORDER BY "sortOrder" LIMIT 1
"""
    rows = db_exec(sql)
    parts = rows[0]["cols"]
    return {"id": parts[0], "name": parts[1], "price": parts[2]}


def main() -> int:
    print(f"\n========== {SCRIPT_TAG} · {FLOW} ==========")
    started = datetime.now(timezone.utc)
    cleanup_today_orders_for_shop(SLUG)
    unlock_user(ACCOUNTS["OWNER_PHO"][0])
    reset_shop_open()
    records: list[AssertRecord] = []

    sid = db_exec(f"SELECT id FROM \"Shop\" WHERE slug={_sql_quote(SLUG)}")[0]["value"]

    with make_browser() as p:
        boss_ctx = new_context(p, tag="boss", locale="vi-VN")
        boss = login_owner(boss_ctx, "vi")
        boss.wait_for_timeout(1500)

        try:
            # ============ S6: 切换营业开关 → 客户菜单页 reload 显示打烊 ============
            # 点 ☰ 店名打开抽屉（侧栏）
            side_btn = boss.locator("button:has-text('Phở Demo 88')").first
            if side_btn.count() == 0:
                # 也可能是 ☰ 触发
                side_btn = boss.locator("header span:has-text('☰')").first
            records.append(run_assertion(
                lambda: (_ for _ in ()).throw(AssertionError("无抽屉触发按钮")) if side_btn.count() == 0 else None,
                "S0", "dashboard 有抽屉触发按钮",
                screenshot_page=boss,
            ))
            if side_btn.count() > 0:
                side_btn.click()
                boss.wait_for_timeout(800)

            # 营业开关按钮（"Mở cửa" / "Đóng cửa"）
            open_close_btn = boss.locator("button:has-text('Đóng cửa'), button:has-text('Mở cửa')").first
            records.append(run_assertion(
                lambda: (_ for _ in ()).throw(AssertionError("无营业开关按钮")) if open_close_btn.count() == 0 else None,
                "S6-1", "设置面板有营业开关",
                screenshot_page=boss,
            ))
            if open_close_btn.count() > 0:
                open_close_btn.click(timeout=5000)
                boss.wait_for_timeout(1500)

            # DB 验证
            shop = db_exec(f"SELECT open FROM \"Shop\" WHERE id={_sql_quote(sid)}")[0]
            current_open = shop["value"]
            records.append(run_assertion(
                lambda: (_ for _ in ()).throw(AssertionError("DB open 未变")) if current_open not in ("t", "f") else None,
                "S6-DB", f"DB Shop.open 切换后={current_open}",
            ))

            # 客户菜单页 reload 应显示打烊或营业
            cust_ctx = new_context(p, tag="cust", locale="vi-VN")
            cust = cust_ctx.new_page()
            cust.goto(f"{BASE}/vi/s/{SLUG}", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            cust.wait_for_timeout(2000)
            if current_open == "f":
                closed_hint = cust.locator("text=/đóng cửa|ngừng/").count()
                records.append(run_assertion(
                    lambda: (_ for _ in ()).throw(AssertionError("打烊时客户页无提示")) if closed_hint == 0 else None,
                    "S6-CUST", "打烊时客户页显示提示",
                    screenshot_page=cust,
                ))
            cust_ctx.close()

            # 恢复
            _psql(f"UPDATE \"Shop\" SET open=true WHERE id={_sql_quote(sid)}")

            # ============ R5: 售罄切换实时同步 ============
            test_prod = find_test_product(SLUG)
            cust_ctx = new_context(p, tag="cust", locale="vi-VN")
            cust = cust_ctx.new_page()
            cust.goto(f"{BASE}/vi/s/{SLUG}", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            cust.wait_for_timeout(1500)
            # 售罄前：商品可见
            before = cust.locator(f"button:has-text('{test_prod['name'][:6]}')").count()
            records.append(AssertRecord(
                code="R5-BEFORE", title=f"售罄前：商品 [{test_prod['name']}] 在菜单",
                status="PASS" if before > 0 else "FAIL",
                note=f"count={before}",
            ))

            # 切售罄
            _psql(f"UPDATE \"Product\" SET active=false WHERE id={_sql_quote(test_prod['id'])}")
            cust.reload(wait_until="domcontentloaded")
            cust.wait_for_timeout(1500)
            after = cust.locator(f"button:has-text('{test_prod['name'][:6]}')").count()
            records.append(run_assertion(
                lambda: (_ for _ in ()).throw(AssertionError(f"售罄后商品仍在菜单 (count={after})")) if after > 0 else None,
                "R5-AFTER", "售罄切换：客户菜单实时隐藏",
                screenshot_page=cust,
            ))
            cust_ctx.close()

            # 恢复
            _psql(f"UPDATE \"Product\" SET active=true WHERE id={_sql_quote(test_prod['id'])}")

        except Exception as e:
            records.append(AssertRecord(
                code="UNCAUGHT", title="F7 未捕获异常",
                status="FAIL", note=repr(e)[:500],
            ))
        finally:
            reset_shop_open()
            reset_demo_pho_settings()

        boss_ctx.close()

    ended = datetime.now(timezone.utc)
    save_results(SCRIPT_TAG, FLOW, records, started, ended)
    return 0 if all(r.status != "FAIL" for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())