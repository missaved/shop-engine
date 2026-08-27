# -*- coding: utf-8 -*-
# 中台第 4 批子项 3 验收：多币种展示（菜单价对应符号 + 建店币种下拉 + VND 回归）
import sys
import re
import subprocess
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
ENV = "/root/shop-saas/app/.env"
ADMIN_PHONE = "0900000000"
ADMIN_PWD = "demo1234"

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("✅ " if ok else "❌ ") + name + (f"  — {detail}" if detail else ""))


def pgurl():
    s = open(ENV).read()
    m = re.search(r"^DATABASE_URL=(\S+)", s, re.M)
    return m.group(1).strip().strip('"').strip("'").split("?")[0]


def sql(q):
    """执行单条 SQL，返回 stdout 文本（psql -tA）。失败返回 None。"""
    r = subprocess.run(["psql", pgurl(), "-tA", "-c", q], capture_output=True, text=True)
    if r.returncode != 0:
        print("SQL 错误:", r.stderr.strip())
        return None
    return r.stdout.strip()


def main():
    # 0. 清理残留 + 建 USD/EUR/VND 三个公开菜单测试店（无需 owner，菜单页公开）
    sql("DELETE FROM \"Shop\" WHERE slug IN ('test-cur-usd','test-cur-eur','test-cur-vnd')")
    sql("INSERT INTO \"Shop\" (id, slug, name, vertical, currency, \"updatedAt\") VALUES "
        "('test-cur-usd-01','test-cur-usd','USD Cafe','FOOD','USD', now()), "
        "('test-cur-eur-01','test-cur-eur','EUR Cafe','FOOD','EUR', now()), "
        "('test-cur-vnd-01','test-cur-vnd','VND Cafe','FOOD','VND', now())")
    sql("INSERT INTO \"Product\" (id, \"shopId\", name, price, unit, category, \"updatedAt\") VALUES "
        "('test-prod-usd-01','test-cur-usd-01','Coffee',25000,'ly','Drink', now()), "
        "('test-prod-eur-01','test-cur-eur-01','Coffee',15000,'ly','Drink', now()), "
        "('test-prod-vnd-01','test-cur-vnd-01','Coffee',10000,'ly','Drink', now())")

    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()

        # 1. USD 菜单价 → $25,000（符号前置 + en-US 千分位，非 kđ），且无 đ 残留
        # 菜单页先显示「选择用餐方式」，点 dine-in 进入商品列表才见价格
        page.goto(f"{BASE}/vi/s/test-cur-usd", wait_until="networkidle")
        page.click("button:has(img[src='/hero/dine-in.jpg'])")
        page.wait_for_function("() => document.body.innerText.includes('$25,000')", timeout=10000)
        body = page.inner_text("body")
        check("USD 菜单价 $25,000", "$25,000" in body, "")
        check("USD 无 đ 残留", "đ" not in body, "")

        # 2. EUR 菜单价 → €15,000
        page.goto(f"{BASE}/vi/s/test-cur-eur", wait_until="networkidle")
        page.click("button:has(img[src='/hero/dine-in.jpg'])")
        page.wait_for_function("() => document.body.innerText.includes('€15,000')", timeout=10000)
        body = page.inner_text("body")
        check("EUR 菜单价 €15,000", "€15,000" in body, "")

        # 3. VND 回归 → 10kđ（整千 k 简写）
        page.goto(f"{BASE}/vi/s/test-cur-vnd", wait_until="networkidle")
        page.click("button:has(img[src='/hero/dine-in.jpg'])")
        page.wait_for_function("() => document.body.innerText.includes('10kđ')", timeout=10000)
        body = page.inner_text("body")
        check("VND 菜单价 10kđ", "10kđ" in body, "")

        # 4. 中台建店表单币种下拉 5 项（VND/USD/EUR/SGD/CNY）
        page.goto(f"{BASE}/vi/login", wait_until="networkidle")
        page.fill("input[name=phone]", ADMIN_PHONE)
        page.fill("input[name=password]", ADMIN_PWD)
        page.click("button[type=submit]")
        page.wait_for_url("**/admin", timeout=15000)
        page.wait_for_load_state("networkidle")
        sel = page.locator("select:has(option[value='USD'])")
        opts = sel.locator("option")
        vals = [opts.nth(i).get_attribute("value") for i in range(opts.count())]
        check("建店币种下拉 5 项", vals == ["VND", "USD", "EUR", "SGD", "CNY"], str(vals))

        ctx.close()
        b.close()

    # 清理测试店（级联删 product）
    sql("DELETE FROM \"Shop\" WHERE slug IN ('test-cur-usd','test-cur-eur','test-cur-vnd')")
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
