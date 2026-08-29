# -*- coding: utf-8 -*-
# 第 20 批审计补测（verify-a4-gaps）：覆盖 A4/A5 验证盲区
#   1. 未绑定 admin 走 /login → 拒绝 + 提示走 /admin/login（signOut + notAdmin 分支）
#   2. 已绑定 admin 访问 /dashboard → requireOwner 拦截踢回 /login（admin 不能进店）
#   3. 验证码爆破：正确密码 + 错 otp 连错 3 次 → 第 4 次即使输对 otp 也 RATE_LIMITED
# 前置：临时 admin（0999999993，未绑定）由脚本外 psql/tsx 创建；验证后删除 + 重启服务清限流内存
import sys, time, struct, hashlib, hmac, base64
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
ADMIN_PHONE, ADMIN_PWD = "0999999993", "demo1234"
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


def fill_admin_login(page, phone, pwd):
    page.fill("input[name=phone]", phone)
    page.fill("input[name=password]", pwd)
    page.click("button[type=submit]")


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()

        # ---- 1. 未绑定 admin 走 /login 被拒（notAdmin 分支，authorize 成功后 signOut）----
        ctx = b.new_context()
        page = ctx.new_page()
        page.goto(f"{BASE}/en/login", wait_until="networkidle")
        fill_admin_login(page, ADMIN_PHONE, ADMIN_PWD)
        try:
            page.wait_for_timeout(1200)
            body = page.inner_text("body")
            check("1 未绑定 admin 走 /login → 拒绝并提示走管理后台",
                  "Platform admin, please sign in at admin console" in body, body[:80])
        except Exception as e:
            check("1 未绑定 admin 走 /login", False, str(e)[:100])
        ctx.close()

        # ---- 2. 绑定流程拿到 secret（A4 已验证，复用）----
        ctx2 = b.new_context()
        page2 = ctx2.new_page()
        page2.goto(f"{BASE}/en/admin/login", wait_until="networkidle")
        fill_admin_login(page2, ADMIN_PHONE, ADMIN_PWD)
        try:
            page2.wait_for_url("**/setup-totp", timeout=15000)
            page2.wait_for_selector(".font-mono", timeout=10000)
            secret = page2.locator(".font-mono").first.inner_text().strip()
            page2.fill("input", totp(secret))
            page2.locator("button").last.click()
            page2.wait_for_url("**/admin", timeout=15000)
            check("2 绑定进入 /admin", "/admin" in page2.url, page2.url)
        except Exception as e:
            check("2 绑定进入 /admin", False, str(e)[:100])
            ctx2.close()
            b.close()
            print(f"===== 补测: {sum(1 for r in results if r[1])}/{len(results)} 通过 =====")
            sys.exit(1)

        # ---- 3. 已绑定 admin 访问 /dashboard → 被踢回 /login（requireOwner 拦截）----
        page2.goto(f"{BASE}/en/dashboard", wait_until="networkidle")
        page2.wait_for_timeout(800)
        check("3 已绑定 admin 访问 /dashboard 被踢回 /login",
              page2.url.rstrip("/").endswith("/login") or "/login" in page2.url, page2.url)
        ctx2.close()

        # ---- 4. 验证码爆破：正确密码 + 错 otp 连错 3 次 → 第 4 次输对也 RATE_LIMITED ----
        ctx3 = b.new_context()
        page3 = ctx3.new_page()
        page3.goto(f"{BASE}/en/admin/login", wait_until="networkidle")

        def try_otp(code):
            # 错 otp 后 admin/login 停留在 otp 步骤（setStep 仅 NEED_TOTP 时切 otp，TOTP_INVALID 不改步），
            # 因此：已有 otp 输入框则直接输，否则从 pwd 步骤走一遍对密码 → NEED_TOTP → otp
            if page3.locator("input[name=otp]").count() == 0:
                fill_admin_login(page3, ADMIN_PHONE, ADMIN_PWD)
                try:
                    page3.wait_for_selector("input[name=otp]", timeout=8000)
                except Exception:
                    return "NO_OTP_STEP"
            page3.fill("input[name=otp]", code)
            page3.click("button[type=submit]")
            page3.wait_for_timeout(700)
            return ""

        # 连错 3 次（各次都应停留在 pwd 步骤、显示验证码错误，不切 otp）
        err3 = try_otp("000000")
        if not err3:
            page3.wait_for_timeout(200)
        check("4a 第 1 次错 otp → TOTP_INVALID（Incorrect code）", "Incorrect code" in page3.inner_text("body"), "")
        for _ in range(2):
            err3 = try_otp("000000")
            page3.wait_for_timeout(200)
        check("4b 连错 3 次未误入成功路径", "Incorrect code" in page3.inner_text("body") or "Too many" in page3.inner_text("body"), "")

        # 第 4 次：输真 otp，也应被限流拦截（3 次/5min 已锁）；页面仍在 otp 步骤，用 try_otp 继续
        try_otp(totp(secret))
        body4 = page3.inner_text("body")
        check("4c 第 4 次（真 otp）仍被限流拦截", "Too many attempts" in body4, body4[:80])
        ctx3.close()

    fails = [r for r in results if not r[1]]
    print(f"\n===== 补测: {len(results) - len(fails)}/{len(results)} 通过 =====")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
