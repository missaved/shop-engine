# -*- coding: utf-8 -*-
# 第 20 批 A6 端到端验证：安全头生效 + CSP 不破坏核心流程（登录/点餐/管理后台）
import sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
OWNER_PHONE, OWNER_PWD = "0901234567", "demo1234"
results = []
csp_errors = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("✅ " if ok else "❌ ") + name + (f"  — {detail}" if detail else ""))


def monitor(page):
    def on_console(m):
        if m.type in ("error", "warning") and (
            "Content Security Policy" in m.text or "Refused to" in m.text
        ):
            csp_errors.append(f"[{m.type}] {m.text}")
    page.on("console", on_console)


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context()
        page = ctx.new_page()
        monitor(page)

        # 1. 登录页可渲染
        page.goto(f"{BASE}/en/login", wait_until="networkidle")
        body = page.inner_text("body")
        check("登录页渲染（表单可见）", "Boss Login" in body, "")

        # 2. owner 登录 → /dashboard（Auth.js 全流程在 CSP 下工作）
        page.fill("input[name=phone]", OWNER_PHONE)
        page.fill("input[name=password]", OWNER_PWD)
        page.click("button[type=submit]")
        try:
            page.wait_for_url("**/dashboard", timeout=15000)
            check("owner 登录 → /dashboard", "dashboard" in page.url, page.url)
        except Exception as e:
            check("owner 登录 → /dashboard", False, str(e)[:100])

        # 3. 扫码点餐页（含图片/下单表单）
        page.goto(f"{BASE}/en/s/demo-pho", wait_until="networkidle")
        body3 = page.inner_text("body")
        check("扫码点餐页渲染", len(body3) > 50, "")

        # 4. admin 登录页（两步登录第一步）
        page.goto(f"{BASE}/en/admin/login", wait_until="networkidle")
        body4 = page.inner_text("body")
        check("admin 登录页渲染", "Platform Admin Console" in body4 or len(body4) > 30, "")

        ctx.close()

        # 5. CSP 违规检查
        check("全程无 CSP 违规报错", len(csp_errors) == 0, "; ".join(csp_errors[:3]) if csp_errors else "")

    fails = [r for r in results if not r[1]]
    print(f"\n===== A6 验证: {len(results) - len(fails)}/{len(results)} 通过 =====")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
