#!/usr/bin/env python3
# 洗衣(E2E-14)：收款累加回归（审计三轮 F）
#   现金收部分 → 储值补足剩余 → paidAmount 应 = total（不回退、不覆盖）
#   另顺带覆盖 D：收款/储值走 assertLaundryOrder（LAUNDRY 单正常放行）
# 手法：DB 预插 Customer(phone 0907777777, balance 300k) → UI 开单填该手机号 →
#       收款面板现金输入 total//2 → 储值按钮补足剩余 → 断言 paid==total、balance 扣抵剩余
import sys, json, uuid, re
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "lib"))
from e2e_common import (
    BASE, ACTION_TIMEOUT, ASSERT_TIMEOUT, NAV_TIMEOUT,
    make_browser, new_context, run_assertion, save_results, unlock_user, db_exec,
)

SCRIPT_TAG = "laundry-e2e-14-settle-accrue"
FLOW = "洗衣：收款累加（现金部分→储值补足，paid 不回退）"
SLUG = "demolaud"
LAUN_PHONE, LAUN_PWD = "0901122335", "demo1234"
CUS_PHONE = "0907777777"
BAL_INIT = 300000


def shop_id():
    r = db_exec(f"SELECT id FROM \"Shop\" WHERE slug='{SLUG}'")
    return r[0]["value"] if r else None


def latest_cus_order():
    r = db_exec(
        f"SELECT id, \"displayNo\", total::text, \"paidAmount\"::text FROM \"Order\" "
        f"WHERE \"shopId\"='{shop_id()}'::text AND \"customerPhone\"='{CUS_PHONE}' ORDER BY \"createdAt\" DESC LIMIT 1"
    )
    if not r or not r[0].get("cols"): return None
    c = r[0]["cols"]
    return {"id": c[0], "dn": c[1], "total": int(float(c[2])), "paid": int(float(c[3]))}


def cleanup():
    unlock_user(LAUN_PHONE); sid = shop_id()
    if not sid: return
    db_exec(f"DELETE FROM \"Order\" WHERE \"shopId\"='{sid}'::text AND \"customerPhone\"='{CUS_PHONE}'")
    db_exec(f"DELETE FROM \"Customer\" WHERE phone='{CUS_PHONE}'")


def login(ctx):
    page = ctx.new_page(); page.set_default_timeout(ASSERT_TIMEOUT); page.set_default_navigation_timeout(NAV_TIMEOUT)
    page.goto(f"{BASE}/vi/login", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.fill('input[name="phone"]', LAUN_PHONE); page.fill('input[name="password"]', LAUN_PWD)
    page.click('button[type="submit"]'); page.wait_for_url(lambda u: "/login" not in u, timeout=ACTION_TIMEOUT)
    page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)
    return page


def main():
    cleanup(); started = datetime.now(); records = []
    sid = shop_id()
    if not sid:
        print("缺 demolaud 店"); return 1
    cid = str(uuid.uuid4())
    db_exec(
        f"""INSERT INTO "Customer" (id, phone, name, balance, provider, "createdAt", "updatedAt") VALUES
        ('{cid}', '{CUS_PHONE}', 'Pay Accrue Test', {BAL_INIT}, 'password', NOW(), NOW())"""
    )
    with make_browser() as p:
        ctx = new_context(p, tag="laund14", locale="vi-VN")
        page = login(ctx)
        # 建单（填测试顾客手机号）
        page.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        page.get_by_text("Tạo đơn").first.click(timeout=ACTION_TIMEOUT)
        page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT); page.wait_for_timeout(1200)
        page.get_by_text("5kg").first.click(timeout=ASSERT_TIMEOUT)
        page.fill('input[name="customerPhone"]', CUS_PHONE, timeout=ASSERT_TIMEOUT)
        page.get_by_text(re.compile("Gửi đơn")).first.click(timeout=ACTION_TIMEOUT); page.wait_for_timeout(2500)
        o = latest_cus_order()
        records.append(run_assertion(lambda: o is not None, "g1", "建单带顾客手机号落库", script_tag=SCRIPT_TAG))
        if not o:
            save_results(SCRIPT_TAG, FLOW, records, started, datetime.now()); cleanup(); return
        oid, total = o["id"], o["total"]
        assert total > 0, f"total 应 >0, 实际 {total}"
        half = total // 2

        # 回列表：展开顶卡（折叠 UI）→ 收款面板
        page.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        page.get_by_text("Tất cả").first.click(timeout=ASSERT_TIMEOUT); page.wait_for_timeout(800)
        page.get_by_text("▸").first.click(timeout=ASSERT_TIMEOUT); page.wait_for_timeout(500)
        # 打开收款面板（toggle「Thu tiền」，此刻唯一）
        page.get_by_text("Thu tiền", exact=True).first.click(timeout=ASSERT_TIMEOUT); page.wait_for_timeout(800)

        # ① 现金收一半（改输入为 half → 确认）
        page.locator('input[inputmode="decimal"]').first.fill(str(half), timeout=ASSERT_TIMEOUT)
        # toggle 现在变 '× Thu tiền'，exact 'Thu tiền' 命中确认按钮
        page.get_by_text("Thu tiền", exact=True).click(timeout=ASSERT_TIMEOUT); page.wait_for_timeout(1500)

        def cash_half():
            cur = latest_cus_order()
            assert cur and cur["paid"] == half, f"现金半额后 paid 应={half}, 实际={cur}"
        records.append(run_assertion(cash_half, "g2", "现金收半额 → paid=half", script_tag=SCRIPT_TAG))

        # ② 储值补足剩余（按钮传 total-paid；须顾客存在余额足）
        def balance_btn():
            b = page.get_by_text("Trừ số dư")
            if b.count() == 0:  # settle 后列表刷新可能收起面板 → 重开
                page.get_by_text("Thu tiền", exact=True).first.click(timeout=ASSERT_TIMEOUT)
                page.wait_for_timeout(800)
            b.first.click(timeout=ASSERT_TIMEOUT)
            page.wait_for_timeout(1800)
        records.append(run_assertion(balance_btn, "g3", "储值补足剩余触发成功", script_tag=SCRIPT_TAG, screenshot_page=page))

        def accrued():
            cur = latest_cus_order()
            bal = db_exec(f"SELECT balance::text FROM \"Customer\" WHERE phone='{CUS_PHONE}'")[0]["value"]
            bal_n = int(float(bal))
            debt = total - half
            assert cur and cur["paid"] == total, f"累加后 paid 应=total({total}), 实际={cur}"
            assert bal_n == BAL_INIT - debt, f"余额应扣 {debt}(={BAL_INIT-debt}), 实际={bal_n}"
        records.append(run_assertion(accrued, "g4", "paid=total 不回退 & 余额扣抵剩余", script_tag=SCRIPT_TAG))

        ctx.close()
    cleanup()
    ended = datetime.now()
    save_results(SCRIPT_TAG, FLOW, records, started, ended)
    return 0 if all(r.status != "FAIL" for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())
