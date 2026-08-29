#!/usr/bin/env python3
"""E2E 测试共享模块：fixtures + 复测机制 + DB 助手 + 安全超时

约定：
- 所有 Playwright 操作有显式 timeout（避免 headless 卡死）
- 所有断言失败自动 retry 3 次（防误报）
- DB 局部清理（不动 ADMIN / 其他测试店）
- 跨流程不互相污染

注意：本环境无 psycopg2，DB 助手走 subprocess 调 psql。
"""
from __future__ import annotations

import json
import os
import shlex
import subprocess
import time
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Callable, Optional

from playwright.sync_api import sync_playwright, Page, BrowserContext, TimeoutError as PWTimeout

# ============ 常量 ============

BASE = "http://192.168.5.210:3000"
PG_HOST = "127.0.0.1"
PG_PORT = "5433"
PG_USER = "shop_engine"
PG_PASS = "shop_engine_dev"
PG_DB = "shop_engine"
PG_ENV = dict(os.environ, PGPASSWORD=PG_PASS)

ACCOUNTS = {
    "OWNER_PHO": ("0901234567", "demo1234"),
    "OWNER_CAFE": ("0901234568", "demo1234"),
    "OWNER_DELIVERY": ("0901234569", "demo1234"),
    # ADMIN 跳过
}
SHOPS = {"PHO": "demo-pho", "CAFE": "demo-cafe", "DELIVERY": "demo-delivery"}

# 超时（秒）—— 显式硬上限避免卡死
NAV_TIMEOUT = 15000        # 普通页面跳转 15s
POLL_TIMEOUT = 8000        # 轮询 / ajax
ACTION_TIMEOUT = 10000     # server action 提交 10s
ASSERT_TIMEOUT = 5000      # 元素断言 5s
DB_TIMEOUT = 8            # 单条 SQL

# 复测
RETRY_MAX = 3
RETRY_BASE_SLEEP = 2

# 路径
RESULTS_DIR = Path(__file__).parent.parent / "results"
SCREENSHOTS_DIR = Path(__file__).parent.parent / "screenshots"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

VIET_OFFSET = timedelta(hours=7)


# ============ 时间 ============

def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_vn() -> datetime:
    return datetime.now(timezone.utc) + VIET_OFFSET


def today_vn_str() -> str:
    return now_vn().strftime("%Y-%m-%d")


# ============ 结果聚合 ============

@dataclass
class AssertRecord:
    code: str
    title: str
    status: str  # PASS | PASS_AFTER_RETRY | FAIL | SKIPPED
    note: str = ""
    attempts: list[dict] = field(default_factory=list)
    duration_ms: int = 0


# ============ DB 助手（psql subprocess） ============

def _sql_quote(s: Any) -> str:
    """SQL 字符串安全转义（单引号 + 反斜杠）。"""
    if s is None:
        return "NULL"
    if isinstance(s, (int, float)):
        return str(s)
    return "'" + str(s).replace("\\", "\\\\").replace("'", "''") + "'"


def _psql(sql: str) -> list[dict]:
    """执行 SQL（调用方需自己转义参数；helpers 已用 _sql_quote）。"""
    cmd = [
        "psql",
        "-h", PG_HOST,
        "-p", PG_PORT,
        "-U", PG_USER,
        "-d", PG_DB,
        "-A", "-t", "-F", "\t",  # 不对齐 + tab 分隔
        "-c", sql,
    ]
    proc = subprocess.run(
        cmd,
        env=PG_ENV,
        capture_output=True,
        text=True,
        timeout=DB_TIMEOUT,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"psql failed: {proc.stderr.strip()}\nSQL: {sql[:200]}")
    out = []
    for line in proc.stdout.strip().splitlines():
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) == 1:
            out.append({"value": parts[0]})
        else:
            out.append({"cols": parts})
    return out


def db_exec(sql: str) -> list[dict]:
    return _psql(sql)


def shop_id_by_slug(slug: str) -> Optional[str]:
    rows = _psql(f"SELECT id FROM \"Shop\" WHERE slug={_sql_quote(slug)}")
    return rows[0]["value"] if rows else None


