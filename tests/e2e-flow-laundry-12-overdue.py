#!/usr/bin/env python3
# 洗衣(E2E-12)：逾期档位自动升级（审计 B+E 整改回归）
#   E 基准：ready 单滞留天数以 readyAt（ready 时刻）起算，非 createdAt（开单时刻）
#   B 触发：滞留 >3 天自动生成 LAUNDRY_OVERDUE_1（红卡+overdue1 文案）并收敛低档 READY；
#           >7 天升级 LAUNDRY_OVERDUE_2（overdue2 文案）；每档只催一次，取走即停
# 手法：DB 直插 ready 单 + dashboard 轮询（LaundryReminderList.load → getLaundryReminders → escalateLaundryOverdue）触发
import json, sys, uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "lib"))
from e2e_common import (
    BASE, ACTION_TIMEOUT, ASSERT_TIMEOUT, NAV_TIMEOUT,
    make_browser, new_context, run_assertion, save_results, unlock_user, db_exec,
)

SCRIPT_TAG = "laundry-e2e-12-overdue"
FLOW = "洗衣：逾期档位自动升级(E:readyAt基准 / B:OVERDUE_1→2 触发+收敛)"
SLUG = "demolaud"
LAUN_PHONE, LAUN_PWD = "0901122335", "demo1234"

# 测试单 orderNo（>99000 不与 seed 撞；cleanup 双键删）
ORDERS = {  # key -> (orderNo, displayNo, daysAgo_created, daysAgo_ready, tag)
    "e1": (99001, "LD-999001", 5, 1, "#901"),   # E：created 5d 前但 ready 才 1d → 不升档
    "b1": (99002, "LD-999002", 6, 4, "#902"),   # B1：ready 4d 前 → OVERDUE_1 + 收敛 READY
    "b2": (99003, "LD-999003", 12, 8, "#903"),  # B2：ready 8d 前（先置 OVD_1 PENDING）→ OVERDUE_2 + 收敛 OVD_1
}
OVD1 = "Quá 3 ngày — khách chưa lấy"
OVD2 = "Quá 7 ngày — cần đốc thúc"


