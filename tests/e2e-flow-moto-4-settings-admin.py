#!/usr/bin/env python3
# M4 设置 + admin 中台预设库 闭环验证：
#   老板端设置：本店服务预设（自建）/ 常见车型 / 收款信息 / 店铺信息 → Shop.config + Shop 落库
#   admin 中台：/admin/moto-presets 新增预设 + 停用 → MotoPreset 落库
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

SCRIPT_TAG = "moto-4-settings-admin"
FLOW = "moto 老板端设置 + admin 预设库"

SLUG = "demo-moto"
MOTO_PHONE = "0901122334"
MOTO_PWD = "demo1234"
ADMIN_PHONE = "0900000000"
ADMIN_PWD = "demo1234"


def moto_shop_id():
    rows = db_exec(f'SELECT id FROM "Shop" WHERE slug=\'{SLUG}\'')
    return rows[0]["value"] if rows else None


def cleanup():
    # 删除测试中台预设；店主设置改动（config/presets/commonModels/payment/name）为正常经营数据，保留
    db_exec(f'DELETE FROM "MotoPreset" WHERE "serviceKey"=\'test_preset_m4\'')
    unlock_user(MOTO_PHONE)
    unlock_user(ADMIN_PHONE)


def login(ctx, phone, pwd, is_admin=False):
    page = ctx.new_page()
    page.set_default_timeout(ASSERT_TIMEOUT)
    page.set_default_navigation_timeout(NAV_TIMEOUT)
    # owner 走前台 /vi/login；admin 走管理后台 /admin/vi/login（前台登录会拦截 admin 并提示去后台）
    entry = "/admin/vi/login" if is_admin else "/vi/login"
    page.goto(f"{BASE}{entry}", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.fill('input[name="phone"]', phone, timeout=ASSERT_TIMEOUT)
    page.fill('input[name="password"]', pwd, timeout=ASSERT_TIMEOUT)
    page.click('button[type="submit"]', timeout=ASSERT_TIMEOUT)
    page.wait_for_url(lambda url: "/login" not in url, timeout=ACTION_TIMEOUT)
    page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)
    return page


