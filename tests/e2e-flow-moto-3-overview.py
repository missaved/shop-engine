#!/usr/bin/env python3
# M4 概览卡 + 流水视图 + 车牌筛选 闭环验证：
#   概览 4 卡（今日实收/待取/待提醒/欠款）→ 流水按日收入/欠款/收回分组 → 订单列表车牌筛选
# 数据直插 DB 构造：今日已付单 + 待取单 + 欠款单 + 昨日单 + 到期待办
import re
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "lib"))
from e2e_common import (
    BASE,
    ACTION_TIMEOUT,
    ASSERT_TIMEOUT,
    NAV_TIMEOUT,
    make_browser,
    new_context,
    run_assertion,
    save_results,
    unlock_user,
    db_exec,
)

SCRIPT_TAG = "moto-3-overview"
FLOW = "moto 老板端：抽屉收支卡 + 流水 + 车牌筛选（F-m 后概览卡入抽屉）"

SLUG = "demo-moto"
MOTO_PHONE = "0901122334"
MOTO_PWD = "demo1234"

# 测试订单（displayNo 前缀 MT-T-）与待办（m4rem_）
PAID_DN = "MT-T-111"      # 今日已付 200k
WAIT_DN = "MT-T-222"      # 今日待取 300k（已付，不产生欠款）
DEBT_DN = "MT-T-333"      # 今日欠款 150k（未付）
YDAY_DN = "MT-T-444"      # 昨日已付 100k（不计入今日）
PLATES = {
    PAID_DN: "59X111111",
    WAIT_DN: "59X222222",
    DEBT_DN: "59X333333",
    YDAY_DN: "59X444444",
}


def moto_shop_id():
    rows = db_exec(f'SELECT id FROM "Shop" WHERE slug=\'{SLUG}\'')
    return rows[0]["value"] if rows else None


def next_order_no(sid: str) -> int:
    rows = db_exec(f'SELECT COALESCE(MAX("orderNo"),0)+1 AS n FROM "Order" WHERE "shopId"=\'{sid}\'')
    return int(rows[0]["value"])


def insert_order(display_no: str, total: int, paid: int, progress: str, status: str, created: str):
    sid = moto_shop_id()
    cfg = f'{{"plate":"{PLATES[display_no]}","motoProgress":"{progress}"}}'
    db_exec(
        f"""INSERT INTO "Order" (id, "orderNo", "displayNo", "shopId", status, items, total, "paidAmount", config, "createdAt", "updatedAt")
VALUES ('m4_{display_no}', {next_order_no(sid)}, '{display_no}', '{sid}', '{status}', '[]'::jsonb, {total}, {paid}, '{cfg}'::jsonb, {created}, NOW())"""
    )


def insert_reminder(rid: str):
    sid = moto_shop_id()
    db_exec(
        f"""INSERT INTO "Reminder" (id, "shopId", "orderId", "templateKey", status, "dueAt", payload, "createdAt", "updatedAt")
VALUES ('{rid}', '{sid}', NULL, 'MOTO_SERVICE_DUE', 'PENDING', NOW() - INTERVAL '2 hours',
 '{{"plate":"59X111111","ownerName":"Nguyễn Văn A","nextServiceKm":14000,"nextServiceDue":"2027-02-27T00:00:00.000Z"}}'::jsonb,
 NOW(), NOW())"""
    )


def cleanup():
    sid = moto_shop_id()
    if sid:
        # 测试店全清（M2/M3 残留 COMPLETED 未收款单会干扰统计）
        db_exec(
            f'DELETE FROM "Reminder" WHERE "shopId"=\'{sid}\' AND "templateKey"=\'MOTO_SERVICE_DUE\''
        )
        db_exec(f'DELETE FROM "Order" WHERE "shopId"=\'{sid}\'')
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


def stats_card(page, label: str):
    """概览卡的父容器（label + value 的 card div）—— F-m 后概览 4卡已随 MotoStats 移除，仅历史参考"""
    return page.get_by_text(label).first.locator("xpath=..")


def open_drawer(page):
    """F-m 决策⑤⑥：统计/流水收进 ☰ 抽屉 —— 点 ☰ 店名 trigger 开抽屉"""
    page.get_by_text("☰").first.click(timeout=ASSERT_TIMEOUT)
    page.wait_for_timeout(700)


