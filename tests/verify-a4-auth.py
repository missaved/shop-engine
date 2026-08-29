# -*- coding: utf-8 -*-
# 第 20 批 A4 端到端验证：/admin/login 两步 + 绑定引导 + /login 拒绝 admin + owner 回归
# 前置：临时测试 admin（0999999998，未绑定）已由 setup 脚本创建；验证后由 cleanup 删除
import sys, time, struct, hashlib, hmac, base64
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
ADMIN_PHONE, ADMIN_PWD = "0999999998", "demo1234"
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

        # A. 未绑定 admin：/admin/login 登录 → 强制引导绑定 → 输验证码 → 进 /admin
        ctx = b.new_context()
        page = ctx.new_page()
        page.goto(f"{BASE}/en/admin/login", wait_until="networkidle")
        fill_login(page, ADMIN_PHONE, ADMIN_PWD)
        try:
            page.wait_for_url("**/setup-totp", timeout=15000)
            check("A 未绑定 admin 登录被引导到绑定页", "setup-totp" in page.url, page.url)
        except Exception as e:
            check("A 未绑定 admin 登录被引导到绑定页", False, str(e)[:100])
            ctx.close()
            b.close()
            print(f"===== A4: {sum(1 for r in results if r[1])}/{len(results)} 通过 =====")
            sys.exit(1)
        # 等 secret 生成（useEffect 调 startAdminTotpSetup）
        page.wait_for_selector(".font-mono", timeout=10000)
        secret = page.locator(".font-mono").first.inner_text().strip()
        check("A 绑定页展示 secret", len(secret) >= 16, f"secret={secret[:8]}...")
        code = totp(secret)
        page.fill("input", code)  # 绑定页唯一 text input 是 otp
        page.locator("button").last.click()  # confirm 按钮（无 type=submit，onClick 提交）
        try:
            page.wait_for_url("**/admin", timeout=15000)
            check("A 输验证码完成绑定进入 /admin", "/admin" in page.url, page.url)
        except Exception as e:
            check("A 输验证码完成绑定进入 /admin", False, str(e)[:100])
        ctx.close()

        # B. 已绑定 admin：/admin/login 两步登录
        ctx2 = b.new_context()
        page2 = ctx2.new_page()
        page2.goto(f"{BASE}/en/admin/login", wait_until="networkidle")
        fill_login(page2, ADMIN_PHONE, ADMIN_PWD)
        # 应进入 otp 第二步（出现 otp 输入框）
        otp_input = page2.locator("input[name=otp]")
        try:
            otp_input.wait_for(timeout=10000)
            check("B 第一步密码通过后进入验证码第二步", otp_input.is_visible(), "")
        except Exception as e:
            body2 = page2.inner_text("body")
            check("B 第一步密码通过后进入验证码第二步", False, f"body={body2[:300]}")
        page2.fill("input[name=otp]", totp(secret))
        page2.click("button[type=submit]")
        try:
            page2.wait_for_url("**/admin", timeout=15000)
            check("B 两步登录成功进入 /admin", "/admin" in page2.url, page2.url)
        except Exception as e:
            check("B 两步登录成功进入 /admin", False, str(e)[:100])
        ctx2.close()

        # C. /login 拒绝 admin（boss 专属，admin 登录后提示走管理后台）
        ctx3 = b.new_context()
        page3 = ctx3.new_page()
        page3.goto(f"{BASE}/en/login", wait_until="networkidle")
        fill_login(page3, ADMIN_PHONE, ADMIN_PWD)
        page3.wait_for_timeout(1200)
        body3 = page3.inner_text("body")
        check("C /login 拒绝 admin 并提示管理后台入口",
              "Platform admin, please sign in at admin console" in body3,
              body3[:80])
        ctx3.close()

        # D. owner 回归：/login 正常登录 → /dashboard
        ctx4 = b.new_context()
        page4 = ctx4.new_page()
        page4.goto(f"{BASE}/en/login", wait_until="networkidle")
        fill_login(page4, OWNER_PHONE, OWNER_PWD)
        try:
            page4.wait_for_url("**/dashboard", timeout=15000)
            check("D owner /login 正常登录 → /dashboard", "dashboard" in page4.url, page4.url)
        except Exception as e:
            check("D owner /login 正常登录 → /dashboard", False, str(e)[:100])
        ctx4.close()

    fails = [r for r in results if not r[1]]
    print(f"\n===== A4 验证: {len(results) - len(fails)}/{len(results)} 通过 =====")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
