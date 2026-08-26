# -*- coding: utf-8 -*-
# P1-5 空/加载/错误态验收：断网点下单显示三语「下单失败」而非英文 fetch；恢复可重试
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
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")

        # 加商品 + 填手机号
        plus = page.get_by_role("button", name="+", exact=True)
        plus.nth(0).click(); page.wait_for_timeout(150)
        plus.nth(0).click(); page.wait_for_timeout(150)
        page.fill("input[type=tel]", "0902220001")

        # 断网 + 点下单
        ctx.set_offline(True)
        page.get_by_role("button", name="Đặt hàng", exact=True).click()
        page.wait_for_timeout(3000)  # 等 fetch 失败 + catch 渲染

        body = page.inner_text("body")
        friendly = "Đặt hàng thất bại" in body  # vi menu.error
        no_english = "Failed to fetch" not in body
        check("P1-5 断网显示三语「下单失败」", friendly, "含 menu.error")
        check("P1-5 非英文 fetch 文案", no_english, "不含 Failed to fetch")

        # 恢复在线 + 重试成功（下单按钮可再点）
        ctx.set_offline(False)
        page.get_by_role("button", name="Đặt hàng", exact=True).click()
        try:
            page.get_by_text("Đặt hàng thành công").wait_for(timeout=15000)
            retry_ok = True
        except Exception:
            retry_ok = False
        check("P1-5 恢复在线可重试成功", retry_ok, "下单成功")

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
