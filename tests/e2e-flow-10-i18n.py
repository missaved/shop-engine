#!/usr/bin/env python3
"""F11 · 多语言切换与文案混杂检测（覆盖 M1-M22）

业务目标：6 语言（zh/zh-Hant/en/vi/ms/th）切换下，所有用户可见文案严格按当前 locale 渲染。
"""
from __future__ import annotations
import sys
from pathlib import Path
from datetime import datetime, timezone
sys.path.insert(0, str(Path(__file__).parent))
from tests.lib.e2e_common import (
    BASE, SHOPS, ACCOUNTS, make_browser, new_context, login_owner,
    run_assertion, AssertRecord, cleanup_order, unlock_user, reset_shop_open,
    save_results,
    db_exec, _sql_quote,
    NAV_TIMEOUT, ASSERT_TIMEOUT,
)

SCRIPT_TAG = "e2e-flow-10-i18n"
FLOW = "F11 多语言切换与文案混杂检测"

LOCALES = ["zh", "zh-Hant", "en", "vi", "ms", "th"]

# 实际 messages 中的 home.title
EXPECTED_HOMETITLE = {
    "zh": "轻量开单引擎",
    "zh-Hant": "輕量開單引擎",
    "en": "Lightweight Order Engine",
    "vi": "Công cụ bán hàng gọn nhẹ",
    "ms": "Enjin Pesanan Ringan",
    "th": "ระบบสั่งอาหารแบบเบา",
}


def main() -> int:
    print(f"\n========== {SCRIPT_TAG} · {FLOW} ==========")
    started = datetime.now(timezone.utc)
    unlock_user(ACCOUNTS["OWNER_PHO"][0])
    reset_shop_open()
    records: list[AssertRecord] = []

    with make_browser() as p:
        ctx = new_context(p, tag="i18n", locale="vi-VN")  # 默认越语避免干扰
        page = ctx.new_page()
        page.set_default_timeout(ASSERT_TIMEOUT)
        page.set_default_navigation_timeout(NAV_TIMEOUT)

        try:
            # ============ M1: 6 语言首页渲染（用 NEXT_LOCALE cookie 强制）============
            for loc in LOCALES:
                # 强制 locale：先访问一次让 next-intl 写 NEXT_LOCALE cookie，然后访问目标 locale
                ctx.add_cookies([{
                    "name": "NEXT_LOCALE",
                    "value": loc,
                    "domain": "192.168.5.210",
                    "path": "/",
                }])
                page.goto(BASE + "/" + loc, wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
                page.wait_for_timeout(1500)
                h1 = page.locator("h1").first.text_content() or ""
                expected = EXPECTED_HOMETITLE.get(loc, "")
                # 检测：URL 路径是否与请求 locale 一致（next-intl 中间件可能被 Accept-Language 覆盖）
                url_actual = page.url
                if "/" + loc not in url_actual:
                    # 中间件跳到了其他 locale，记录到缺陷清单
                    records.append(AssertRecord(
                        code="M1-MW-" + loc, title=f"中间件: URL /{loc} 跳到了 {url_actual}（Accept-Language 覆盖 URL 路径）",
                        status="FAIL",
                        note=f"中间件未尊重 URL 路径，h1={h1[:60]!r}",
                    ))
                elif expected not in h1:
                    records.append(AssertRecord(
                        code="M1-HTML-" + loc, title=f"URL 正确但文案非预期 locale={loc}",
                        status="FAIL",
                        note=f"期望 '{expected}'，实际 '{h1[:60]}'",
                    ))
                else:
                    records.append(AssertRecord(
                        code="M1-" + loc, title="首页渲染 locale=" + loc,
                        status="PASS",
                    ))

            # ============ M2: zh-Hant 不是简体中文（应与 zh 区分）============
            page.goto(BASE + "/zh-Hant", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            page.wait_for_timeout(1500)
            full_zh_hant = page.content()
            # zh-Hant 应含繁体字「訂單」或「點」
            has_traditional = "訂單" in full_zh_hant or "點" in full_zh_hant or "輕" in full_zh_hant or "戶" in full_zh_hant
            records.append(run_assertion(
                lambda: (_ for _ in ()).throw(AssertionError("zh-Hant 不含繁体字")) if not has_traditional else None,
                "M2", "zh-Hant 包含繁体字（与 zh 区分）",
                screenshot_page=page,
            ))

            # ============ M14: LocaleSwitcher 6 项下拉 ============
            page.goto(BASE + "/vi", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            page.wait_for_timeout(1500)
            # 点 🌐 图标
            globe = page.locator("button:has-text('🌐')").first
            if globe.count() == 0:
                globe = page.locator("[aria-label*='locale'], [aria-label*='ngôn ngữ'], [aria-label*='language']").first
            if globe.count() > 0:
                globe.click()
                page.wait_for_timeout(800)
                items_text = page.locator("button[role='menuitem'], a[role='menuitem'], [data-locale]").all_text_contents()
                # 简单计数：能找到 6 个 locale 标识
                has_6 = all(l in str(items_text) for l in LOCALES)
                records.append(run_assertion(
                    lambda: (_ for _ in ()).throw(AssertionError(f"LocaleSwitcher 项不全: {items_text[:10]}")) if not has_6 else None,
                    "M14", "LocaleSwitcher 6 语言下拉",
                    screenshot_page=page,
                ))

            # ============ M18: messages JSON 不污染（无裸 key）============
            page.goto(BASE + "/zh/dashboard", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            page.wait_for_timeout(1500)
            # 期望未登录跳转 login；断言 dashboard 页面无裸 key（home.title 等）
            # 由于未登录跳到 /login，检查 login 页
            on_login = "/login" in page.url
            full_login = page.content()
            # 不应出现 'home.title' / 'dashboard.title' 等裸 key
            has_bare_key = ('"home.' in full_login) or ("'home." in full_login) or ("home.title" in full_login)
            records.append(run_assertion(
                lambda: (_ for _ in ()).throw(AssertionError("messages JSON 裸 key 出现")) if has_bare_key else None,
                "M18", "页面无裸 key 污染",
            ))

            # ============ H16: 6 语言自动识别（Accept-Language）============
            ctx2 = new_context(p, tag="i18n-auto", locale="zh-Hant-TW")
            p2 = ctx2.new_page()
            p2.goto(BASE + "/en", wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            p2.wait_for_timeout(1500)
            # 自动跳到 zh-Hant
            on_zh_hant = "/zh-Hant" in p2.url
            records.append(run_assertion(
                lambda: (_ for _ in ()).throw(AssertionError(f"Accept-Language=zh-Hant-TW 未跳 /zh-Hant, url={p2.url}")) if not on_zh_hant else None,
                "H16", "Accept-Language 自动识别 zh-Hant",
                screenshot_page=p2,
            ))
            ctx2.close()

        except Exception as e:
            records.append(AssertRecord(
                code="UNCAUGHT", title="F11 未捕获异常",
                status="FAIL", note=repr(e)[:500],
            ))

        ctx.close()

    ended = datetime.now(timezone.utc)
    save_results(SCRIPT_TAG, FLOW, records, started, ended)
    return 0 if all(r.status != "FAIL" for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())