#!/usr/bin/env python3
# 洗衣(LAUNDRY)核心 E2E：老板登录 → 三模式开单(kg) → 质检/再洗 → 待取 → 凭证页
# 断言以 DB 校验为辅(更稳) + 关键 UI 文案为证。
import re, sys
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "lib"))
from e2e_common import (
    BASE, ACTION_TIMEOUT, ASSERT_TIMEOUT, NAV_TIMEOUT,
    make_browser, new_context, run_assertion, save_results, unlock_user, db_exec,
)

SCRIPT_TAG = "laundry-e2e"
FLOW = "洗衣老板端：登录→开单→质检→再洗→待取→凭证"
SLUG = "demolaud"
LAUN_PHONE = "0901122335"
LAUN_PWD = "demo1234"
RECORDS = []


def shop_id():
    rows = db_exec(f"SELECT id FROM \"Shop\" WHERE slug='{SLUG}'")
    return rows[0]["value"] if rows else None


def latest_ld_order():
    rows = db_exec(
        f"SELECT id, \"displayNo\", status, config::text FROM \"Order\" WHERE \"shopId\"='{shop_id()}'::text AND \"displayNo\" LIKE 'LD-%' ORDER BY \"orderNo\" DESC LIMIT 1"
    )
    if not rows or not rows[0].get("cols"):
        return None
    c = rows[0]["cols"]
    return {"id": c[0], "dn": c[1], "st": c[2], "cfg": c[3]}


def login(ctx):
    page = ctx.new_page()
    page.set_default_timeout(ASSERT_TIMEOUT); page.set_default_navigation_timeout(NAV_TIMEOUT)
    page.goto(f"{BASE}/vi/login", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.fill('input[name="phone"]', LAUN_PHONE, timeout=ASSERT_TIMEOUT)
    page.fill('input[name="password"]', LAUN_PWD, timeout=ASSERT_TIMEOUT)
    page.click('button[type="submit"]', timeout=ASSERT_TIMEOUT)
    page.wait_for_url(lambda u: "/login" not in u, timeout=ACTION_TIMEOUT)
    page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)
    return page


def cleanup():
    unlock_user(LAUN_PHONE)
    sid = shop_id()
    if sid:
        # 仅保留 seed 的 LD-260901-001/002（orderNo<=2），清掉历次 E2E 创建的单（orderNo>2）
        db_exec(f"DELETE FROM \"Order\" WHERE \"shopId\"='{sid}'::text AND \"displayNo\" LIKE 'LD-%' AND \"orderNo\" > 2")


def main():
    cleanup()
    started = datetime.now()
    records = []
    with make_browser() as p:
        ctx = new_context(p, tag="laund", locale="vi-VN")
        page = login(ctx)
        page.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        records.append(run_assertion(lambda: page.get_by_text("Giặt ủi Demo 88").count() > 0, "a1", "dashboard 含店名", script_tag=SCRIPT_TAG, screenshot_page=page))
        # 开单：+ 开单 → 5kg → 提交
        page.get_by_text("Tạo đơn").first.click(timeout=ACTION_TIMEOUT)
        page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)
        page.wait_for_timeout(1200)
        page.screenshot(path="/tmp/laund-order-view.png")
        page.get_by_text("5kg").first.click(timeout=ASSERT_TIMEOUT)
        page.screenshot(path="/tmp/laund-before-submit.png")
        page.get_by_text(re.compile("Gửi đơn")).first.click(timeout=ACTION_TIMEOUT)
        page.wait_for_timeout(2500)
        page.screenshot(path="/tmp/laund-after-submit.png")
        rows = latest_ld_order()
        records.append(run_assertion(lambda: latest_ld_order() is not None, "a2", "新增 LD 订单落库", script_tag=SCRIPT_TAG))
        if not rows:
            save_results(SCRIPT_TAG, FLOW, records, started, datetime.now()); return
        oid = rows["id"]
        # 质检流：先切「全部」tab（新单是待洗态）
        page.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        page.get_by_text("Tất cả").first.click(timeout=ASSERT_TIMEOUT); page.wait_for_timeout(1500)
        page.screenshot(path="/tmp/laund-advance.png", full_page=False)
        page.get_by_text("Bắt đầu giặt").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(1200)
        page.get_by_text("Gửi kiểm tra").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(1200)
        page.get_by_text("Qua kiểm tra").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(1200)
        records.append(run_assertion(lambda: db_exec(f"SELECT status FROM \"Order\" WHERE id='{oid}'")[0]["value"] == "READY", "a3", "推进到待取(READY)", script_tag=SCRIPT_TAG))
        # 凭证页 200 + 含取件码
        cfg = db_exec(f"SELECT config::text FROM \"Order\" WHERE id='{oid}'")[0]["value"]
        tid = re.search(r'"ticketId":"([^"]+)"', cfg)
        records.append(run_assertion(lambda: tid is not None, "a4", "生成 ticketId", script_tag=SCRIPT_TAG))
        if tid:
            page.goto(f"{BASE}/vi/hcm/laundry/{SLUG}/ticket/{tid.group(1)}", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            records.append(run_assertion(lambda: page.get_by_text("Mã phiếu").count() > 0, "a5", "凭证页渲染取件码", script_tag=SCRIPT_TAG, screenshot_page=page))
    save_results(SCRIPT_TAG, FLOW, records, started, datetime.now())
    ok = all(r.status != "FAIL" for r in records)
    print(f"{'PASS' if ok else 'FAIL'} {len(records)} 断言")


if __name__ == "__main__":
    main()
