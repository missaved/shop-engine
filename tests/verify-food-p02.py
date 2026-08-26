# -*- coding: utf-8 -*-
# P0-2 权限边界回归验证：admin 路由需登录 / 客户路由公开 / 不存在 slug 404
import sys
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
results = []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("✅" if ok else "❌") + " " + name + (f"  — {detail}" if detail else ""))

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        # 未登录上下文
        anon = b.new_context(viewport={"width": 390, "height": 844})
        pg = anon.new_page()

        # 1. 未登录访问 dashboard → 重定向到 login
        pg.goto(f"{BASE}/vi/dashboard", wait_until="networkidle")
        check("P0-2 未登录 /dashboard → 重定向 /login", "/login" in pg.url, pg.url)

        # 2. 未登录访问公开客户菜单 → 200 正常
        pg.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        check("P0-2 未登录 /s/demo-pho（菜单）公开可访问", "demo-pho" in pg.url and "Phở" in pg.inner_text("body")[:200])

        # 3. 未登录访问公开查单 → 200 正常
        pg.goto(f"{BASE}/vi/s/demo-pho/track", wait_until="networkidle")
        check("P0-2 未登录 /s/demo-pho/track（查单）公开可访问", "track" in pg.url)

        # 4. 不存在 slug → 404
        resp = pg.goto(f"{BASE}/vi/s/nonexistent-shop-xyz", wait_until="networkidle")
        check("P0-2 不存在 slug → 404", resp is not None and resp.status == 404, f"status={resp.status if resp else 'N/A'}")
        anon.close()

        # 5. 登录后 dashboard → 200（自己店数据）
        auth = b.new_context(viewport={"width": 390, "height": 844})
        pg2 = auth.new_page()
        pg2.goto(f"{BASE}/vi/login", wait_until="networkidle")
        pg2.fill("input[name=phone]", "0901234567")
        pg2.fill("input[name=password]", "demo1234")
        pg2.click("button[type=submit]")
        try:
            pg2.wait_for_url("**/dashboard", timeout=15000)
            check("P0-2 登录后 /dashboard → 200（自己店）", True, pg2.url)
        except Exception:
            check("P0-2 登录后 /dashboard → 200（自己店）", False, pg2.url)
        auth.close()

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
