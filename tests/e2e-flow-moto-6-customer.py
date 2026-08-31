#!/usr/bin/env python3
# M6a 客户账号 + 自助查询 闭环验证：
#   匿名查询（车牌+手机号尾号）→ 注册 → 登录 → 未认领拦截（查绑定内容必须先认领）→ 认领 → 我的车辆
#   DB 核验：Customer 建号 + Vehicle.ownerCustomerId 绑定
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
    db_exec,
    _sql_quote,
)

SCRIPT_TAG = "moto-6-customer"
FLOW = "客户自助查询：匿名 → 注册/登录 → 认领 → 我的车辆 → DB 核验"

# demo-moto 店（M4 建，M5 续费后未过期）
SLUG = "demo-moto"
SHOP_ID = "cmtgy7y400002vtt56vk0k5a8"
# 测试车辆（已存在于 demo-moto 店，ownerPhone 与注册客户一致）
PLATE = "59A678123"
OWNER_PHONE = "0934567890"
OWNER_PWD = "test1234"
CUST2_PHONE = "0944444555"
# vi 文案锚点
T_TITLE = "Tra cứu xe"
T_ANON_SUBMIT = "Tra cứu"
T_PLATE_PH = "Biển số xe"
T_TAIL_PH = "4 số cuối điện thoại"
T_PHONE_PH = "Số điện thoại"
T_PWD_PH = "Mật khẩu"
T_NAME_PH = "Họ tên"
T_REGISTER_TAB = "Đăng ký"
T_REGISTER_OK = "Đăng ký thành công, vui lòng đăng nhập"
T_LOGIN_BTN = "Đăng nhập"
T_LOGIN_FAIL = "Số điện thoại hoặc mật khẩu không đúng"
T_PHONE_MISMATCH = "Số điện thoại không khớp, vui lòng liên hệ cửa hàng"
T_MY_TITLE = "Xe của tôi"
T_NO_VEHICLES = "Chưa có xe nào được liên kết"
T_CLAIM_BTN = "Liên kết"
T_CLAIMED = "Liên kết xe thành công"
T_REPAIRING = "Đang sửa"
T_AMOUNT = "350kđ"


def setup():
    # 幂等清理 + 造测试数据：一条进行中订单（repairing）+ 一条已交接历史单
    db_exec(f"DELETE FROM \"Order\" WHERE \"displayNo\" IN ('MT-260831-002','MT-260831-003') AND \"shopId\"='{SHOP_ID}'")
    db_exec(f"DELETE FROM \"Customer\" WHERE phone IN ({_sql_quote(OWNER_PHONE)},{_sql_quote(CUST2_PHONE)})")
    db_exec(f"UPDATE \"Vehicle\" SET \"ownerCustomerId\"=NULL WHERE \"shopId\"='{SHOP_ID}' AND \"plate\"='{PLATE}'")
    db_exec(f"""
INSERT INTO "Order" (id, "orderNo", "shopId", status, items, total, "paidAmount", config, "createdAt", "updatedAt", "displayNo", "customerName", "customerPhone") VALUES
(gen_random_uuid()::text, 990002, '{SHOP_ID}', 'IN_PROGRESS', '[]', 350000, 0,
 '{{"plate":"{PLATE}","motoProgress":"repairing","symptom":["Thay dầu"],"laborFee":200000,"discount":0,"estimatedDue":"1 ngày"}}',
 NOW() - INTERVAL '2 hours', NOW(), 'MT-260831-002', 'Test Khach', '{OWNER_PHONE}'),
(gen_random_uuid()::text, 990001, '{SHOP_ID}', 'COMPLETED', '[]', 120000, 120000,
 '{{"plate":"{PLATE}","motoProgress":"picked_up"}}',
 NOW() - INTERVAL '30 days', NOW() - INTERVAL '29 days', 'MT-260831-003', 'Test Khach', '{OWNER_PHONE}')
""")


