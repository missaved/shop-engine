# -*- coding: utf-8 -*-
# P2-1 PDPD 一键删除验收：查单 → 删除 → 显示已删除 → DB 手机号已清空
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

        # 1. 下单拿到 displayNo
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        plus = page.get_by_role("button", name="+", exact=True)
        plus.nth(0).click(); page.wait_for_timeout(150)
        plus.nth(0).click(); page.wait_for_timeout(150)
        page.fill("input[type=tel]", "0903330001")
        page.get_by_role("button", name="Đặt hàng", exact=True).click()
        try:
            page.get_by_text("Đặt hàng thành công").wait_for(timeout=15000)
            m = re.search(r"CP-\d{6}-\d{3}", page.inner_text("body"))
            displayNo = m.group(0)
        except Exception as e:
            check("P2-1 下单成功", False, str(e)[:120]); b.close(); summarize(); return
        check("P2-1 下单成功", True, displayNo)

        # 2. 查单页查到订单
        page.goto(f"{BASE}/vi/s/demo-pho/track?orderNo={displayNo}&phone=0903330001", wait_until="networkidle")
        check("P2-1 查单页显示订单", displayNo in page.inner_text("body"), displayNo)

        # 3. 点删除 → 确认 → 显示已删除
        dialogs = []
        page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))
        page.get_by_role("button", name="Xóa dữ liệu của tôi", exact=True).click()
        try:
            page.get_by_text("Đã xóa").wait_for(timeout=10000)
            deleted_ui = True
        except Exception:
            deleted_ui = False
        check("P2-1 删除后显示「已删除」", deleted_ui, f"dialog={dialogs[0][:30] if dialogs else '无'}")

        # 4. DB 验证：手机号已清空，订单仍保留
        phone_null = psql(f"SELECT \"customerPhone\" IS NULL FROM \"Order\" WHERE \"displayNo\"='{displayNo}';")
        order_exists = psql(f"SELECT count(*) FROM \"Order\" WHERE \"displayNo\"='{displayNo}';")
        check("P2-1 DB 手机号已清空（匿名化）", phone_null == "t", f"phoneNull={phone_null}")
        check("P2-1 订单记录保留（老板对账）", order_exists == "1", f"count={order_exists}")

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
