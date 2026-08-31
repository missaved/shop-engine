#!/usr/bin/env python3
# M2.6 moto 老板端闭环验证：
#   登录 demo-moto → 输车牌 → 档案详情 → 7 步开单向导（大按钮开单）→
#   今日订单列表 → 推进进度到交接(picked_up) → DB 核验保养字段 + 保养提醒落地
# 检查点：输车牌→建档案→点大按钮开单→连续开单全走通
import re
import sys
import time
from datetime import datetime, timezone
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

SCRIPT_TAG = "moto-1-boss-order"
FLOW = "moto 老板端：车牌→档案→七步开单→推进→保养落地"

SLUG = "demo-moto"
MOTO_PHONE = "0901122334"
MOTO_PWD = "demo1234"
PLATE = "59X123456"
PRICE = "150kđ"


def moto_shop_id():
    rows = db_exec(f'SELECT id FROM "Shop" WHERE slug=\'{SLUG}\'')
    return rows[0]["value"] if rows else None


def q(sql: str, cols: list[str]):
    """psql 多列查询 → [{col: val}]（_psql 按位置返回 cols）"""
    return [dict(zip(cols, r["cols"])) for r in db_exec(sql)]


def cleanup():
    sid = moto_shop_id()
    if not sid:
        return
    # 清理今日 moto 单（MT- 前缀）及关联提醒；重置测试车保养字段
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