def main():
    started = datetime.now()
    records = []
    cleanup()
    # 今日 3 单（已付/待取/欠款）+ 昨日 1 单 + 到期待办 1 条
    insert_order(PAID_DN, 200000, 200000, "picked_up", "COMPLETED", "NOW()")
    insert_order(WAIT_DN, 300000, 300000, "waiting_pickup", "READY", "NOW()")
    insert_order(DEBT_DN, 150000, 0, "repairing", "IN_PROGRESS", "NOW()")
    insert_order(YDAY_DN, 100000, 100000, "picked_up", "COMPLETED", "NOW() - INTERVAL '26 hours'")
    insert_reminder("m4rem_a")

    with make_browser() as p:
        ctx = new_context(p, tag="moto")
        boss = login_moto_owner(ctx)

        # R1 抽屉收支卡（F-m 决策⑤⑥：概览 4卡已随 MotoStats 移出主页）
        #   抽屉 MotoRevenueCard(Doanh thu) 今日收入 = 500kđ（200k+300k 已付单）；待取/待提醒/欠款数字卡已移除，
        #   待取由 r2 车牌筛选、欠款由 r4 流水欠款 tab、待提醒由 MotoReminderList(主页仍留) 覆盖。
        def r1():
            boss.reload(wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            open_drawer(boss)
            boss.get_by_text("Doanh thu").first.wait_for(state="visible", timeout=ACTION_TIMEOUT)
            boss.get_by_text("500kđ").first.wait_for(state="visible", timeout=ASSERT_TIMEOUT)

        records.append(
            run_assertion(r1, "moto-r1", "抽屉收支卡：今日收入 500kđ（实收）", script_tag=SCRIPT_TAG, screenshot_page=boss)
        )

        # R2 订单列表车牌筛选：输入 59X111111 只剩 1 条；清空恢复
        def r2():
            boss.reload(wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            sec = boss.locator("section").filter(has_text="Lệnh hôm nay")
            sec.get_by_placeholder("VD: 59X123456").wait_for(state="visible", timeout=ACTION_TIMEOUT)
            sec.get_by_placeholder("VD: 59X123456").fill("59X111111")
            boss.wait_for_timeout(500)
            assert sec.get_by_text("59X111111").count() >= 1, "筛选后丢失匹配单"
            assert sec.get_by_text("59X222222").count() == 0, "筛选后混入不匹配单"
            sec.get_by_placeholder("VD: 59X123456").fill("")
            boss.wait_for_timeout(500)
            assert sec.get_by_text("59X222222").count() >= 1, "清空后未恢复"

        records.append(
            run_assertion(r2, "moto-r2", "订单列表车牌筛选 + 清空恢复", script_tag=SCRIPT_TAG, screenshot_page=boss)
        )

        # R3 流水收入：今日 income = 500kđ（F-m 后 MotoLedger 在 ☰ 抽屉，先开抽屉）
        def r3():
            boss.reload(wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            open_drawer(boss)
            ledger = boss.locator("section").filter(has_text="Sổ thu")
            ledger.get_by_text("500kđ").wait_for(state="visible", timeout=ACTION_TIMEOUT)
            assert ledger.get_by_text("500kđ").count() >= 1, "流水收入 != 500kđ"

        records.append(
            run_assertion(r3, "moto-r3", "流水视图：今日收入 500kđ", script_tag=SCRIPT_TAG, screenshot_page=boss)
        )

        # R4 流水欠款 tab：只有欠款单 59X333333（先开抽屉操作 MotoLedger）
        def r4():
            boss.reload(wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            open_drawer(boss)
            ledger = boss.locator("section").filter(has_text="Sổ thu")
            ledger.get_by_text("500kđ").wait_for(state="visible", timeout=ACTION_TIMEOUT)
            ledger.get_by_role("button", name=re.compile("Còn nợ")).click(timeout=ASSERT_TIMEOUT)
            ledger.get_by_text("59X333333").wait_for(state="visible", timeout=ACTION_TIMEOUT)
            assert ledger.get_by_text("59X111111").count() == 0, "欠款 tab 混入已结清单"

        records.append(
            run_assertion(r4, "moto-r4", "流水欠款 tab：仅欠款单", script_tag=SCRIPT_TAG, screenshot_page=boss)
        )

        # R5 流水收回 tab：已结清单 59X111111 + 59X222222，无欠款单（先开抽屉操作 MotoLedger）
        def r5():
            boss.reload(wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            open_drawer(boss)
            ledger = boss.locator("section").filter(has_text="Sổ thu")
            ledger.get_by_text("500kđ").wait_for(state="visible", timeout=ACTION_TIMEOUT)
            ledger.get_by_role("button", name=re.compile("Đã thu")).click(timeout=ASSERT_TIMEOUT)
            ledger.get_by_text("59X111111").wait_for(state="visible", timeout=ACTION_TIMEOUT)
            assert ledger.get_by_text("59X222222").count() >= 1, "收回 tab 缺已结清单 2"
            assert ledger.get_by_text("59X333333").count() == 0, "收回 tab 混入欠款单"

        records.append(
            run_assertion(r5, "moto-r5", "流水收回 tab：已结清列表", script_tag=SCRIPT_TAG, screenshot_page=boss)
        )

        ctx.close()

    ended = datetime.now()
    save_results(SCRIPT_TAG, FLOW, records, started, ended)
    return 0 if all(r.status != "FAIL" for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())
