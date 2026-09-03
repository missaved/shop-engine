#!/usr/bin/env python3
# M6b 凭证页 + 消息渠道 + 安全 闭环验证：
#   老板推进到 picked_up → 自动跳凭证页 → 凭证渲染（订单/车牌/进度/金额/收款）
#   → 复制链接 → WhatsApp/Zalo 深链分享 → PII 最小化 → 防遍历 404 → 非 MOTO 店 404 → 六语言
import sys
import uuid
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse, parse_qs

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

SCRIPT_TAG = "moto-7-ticket"
FLOW = "凭证页：交接→凭证渲染→复制/分享→防遍历→六语言"

SLUG = "demo-moto"
SHOP_ID = "cmtgy7y400002vtt56vk0k5a8"
OWNER_PHONE = "0901122334"
OWNER_PWD = "demo1234"
PLATE = "59A678123"
VEHICLE_ID = "cmtgy8eat000f45t54ov43m3x"
CUST_PHONE = "0934567890"
TICKET_NO = "MT-260831-010"
TOTAL = "250kđ"
# vi 文案锚点
T_PICKUP_BTN = "→ Đã bàn giao"
T_TITLE = "Phiếu xác nhận"
T_ORDER_NO = "Mã đơn"
T_PICKED = "Đã bàn giao"
T_PAY = "Techcombank"
T_COPY = "Sao chép liên kết"
T_COPIED = "Đã sao chép liên kết"
T_WHATSAPP = "Chia sẻ WhatsApp"
T_ZALO = "Chia sẻ Zalo"


def setup():
    # 幂等清理测试单 + 造 waiting_pickup 单（老板推进一次 → picked_up → 凭证）
    db_exec(f"DELETE FROM \"Order\" WHERE \"displayNo\"='{TICKET_NO}' AND \"shopId\"='{SHOP_ID}'")
    db_exec(f"""
INSERT INTO "Order" (id, "orderNo", "shopId", status, items, total, "paidAmount", config, "createdAt", "updatedAt", "displayNo", "customerName", "customerPhone") VALUES
(gen_random_uuid()::text, 990010, '{SHOP_ID}', 'READY', '[]', 250000, 0,
 '{{"plate":"{PLATE}","symptom":["Thay dầu","Siết phanh"],"laborFee":200000,"discount":0,"estimatedDue":"1 ngày","motoProgress":"waiting_pickup","vehicleId":"{VEHICLE_ID}"}}',
 NOW() - INTERVAL '1 hour', NOW(), '{TICKET_NO}', 'Test Khach', '{CUST_PHONE}')
""")


def owner_login(ctx):
    page = ctx.new_page()
    page.set_default_timeout(ASSERT_TIMEOUT)
    page.set_default_navigation_timeout(NAV_TIMEOUT)
    page.goto(f"{BASE}/vi/login", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.fill('input[name="phone"]', OWNER_PHONE, timeout=ASSERT_TIMEOUT)
    page.fill('input[name="password"]', OWNER_PWD, timeout=ASSERT_TIMEOUT)
    page.click('button[type="submit"]', timeout=ASSERT_TIMEOUT)
    page.wait_for_url(lambda url: "/login" not in url, timeout=ACTION_TIMEOUT)
    page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)
    return page