def main():
    started = datetime.now()
    records = []
    cleanup()
    with make_browser() as p:
        ctx = new_context(p, tag="moto")
        boss = login_moto_owner(ctx)

        # A1 登录后是 moto 老板端：车牌搜索框可见
        def a1():
            boss.fill('input[placeholder="VD: 59X123456"]', PLATE, timeout=ASSERT_TIMEOUT)
            boss.keyboard.press("Enter")
            # 档案详情：品牌型号 + 车牌 + 里程（vi 本地化 12.000）
            boss.get_by_text("Honda Wave Alpha").first.wait_for(
                state="visible", timeout=ACTION_TIMEOUT
            )
            boss.get_by_text(PLATE).first.wait_for(state="visible", timeout=ASSERT_TIMEOUT)
            boss.get_by_text("12.000").first.wait_for(state="visible", timeout=ASSERT_TIMEOUT)

        records.append(
            run_assertion(a1, "moto-a1", "登录后输入车牌 59X123456 → 带出档案详情", script_tag=SCRIPT_TAG, screenshot_page=boss)
        )

        # B 七步开单：reload 归一化 → 输车牌 → 档案 → 开维修单 → 症状 → 服务大按钮(换机油) → 报价 → 时间 → 电话 → 开工
        def b():
            boss.reload(wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            boss.fill('input[placeholder="VD: 59X123456"]', PLATE, timeout=ASSERT_TIMEOUT)
            boss.keyboard.press("Enter")
            boss.get_by_text("Honda Wave Alpha").first.wait_for(state="visible", timeout=ACTION_TIMEOUT)
            boss.get_by_role("button", name="Mở lệnh sửa", exact=True).click(timeout=ASSERT_TIMEOUT)
            # step1 车辆已带出（initialVehicle）→ 保存档案
            boss.get_by_text("Chọn mẫu xe").wait_for(state="visible", timeout=ACTION_TIMEOUT)
            boss.get_by_role("button", name="Lưu", exact=True).click(timeout=ASSERT_TIMEOUT)
            # step2 症状
            boss.get_by_role("button", name="Khó đề", exact=True).click(timeout=ASSERT_TIMEOUT)
            boss.get_by_role("button", name=re.compile("Tiếp tục")).click(timeout=ASSERT_TIMEOUT)
            # step3 服务：换机油大按钮（accessible name 含价格 → 子串匹配）
            boss.get_by_role("button", name=re.compile("Thay nhớt máy")).click(timeout=ASSERT_TIMEOUT)
            boss.get_by_role("button", name=re.compile("Tiếp tục")).click(timeout=ASSERT_TIMEOUT)
            # step4 报价：合计 150.000 ₫ → 勾选确认
            boss.get_by_text(PRICE).first.wait_for(state="visible", timeout=ASSERT_TIMEOUT)
            boss.locator('input[type="checkbox"]').check(timeout=ASSERT_TIMEOUT)
            boss.get_by_role("button", name=re.compile("Tiếp tục")).click(timeout=ASSERT_TIMEOUT)
            # step5 时间：2 giờ
            boss.get_by_role("button", name="2 giờ", exact=True).click(timeout=ASSERT_TIMEOUT)
            boss.get_by_role("button", name=re.compile("Tiếp tục")).click(timeout=ASSERT_TIMEOUT)
            # step6 电话：已带出 0923456789 → 跳过
            owner_phone = boss.locator('input[inputmode="tel"]').input_value(timeout=ASSERT_TIMEOUT)
            assert owner_phone == "0923456789", f"ownerPhone={owner_phone}"
            boss.get_by_role("button", name="Bỏ qua", exact=True).click(timeout=ASSERT_TIMEOUT)
            # step7 开工 → 开单成功自动回 home（onDone 切视图）→ 今日列表出现新单 + queued 徽标
            boss.get_by_role("button", name=re.compile("Bắt đầu")).click(timeout=ASSERT_TIMEOUT)
            boss.get_by_text("Lệnh hôm nay").wait_for(state="visible", timeout=ACTION_TIMEOUT)
            boss.get_by_text(re.compile("MT-")).first.wait_for(state="visible", timeout=ASSERT_TIMEOUT)
            boss.get_by_text("Đã nhận xe").first.wait_for(state="visible", timeout=ASSERT_TIMEOUT)

        records.append(
            run_assertion(b, "moto-b", "七步向导开单（换机油）→ 开单成功", script_tag=SCRIPT_TAG, screenshot_page=boss)
        )

        # C 回 home：今日订单列表出现新单（MT- 前缀 + 车牌 + 金额 + queued 徽标）
        def c():
            boss.reload(wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            boss.get_by_text("Lệnh hôm nay").wait_for(state="visible", timeout=ACTION_TIMEOUT)
            boss.get_by_text(PLATE).first.wait_for(state="visible", timeout=ASSERT_TIMEOUT)
            boss.get_by_text(re.compile("MT-")).first.wait_for(state="visible", timeout=ASSERT_TIMEOUT)
            boss.get_by_text("Đã nhận xe").first.wait_for(state="visible", timeout=ASSERT_TIMEOUT)
            boss.get_by_text(PRICE).first.wait_for(state="visible", timeout=ASSERT_TIMEOUT)

        records.append(
            run_assertion(c, "moto-c", "今日订单列表显示新单（MT- + queued + 金额）", script_tag=SCRIPT_TAG, screenshot_page=boss)
        )

        # D 推进进度直到交接（queued→…→picked_up）
        def d():
            boss.reload(wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            boss.get_by_text("Lệnh hôm nay").wait_for(state="visible", timeout=ACTION_TIMEOUT)
            for target in ["Đang kiểm tra", "Đã báo giá", "Đang sửa", "Chờ lấy xe", "Đã bàn giao"]:
                boss.get_by_role("button", name=re.compile(f"→ {target}")).first.click(
                    timeout=ASSERT_TIMEOUT
                )
                # badge 精确匹配（避免子串误命中残留按钮 → 误判推进完成）
                boss.get_by_text(target, exact=True).first.wait_for(
                    state="visible", timeout=ACTION_TIMEOUT
                )
            # 交接后无推进按钮（done）
            left = boss.get_by_role("button", name=re.compile("→ Đã bàn giao")).count()
            assert left == 0, f"残留推进按钮={left}，列表：\n{boss.locator('main').inner_text()[:900]}"

        records.append(
            run_assertion(d, "moto-d", "推进进度 queued→…→picked_up 交接完成", script_tag=SCRIPT_TAG, screenshot_page=boss)
        )

        # E1 DB：订单 COMPLETED + ticketId + total=150000
        def e_order():
            sid = moto_shop_id()
            rows = q(
                f'''SELECT "displayNo", status, total, config->>'motoProgress',
  config->>'ticketId'
  FROM "Order" WHERE "shopId"={_sql_quote(sid)} AND "displayNo" LIKE 'MT-%'
  AND config->>'plate'='{PLATE}' ORDER BY "createdAt" DESC LIMIT 1''',
                ["displayNo", "status", "total", "prog", "ticket"],
            )
            assert rows, "未找到 moto 单"
            r = rows[0]
            assert r["status"] == "COMPLETED", r
            assert r["prog"] == "picked_up", r
            assert r["ticket"], r
            assert int(float(r["total"])) == 150000, r

        records.append(
            run_assertion(e_order, "moto-e1", "DB：订单 COMPLETED + ticketId 已生成", script_tag=SCRIPT_TAG)
        )

        # E2 DB：车辆保养字段（换机油 OIL 2000km/180d）→ nextServiceKm=14000 + due≈+180d
        def e_vehicle():
            sid = moto_shop_id()
            rows = q(
                f'''SELECT "nextServiceKm", ("nextServiceDue" AT TIME ZONE 'UTC')::timestamp,
  "lastServiceAt", "lastIntervalDays"
  FROM "Vehicle" WHERE "shopId"={_sql_quote(sid)} AND plate='{PLATE}' ''',
                ["nextServiceKm", "nextServiceDue", "lastServiceAt", "lastIntervalDays"],
            )
            assert rows, "车辆不存在"
            v = rows[0]
            assert int(v["nextServiceKm"]) == 14000, v
            assert v["lastServiceAt"], v
            assert v["lastIntervalDays"] is not None and int(v["lastIntervalDays"]) >= 180, v
            due = v["nextServiceDue"]
            assert due, v
            due_dt = datetime.fromisoformat(str(due))
            days = (due_dt - datetime.utcnow()).days
            assert 178 <= days <= 182, (days, due)

        records.append(
            run_assertion(e_vehicle, "moto-e2", "DB：保养字段更新（14000km / +180d）", script_tag=SCRIPT_TAG)
        )

        # E3 DB：MOTO_SERVICE_DUE 提醒落地（PENDING + 车牌）
        def e_reminder():
            sid = moto_shop_id()
            rows = q(
                f'''SELECT "templateKey", status, "dueAt", payload->>'plate'
  FROM "Reminder" WHERE "shopId"={_sql_quote(sid)}
  AND "templateKey"='MOTO_SERVICE_DUE' AND payload->>'plate'='{PLATE}'
  ORDER BY "createdAt" DESC LIMIT 1''',
                ["templateKey", "status", "dueAt", "plate"],
            )
            assert rows, "未找到保养提醒"
            r = rows[0]
            assert r["status"] == "PENDING", r
            assert r["plate"] == PLATE, r
            assert r["dueAt"], r

        records.append(
            run_assertion(e_reminder, "moto-e3", "DB：保养提醒 MOTO_SERVICE_DUE 已落地", script_tag=SCRIPT_TAG)
        )

        ctx.close()

    ended = datetime.now()
    save_results(SCRIPT_TAG, FLOW, records, started, ended)
    return 0 if all(r.status != "FAIL" for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())
