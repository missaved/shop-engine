# -*- coding: utf-8 -*-
# P0-7 防双击下单幂等键验收：正常下单写幂等键 + 双击只建一单
import sys, subprocess
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

def order_count():
    return int(psql('SELECT count(*) FROM "Order";'))

def latest_idem_not_null():
    return psql('SELECT "idempotencyKey" IS NOT NULL FROM "Order" ORDER BY "createdAt" DESC LIMIT 1;')

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_context(viewport={"width": 390, "height": 844}).new_page()

        # --- 场景1：正常下单写幂等键 ---
        before = order_count()
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        plus = page.get_by_role("button", name="+", exact=True)
        plus.nth(0).click(); page.wait_for_timeout(200)
        plus.nth(0).click(); page.wait_for_timeout(200)
        page.fill("input[type=tel]", "0908887777")
        page.get_by_role("button", name="Đặt hàng", exact=True).click()
        try:
            page.get_by_text("Đặt hàng thành công").wait_for(timeout=15000)
            after1 = order_count()
            check("P0-7 正常下单 +1 且写幂等键", after1 == before + 1 and latest_idem_not_null() == "t",
                  f"before={before} after={after1} idemNotNull={latest_idem_not_null()}")
        except Exception as e:
            check("P0-7 正常下单 +1 且写幂等键", False, str(e)[:120])

        # --- 场景2：快速双击只建一单 ---
        before2 = order_count()
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        plus2 = page.get_by_role("button", name="+", exact=True)
        plus2.nth(0).click(); page.wait_for_timeout(200)
        plus2.nth(0).click(); page.wait_for_timeout(200)
        page.fill("input[type=tel]", "0906665555")
        # 用 JS 同步触发两次 submit，绕过 useTransition 的 pending 禁用，模拟双击
        page.evaluate("""() => {
          const btns = [...document.querySelectorAll('button[type=submit]')];
          const s = btns.find(b => b.textContent.includes('Đặt hàng'));
          s.click(); s.click();
        }""")
        page.wait_for_timeout(5000)  # 等两次 createOrder 走完
        after2 = order_count()
        check("P0-7 双击（同幂等键）只建一单", after2 == before2 + 1,
              f"before={before2} after={after2}")

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
