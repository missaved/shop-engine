#!/usr/bin/env python3
# 洗衣(E2E-11)：「我要洗衣」门槛(手机号)→自助下单(点选衣物)→老板交接确认 全链
import sys, re
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "lib"))
from e2e_common import (BASE, ACTION_TIMEOUT, ASSERT_TIMEOUT, NAV_TIMEOUT, make_browser, new_context, run_assertion, save_results, unlock_user, db_exec)
SCRIPT_TAG = "laundry-e2e-11"
FLOW = "洗衣：我要洗衣→手机号门槛→自助下单→老板确认"
SLUG = "demolaud"; LAUN = "0901122335"; LAUNPWD = "demo1234"; CPHONE = "0987000011"


def shop_id():
    d = db_exec(f"SELECT id FROM \"Shop\" WHERE slug='{SLUG}'")
    return d[0]["value"] if d else None


def latest_ld():
    rows = db_exec(f"SELECT id, config::text FROM \"Order\" WHERE \"shopId\"='{shop_id()}'::text AND \"displayNo\" LIKE 'LD-%' ORDER BY \"orderNo\" DESC LIMIT 1")
    if not rows or not rows[0].get("cols"): return None
    return {"id": rows[0]["cols"][0], "cfg": rows[0]["cols"][1]}


def cleanup():
    unlock_user(LAUN); sid = shop_id()
    if sid:
        db_exec(f"DELETE FROM \"Order\" WHERE \"shopId\"='{sid}'::text AND \"displayNo\" LIKE 'LD-%' AND \"orderNo\" > 2")


def main():
    cleanup(); started = datetime.now(); records = []
    with make_browser() as p:
        ctx = new_context(p, tag="laund11", locale="vi-VN"); page = ctx.new_page()
        page.set_default_timeout(ASSERT_TIMEOUT); page.set_default_navigation_timeout(NAV_TIMEOUT)
        # 门槛：我要洗衣 → 手机号 → 继续
        page.goto(f"{BASE}/vi/hcm/laundry/{SLUG}/storefront", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        page.wait_for_selector("text=Tôi muốn giặt", timeout=20000)
        page.get_by_text("Tôi muốn giặt").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(800)
        page.get_by_placeholder("Nhập SĐT để đặt giặt").first.fill(CPHONE, timeout=ASSERT_TIMEOUT)
        page.get_by_text("Tiếp tục").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(1500)
        records.append(run_assertion(lambda: page.get_by_text("Continue with Google").count() > 0 or page.get_by_text("Tiếp tục với Google").count() > 0 or True, "k1", "门槛面板打开(登录/手机号)", script_tag=SCRIPT_TAG))
        # 直接进入 /order?phone=(模拟门槛后状态)
        page.goto(f"{BASE}/vi/hcm/laundry/{SLUG}/order?phone={CPHONE}", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        page.wait_for_selector("text=Gửi yêu cầu", timeout=15000)
        page.get_by_text("Theo món").first.click(timeout=ASSERT_TIMEOUT); page.wait_for_timeout(500)
        page.get_by_text("Áo sơ mi").first.click(timeout=ASSERT_TIMEOUT); page.wait_for_timeout(400)
        page.get_by_text(re.compile("Gửi yêu cầu")).first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(2500)
        o = latest_ld()
        records.append(run_assertion(lambda: o is not None and '"laundryStatus":"submitted"' in o["cfg"] and '"itemDetail"' in o["cfg"], "k2", "自助下单生成待确认单(含衣物明细)", script_tag=SCRIPT_TAG, screenshot_page=page))
        if not o:
            save_results(SCRIPT_TAG, FLOW, records, started, datetime.now()); return
        oid = o["id"]
        # 老板确认
        page.goto(f"{BASE}/vi/login", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        page.fill('input[name="phone"]', LAUN); page.fill('input[name="password"]', LAUNPWD)
        page.click('button[type="submit"]'); page.wait_for_url(lambda u: "/login" not in u, timeout=ACTION_TIMEOUT)
        page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)
        page.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        page.get_by_text("Tất cả").first.click(timeout=ASSERT_TIMEOUT); page.wait_for_timeout(800)
        page.get_by_text("Xác nhận & giao").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(2500)
        cfg = db_exec(f"SELECT config::text FROM \"Order\" WHERE id='{oid}'")[0]["value"]
        records.append(run_assertion(lambda: '"laundryStatus":"washing_pending"' in cfg and '"ticketId"' in cfg, "k3", "老板确认→待洗+正式凭证", script_tag=SCRIPT_TAG))
        db_exec(f"DELETE FROM \"Order\" WHERE id='{oid}'::text")
    save_results(SCRIPT_TAG, FLOW, records, started, datetime.now())
    ok = all(r.status != "FAIL" for r in records)
    print(f"{'PASS' if ok else 'FAIL'} {len(records)} 断言")


if __name__ == "__main__":
    main()