def main():
    started = datetime.now()
    records = []
    setup()
    unlock_user(OWNER_PHONE)
    ticket_id = {"v": None}

    with make_browser() as p:
        # ============ s1 交接 → 自动跳凭证页 + 内容断言 ============
        ctx = new_context(p, tag="ticket")
        page = owner_login(ctx)

        def s1():
            # 幂等：重试场景下若已在凭证页则跳过推进动作（推进是一次性状态变化）
            if "/ticket?" not in page.url:
                # 测试单是唯一 waiting_pickup → 「→ Đã bàn giao」按钮唯一
                # Block D 订单卡默认折叠：先点车牌展开折叠卡，再点推进按钮
                page.get_by_text(PLATE, exact=True).first.click(timeout=ASSERT_TIMEOUT)
                page.wait_for_timeout(400)
                page.get_by_role("button", name=T_PICKUP_BTN, exact=True).first.click(timeout=ASSERT_TIMEOUT)
                page.wait_for_url(lambda url: "/ticket?" in url, timeout=ACTION_TIMEOUT)
                page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)
            ticket_id["v"] = parse_qs(urlparse(page.url).query).get("ticketId", [""])[0]
            # 凭证内容：标题/订单号/车牌/进度/金额/收款（heading 定位避开 __next-route-announcer__）
            page.get_by_role("heading", name=T_TITLE, exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)
            body = page.locator("body")
            body.get_by_text(f"#{TICKET_NO}", exact=False).wait_for(state="visible", timeout=ACTION_TIMEOUT)
            body.get_by_text(PLATE, exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)
            body.get_by_text(T_PICKED, exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)
            body.get_by_text(TOTAL, exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)
            body.get_by_text(T_PAY, exact=False).wait_for(state="visible", timeout=ACTION_TIMEOUT)
            # DB 核验：交接已归档 COMPLETED + config.ticketId 已生成
            r = db_exec(
                f"SELECT status, config->>'ticketId' FROM \"Order\" WHERE \"displayNo\"='{TICKET_NO}'"
            )
            assert r and r[0]["cols"][0] == "COMPLETED", r
            assert r[0]["cols"][1], f"ticketId 未生成: {r}"
            assert r[0]["cols"][1] == ticket_id["v"], f"ticketId 不一致: {r}"

        records.append(
            run_assertion(s1, "moto-s1", "老板交接 → 自动跳凭证页 + 内容/归档/DB 核验", script_tag=SCRIPT_TAG, screenshot_page=page)
        )

        # ============ s2 复制链接 ============
        def s2():
            page.get_by_role("button", name=T_COPY, exact=True).click(timeout=ASSERT_TIMEOUT)
            page.get_by_text(T_COPIED, exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)

        records.append(
            run_assertion(s2, "moto-s2", "复制链接按钮 → 复制成功提示", script_tag=SCRIPT_TAG, screenshot_page=page)
        )

        # ============ s3 分享深链（MessageChannel）============
        def s3():
            wa = page.get_by_role("link", name=T_WHATSAPP, exact=True)
            za = page.get_by_role("link", name=T_ZALO, exact=True)
            wa_href = wa.get_attribute("href")
            za_href = za.get_attribute("href")
            assert "wa.me/?text=" in wa_href, wa_href
            assert "zalo.me/?text=" in za_href, za_href
            # 分享文案含门店名 + 车牌 + 订单号
            assert SLUG in wa_href, wa_href
            assert PLATE in wa_href, wa_href

        records.append(
            run_assertion(s3, "moto-s3", "WhatsApp/Zalo 分享按钮 href 深链正确 + 文案含车牌/链接", script_tag=SCRIPT_TAG, screenshot_page=page)
        )

        # ============ s4 PII 最小化：凭证页不暴露完整手机号 ============
        def s4():
            body = page.locator("body").inner_text()
            assert CUST_PHONE not in body, f"凭证页泄露车主手机号:\n{body[:300]}"

        records.append(
            run_assertion(s4, "moto-s4", "PII 最小化：凭证页不显示完整车主手机号", script_tag=SCRIPT_TAG, screenshot_page=page)
        )
        ctx.close()

        # ============ s5 防遍历：随机 ticketId → 404 ============
        ctx5 = new_context(p, tag="ticket5")

        def s5():
            page5 = ctx5.new_page()
            page5.set_default_timeout(ASSERT_TIMEOUT)
            page5.set_default_navigation_timeout(NAV_TIMEOUT)
            resp = page5.goto(
                f"{BASE}/vi/hcm/moto/{SLUG}/ticket?ticketId={uuid.uuid4().hex}", wait_until="domcontentloaded", timeout=NAV_TIMEOUT
            )
            assert resp.status == 404, f"随机 ticketId 未 404: {resp.status}"
            page5.close()

        records.append(
            run_assertion(s5, "moto-s5", "防遍历：随机 ticketId → 404", script_tag=SCRIPT_TAG, screenshot_page=None)
        )
        ctx5.close()

        # ============ s6 非 MOTO 店访问凭证 → 404 ============
        ctx6 = new_context(p, tag="ticket6")

        def s6():
            page6 = ctx6.new_page()
            page6.set_default_timeout(ASSERT_TIMEOUT)
            page6.set_default_navigation_timeout(NAV_TIMEOUT)
            resp = page6.goto(
                f"{BASE}/vi/hcm/food/demo-pho/ticket?ticketId=abc", wait_until="domcontentloaded", timeout=NAV_TIMEOUT
            )
            assert resp.status == 404, f"food 店凭证页未 404: {resp.status}"
            page6.close()

        records.append(
            run_assertion(s6, "moto-s6", "非 MOTO 店访问凭证路由 → 404（assertMotoShop 隔离）", script_tag=SCRIPT_TAG, screenshot_page=None)
        )
        ctx6.close()

        # ============ s7 六语言凭证渲染 smoke ============
        TITLES = {
            'vi': 'Phiếu xác nhận', 'en': 'Service receipt', 'zh': '维修凭证',
            'zh-Hant': '維修憑證', 'ms': 'Resit servis', 'th': 'ใบเสร็จการซ่อม',
        }
        tid = ticket_id["v"]
        assert tid, "s1 未生成 ticketId"

        def s7():
            assert tid
            for loc, title in TITLES.items():
                c7 = new_context(p, tag=f"ticket7-{loc}")
                pg = c7.new_page()
                pg.set_default_timeout(ASSERT_TIMEOUT)
                pg.set_default_navigation_timeout(NAV_TIMEOUT)
                pg.goto(f"{BASE}/{loc}/hcm/moto/{SLUG}/ticket?ticketId={tid}", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
                pg.get_by_text(title, exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)
                b = pg.locator("body").inner_text()
                assert "Missing message" not in b, f"{loc} Missing message"
                c7.close()
            print(f"  (s7 六语言 {len(TITLES)}/{len(TITLES)} 通过)")

        records.append(
            run_assertion(s7, "moto-s7", "凭证页六语言渲染 + 无缺失 key", script_tag=SCRIPT_TAG, screenshot_page=None)
        )

    ended = datetime.now()
    save_results(SCRIPT_TAG, FLOW, records, started, ended)
    return 0 if all(r.status != "FAIL" for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())
