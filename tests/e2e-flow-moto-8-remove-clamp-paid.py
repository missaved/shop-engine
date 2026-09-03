#!/usr/bin/env python3
# moto(E2E-8)：删服务项后 paidAmount clamp（审计七轮 P 回归）
#   定案：removeMotoItem 只改 total 不改 paidAmount → 已收全款后删项使 paidAmount>total（多收）；
#        fix = 删项时 clamp paidAmount=min(paid,newTotal)（删空归 0）。
#   手法：复用 moto-1 七步开单（换机油 150k, PENDING queued）→ DB 预置 paidAmount=150000（构造已收全款）
#        → 订单卡展开删唯一服务项 → DB 断言 total=0 且 paidAmount=0（未修则 paid 残留 150000 → FAIL）。
import re
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "lib"))
from e2e_common import (
    BASE, ACTION_TIMEOUT, ASSERT_TIMEOUT, NAV_TIMEOUT,
    make_browser, new_context, run_assertion, save_results, unlock_user, db_exec, _sql_quote,
)

SCRIPT_TAG = "moto-8-remove-clamp-paid"
FLOW = "moto 删服务项后实收 clamp（已收全款删项不多收）"
SLUG = "demo-moto"
MOTO_PHONE = "0901122334"
MOTO_PWD = "demo1234"
PLATE = "59X123456"
PRICE = "150kđ"
TOTAL = 150000


def moto_shop_id():
    rows = db_exec(f'SELECT id FROM "Shop" WHERE slug=\'{SLUG}\'')
    return rows[0]["value"] if rows else None


def q(sql: str, cols: list[str]):
    return [dict(zip(cols, r["cols"])) for r in db_exec(sql)]


def latest_mt():
    sid = moto_shop_id()
    rows = q(
        f'''SELECT "displayNo", status, total::text, "paidAmount"::text, config->>'motoProgress' AS prog
  FROM "Order" WHERE "shopId"={_sql_quote(sid)} AND "displayNo" LIKE 'MT-%'
  AND config->>'plate'='{PLATE}' ORDER BY "createdAt" DESC LIMIT 1''',
        ["displayNo", "status", "total", "paid", "prog"],
    )
    return rows[0] if rows else None


def cleanup():
    sid = moto_shop_id()
    if not sid:
        return
    db_exec(
        f'''DELETE FROM "Reminder" WHERE "orderId" IN (
  SELECT id FROM "Order" WHERE "shopId"={_sql_quote(sid)} AND "displayNo" LIKE 'MT-%');'''
    )
    db_exec(f'''DELETE FROM "Order" WHERE "shopId"={_sql_quote(sid)} AND "displayNo" LIKE 'MT-%';''')
    db_exec(
        f'''UPDATE "Vehicle" SET "lastServiceAt"=NULL,"nextServiceKm"=NULL,
  "nextServiceDue"=NULL,"lastIntervalDays"=NULL
  WHERE "shopId"={_sql_quote(sid)} AND plate='{PLATE}';'''
    )
    unlock_user(MOTO_PHONE)


def login_moto_owner(ctx):
    page = ctx.new_page()
    page.set_default_timeout(ASSERT_TIMEOUT)
    page.set_default_navigation_timeout(NAV_TIMEOUT)
    page.goto(f"{BASE}/vi/login", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.fill('input[name="phone"]', MOTO_PHONE, timeout=ASSERT_TIMEOUT)
    page.fill('input[name="password"]', MOTO_PWD, timeout=ASSERT_TIMEOUT)
    page.click('button[type="submit"]', timeout=ASSERT_TIMEOUT)
    page.wait_for_url(lambda url: "/login" not in url, timeout=ACTION_TIMEOUT)
    page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)
    return page


