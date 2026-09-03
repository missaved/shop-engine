#!/usr/bin/env python3
# 洗衣(E2E-17)：停用/到期店自助接单拦截 + 砍 credit 储值卡开卡（审计六轮 N/O 回归）
#   定案：N-A 维持「门户标状态 + 进店放行」→ 不动聚合/getShopBySlug；N-B 自助提交对齐通用下单，
#         platformSuspended / 订阅到期 拒单（此前只拦打烊）；O 砍 credit 开卡（开卡仅 count 次卡）。
#   断言（DB 权威为主）：
#     c1 停用店(platformSuspended) 顾客自助提交 → 拒（无 Order 落库）
#     c2 到期店(subscribedUntil 过去, billing 默认锁死档) 顾客自助提交 → 拒
#     c3 正常营业店自助提交 → 成功（对照，拦截非误伤）
#     d1 老板会员面板：开卡区仅「次卡」、无「储值卡(Thẻ nạp)」可选/展示（新顾客无历史卡）
#     d2 老板开 count 卡 → DB 落 type='count' remainingCount=5（count 路径不受砍 credit 影响）
# 手法：翻转 demolaud 的 platformSuspended/subscribedUntil 再还原；自助提交后 sleep 等网络落地再查 DB。
import sys, time
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "lib"))
from e2e_common import (
    BASE, ACTION_TIMEOUT, ASSERT_TIMEOUT, NAV_TIMEOUT,
    make_browser, new_context, run_assertion, save_results, unlock_user, db_exec,
)

SCRIPT_TAG = "laundry-e2e-17-shop-suspension-credit"
FLOW = "洗衣：停用/到期店自助单拦截 + 砍 credit 储值卡"
SLUG = "demolaud"
BOSS, BOSS_PWD = "0901122335", "demo1234"
PH_C1 = "0901556021"  # 停用店自助（应拒）
PH_C2 = "0901556022"  # 到期店自助（应拒）
PH_C3 = "0901556023"  # 正常对照自助（应成功）
PH_D = "0901556024"   # 会员面板开 count 卡（新顾客）


def shop_row():
    r = db_exec(f'SELECT "platformSuspended"::text, "subscribedUntil"::text FROM "Shop" WHERE slug=\'{SLUG}\'')
    return r[0]["cols"] if r and r[0].get("cols") else (None, None)


def set_suspended(v):
    db_exec(f"UPDATE \"Shop\" SET \"platformSuspended\"={v} WHERE slug='{SLUG}'")


def set_subscribed(v):
    db_exec(f"UPDATE \"Shop\" SET \"subscribedUntil\"={v} WHERE slug='{SLUG}'")


def order_count(phone):
    sid = db_exec(f"SELECT id FROM \"Shop\" WHERE slug='{SLUG}'")
    if not sid:
        return 0
    r = db_exec(
        f"SELECT count(*)::int FROM \"Order\" WHERE \"shopId\"='{sid[0]['value']}'::text "
        f"AND \"customerPhone\"='{phone}'"
    )
    return int(r[0]["value"]) if r and r[0].get("value") else 0


def wait_anon_order(phone, timeout_s=12):
    end = time.time() + timeout_s
    while time.time() < end:
        if order_count(phone) > 0:
            return True
        time.sleep(0.4)
    return order_count(phone) > 0


