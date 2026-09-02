#!/usr/bin/env python3
# 洗衣(E2E-10)：顾客自助下单(待确认) → 老板交接确认(出具凭证转待洗)
import sys, re
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "lib"))
from e2e_common import (BASE, ACTION_TIMEOUT, ASSERT_TIMEOUT, NAV_TIMEOUT, make_browser, new_context, run_assertion, save_results, unlock_user, db_exec)
SCRIPT_TAG = "laundry-e2e-10"
FLOW = "洗衣：顾客自助下单→老板交接确认"
SLUG = "demolaud"; LAUN = "0901122335"; LAUNPWD = "demo1234"; CPHONE = "0987000011"


def shop_id():
    r = db_exec(f"SELECT id FROM \"Shop\" WHERE slug='{SLUG}'")
    return r[0]["value"] if r else None


def latest_ld():
    rows = db_exec(f"SELECT id, \"displayNo\", status, config::text FROM \"Order\" WHERE \"shopId\"='{shop_id()}'::text AND \"displayNo\" LIKE 'LD-%' ORDER BY \"orderNo\" DESC LIMIT 1")
    if not rows or not rows[0].get("cols"): return None
    c = rows[0]["cols"]; return {"id": c[0], "dn": c[1], "st": c[2], "cfg": c[3]}


def cleanup():
    unlock_user(LAUN); sid = shop_id()
    if sid:
        db_exec(f"DELETE FROM \"Order\" WHERE \"shopId\"='{sid}'::text AND \"displayNo\" LIKE 'LD-%' AND \"orderNo\" > 2")


def login(phone, pwd, page, base):
    page.goto(f"{base}/vi/login", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.fill('input[name="phone"]', phone); page.fill('input[name="password"]', pwd)
    page.click('button[type="submit"]'); page.wait_for_url(lambda u: "/login" not in u, timeout=ACTION_TIMEOUT)
    page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)


def main():
    cleanup(); started = datetime.now(); records = []
    with make_browser() as p:
        ctx = new_context(p, tag="laund10", locale="vi-VN"); page = ctx.new_page(); page.set_default_timeout(ASSERT_TIMEOUT); page.set_default_navigation_timeout(NAV_TIMEOUT)
        # 顾客自助下单
        page.goto(f"{BASE}/vi/hcm/laundry/{SLUG}/order", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        page.wait_for_selector("text=Gửi yêu cầu", timeout=20000)
        page.get_by_placeholder("SĐT khách").first.fill(CPHONE, timeout=ASSERT_TIMEOUT)
        page.get_by_text(re.compile("Gửi yêu cầu")).first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(2500)
        o = latest_ld()
        records.append(run_assertion(lambda: o is not None and '"laundryStatus":"submitted"' in o["cfg"], "j1", "顾客提交生成待确认单", script_tag=SCRIPT_TAG, screenshot_page=page))
        if not o:
            save_results(SCRIPT_TAG, FLOW, records, started, datetime.now()); return
        oid = o["id"]
        # 老板登录 → 待确认单 → 确认交接
        login(LAUN, LAUNPWD, page, BASE)
        page.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        page.get_by_text("Tất cả").first.click(timeout=ASSERT_TIMEOUT); page.wait_for_timeout(800)
        page.wait_for_selector("text=Xác nhận & giao", timeout=25000)
        page.get_by_text("Xác nhận & giao").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(2500)
        st = db_exec(f"SELECT status, config::text FROM \"Order\" WHERE id='{oid}'")
        cfg = st[0]["cols"][1]; status = st[0]["cols"][0]
        records.append(run_assertion(lambda: '"laundryStatus":"washing_pending"' in cfg, "j2", "交接后转待洗", script_tag=SCRIPT_TAG))
        records.append(run_assertion(lambda: '"ticketId"' in cfg, "j3", "出具正式凭证 ticketId", script_tag=SCRIPT_TAG))
        db_exec(f"DELETE FROM \"Order\" WHERE id='{oid}'::text")
    save_results(SCRIPT_TAG, FLOW, records, started, datetime.now())
    ok = all(r.status != "FAIL" for r in records)
    print(f"{'PASS' if ok else 'FAIL'} {len(records)} 断言")


if __name__ == "__main__":
    main()
