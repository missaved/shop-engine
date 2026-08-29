# -*- coding: utf-8 -*-
# 皮肤系统补充验收：gourmet 皮肤下单回归 + 皮肤保存落库（切 moss→保存→查 DB→恢复）
import sys
import re
import subprocess
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
ENV = "/root/shop-saas/app/.env"
OWNER_PHONE = "0901234567"
OWNER_PWD = "demo1234"

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("✅ " if ok else "❌ ") + name + (f"  — {detail}" if detail else ""))


def pgurl():
    s = open(ENV).read()
    m = re.search(r"^DATABASE_URL=(\S+)", s, re.M)
    return m.group(1).strip().strip('"').strip("'").split("?")[0]


def sql(q):
    r = subprocess.run(["psql", pgurl(), "-tA", "-c", q], capture_output=True, text=True)
    if r.returncode != 0:
        print("SQL 错误:", r.stderr.strip())
        return None
    return r.stdout.strip()


def main():
    # 记录原 theme，便于恢复
    orig = sql("SELECT config->>'theme' FROM \"Shop\" WHERE slug='demo-pho'") or "gourmet"
    sql("UPDATE \"Shop\" SET config = jsonb_set(COALESCE(config,'{}'::jsonb), '{theme}', '\"gourmet\"') WHERE slug='demo-pho'")

    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()

        # ── 1. gourmet 皮肤下下单 smoke ──
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        check("菜单根容器挂 theme-gourmet", page.locator("main[class*='theme-gourmet'], div[class*='theme-gourmet']").count() > 0,
              f"{page.locator('[class*=theme-]').first.get_attribute('class') or ''}")
        page.click("button:has(img[src='/hero/dine-in.jpg'])")
        page.wait_for_function("() => document.body.innerText.includes('kđ') || document.body.innerText.includes('đ')", timeout=10000)
        body = page.inner_text("body")
        check("gourmet 菜单商品价格可见", "60kđ" in body or "đ" in body, "")
        # 点第一张商品卡片 → 加购弹窗
        card = page.locator("ul.grid button").first
        card.click()
        page.wait_for_timeout(800)
        add_btn = page.locator("button", has_text="Thêm vào giỏ").first
        has_sheet = add_btn.count() > 0 or page.locator("text=Thêm vào giỏ").count() > 0
        check("商品弹窗打开（含加购按钮）", has_sheet, "")
        if has_sheet:
            add_btn.click()
            page.wait_for_timeout(600)
        # 打开购物车 → 填桌号 → 下单
        cart = page.locator("button", has_text="Giỏ").first
        check("底部购物车按钮可点", cart.count() > 0, "")
        if cart.count() > 0:
            cart.click()
            page.wait_for_timeout(600)
            # 桌号输入（堂食）
            tbl = page.locator("input[placeholder*='Bàn'], input[placeholder*='Bàn']").first
            if tbl.count() > 0:
                tbl.fill("9")
            submit = page.locator("button", has_text="Gửi đơn").first
            if submit.count() == 0:
                submit = page.locator("button[type=submit]").last
            check("下单提交按钮存在", submit.count() > 0, "")
            if submit.count() > 0:
                submit.click()
                page.wait_for_timeout(1500)
                ok = "thành công" in page.inner_text("body") or page.locator("text=Đặt hàng thành công").count() > 0
                check("gourmet 皮肤下单成功", ok, "")

        # ── 2. 皮肤保存落库 ──
        page.goto(f"{BASE}/vi/login", wait_until="networkidle")
        page.fill("input[name=phone]", OWNER_PHONE)
        page.fill("input[name=password]", OWNER_PWD)
        page.click("button[type=submit]")
        page.wait_for_url("**/dashboard", timeout=15000)
        page.wait_for_load_state("networkidle")
        page.locator('button[aria-label="打开设置"]').click()
        page.wait_for_timeout(800)

        moss = page.locator('[data-od-id="theme-card-moss"]')
        check("皮肤卡 moss 可点", moss.count() > 0, "")
        if moss.count() > 0:
            moss.click()
            page.wait_for_timeout(300)
            # 定位包含皮肤卡的表单，点其保存按钮（避免误点退出/其他表单）
            save = page.locator("form").filter(has=page.locator('[data-od-id="theme-card-moss"]')).locator('button[type=submit]').first
            check("皮肤保存按钮存在", save.count() > 0, "")
            if save.count() > 0:
                save.click()
                page.wait_for_timeout(1200)
                db_theme = sql("SELECT config->>'theme' FROM \"Shop\" WHERE slug='demo-pho'")
                check("皮肤保存落库为 moss", db_theme == "moss", f"DB theme={db_theme}")

        ctx.close()
        b.close()

    # 恢复原 theme（JSON 字符串字面量 = "gourmet"，双引号是内容不是转义）
    sql(f"UPDATE \"Shop\" SET config = jsonb_set(COALESCE(config,'{{}}'::jsonb), '{{theme}}', '\"{orig}\"') WHERE slug='demo-pho'")
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
