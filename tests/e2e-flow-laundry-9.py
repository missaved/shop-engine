#!/usr/bin/env python3
# 洗衣(E2E-9)：顾客复购 —— 顾客 /my 点「Đặt lại」→ 生成同顾客新单
import sys, re
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "lib"))
from e2e_common import (BASE, ACTION_TIMEOUT, ASSERT_TIMEOUT, NAV_TIMEOUT, make_browser, new_context, run_assertion, save_results, db_exec)
SCRIPT_TAG = "laundry-e2e-9"
FLOW = "洗衣：顾客自助复购"
SLUG = "demolaud"; CPHONE = "0987000011"; CPWD = "demo1234"


def shop_id():
    return db_exec(f"SELECT id FROM \"Shop\" WHERE slug='{SLUG}'")[0]["value"] if db_exec(f"SELECT id FROM \"Shop\" WHERE slug='{SLUG}'") else None


def cust_id():
    r = db_exec(f"SELECT id FROM \"Customer\" WHERE phone='{CPHONE}'")
    return r[0]["value"] if r else None


def cust_order_count():
    r = db_exec(f"SELECT count(*) FROM \"Order\" WHERE \"customerId\"=(SELECT id FROM \"Customer\" WHERE phone='{CPHONE}')::text")
    return int(r[0]["value"]) if r and r[0].get("value") else 0


def setup():
    cid = cust_id()
    if not cid:
        db_exec(f"INSERT INTO \"Customer\" (id,phone,name,provider,\"createdAt\",\"updatedAt\") VALUES (gen_random_uuid()::text,'{CPHONE}','Chị Hoa','password',NOW(),NOW())")
        cid = cust_id()
    sid = shop_id()
    # 给该顾客插一张源单（customerId 绑定，供复购）
    if cust_order_count() == 0:
        db_exec(f"INSERT INTO \"Order\" (id,\"orderNo\",\"displayNo\",\"shopId\",status,items,total,\"paidAmount\",\"customerId\",\"customerPhone\",\"createdAt\",\"updatedAt\",config) VALUES (gen_random_uuid()::text,(SELECT COALESCE(MAX(\"orderNo\"),0)+1 FROM \"Order\" WHERE \"shopId\"='{sid}'::text),'LD-REORDER-01','{sid}'::text,'PENDING','[]'::jsonb,50000,0,'{cid}'::text,'{CPHONE}',NOW(),NOW(),'{{\"laundryMode\":\"kg\",\"laundryStatus\":\"washing_pending\",\"tagCode\":\"#900\"}}'::jsonb)")


def cleanup():
    db_exec(f"DELETE FROM \"Order\" WHERE \"customerId\"=(SELECT id FROM \"Customer\" WHERE phone='{CPHONE}')::text AND (\"displayNo\" LIKE 'LD-REORDER%' OR \"orderNo\" > 100000)")


def main():
    cleanup(); setup(); started = datetime.now(); records = []
    with make_browser() as p:
        b = new_context(p, tag="laund9", locale="vi-VN")
        page = b.new_page(); page.set_default_timeout(ASSERT_TIMEOUT); page.set_default_navigation_timeout(NAV_TIMEOUT)
        csrf = page.request.get(f"{BASE}/api/auth/csrf").json()["csrfToken"]
        page.request.post(f"{BASE}/api/auth/callback/customer-credentials", form={"csrfToken": csrf, "phone": CPHONE, "password": CPWD})
        page.goto(f"{BASE}/vi/hcm/laundry/{SLUG}/my", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        page.wait_for_timeout(2500)
        before = cust_order_count()
        records.append(run_assertion(lambda: page.get_by_text("LD-REORDER-01").count() > 0, "i1", "/my 显示源单", script_tag=SCRIPT_TAG, screenshot_page=page))
        page.get_by_text("Đặt lại").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(2500)
        after = cust_order_count()
        records.append(run_assertion(lambda: after > before, "i2", "复购后新增订单", script_tag=SCRIPT_TAG))
        # 复购的新单应为该顾客的 customerId 且状态待洗
        rows = db_exec(f"SELECT status FROM \"Order\" WHERE \"customerId\"=(SELECT id FROM \"Customer\" WHERE phone='{CPHONE}')::text AND \"displayNo\" LIKE 'LD-%' AND \"orderNo\" > 100000 ORDER BY \"orderNo\" DESC LIMIT 1")
        records.append(run_assertion(lambda: rows and rows[0].get("value") == "PENDING", "i3", "复购新单 PENDING", script_tag=SCRIPT_TAG))
    save_results(SCRIPT_TAG, FLOW, records, started, datetime.now())
    ok = all(r.status != "FAIL" for r in records)
    print(f"{'PASS' if ok else 'FAIL'} {len(records)} 断言")


if __name__ == "__main__":
    main()
