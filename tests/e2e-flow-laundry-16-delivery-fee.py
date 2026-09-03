#!/usr/bin/env python3
# 洗衣(E2E-16)：配送费入订单金额回归（审计五轮 M）
#   定案：仅 deliver(送到家) 收配送费（店 Shop.config.deliveryFee）；in_store/pickup 免费。
#   断言（DB 权威为主 + UI 提示规则）：
#     b1 老板开单 in_store 默认 → 无 "+配送费" 提示
#     b2 老板开单 pickup(Lấy tận nơi) → 无提示、单 total 不含配送费
#     b3 老板开单 deliver(Giao tận nhà) → 有提示、单 total=洗衣+配送、config.deliveryFee 落值
#     a1 顾客自助 deliver 提交（kg5）→ 预估 total 含配送费、config.deliveryFee 锁存
#     a2 老板交接该自助单 → 正式 total 保持含配送费（重算不丢）
# 手法：预置店配费 50000（测完还原）；kg5 洗衣 100000 → deliver 单应收 150000。
import sys, re, time
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "lib"))
from e2e_common import (
    BASE, ACTION_TIMEOUT, ASSERT_TIMEOUT, NAV_TIMEOUT,
    make_browser, new_context, run_assertion, save_results, unlock_user, db_exec,
)

SCRIPT_TAG = "laundry-e2e-16-delivery-fee"
FLOW = "洗衣：配送费入订单金额（deliver 才收，DB/凭证/交接一致）"
SLUG = "demolaud"
BOSS, BOSS_PWD = "0901122335", "demo1234"
FEE = 50000          # 测试期预置店配费
KG5 = 100000         # kg5 × 20k
DELIVER_TOTAL = KG5 + FEE  # 150000
PH_B1 = "0901556011"  # in_store 老板单
PH_B2 = "0901556012"  # pickup 老板单
PH_B3 = "0901556013"  # deliver 老板单
PH_A = "0901556014"   # 顾客自助 deliver 单
PHONE_ALL = (PH_B1, PH_B2, PH_B3, PH_A)


def shop_id():
    r = db_exec(f"SELECT id FROM \"Shop\" WHERE slug='{SLUG}'")
    return r[0]["value"] if r else None


def order_by_phone(phone):
    r = db_exec(
        f"SELECT id, \"displayNo\", total::text, config::text, status FROM \"Order\" "
        f"WHERE \"shopId\"='{shop_id()}'::text AND \"customerPhone\"='{phone}' ORDER BY \"orderNo\" DESC LIMIT 1"
    )
    if not r or not r[0].get("cols"): return None
    import json
    c = r[0]["cols"]
    return {"id": c[0], "dn": c[1], "total": int(float(c[2])), "cfg": json.loads(c[3]), "status": c[4]}


def set_fee(v):
    if v is None:
        db_exec(f"UPDATE \"Shop\" SET config = config - 'deliveryFee' WHERE slug='{SLUG}'")
    else:
        db_exec(f"UPDATE \"Shop\" SET config = jsonb_set(config, '{{deliveryFee}}', '{v}'::jsonb) WHERE slug='{SLUG}'")


def cleanup():
    unlock_user(BOSS); sid = shop_id()
    if sid:
        ph = ",".join(f"'{p}'" for p in PHONE_ALL)
        db_exec(f"DELETE FROM \"Order\" WHERE \"shopId\"='{sid}'::text AND \"customerPhone\" IN ({ph})")


def login(page):
    page.goto(f"{BASE}/vi/login", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.fill('input[name="phone"]', BOSS); page.fill('input[name="password"]', BOSS_PWD)
    page.click('button[type="submit"]')
    page.wait_for_url(lambda u: "/login" not in u, timeout=ACTION_TIMEOUT)
    page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)


def open_create(page):
    page.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.wait_for_timeout(1500)
    page.get_by_text(re.compile("Tạo đơn")).first.click(timeout=ASSERT_TIMEOUT)
    page.wait_for_selector('input[name="customerPhone"]', timeout=ASSERT_TIMEOUT)
    page.wait_for_timeout(400)


def hint_count(page):
    return page.get_by_text(re.compile(r"Phí giao:\s*\+")).count()


def boss_create(page, phone, dispatch=None):
    open_create(page)
    if dispatch:
        page.get_by_text(dispatch, exact=True).first.click(timeout=ASSERT_TIMEOUT)
        page.wait_for_timeout(300)
    h = hint_count(page)
    page.fill('input[name="customerPhone"]', phone, timeout=ASSERT_TIMEOUT)
    page.get_by_text(re.compile("5kg")).first.click(timeout=ASSERT_TIMEOUT)
    page.wait_for_timeout(300)
    page.get_by_text(re.compile("Gửi đơn")).first.click(timeout=ACTION_TIMEOUT)
    # 等落库
    end = time.time() + 12
    while time.time() < end and order_by_phone(phone) is None:
        time.sleep(0.4)
    return h


def wait_anon_order(phone):
    end = time.time() + 12
    while time.time() < end:
        o = order_by_phone(phone)
        if o and o["cfg"].get("laundryStatus") == "submitted":
            return o
        time.sleep(0.4)
    return order_by_phone(phone)


