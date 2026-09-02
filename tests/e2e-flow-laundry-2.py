#!/usr/bin/env python3
# 洗衣(E2E-2)：取送配送 —— 开单选「送到家(Giao tận nhà)」+ 地址 → DB 断言 config.dispatchType/address
import re, sys
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "lib"))
from e2e_common import (
    BASE, ACTION_TIMEOUT, ASSERT_TIMEOUT, NAV_TIMEOUT,
    make_browser, new_context, run_assertion, save_results, unlock_user, db_exec,
)
SCRIPT_TAG = "laundry-e2e-2"
FLOW = "洗衣：取送配送（送到家+地址）"
SLUG = "demolaud"; LAUN_PHONE = "0901122335"; LAUN_PWD = "demo1234"


def shop_id():
    r = db_exec(f"SELECT id FROM \"Shop\" WHERE slug='{SLUG}'")
    return r[0]["value"] if r else None


def latest_ld():
    rows = db_exec(f"SELECT id, \"displayNo\", config::text FROM \"Order\" WHERE \"shopId\"='{shop_id()}'::text AND \"displayNo\" LIKE 'LD-%' ORDER BY \"orderNo\" DESC LIMIT 1")
    if not rows or not rows[0].get("cols"): return None
    c = rows[0]["cols"]; return {"id": c[0], "dn": c[1], "cfg": c[2]}


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
        ctx = new_context(p, tag="laund2", locale="vi-VN"); page = login(ctx)
        page.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        page.get_by_text("Tạo đơn").first.click(timeout=ACTION_TIMEOUT); page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT); page.wait_for_timeout(1000)
        # 选「Giao tận nhà」+ 填地址
        page.get_by_text("Giao tận nhà").first.click(timeout=ASSERT_TIMEOUT); page.wait_for_timeout(500)
        page.get_by_placeholder("Địa chỉ").first.fill("12 Nguyễn Trãi, Q5", timeout=ASSERT_TIMEOUT)
        page.get_by_text(re.compile("Gửi đơn")).first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(2500)
        o = latest_ld()
        records.append(run_assertion(lambda: o is not None, "b1", "取送单落库", script_tag=SCRIPT_TAG))
        if o:
            rec = run_assertion(lambda: '"dispatchType":"deliver"' in (latest_ld() or {}).get("cfg", "") and "Nguyễn Trãi" in (latest_ld() or {}).get("cfg", ""), "b2", "config 含 deliver + 地址", script_tag=SCRIPT_TAG)
            records.append(rec)
    save_results(SCRIPT_TAG, FLOW, records, started, datetime.now())
    ok = all(r.status != "FAIL" for r in records)
    print(f"{'PASS' if ok else 'FAIL'} {len(records)} 断言")


if __name__ == "__main__":
    main()
