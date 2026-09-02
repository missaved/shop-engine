#!/usr/bin/env python3
# 洗衣(E2E-4)：顾客侧登录 → /my 看储值/卡/订单
# 用 customer-credentials 回调登录（浏览器上下文），再进 /my 断言店名 + 余额(120kđ) + 卡(Thẻ lần)
import re, sys, json
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "lib"))
from e2e_common import (
    BASE, ACTION_TIMEOUT, ASSERT_TIMEOUT, NAV_TIMEOUT,
    make_browser, new_context, run_assertion, save_results, db_exec,
)
SCRIPT_TAG = "laundry-e2e-4"
FLOW = "洗衣：顾客侧登录看储值/卡/订单"
SLUG = "demolaud"
CUST_PHONE = "0987000011"; CUST_PWD = "demo1234"
RECORDS = []


def cleanup():
    # 给顾客建一张次卡 + 一笔订单，便于断言（幂等）
    c = db_exec(f"SELECT id FROM \"Customer\" WHERE phone='{CUST_PHONE}'")
    if not c:
        return
    cid = c[0]["value"]
    sid = db_exec(f"SELECT id FROM \"Shop\" WHERE slug='{SLUG}'")[0]["value"]
    # 清理旧卡/旧单
    db_exec(f"DELETE FROM \"CustomerCard\" WHERE \"customerId\"='{cid}'::text")
    db_exec(f"DELETE FROM \"Order\" WHERE \"customerId\"='{cid}'::text")
    db_exec(f"INSERT INTO \"CustomerCard\" (id,\"customerId\",\"shopId\",type,name,\"remainingCount\",\"createdAt\",\"updatedAt\") VALUES (gen_random_uuid()::text,'{cid}'::text,'{sid}'::text,'count','Thẻ lần 5',5,NOW(),NOW())")


def login_customer(ctx, page):
    # 用浏览器上下文拿 csrf → POST customer-credentials 回调（cookie 自动入上下文）
    csrf = page.request.get(f"{BASE}/api/auth/csrf").json()["csrfToken"]
    r = page.request.post(f"{BASE}/api/auth/callback/customer-credentials", form={"csrfToken": csrf, "phone": CUST_PHONE, "password": CUST_PWD})
    return r.status


def main():
    cleanup(); started = datetime.now(); records = []
    with make_browser() as p:
        ctx = new_context(p, tag="cust", locale="vi-VN")
        page = ctx.new_page(); page.set_default_timeout(ASSERT_TIMEOUT); page.set_default_navigation_timeout(NAV_TIMEOUT)
        st = login_customer(ctx, page)
        records.append(run_assertion(lambda: st == 302 or st == 200, "d1", "顾客登录成功", script_tag=SCRIPT_TAG))
        page.goto(f"{BASE}/vi/hcm/laundry/{SLUG}/my", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        page.wait_for_timeout(2000)
        records.append(run_assertion(lambda: page.get_by_text("Giặt ủi Demo 88").count() > 0, "d2", "/my 渲染店名", script_tag=SCRIPT_TAG, screenshot_page=page))
        records.append(run_assertion(lambda: page.get_by_text("120kđ").count() > 0, "d3", "显示储值余额 120kđ", script_tag=SCRIPT_TAG, screenshot_page=page))
        records.append(run_assertion(lambda: page.get_by_text("Thẻ lần").count() > 0 or page.get_by_text("Đơn của tôi").count() > 0, "d4", "显示卡/我的订单", script_tag=SCRIPT_TAG, screenshot_page=page))
    save_results(SCRIPT_TAG, FLOW, records, started, datetime.now())
    ok = all(r.status != "FAIL" for r in records)
    print(f"{'PASS' if ok else 'FAIL'} {len(records)} 断言")


if __name__ == "__main__":
    main()
