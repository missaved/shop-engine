# -*- coding: utf-8 -*-
# 中台第 4 批子项 2 验收：6 语言（home / admin 文案 + 建店翻译框自动扩展）
import sys
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
ADMIN_PHONE = "0900000000"
ADMIN_PWD = "demo1234"

HOME_TITLES = {
    "zh": "轻量开单引擎",
    "zh-Hant": "輕量開單引擎",
    "en": "Lightweight Order Engine",
    "vi": "Công cụ bán hàng gọn nhẹ",
    "ms": "Enjin Pesanan Ringan",
    "th": "ระบบสั่งอาหารแบบเบา",
}
ADMIN_TITLES = {
    "zh": "平台运营",
    "zh-Hant": "平台營運",
    "en": "Platform Ops",
    "vi": "Vận hành",
    "ms": "Operasi Platform",
    "th": "ดูแลแพลตฟอร์ม",
}

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("✅ " if ok else "❌ ") + name + (f"  — {detail}" if detail else ""))


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()

        # 1. home 页 6 语言 title（公开，无需登录）
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()
        for loc, title in HOME_TITLES.items():
            page.goto(f"{BASE}/{loc}", wait_until="networkidle")
            body = page.inner_text("body")
            check(f"home 页 {loc} 文案", title in body, "")

        # 2. ADMIN 登录，验证 admin 页 6 语言 title（admin namespace 加载）
        page.goto(f"{BASE}/vi/login", wait_until="networkidle")
        page.fill("input[name=phone]", ADMIN_PHONE)
        page.fill("input[name=password]", ADMIN_PWD)
        page.click("button[type=submit]")
        page.wait_for_url("**/admin", timeout=15000)
        page.wait_for_load_state("networkidle")
        check("ADMIN 登录 → /admin", "/admin" in page.url, page.url)

        for loc, title in ADMIN_TITLES.items():
            page.goto(f"{BASE}/{loc}/admin", wait_until="networkidle")
            body = page.inner_text("body")
            check(f"admin 页 {loc} 文案", title in body, "")

        # 3. 建店表单翻译框自动扩展为 5 个非英文 locale（span.w-8 为翻译框 locale 标识）
        page.goto(f"{BASE}/vi/admin", wait_until="networkidle")
        n = page.locator("span.w-8").count()
        check("建店翻译框 5 个非英文 locale", n == 5, f"count={n}")

        ctx.close()
        b.close()

    summarize()


def summarize():
    fails = [r for r in results if not r[1]]
    print("\n" + "=" * 50)
    print(f"共 {len(results)} 项，通过 {len(results)-len(fails)}，失败 {len(fails)}")
    if fails:
        for n, _, d in fails:
            print(f"  - {n}: {d}")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
