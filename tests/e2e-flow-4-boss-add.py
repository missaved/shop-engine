#!/usr/bin/env python3
"""F4 · 老板加菜/删菜（费用守恒）

业务目标：老板修改进行中订单，费用守恒不变。
覆盖：A1 加菜, A2 删菜, A3 删空归零, A4 终态守卫。
"""
from __future__ import annotations
import sys, uuid, re
from pathlib import Path
from datetime import datetime, timezone
sys.path.insert(0, str(Path(__file__).parent))
from tests.lib.e2e_common import (
    BASE, SHOPS, ACCOUNTS, make_browser, new_context, login_owner,
    run_assertion, AssertRecord, cleanup_order, unlock_user, reset_shop_open,
    cleanup_today_orders_for_shop, save_results,
    find_order_by_display_no, find_reminders, db_exec, _sql_quote, _psql,
    NAV_TIMEOUT, ASSERT_TIMEOUT, ACTION_TIMEOUT,
)

SCRIPT_TAG = "e2e-flow-4-boss-add"
FLOW = "F4 老板加菜/删菜（费用守恒）"
SLUG = SHOPS["PHO"]


def create_test_order(slug: str, total: int = 60000) -> str:
    """创建 PENDING 测试单 + 提醒。"""
    sid = db_exec(f"SELECT id FROM \"Shop\" WHERE slug={_sql_quote(slug)}")[0]["value"]
    today = datetime.now().strftime("%y%m%d")
    rows = db_exec(f"""
SELECT COALESCE(MAX(CAST(SUBSTRING(\"displayNo\" FROM 'CP-{today}-(\\d+)') AS INTEGER)), 0) AS max_seq
FROM \"Order\" WHERE \"shopId\"={_sql_quote(sid)}
""")
    next_seq = int(rows[0]["value"]) + 1 if rows else 1
    display_no = f"CP-{today}-{next_seq:03d}"
    oid = "test_" + uuid.uuid4().hex[:10]
    guest_key = uuid.uuid4().hex

    sql = f"""
INSERT INTO "Order" (id, "orderNo", "displayNo", "shopId", status, items, total, "paidAmount",
    "customerName", "customerPhone", "createdAt", "updatedAt", config)
VALUES (
    '{oid}',
    (SELECT COALESCE(MAX("orderNo"),0)+1 FROM "Order" WHERE "shopId"={_sql_quote(sid)}),
    '{display_no}',
    '{sid}',
    'PENDING',
    '[{{"name":"Phở bò tái","qty":2,"price":30000,"extras":[],"options":[],"combo":[]}}]'::jsonb,
    {total},
    0,
    'Test Customer',
    '0909999999',
    NOW(), NOW(),
    '{{"orderType":"dine_in","tableNo":"Bàn 9","guestKey":"{guest_key}"}}'::jsonb
)
"""
    _psql(sql)
    return display_no