def anon_submit(page, phone):
    """匿名自助 ctx 提交一单（kg5 in_store）。自助表单不可达（页面层即拒）→ 返回 False；
    可达则点提交、等网络落地（成/拒由 DB 断言），返回 True。"""
    try:
        page.goto(f"{BASE}/vi/hcm/laundry/{SLUG}/order", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        page.wait_for_selector('button:has-text("Gửi yêu cầu")', timeout=8000)
    except Exception:
        return False
    page.get_by_placeholder("SĐT khách").fill(phone, timeout=ASSERT_TIMEOUT)
    page.get_by_role("button", name="Gửi yêu cầu").click(timeout=ACTION_TIMEOUT)
    page.wait_for_timeout(2500)
    return True


def login(page):
    page.goto(f"{BASE}/vi/login", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.fill('input[name="phone"]', BOSS); page.fill('input[name="password"]', BOSS_PWD)
    page.click('button[type="submit"]')
    page.wait_for_url(lambda u: "/login" not in u, timeout=ACTION_TIMEOUT)
    page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)


def cleanup():
    unlock_user(BOSS)
    sid = db_exec(f"SELECT id FROM \"Shop\" WHERE slug='{SLUG}'")
    if not sid:
        return
    sid = sid[0]["value"]
    for ph in (PH_C1, PH_C2, PH_C3):
        db_exec(f"DELETE FROM \"Order\" WHERE \"shopId\"='{sid}'::text AND \"customerPhone\"='{ph}'")
    # 删 d 顾客的卡与顾客（该顾客为测试新建、无其它关联）
    db_exec(f"DELETE FROM \"CustomerCard\" WHERE \"customerId\"=(SELECT id FROM \"Customer\" WHERE phone='{PH_D}')")
    db_exec(f"DELETE FROM \"Customer\" WHERE phone='{PH_D}'")


def main():
    records = []
    cleanup(); started = datetime.now()
    ps, sub = shop_row()          # 记录原状态用于还原
    try:
        with make_browser() as p:
            # —— c1 停用店自助被拒 ——
            set_suspended(True)
            actx = new_context(p, tag="laund17c1", locale="vi-VN")
            ap = actx.new_page(); ap.set_default_timeout(ASSERT_TIMEOUT); ap.set_default_navigation_timeout(NAV_TIMEOUT)
            f1 = anon_submit(ap, PH_C1); actx.close()
            records.append(run_assertion(
                lambda: order_count(PH_C1) == 0,
                "c1", f"停用店(platformSuspended)自助无单落库（表单{'可达→action拒' if f1 else '不可达→页面层即拒'}）",
                script_tag=SCRIPT_TAG))
            set_suspended(False)

            # —— c2 到期店自助被拒 ——
            set_subscribed("'2020-01-01T00:00:00.000Z'::timestamptz")
            actx = new_context(p, tag="laund17c2", locale="vi-VN")
            ap = actx.new_page(); ap.set_default_timeout(ASSERT_TIMEOUT); ap.set_default_navigation_timeout(NAV_TIMEOUT)
            f2 = anon_submit(ap, PH_C2); actx.close()
            records.append(run_assertion(
                lambda: order_count(PH_C2) == 0,
                "c2", f"到期店(subscribedUntil 过去)自助无单落库（表单{'可达→action拒' if f2 else '不可达→页面层即拒'}）",
                script_tag=SCRIPT_TAG))
            set_subscribed("NULL")

            # —— c3 正常对照自助成功 ——
            actx = new_context(p, tag="laund17c3", locale="vi-VN")
            ap = actx.new_page(); ap.set_default_timeout(ASSERT_TIMEOUT); ap.set_default_navigation_timeout(NAV_TIMEOUT)
            f3 = anon_submit(ap, PH_C3)
            ok3 = wait_anon_order(PH_C3)
            actx.close()
            records.append(run_assertion(lambda: f3 and ok3, "c3", "正常营业店自助提交成功落库（对照，拦截非误伤）", script_tag=SCRIPT_TAG))
            db_exec(f"DELETE FROM \"Order\" WHERE \"customerPhone\"='{PH_C3}'")

            # —— d 老板会员面板：开 count 卡、无 credit 卡入口 ——
            ctx = new_context(p, tag="laund17boss", locale="vi-VN")
            page = ctx.new_page(); page.set_default_timeout(ASSERT_TIMEOUT); page.set_default_navigation_timeout(NAV_TIMEOUT)
            login(page)
            page.goto(f"{BASE}/vi/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            page.wait_for_timeout(1800)
            page.get_by_role("button", name="打开设置").first.click(timeout=ASSERT_TIMEOUT)
            page.wait_for_timeout(800)
            # 会员面板作用域（rounded 容器含「Thành viên & thẻ」标题）
            member = page.locator("xpath=//div[contains(@class,'rounded-xl') and .//*[normalize-space()='Thành viên & thẻ']]").first
            member.get_by_placeholder("SĐT khách").fill(PH_D, timeout=ASSERT_TIMEOUT)
            member.get_by_text("Tra cứu", exact=True).click(timeout=ASSERT_TIMEOUT)
            member.get_by_text("Mở thẻ", exact=True).wait_for(timeout=ASSERT_TIMEOUT)
            page.wait_for_timeout(300)
            records.append(run_assertion(
                lambda: member.get_by_text("Thẻ nạp", exact=False).count() == 0,
                "d1", "会员面板无「储值卡 Thẻ nạp」开卡/展示入口（砍 credit）",
                script_tag=SCRIPT_TAG, screenshot_page=page))
            member.get_by_text("Mở thẻ", exact=True).click(timeout=ACTION_TIMEOUT)
            page.wait_for_timeout(1200)
            r = db_exec(
                f"SELECT \"type\"::text, \"remainingCount\"::text, \"balance\"::text FROM \"CustomerCard\" "
                f"WHERE \"customerId\"=(SELECT id FROM \"Customer\" WHERE phone='{PH_D}') "
                f"ORDER BY \"createdAt\" DESC LIMIT 1"
            )
            ctype = r[0]["cols"][0] if r and r[0].get("cols") else None
            rem = r[0]["cols"][1] if r and r[0].get("cols") else None
            bal = r[0]["cols"][2] if r and r[0].get("cols") else None
            records.append(run_assertion(
                lambda: ctype == "count" and rem == "5" and bal == "0",
                "d2", f"开 count 卡落库 type=count remainingCount=5 balance=0（现 {ctype}/{rem}/{bal}）",
                script_tag=SCRIPT_TAG))
            ctx.close()
    finally:
        # 还原店状态到原始值
        set_suspended(ps if ps == "true" else "false")
        set_subscribed("NULL" if sub is None or sub == "" else f"'{sub}'::timestamptz")
        cleanup()
    ended = datetime.now()
    save_results(SCRIPT_TAG, FLOW, records, started, ended)
    return 0 if all(r.status != "FAIL" for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())
