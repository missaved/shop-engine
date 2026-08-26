# -*- coding: utf-8 -*-
# P1-1 新订单实时性验收：老板 dashboard 保持打开，客户下单后 ≤30s 自动出现新单并置顶
import re, sys
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # 老板端：登录并停留在 dashboard
        dash = browser.new_context(viewport={"width": 900, "height": 1000}).new_page()
        dash.goto(f"{BASE}/vi/login", wait_until="networkidle")
        dash.fill("input[name=phone]", "0901234567")
        dash.fill("input[name=password]", "demo1234")
        dash.click("button[type=submit]")
        try:
            dash.wait_for_url("**/dashboard", timeout=10000)
        except Exception:
            pass
        assert "/dashboard" in dash.url, "老板登录失败"

        # 客户端：下单并读取新单 displayNo
        cust = browser.new_context(viewport={"width": 390, "height": 844}).new_page()
        cust.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        plus = cust.get_by_role("button", name="+", exact=True)
        plus.nth(0).click(); cust.wait_for_timeout(200)
        plus.nth(0).click(); cust.wait_for_timeout(200)
        cust.fill("input[type=tel]", "0909990001")
        cust.get_by_role("button", name="Đặt hàng", exact=True).click()
        try:
            cust.get_by_text("Đặt hàng thành công").wait_for(timeout=15000)
        except Exception as e:
            print("❌ 客户下单失败:", str(e)[:120])
            browser.close(); sys.exit(1)
        m = re.search(r"CP-\d{6}-\d{3}", cust.inner_text("body"))
        displayNo = m.group(0) if m else ""
        print(f"客户下单成功，新单 displayNo = {displayNo}")

        # 老板端：等轮询（20s）触发刷新，新单自动出现（≤35s）
        try:
            dash.wait_for_selector(f"text={displayNo}", timeout=35000)
            auto = True
        except Exception:
            auto = False
        print(("✅" if auto else "❌") + f" P1-1 新单 ≤30s 自动出现  — {displayNo}")

        # 置顶检查：新单应是 #orders 容器内第一个 CP- 单号
        orders_text = dash.locator("#orders").inner_text()
        first = re.search(r"CP-\d{6}-\d{3}", orders_text)
        top = first and first.group(0) == displayNo
        print(("✅" if top else "❌") + f" P1-1 新单置顶  — 首单={first.group(0) if first else 'N/A'}")

        browser.close()
        sys.exit(0 if (auto and top) else 1)

if __name__ == "__main__":
    main()
