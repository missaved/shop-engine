#!/usr/bin/env python3
# 洗衣(E2E-3)：会员储值 —— 设置→会员面板→查顾客→充值→DB 断言 balance
import re, sys
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "lib"))
from e2e_common import (
    BASE, ACTION_TIMEOUT, ASSERT_TIMEOUT, NAV_TIMEOUT,
    make_browser, new_context, run_assertion, save_results, unlock_user, db_exec,
)
SCRIPT_TAG = "laundry-e2e-3"
FLOW = "洗衣：会员储值（查顾客+充值）"
SLUG = "demolaud"; LAUN_PHONE = "0901122335"; LAUN_PWD = "demo1234"
TEST_PHONE = "0987000009"; TOPUP = 50000


def shop_id():
    r = db_exec(f"SELECT id FROM \"Shop\" WHERE slug='{SLUG}'")
    return r[0]["value"] if r else None


def cust_balance():
    r = db_exec(f"SELECT balance::text FROM \"Customer\" WHERE phone='{TEST_PHONE}'")
    return int(float(r[0]["value"])) if r and r[0].get("value") else None


def cleanup():
    unlock_user(LAUN_PHONE)
    db_exec(f"DELETE FROM \"Customer\" WHERE phone='{TEST_PHONE}'")


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
        ctx = new_context(p, tag="laund3", locale="vi-VN"); page = login(ctx)
        page.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        # 进设置（⚙️ aria-label = Cài đặt）
        page.get_by_role("button", name="Cài đặt").first.click(timeout=ACTION_TIMEOUT); page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT); page.wait_for_timeout(1500); page.screenshot(path="/tmp/e3-settings.png")
        # 会员面板：手机号 → Tra cứu
        page.get_by_placeholder("SĐT khách").first.fill(TEST_PHONE, timeout=ASSERT_TIMEOUT)
        page.get_by_text("Tra cứu").first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(1500)
        # 充值：第一个 decimal 输入框 = 充值额
        page.locator('input[inputmode="decimal"]').first.fill(str(TOPUP), timeout=ASSERT_TIMEOUT)
        page.get_by_text("Nạp tiền").last.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(1500)
        bal = cust_balance()
        records.append(run_assertion(lambda: bal == TOPUP, "c1", "充值后余额=50000", script_tag=SCRIPT_TAG))
    save_results(SCRIPT_TAG, FLOW, records, started, datetime.now())
    ok = all(r.status != "FAIL" for r in records)
    print(f"{'PASS' if ok else 'FAIL'} {len(records)} 断言")


if __name__ == "__main__":
    main()
