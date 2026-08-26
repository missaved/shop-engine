# -*- coding: utf-8 -*-
# 问题 14 验收：订单类型徽章（堂食桌号/外送）+ 状态筛选 + 搜索
import sys, re
from playwright.sync_api import sync_playwright

BASE = "http://192.168.5.210:3000"
PHONE = "0912999888"
results = []
order_nos = []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    mark = "✅" if ok else "❌"
    print(f"{mark} {name}" + (f"  — {detail}" if detail else ""))

def add_trada(page):
    """Trà đá 无规格，点 + 直接加购"""
    li = page.get_by_text("Trà đá", exact=True).first.locator("xpath=ancestor::li[1]")
    li.locator("button", has_text="+").click()
    page.wait_for_timeout(300)

def add_pho(page):
    """Phở bò tái 有规格：点 + 开抽屉 → 选 Cay=Ít cay → 加购"""
    li = page.get_by_text("Phở bò tái", exact=True).first.locator("xpath=ancestor::li[1]")
    li.locator("button", has_text="+").click()
    page.wait_for_timeout(400)
    page.locator("button", has_text="Ít cay").click()
    page.locator("button", has_text="Thêm vào giỏ").click()
    page.wait_for_timeout(400)

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()

        # 1. 下单 A：堂食 + 桌号 Bàn 3（Trà đá 5000đ）
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        add_trada(page)
        page.locator("button", has_text="Giỏ hàng").click()
        page.wait_for_timeout(400)
        page.fill('input[placeholder="Bàn 5"]', "Bàn 3")
        page.locator("button[type=submit]").click()
        page.wait_for_timeout(1500)
        body = page.inner_text("body")
        m = re.search(r"CP-\d{6}-\d{3}", body)
        no_a = m.group(0) if m else None
        check("堂食单下单成功", no_a is not None, no_a or "")
        order_nos.append(no_a)

        # 2. 下单 B：外送 + 地址 + 手机号（Phở bò tái 60000đ ≥ 起送 50000）
        page.goto(f"{BASE}/vi/s/demo-pho", wait_until="networkidle")
        add_pho(page)
        page.locator("button", has_text="Giỏ hàng").click()
        page.wait_for_timeout(400)
        page.locator("button", has_text="Giao hàng").click()
        page.wait_for_timeout(200)
        page.fill('input[placeholder="12 Nguyễn Huệ, P.5"]', "12 Nguyễn Huệ, P.5")
        page.fill("input[type=tel]", PHONE)
        page.locator("button[type=submit]").click()
        page.wait_for_timeout(1500)
        body = page.inner_text("body")
        m = re.search(r"CP-\d{6}-\d{3}", body)
        no_b = m.group(0) if m else None
        check("外送单下单成功", no_b is not None, no_b or "")
        order_nos.append(no_b)

        # 3. 登录老板端
        page.goto(f"{BASE}/vi/login", wait_until="networkidle")
        page.fill("input[type=tel]", "0901234567")
        page.fill("input[type=password]", "demo1234")
        page.click("button[type=submit]")
        page.wait_for_url("**/dashboard", timeout=10000)
        page.wait_for_timeout(800)
        body = page.inner_text("body")

        # 4. 类型徽章：外送 🛵 Giao hàng / 堂食 🪑 Bàn 3
        check("外送单显示 🛵 外送徽章", "🛵" in body, "外送徽章图标")
        check("外送单显示 'Giao hàng' 标签", "Giao hàng" in body)
        check("堂食单显示 🪑 堂食徽章", "🪑" in body, "堂食徽章图标")
        check("堂食单显示桌号 Bàn 3", "Bàn 3" in body)

        # 5. 状态筛选：点「Chờ xử lý」（待处理）chip → 两单均 PENDING 仍显示
        page.locator("button", has_text="Chờ xử lý").click()
        page.wait_for_timeout(300)
        body_f = page.inner_text("body")
        check("筛选「待处理」后两单仍在", no_a in body_f and no_b in body_f,
              f"{no_a}/{no_b}")

        # 6. 搜索：搜桌号「Bàn 3」→ 只剩堂食单，外送单消失
        # 仅检查 #orders 区域（订单列表），避免 ReminderList 里的订单号干扰
        page.fill('input[placeholder*="Tìm"]', "Bàn 3")
        page.wait_for_timeout(400)
        orders_text = page.locator('#orders').inner_text()
        check("搜索「Bàn 3」只剩堂食单", no_a in orders_text and no_b not in orders_text,
              f"{no_a} 保留 / {no_b} 隐藏")

        b.close()
    print("ORDER_NOS=" + ",".join([n for n in order_nos if n]))
    summarize()

def summarize():
    fails = [r for r in results if not r[1]]
    print("\n" + "=" * 50)
    print(f"共 {len(results)} 项，通过 {len(results)-len(fails)}，失败 {len(fails)}")
    for n, _, d in fails:
        print(f"  - {n}: {d}")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
