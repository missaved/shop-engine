# -*- coding: utf-8 -*-
# P1-4 确认弹窗验收：点取消先弹确认；确认→取消生效；拒绝→不取消
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
        ctx = b.new_context(viewport={"width": 900, "height": 1000})
        page = ctx.new_page()
        page.goto(f"{BASE}/vi/login", wait_until="networkidle")
        page.fill("input[name=phone]", "0901234567")
        page.fill("input[name=password]", "demo1234")
        page.click("button[type=submit]")
        page.wait_for_url("**/dashboard", timeout=10000)

        dialogs = []
        action = {"v": "accept"}

        def on_dialog(d):
            dialogs.append(d.message)
            if action["v"] == "accept":
                d.accept()
            else:
                d.dismiss()

        page.on("dialog", on_dialog)

        # 场景A：确认取消 → 弹确认 + 取消按钮数量 -1（该单变 CANCELLED）
        before_a = page.get_by_role("button", name="Hủy đơn", exact=True).count()
        action["v"] = "accept"
        page.get_by_role("button", name="Hủy đơn", exact=True).first.click()
        page.wait_for_timeout(2500)  # 等 run + router.refresh
        after_a = page.get_by_role("button", name="Hủy đơn", exact=True).count()

        check("P1-4 点取消先弹确认", len(dialogs) >= 1 and "hủy" in dialogs[0].lower(),
              f"dialog={dialogs[0] if dialogs else '无'}")
        check("P1-4 确认后取消生效", after_a == before_a - 1,
              f"取消按钮 {before_a}→{after_a}")

        # 场景B：拒绝弹窗 → 订单不取消（取消按钮数量不变）
        dialogs_before = len(dialogs)
        before_b = page.get_by_role("button", name="Hủy đơn", exact=True).count()
        action["v"] = "dismiss"
        page.get_by_role("button", name="Hủy đơn", exact=True).first.click()
        page.wait_for_timeout(2500)
        after_b = page.get_by_role("button", name="Hủy đơn", exact=True).count()

        check("P1-4 拒绝弹窗则取消按钮仍弹", len(dialogs) > dialogs_before,
              f"第 2 次 dialog 已弹")
        check("P1-4 拒绝后订单未取消", after_b == before_b,
              f"取消按钮 {before_b}→{after_b}")

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
