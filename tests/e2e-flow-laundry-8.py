#!/usr/bin/env python3
# 洗衣(E2E-8)：取消订单 + 扣次卡结算（次卡减次数 + 订单收款）
import re, sys, subprocess, uuid
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "lib"))
from e2e_common import (
    BASE, ACTION_TIMEOUT, ASSERT_TIMEOUT, NAV_TIMEOUT,
    make_browser, new_context, run_assertion, save_results, unlock_user, db_exec,
)
SCRIPT_TAG = "laundry-e2e-8"
FLOW = "洗衣：取消订单 + 扣次卡"
SLUG = "demolaud"; LAUN = "0901122335"; PWD = "demo1234"; CPHONE = "0987000011"


def shop_id():
    r = db_exec(f"SELECT id FROM \"Shop\" WHERE slug='{SLUG}'")
    return r[0]["value"] if r else None


def latest_ld():
    rows = db_exec(f"SELECT id, \"displayNo\", status FROM \"Order\" WHERE \"shopId\"='{shop_id()}'::text AND \"displayNo\" LIKE 'LD-%' ORDER BY \"orderNo\" DESC LIMIT 1")
    if not rows or not rows[0].get("cols"): return None
    c = rows[0]["cols"]; return {"id": c[0], "dn": c[1], "st": c[2]}


def cust_card():
    r = db_exec(f"SELECT \"remainingCount\"::text FROM \"CustomerCard\" WHERE (SELECT id FROM \"Customer\" WHERE phone='{CPHONE}')::text = \"customerId\" ORDER BY \"createdAt\" DESC LIMIT 1")
    return int(r[0]["value"]) if r and r[0].get("value") else None


def card_id():
    r = db_exec(f"SELECT id FROM \"CustomerCard\" WHERE (SELECT id FROM \"Customer\" WHERE phone='{CPHONE}')::text = \"customerId\" ORDER BY \"createdAt\" DESC LIMIT 1")
    return r[0]["value"] if r else None


def setup():
    # 确保顾客+次卡存在（次卡 5 次）
    c = db_exec(f"SELECT id FROM \"Customer\" WHERE phone='{CPHONE}'")
    if not c:
        db_exec(f"INSERT INTO \"Customer\" (id,phone,name,provider,\"createdAt\",\"updatedAt\") VALUES (gen_random_uuid()::text,'{CPHONE}','Chị Hoa','password',NOW(),NOW())")
    sid = shop_id()
    if not card_id():
        db_exec(f"INSERT INTO \"CustomerCard\" (id,\"customerId\",\"shopId\",type,name,\"remainingCount\",\"createdAt\",\"updatedAt\") VALUES (gen_random_uuid()::text,(SELECT id FROM \"Customer\" WHERE phone='{CPHONE}')::text,'{sid}'::text,'count','Thẻ lần 5',5,NOW(),NOW())")


def cleanup():
    unlock_user(LAUN); sid = shop_id()
    if sid:
        db_exec(f"DELETE FROM \"Order\" WHERE \"shopId\"='{sid}'::text AND \"displayNo\" LIKE 'LD-%' AND \"orderNo\" > 2")


def login(ctx):
    page = ctx.new_page(); page.set_default_timeout(ASSERT_TIMEOUT); page.set_default_navigation_timeout(NAV_TIMEOUT)
    page.goto(f"{BASE}/vi/login", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.fill('input[name="phone"]', LAUN); page.fill('input[name="password"]', PWD)
    page.click('button[type="submit"]'); page.wait_for_url(lambda u: "/login" not in u, timeout=ACTION_TIMEOUT)
    page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)
    return page


def create_advance(page, phone=None):
    page.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.get_by_text("Tạo đơn").first.click(timeout=ACTION_TIMEOUT)
    page.wait_for_selector("text=5kg", timeout=30000)
    page.get_by_text("5kg").first.click(timeout=ASSERT_TIMEOUT)
    if phone:
        page.get_by_placeholder("SĐT khách").first.fill(phone, timeout=ASSERT_TIMEOUT)
    page.get_by_text(re.compile("Gửi đơn")).first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(2500)
    o = latest_ld()
    if not o: return None
    page.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.get_by_text("Tất cả").first.click(timeout=ASSERT_TIMEOUT); page.wait_for_timeout(800)
    page.get_by_text("Bắt đầu giặt").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(1100)
    page.get_by_text("Gửi kiểm tra").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(1100)
    page.get_by_text("Qua kiểm tra").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(1100)
    return o


def main():
    cleanup(); setup(); started = datetime.now(); records = []
    with make_browser() as p:
        ctx = new_context(p, tag="laund8", locale="vi-VN"); page = login(ctx)
        # 扣次卡
        before = cust_card()
        o = create_advance(page, CPHONE)
        records.append(run_assertion(lambda: o is not None, "h1", "建单(顾客)", script_tag=SCRIPT_TAG))
        if o:
            page.get_by_text("Thu tiền").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(800)
            page.get_by_text("Trừ thẻ lần").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(2000)
            after = cust_card()
            records.append(run_assertion(lambda: before is not None and after is not None and after < before, "h2", "扣次卡后次数减少", script_tag=SCRIPT_TAG))
            paypsql = db_exec(f"SELECT \"paidAmount\"::text FROM \"Order\" WHERE id='{o['id']}'")[0]["value"]
            records.append(run_assertion(lambda: float(paypsql) > 0, "h3", "次卡结账单已收款", script_tag=SCRIPT_TAG))
            db_exec(f"DELETE FROM \"Order\" WHERE id='{o['id']}'::text")
        # 取消订单
        o2 = create_advance(page)
        records.append(run_assertion(lambda: o2 is not None, "h4", "建单2", script_tag=SCRIPT_TAG))
        if o2:
            page.get_by_text("Hủy").first.click(timeout=ACTION_TIMEOUT)
            page.on("dialog", lambda d: d.accept())
            page.wait_for_timeout(2000)
            st = db_exec(f"SELECT status FROM \"Order\" WHERE id='{o2['id']}'")[0]["value"]
            records.append(run_assertion(lambda: st == "CANCELLED", "h5", "取消后 CANCELLED", script_tag=SCRIPT_TAG))
            db_exec(f"DELETE FROM \"Order\" WHERE id='{o2['id']}'::text")
    save_results(SCRIPT_TAG, FLOW, records, started, datetime.now())
    ok = all(r.status != "FAIL" for r in records)
    print(f"{'PASS' if ok else 'FAIL'} {len(records)} 断言")


if __name__ == "__main__":
    main()