def do_handover(page, dn):
    page.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.wait_for_timeout(1800)
    row = page.get_by_text(dn).first
    row.click(timeout=ASSERT_TIMEOUT); page.wait_for_timeout(600)   # Block E 折叠行 onClick 展开
    page.get_by_text("Xác nhận & giao").first.click(timeout=ACTION_TIMEOUT)
    page.wait_for_timeout(2500)


def main():
    records = []
    orig = db_exec(f"SELECT config->>'deliveryFee' FROM \"Shop\" WHERE slug='{SLUG}'")
    orig_fee = int(orig[0]["value"]) if orig and orig[0].get("value") else None
    cleanup(); started = datetime.now()
    if not shop_id():
        print("缺 demolaud 店"); return 1
    set_fee(FEE)
    try:
        with make_browser() as p:
            # —— 老板开单 3 态（UI 提示规则 + DB） ——
            ctx = new_context(p, tag="laund16boss", locale="vi-VN")
            page = ctx.new_page()
            page.set_default_timeout(ASSERT_TIMEOUT); page.set_default_navigation_timeout(NAV_TIMEOUT)
            login(page)

            h_b1 = boss_create(page, PH_B1)                      # in_store
            records.append(run_assertion(lambda: h_b1 == 0, "b1", "in_store 开单无 +配送费 提示", script_tag=SCRIPT_TAG))
            h_b2 = boss_create(page, PH_B2, "Lấy tận nơi")       # pickup
            records.append(run_assertion(lambda: h_b2 == 0, "b2", "pickup 开单无 +配送费 提示", script_tag=SCRIPT_TAG))
            h_b3 = boss_create(page, PH_B3, "Giao tận nhà")      # deliver
            records.append(run_assertion(lambda: h_b3 >= 1, "b3", "deliver 开单显示 +配送费 提示", script_tag=SCRIPT_TAG))

            o_instore = order_by_phone(PH_B1)
            o_pickup = order_by_phone(PH_B2)
            o_deliver = order_by_phone(PH_B3)
            records.append(run_assertion(lambda: o_instore and o_instore["total"] == KG5 and not (o_instore["cfg"].get("deliveryFee") or 0) > 0, "b4", f"in_store 单 total={KG5} 无配送费（现 {o_instore and o_instore['total']}）", script_tag=SCRIPT_TAG))
            records.append(run_assertion(lambda: o_pickup and o_pickup["total"] == KG5 and not (o_pickup["cfg"].get("deliveryFee") or 0) > 0, "b5", f"pickup 单 total={KG5} 免配送费（现 {o_pickup and o_pickup['total']}）", script_tag=SCRIPT_TAG))
            records.append(run_assertion(lambda: o_deliver and o_deliver["total"] == DELIVER_TOTAL and (o_deliver["cfg"].get("deliveryFee") or 0) == FEE, "b6", f"deliver 单 total=洗衣+配送({DELIVER_TOTAL}) 且 config.deliveryFee={FEE}（现 {o_deliver and o_deliver['total']}）", script_tag=SCRIPT_TAG))

            # —— 顾客自助 deliver → 老板交接（配送费在交接重算不丢）——
            # 老板 ctx 全程保持（page 稍后直接交接）；自助用独立匿名 ctx
            actx = new_context(p, tag="laund16anon", locale="vi-VN")
            apage = actx.new_page(); apage.set_default_timeout(ASSERT_TIMEOUT); apage.set_default_navigation_timeout(NAV_TIMEOUT)
            apage.goto(f"{BASE}/vi/hcm/laundry/{SLUG}/order", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            apage.wait_for_selector('button:has-text("Gửi yêu cầu")', timeout=ASSERT_TIMEOUT)
            apage.get_by_text("Giao tận nhà", exact=True).first.click(timeout=ASSERT_TIMEOUT)  # deliver（自助默认 kg=5）
            apage.wait_for_timeout(300)
            apage.get_by_placeholder("SĐT khách").fill(PH_A, timeout=ASSERT_TIMEOUT)
            apage.get_by_role("button", name="Gửi yêu cầu").click(timeout=ACTION_TIMEOUT)
            a0 = wait_anon_order(PH_A)
            records.append(run_assertion(lambda: a0 and a0["total"] == DELIVER_TOTAL and (a0["cfg"].get("deliveryFee") or 0) == FEE and a0["cfg"].get("laundryStatus") == "submitted", "a1", f"顾客自助 deliver 预估 total 含配送({DELIVER_TOTAL})+config 锁存（现 {a0 and a0['total']}）", script_tag=SCRIPT_TAG, screenshot_page=apage))
            actx.close()

            # 老板交接该自助单（page 属仍在线的老板 ctx）
            do_handover(page, a0["dn"])
            a1 = order_by_phone(PH_A)
            records.append(run_assertion(lambda: a1 and a1["cfg"].get("laundryStatus") == "washing_pending" and a1["total"] == DELIVER_TOTAL and (a1["cfg"].get("deliveryFee") or 0) == FEE, "a2", f"交接重算后 total 仍含配送({DELIVER_TOTAL})+deliveryFee 保留（现 {a1 and a1['total']}）", script_tag=SCRIPT_TAG))
            ctx.close()
    finally:
        set_fee(orig_fee if orig_fee is not None else None)
        cleanup()
    ended = datetime.now()
    save_results(SCRIPT_TAG, FLOW, records, started, ended)
    return 0 if all(r.status != "FAIL" for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())
