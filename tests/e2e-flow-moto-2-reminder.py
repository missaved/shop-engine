#!/usr/bin/env python3
# M3 保养提醒闭环验证：
#   到点冒泡（MOTO_SERVICE_DUE dueAt<=now）→ 卡片展示车牌/车型/下次保养 →
#   一键复制文案（clipboard）→ 唤起 zalo.me 深链 → 已处理（dismiss）
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
    _sql_quote,
)

SCRIPT_TAG = "moto-2-reminder"
FLOW = "moto 老板端：保养提醒冒泡 + 复制 + Zalo 深链"

SLUG = "demo-moto"
MOTO_PHONE = "0901122334"
MOTO_PWD = "demo1234"


def moto_shop_id():
    rows = db_exec(f'SELECT id FROM "Shop" WHERE slug=\'{SLUG}\'')
    return rows[0]["value"] if rows else None


def insert_reminder(plate: str, brand: str, model: str, phone: str, hours_ago: int, rid: str):
    """插入一条已到期的 MOTO_SERVICE_DUE 待办（orderId=NULL，独立于订单）"""
    sid = moto_shop_id()
    db_exec(
        f"""INSERT INTO "Reminder" (id, "shopId", "orderId", "templateKey", status, "dueAt", payload, "createdAt", "updatedAt")
VALUES ('{rid}', '{sid}', NULL, 'MOTO_SERVICE_DUE', 'PENDING', NOW() - INTERVAL '{hours_ago} hours',
 '{{"plate":"{plate}","brand":"{brand}","model":"{model}","ownerName":"Nguyễn Văn An","ownerPhone":"{phone}","nextServiceKm":14000,"nextServiceDue":"2027-02-27T00:00:00.000Z"}}'::jsonb,
 NOW(), NOW())"""
    )


def cleanup():
    sid = moto_shop_id()
    if sid:
        db_exec(
            f'DELETE FROM "Reminder" WHERE "shopId"={_sql_quote(sid)} AND "templateKey"=\'MOTO_SERVICE_DUE\''
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


def main():
    started = datetime.now()
    records = []
    cleanup()
    insert_reminder("59X123456", "Honda", "Wave Alpha", "0923456789", 2, "rem_moto_e2e_a")
    insert_reminder("59A678123", "Yamaha", "Sirius", "0934567890", 1, "rem_moto_e2e_b")

    with make_browser() as p:
        ctx = new_context(p, tag="moto")
        boss = login_moto_owner(ctx)

        # R1 到点冒泡：登录后待办区出现（标题 + 车牌 + 车型 + 下次保养里程）
        def r1():
            boss.reload(wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            boss.get_by_text("Nhắc bảo dưỡng").wait_for(state="visible", timeout=ACTION_TIMEOUT)
            boss.get_by_text("59X123456").first.wait_for(state="visible", timeout=ASSERT_TIMEOUT)
            boss.get_by_text("59A678123").first.wait_for(state="visible", timeout=ASSERT_TIMEOUT)
            boss.get_by_text("Honda Wave Alpha").first.wait_for(state="visible", timeout=ASSERT_TIMEOUT)
            boss.get_by_text("14.000km").first.wait_for(state="visible", timeout=ASSERT_TIMEOUT)

        records.append(
            run_assertion(r1, "moto-r1", "到点冒泡：待办区显示 2 条保养提醒", script_tag=SCRIPT_TAG, screenshot_page=boss)
        )

        # R2 一键复制 + Zalo 深链：点第一条「Gửi Zalo」→ clipboard 含车牌 + 打开 zalo.me
        # http 非 secure context 下 navigator.clipboard 为 undefined、popup 受 headless 网络限制，
        # 故注入 spy（navigator.clipboard.writeText + window.open）记录调用，断言文案与深链。
        def r2():
            boss.bring_to_front()
            boss.evaluate(
                """
                window.__copied = null
                window.__zalo = null
                try {
                  Object.defineProperty(navigator, 'clipboard', {
                    value: { writeText: (t) => { window.__copied = t; return Promise.resolve() } },
                    configurable: true,
                  })
                } catch (e) {}
                window.open = (url) => { window.__zalo = url; return null }
                """
            )
            boss.get_by_role("button", name="Gửi Zalo").first.click(timeout=ASSERT_TIMEOUT)
            # 等复制/toast + dismissReminder server action 落库
            boss.get_by_text("Đã sao chép và mở Zalo").wait_for(state="visible", timeout=ACTION_TIMEOUT)
            copied = boss.evaluate("window.__copied")
            assert copied and "59X123456" in copied, f"copied={copied!r}"
            assert copied and "Hẹn bảo dưỡng" in copied, f"copied={copied!r}"
            zalo = boss.evaluate("window.__zalo")
            assert zalo and "zalo.me" in zalo, f"zalo={zalo!r}"
            # 深链同时触发 dismissReminder：DB 应已 DISMISSED
            rows = db_exec(f'SELECT status FROM "Reminder" WHERE id=\'rem_moto_e2e_a\'')
            assert rows and rows[0]["value"] == "DISMISSED", rows

        records.append(
            run_assertion(r2, "moto-r2", "一键复制文案 + 唤起 zalo.me 深链", script_tag=SCRIPT_TAG, screenshot_page=boss)
        )

        # R3 已处理：点第二条「Đã xử lý」→ 数据库 DISMISSED
        def r3():
            boss.get_by_role("button", name="Đã xử lý").nth(1).click(timeout=ASSERT_TIMEOUT)
            boss.wait_for_timeout(800)
            rows = db_exec(
                f'SELECT status FROM "Reminder" WHERE id=\'rem_moto_e2e_b\''
            )
            assert rows and rows[0]["value"] == "DISMISSED", rows

        records.append(
            run_assertion(r3, "moto-r3", "已处理按钮 → Reminder DISMISSED", script_tag=SCRIPT_TAG, screenshot_page=boss)
        )

        # R4 DB：两条待办均已 DISMISSED（Gửi Zalo 自动标记 + 手动已处理）
        def r4():
            rows = db_exec(
                f'SELECT status FROM "Reminder" WHERE id IN (\'rem_moto_e2e_a\', \'rem_moto_e2e_b\') ORDER BY id'
            )
            assert len(rows) == 2, rows
            assert all(r["value"] == "DISMISSED" for r in rows), rows

        records.append(
            run_assertion(r4, "moto-r4", "DB：2 条待办均 DISMISSED", script_tag=SCRIPT_TAG)
        )

        # R5 无冒泡残留：reload 后待办区不再显示
        # 注：M4 起概览卡「待提醒」标签固定渲染「Nhắc bảo dưỡng」，故改断言待办卡片特有按钮
        # 「Gửi Zalo」（待办区空时整个组件 return null，无任何按钮）消失
        def r5():
            boss.reload(wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            boss.wait_for_timeout(800)
            assert boss.get_by_role("button", name="Gửi Zalo").count() == 0, "仍有冒泡待办"

        records.append(
            run_assertion(r5, "moto-r5", "处理完 reload 后无冒泡残留", script_tag=SCRIPT_TAG, screenshot_page=boss)
        )

        ctx.close()

    ended = datetime.now()
    save_results(SCRIPT_TAG, FLOW, records, started, ended)
    return 0 if all(r.status != "FAIL" for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())