def find_order_by_display_no(display_no: str) -> Optional[dict]:
    """返回单条 Order 的关键字段（dict）。psql tab 分隔手动解析。"""
    sql = f"""
SELECT id, "shopId", status, total::text, "paidAmount"::text, "customerPhone", "customerName", note, "displayNo", "orderNo", config::text
FROM "Order" WHERE "displayNo"={_sql_quote(display_no)}
"""
    rows = _psql(sql)
    if not rows:
        return None
    parts = rows[0].get("cols", [])
    keys = ["id", "shopId", "status", "total", "paidAmount", "customerPhone", "customerName", "note", "displayNo", "orderNo", "config"]
    return dict(zip(keys, parts))


def find_reminders(order_id: str) -> list[dict]:
    sql = f"""
SELECT "templateKey", status, payload::text, "dueAt"::text
FROM "Reminder" WHERE "orderId"={_sql_quote(order_id)} ORDER BY "dueAt" DESC
"""
    rows = _psql(sql)
    out = []
    for r in rows:
        parts = r.get("cols", [])
        out.append({
            "templateKey": parts[0] if len(parts) > 0 else "",
            "status": parts[1] if len(parts) > 1 else "",
            "payload": parts[2] if len(parts) > 2 else "",
            "dueAt": parts[3] if len(parts) > 3 else "",
        })
    return out


def cleanup_order(display_no: str) -> None:
    """删除订单 + 关联 reminder"""
    order = find_order_by_display_no(display_no)
    if not order:
        return
    oid = order["id"]
    sql = f"""
DELETE FROM "Reminder" WHERE "orderId"={_sql_quote(oid)};
DELETE FROM "Order" WHERE id={_sql_quote(oid)};
"""
    try:
        _psql(sql)
    except Exception:
        pass


def unlock_user(phone: str) -> None:
    sql = f"""UPDATE "User" SET "failedAttempts"=0, "lockedUntil"=NULL WHERE phone={_sql_quote(phone)}"""
    try:
        _psql(sql)
    except Exception:
        pass


def reset_shop_open() -> None:
    sql = f"""UPDATE "Shop" SET open=true WHERE slug IN ('{SHOPS["PHO"]}','{SHOPS["CAFE"]}','{SHOPS["DELIVERY"]}')"""
    try:
        _psql(sql)
    except Exception:
        pass


def reset_demo_pho_settings() -> None:
    """把 demo-pho config 重置为种子值（F7 测试后用）"""
    sql = f"""UPDATE "Shop" SET config = jsonb_set(
  jsonb_set(config, '{{openHours}}', '"00:00-23:00"'),
  '{{minOrderAmount}}', '50000'
) WHERE slug={_sql_quote(SHOPS['PHO'])}"""
    try:
        _psql(sql)
    except Exception:
        pass


def cleanup_today_orders_for_shop(slug: str) -> None:
    sid = shop_id_by_slug(slug)
    if not sid:
        return
    day_prefix = today_vn_str()[2:].replace("-", "")  # YYMMDD
    pattern = f"CP-{day_prefix}-%"
    sql = f"""
DELETE FROM "Reminder" WHERE "orderId" IN (
  SELECT id FROM "Order" WHERE "shopId"={_sql_quote(sid)} AND "displayNo" LIKE '{pattern}'
);
DELETE FROM "Order" WHERE "shopId"={_sql_quote(sid)} AND "displayNo" LIKE '{pattern}';
"""
    try:
        _psql(sql)
    except Exception:
        pass


# ============ 复测机制 ============

def run_assertion(
    check_fn: Callable[[], Any],
    code: str,
    title: str,
    max_retry: int = RETRY_MAX,
    script_tag: str = "e2e",
    screenshot_page: Optional[Page] = None,
) -> AssertRecord:
    """单条断言：首次失败 → 自动 retry 3 次。
    - PASS: 首次成功
    - PASS_AFTER_RETRY: 首次失败，复测后成功（写入可疑清单）
    - FAIL: 3 次复测全部失败（写入缺陷清单）
    """
    start = time.time()
    failures: list[dict] = []
    last_err: Optional[str] = None

    for attempt in range(1, max_retry + 1):
        try:
            check_fn()
            duration = int((time.time() - start) * 1000)
            if attempt == 1:
                return AssertRecord(
                    code=code, title=title, status="PASS",
                    duration_ms=duration,
                )
            else:
                return AssertRecord(
                    code=code, title=title, status="PASS_AFTER_RETRY",
                    note=f"第 {attempt} 次复测成功（首次失败）",
                    attempts=failures,
                    duration_ms=duration,
                )
        except Exception as e:
            last_err = repr(e)
            shot_path = ""
            if screenshot_page is not None:
                try:
                    shot_path = str(SCREENSHOTS_DIR / f"{script_tag}-{code}-attempt{attempt}.png")
                    screenshot_page.screenshot(path=shot_path, timeout=2500)
                except Exception:
                    shot_path = "(screenshot failed)"
            failures.append({
                "attempt": attempt,
                "error": last_err[:500],
                "screenshot": shot_path,
            })
            if attempt < max_retry:
                time.sleep(RETRY_BASE_SLEEP + attempt)

    duration = int((time.time() - start) * 1000)
    return AssertRecord(
        code=code, title=title, status="FAIL",
        note=f"3 次复测全部失败: {last_err[:300]}",
        attempts=failures,
        duration_ms=duration,
    )