def main():
    started = datetime.now()
    records = []
    cleanup()

    with make_browser() as p:
        # ============ 老板端设置 ============
        ctx = new_context(p, tag="boss")
        boss = login(ctx, MOTO_PHONE, MOTO_PWD)

        # S1 进入设置页：点 ⚙️ → 出现「本店服务预设」
        def s1():
            boss.reload(wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            boss.get_by_role("button", name="Cài đặt", exact=True).click(timeout=ASSERT_TIMEOUT)
            boss.get_by_text("Dịch vụ của tiệm").wait_for(state="visible", timeout=ACTION_TIMEOUT)

        records.append(
            run_assertion(s1, "moto-s1", "进入设置页（服务预设 section）", script_tag=SCRIPT_TAG, screenshot_page=boss)
        )

        # S2 自建服务预设：填名称+价格 → Thêm → DB config.presets 出现
        def s2():
            sec = boss.locator("section").filter(has_text="Dịch vụ của tiệm")
            sec.get_by_placeholder("Tên dịch vụ").fill("Sơn lại vỏ")
            # 价格输入框无 placeholder，只有 label「Giá」
            sec.get_by_label("Giá").fill("180000")
            sec.get_by_role("button", name="Thêm").nth(1).click(timeout=ASSERT_TIMEOUT)
            boss.get_by_text("Đã lưu").wait_for(state="visible", timeout=ACTION_TIMEOUT)
            rows = db_exec(
                f'SELECT count(*) FROM "Shop" WHERE slug=\'{SLUG}\' AND config->\'presets\' @> \'[{{"name":"Sơn lại vỏ"}}]\'::jsonb'
            )
            assert rows and int(rows[0]["value"]) >= 1, rows

        records.append(
            run_assertion(s2, "moto-s2", "自建服务预设 → Shop.config.presets", script_tag=SCRIPT_TAG, screenshot_page=boss)
        )

        # S3 常见车型 + 收款 + 店铺信息 → 保存 → DB 落库
        def s3():
            models_sec = boss.locator("section").filter(has_text="Dòng xe thông dụng")
            models_sec.get_by_placeholder("Nhập dòng xe, Enter để thêm").fill("Honda SH")
            models_sec.get_by_role("button", name="Thêm").click(timeout=ASSERT_TIMEOUT)

            pay_sec = boss.locator("section").filter(has_text="Thanh toán")
            pay_sec.get_by_label("Ngân hàng").fill("Techcombank")
            pay_sec.get_by_label("Số tài khoản").fill("1903 8888 66")
            pay_sec.get_by_label("Chủ tài khoản").fill("NGUYEN VAN A")

            shop_sec = boss.locator("section").filter(has_text="Thông tin tiệm")
            shop_sec.get_by_label("Tên tiệm").fill("Demo Moto 88 (M4)")
            shop_sec.get_by_label("Số điện thoại").fill("0901122335")

            boss.get_by_role("button", name="Lưu tất cả").click(timeout=ASSERT_TIMEOUT)
            boss.get_by_text("Đã lưu").wait_for(state="visible", timeout=ACTION_TIMEOUT)

            r1 = db_exec(
                f'SELECT count(*) FROM "Shop" WHERE slug=\'{SLUG}\' AND config->\'commonModels\' @> \'["Honda SH"]\'::jsonb'
            )
            assert r1 and int(r1[0]["value"]) >= 1, r1
            r2 = db_exec(
                f'SELECT config->\'payment\'->\'bank\'->>\'bankName\' FROM "Shop" WHERE slug=\'{SLUG}\''
            )
            assert r2 and r2[0]["value"] == "Techcombank", r2
            r3 = db_exec(f'SELECT name, phone FROM "Shop" WHERE slug=\'{SLUG}\'')
            assert r3, r3
            parts = r3[0].get("cols", [])
            assert parts[0] == "Demo Moto 88 (M4)", parts
            assert parts[1] == "0901122335", parts

        records.append(
            run_assertion(s3, "moto-s3", "车型/收款/店铺信息保存 → DB", script_tag=SCRIPT_TAG, screenshot_page=boss)
        )
        ctx.close()

        # ============ admin 中台预设库 ============
        ctx2 = new_context(p, tag="admin")
        adm = login(ctx2, ADMIN_PHONE, ADMIN_PWD, is_admin=True)
        # admin 后台前缀是 /admin/[locale]，不是 /[locale]/admin
        adm.goto(f"{BASE}/admin/vi/moto-presets", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)

        # S4 新增预设 → DB MotoPreset 出现
        def s4():
            adm.get_by_text("Thư viện mẫu dịch vụ xe máy").wait_for(state="visible", timeout=ACTION_TIMEOUT)
            adm.get_by_role("button", name="Thêm mới").click(timeout=ASSERT_TIMEOUT)
            adm.get_by_label("Mã dịch vụ").fill("test_preset_m4")
            adm.get_by_label("Tên VI").fill("Thử nghiệm M4")
            adm.get_by_label("Tên ZH").fill("测试 M4")
            adm.get_by_label("Tên EN").fill("Test M4")
            adm.get_by_role("button", name="Lưu").click(timeout=ASSERT_TIMEOUT)
            rows = db_exec(f'SELECT "serviceKey" FROM "MotoPreset" WHERE "serviceKey"=\'test_preset_m4\'')
            assert rows and rows[0]["value"] == "test_preset_m4", rows

        records.append(
            run_assertion(s4, "moto-s4", "admin 新增 moto 预设 → MotoPreset", script_tag=SCRIPT_TAG, screenshot_page=adm)
        )

        # S5 停用 → MotoPreset.active=false
        def s5():
            row = adm.locator("tr").filter(has_text="test_preset_m4")
            row.get_by_role("button", name="Tắt").click(timeout=ASSERT_TIMEOUT)
            rows = db_exec(f'SELECT active FROM "MotoPreset" WHERE "serviceKey"=\'test_preset_m4\'')
            assert rows and rows[0]["value"] == "f", rows

        records.append(
            run_assertion(s5, "moto-s5", "admin 停用预设 → active=false", script_tag=SCRIPT_TAG, screenshot_page=adm)
        )
        ctx2.close()

    ended = datetime.now()
    save_results(SCRIPT_TAG, FLOW, records, started, ended)
    return 0 if all(r.status != "FAIL" for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())
