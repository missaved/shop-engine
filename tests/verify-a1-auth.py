# -*- coding: utf-8 -*-
# 第 20 批 A1 集成验证：限流分层
#   A. owner 正常登录回归（5 次/60s 行为不变，不误伤正常登录）
#   B. admin 正常登录 → /admin（限流不误伤平台管理员）
#   C. admin 错误密码 ×3 → 锁定 → 第 4 次限流提示；锁定期间正确密码也被拦
import sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
OWNER_PHONE, OWNER_PWD = "0901234567", "demo1234"
ADMIN_PHONE, ADMIN_PWD = "0900000000", "demo1234"
# 浏览器 locale 协商可能落到 en/vi 等任意语言，匹配任一限流文案
RATE_TEXTS = ["Too many attempts", "Quá nhiều lần thử", "尝试次数过多"]
def is_rate(body):
    return any(t in body for t in RATE_TEXTS)

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("✅ " if ok else "❌ ") + name + (f"  — {detail}" if detail else ""))


def do_login(page, phone, pwd):
    page.fill("input[name=phone]", phone)
    page.fill("input[name=password]", pwd)
    page.click("button[type=submit]")


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()

        # A. owner 正常登录回归 → /{locale}/dashboard
        ctx = b.new_context()
        page = ctx.new_page()
        page.goto(f"{BASE}/vi/login", wait_until="networkidle")
        do_login(page, OWNER_PHONE, OWNER_PWD)
        try:
            page.wait_for_url("**/dashboard", timeout=15000)
            check("A owner 正常登录回归 → /dashboard", "dashboard" in page.url, page.url)
        except Exception as e:
            check("A owner 正常登录回归 → /dashboard", False, str(e)[:100])
        ctx.close()

        # B. admin 正常登录 → /{locale}/admin（限流不误伤平台管理员）
        ctx1 = b.new_context()
        page1 = ctx1.new_page()
        page1.goto(f"{BASE}/vi/login", wait_until="networkidle")
        do_login(page1, ADMIN_PHONE, ADMIN_PWD)
        try:
            page1.wait_for_url("**/admin", timeout=15000)
            check("B admin 正常登录 → /admin", "/admin" in page1.url, page1.url)
        except Exception as e:
            check("B admin 正常登录 → /admin", False, str(e)[:100])
        ctx1.close()

        # C. admin 错误密码：3 次锁定 → 第 4 次限流提示 → 锁定期间正确密码也被拦
        ctx2 = b.new_context()
        page2 = ctx2.new_page()
        page2.goto(f"{BASE}/vi/login", wait_until="networkidle")
        for i in range(1, 5):
            do_login(page2, ADMIN_PHONE, f"wrong{i}")
            page2.wait_for_timeout(500)  # 等前端 setError 渲染
            body = page2.inner_text("body")
            limited = is_rate(body)
            if i <= 3:
                check(f"C{i} 第 {i} 次错误→普通错误(未限流)", not limited,
                      "rateLimited" if limited else "普通错误")
            else:
                check(f"C{i} 第 {i} 次→限流提示", limited,
                      "限流文案" if limited else "无限流文案，body片段:" + body[:120])
        do_login(page2, ADMIN_PHONE, ADMIN_PWD)  # 正确密码，锁定期间也应被拦
        page2.wait_for_timeout(500)
        body = page2.inner_text("body")
        check("C5 锁定期间正确密码也被拦", is_rate(body),
              "限流文案" if is_rate(body) else "未被拦截，body片段:" + body[:120])
        ctx2.close()

    fails = [r for r in results if not r[1]]
    print(f"\n===== A1 集成验证: {len(results) - len(fails)}/{len(results)} 通过 =====")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
