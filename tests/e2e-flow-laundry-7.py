#!/usr/bin/env python3
# 洗衣(E2E-7)：结单链路 —— 建单 → 推进到待取 → 结单(已取) → DB 状态 COMPLETED + 提醒清
import sys, re
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "lib"))
from e2e_common import (
    BASE, ACTION_TIMEOUT, ASSERT_TIMEOUT, NAV_TIMEOUT,
    make_browser, new_context, run_assertion, save_results, unlock_user, db_exec,
)
SCRIPT_TAG = "laundry-e2e-7"
FLOW = "洗衣：结单链路(待取→已结单)"
SLUG = "demolaud"; LAUN_PHONE = "0901122335"; LAUN_PWD = "demo1234"


def shop_id():
    r = db_exec(f"SELECT id FROM \"Shop\" WHERE slug='{SLUG}'")
    return r[0]["value"] if r else None


def latest_ld():
    rows = db_exec(f"SELECT id, \"displayNo\", status FROM \"Order\" WHERE \"shopId\"='{shop_id()}'::text AND \"displayNo\" LIKE 'LD-%' ORDER BY \"orderNo\" DESC LIMIT 1")
    if not rows or not rows[0].get("cols"): return None
    c = rows[0]["cols"]; return {"id": c[0], "dn": c[1], "st": c[2]}


def cleanup():
    unlock_user(LAUN_PHONE); sid = shop_id()
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
        ctx = new_context(p, tag="laund7", locale="vi-VN"); page = login(ctx)
        page.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        page.get_by_text("Tạo đơn").first.click(timeout=ACTION_TIMEOUT); page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT); page.wait_for_timeout(1200)
        page.get_by_text("5kg").first.click(timeout=ASSERT_TIMEOUT)
        page.get_by_text(re.compile("Gửi đơn")).first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(2500)
        o = latest_ld()
        records.append(run_assertion(lambda: o is not None, "g1", "建单", script_tag=SCRIPT_TAG))
        if not o:
            save_results(SCRIPT_TAG, FLOW, records, started, datetime.now()); return
        oid = o["id"]
        page.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        page.get_by_text("Tất cả").first.click(timeout=ASSERT_TIMEOUT); page.wait_for_timeout(800)
        # 折叠卡 UI（整改 a72e760 把推进收进展开面板）：动作按钮在卡展开后才可见，先展开最新单卡（列表倒序顶卡）
        page.get_by_text("▸").first.click(timeout=ASSERT_TIMEOUT); page.wait_for_timeout(500)
        page.get_by_text("Bắt đầu giặt").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(1200)
        page.get_by_text("Gửi kiểm tra").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(1200)
        page.get_by_text("Qua kiểm tra").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(1200)
        page.get_by_text("Đã lấy").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(1800)  # 结单
        st = db_exec(f"SELECT status FROM \"Order\" WHERE id='{oid}'")[0]["value"]
        records.append(run_assertion(lambda: st == "COMPLETED", "g2", "结单后 COMPLETED", script_tag=SCRIPT_TAG))
        # g3（整改回归）：结单即清该单一切 PENDING 提醒（ready/逾期各档）——在删单前查（Reminder.orderId 随删置空）
        rem = db_exec(f"SELECT count(*) FROM \"Reminder\" WHERE \"orderId\"='{oid}'::text AND status='PENDING'")
        records.append(
            run_assertion(
                lambda: rem and int(rem[0]["value"]) == 0,
                "g3", "结单后该单 PENDING 提醒清零", script_tag=SCRIPT_TAG,
            )
        )
        db_exec(f"DELETE FROM \"Order\" WHERE id='{oid}'::text")
    save_results(SCRIPT_TAG, FLOW, records, started, datetime.now())
    ok = all(r.status != "FAIL" for r in records)
    print(f"{'PASS' if ok else 'FAIL'} {len(records)} 断言")


if __name__ == "__main__":
    main()
