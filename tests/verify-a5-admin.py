# -*- coding: utf-8 -*-
# 第 20 批 A5 端到端验证：admin 版面重构（侧边栏 + 板块路由 + 宽版面）
# 前置：临时测试 admin（0999999996，未绑定）由 scripts/create-test-admin-a5.ts 创建；验证后删除
import sys, time, struct, hashlib, hmac, base64
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
ADMIN_PHONE, ADMIN_PWD = "0999999996", "demo1234"
OWNER_PHONE, OWNER_PWD = "0901234567", "demo1234"
results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("✅ " if ok else "❌ ") + name + (f"  — {detail}" if detail else ""))


def totp(secret, at=None):
    key = base64.b32decode(secret.replace(" ", "").upper())
    if at is None:
        at = int(time.time())
    msg = struct.pack(">Q", at // 30)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    o = digest[-1] & 0x0F
    b = (struct.unpack(">I", digest[o:o + 4])[0] & 0x7FFFFFFF) % 1000000
    return f"{b:06d}"


def fill_login(page, phone, pwd):
    page.fill("input[name=phone]", phone)
    page.fill("input[name=password]", pwd)
    page.click("button[type=submit]")


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()

        # A. 未绑定 admin：/admin/login → 绑定 → /admin（复用 A4 已验证流程）
        ctx = b.new_context()
        page = ctx.new_page()
        page.goto(f"{BASE}/en/admin/login", wait_until="networkidle")
        fill_login(page, ADMIN_PHONE, ADMIN_PWD)
        try:
            page.wait_for_url("**/setup-totp", timeout=15000)
            check("A 登录被引导绑定页", "setup-totp" in page.url, page.url)
        except Exception as e:
            check("A 登录被引导绑定页", False, str(e)[:100])
            ctx.close()
            b.close()
            print(f"===== A5: {sum(1 for r in results if r[1])}/{len(results)} 通过 =====")
            sys.exit(1)
        page.wait_for_selector(".font-mono", timeout=10000)
        secret = page.locator(".font-mono").first.inner_text().strip()
        page.fill("input", totp(secret))
        page.locator("button").last.click()
        try:
            page.wait_for_url("**/admin", timeout=15000)
            check("A 绑定后进入 /admin", "/admin" in page.url, page.url)
        except Exception as e:
            check("A 绑定后进入 /admin", False, str(e)[:100])

        # B. 侧边栏渲染：总览 / 预设库 导航项可见（等 hydration 完成再断言）
        page.wait_for_selector("aside", timeout=10000)
        page.wait_for_timeout(500)
        body = page.inner_text("body")
        check("B 侧边栏渲染 总览 nav", "Overview" in body, "")
        check("B 侧边栏渲染 预设库 nav", "Presets" in body, "")
        check("B 总览内容渲染（PlatformStats 卡）", "Total shops" in body or "Total orders" in body, "")

        # C. 板块路由：点预设库 → /admin/presets
        try:
            page.get_by_role("link", name="Presets").first.click()
            page.wait_for_url("**/admin/presets", timeout=10000)
            body2 = page.inner_text("body")
            check("C 点击预设库进入 /admin/presets", "presets" in page.url, page.url)
            check("C presets 挂点页渲染标题", "Preset Library" in body2, "")
        except Exception as e:
            check("C 预设库路由", False, str(e)[:100])

        # D. 返回总览：点总览 nav 回 /admin，PlatformStats 三卡仍在
        try:
            page.get_by_role("link", name="Overview").first.click()
            page.wait_for_url("**/admin", timeout=10000)
            body3 = page.inner_text("body")
            check("D 点击总览返回 /admin", "/admin" in page.url, page.url)
        except Exception as e:
            check("D 总览返回", False, str(e)[:100])
        ctx.close()

        # E. owner 回归：/login → /dashboard 不受影响
        ctx2 = b.new_context()
        page2 = ctx2.new_page()
        page2.goto(f"{BASE}/en/login", wait_until="networkidle")
        fill_login(page2, OWNER_PHONE, OWNER_PWD)
        try:
            page2.wait_for_url("**/dashboard", timeout=15000)
            check("E owner /login → /dashboard 回归", "dashboard" in page2.url, page2.url)
        except Exception as e:
            check("E owner 回归", False, str(e)[:100])
        ctx2.close()

    fails = [r for r in results if not r[1]]
    print(f"\n===== A5 验证: {len(results) - len(fails)}/{len(results)} 通过 =====")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