def iso(days_ago: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat().replace("+00:00", "Z")


def shop_id():
    r = db_exec(f"SELECT id FROM \"Shop\" WHERE slug='{SLUG}'")
    return r[0]["value"] if r else None


def cleanup():
    unlock_user(LAUN_PHONE); sid = shop_id()
    if not sid: return
    nos = ",".join(str(v[0]) for v in ORDERS.values())
    dns = ",".join(f"'{v[1]}'" for v in ORDERS.values())
    # 双键删 + 连带其 Reminder（先删 reminder 防 order 删除置空 orderId 残留孤儿提醒）
    db_exec(f"DELETE FROM \"Reminder\" WHERE \"orderId\" IN (SELECT id FROM \"Order\" WHERE \"shopId\"='{sid}'::text AND (\"orderNo\" IN ({nos}) OR \"displayNo\" IN ({dns})))")
    db_exec(f"DELETE FROM \"Order\" WHERE \"shopId\"='{sid}'::text AND (\"orderNo\" IN ({nos}) OR \"displayNo\" IN ({dns}))")


def insert_ready(sid, key, with_readym: bool, extra_ovd1: bool):
    orderNo, dn, cd, rd, tag = ORDERS[key]
    oid = str(uuid.uuid4())
    cfg = {"laundryMode": "kg", "laundryStatus": "ready", "tagCode": tag, "readyAt": iso(rd)}
    db_exec(
        f"""INSERT INTO "Order" (id, "orderNo", "shopId", status, items, total, "paidAmount", config, "createdAt", "updatedAt", "displayNo", "customerName", "customerPhone") VALUES
        ('{oid}', {orderNo}, '{sid}', 'READY', '[]', 100000, 0,
        '{json.dumps(cfg)}',
        NOW() - INTERVAL '{cd} days', NOW(), '{dn}', 'Overdue Test', '0900000111')"""
    )
    if with_readym:  # 模拟 advanceLaundryStatus ready 事件已建的 READY 提醒
        db_exec(
            f"""INSERT INTO "Reminder" (id, "shopId", "orderId", "templateKey", "dueAt", "status", payload, "createdAt", "updatedAt") VALUES
            ('{uuid.uuid4()}', '{sid}', '{oid}', 'LAUNDRY_READY', NOW(), 'PENDING',
             '{{"displayNo":"{dn}","tagCode":"{tag}","customerPhone":"0900000111","customerName":"Overdue Test","total":100000}}', NOW(), NOW())"""
        )
    if extra_ovd1:  # b2：先有一档逾期提醒（模拟已催到档1）待升档2 并验证收敛
        db_exec(
            f"""INSERT INTO "Reminder" (id, "shopId", "orderId", "templateKey", "dueAt", "status", payload, "createdAt", "updatedAt") VALUES
            ('{uuid.uuid4()}', '{sid}', '{oid}', 'LAUNDRY_OVERDUE_1', NOW(), 'PENDING',
             '{{"displayNo":"{dn}","tagCode":"{tag}","customerPhone":"0900000111","customerName":"Overdue Test","total":100000}}', NOW(), NOW())"""
        )
    return oid


def remind(oid, key):
    rows = db_exec(f"SELECT \"templateKey\", status FROM \"Reminder\" WHERE \"orderId\"='{oid}'")
    if not rows: return {}
    out = {}
    for r in rows:
        c = r["cols"]; out[c[0]] = out.get(c[0], []) + [c[1]]
    return out


def has_ovd(oid, level: int):
    r = remind(oid, None)
    key = f"LAUNDRY_OVERDUE_{level}"
    return key in r


def login(ctx):
    page = ctx.new_page(); page.set_default_timeout(ASSERT_TIMEOUT); page.set_default_navigation_timeout(NAV_TIMEOUT)
    page.goto(f"{BASE}/vi/login", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.fill('input[name="phone"]', LAUN_PHONE); page.fill('input[name="password"]', LAUN_PWD)
    page.click('button[type="submit"]'); page.wait_for_url(lambda u: "/login" not in u, timeout=ACTION_TIMEOUT)
    page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)
    return page


def main():
    started = datetime.now(); records = []; cleanup()
    sid = shop_id()
    if not sid:
        print("缺 demolaud 店"); return 1
    # 造数据
    o_e1 = insert_ready(sid, "e1", with_readym=True, extra_ovd1=False)
    o_b1 = insert_ready(sid, "b1", with_readym=True, extra_ovd1=False)
    o_b2 = insert_ready(sid, "b2", with_readym=True, extra_ovd1=True)

    with make_browser() as p:
        ctx = new_context(p, tag="laund12", locale="vi-VN")
        page = login(ctx)
        # dashboard mount → LaundryReminderList.load → getLaundryReminders → escalate
        page.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        page.wait_for_timeout(4000)
        body = page.inner_text("body")

        # ===== E 基准：e1 ready 1d 前（createdAt 5d 前）不得升档 =====
        def e1():
            r = remind(o_e1, "e1")
            assert "LAUNDRY_READY" in r and "PENDING" in r["LAUNDRY_READY"], f"e1 READY 应仍 PENDING: {r}"
            assert not has_ovd(o_e1, 1) and not has_ovd(o_e1, 2), f"e1 不得建逾期档（旧基准 createdAt5d 会误判）: {r}"

        records.append(run_assertion(e1, "e1", "E：ready1d 前(createdAt5d) 不升档——基准已改 readyAt", script_tag=SCRIPT_TAG))
        # ===== B1：ready 4d 前 → 建 OVERDUE_1 + 收敛 READY =====
        def b1():
            r = remind(o_b1, "b1")
            assert has_ovd(o_b1, 1), f"b1 应建 OVERDUE_1: {r}"
            assert r.get("LAUNDRY_READY") == ["SENT"], f"b1 READY 低档应收敛为 SENT: {r}"
            assert not has_ovd(o_b1, 2), f"b1 不应升到 OVERDUE_2: {r}"

        records.append(run_assertion(b1, "b1", "B1：>3 天生成 OVERDUE_1 + READY 收敛 SENT", script_tag=SCRIPT_TAG, screenshot_page=page))
        # ===== B2：ready 8d 前 + 已有 OVD_1 PENDING → 建 OVERDUE_2 + 收敛 OVD_1 =====
        def b2():
            r = remind(o_b2, "b2")
            assert has_ovd(o_b2, 2), f"b2 应建 OVERDUE_2: {r}"
            assert r.get("LAUNDRY_OVERDUE_1") == ["SENT"], f"b2 OVD_1 应收敛为 SENT: {r}"

        records.append(run_assertion(b2, "b2", "B2：>7 天生成 OVERDUE_2 + OVD_1 收敛 SENT", script_tag=SCRIPT_TAG, screenshot_page=page))
        # ===== UI：点开「Nhắc lấy đồ」提醒折叠区（默认折叠）后逾期 1/2 级文案均呈现 =====
        def ui():
            page.get_by_text("Nhắc lấy đồ").first.click(timeout=ASSERT_TIMEOUT)
            page.wait_for_timeout(900)
            b = page.inner_text("body")
            assert OVD1 in b, f"UI 缺 overdue1 文案:\n{b[:500]}"
            assert OVD2 in b, f"UI 缺 overdue2 文案:\n{b[:500]}"

        records.append(run_assertion(ui, "ui", "UI：展开待办后逾期 1/2 级文案均在", script_tag=SCRIPT_TAG, screenshot_page=page))

        # ===== 取走停：e1 置 collected（走 status 过滤排除）后再次 escalate 不新建 =====
        db_exec(f"UPDATE \"Order\" SET status='COMPLETED', config=jsonb_set(config::jsonb, '{{laundryStatus}}', '\"collected\"')::json WHERE id='{o_e1}'::text")
        db_exec(f"UPDATE \"Order\" SET status='COMPLETED', config=jsonb_set(config::jsonb, '{{laundryStatus}}', '\"collected\"')::json WHERE id='{o_b1}'::text")
        page.reload(wait_until="domcontentloaded", timeout=NAV_TIMEOUT); page.wait_for_timeout(4000)

        def stop():
            assert not has_ovd(o_e1, 1) and not has_ovd(o_e1, 2), "e1 取走后不得再建逾期档"
            # b1 已有 OVD_1 PENDING（未催），collect 后 reload → escalate 跳过（status≠READY），不产生新档/不重复
            r = remind(o_b1, "b1")
            assert set(r.get("LAUNDRY_OVERDUE_1", [])) <= {"PENDING"}, r

        records.append(run_assertion(stop, "stop", "取走(collected)后 escalate 不再新建/重复逾期档", script_tag=SCRIPT_TAG))

        ctx.close()
    cleanup()
    ended = datetime.now()
    save_results(SCRIPT_TAG, FLOW, records, started, ended)
    return 0 if all(r.status != "FAIL" for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())
