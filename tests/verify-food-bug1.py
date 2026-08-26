# -*- coding: utf-8 -*-
# 问题1 商品规格选择验收：加购抽屉选规格 → 加入购物车 → 明细 → 服务端计价
import re, subprocess, sys
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
DB = "postgresql://shop_engine:shop_engine_dev@localhost:5433/shop_engine"
results = []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("✅" if ok else "❌") + " " + name + (f"  — {detail}" if detail else ""))

def psql(sql):
    r = subprocess.run(["psql", DB, "-t", "-A", "-c", sql], capture_output=True, text=True)
    return r.stdout.strip()

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")

        # 1. 点 Phở bò tái 的 +（有规格 → 弹加购抽屉）
        page.get_by_role("button", name="+", exact=True).nth(2).click()
        page.wait_for_timeout(300)
        body = page.inner_text("body")
        check("问题1 点商品弹加购抽屉", "Thêm vào giỏ" in body, "含 加入购物车")
        check("问题1 抽屉含规格组(辣度)", "Cay" in body, "含 Cay")
        check("问题1 抽屉含规格组(汤底)", "Nước dùng" in body, "含 Nước dùng")

        # 2. 选汤底「Nước béo」+10k
        page.get_by_role("button", name=re.compile("Nước béo")).click()
        page.wait_for_timeout(200)

        # 3. 加入购物车
        page.get_by_role("button", name=re.compile("Thêm vào giỏ")).click()
        page.wait_for_timeout(300)
        body2 = page.inner_text("body")
        check("问题1 加入购物车后悬浮栏出现", "Giỏ hàng · 1" in body2, "含 Giỏ hàng · 1")

        # 4. 打开购物车抽屉看明细
        page.get_by_role("button", name=re.compile("Giỏ hàng · 1")).click()
        page.wait_for_timeout(300)
        body3 = page.inner_text("body")
        check("问题1 明细含规格(Nước béo)", "Nước béo" in body3, "含 Nước béo")
        check("问题1 明细小计含规格价(70k)", "70.000đ" in body3, "60k+10k=70k")

        # 5. 下单
        page.fill("input[type=tel]", "0904440006")
        page.get_by_role("button", name="Đặt hàng", exact=True).click()
        try:
            page.get_by_text("Đặt hàng thành công").wait_for(timeout=15000)
            m = re.search(r"CP-\d{6}-\d{3}", page.inner_text("body"))
            displayNo = m.group(0)
            check("问题1 下单成功", True, displayNo)
        except Exception as e:
            check("问题1 下单成功", False, str(e)[:120])
            b.close(); summarize(); return

        # 6. DB 验证：items 含规格 + total 正确
        row = psql(f"SELECT items->0->'options', total FROM \"Order\" WHERE \"displayNo\"='{displayNo}';")
        ok_opts = "Nước béo" in row
        ok_total = "70000" in row
        check("问题1 DB items 含规格选项", ok_opts, row[:80])
        check("问题1 DB total=70000(含规格价)", ok_total, row[:80])

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
