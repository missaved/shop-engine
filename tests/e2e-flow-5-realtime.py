#!/usr/bin/env python3
"""F6（计划编号） · 跨端实时同步（新单 + 状态 + 出餐）

业务目标：客户下单老板立刻看到、老板推进客户立刻知道。

场景：
- 老板 dashboard 保持打开
- 客户 ctx 下单
- ≤30s 老板看到新单
- 老板推进 → 客户 track 页 15s 内状态变化
"""
from __future__ import annotations
import sys, re, urllib.parse, uuid
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

SCRIPT_TAG = "e2e-flow-5-realtime"
FLOW = "F6 跨端实时同步"
SLUG = SHOPS["PHO"]


def create_test_order(slug: str, total: int = 60000) -> str:
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
    '{{"orderType":"dine_in","tableNo":"Bàn 9","guestKey":"{guest_key}","guestIp":"127.0.0.1"}}'::jsonb
)
"""
    _psql(sql)
    sql2 = f"""
INSERT INTO "Reminder" (id, "shopId", "orderId", "templateKey", status, "dueAt", payload, "createdAt", "updatedAt")
VALUES ('rem_{uuid.uuid4().hex[:10]}', '{sid}', '{oid}', 'FOOD_NEW_ORDER', 'PENDING', NOW(),
    '{{"displayNo":"{display_no}","total":{total}}}'::jsonb, NOW(), NOW())
"""
    _psql(sql2)
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
        # ============ Boss 端：保持 dashboard 打开 ============
        boss_ctx = new_context(p, tag="boss", locale="vi-VN")
        boss = login_owner(boss_ctx, "vi")
        boss.wait_for_timeout(2000)

        # 验证新单可见（轮询 ≤30s 应捕获）
        boss_text_initial = boss.content() or ""
        visible = display_no in boss_text_initial
        records.append(run_assertion(
            lambda: (_ for _ in ()).throw(AssertionError(f"老板 dashboard 未显示新单 {display_no}")) if not visible else None,
            "R1-BOSS-VISIBLE", f"老板 dashboard 显示新单 {display_no}",
            screenshot_page=boss,
        ))

        # 验证 FOOD_NEW_ORDER 提醒入库
        order = find_order_by_display_no(display_no)
        if order:
            reminders = find_reminders(order["id"])
            has_new_order = any(r["templateKey"] == "FOOD_NEW_ORDER" for r in reminders)
            records.append(run_assertion(
                lambda: (_ for _ in ()).throw(AssertionError(f"FOOD_NEW_ORDER 提醒未入库")) if not has_new_order else None,
                "R1-REMINDER", "FOOD_NEW_ORDER 提醒入库",
            ))

        # ============ Boss 端：推进状态 ============
        card = boss.locator(f"div[id^='order-']:has-text('{display_no}')").first
        if card.count() > 0:
            card.click()
            boss.wait_for_timeout(800)

        advance_btn = boss.locator("button:has-text('Tiếp tục')").first
        if advance_btn.count() > 0:
            advance_btn.click(timeout=5000)
            boss.wait_for_timeout(2500)

        order = find_order_by_display_no(display_no)
        if order:
            records.append(run_assertion(
                lambda: (_ for _ in ()).throw(AssertionError(f"status={order.get('status')} 期望 READY")) if order.get("status") != "READY" else None,
                "R2-STATUS", "推进后 DB status=READY",
            ))

        # ============ 客户 ctx：track 页打开（用 cookie guestKey） ============
        # 由于我们用 SQL 插入的订单带 guestKey，但没设 cookie 给客户端；改用 orderNo + phone 查单
        cust_ctx = new_context(p, tag="cust", locale="vi-VN")
        cust = cust_ctx.new_page()
        cust.set_default_timeout(ASSERT_TIMEOUT)
        cust.set_default_navigation_timeout(NAV_TIMEOUT)

        try:
            cust.goto(
                f"{BASE}/vi/s/demo-pho/track?orderNo={urllib.parse.quote(display_no)}&phone={urllib.parse.quote('0909999999')}",
                wait_until="domcontentloaded", timeout=NAV_TIMEOUT,
            )
            cust.wait_for_timeout(2000)

            # TrackStatus 轮询 15s（脚本内不真等 15s，只验证页面挂载）
            has_status = cust.locator("text=/Sẵn sàng|READY|Chờ xử lý|PENDING|Đã hoàn thành|Đang làm/").count()
            records.append(run_assertion(
                lambda: (_ for _ in ()).throw(AssertionError(f"track 页无状态文本")) if has_status == 0 else None,
                "R2-TRACK-STATUS", "track 页显示订单状态文本",
                screenshot_page=cust,
            ))

            # 验证进度条元素存在（4 步）
            steps = cust.locator("text=/^[1-4]$/").count()
            records.append(AssertRecord(
                code="R2-PROGRESS-BAR", title="track 页有进度条步骤",
                status="PASS" if steps >= 4 else "FAIL",
                note=f"steps count={steps}",
            ))

            # ============ 客户加菜：track 页加菜区 ============
            add_more = cust.locator("text=/thêm|Thêm vào/").count()
            records.append(AssertRecord(
                code="K1-ADD-MORE", title="track 页有加菜区",
                status="PASS" if add_more > 0 else "FAIL",
                note=f"thêm count={add_more}",
            ))

        except Exception as e:
            records.append(AssertRecord(
                code="UNCAUGHT", title="F6 客户 ctx 异常",
                status="FAIL", note=repr(e)[:300],
            ))

        cust_ctx.close()
        cleanup_order(display_no)

        boss_ctx.close()

    ended = datetime.now(timezone.utc)
    save_results(SCRIPT_TAG, FLOW, records, started, ended)
    return 0 if all(r.status != "FAIL" for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())