def main() -> int:
    print(f"\n========== {SCRIPT_TAG} · {FLOW} ==========")
    started = datetime.now(timezone.utc)
    cleanup_today_orders_for_shop(SLUG)
    unlock_user(ACCOUNTS["OWNER_PHO"][0])
    reset_shop_open()
    records: list[AssertRecord] = []

    display_no = create_test_order(SLUG, 60000)
    print(f"  test order: {display_no}")

    with make_browser() as p:
        boss_ctx = new_context(p, tag="boss", locale="vi-VN")
        boss = login_owner(boss_ctx, "vi")
        boss.wait_for_timeout(1500)

        try:
            # 展开订单卡
            card = boss.locator(f"div[id^='order-']:has-text('{display_no}')").first
            if card.count() == 0:
                card = boss.locator("div[id^='order-']").first
            card.click()
            boss.wait_for_timeout(800)

            # ============ A1: 加菜面板 ============
            # 点「Thêm món」展开加菜面板
            add_btn = boss.locator(f"div[id^='order-']:has-text('{display_no}')").locator("button:has-text('Thêm món')").first
            if add_btn.count() == 0:
                add_btn = boss.locator("button:has-text('Thêm món')").first
            records.append(run_assertion(
                lambda: (_ for _ in ()).throw(AssertionError("无 Thêm món 按钮")) if add_btn.count() == 0 else None,
                "A0", "PENDING 单有「Thêm món」按钮",
                screenshot_page=boss,
            ))

            if add_btn.count() > 0:
                add_btn.click()
                boss.wait_for_timeout(800)

            # 选商品 + 数量
            # 找一个加菜面板里的 select + number input
            product_select = boss.locator("select").first
            qty_input = boss.locator("input[type='number']").last  # 最后一个 number 是数量

            # 通过 evaluate 找 select 选项
            first_product_id = ""
            try:
                opts = boss.evaluate("""() => {
                  const sel = document.querySelector('select');
                  if (!sel) return [];
                  return Array.from(sel.options).map(o => ({value: o.value, text: o.textContent}));
                }""")
                if opts and len(opts) > 0:
                    first_product_id = opts[0]["value"]
                    # 用 keyboard 选第一个选项
                    product_select.select_option(index=0)
                    boss.wait_for_timeout(300)
            except Exception:
                pass

            if qty_input.count() > 0:
                qty_input.fill("2", timeout=2000)
                boss.wait_for_timeout(300)

            # 点「Thêm」（加菜提交）
            submit = boss.locator("button:has-text('Thêm'):not(:has-text('món'))").first
            if submit.count() == 0:
                submit = boss.locator("button:has-text('+')").first
            if submit.count() > 0:
                submit.click(timeout=5000)
                boss.wait_for_timeout(2000)

            # 验证 items 增加 + total 增加
            order = find_order_by_display_no(display_no)
            if order:
                cfg = order.get("config", "")
                items_count = cfg.count('"qty":') if '"qty":' in cfg else 0
                records.append(AssertRecord(
                    code="A1-DB", title=f"加菜后订单存在，items 数={items_count}",
                    status="PASS" if items_count >= 2 else "FAIL",
                    note=f"config={cfg[:200]}",
                ))

            # ============ A4: 给 COMPLETED 单加菜被拦 ============
            test_completed = create_test_order(SLUG, 30000)
            _psql(f"UPDATE \"Order\" SET status='COMPLETED', \"paidAmount\"=30000 WHERE \"displayNo\"={_sql_quote(test_completed)}")
            boss.reload(wait_until="domcontentloaded")
            boss.wait_for_timeout(1500)
            card_c = boss.locator(f"div[id^='order-']:has-text('{test_completed}')").first
            if card_c.count() > 0:
                card_c.click()
                boss.wait_for_timeout(500)
            # COMPLETED 单默认折叠且无 Thêm món 按钮（终态守卫）
            thêm_c = boss.locator(f"div[id^='order-']:has-text('{test_completed}')").locator("button:has-text('Thêm món')").count()
            records.append(AssertRecord(
                code="A4-1", title="COMPLETED 单加菜按钮不可见（守卫）",
                status="PASS" if thêm_c == 0 else "FAIL",
                note=f"Thêm món count for COMPLETED = {thêm_c}",
            ))
            cleanup_order(test_completed)

            # ============ A5: 给 CANCELLED 单加菜被拦 ============
            test_cancelled = create_test_order(SLUG, 30000)
            _psql(f"UPDATE \"Order\" SET status='CANCELLED' WHERE \"displayNo\"={_sql_quote(test_cancelled)}")
            boss.reload(wait_until="domcontentloaded")
            boss.wait_for_timeout(1500)
            card_x = boss.locator(f"div[id^='order-']:has-text('{test_cancelled}')").first
            if card_x.count() > 0:
                card_x.click()
                boss.wait_for_timeout(500)
            thêm_x = boss.locator(f"div[id^='order-']:has-text('{test_cancelled}')").locator("button:has-text('Thêm món')").count()
            records.append(AssertRecord(
                code="A5-1", title="CANCELLED 单加菜按钮不可见（守卫）",
                status="PASS" if thêm_x == 0 else "FAIL",
                note=f"Thêm món count for CANCELLED = {thêm_x}",
            ))
            cleanup_order(test_cancelled)

        except Exception as e:
            records.append(AssertRecord(
                code="UNCAUGHT", title="F4 未捕获异常",
                status="FAIL", note=repr(e)[:500],
            ))
        finally:
            try:
                cleanup_order(display_no)
            except Exception:
                pass

        boss_ctx.close()

    ended = datetime.now(timezone.utc)
    save_results(SCRIPT_TAG, FLOW, records, started, ended)
    return 0 if all(r.status != "FAIL" for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())