#!/usr/bin/env python3
"""F9 · 客户查单全场景（覆盖 T1-T8）

业务目标：查单的所有可能路径 + 边界 + 限流。
"""
from __future__ import annotations
import sys, urllib.parse, uuid, json
from pathlib import Path
from datetime import datetime, timezone
sys.path.insert(0, str(Path(__file__).parent))
from tests.lib.e2e_common import (
    BASE, SHOPS, ACCOUNTS, make_browser, new_context,
    run_assertion, AssertRecord, cleanup_order, unlock_user, reset_shop_open,
    cleanup_today_orders_for_shop, save_results,
    find_order_by_display_no, db_exec, _sql_quote, _psql,
    NAV_TIMEOUT, ASSERT_TIMEOUT, ACTION_TIMEOUT,
)

SCRIPT_TAG = "e2e-flow-8-track"
FLOW = "F9 客户查单全场景"
SLUG = SHOPS["PHO"]


def create_test_order(slug, with_phone=True):
    sid_row = db_exec("SELECT id FROM \"Shop\" WHERE slug=" + _sql_quote(slug))
    sid = sid_row[0]["value"]
    today = datetime.now().strftime("%y%m%d")
    like_pat = "CP-" + today + "-%"
    sql_max = 'SELECT COALESCE(MAX(CAST(SUBSTRING("displayNo" FROM \'CP-[0-9]{6}-([0-9]+)\') AS INTEGER)), 0) AS m FROM "Order" WHERE "shopId"=' + _sql_quote(sid) + ' AND "displayNo" LIKE ' + _sql_quote(like_pat)
    rows = db_exec(sql_max)
    next_seq = int(rows[0]["value"]) + 1 if rows else 1
    display_no = "CP-" + today + "-" + "{:03d}".format(next_seq)
    oid = "test_" + uuid.uuid4().hex[:10]
    guest_key = uuid.uuid4().hex
    cfg = {"orderType": "dine_in", "tableNo": "Bàn 5", "guestKey": guest_key}
    cfg_json = json.dumps(cfg)
    phone = "13800138000" if with_phone else None
    customer_name = _sql_quote("Test") if with_phone else "NULL"
    phone_sql = _sql_quote(phone) if phone else "NULL"
    items = '[{"name":"Phở","qty":1,"price":50000,"extras":[],"options":[],"combo":[]}]'
    sql = (
        "INSERT INTO \"Order\" (id, \"orderNo\", \"displayNo\", \"shopId\", status, items, total, \"paidAmount\", "
        "\"customerName\", \"customerPhone\", \"createdAt\", \"updatedAt\", config) VALUES ("
        + _sql_quote(oid) + ", "
        + "(SELECT COALESCE(MAX(\"orderNo\"),0)+1 FROM \"Order\" WHERE \"shopId\"=" + _sql_quote(sid) + "), "
        + _sql_quote(display_no) + ", "
        + _sql_quote(sid) + ", 'PENDING', "
        + _sql_quote(items) + "::jsonb, 50000, 0, " + customer_name + ", " + phone_sql + ", NOW(), NOW(), "
        + _sql_quote(cfg_json) + "::jsonb)"
    )
    _psql(sql)
    return display_no, oid, guest_key


def main() -> int:
    print(f"\n========== {SCRIPT_TAG} · {FLOW} ==========")
    started = datetime.now(timezone.utc)
    cleanup_today_orders_for_shop(SLUG)
    unlock_user(ACCOUNTS["OWNER_PHO"][0])
    reset_shop_open()
    records: list[AssertRecord] = []

    with make_browser() as p:
        ctx = new_context(p, tag="track", locale="vi-VN")
        page = ctx.new_page()
        page.set_default_timeout(ASSERT_TIMEOUT)
        page.set_default_navigation_timeout(NAV_TIMEOUT)

        try:
            # T1: 留号单查单命中
            no1, oid1, _ = create_test_order(SLUG, with_phone=True)
            page.goto(
                BASE + "/vi/s/" + SLUG + "/track?orderNo=" + urllib.parse.quote(no1) + "&phone=13800138000",
                wait_until="domcontentloaded", timeout=NAV_TIMEOUT,
            )
            page.wait_for_timeout(2000)
            hits = page.locator("text=/" + no1 + "/").count()
            records.append(run_assertion(
                lambda: (_ for _ in ()).throw(AssertionError("留号单查单未命中")) if hits == 0 else None,
                "T1", "留号单按 orderNo+phone 查单命中",
                screenshot_page=page,
            ))
            cleanup_order(no1)

            # T5: 带号单只填订单号（漏填 phone）
            no2, oid2, _ = create_test_order(SLUG, with_phone=True)
            page.goto(
                BASE + "/vi/s/" + SLUG + "/track?orderNo=" + urllib.parse.quote(no2),
                wait_until="domcontentloaded", timeout=NAV_TIMEOUT,
            )
            page.wait_for_timeout(1500)
            notfound = page.locator("text=/không tìm|未找到|not found|未找到该订单/i").count()
            records.append(run_assertion(
                lambda: (_ for _ in ()).throw(AssertionError("带号单漏填 phone 应 notFound")) if notfound == 0 else None,
                "T5", "带号单漏填手机号 → notFound（防泄漏）",
                screenshot_page=page,
            ))
            cleanup_order(no2)

            # T7: COMPLETED 单「删除我的数据」按钮
            no3, oid3, _ = create_test_order(SLUG, with_phone=True)
            _psql('UPDATE "Order" SET status=\'COMPLETED\', "paidAmount"=50000 WHERE "displayNo"=' + _sql_quote(no3))
            page.goto(
                BASE + "/vi/s/" + SLUG + "/track?orderNo=" + urllib.parse.quote(no3) + "&phone=13800138000",
                wait_until="domcontentloaded", timeout=NAV_TIMEOUT,
            )
            page.wait_for_timeout(1500)
            del_btn = page.locator("button:has-text('Xóa')").count()
            records.append(AssertRecord(
                code="T7-1", title="COMPLETED 单有「删除我的数据」按钮",
                status="PASS" if del_btn > 0 else "FAIL",
                note="Xóa count=" + str(del_btn),
            ))
            cleanup_order(no3)

            # I3: 不存在的 slug → 404
            resp = page.goto(BASE + "/vi/s/nonexistent-shop-xxx", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            status = resp.status if resp else 0
            records.append(run_assertion(
                lambda: (_ for _ in ()).throw(AssertionError("404 期望 actual=" + str(status))) if status != 404 else None,
                "I3", "不存在的 slug 返回 404",
            ))

            # L2: 查单连错 6 次 → 第 6 次限流
            for i in range(6):
                page.goto(
                    BASE + "/vi/s/" + SLUG + "/track?orderNo=NOPE&phone=9999999999",
                    wait_until="domcontentloaded", timeout=NAV_TIMEOUT,
                )
                page.wait_for_timeout(800)
            rate_limited = page.locator("text=/quá nhiều|rate.limit|nhiều lần|限流/i").count()
            records.append(run_assertion(
                lambda: (_ for _ in ()).throw(AssertionError("6 次错查后无限流")) if rate_limited == 0 else None,
                "L2", "查单连错 6 次限流提示",
                screenshot_page=page,
            ))

        except Exception as e:
            records.append(AssertRecord(
                code="UNCAUGHT", title="F9 未捕获异常",
                status="FAIL", note=repr(e)[:500],
            ))

        ctx.close()

    ended = datetime.now(timezone.utc)
    save_results(SCRIPT_TAG, FLOW, records, started, ended)
    return 0 if all(r.status != "FAIL" for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())