# -*- coding: utf-8 -*-
# P0-4 查单限流验收：连查 5 次不存在订单后，第 6 次显示限流提示
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
        page = b.new_context(viewport={"width": 390, "height": 844}).new_page()

        url_tpl = f"{BASE}/vi/s/demo-pho/track?phone=0909999999&orderNo=CP-999999-999&t="
        # 连查 5 次（每次 notFound，触发 recordFailure）
        for i in range(5):
            page.goto(url_tpl + str(i), wait_until="networkidle")
            body = page.inner_text("body")
            if "Không tìm thấy" not in body:
                check(f"P0-4 第{i+1}次查无结果(notFound)", False, body[:120])

        # 第 6 次：应被限流
        page.goto(url_tpl + "6", wait_until="networkidle")
        body = page.inner_text("body")
        check("P0-4 连查5次后第6次限流提示", "Quá nhiều yêu cầu" in body, body[:160])

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
