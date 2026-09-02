#!/usr/bin/env python3
# 洗衣(E2E-6)：落地页匿名查单 —— 老板建单(带顾客号) → 顾客在 storefront 输 手机号+取件码 → 看到进度
import re, sys
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "lib"))
from e2e_common import (
    BASE, ACTION_TIMEOUT, ASSERT_TIMEOUT, NAV_TIMEOUT,
    make_browser, new_context, run_assertion, save_results, unlock_user, db_exec,
)
SCRIPT_TAG = "laundry-e2e-6"
FLOW = "洗衣：落地页匿名查单"
SLUG = "demolaud"; LAUN_PHONE = "0901122335"; LAUN_PWD = "demo1234"; CPHONE = "0987000011"


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
        ctx = new_context(p, tag="laund6", locale="vi-VN"); page = login(ctx)
        page.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        # 建单(顾客号) —— 需要取件码做匿名查单
        page.get_by_text("Tạo đơn").first.click(timeout=ACTION_TIMEOUT); page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT); page.wait_for_timeout(1200)
        page.get_by_text("5kg").first.click(timeout=ASSERT_TIMEOUT)
        page.get_by_placeholder("SĐT khách").first.fill(CPHONE, timeout=ASSERT_TIMEOUT)
        page.get_by_text(re.compile("Gửi đơn")).first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(2500)
        o = latest_ld()
        records.append(run_assertion(lambda: o is not None, "f1", "建单(含顾客号+取件码)", script_tag=SCRIPT_TAG))
        if not o:
            save_results(SCRIPT_TAG, FLOW, records, started, datetime.now()); return
        tag = re.search(r'"tagCode"\s*:\s*"([^"]+)"', o["cfg"]).group(1)
        # 匿名查单：落地页输手机号+取件码
        page.goto(f"{BASE}/vi/hcm/laundry/{SLUG}/storefront", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        page.get_by_placeholder("SĐT khách").first.fill(CPHONE, timeout=ASSERT_TIMEOUT)
        page.get_by_placeholder("Mã phiếu").first.fill(tag, timeout=ASSERT_TIMEOUT)
        page.get_by_text("Tra cứu").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(2000)
        records.append(run_assertion(lambda: page.get_by_text(o["dn"]).count() > 0, "f2", "匿名查单显示单号", script_tag=SCRIPT_TAG, screenshot_page=page))
        records.append(run_assertion(lambda: page.get_by_text("Chờ giặt").count() > 0 or page.get_by_text("Đang giặt").count() > 0, "f3", "查单显示进度", script_tag=SCRIPT_TAG))
        # 清理
        db_exec(f"DELETE FROM \"Order\" WHERE id='{o['id']}'::text")
    save_results(SCRIPT_TAG, FLOW, records, started, datetime.now())
    ok = all(r.status != "FAIL" for r in records)
    print(f"{'PASS' if ok else 'FAIL'} {len(records)} 断言")


if __name__ == "__main__":
    main()
