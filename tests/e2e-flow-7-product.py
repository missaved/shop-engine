#!/usr/bin/env python3
"""F8 · 商品 CRUD（覆盖 S7-S10）

业务目标：老板商品全生命周期管理 + 客户菜单同步。
"""
from __future__ import annotations
import sys, re, urllib.parse, uuid
from pathlib import Path
from datetime import datetime, timezone
sys.path.insert(0, str(Path(__file__).parent))
from tests.lib.e2e_common import (
    BASE, SHOPS, ACCOUNTS, make_browser, new_context, login_owner,
    run_assertion, AssertRecord, cleanup_order, unlock_user, reset_shop_open,
    cleanup_today_orders_for_shop, save_results,
    find_order_by_display_no, find_reminders, db_exec, _sql_quote, _psql,
    NAV_TIMEOUT, ASSERT_TIMEOUT, ACTION_TIMEOUT,
)

SCRIPT_TAG = "e2e-flow-7-product"
FLOW = "F8 商品 CRUD"
SLUG = SHOPS["PHO"]


def main() -> int:
    print(f"\n========== {SCRIPT_TAG} · {FLOW} ==========")
    started = datetime.now(timezone.utc)
    cleanup_today_orders_for_shop(SLUG)
    unlock_user(ACCOUNTS["OWNER_PHO"][0])
    reset_shop_open()
    records: list[AssertRecord] = []

    sid = db_exec(f"SELECT id FROM \"Shop\" WHERE slug={_sql_quote(SLUG)}")[0]["value"]
    test_name = f"Test Phở {uuid.uuid4().hex[:6]}"

    with make_browser() as p:
        boss_ctx = new_context(p, tag="boss", locale="vi-VN")
        boss = login_owner(boss_ctx, "vi")
        boss.wait_for_timeout(1500)

        try:
            # 打开抽屉
            side_btn = boss.locator("button:has-text('Phở Demo 88')").first
            if side_btn.count() > 0:
                side_btn.click()
                boss.wait_for_timeout(800)

            # ============ S7: 新增商品（Form 文本框）============
            # 「+ Thêm món」按钮
            add_btn = boss.locator("button:has-text('Thêm món')").first
            records.append(run_assertion(
                lambda: (_ for _ in ()).throw(AssertionError("无新增商品按钮")) if add_btn.count() == 0 else None,
                "S7-1", "设置面板有「Thêm món」新增按钮",
                screenshot_page=boss,
            ))

            # 找表单输入框
            inputs = boss.evaluate("""() => {
              const sel = (sel) => Array.from(document.querySelectorAll(sel));
              const labels = sel('label').map(l => l.textContent || '');
              const allInputs = sel('input,textarea');
              return allInputs.map((el, i) => ({
                tag: el.tagName, type: el.type, name: el.name, placeholder: el.placeholder, idx: i, label: labels[i] || ''
              }));
            }""")
            print(f"  form inputs: {inputs[:5]}")
            # 找名称输入框（placeholder 一般含 "Tên" 或 "Name"）
            name_input = boss.locator("input[placeholder*='Tên'], input[placeholder*='Name']").first
            if name_input.count() > 0:
                name_input.fill(test_name, timeout=3000)
                boss.wait_for_timeout(300)

            # 价格输入框（type=number 且 placeholder 含 giá / giá / Price）
            price_input = boss.locator("input[type='number']").first
            if price_input.count() > 0:
                price_input.fill("50000", timeout=3000)
                boss.wait_for_timeout(300)

            # 提交（按钮文字可能是 "Lưu" / "Thêm" / "保存"）
            save_btn = boss.locator("button:has-text('Lưu'):not(:has-text('Thêm'))").first
            if save_btn.count() == 0:
                save_btn = boss.locator("button:has-text('Lưu')").first
            if save_btn.count() == 0:
                save_btn = boss.locator("button[type='submit']:not([disabled])").first
            records.append(run_assertion(
                lambda: (_ for _ in ()).throw(AssertionError("无保存按钮")) if save_btn.count() == 0 else None,
                "S7-2", "新增表单有保存按钮",
                screenshot_page=boss,
            ))

            if save_btn.count() > 0:
                try:
                    save_btn.click(timeout=5000)
                    boss.wait_for_timeout(2500)
                except Exception:
                    pass

            # 验证 DB
            rows = db_exec(f"SELECT name, price::text, active FROM \"Product\" WHERE \"shopId\"={_sql_quote(sid)} AND name={_sql_quote(test_name)}")
            records.append(run_assertion(
                lambda: (_ for _ in ()).throw(AssertionError(f"新商品未落库: rows={rows}")) if not rows else None,
                "S7-DB", f"新增商品 [{test_name}] 落库",
            ))

            # ============ S10: 售罄切换（UI 按钮）============
            # 找新商品的售罄切换按钮（Hết hàng / Đang bán）
            sold_out_btn = boss.locator(f"button:has-text('Hết hàng'), button:has-text('Đang bán')").first
            records.append(run_assertion(
                lambda: (_ for _ in ()).throw(AssertionError("无售罄按钮")) if sold_out_btn.count() == 0 else None,
                "S10-1", "商品列表有售罄按钮",
                screenshot_page=boss,
            ))

            # ============ S9: 删除新商品 ============
            del_btn = boss.locator(f"button:has-text('Xóa')").first
            if del_btn.count() > 0:
                try:
                    del_btn.click()
                    boss.wait_for_timeout(500)
                    # confirm 弹窗
                    boss.on("dialog", lambda d: d.accept())
                    boss.wait_for_timeout(1500)
                except Exception:
                    pass
            # 验证 DB 已删
            rows = db_exec(f"SELECT id FROM \"Product\" WHERE name={_sql_quote(test_name)}")
            records.append(AssertRecord(
                code="S9-DB", title=f"删除商品 [{test_name}] 落库清理",
                status="PASS" if not rows else "FAIL",
                note=f"残留 rows={rows}",
            ))

        except Exception as e:
            records.append(AssertRecord(
                code="UNCAUGHT", title="F8 未捕获异常",
                status="FAIL", note=repr(e)[:500],
            ))
        finally:
            # 清场
            _psql(f"DELETE FROM \"Product\" WHERE name={_sql_quote(test_name)}")

        boss_ctx.close()

    ended = datetime.now(timezone.utc)
    save_results(SCRIPT_TAG, FLOW, records, started, ended)
    return 0 if all(r.status != "FAIL" for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())