def main():
    started = datetime.now()
    records = []
    setup()

    with make_browser() as p:
        # ============ s1 匿名查询（正常路径）============
        ctx = new_context(p, tag="cust6")
        page = ctx.new_page()
        page.set_default_timeout(ASSERT_TIMEOUT)
        page.set_default_navigation_timeout(NAV_TIMEOUT)
        # 预置 locale cookie 跳过浏览器语言自动跳转
        page.goto(f"{BASE}/vi", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        ctx.add_cookies([{"name": "locale-picked", "value": "1", "url": BASE}])
        page.goto(f"{BASE}/vi/s/{SLUG}/lookup", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)

        def s1():
            page.get_by_text(T_TITLE, exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)
            page.get_by_placeholder(T_PLATE_PH).fill(PLATE)
            page.get_by_placeholder(T_TAIL_PH).fill(OWNER_PHONE[-4:])
            page.get_by_role("button", name=T_ANON_SUBMIT, exact=True).click(timeout=ASSERT_TIMEOUT)
            # 结果卡：车牌 + 进度「Đang sửa」+ 金额 350kđ
            body = page.locator("body")
            body.get_by_text(PLATE, exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)
            body.get_by_text(T_REPAIRING, exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)
            body.get_by_text(T_AMOUNT, exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)

        records.append(
            run_assertion(s1, "moto-s1", "匿名查询：车牌+手机号尾号 → 维修进度+金额", script_tag=SCRIPT_TAG, screenshot_page=page)
        )

        # ============ s2 匿名查询（尾号错误 → 拦截）============
        def s2():
            page.get_by_placeholder(T_TAIL_PH).fill("0000")
            page.get_by_role("button", name=T_ANON_SUBMIT, exact=True).click(timeout=ASSERT_TIMEOUT)
            page.get_by_text(T_PHONE_MISMATCH, exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)

        records.append(
            run_assertion(s2, "moto-s2", "匿名查询尾号错误 → 手机号不匹配拦截", script_tag=SCRIPT_TAG, screenshot_page=page)
        )

        # ============ s3 注册（走 registerCustomer）============
        def s3():
            # 切注册 tab（button type=button）
            page.locator("button[type='button']").filter(has_text=T_REGISTER_TAB).click(timeout=ASSERT_TIMEOUT)
            page.get_by_placeholder(T_NAME_PH).fill("Nguyễn Văn A")
            page.get_by_placeholder(T_PHONE_PH).fill(OWNER_PHONE)
            page.get_by_placeholder(T_PWD_PH).fill(OWNER_PWD)
            # 注册提交按钮（type=submit）
            page.locator("form").nth(0).locator("button[type='submit']").click(timeout=ASSERT_TIMEOUT)
            page.get_by_text(T_REGISTER_OK, exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)

        records.append(
            run_assertion(s3, "moto-s3", "注册客户账号（手机号+密码）→ 成功提示", script_tag=SCRIPT_TAG, screenshot_page=page)
        )

        # ============ s4 登录 → 跳转 my（未认领拦截）============
        def s4():
            # 幂等：重试场景下若已跳转 /my 则跳过登录动作（登录是一次性状态变化）
            if "/my" not in page.url:
                # 注册成功自动切回登录 tab，手机号保留，密码已清空需重填
                page.get_by_placeholder(T_PWD_PH).fill(OWNER_PWD)
                page.locator("form").nth(0).locator("button[type='submit']").click(timeout=ASSERT_TIMEOUT)
                page.wait_for_url(lambda url: "/my" in url, timeout=ACTION_TIMEOUT)
                page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)
            # 标题（heading 定位避开 __next-route-announcer__ 重复文本）
            page.get_by_role("heading", name=T_MY_TITLE, exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)
            # 查绑定内容必须先认领：此时无 ownerCustomerId → 空提示
            page.get_by_text(T_NO_VEHICLES, exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)

        records.append(
            run_assertion(s4, "moto-s4", "客户登录 → 跳转 /my + 未认领拦截（空车辆列表）", script_tag=SCRIPT_TAG, screenshot_page=page)
        )

        # ============ s5 认领车辆 → 车辆卡片（当前单+历史）============
        def s5():
            page.get_by_placeholder(T_PLATE_PH).fill(PLATE)
            page.get_by_role("button", name=T_CLAIM_BTN, exact=True).click(timeout=ASSERT_TIMEOUT)
            page.get_by_text(T_CLAIMED, exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)
            # 车辆卡片：品牌型号 + 当前在修单进度/金额 + 历史单
            body = page.locator("body")
            # 品牌型号可能带年份（Yamaha · Sirius · 2021），子串匹配
            body.get_by_text("Yamaha · Sirius").first.wait_for(state="visible", timeout=ACTION_TIMEOUT)
            body.get_by_text(T_REPAIRING, exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)
            body.get_by_text(T_AMOUNT, exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)
            # 历史维保行（含日期后缀，用正则子串匹配）
            body.locator("text=/MT-260831-003/").first.wait_for(state="visible", timeout=ACTION_TIMEOUT)

        records.append(
            run_assertion(s5, "moto-s5", "认领车辆 → 卡片显示当前在修单+历史维保", script_tag=SCRIPT_TAG, screenshot_page=page)
        )
        ctx.close()

        # ============ s6 DB 核验：Customer + ownerCustomerId 绑定 ============
        def s6():
            c = db_exec(f"SELECT id FROM \"Customer\" WHERE phone='{OWNER_PHONE}'")
            assert c, "Customer 未创建"
            cid = c[0]["value"]
            v = db_exec(f"SELECT \"ownerCustomerId\" FROM \"Vehicle\" WHERE \"shopId\"='{SHOP_ID}' AND \"plate\"='{PLATE}'")
            assert v and v[0]["value"] == cid, f"ownerCustomerId 未绑定: {v}"

        records.append(
            run_assertion(s6, "moto-s6", "DB 核验：Customer 建号 + Vehicle.ownerCustomerId 绑定", script_tag=SCRIPT_TAG, screenshot_page=None)
        )

        # ============ s7 陌生客户：未匹配车辆，认领报 notFound + 我的车辆仍空 ============
        ctx2 = new_context(p, tag="cust6b")
        page2 = ctx2.new_page()
        page2.set_default_timeout(ASSERT_TIMEOUT)
        page2.set_default_navigation_timeout(NAV_TIMEOUT)
        page2.goto(f"{BASE}/vi/s/{SLUG}/lookup", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)

        def s7():
            # 注册新客户（该手机号在 demo-moto 无车辆）
            page2.locator("button[type='button']").filter(has_text=T_REGISTER_TAB).click(timeout=ASSERT_TIMEOUT)
            page2.get_by_placeholder(T_NAME_PH).fill("Test Khach 2")
            page2.get_by_placeholder(T_PHONE_PH).fill(CUST2_PHONE)
            page2.get_by_placeholder(T_PWD_PH).fill(OWNER_PWD)
            page2.locator("form").nth(0).locator("button[type='submit']").click(timeout=ASSERT_TIMEOUT)
            page2.get_by_text(T_REGISTER_OK, exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)
            # 登录 → my
            page2.get_by_placeholder(T_PWD_PH).fill(OWNER_PWD)
            page2.locator("form").nth(0).locator("button[type='submit']").click(timeout=ASSERT_TIMEOUT)
            page2.wait_for_url(lambda url: "/my" in url, timeout=ACTION_TIMEOUT)
            page2.get_by_text(T_NO_VEHICLES, exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)
            # 认领不存在的车牌 → notFound
            page2.get_by_placeholder(T_PLATE_PH).fill("59X000000")
            page2.get_by_role("button", name=T_CLAIM_BTN, exact=True).click(timeout=ASSERT_TIMEOUT)
            page2.get_by_text("Không tìm thấy xe này", exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)

        records.append(
            run_assertion(s7, "moto-s7", "陌生客户：无匹配车辆 → 空列表 + 认领不存在车牌 notFound", script_tag=SCRIPT_TAG, screenshot_page=page2)
        )
        ctx2.close()

    ended = datetime.now()
    save_results(SCRIPT_TAG, FLOW, records, started, ended)
    return 0 if all(r.status != "FAIL" for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())
