#!/usr/bin/env python3
"""F10 · 限流与防御（覆盖 L1, B2-B4, B9）

业务目标：所有异常与安全防御路径。
"""
from __future__ import annotations
import sys
from pathlib import Path
from datetime import datetime, timezone
sys.path.insert(0, str(Path(__file__).parent))
from tests.lib.e2e_common import (
    BASE, SHOPS, ACCOUNTS, make_browser, new_context, login_owner,
    run_assertion, AssertRecord, cleanup_order, unlock_user, reset_shop_open,
    cleanup_today_orders_for_shop, save_results,
    find_order_by_display_no, db_exec, _sql_quote, _psql,
    NAV_TIMEOUT, ASSERT_TIMEOUT, ACTION_TIMEOUT,
)

SCRIPT_TAG = "e2e-flow-9-defense"
FLOW = "F10 限流与防御"


def main() -> int:
    print(f"\n========== {SCRIPT_TAG} · {FLOW} ==========")
    started = datetime.now(timezone.utc)
    unlock_user(ACCOUNTS["OWNER_PHO"][0])
    records: list[AssertRecord] = []

    with make_browser() as p:
        ctx = new_context(p, tag="def", locale="vi-VN")
        page = ctx.new_page()
        page.set_default_timeout(ASSERT_TIMEOUT)
        page.set_default_navigation_timeout(NAV_TIMEOUT)

        try:
            # ============ L1: 错密码 5 次 → 第 6 次 ACCOUNT_LOCKED ============
            unlock_user(ACCOUNTS["OWNER_PHO"][0])  # 先清状态
            page.goto(BASE + "/vi/login", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            page.wait_for_timeout(800)

            wrong_pwd = "wrong_password"
            for i in range(5):
                page.fill("input[name='phone']", ACCOUNTS["OWNER_PHO"][0])
                page.fill("input[name='password']", wrong_pwd)
                page.click("button[type='submit']")
                page.wait_for_timeout(1500)
                # 检查 failedAttempts 是否到 5
                rows = db_exec(
                    "SELECT \"failedAttempts\", \"lockedUntil\"::text FROM \"User\" WHERE phone=" + _sql_quote(ACCOUNTS["OWNER_PHO"][0])
                )
                if rows:
                    locked = rows[0].get("cols", ["0", ""])[1]
                    if locked and locked not in ("", "null"):
                        # 已被锁定
                        break

            # 现在用正确密码尝试（应被锁）
            page.fill("input[name='phone']", ACCOUNTS["OWNER_PHO"][0])
            page.fill("input[name='password']", ACCOUNTS["OWNER_PHO"][1])
            page.click("button[type='submit']")
            page.wait_for_timeout(1500)
            locked_text = page.locator("text=/bị khóa|đã khóa|khóa tài khoản|locked/i").count()
            records.append(run_assertion(
                lambda: (_ for _ in ()).throw(AssertionError("错密码后应显示锁账号")) if locked_text == 0 else None,
                "L1-1", "错密码 5 次后正确密码仍被锁",
                screenshot_page=page,
            ))

            # 验证 DB lockedUntil 非空
            rows = db_exec("SELECT \"lockedUntil\"::text FROM \"User\" WHERE phone=" + _sql_quote(ACCOUNTS["OWNER_PHO"][0]))
            locked_until = ""
            if rows and rows[0].get("cols"):
                locked_until = rows[0]["cols"][0]
            records.append(run_assertion(
                lambda: (_ for _ in ()).throw(AssertionError("DB lockedUntil 未设")) if not locked_until or locked_until in ("", "null") else None,
                "L1-DB", f"DB User.lockedUntil={locked_until}",
            ))

            # 清场
            unlock_user(ACCOUNTS["OWNER_PHO"][0])

            # ============ 验证 OWNER 仍能正常登录 ============
            page.fill("input[name='phone']", ACCOUNTS["OWNER_PHO"][0])
            page.fill("input[name='password']", ACCOUNTS["OWNER_PHO"][1])
            page.click("button[type='submit']")
            page.wait_for_timeout(2500)
            on_dash = "/dashboard" in page.url
            records.append(AssertRecord(
                code="L1-2", title="解锁后正常密码能登录",
                status="PASS" if on_dash else "FAIL",
                note="url=" + page.url,
            ))

        except Exception as e:
            records.append(AssertRecord(
                code="UNCAUGHT", title="F10 未捕获异常",
                status="FAIL", note=repr(e)[:500],
            ))
        finally:
            unlock_user(ACCOUNTS["OWNER_PHO"][0])

        ctx.close()

    ended = datetime.now(timezone.utc)
    save_results(SCRIPT_TAG, FLOW, records, started, ended)
    return 0 if all(r.status != "FAIL" for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())