def open_order(boss):
    """复制 moto-1 七步开单向导（换机油 150k → queued 开工）"""
    boss.reload(wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    boss.fill('input[placeholder="VD: 59X123456"]', PLATE, timeout=ASSERT_TIMEOUT)
    boss.keyboard.press("Enter")
    boss.get_by_text("Honda Wave Alpha").first.wait_for(state="visible", timeout=ACTION_TIMEOUT)
    boss.get_by_role("button", name="Mở lệnh sửa", exact=True).click(timeout=ASSERT_TIMEOUT)
    boss.get_by_text("Chọn mẫu xe").wait_for(state="visible", timeout=ACTION_TIMEOUT)
    boss.get_by_role("button", name="Lưu", exact=True).click(timeout=ASSERT_TIMEOUT)
    boss.get_by_role("button", name="Khó đề", exact=True).click(timeout=ASSERT_TIMEOUT)
    boss.get_by_role("button", name=re.compile("Tiếp tục")).click(timeout=ASSERT_TIMEOUT)
    boss.get_by_role("button", name=re.compile("Thay nhớt máy")).click(timeout=ASSERT_TIMEOUT)
    boss.get_by_role("button", name=re.compile("Tiếp tục")).click(timeout=ASSERT_TIMEOUT)
    boss.get_by_text(PRICE).first.wait_for(state="visible", timeout=ASSERT_TIMEOUT)
    boss.locator('input[type="checkbox"]').check(timeout=ASSERT_TIMEOUT)
    boss.get_by_role("button", name=re.compile("Tiếp tục")).click(timeout=ASSERT_TIMEOUT)
    boss.get_by_role("button", name="2 giờ", exact=True).click(timeout=ASSERT_TIMEOUT)
    boss.get_by_role("button", name=re.compile("Tiếp tục")).click(timeout=ASSERT_TIMEOUT)
    boss.locator('input[inputmode="tel"]').wait_for(timeout=ASSERT_TIMEOUT)
    boss.get_by_role("button", name="Bỏ qua", exact=True).click(timeout=ASSERT_TIMEOUT)
    boss.get_by_role("button", name=re.compile("Bắt đầu")).click(timeout=ASSERT_TIMEOUT)
    # 落库以 DB 轮询为准（home 视图渲染时序不在此断言，a0 由 DB 判定）


def wait_mt(timeout_s=15):
    end = time.time() + timeout_s
    while time.time() < end:
        if latest_mt():
            return True
        time.sleep(0.4)
    return latest_mt() is not None


def remove_first_item(boss):
    """dashboard 今日列表 → 展开订单卡 → 开加删项区 → 删唯一服务项"""
    boss.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    boss.get_by_text("Lệnh hôm nay").wait_for(state="visible", timeout=ACTION_TIMEOUT)
    boss.get_by_text(PLATE).first.click(timeout=ASSERT_TIMEOUT)      # Block D 折叠行展开
    boss.get_by_role("button", name="Thêm dịch vụ").first.click(timeout=ASSERT_TIMEOUT)
    boss.get_by_role("button", name="Xóa", exact=True).first.click(timeout=ACTION_TIMEOUT)
    boss.wait_for_timeout(1800)


def main():
    started = datetime.now()
    records = []
    cleanup()
    try:
        with make_browser() as p:
            ctx = new_context(p, tag="moto8")
            boss = login_moto_owner(ctx)

            # A0 开单落库（queued / total=150000）
            open_order(boss)
            assert wait_mt(), "开单向导后未见 MT- 单落库"

            def a0():
                r = latest_mt()
                assert r, "未找到 moto 单"
                assert r["status"] == "PENDING" and r["prog"] == "queued", r
                assert int(float(r["total"])) == TOTAL, r
                assert int(float(r["paid"])) == 0, r
            records.append(run_assertion(a0, "moto-a0", "七步开单落库：PENDING queued total=150000 未收", script_tag=SCRIPT_TAG))

            # P1 预置「已收全款」（构造删项将多收场景）
            sid = moto_shop_id()
            db_exec(
                f'''UPDATE "Order" SET "paidAmount"=150000 WHERE id = (
  SELECT id FROM "Order" WHERE "shopId"={_sql_quote(sid)} AND "displayNo" LIKE 'MT-%'
  AND config->>'plate'='{PLATE}' ORDER BY "createdAt" DESC LIMIT 1);'''
            )

            def p1():
                r = latest_mt()
                assert int(float(r["paid"])) == TOTAL and int(float(r["total"])) == TOTAL, r
            records.append(run_assertion(p1, "moto-p1", "预置已收全款 paid=total=150000（多收场景就绪）", script_tag=SCRIPT_TAG))

            # P2 删唯一服务项 → clamp：total=0 & paidAmount=0（未修则 paid 残留 150000）
            remove_first_item(boss)

            def p2():
                end = time.time() + 12
                r = latest_mt()
                while time.time() < end and (not r or int(float(r["total"])) != 0):
                    time.sleep(0.4)
                    r = latest_mt()
                assert r, "订单丢失"
                assert int(float(r["total"])) == 0, f"删项未落库 total={r['total']}"
                assert int(float(r["paid"])) == 0, f"clamp 未生效，paid 残留 {r['paid']}"
            records.append(run_assertion(p2, "moto-p2", "删唯一服务项后 total=0 且 paidAmount 被 clamp 到 0（无多收）", script_tag=SCRIPT_TAG, screenshot_page=boss))
            ctx.close()
    finally:
        cleanup()
    ended = datetime.now()
    save_results(SCRIPT_TAG, FLOW, records, started, ended)
    return 0 if all(r.status != "FAIL" for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())