# ============ Playwright ============

def make_browser():
    return sync_playwright()


def new_context(p, locale: str = "vi-VN", tag: str = "ctx") -> BrowserContext:
    """启动一个 Chromium context。所有 timeout 在 common 常量里。"""
    user_dir = f"/tmp/pw-{tag}-{uuid.uuid4().hex[:8]}"
    ctx = p.chromium.launch_persistent_context(
        user_data_dir=user_dir,
        headless=True,
        args=[
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-web-security",  # clipboard + window.open 调试
        ],
        permissions=["clipboard-read", "clipboard-write", "notifications"],
        viewport={"width": 1280, "height": 800},
        locale=locale,
        timezone_id="Asia/Ho_Chi_Minh",
        accept_downloads=True,
        ignore_https_errors=True,
    )
    ctx.set_default_timeout(ASSERT_TIMEOUT)
    ctx.set_default_navigation_timeout(NAV_TIMEOUT)
    return ctx


def goto(page: Page, path: str, timeout: int = NAV_TIMEOUT) -> None:
    """带超时的 goto"""
    page.goto(f"{BASE}{path}", wait_until="domcontentloaded", timeout=timeout)


def login_owner(ctx: BrowserContext, locale: str = "vi") -> Page:
    """完整登录 OWNER，返回 page（已跳到 /dashboard）"""
    phone, pwd = ACCOUNTS["OWNER_PHO"]
    page = ctx.new_page()
    page.set_default_timeout(ASSERT_TIMEOUT)
    page.set_default_navigation_timeout(NAV_TIMEOUT)
    page.goto(f"{BASE}/{locale}/login", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.fill('input[name="phone"]', phone, timeout=ASSERT_TIMEOUT)
    page.fill('input[name="password"]', pwd, timeout=ASSERT_TIMEOUT)
    page.click('button[type="submit"]', timeout=ASSERT_TIMEOUT)
    page.wait_for_url(lambda url: "/login" not in url, timeout=ACTION_TIMEOUT)
    page.wait_for_load_state("domcontentloaded", timeout=NAV_TIMEOUT)
    return page


# ============ 结果输出 ============

def save_results(script: str, flow: str, records: list[AssertRecord], started: datetime, ended: datetime) -> Path:
    by_status = {"PASS": 0, "PASS_AFTER_RETRY": 0, "FAIL": 0, "SKIPPED": 0}
    for r in records:
        by_status[r.status] = by_status.get(r.status, 0) + 1

    payload = {
        "flow": flow,
        "script": script,
        "started_at": started.isoformat(),
        "ended_at": ended.isoformat(),
        "duration_sec": int((ended - started).total_seconds()),
        "summary": {
            "total": len(records),
            "pass_first_try": by_status["PASS"],
            "pass_after_retry": by_status["PASS_AFTER_RETRY"],
            "fail_after_3_retries": by_status["FAIL"],
            "skipped": by_status["SKIPPED"],
        },
        "results": [asdict(r) for r in records],
        "flaky_list": [asdict(r) for r in records if r.status == "PASS_AFTER_RETRY"],
        "defects": [asdict(r) for r in records if r.status == "FAIL"],
    }

    out = RESULTS_DIR / f"{script}.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
    print(f"\n=== {script} ({flow}) ===")
    print(f"  total={len(records)}  PASS={by_status['PASS']}  PASS_AFTER_RETRY={by_status['PASS_AFTER_RETRY']}  FAIL={by_status['FAIL']}  SKIPPED={by_status['SKIPPED']}")
    if by_status["FAIL"] > 0:
        print(f"  ⚠️  {by_status['FAIL']} defects need fixing (see {out})")
    print(f"  results → {out}")
    return out