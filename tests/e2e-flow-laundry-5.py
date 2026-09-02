#!/usr/bin/env python3
# 洗衣(E2E-5 找毛病)：完整闭环 —— 建单(item, 填顾客号) → 推进到待取 → 扣储值结账 → 记理赔 → DB 核验
import re, sys
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "lib"))
from e2e_common import (
    BASE, ACTION_TIMEOUT, ASSERT_TIMEOUT, NAV_TIMEOUT,
    make_browser, new_context, run_assertion, save_results, unlock_user, db_exec,
)
SCRIPT_TAG = "laundry-e2e-5"
FLOW = "洗衣：完整闭环(建单+扣储值+理赔)"
SLUG = "demolaud"; LAUN_PHONE = "0901122335"; LAUN_PWD = "demo1234"
CUST_PHONE = "0987000011"   # 预置余额 120000 的顾客


def shop_id():
    r = db_exec(f"SELECT id FROM \"Shop\" WHERE slug='{SLUG}'")
    return r[0]["value"] if r else None


def latest_ld():
    rows = db_exec(f"SELECT id, \"displayNo\", \"customerPhone\", status, config::text, \"paidAmount\"::text, total::text FROM \"Order\" WHERE \"shopId\"='{shop_id()}'::text AND \"displayNo\" LIKE 'LD-%' ORDER BY \"orderNo\" DESC LIMIT 1")
    if not rows or not rows[0].get("cols"): return None
    c = rows[0]["cols"]; return {"id": c[0], "dn": c[1], "phone": c[2], "status": c[3], "cfg": c[4], "paid": c[5], "total": c[6]}


def cust_bal():
    r = db_exec(f"SELECT balance::text FROM \"Customer\" WHERE phone='{CUST_PHONE}'")
    return int(float(r[0]["value"])) if r and r[0].get("value") else None


def cleanup():
    unlock_user(LAUN_PHONE)
    sid = shop_id()
    if sid:
        db_exec(f"DELETE FROM \"Order\" WHERE \"shopId\"='{sid}'::text AND \"displayNo\" LIKE 'LD-%' AND \"orderNo\" > 2")


def login(ctx):
    page = ctx.new_page(); page.set_default_timeout(ASSERT_TIMEOUT); page.set_default_navigation_timeout(NAV_TIMEOUT)
    page.goto(f"{BASE}/vi/login", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.fill('input[name="phone"]', LAUN_PHONE); page.fill('input[name="password"]', LAUN_PWD)
    page.click('button[type="submit"]'); page.wait_for_url(lambda u: "/login" not in u, timeout=ACTION_TIMEOUT)
    page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)
    return page


def main():
    cleanup(); started = datetime.now(); records = []
    with make_browser() as p:
        ctx = new_context(p, tag="laund5", locale="vi-VN"); page = login(ctx)
        page.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        page.get_by_text("Tạo đơn").first.click(timeout=ACTION_TIMEOUT); page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT); page.wait_for_timeout(1000)
        # 公斤模式（默认，无需选件）：点 5kg
        page.get_by_text("5kg").first.click(timeout=ASSERT_TIMEOUT); page.wait_for_timeout(400)
        # 填顾客号（使扣储值可用）
        page.get_by_placeholder("SĐT khách").first.fill(CUST_PHONE, timeout=ASSERT_TIMEOUT)
        page.get_by_text(re.compile("Gửi đơn")).first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(2500)
        o = latest_ld()
        records.append(run_assertion(lambda: o is not None and o["phone"] == CUST_PHONE, "e1", "建单(带顾客号)落库", script_tag=SCRIPT_TAG))
        if not o:
            save_results(SCRIPT_TAG, FLOW, records, started, datetime.now()); return
        oid = o["id"]
        # 推进：全部 tab → 开始洗涤 → 质检 → 通过 → 待取
        page.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        page.get_by_text("Tất cả").first.click(timeout=ASSERT_TIMEOUT); page.wait_for_timeout(800)
        page.get_by_text("Bắt đầu giặt").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(1200)
        page.get_by_text("Gửi kiểm tra").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(1200)
        page.get_by_text("Qua kiểm tra").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(1200)
        # 扣储值结账
        before = cust_bal()
        page.get_by_text("Thu tiền").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(800)
        page.get_by_text("Trừ số dư").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(1800)
        after = cust_bal()
        records.append(run_assertion(lambda: after is not None and before is not None and after < before, "e2", "扣储值后余额减少", script_tag=SCRIPT_TAG))
        pay = db_exec(f"SELECT \"paidAmount\"::text FROM \"Order\" WHERE id='{oid}'")[0]["value"]
        records.append(run_assertion(lambda: pay != None and float(pay) > 0, "e3", "订单已部分/全额收款", script_tag=SCRIPT_TAG))
        # 记理赔
        page.get_by_text("Ghi bồi thường").first.click(timeout=ACTION_TIMEOUT)
        page.on("dialog", lambda d: d.accept()) if False else None  # confirm 由 JS 处理，Playwright auto-accept
        page.wait_for_timeout(1500)
        cfg = db_exec(f"SELECT config::text FROM \"Order\" WHERE id='{oid}'")[0]["value"]
        records.append(run_assertion(lambda: '"type":"damage"' in cfg, "e4", "记录理赔(claim.damage)", script_tag=SCRIPT_TAG))
    save_results(SCRIPT_TAG, FLOW, records, started, datetime.now())
    ok = all(r.status != "FAIL" for r in records)
    print(f"{'PASS' if ok else 'FAIL'} {len(records)} 断言")


if __name__ == "__main__":
    main()
